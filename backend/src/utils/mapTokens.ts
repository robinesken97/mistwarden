/**
 * Writing a map's tokens.
 *
 * Tokens are not rows; they are one JSON list on the map. Every write reads
 * the list, changes it and writes the whole list back, and nothing used to
 * serialise those writes: two requests that read the same list wrote each
 * other's change away. Moving tokens to another map fired a create and a
 * delete per token all at once, so every request answered success while
 * some tokens ended on neither map and others on both, and a player moving a
 * token during a GM's add or delete could lose either write. Every write to
 * a map's tokens now runs under an advisory lock on that map, inside one
 * transaction, and reads the list fresh once it holds the lock.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { createTurnQueue } from './turnQueue';
import { cellAt, cellCentre, cellOnMap, isHexGrid, nearestHexOnMap, squareOrigin, tokenCentre, type GridFrame } from './tokenCentre';

/**
 * Writers in line for each map in this process (see utils/turnQueue.ts): a
 * writer waits for the one before it, holding nothing, and only then opens its
 * transaction, so a burst of edits to one map cannot take the whole pool.
 */
const mapTurns = createTurnQueue();

/**
 * How many writers in this process are waiting their turn for a map, not
 * counting the one whose turn it is. A test reads it to know a write has
 * reached the lock before it goes on.
 */
export function writersWaitingFor(mapId: string): number {
  return mapTurns.waitingFor(mapId);
}

/**
 * Run `fn` inside a transaction that holds a lock on each of the given maps
 * for its duration. The locks are taken in one order whoever asks, so two
 * moves between the same pair of maps cannot wait on each other. A caller
 * reads the tokens it changes through `tx`, after the lock, never before.
 *
 * Writers in this process take their turn for each map first (mapTurns), so
 * only one of them per map holds a connection; the advisory lock still
 * covers any other process writing the same database.
 */
export async function withMapsLocked<T>(
  mapIds: string[],
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const ids = [...new Set(mapIds)].sort();
  const releases: Array<() => void> = [];
  try {
    for (const mapId of ids) releases.push(await mapTurns.turnFor(mapId));
    return await prisma.$transaction(async (tx) => {
      for (const mapId of ids) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${mapId}))`;
      }
      return fn(tx);
    });
  } finally {
    for (const release of releases.reverse()) release();
  }
}

/**
 * A position that keeps the token's whole footprint on the map it arrives
 * on: pulled back from the far edge by its size, never below zero. A token
 * larger than the map starts at its corner. The same rule the client
 * applies when it offers a move. On a hex map a token of any size stands on
 * one hex: the nearest whose centre is in the frame.
 */
export function clampTokenPosition(
  position: { x: number; y: number },
  size: { width: number; height: number },
  map: GridFrame
): { x: number; y: number } {
  if (isHexGrid(map)) return nearestHexOnMap(position, map);
  return {
    x: Math.max(0, Math.min(position.x, map.width - size.width)),
    y: Math.max(0, Math.min(position.y, map.height - size.height)),
  };
}

/**
 * A position to hundredths of a square, as the client sends one and the
 * server stores it, so the two compare equal. A whole square stays whole.
 */
export function roundTokenPosition(position: { x: number; y: number }): { x: number; y: number } {
  // `+ 0` turns -0 into 0, so a rounded position prints and compares as one.
  return { x: Math.round(position.x * 100) / 100 + 0, y: Math.round(position.y * 100) / 100 + 0 };
}

/** Whether a map's tokens snap: a hex map's always do, whatever its column says. */
export function tokensSnap(map: Pick<GridFrame, 'gridType'> & { snapTokens: boolean }): boolean {
  return map.snapTokens || isHexGrid(map);
}

/**
 * Whether `role` may stop a token between squares on `map`: anyone on a
 * square map whose tokens do not snap, the GM alone on one whose do, nobody
 * on a hex map. Decided from the map as stored, never from the client.
 */
export function mayPlaceFreely(role: string | null | undefined, map: Pick<GridFrame, 'gridType'> & { snapTokens: boolean }): boolean {
  return !isHexGrid(map) && (!map.snapTokens || role === 'GM');
}

/** Whether a position names a whole cell. */
export function isWholeCell(position: { x: number; y: number }): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y);
}

/**
 * The tokens as a map whose tokens snap keeps them: each on the whole square
 * nearest it, its footprint on the map, a rider on its mount's square. What
 * turning snapping on, or a change to a hex grid, does to a list.
 */
export function snapTokenPositions<T extends PlacedToken>(tokens: readonly T[], map: GridFrame): T[] {
  const placed = new Map(tokens.map((t) => [t.id, clampTokenPosition(
    { x: Math.round(t.position.x), y: Math.round(t.position.y) },
    { width: t.size?.width ?? 1, height: t.size?.height ?? 1 },
    map,
  )]));
  return tokens.map((t) => {
    const own = placed.get(t.id) as { x: number; y: number };
    const mount = t.mountedOn ? placed.get(t.mountedOn) : undefined;
    return { ...t, position: { ...(mount ?? own) } };
  });
}

/** The fields a grid change reads of a token. */
interface PlacedToken {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  mountedOn?: string | null;
}

/**
 * The hex on the map whose centre is nearest a map-pixel point. The hex the
 * point falls in when that is on the map; otherwise the nearest of the hexes
 * around it, judged from the point itself (nearestHexOnMap judges from the
 * centre of the hex off the map, which can tie the wrong way).
 */
function nearestHexTo(point: { x: number; y: number }, frame: GridFrame): { x: number; y: number } {
  const under = cellAt(point, frame);
  if (cellOnMap(under, frame)) return under;
  const distance = (cell: { x: number; y: number }) => {
    const c = cellCentre(cell, frame);
    return (c.x - point.x) ** 2 + (c.y - point.y) ** 2;
  };
  let best = nearestHexOnMap(under, frame);
  let bestD = distance(best);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const cell = { x: under.x + dx, y: under.y + dy };
      if (!cellOnMap(cell, frame)) continue;
      const d = distance(cell);
      if (d < bestD - 1e-9) { best = cell; bestD = d; }
    }
  }
  return best;
}

/**
 * The tokens moved from grid `from` to grid `to` so each stays where it stood
 * on the picture: its centre in `from`'s pixels, carried with the picture as
 * it is stretched to `to`'s frame, then the cell of `to` nearest it. On a
 * square grid that is the footprint whose centre is nearest, kept on the map;
 * on a hex grid the hex on the map whose centre is nearest, whatever the
 * token's size. A
 * rider lands on its mount's new cell, as it was put there (utils/mounts.ts).
 * With `snap` false (a square map whose tokens do not snap) the footprint
 * keeps its centre to hundredths of a square instead of the nearest whole one.
 *
 * Nearest is not always the same cell back: a point can lie up to
 * gridSize/√3 from the nearest hex centre, so a square → hex → square round
 * trip may end one row off.
 */
export function regridTokens<T extends PlacedToken>(tokens: readonly T[], from: GridFrame, to: GridFrame, snap = true): T[] {
  const kx = (to.width * to.gridSize) / (from.width * from.gridSize);
  const ky = (to.height * to.gridSize) / (from.height * from.gridSize);
  const placed = new Map<string, { x: number; y: number }>();
  for (const t of tokens) {
    const c = tokenCentre(t, from);
    const point = { x: c.x * kx, y: c.y * ky };
    if (isHexGrid(to)) {
      placed.set(t.id, nearestHexTo(point, to));
      continue;
    }
    // The box's corner, rounded: an even-sized box has its centre on a grid
    // line, where taking the cell under the centre would flip with the floats.
    // A map whose tokens do not snap keeps it to hundredths instead.
    const o = squareOrigin(to);
    const width = t.size?.width ?? 1;
    const height = t.size?.height ?? 1;
    const exact = {
      x: (point.x - o.x) / to.gridSize - width / 2,
      y: to.height - (point.y - o.y) / to.gridSize - height / 2,
    };
    const corner = snap ? { x: Math.round(exact.x), y: Math.round(exact.y) } : roundTokenPosition(exact);
    placed.set(t.id, clampTokenPosition(corner, { width, height }, to));
  }
  return tokens.map((t) => {
    const own = placed.get(t.id) as { x: number; y: number };
    const mount = t.mountedOn ? placed.get(t.mountedOn) : undefined;
    return { ...t, position: { ...(mount ?? own) } };
  });
}
