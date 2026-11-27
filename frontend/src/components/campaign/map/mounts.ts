// ============================================
// A rider on a mount, as this screen holds them: the rider names its mount
// in `mountedOn`, and the server moves the two as one whichever is moved
// (backend/src/utils/mounts.ts). Pure: no React, no DOM.
// ============================================

import type { Token } from '@/types';

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
