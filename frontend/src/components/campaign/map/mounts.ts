// ============================================
// A rider on a mount, as this screen holds them: the rider names its mount
// in `mountedOn`, and the server moves the two as one whichever is moved
// (backend/src/utils/mounts.ts). Pure: no React, no DOM.
// ============================================

import type { Position, Token } from '@/types';

/**
 * The ids that move with `tokenId`, itself included: a mount and all its
 * riders when `tokenId` is either; only `tokenId` otherwise.
 */
export function coupledIds(tokens: readonly Token[], tokenId: string): string[] {
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) return [tokenId];
  const mountId = token.mountedOn && tokens.some((t) => t.id === token.mountedOn) ? token.mountedOn : token.id;
  const group = tokens.filter((t) => t.id === mountId || t.mountedOn === mountId).map((t) => t.id);
  return group.length > 1 ? group : [tokenId];
}

/**
 * The tokens `rider` may get on, by the server's rules: another token on
 * its plane that rides nothing, while the rider carries nobody itself, and
 * of those only the ones `mayCouple` allows (the GM any, a player their own).
 */
export function mountCandidates(tokens: readonly Token[], rider: Token, mayCouple: (t: Token) => boolean): Token[] {
  if (tokens.some((t) => t.mountedOn === rider.id)) return [];
  return tokens.filter((t) => t.id !== rider.id && t.id !== rider.mountedOn && !t.mountedOn && t.layer === rider.layer && mayCouple(t));
}

/**
 * The tokens in draw order with every rider straight after its mount, so it
 * is drawn above it and a click there picks it first. The server lists them
 * so; tokens that reach this screen one at a time (a player is sent a token
 * as it comes into sight) arrive in any order. The same array when nothing
 * here rides anything.
 */
export function ridersAfterMounts(tokens: Token[]): Token[] {
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const ridesHere = (t: Token) => !!t.mountedOn && byId.has(t.mountedOn) && !byId.get(t.mountedOn)!.mountedOn;
  if (!tokens.some(ridesHere)) return tokens;
  const riders = new Map<string, Token[]>();
  for (const t of tokens) if (ridesHere(t)) riders.set(t.mountedOn!, [...(riders.get(t.mountedOn!) ?? []), t]);
  return tokens.flatMap((t) => (ridesHere(t) ? [] : [t, ...(riders.get(t.id) ?? [])]));
}

/**
 * Where `token` ends up when put down on `square`, the server's rule
 * (backend utils/mounts.ts moveCoupled): its mount and riders keep their
 * places beside it, and the group stops as one at the map's edge.
 */
export function keepCoupledOnMap(
  tokens: readonly Token[],
  token: Token,
  square: { x: number; y: number },
  map: { width: number; height: number }
): { x: number; y: number } {
  const ids = new Set(coupledIds(tokens, token.id));
  if (ids.size < 2) return square;
  const group = tokens.filter((t) => ids.has(t.id));
  const at = (t: Token) => ({ x: square.x + t.position.x - token.position.x, y: square.y + t.position.y - token.position.y });
  const left = Math.min(...group.map((t) => at(t).x));
  const top = Math.min(...group.map((t) => at(t).y));
  const right = Math.max(...group.map((t) => at(t).x + t.size.width));
  const bottom = Math.max(...group.map((t) => at(t).y + t.size.height));
  const x = Math.max(0, Math.min(left, map.width - (right - left)));
  const y = Math.max(0, Math.min(top, map.height - (bottom - top)));
  return { x: square.x + x - left, y: square.y + y - top };
}

/**
 * Where the tokens coupled with `tokenId` are drawn once it is drawn
 * (dx, dy) further on: `heldAt` with each follower this screen holds moved
 * by the same step, and dropped from it once it is back on its own square.
 *
 * Followers are found from the tokens this screen holds and the mounts they
 * name, and a rider names its mount only to a screen sent the mount
 * (tokenMask.ts), so this never draws a token the screen was not sent, and
 * drag frames need carry nothing more than the dragged token's square.
 * `onlyHeld` moves only followers already drawn away from their square: a
 * drop or a put-back settles where a drag left them, and the followers' own
 * moves, which come after it, must not move the token back.
 */
export function shiftFollowers(
  tokens: readonly Token[],
  heldAt: Record<string, Position>,
  tokenId: string,
  dx: number,
  dy: number,
  { onlyHeld = false }: { onlyHeld?: boolean } = {}
): Record<string, Position> {
  if (dx === 0 && dy === 0) return heldAt;
  const followers = coupledIds(tokens, tokenId).filter((id) => id !== tokenId && (!onlyHeld || id in heldAt));
  if (followers.length === 0) return heldAt;
  const next = { ...heldAt };
  for (const id of followers) {
    const t = tokens.find((f) => f.id === id);
    if (!t) continue;
    const from = heldAt[id] ?? t.position;
    const at = { x: from.x + dx, y: from.y + dy };
    if (at.x === t.position.x && at.y === t.position.y) delete next[id];
    else next[id] = at;
  }
  return next;
}
