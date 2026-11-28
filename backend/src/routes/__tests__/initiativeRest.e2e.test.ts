/**
 * The initiative tracker over REST acts on the order the socket acts on.
 *
 * The GM's tracker controls were socket events only, so a script or the MCP
 * bridge, which hold no socket, could not run a fight. Each route calls what
 * its socket event calls, on the same order in memory: a turn passed over
 * REST and one passed over the socket follow each other, and every member
 * is sent `initiative.state` as they may see it, a hidden combatant left out
 * for a player. A player is refused every route.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, cleanupCampaigns, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { createWsTestServer, waitForEvent, expectNoEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson } from '../../utils/prisma-json';
import { clearState } from '../../websocket/initiativeState';
import type { CombatState } from '../../websocket/initiativeState';

jest.setTimeout(60000);

const app = createTestApp();
const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let campaignId: string;
let mapId: string;
const ids = { gm: '', p1: '', p2: '' };
const cookies = { gm: '', p1: '', p2: '' };
let gmRest: ReturnType<typeof request.agent>;
let playerRest: ReturnType<typeof request.agent>;
let gm: ClientSocket;
let p1: ClientSocket;
let p2: ClientSocket;

const GOBLIN = randomUUID();
const HERO = randomUUID();
const LURKER = randomUUID();

const base = () => `/api/campaigns/${campaignId}/initiative`;
const token = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, imageUrl: '', position: { x: 1, y: 1 }, size: { width: 1, height: 1 }, layer: 'token',
  visible: true, controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...extra,
});
const order = (state: CombatState) => state.combatants.map((c) => c.tokenId);

/** The first `initiative.state` this client is sent that `match` accepts; sends a newer one overtakes are dropped, so none is counted. */
function stateWhere(client: ClientSocket, match: (state: CombatState) => boolean, timeoutMs = 3000): Promise<CombatState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('initiative.state', listener);
      reject(new Error('no matching initiative.state'));
    }, timeoutMs);
    const listener = (state: CombatState) => {
      if (!match(state)) return;
      clearTimeout(timer);
      client.off('initiative.state', listener);
      resolve(state);
    };
    client.on('initiative.state', listener);
  });
}

/** The three combatants in the order Goblin 15, Lurker 10, Hero 5, added and set over REST. */
async function threeCombatants(): Promise<void> {
  for (const tokenId of [GOBLIN, HERO, LURKER]) {
    expect((await gmRest.post(`${base()}/combatants`).send({ tokenId, mapId })).status).toBe(201);
  }
  for (const [tokenId, value] of [[GOBLIN, 15], [LURKER, 10], [HERO, 5]] as const) {
    expect((await gmRest.put(`${base()}/combatants/${tokenId}`).send({ value })).status).toBe(200);
  }
}

beforeAll(async () => {
  const users = await Promise.all(
    (['gm', 'p1', 'p2'] as const).map((who) => createTestUser({ email: `rest-init-${who}-${runId}@test.cozyvtt.local`, displayName: `Init ${who}` }))
  );
  [ids.gm, ids.p1, ids.p2] = users.map((u) => u.id);
  campaignId = (await prisma.campaign.create({ data: { name: `REST initiative ${runId}`, ownerId: ids.gm, status: 'ACTIVE', vibeSettings: {} } })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: ids.gm, campaignId, role: 'GM', characterIds: [] },
      { userId: ids.p1, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: ids.p2, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  mapId = (await prisma.map.create({
    data: {
      campaignId, name: 'Shown', imageUrl: '', baseLayerUrl: '', width: 10, height: 10, gridSize: 50, annotations: [],
      tokens: toJson([
        token(GOBLIN, 'Goblin'),
        token(HERO, 'Hero', { type: 'player', controlledBy: ids.p1 }),
        token(LURKER, 'Lurker', { visible: false }),
      ]),
    },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });

  gmRest = request.agent(app);
  expect((await gmRest.post('/api/auth/login').send({ email: users[0].email, password: TEST_PASSWORD })).status).toBe(200);
  playerRest = request.agent(app);
  expect((await playerRest.post('/api/auth/login').send({ email: users[1].email, password: TEST_PASSWORD })).status).toBe(200);

  server = await createWsTestServer();
  for (const who of ['gm', 'p1', 'p2'] as const) cookies[who] = await server.loginAs(ids[who]);
});

beforeEach(async () => {
  clearState(campaignId);
  [gm, p1, p2] = await Promise.all((['gm', 'p1', 'p2'] as const).map((who) => server.connectAndAuth(cookies[who], campaignId)));
});

afterEach(() => {
  [gm, p1, p2].forEach((c) => c.disconnect());
});

afterAll(async () => {
  clearState(campaignId);
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.diceRoll.deleteMany({ where: { campaignId } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await cleanupCampaigns([campaignId]);
  await cleanupUsers(Object.values(ids));
  await prisma.$disconnect();
});

it('refuses a player every route with 403', async () => {
  const sent = [
    playerRest.get(base()),
    playerRest.post(`${base()}/start`),
    playerRest.post(`${base()}/next`),
    playerRest.post(`${base()}/end`),
    playerRest.post(`${base()}/combatants`).send({ tokenId: HERO, mapId }),
    playerRest.delete(`${base()}/combatants/${HERO}`),
    playerRest.put(`${base()}/combatants/${HERO}`).send({ value: 20 }),
    playerRest.post(`${base()}/roll`).send({ tokenId: HERO, mapId }),
    playerRest.put(`${base()}/order`).send({ tokenIds: [HERO] }),
  ];
  for (const res of await Promise.all(sent)) expect(res.status).toBe(403);
});

it('answers a body, map, token or fight it cannot act on as the socket refuses it', async () => {
  const missing = await gmRest.post(`${base()}/combatants`).send({ tokenId: GOBLIN });
  expect(missing.status).toBe(400);
  expect(missing.body.message).toBe('tokenId and mapId required');
  const noMap = await gmRest.post(`${base()}/combatants`).send({ tokenId: GOBLIN, mapId: randomUUID() });
  expect([noMap.status, noMap.body.message]).toEqual([404, 'Map not found']);
  const noToken = await gmRest.post(`${base()}/combatants`).send({ tokenId: randomUUID(), mapId });
  expect([noToken.status, noToken.body.message]).toEqual([404, 'Token not found']);

  expect((await gmRest.post(`${base()}/start`)).body.message).toBe('Add combatants before starting combat');
  expect((await gmRest.post(`${base()}/next`)).status).toBe(409);
  expect((await gmRest.delete(`${base()}/combatants/${GOBLIN}`)).status).toBe(404);
  expect((await gmRest.put(`${base()}/combatants/${GOBLIN}`).send({ value: 3 })).status).toBe(404);

  expect((await gmRest.post(`${base()}/combatants`).send({ tokenId: GOBLIN, mapId })).status).toBe(201);
  const twice = await gmRest.post(`${base()}/combatants`).send({ tokenId: GOBLIN, mapId });
  expect([twice.status, twice.body.message]).toEqual([409, 'Token is already in initiative']);
  const badValue = await gmRest.put(`${base()}/combatants/${GOBLIN}`).send({ value: 'high' });
  expect([badValue.status, badValue.body.message]).toEqual([400, 'value must be a number or null']);
  const badOrder = await gmRest.put(`${base()}/order`).send({ tokenIds: GOBLIN });
  expect(badOrder.status).toBe(400);
  const badRoll = await gmRest.post(`${base()}/roll`).send({ tokenId: GOBLIN, mapId, expression: 'banana' });
  expect(badRoll.status).toBe(400);
  expect(badRoll.body.message).toMatch(/^Invalid expression: /);
});

it('runs a fight over REST that every socket follows, a hidden combatant left out for the players', async () => {
  await threeCombatants();

  const gmSees = stateWhere(gm, (s) => s.active && s.currentTokenId === GOBLIN);
  const playersSee = [p1, p2].map((c) => stateWhere(c, (s) => s.active && s.currentTokenId === GOBLIN));
  const started = await gmRest.post(`${base()}/start`);
  expect(started.status).toBe(200);
  expect(started.body.state).toMatchObject({ active: true, round: 1, currentTokenId: GOBLIN });
  expect(order(started.body.state)).toEqual([GOBLIN, LURKER, HERO]);
  expect(await gmSees).toEqual(started.body.state);
  for (const seen of await Promise.all(playersSee)) expect(order(seen)).toEqual([GOBLIN, HERO]);

  // The hidden combatant's turn: the GM sees it, a player sees no one acting.
  const playerOnLurker = stateWhere(p1, (s) => s.active && s.currentTokenId === null);
  const toLurker = await gmRest.post(`${base()}/next`);
  expect(toLurker.body.state.currentTokenId).toBe(LURKER);
  expect(order(await playerOnLurker)).toEqual([GOBLIN, HERO]);

  const p2OnHero = stateWhere(p2, (s) => s.currentTokenId === HERO);
  expect((await gmRest.post(`${base()}/next`)).body.state.currentTokenId).toBe(HERO);
  await p2OnHero;

  const wrapped = await gmRest.post(`${base()}/next`);
  expect(wrapped.body.state).toMatchObject({ round: 2, currentTokenId: GOBLIN });

  const p1Ended = stateWhere(p1, (s) => !s.active && s.combatants.length === 0);
  const ended = await gmRest.post(`${base()}/end`);
  expect(ended.body.state).toEqual({ active: false, round: 0, currentTokenId: null, combatants: [] });
  await p1Ended;
  expect((await gmRest.get(base())).body.state).toEqual(ended.body.state);
});

it('sends the state a REST change starts in the shape the socket sends it', async () => {
  await threeCombatants();
  // The reply, not a send from the setup still on its way.
  const bySocket = stateWhere(p1, (s) => s.combatants.length === 2 && s.combatants.every((c) => c.initiative !== null));
  p1.emit('initiative.request_state');
  const socketCopy = await bySocket;

  const byRest = stateWhere(p1, (s) => s.active);
  await gmRest.post(`${base()}/start`);
  const restCopy = await byRest;
  expect(Object.keys(restCopy).sort()).toEqual(Object.keys(socketCopy).sort());
  expect(Object.keys(restCopy.combatants[0]).sort()).toEqual(Object.keys(socketCopy.combatants[0]).sort());
  expect(restCopy.combatants).toEqual(socketCopy.combatants);
});

it('passes turns in sequence whether REST or the socket passes them', async () => {
  await threeCombatants();
  await gmRest.post(`${base()}/start`);

  expect((await gmRest.post(`${base()}/next`)).body.state.currentTokenId).toBe(LURKER);
  const socketNext = stateWhere(gm, (s) => s.currentTokenId === HERO);
  gm.emit('initiative.next');
  await socketNext;
  expect((await gmRest.post(`${base()}/next`)).body.state).toMatchObject({ round: 2, currentTokenId: GOBLIN });

  // Sent at once: each moves the turn one on, whichever lands first.
  const bothDone = stateWhere(p1, (s) => s.round === 2 && s.currentTokenId === HERO);
  gm.emit('initiative.next');
  const rest = await gmRest.post(`${base()}/next`);
  expect(rest.status).toBe(200);
  await bothDone;
  expect((await gmRest.get(base())).body.state).toMatchObject({ round: 2, currentTokenId: HERO });
});

it('reorders and rolls over REST, a roll for a hidden token reaching no player', async () => {
  await threeCombatants();
  const reordered = await gmRest.put(`${base()}/order`).send({ tokenIds: [HERO, GOBLIN] });
  expect(order(reordered.body.state)).toEqual([HERO, GOBLIN, LURKER]);

  const playerRoll = waitForEvent<Record<string, unknown>>(p1, 'dice.rolled');
  const rolled = await gmRest.post(`${base()}/roll`).send({ tokenId: GOBLIN, mapId, expression: '1d4+100' });
  expect(rolled.status).toBe(200);
  expect(rolled.body).toMatchObject({ rolled: true });
  expect(rolled.body.value).toBeGreaterThanOrEqual(101);
  expect(order(rolled.body.state)[0]).toBe(GOBLIN);
  expect(await playerRoll).toMatchObject({ characterName: 'Goblin', result: rolled.body.value, secret: false });

  const unseen = [expectNoEvent(p1, 'dice.rolled'), expectNoEvent(p2, 'dice.rolled')];
  const gmRoll = waitForEvent<Record<string, unknown>>(gm, 'dice.rolled');
  const hidden = await gmRest.post(`${base()}/roll`).send({ tokenId: LURKER, mapId });
  expect(hidden.status).toBe(200);
  expect(await gmRoll).toMatchObject({ characterName: 'Lurker', secret: true });
  await Promise.all(unseen);
});
