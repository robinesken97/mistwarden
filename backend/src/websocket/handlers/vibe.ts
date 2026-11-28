// ============================================
// Vibe tracker handler: vibe.update
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { switchVibe } from '../../services/vibeSave';
import { withinCeiling } from '../shared';
import logger from '../../utils/logger';

export function registerVibeHandlers(io: Server, socket: AuthenticatedSocket): void {
  /**
   * VIBE.UPDATE - GM changes the current vibe period and its audio follows.
   * Updates campaign.currentVibe, broadcasts period data to all members, and
   * sets the period's track as the table's ambient audio (none means silence)
   * (services/vibeSave.ts switchVibe, shared with REST).
   */
  socket.on('vibe.update', async (data: { period: string }) => {
    try {
      if (!socket.campaignId || !socket.userId) {
        socket.emit('error', { message: 'Not authenticated to a campaign' });
        return;
      }
      if (!withinCeiling(socket, 'vibe.update')) return;

      // GM only
      if (socket.role !== 'GM') {
        socket.emit('error', { message: 'Only the GM can change the vibe' });
        return;
      }

      const outcome = await switchVibe(io, socket.campaignId, socket.userId, data.period);
      if (!outcome.ok) {
        socket.emit('error', { message: outcome.error });
        return;
      }
      if (outcome.audioNotice) socket.emit('error', { message: outcome.audioNotice });
    } catch (error) {
      logger.error('vibe.update failed', { err: error });
      socket.emit('error', { message: 'Failed to update vibe' });
    }
  });
}
