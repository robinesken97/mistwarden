// This file holds material under the ORC License, beside CozyVTT's own code under the AGPL-3.0.
// See GAME_CONTENT_NOTICES.md for the notice and credits.

// ============================================
// Initiative tracker handlers (GM-only controls; the order is sent to every
// member as they may see it, see sendInitiativeState).
// initiative.add / remove / set / roll / reorder / start / next / end /
// request_state
//
// Each checks the socket (ceiling, role, a player's own roll) and calls the
// operation in services/initiative.ts, which REST calls too.
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import logger from '../../utils/logger';
import { canControlToken, canRollDice } from '../../services/permissions';
import { playerHasRolled, markPlayerRolled } from '../initiativeState';
import {
  sendInitiativeState,
  addCombatant,
  removeCombatant,
  setInitiative,
  rollInitiative,
  reorderCombatants,
  startCombat,
  nextTurn,
  endCombat,
  type InitiativeActor,
  type InitiativeOutcome,
  type Recipient,
} from '../../services/initiative';
import { stateRequestAllowed, withinCeiling } from '../shared';

// Routes and tests import the senders from here.
export { sendInitiativeState, resendInitiativeState, resendInitiative } from '../../services/initiative';

export function registerInitiativeHandlers(io: Server, socket: AuthenticatedSocket): void {
  /** The socket as the operations' actor, read once the handler has checked it. */
  const actor = (): InitiativeActor => ({ campaignId: socket.campaignId!, userId: socket.userId!, role: socket.role });

  /** An operation's refusal goes to this socket as `error`. */
  function answer(outcome: InitiativeOutcome) {
    if (!outcome.ok) socket.emit('error', { message: outcome.error });
  }

  /**
   * INITIATIVE.ADD — GM adds a token to the combatant list.
   */
  socket.on('initiative.add', async (data: { tokenId: string; mapId: string }) => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.add')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can modify initiative' }); return; }
      answer(await addCombatant(io, actor(), data));
    } catch (error) {
      logger.error('initiative.add failed', { err: error });
      socket.emit('error', { message: 'Failed to add to initiative' });
    }
  });

  /**
   * INITIATIVE.REMOVE — GM removes a token from the combatant list.
   */
  socket.on('initiative.remove', async (data: { tokenId: string }) => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.remove')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can modify initiative' }); return; }
      answer(await removeCombatant(io, actor(), data));
    } catch (error) {
      logger.error('initiative.remove failed', { err: error });
      socket.emit('error', { message: 'Failed to remove from initiative' });
    }
  });

  /**
   * INITIATIVE.SET — GM manually sets a token's initiative value.
   */
  socket.on('initiative.set', async (data: { tokenId: string; mapId: string; value: number | null }) => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.set')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can modify initiative' }); return; }
      answer(await setInitiative(io, actor(), data));
    } catch (error) {
      logger.error('initiative.set failed', { err: error });
      socket.emit('error', { message: 'Failed to set initiative value' });
    }
  });

  /**
   * INITIATIVE.ROLL — roll initiative for a token using a dice expression.
   *
   * The GM may roll for anything on the map. A player may roll only for a token
   * they control, and only once the GM has put that token into the initiative
   * order — rolling is how you take your turn in a fight you are already part
   * of, not a way to insert yourself into one. Everything else about initiative
   * (who is in it, the order, whose turn it is) stays GM-only.
   *
   * This check is the real boundary: the tracker and the map menu only decide
   * whether to *offer* the control, and neither is trustworthy on its own.
   */
  socket.on('initiative.roll', async (data: { tokenId: string; mapId: string; expression?: unknown; characterName?: string }) => {
    // `characterName` is what older clients sent along; the server names the token itself now.
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      // The GM rolls for a whole encounter, so the GM's rolls have a ceiling
      // of their own. Everyone else's is a dice roll: it writes the map, tells
      // the table and re-sends the order, and is counted against the dice
      // ceiling before anything is checked, as dice.roll is, so a flood of
      // rolls that would be refused is held to it too.
      if (!withinCeiling(socket, socket.role === 'GM' ? 'initiative.roll' : 'dice.roll')) return;

      // A spectator may not roll, as with dice.roll, and is told so before
      // anything is read. The token check below refuses one too, for a role
      // that changes while this handler waits on the database.
      if (!canRollDice(socket.role)) {
        socket.emit('error', { message: 'Spectators cannot roll initiative' });
        return;
      }

      // A player's roll is checked where the roll has read the token and the
      // order, before anything else is awaited (rollInitiative).
      const campaignId = socket.campaignId;
      answer(await rollInitiative(io, actor(), data, (token, existingIndex, state) => {
        // Authorize. `controlledBy` is the same ownership field that decides who
        // may move a token (see handlers/tokens.ts), so a player can roll for
        // exactly the tokens they can already move.
        //
        // The same predicate that decides who may move the token: a spectator
        // never, even one `controlledBy` still names from before a demotion.
        if (!canControlToken(socket.role, token.controlledBy, socket.userId)) {
          return socket.role === 'SPECTATOR'
            ? 'Spectators cannot roll initiative'
            : 'You can only roll initiative for your own token';
        }
        if (existingIndex === -1) return 'That token is not in the initiative order yet';
        // Initiative is rolled to establish the order, not to renegotiate it
        // mid-fight. Re-rolling re-sorts the combatants, and the turn pointer
        // walks the list by position — so a player who rolls their way above the
        // current combatant ends the round early and skips whoever was between
        // them. It would also be spammable until a good number came up. A GM can
        // still re-roll anyone, which is the case where it is a deliberate call.
        if (state.active) return 'Combat has started — ask your GM to change your initiative';
        // Once each time the token joins the order, recorded now so a second
        // roll sent at the same moment is refused too.
        if (playerHasRolled(campaignId, token.id)) {
          return 'You have rolled initiative for this fight already. Ask your GM to change it.';
        }
        markPlayerRolled(campaignId, token.id);
        return null;
      }));
    } catch (error) {
      logger.error('initiative.roll failed', { err: error });
      socket.emit('error', { message: 'Failed to roll initiative' });
    }
  });

  /**
   * INITIATIVE.REORDER — GM drags combatants into a custom order.
   */
  socket.on('initiative.reorder', async (data: { orderedTokenIds: string[] }) => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.reorder')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can reorder initiative' }); return; }
      answer(await reorderCombatants(io, actor(), data));
    } catch (error) {
      logger.error('initiative.reorder failed', { err: error });
      socket.emit('error', { message: 'Failed to reorder initiative' });
    }
  });

  /**
   * INITIATIVE.START — GM begins combat (round 1, first combatant active).
   */
  socket.on('initiative.start', async () => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.start')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can start combat' }); return; }
      answer(await startCombat(io, actor()));
    } catch (error) {
      logger.error('initiative.start failed', { err: error });
      socket.emit('error', { message: 'Failed to start combat' });
    }
  });

  /**
   * INITIATIVE.NEXT — GM advances to the next combatant.
   */
  socket.on('initiative.next', async () => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.next')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can advance the turn' }); return; }
      answer(await nextTurn(io, actor()));
    } catch (error) {
      logger.error('initiative.next failed', { err: error });
      socket.emit('error', { message: 'Failed to advance initiative' });
    }
  });

  /**
   * INITIATIVE.END — GM ends combat and clears all state.
   */
  socket.on('initiative.end', async () => {
    try {
      if (!socket.campaignId) { socket.emit('error', { message: 'Not authenticated to a campaign' }); return; }
      if (!withinCeiling(socket, 'initiative.end')) return;
      if (socket.role !== 'GM') { socket.emit('error', { message: 'Only the GM can end combat' }); return; }
      answer(await endCombat(io, actor()));
    } catch (error) {
      logger.error('initiative.end failed', { err: error });
      socket.emit('error', { message: 'Failed to end combat' });
    }
  });

  /**
   * INITIATIVE.REQUEST_STATE — Client requests current state on (re)connect.
   */
  socket.on('initiative.request_state', async () => {
    try {
      if (!socket.campaignId) return;
      if (!stateRequestAllowed(socket, 'initiative.request_state')) return;
      await sendInitiativeState(io, socket.campaignId, [socket as unknown as Recipient]);
    } catch (error) {
      logger.error('initiative.request_state failed', { err: error });
    }
  });
}
