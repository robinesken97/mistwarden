/**
 * A rider coupled to a mount: the rider names its mount in `mountedOn`, and
 * the two move as one whichever is moved. One level only (a mount rides
 * nothing), same map, same plane; a mount may carry several riders. A
 * rider's position is stored like any other and kept on its mount's square,
 * so everything that reads positions (sight, fog, the client's drawing)
 * needs no idea of coupling.
 *
 * Pure: the routes and the socket drop call these on the list they read
 * under the map's lock, and write the result in the same write.
 */

import type { Token } from '../websocket/shared';
import { clampTokenPosition, roundTokenPosition } from './mapTokens';
import { isHexGrid, nearestHexOnMap, shiftCell, type GridFrame } from './tokenCentre';

/**
 * The ids that move with `tokenId`, itself included, in list order: a
 * mount and all its riders when `tokenId` is either; only `tokenId`
 * otherwise.
 */
export function coupledIds(tokens: readonly Token[], tokenId: string): string[] {
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) return [];
  const mountId = token.mountedOn && tokens.some((t) => t.id === token.mountedOn) ? token.mountedOn : token.id;
  const group = tokens.filter((t) => t.id === mountId || t.mountedOn === mountId).map((t) => t.id);
  return group.length > 1 ? group : [tokenId];
}

/**
 * The list with `tokenId` moved to `target` and every token coupled with it
 * moved by the same step, and the tokens that moved, `tokenId` first. The
 * group is kept on the map as one footprint, so at an edge it stops as a
 * whole and every rider keeps its place on the mount.
 */
export function moveCoupled(
  tokens: readonly Token[],
  tokenId: string,
  target: { x: number; y: number },
  map: GridFrame
): { tokens: Token[]; moved: Token[] } {
  const ids = new Set(coupledIds(tokens, tokenId));
  const dragged = tokens.find((t) => t.id === tokenId);
  if (!dragged) return { tokens: [...tokens], moved: [] };
  if (isHexGrid(map)) {
    // Hex positions shift every other row, so the step is taken on the
    // lattice (shiftCell), and each lands on the nearest hex on the map.
    const to = nearestHexOnMap(target, map);
    const next = tokens.map((t) => (ids.has(t.id)
      ? { ...t, position: t.id === tokenId ? to : nearestHexOnMap(shiftCell(t.position, dragged.position, to, map), map) }
      : t));
    const moved = next.filter((t) => ids.has(t.id)).sort((a, b) => Number(b.id === tokenId) - Number(a.id === tokenId));
    return { tokens: next, moved };
  }
  const group = tokens.filter((t) => ids.has(t.id));
  const dx = target.x - dragged.position.x;
  const dy = target.y - dragged.position.y;
  const left = Math.min(...group.map((t) => t.position.x + dx));
  const top = Math.min(...group.map((t) => t.position.y + dy));
  const right = Math.max(...group.map((t) => t.position.x + dx + (t.size?.width ?? 1)));
  const bottom = Math.max(...group.map((t) => t.position.y + dy + (t.size?.height ?? 1)));
  const kept = clampTokenPosition({ x: left, y: top }, { width: right - left, height: bottom - top }, map);
  const stepX = dx + kept.x - left;
  const stepY = dy + kept.y - top;
  // Rounded, so a rider's sum of hundredths compares equal to what the client works out.
  const next = tokens.map((t) => (ids.has(t.id) ? { ...t, position: roundTokenPosition({ x: t.position.x + stepX, y: t.position.y + stepY }) } : t));
  const moved = next.filter((t) => ids.has(t.id)).sort((a, b) => Number(b.id === tokenId) - Number(a.id === tokenId));
  return { tokens: next, moved };
}

/**
 * The list with every coupling that no longer holds let go: a mount that is
 * gone (deleted, or moved to another map without its rider), on the other
 * plane, the rider itself, or itself riding. Every write that can break a
 * coupling runs its list through this before it is stored.
 */
export function untangleMounts(tokens: readonly Token[]): Token[] {
  const byId = new Map(tokens.map((t) => [t.id, t]));
  return tokens.map((t) => {
    if (!t.mountedOn) return t;
    const mount = byId.get(t.mountedOn);
    const holds = mount !== undefined && mount.id !== t.id && mount.layer === t.layer && !mount.mountedOn;
    return holds ? t : { ...t, mountedOn: null };
  });
}

/** The list with `tokenId` let go of its mount and of its riders. */
export function uncouple(tokens: readonly Token[], tokenId: string): Token[] {
  return tokens.map((t) => (t.mountedOn && (t.id === tokenId || t.mountedOn === tokenId) ? { ...t, mountedOn: null } : t));
}

/** Why `rider` cannot ride `mount`, or null when it can. */
export function mountRefusal(tokens: readonly Token[], rider: Token, mount: Token | undefined): string | null {
  if (!mount) return 'mountedOn must name another token on this map';
  if (mount.id === rider.id) return 'A token cannot ride itself';
  if (mount.mountedOn) return 'That token is itself riding another';
  if (tokens.some((t) => t.mountedOn === rider.id)) return 'A token carrying riders cannot ride another';
  if (mount.layer !== rider.layer) return 'A rider and its mount must be on the same plane';
  return null;
}

/**
 * The list with `riderId` on `mountId`: on the mount's square, and drawn
 * after the mount and its other riders, so it is drawn above it and a click
 * there picks it first (array order is z-order).
 */
export function mount(tokens: readonly Token[], riderId: string, mountId: string): Token[] {
  const rider = tokens.find((t) => t.id === riderId);
  const mountToken = tokens.find((t) => t.id === mountId);
  if (!rider || !mountToken) return [...tokens];
  const rest = tokens.filter((t) => t.id !== riderId);
  let at = rest.findIndex((t) => t.id === mountId);
  while (at + 1 < rest.length && rest[at + 1].mountedOn === mountId) at++;
  rest.splice(at + 1, 0, { ...rider, mountedOn: mountId, position: { ...mountToken.position } });
  return rest;
}
