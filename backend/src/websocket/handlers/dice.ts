// ============================================
// Dice handlers: dice.roll, dice.clearHistory
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { prisma } from '../../config/database';
import { DiceParserError } from '../../utils/dice-parser';
import logger from '../../utils/logger';
import { withinCeiling } from '../shared';
import { rollForMember } from '../../services/dice';
import { ackFrom, refuseRequest } from '../ack';

export function registerDiceHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * DICE.ROLL - User rolls dice
   * Validates expression, calculates result, saves to database, and broadcasts.
   * Under the per-user dice ceiling (SOCKET_CEILINGS). Answered through the
   * acknowledgement when one is passed (see ../ack.ts).
   * SECURITY: Uses server-authenticated socket.campaignId only.
   */
  socket.on('dice.roll', async (data: unknown, ackArg?: unknown) => {
    const ack = ackFrom(ackArg);
    const refuse = (message: string) => refuseRequest(socket, ack, message);
    try {
      if (!socket.campaignId) {
        refuse('Not authenticated to a campaign');
        return;
      }

      // Counted before anything else is checked, so a flood of rolls that
      // would be refused (malformed, or from a spectator) is held to the
      // same ceiling and does not draw an error apiece.
      if (!withinCeiling(socket, 'dice.roll', ack)) return;

      // Spectators, the payload and the expression are checked in the
      // service (services/dice.ts), which the REST route shares.
      const outcome = await rollForMember(io, { campaignId: socket.campaignId, userId: socket.userId!, role: socket.role }, data, socket);
      if (!outcome.ok) {
        refuse(outcome.error);
        return;
      }
      const { expression, result, secret } = outcome.roll;
      ack?.({ ok: true, id: outcome.roll.id });

      logger.debug('dice.roll', { expression, result, userId: socket.userId, secret, campaignId: socket.campaignId });
    } catch (error) {
      logger.error('dice.roll failed', { err: error });
      refuse(error instanceof DiceParserError ? `Dice roll failed: ${error.message}` : 'Failed to roll dice');
    }
  });

  /**
   * DICE.CLEAR_HISTORY - GM clears dice roll history (GM-only).
   */
  socket.on('dice.clearHistory', async (ackArg?: unknown) => {
    const ack = ackFrom(ackArg);
    const refuse = (message: string) => refuseRequest(socket, ack, message);
    try {
      if (!socket.campaignId) {
        refuse('Not authenticated to a campaign');
        return;
      }
      if (!withinCeiling(socket, 'dice.clearHistory', ack)) return;

      // Who is running the game, not who owns the campaign. These are separate
      // facts — `Campaign.ownerId` never moves, while the GM seat can — and they
      // only coincide in a campaign whose creator still runs it. Reading
      // ownership here refused the actual GM after a handover and let the former
      // GM, now a player, keep clearing the panel for everyone.
      if (socket.role !== 'GM') {
        refuse('Only the GM can clear roll history');
        return;
      }

      // Record the clear so it survives a reload. This used to be broadcast
      // only, which was invisible while history lived in browser memory — but
      // now that the panel loads from the database, a clear that changed
      // nothing server-side would undo itself on the next refresh.
      //
      // A watermark, not a delete: secret rolls are stored deliberately for
      // audit, and clearing the panel should not destroy that record.
      await prisma.campaign.update({
        where: { id: socket.campaignId },
        data: { rollHistoryClearedAt: new Date() },
      });

      // Broadcast to all campaign members (including GM)
      io.to(socket.campaignId).emit('dice.historyCleared');
      ack?.({ ok: true });

      logger.info('dice.clearHistory', { campaignId: socket.campaignId, userId: socket.userId });
    } catch (error) {
      logger.error('dice.clearHistory failed', { err: error });
      refuse('Failed to clear dice history');
    }
  });
}
