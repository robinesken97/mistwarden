/**
 * A dice roll: checked, rolled, stored and sent, for the socket's dice.roll
 * and REST alike.
 *
 * A roll for everyone goes to every member. A secret roll goes to the roller
 * and, as an audit copy (`dice.rolled.secret`), to every other GM; never to
 * a player. Over the socket the roller's copy goes to the socket that rolled;
 * over REST, which has none, to the roller's sockets in this campaign.
 */

import type { Server } from 'socket.io';
import { prisma } from '../config/database';
import { rollDice, parseDiceExpression, DiceParserError, type RollResult } from '../utils/dice-parser';
import { toJson } from '../utils/prisma-json';
import { canRollDice } from './permissions';
import { campaignSockets } from '../websocket/utils';
import type { AuthenticatedSocket } from '../websocket/auth';
import { DiceRollSchema } from '../validators/dice';

export interface DiceRoller {
  campaignId: string;
  userId: string;
  role: string | undefined;
}

/** A roll as `dice.rolled` sends it. */
export interface RollSent {
  id: string;
  userId: string;
  userName: string;
  characterName: string | null;
  expression: string;
  result: number;
  breakdown: RollResult;
  purpose: string | null;
  timestamp: string;
  secret: boolean;
}

export type DiceOutcome =
  | { ok: true; roll: RollSent }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Roll `data` (a DiceRollSchema payload) for `roller`. `rollerSocket` is the
 * socket that asked, which alone is sent the roller's copy of a secret roll.
 */
export async function rollForMember(
  io: Server,
  roller: DiceRoller,
  data: unknown,
  rollerSocket?: { emit(event: string, data: unknown): unknown },
): Promise<DiceOutcome> {
  // Spectators watch: they may talk in chat, and they may not roll.
  if (!canRollDice(roller.role)) {
    return { ok: false, status: 403, error: 'Spectators cannot roll dice' };
  }

  // The labels are stored with the roll and sent to every member, so
  // they are bounded here (validators/dice.ts).
  const parsed = DiceRollSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Dice expression required' };
  }
  const { expression, characterName, purpose, secret } = parsed.data;

  // Validate expression syntax (without rolling)
  try {
    parseDiceExpression(expression);
  } catch (error) {
    if (error instanceof DiceParserError) {
      return { ok: false, status: 400, error: `Invalid dice expression: ${error.message}` };
    }
    throw error;
  }

  const rollResult = rollDice(expression);

  const user = await prisma.user.findUnique({
    where: { id: roller.userId },
    select: { displayName: true },
  });
  if (!user) return { ok: false, status: 404, error: 'User not found' };

  // SECURITY: Save ALL rolls to database (including secret rolls for audit)
  // Secret rolls are marked but still saved for GM oversight and dispute resolution
  const diceRoll = await prisma.diceRoll.create({
    data: {
      campaignId: roller.campaignId,
      userId: roller.userId,
      expression,
      result: rollResult.total,
      breakdown: toJson(rollResult), // Store full RollResult
      characterName: characterName || null,
      purpose: purpose || null,
      secret: secret || false, // Mark as secret for visibility filtering
    },
  });

  // A roll is not a chat message, and no second row is written for it.
  //
  // One used to be: a Message of type DICE_ROLL whose metadata repeated the
  // expression, result, breakdown, character name, purpose and secret flag
  // that the DiceRoll row above already holds. Nothing ever read it — the
  // chat panel does not listen for rolls, and the history endpoint filters
  // the type out — so the rows accumulated with no way to reach or clear
  // them, and their presence starved the chat page they were filtered from.
  //
  // The copy was also the unsafe one: `secret` lived only inside unindexed
  // metadata, where the chat query does not filter on it. The DiceRoll table
  // is the record, with `secret` as a real column and a clear-history
  // watermark. Rolls are read from there, by the Dice panel.

  // `id` and the stored `rolledAt` are sent rather than a freshly generated
  // timestamp so that a roll arriving live and the same roll replayed from
  // history identify as one entry. Without the id the client keyed rolls by
  // user and broadcast time, which no stored roll could ever match.
  const rollData: RollSent = {
    id: diceRoll.id,
    userId: roller.userId,
    userName: user.displayName,
    characterName: characterName || null,
    expression,
    result: rollResult.total,
    breakdown: rollResult,
    purpose: purpose || null,
    timestamp: diceRoll.rolledAt.toISOString(),
    secret: secret || false,
  };

  if (secret) {
    // Secret roll - send to roller (always)
    rollerSocket?.emit('dice.rolled', rollData);

    // SECURITY: Also send to GM(s) for audit/oversight
    // Follows Spirit Layer pattern: GMs see everything, players see filtered
    for (const s of await campaignSockets(io, roller.campaignId)) {
      const authedSocket = s as unknown as AuthenticatedSocket;
      if (authedSocket.userId === roller.userId) {
        // Without a rolling socket (REST), the roller's own pages here.
        if (!rollerSocket) s.emit('dice.rolled', rollData);
      } else if (authedSocket.role === 'GM') {
        // Send to GMs only (excluding the original roller if they're GM)
        s.emit('dice.rolled.secret', {
          ...rollData,
          originalRoller: roller.userId,
          isAuditView: true, // Flag so GM UI can style differently
        });
      }
    }
  } else {
    // Normal roll - broadcast to all campaign members
    io.to(roller.campaignId).emit('dice.rolled', rollData);
  }
  return { ok: true, roll: rollData };
}
