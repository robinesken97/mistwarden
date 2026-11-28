/**
 * Spell areas on a map: placed, erased, cleared, read and sent.
 *
 * One service for every path that changes or sends an area: the live
 * table's events now, and REST and the MCP bridge later, which have no
 * socket of their own. Each change takes the map's lock and sends its
 * broadcast from here, so a caller cannot forget to. Who may place, erase
 * and be sent an area is utils/drawingRules.ts, as for drawings: an area for
 * the GM alone never leaves the server for anyone else, whichever path it
 * takes. Which tokens an area covers is worked out on each screen from the
 * tokens it draws, never here.
 */

import { Prisma, type MapArea } from '@prisma/client';
import { prisma } from '../config/database';
import { getSocketInstance, emitToMapReadersAs } from '../websocket/utils';
import { canDraw, drawRefusal, canEraseDrawing, eraseRefusal, drawingSentTo, canReadMap } from './permissions';
import { withMapsLocked } from '../utils/mapTokens';
import { drawingShare } from '../validators/drawings';
import { AREA_LIMITS, AREA_OUTSIDE_MAP_MESSAGE, AREA_SHARE_FULL, areaOutsideMap, type NewArea } from '../validators/areas';
import type { MarkupShare } from '../validators/drawingLimits';
import { campaignGmId } from './mapDrawings';
import logger from '../utils/logger';

/** An area as the server sends it. */
export interface AreaSent {
  id: string;
  /** Who placed it; null once their account is deleted. */
  authorId: string | null;
  audience: 'ALL' | 'GM';
  shape: string;
  /** Map pixels from the map's top-left corner. */
  anchorX: number;
  anchorY: number;
  /** Radians, clockwise from pointing right. */
  angle: number;
  sizeFt: number;
  widthFt: number | null;
  exact: boolean;
  element: string;
  animated: boolean;
  label: string | null;
  spellId: string | null;
  createdAt: string;
}

// What each area event the server sends carries. The frontend declares the
// same fields, the same ones optional (keepInStep.test.ts).

/** `area:added`: to each reader the area may be sent to, the sender included. */
export interface AreaAddedBroadcast {
  mapId: string;
  area: AreaSent;
  opId?: string;
}

/** `area:removed`: to the readers who had the area. */
export interface AreaRemovedBroadcast {
  mapId: string;
  areaId: string;
  opId?: string;
}

/** `areas:cleared`: to the readers who had any of them; `authorId` for one member's own. */
export interface AreasClearedBroadcast {
  mapId: string;
  authorId?: string;
  opId?: string;
}

/** `areas:state`: a map's areas as the reader may be sent them, oldest first. */
export interface AreasStateBroadcast {
  mapId: string;
  areas: AreaSent[];
}

/** Who asks for a change: the socket's member, or later a REST or bridge caller. */
export interface AreaActor {
  campaignId: string;
  userId: string;
  role: string | undefined;
  /** The caller's label for the change, echoed in its broadcast. */
  opId?: string;
}

export type AreaOutcome = { ok: true; id?: string } | { ok: false; error: string };

export const AREA_MAP_NOT_FOUND = 'Map not found';
export const AREA_NOT_FOUND = 'Area not found';

const AREA_ORDER = [{ createdAt: 'asc' }, { id: 'asc' }] as const satisfies Prisma.MapAreaOrderByWithRelationInput[];

/** A stored area as it is sent. */
export function areaSent(row: MapArea): AreaSent {
  return {
    id: row.id,
    authorId: row.authorId,
    audience: row.audience,
    shape: row.shape,
    anchorX: row.anchorX,
    anchorY: row.anchorY,
    angle: row.angle,
    sizeFt: row.sizeFt,
    widthFt: row.widthFt,
    exact: row.exact,
    element: row.element,
    animated: row.animated,
    label: row.label,
    spellId: row.spellId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * An area as a campaign archive carries it, in its map file's `areas`: the
 * fields `area:add` takes, and the share it counts to (by the campaign's GM,
 * `gmId`), which the import gives back to it.
 */
export function areaForArchive(row: MapArea, gmId: string | null) {
  const { id: _id, authorId: _author, createdAt: _at, ...fields } = areaSent(row);
  return { share: drawingShare(row, gmId), ...fields };
}

type Reader = Pick<typeof prisma, 'mapArea'> | Prisma.TransactionClient;

/** A map's areas as a member of this role is sent them, oldest first. */
export async function areasFor(mapId: string, role: string | undefined, db: Reader = prisma): Promise<AreaSent[]> {
  const rows = await db.mapArea.findMany({
    where: { mapId, ...(role === 'GM' ? {} : { audience: 'ALL' as const }) },
    orderBy: [...AREA_ORDER],
  });
  return rows.map(areaSent);
}

const LOCKED_MAP = {
  campaignId: true, width: true, height: true, gridSize: true,
  campaign: { select: { status: true, playersMayDraw: true, currentMapId: true } },
} as const satisfies Prisma.MapSelect;

/** The map read under the lock, or null when it is not one of this campaign's that this member may read. */
async function readableMap(tx: Prisma.TransactionClient, mapId: string, actor: AreaActor) {
  const map = await tx.map.findUnique({ where: { id: mapId }, select: LOCKED_MAP });
  if (!map || map.campaignId !== actor.campaignId || !canReadMap(actor.role, mapId, map.campaign.currentMapId)) return null;
  return map;
}

/** How many areas one share of a map holds (drawingShare's split), read under the lock. */
async function shareHeld(tx: Prisma.TransactionClient, mapId: string, share: MarkupShare, gmId: string | null): Promise<number> {
  const inShare: Prisma.MapAreaWhereInput = share === 'GM'
    ? { OR: [{ audience: 'GM' }, ...(gmId ? [{ authorId: gmId }] : [])] }
    : { audience: 'ALL', ...(gmId ? { OR: [{ authorId: null }, { authorId: { not: gmId } }] } : {}) };
  return tx.mapArea.count({ where: { mapId, ...inShare } });
}

type Locked<T> = { refused: string } | { done: T };

const labels = (actor: AreaActor) => (actor.opId ? { opId: actor.opId } : {});

/**
 * Place an area: the GM, or a player while Players may draw is on and the
 * session is live (canDraw). A player's is for everyone. `area:added` goes
 * to each reader it may be sent to, the sender included.
 */
export async function addArea(actor: AreaActor, mapId: string, area: NewArea): Promise<AreaOutcome> {
  const outcome = await withMapsLocked([mapId], async (tx): Promise<Locked<MapArea>> => {
    const map = await readableMap(tx, mapId, actor);
    if (!map) return { refused: AREA_MAP_NOT_FOUND };
    if (!canDraw(actor.role, map.campaign)) return { refused: drawRefusal(actor.role, map.campaign) };
    if (areaOutsideMap(area, map)) return { refused: AREA_OUTSIDE_MAP_MESSAGE };
    const audience = actor.role === 'GM' ? area.audience : 'ALL';
    const gmId = await campaignGmId(tx, actor.campaignId);
    const share = drawingShare({ authorId: actor.userId, audience }, gmId);
    if (await shareHeld(tx, mapId, share, gmId) >= AREA_LIMITS.perShare) return { refused: AREA_SHARE_FULL[share] };
    // The id is the server's, so no client's id ever meets another campaign's row.
    const row = await tx.mapArea.create({ data: { ...area, audience, mapId, authorId: actor.userId } });
    return { done: row };
  });
  if ('refused' in outcome) return { ok: false, error: outcome.refused };
  const row = outcome.done;
  const sent = areaSent(row);
  const io = getSocketInstance();
  await emitToMapReadersAs(io, actor.campaignId, mapId, 'area:added', (reader) =>
    drawingSentTo(reader, row) ? { event: 'area:added', data: { mapId, area: sent, ...labels(actor) } satisfies AreaAddedBroadcast } : null
  );
  return { ok: true, id: row.id };
}

/**
 * Erase one area: the GM any, a player their own for everyone, at any time
 * (canEraseDrawing). One the actor is not sent, or one on another map, is
 * answered as one that does not exist.
 */
export async function removeArea(actor: AreaActor, mapId: string, areaId: string): Promise<AreaOutcome> {
  const outcome = await withMapsLocked([mapId], async (tx): Promise<Locked<MapArea>> => {
    if (!(await readableMap(tx, mapId, actor))) return { refused: AREA_MAP_NOT_FOUND };
    const area = await tx.mapArea.findUnique({ where: { id: areaId } });
    if (!area || area.mapId !== mapId || !drawingSentTo(actor.role, area)) return { refused: AREA_NOT_FOUND };
    if (!canEraseDrawing(actor.role, actor.userId, area)) return { refused: eraseRefusal(actor.role) };
    await tx.mapArea.delete({ where: { id: areaId } });
    return { done: area };
  });
  if ('refused' in outcome) return { ok: false, error: outcome.refused };
  const removed = outcome.done;
  const io = getSocketInstance();
  await emitToMapReadersAs(io, actor.campaignId, mapId, 'area:removed', (reader) =>
    drawingSentTo(reader, removed) ? { event: 'area:removed', data: { mapId, areaId, ...labels(actor) } satisfies AreaRemovedBroadcast } : null
  );
  return { ok: true };
}

/**
 * Clear a map's areas: the GM every one; a player their own for everyone;
 * a spectator none. `areas:cleared` goes to the readers who had any of them,
 * with the player as `authorId` for a player's clear.
 */
export async function clearAreas(actor: AreaActor, mapId: string): Promise<AreaOutcome> {
  const isGM = actor.role === 'GM';
  if (!canEraseDrawing(actor.role, actor.userId, { authorId: actor.userId, audience: 'ALL' })) {
    return { ok: false, error: eraseRefusal(actor.role) };
  }
  const where: Prisma.MapAreaWhereInput = isGM ? { mapId } : { mapId, authorId: actor.userId, audience: 'ALL' };
  const outcome = await withMapsLocked([mapId], async (tx): Promise<Locked<{ all: number; forEveryone: number }>> => {
    if (!(await readableMap(tx, mapId, actor))) return { refused: AREA_MAP_NOT_FOUND };
    const forEveryone = await tx.mapArea.count({ where: { ...where, audience: 'ALL' } });
    const { count } = await tx.mapArea.deleteMany({ where });
    return { done: { all: count, forEveryone } };
  });
  if ('refused' in outcome) return { ok: false, error: outcome.refused };
  const { all, forEveryone } = outcome.done;
  const cleared = { mapId, ...(isGM ? {} : { authorId: actor.userId }), ...labels(actor) } satisfies AreasClearedBroadcast;
  const io = getSocketInstance();
  await emitToMapReadersAs(io, actor.campaignId, mapId, 'areas:cleared', (reader) =>
    (reader === 'GM' ? all : forEveryone) > 0 ? { event: 'areas:cleared', data: cleared } : null
  );
  return { ok: true };
}

/**
 * Move every area's anchor on a map as Edit Map scales its drawings when the
 * map's drawn size changes, kept inside `region`. Sizes are feet and stay:
 * they are drawn by the map's feet per square. Returns how many it changed.
 */
export async function scaleAreas(
  tx: Prisma.TransactionClient,
  mapId: string,
  kx: number,
  ky: number,
  region: { minX: number; minY: number; maxX: number; maxY: number }
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "MapArea" SET
      "anchorX" = LEAST(GREATEST("anchorX" * ${kx}::float8, ${region.minX}::float8), ${region.maxX}::float8),
      "anchorY" = LEAST(GREATEST("anchorY" * ${ky}::float8, ${region.minY}::float8), ${region.maxY}::float8)
    WHERE "mapId" = ${mapId}`;
}

/**
 * Send everyone who may read a map its areas again, as each may be sent
 * them, as `areas:state`: after Edit Map has moved them, and after a role
 * change that alters which a member may have. Read and sent under the map's
 * lock; the caller must not hold it. Best-effort: the change is saved by
 * then, so a failure is logged and nothing else.
 */
export async function resendAreas(campaignId: string, mapId: string): Promise<void> {
  try {
    await withMapsLocked([mapId], async (tx) => {
      const all = await areasFor(mapId, 'GM', tx);
      const io = getSocketInstance();
      await emitToMapReadersAs(io, campaignId, mapId, 'areas:state', (role) => ({
        event: 'areas:state', data: { mapId, areas: all.filter((a) => drawingSentTo(role, a)) } satisfies AreasStateBroadcast,
      }));
    });
  } catch (error) {
    logger.warn('Areas not sent again; the change stands', { err: error, mapId });
  }
}
