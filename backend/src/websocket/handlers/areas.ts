// ============================================
// Spell area handlers: area:add / area:remove / area:clear / areas:request
//
// The rules, the map's lock and the broadcasts are services/mapAreas.ts;
// these read the event, keep to the sender's ceiling and answer through the
// acknowledgement when one is passed (see ../ack.ts).
// ============================================

import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../auth';
import { prisma } from '../../config/database';
import logger from '../../utils/logger';
import { ackFrom, refuseRequest } from '../ack';
import { echoedOpId } from '../opId';
import { withinCeiling, stateRequestAllowed } from '../shared';
import { emitNewestState } from '../outgoingQueue';
import { canReadMap, drawingSentTo } from '../../services/permissions';
import { AreaAddEventSchema, AreaRemoveEventSchema, AreaClearEventSchema, AreasRequestEventSchema } from '../../validators/areas';
import {
  addArea, removeArea, clearAreas, areasFor, AREA_MAP_NOT_FOUND, AREA_NOT_FOUND,
  type AreaActor, type AreaOutcome, type AreasStateBroadcast,
} from '../../services/mapAreas';

export function registerAreaHandlers(_io: Server, socket: AuthenticatedSocket): void {
  const actorOf = (data: unknown): AreaActor => ({
    campaignId: socket.campaignId!, userId: socket.userId!, role: socket.role, ...echoedOpId(data),
  });

  /** Answer one write: authenticated, under its ceiling, then `run`, which reads the event and does it. */
  const answer = async (
    event: 'area:add' | 'area:remove' | 'area:clear', data: unknown, ackArg: unknown,
    run: (actor: AreaActor) => Promise<AreaOutcome>, failure: string,
  ) => {
    const ack = ackFrom(ackArg);
    const refuse = (message: string) => refuseRequest(socket, ack, message);
    try {
      if (!socket.campaignId) {
        refuse('Not authenticated to a campaign');
        return;
      }
      if (!withinCeiling(socket, event, ack)) return;
      const outcome = await run(actorOf(data));
      if (!outcome.ok) {
        refuse(outcome.error);
        return;
      }
      ack?.({ ...outcome, ...echoedOpId(data) });
    } catch (error) {
      logger.error(`${event} failed`, { err: error, userId: socket.userId });
      refuse(failure);
    }
  };
  const refusedBy = (issues: Array<{ message: string }>, fallback: string): AreaOutcome => ({ ok: false, error: issues[0]?.message ?? fallback });

  /**
   * area:add — Place a spell area on a map: the GM, or a player while Players may draw is on and the session is live.
   * Answered `{ ok: true, id, opId }`; `area:added` goes to each reader the
   * area may be sent to, the sender included. A player's is for everyone.
   */
  socket.on('area:add', (data: unknown, ackArg?: unknown) => answer('area:add', data, ackArg, async (actor) => {
    const parsed = AreaAddEventSchema.safeParse(data);
    return parsed.success ? addArea(actor, parsed.data.mapId, parsed.data.area) : refusedBy(parsed.error.issues, 'Invalid area');
  }, 'Failed to place the area'));

  /**
   * area:remove — Erase one area: the GM any, a player their own, at any time.
   * One the sender is not sent is answered as one that does not exist.
   */
  socket.on('area:remove', (data: unknown, ackArg?: unknown) => answer('area:remove', data, ackArg, async (actor) => {
    const parsed = AreaRemoveEventSchema.safeParse(data);
    return parsed.success ? removeArea(actor, parsed.data.mapId, parsed.data.areaId) : refusedBy(parsed.error.issues, AREA_NOT_FOUND);
  }, 'Failed to erase the area'));

  /**
   * area:clear — Clear a map's areas: the GM every one, a player their own; never a spectator.
   * `areas:cleared` goes to the readers who had any of them.
   */
  socket.on('area:clear', (data: unknown, ackArg?: unknown) => answer('area:clear', data, ackArg, async (actor) => {
    const parsed = AreaClearEventSchema.safeParse(data);
    return parsed.success ? clearAreas(actor, parsed.data.mapId) : refusedBy(parsed.error.issues, AREA_MAP_NOT_FOUND);
  }, 'Failed to clear the areas'));

  /**
   * areas:request — Any campaign member asks for a map's areas, on (re)join and on opening a map.
   * Answered with `areas:state`, those the sender may be sent; nothing for a
   * map they may not read.
   */
  socket.on('areas:request', async (data: unknown) => {
    try {
      if (!socket.campaignId) return;
      if (!stateRequestAllowed(socket, 'areas:request')) return;
      const parsed = AreasRequestEventSchema.safeParse(data);
      if (!parsed.success) return;
      const { mapId } = parsed.data;
      const map = await prisma.map.findUnique({ where: { id: mapId }, select: { campaignId: true, campaign: { select: { currentMapId: true } } } });
      if (!map || map.campaignId !== socket.campaignId || !canReadMap(socket.role, mapId, map.campaign.currentMapId)) return;
      const areas = await areasFor(mapId, 'GM');
      emitNewestState(socket, 'areas:state', { mapId, areas: areas.filter((a) => drawingSentTo(socket.role, a)) } satisfies AreasStateBroadcast, mapId);
    } catch (error) {
      logger.error('areas:request failed', { err: error });
    }
  });
}
