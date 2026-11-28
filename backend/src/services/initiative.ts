// This file holds material under the ORC License, beside CozyVTT's own code under the AGPL-3.0.
// See GAME_CONTENT_NOTICES.md for the notice and credits.

/**
 * The initiative tracker's operations, for the socket's initiative.* events
 * and REST alike: add, remove, set, roll, reorder, start, next, end, and the
 * sends of the order that follow each.
 *
 * The order lives in memory (websocket/initiativeState.ts), and every path
 * reads and writes it through these functions, so a change over REST and one
 * over the socket act on the same order and are sent in the same sequence
 * (startSend/latestSend). Each function reads the state itself and keeps it
 * between its own awaits as the handlers did: the caller never hands state in.
 *
 * Who may act is the caller's check: the socket handlers refuse everyone but
 * the GM (and gate a player's own roll), the routes are campaignGM.
 */

import { Server } from 'socket.io';
import type { AuthenticatedFields } from '../websocket/auth';
import { prisma } from '../config/database';
import { rollDice, parseDiceExpression, DiceParserError } from '../utils/dice-parser';
import {
  resolveCharacterInitiative,
  resolveStatBlockInitiative,
  DEFAULT_INITIATIVE_EXPRESSION,
} from '../utils/rules/initiative';
import logger from '../utils/logger';
import { readTokens, toJson } from '../utils/prisma-json';
import { withMapsLocked } from '../utils/mapTokens';
import { GRID_FRAME_SELECT } from '../validators/maps';
import { filterTokensByRole, getSpiritVisibilityBatch, tokensSentTo, type MapTokenSight } from '../utils/spirit-layer';
import { canReadMap } from './permissions';
import {
  getState as getCombatState,
  setState as setCombatState,
  clearState as clearCombatState,
  sortCombatants,
  withoutCombatants,
  projectCombatState,
  getVersion,
  startSend,
  latestSend,
  markPlayerRolled,
  type CombatantEntry,
  type CombatantSource,
  type CombatState,
} from '../websocket/initiativeState';
import { bestEffort, campaignSockets, getSocketInstance, stillInCampaign } from '../websocket/utils';
import { sheetAsRead } from '../legacy/sheetConversion';

/** What a send needs of a socket; a connected one and a fetched one both have it. */
export type Recipient = Pick<AuthenticatedFields, 'userId' | 'role'> & {
  emit(event: 'initiative.state', state: CombatState): unknown;
  emit(event: 'dice.rolled' | 'dice.rolled.secret', roll: Record<string, unknown>): unknown;
};

/**
 * The sockets in the campaign that are sent `token` at all: every GM's, and
 * a player's when the token stands on the map the campaign is showing and the
 * role filter keeps it for them (visible, on their plane). The dice log entry for a token's roll goes to these and no one
 * else, so a hidden or off-plane combatant the tracker keeps from a player is
 * not announced to them by its roll.
 */
async function recipientsSentToken(
  io: Server,
  campaignId: string,
  token: ReturnType<typeof readTokens>[number],
  mapId: string
): Promise<Recipient[]> {
  const recipients = (await campaignSockets(io, campaignId)).map((s) => s as unknown as Recipient);
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { currentMapId: true } });
  // A token on a map the table is not showing is sent to no player at all.
  if (campaign?.currentMapId !== mapId) return stillInCampaign(recipients, campaignId).filter((r) => r.role === 'GM');
  const playerIds = recipients.filter((r) => r.role !== 'GM' && r.userId).map((r) => r.userId as string);
  const spiritVisibility = await getSpiritVisibilityBatch(campaignId, playerIds);
  return stillInCampaign(recipients, campaignId).filter((r) => {
    if (r.role === 'GM') return true;
    if (!r.userId) return false;
    return filterTokensByRole([token], r.role ?? 'PLAYER', spiritVisibility.get(r.userId) ?? false, r.userId).length > 0;
  });
}

/**
 * A player's or a spectator's copy of the table map's tokens, with a token's
 * character named only where the map sends them that token (tokensSentTo,
 * which the map's own copy asks too): on a lit map, one in their sight, and
 * on any other map, every one the role filter keeps. The order still lists
 * a combatant out of their sight, so its name and picture stay; its
 * character goes, so the order tells them no more than the map does.
 */
function tokensForOrder(map: MapTokenSight | undefined, role: string, spiritVisible: boolean, userId: string): CombatantSource[] {
  if (!map) return [];
  const forRole = filterTokensByRole(readTokens(map.tokens), role, spiritVisible, userId);
  const sent = new Set(tokensSentTo(map, role, spiritVisible, userId).map((t) => t.id));
  return forRole.map((t) => (sent.has(t.id) ? t : { ...t, characterId: null }));
}

/**
 * Send the order to the given sockets, or to every socket in the campaign,
 * each as they may see it. The combatants' tokens are read as they are now,
 * so a name, picture or hit points the GM changes follow the token, and a
 * player's copy goes through the same role filter as the map itself: a hidden
 * token's entry, one on a map the campaign is not showing, and hit points
 * behind a bar the GM keeps off, never reach them, nor the character of a
 * combatant the map does not send them (tokensForOrder). The stored state is the GM's view and is not changed.
 */
export async function sendInitiativeState(io: Server, campaignId: string, only?: Recipient[]): Promise<void> {
  const state = getCombatState(campaignId);
  const version = getVersion(campaignId);
  // A send to everyone is numbered; a reply to one socket takes the number
  // of the last send to everyone.
  const sendNumber = only ? latestSend(campaignId) : startSend(campaignId);
  // A change that lands while this send is still reading starts its own
  // send with the newer state or tokens; this one would arrive after it and
  // show the older, so it is dropped instead. Checked before every emit.
  const overtaken = () => getVersion(campaignId) !== version || latestSend(campaignId) !== sendNumber;
  const recipients: Recipient[] = only ?? (await campaignSockets(io, campaignId)).map((s) => s as unknown as Recipient);
  if (recipients.length === 0 || overtaken()) return;

  // Nothing in the order means nothing to look up: every client asks for
  // the state when it opens a campaign, and a reply that costs several
  // queries for an empty list was the most expensive request a member could
  // repeat.
  if (state.combatants.length === 0) {
    const nothing = new Map<string, CombatantSource>();
    for (const r of stillInCampaign(recipients, campaignId)) {
      r.emit('initiative.state', projectCombatState(state, nothing, r.role === 'GM'));
    }
    return;
  }

  const mapIds = [...new Set(state.combatants.map((c) => c.mapId))];
  const [maps, campaign] = await Promise.all([
    prisma.map.findMany({
      where: { id: { in: mapIds }, campaignId },
      select: { id: true, tokens: true, lightingEnabled: true, globalIllumination: true, wallSegments: true, lights: true, ...GRID_FRAME_SELECT },
    }),
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { currentMapId: true } }),
  ]);
  const tokens = maps.flatMap((m) => readTokens(m.tokens));
  // A player is sent the map the campaign is showing and no other, so the
  // order names for them only what stands on it. A combatant on a prepared
  // map, added there or moved there mid-fight, stays the GM's.
  const shown = maps.find((m) => m.id === campaign?.currentMapId);
  const playerIds = recipients.filter((r) => r.role !== 'GM' && r.userId).map((r) => r.userId as string);
  const spiritVisibility = await getSpiritVisibilityBatch(campaignId, playerIds);
  if (overtaken()) return;
  const byId = (list: CombatantSource[]) => new Map(list.map((t) => [t.id, t]));

  const forGM = byId(tokens);
  for (const r of stillInCampaign(recipients, campaignId)) {
    if (r.role === 'GM') {
      r.emit('initiative.state', projectCombatState(state, forGM, true));
      continue;
    }
    if (!r.userId) continue;
    const forRole = tokensForOrder(shown, r.role ?? 'PLAYER', spiritVisibility.get(r.userId) ?? false, r.userId);
    r.emit('initiative.state', projectCombatState(state, byId(forRole), false));
  }
}

/**
 * Send the order again after something changed, and never let that fail the
 * change: the state or the token is already saved by the time this runs, so
 * a database blip here used to tell the GM "Failed to add to initiative"
 * for an addition that had been made, and a retry was refused as a
 * duplicate. The next change, or a client's request on reconnect, catches
 * everyone up.
 */
export async function resendInitiativeState(io: Server, campaignId: string): Promise<void> {
  try {
    await sendInitiativeState(io, campaignId);
  } catch (error) {
    logger.warn('initiative.state fan-out failed; the change stands', { err: error, campaignId });
  }
}

/**
 * The same from a REST route, which has no socket server in hand. A member's
 * copy of the order depends on their plane, their role and each token, so
 * the routes that change any of those call this. Skipped while nothing is in
 * the order, unless told otherwise (a deletion that emptied it still has to
 * be sent).
 */
export async function resendInitiative(campaignId: string, options: { evenWhenEmpty?: boolean } = {}): Promise<void> {
  if (!options.evenWhenEmpty && getCombatState(campaignId).combatants.length === 0) return;
  let io: Server;
  try {
    io = getSocketInstance();
  } catch {
    return;
  }
  await resendInitiativeState(io, campaignId);
}

/**
 * Store a token's initiative on its map, in the list as it is under the map's
 * lock like every other write to a map's tokens. A token no longer on the
 * map is left alone, and the answer is false.
 */
async function setTokenInitiative(mapId: string, tokenId: string, value: number | null): Promise<boolean> {
  return withMapsLocked([mapId], async (tx) => {
    const fresh = await tx.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } });
    const tokens = readTokens(fresh.tokens);
    const index = tokens.findIndex((t) => t.id === tokenId);
    if (index === -1) return false;
    tokens[index] = { ...tokens[index], initiative: value };
    await tx.map.update({ where: { id: mapId }, data: { tokens: toJson(tokens) } });
    return true;
  });
}

/**
 * Whether every member who is not a GM is sent `token`, online or not: it
 * stands on the map the table is showing, and the role filter keeps it for
 * each of them (visible, on their plane). A roll for a token some player is
 * not sent is stored and sent as a secret roll.
 */
async function sentToEveryPlayer(campaignId: string, token: ReturnType<typeof readTokens>[number], mapId: string): Promise<boolean> {
  const [campaign, members] = await Promise.all([
    prisma.campaign.findUnique({ where: { id: campaignId }, select: { currentMapId: true } }),
    prisma.campaignMembership.findMany({ where: { campaignId, role: { not: 'GM' } }, select: { userId: true, role: true } }),
  ]);
  if (campaign?.currentMapId !== mapId) return false;
  const spiritVisibility = await getSpiritVisibilityBatch(campaignId, members.map((m) => m.userId));
  return members.every((m) => filterTokensByRole([token], m.role, spiritVisibility.get(m.userId) ?? false, m.userId).length > 0);
}

/** Who acts on the order: the GM over REST or a member's socket. */
export interface InitiativeActor {
  campaignId: string;
  userId: string;
  role: string | undefined;
}

/** A refusal carries the socket's error message; status is what REST answers with it. */
export type InitiativeOutcome<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const refuse = (status: 400 | 403 | 404 | 409, error: string) => ({ ok: false as const, status, error });

/** Send the order to every member, each as they may see it, after a change. */
async function broadcastInitiativeState(io: Server, campaignId: string) {
  await resendInitiativeState(io, campaignId);
}

/**
 * The order as a GM sees it, with each combatant's token as it is now, for
 * REST to answer with. Built as sendInitiativeState builds the GM's copy,
 * without sending anything.
 */
export async function initiativeForGM(campaignId: string): Promise<CombatState> {
  const state = getCombatState(campaignId);
  if (state.combatants.length === 0) return projectCombatState(state, new Map(), true);
  const maps = await prisma.map.findMany({
    where: { id: { in: [...new Set(state.combatants.map((c) => c.mapId))] }, campaignId },
    select: { tokens: true },
  });
  const tokens = maps.flatMap((m) => readTokens(m.tokens));
  return projectCombatState(state, new Map<string, CombatantSource>(tokens.map((t) => [t.id, t])), true);
}

/** Add a token to the combatant list. */
export async function addCombatant(io: Server, actor: InitiativeActor, data: { tokenId: string; mapId: string }): Promise<InitiativeOutcome> {
  const { tokenId, mapId } = data;
  if (!tokenId || !mapId) return refuse(400, 'tokenId and mapId required');

  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map || map.campaignId !== actor.campaignId) return refuse(404, 'Map not found');

  const tokens = readTokens(map.tokens);
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) return refuse(404, 'Token not found');

  const state = getCombatState(actor.campaignId);

  // Idempotent — don't add duplicates
  if (state.combatants.some((c) => c.tokenId === tokenId)) return refuse(409, 'Token is already in initiative');

  const entry: CombatantEntry = {
    tokenId,
    mapId,
    name: token.name,
    imageUrl: token.imageUrl || '',
    // Always null, never `token.initiative`.
    //
    // A rolled value is persisted onto the map token, and ending combat
    // clears only the in-memory order — so the number outlives the fight it
    // was rolled for. Seeding from it meant a token joining a *new* fight
    // arrived carrying its result from the last one, already placed in the
    // order before anyone had rolled.
    //
    // Joining the order and having a place in it are separate steps: a
    // combatant sorts to the bottom as "—" until something rolls for it.
    initiative: null,
    hp: token.hp ?? null,
    type: token.type ?? 'npc',
    disposition: token.disposition ?? null,
    characterId: token.characterId ?? null,
  };

  state.combatants = sortCombatants([...state.combatants, entry]);
  setCombatState(actor.campaignId, state);
  await broadcastInitiativeState(io, actor.campaignId);
  logger.debug('initiative.add', { name: token.name, campaignId: actor.campaignId });
  return { ok: true };
}

/** Remove a token from the combatant list; `removed` is false when it was not in it. */
export async function removeCombatant(io: Server, actor: InitiativeActor, data: { tokenId: string }): Promise<InitiativeOutcome<{ removed: boolean }>> {
  const { tokenId } = data;
  if (!tokenId) return refuse(400, 'tokenId required');

  // The turn passes on, and an emptied order ends the fight, as when a
  // combatant's token is deleted (withoutCombatants).
  const next = withoutCombatants(getCombatState(actor.campaignId), (c) => c.tokenId === tokenId);
  if (next) setCombatState(actor.campaignId, next);
  await broadcastInitiativeState(io, actor.campaignId);
  return { ok: true, removed: next !== null };
}

/** Set a token's initiative value by hand, on its map and in the order. */
export async function setInitiative(
  io: Server,
  actor: InitiativeActor,
  data: { tokenId: string; mapId: string; value: number | null },
): Promise<InitiativeOutcome> {
  const { tokenId, mapId, value } = data;
  if (!tokenId || !mapId) return refuse(400, 'tokenId and mapId required');
  if (value !== null && typeof value !== 'number') return refuse(400, 'value must be a number or null');

  // Persist to DB token record
  const map = await prisma.map.findUnique({ where: { id: mapId } });
  if (!map || map.campaignId !== actor.campaignId) return refuse(404, 'Map not found');

  await setTokenInitiative(mapId, tokenId, value);

  // Update in-memory combat state
  const state = getCombatState(actor.campaignId);
  const combatantIndex = state.combatants.findIndex((c) => c.tokenId === tokenId);
  if (combatantIndex !== -1) {
    state.combatants[combatantIndex].initiative = value;
    state.combatants = sortCombatants(state.combatants);
    setCombatState(actor.campaignId, state);
  }

  await broadcastInitiativeState(io, actor.campaignId);
  logger.debug('initiative.set', { tokenId, value, campaignId: actor.campaignId });
  return { ok: true };
}

/**
 * A player's check before their roll, run where the roll has read the token
 * and the order and before it awaits anything more: the refusal to send, or
 * null to go on. The socket handler supplies it; a GM's roll has none.
 */
export type PlayerRollGate = (
  token: ReturnType<typeof readTokens>[number],
  existingIndex: number,
  state: CombatState,
) => string | null;

/**
 * Roll initiative for a token. The GM may roll for anything on the map; any
 * other role only through `playerGate`, which decides whether they may. The
 * server works out what is rolled; a client's `expression` is a fallback
 * used for the GM alone.
 */
export async function rollInitiative(
  io: Server,
  actor: InitiativeActor,
  data: { tokenId: string; mapId: string; expression?: unknown },
  playerGate: PlayerRollGate | null,
): Promise<InitiativeOutcome<{ value: number; rolled: boolean }>> {
  const { tokenId, mapId, expression } = data;
  if (!tokenId || !mapId) return refuse(400, 'tokenId and mapId required');
  if (expression !== undefined && typeof expression !== 'string') {
    return refuse(400, 'Invalid expression: it must be text, like 1d20+2');
  }

  // `expression` is now only a fallback for combatants the server cannot
  // work initiative out for itself — see the resolution below. Validate it
  // when one is sent, since it still reaches the dice roller in that case.
  if (expression !== undefined) {
    try { parseDiceExpression(expression); } catch (err) {
      if (err instanceof DiceParserError) return refuse(400, `Invalid expression: ${err.message}`);
      throw err;
    }
  }

  // Fetch token name from DB for logging, with the campaign's current map:
  // a prepared map is the GM's until they switch to it (canReadMap).
  const map = await prisma.map.findUnique({ where: { id: mapId }, include: { campaign: { select: { currentMapId: true } } } });
  if (!map || map.campaignId !== actor.campaignId || !canReadMap(actor.role, mapId, map.campaign.currentMapId)) {
    return refuse(404, 'Map not found');
  }

  const tokens = readTokens(map.tokens);
  const tokenIndex = tokens.findIndex((t) => t.id === tokenId);
  if (tokenIndex === -1) return refuse(404, 'Token not found');

  const token = tokens[tokenIndex];
  const state = getCombatState(actor.campaignId);
  const existingIndex = state.combatants.findIndex((c) => c.tokenId === tokenId);

  if (actor.role !== 'GM') {
    const refusal = playerGate ? playerGate(token, existingIndex, state) : 'Only the GM can roll initiative for any token';
    if (refusal) return refuse(403, refusal);
  }

  // Work out what initiative actually means for this combatant.
  //
  // The server decides, not the client. It has to: this is the only side
  // holding the character sheet, and Horror d100 has no initiative roll
  // at all — combatants are ranked by Dexterity — which a client-supplied
  // dice expression cannot express. Deciding here also means the tracker's
  // die and the map menu produce the same number by construction rather
  // than by both remembering to compute it the same way.
  let resolution = null as ReturnType<typeof resolveCharacterInitiative>;
  if (token.characterId) {
    // Only a character of this campaign. Character ids are visible to
    // every member of any shared campaign, and anyone can be the GM of a
    // campaign they create, so a token bound to someone else's character
    // must not read that sheet.
    const character = await prisma.character.findFirst({
      where: { id: token.characterId, campaignId: actor.campaignId },
      select: { gameSystem: true, data: true },
    });
    if (character) {
      // A sheet still in an older shape is read converted, nothing written.
      resolution = resolveCharacterInitiative(character.gameSystem, sheetAsRead(character.gameSystem, character.data));
    }
  }
  if (!resolution && token.statBlock) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: actor.campaignId },
      select: { gameSystem: true },
    });
    resolution = resolveStatBlockInitiative(campaign?.gameSystem ?? null, token.statBlock);
  }

  // Nothing system-specific applies (a flexible sheet, a bare NPC token).
  //
  // A client-supplied expression is honoured only for the GM, who can set
  // any initiative value by hand anyway so gains nothing by lying. A player
  // always gets the default: they may control a token with no sheet and no
  // stat block (a GM can assign one to them), and without this they could
  // send `1d20+9999` and hand themselves the top of the order.
  const fallbackExpression =
    actor.role === 'GM' && expression ? expression : DEFAULT_INITIATIVE_EXPRESSION;

  let rolledValue: number;
  let rollResult: ReturnType<typeof rollDice> | null = null;
  let usedExpression = '';

  if (resolution && resolution.kind === 'fixed') {
    // No dice. The value *is* the answer.
    rolledValue = resolution.value;
  } else {
    usedExpression = resolution ? resolution.expression : fallbackExpression;
    try {
      parseDiceExpression(usedExpression);
    } catch {
      // A derived expression that will not parse is a bug on our side, not
      // the caller's — fall back rather than failing the player's roll.
      logger.warn('initiative.roll derived an unparseable expression', {
        usedExpression, campaignId: actor.campaignId,
      });
      usedExpression = DEFAULT_INITIATIVE_EXPRESSION;
    }
    rollResult = rollDice(usedExpression);
    rolledValue = rollResult.total;
  }

  // Persist to token, in the list as it is under the map's lock: the
  // copy fetched before the character lookups above is stale by now. A
  // token deleted meanwhile is not rolled for at all: the GM's roll used
  // to add it to the order anyway.
  if (!(await setTokenInitiative(mapId, tokenId, rolledValue))) {
    if (actor.role !== 'GM') markPlayerRolled(actor.campaignId, tokenId, false);
    return refuse(404, 'Token not found');
  }

  // Update in-memory state — add to combatants if not already present.
  // Only for a GM, and only a token that was not in the order when the
  // roll began: a player's roll is rejected above unless the token is
  // already a combatant, and a combatant that has left the order since
  // stays out.
  //
  // The order as it is now, not the copy read before the awaits above:
  // a concurrent roll re-sorts it, a remove shortens it, and the GM may
  // have ended the fight, which writing the old copy back would undo.
  const current = getCombatState(actor.campaignId);
  const combatantIndex = current.combatants.findIndex((c) => c.tokenId === tokenId);
  if (combatantIndex !== -1) {
    current.combatants[combatantIndex].initiative = rolledValue;
    current.combatants = sortCombatants(current.combatants);
    setCombatState(actor.campaignId, current);
  } else if (actor.role === 'GM' && existingIndex === -1) {
    // The GM's roll adds a token that was not in the order when the roll
    // began. One that was, and is gone now, was removed meanwhile (or
    // the fight ended), and stays out.
    current.combatants.push({
      tokenId,
      mapId,
      name: token.name,
      imageUrl: token.imageUrl || '',
      initiative: rolledValue,
      hp: token.hp ?? null,
      type: token.type ?? 'npc',
      disposition: token.disposition ?? null,
      characterId: token.characterId ?? null,
    });
    current.combatants = sortCombatants(current.combatants);
    setCombatState(actor.campaignId, current);
  }

  // Store the roll in the dice history and announce it, but only when dice
  // were actually thrown. A Horror d100 character's initiative is
  // simply their Dexterity, and a dice-log entry claiming otherwise would
  // be a lie. The value still reaches everyone through the initiative
  // broadcast below.
  const campaignId = actor.campaignId;
  const roll = rollResult;
  // The roll is stored and ordered by now: a failure to write its dice
  // log entry is logged, and the new order below still goes out.
  if (roll) await bestEffort('initiative.roll dice log', async () => {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { displayName: true } });
    // The server names the token; a name the client sends is not used.
    // An obscured token is stored and sent under the placeholder, except
    // to the player who rolled for it, who knows it. So is one whose name
    // the GM hides (Mistwarden, 2026-11-27).
    const publicName = token.obscured === true || token.nameHidden === true ? 'Unknown creature' : token.name;
    // A token some player is not sent makes a secret roll: the roller
    // and the GM see it, in the history too.
    const secret = !(await sentToEveryPlayer(campaignId, token, mapId));
    const stored = await prisma.diceRoll.create({
      data: {
        campaignId,
        userId: actor.userId,
        expression: usedExpression,
        result: rolledValue,
        breakdown: toJson(roll),
        characterName: publicName,
        purpose: `${publicName} Initiative`,
        secret,
      },
    });
    const rollData = {
      id: stored.id,
      userId: actor.userId,
      userName: user?.displayName ?? 'GM',
      characterName: publicName,
      expression: usedExpression,
      result: rolledValue,
      breakdown: roll,
      purpose: `${publicName} Initiative`,
      timestamp: stored.rolledAt.toISOString(),
      secret,
    };
    const named = { ...rollData, characterName: token.name, purpose: `${token.name} Initiative` };
    const recipients = await recipientsSentToken(io, campaignId, token, mapId);
    for (const r of recipients) {
      const isRoller = r.userId === actor.userId;
      if (secret && !isRoller && r.role !== 'GM') continue;
      if (secret && !isRoller) {
        r.emit('dice.rolled.secret', { ...rollData, originalRoller: actor.userId, isAuditView: true });
      } else {
        r.emit('dice.rolled', isRoller ? named : rollData);
      }
    }
  });

  await broadcastInitiativeState(io, campaignId);
  logger.debug('initiative.roll', {
    rolled: !!rollResult, result: rolledValue, name: token.name, campaignId,
  });
  return { ok: true, value: rolledValue, rolled: !!rollResult };
}

/**
 * Put the combatants into the order `orderedTokenIds` gives; any it leaves
 * out keep their places after those it names, and an id that is not a
 * combatant is passed over.
 */
export async function reorderCombatants(io: Server, actor: InitiativeActor, data: { orderedTokenIds: string[] }): Promise<InitiativeOutcome> {
  const { orderedTokenIds } = data;
  if (!Array.isArray(orderedTokenIds)) return refuse(400, 'orderedTokenIds must be an array');

  const state = getCombatState(actor.campaignId);
  const combatantMap = new Map(state.combatants.map((c) => [c.tokenId, c]));
  const reordered: CombatantEntry[] = [];
  for (const id of orderedTokenIds) {
    const c = combatantMap.get(id);
    if (c) reordered.push(c);
  }
  // Keep any combatants not in the orderedTokenIds at the end
  for (const c of state.combatants) {
    if (!reordered.includes(c)) reordered.push(c);
  }
  state.combatants = reordered;
  setCombatState(actor.campaignId, state);
  await broadcastInitiativeState(io, actor.campaignId);
  return { ok: true };
}

/** Begin combat: round 1, the first combatant acting. */
export async function startCombat(io: Server, actor: InitiativeActor): Promise<InitiativeOutcome> {
  const state = getCombatState(actor.campaignId);
  if (state.combatants.length === 0) return refuse(409, 'Add combatants before starting combat');

  state.active = true;
  state.round = 1;
  state.currentTokenId = state.combatants[0].tokenId;
  setCombatState(actor.campaignId, state);
  await broadcastInitiativeState(io, actor.campaignId);
  logger.info('initiative.start', { campaignId: actor.campaignId, first: state.combatants[0].name });
  return { ok: true };
}

/** Pass the turn to the next combatant, or round to the top of the order in a new round. */
export async function nextTurn(io: Server, actor: InitiativeActor): Promise<InitiativeOutcome> {
  const state = getCombatState(actor.campaignId);
  if (!state.active || state.combatants.length === 0) return refuse(409, 'Combat is not active');

  const currentIndex = state.combatants.findIndex((c) => c.tokenId === state.currentTokenId);
  const nextIndex = currentIndex + 1;

  if (nextIndex >= state.combatants.length) {
    // Wrap around — new round
    state.round += 1;
    state.currentTokenId = state.combatants[0].tokenId;
  } else {
    state.currentTokenId = state.combatants[nextIndex].tokenId;
  }

  setCombatState(actor.campaignId, state);
  await broadcastInitiativeState(io, actor.campaignId);
  logger.debug('initiative.next', { round: state.round, current: state.currentTokenId, campaignId: actor.campaignId });
  return { ok: true };
}

/** End combat and clear the order. */
export async function endCombat(io: Server, actor: InitiativeActor): Promise<InitiativeOutcome> {
  clearCombatState(actor.campaignId);
  await broadcastInitiativeState(io, actor.campaignId);
  logger.info('initiative.end', { campaignId: actor.campaignId });
  return { ok: true };
}
