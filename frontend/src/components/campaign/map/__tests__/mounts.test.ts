/**
 * A rider and its mount as this screen holds them (map/mounts.ts): which
 * tokens move together, the draw order, and where an arrow key's step
 * stops the pair at the edge.
 */

import { describe, it, expect } from 'vitest';
import { TokenLayer, TokenType, type Token } from '@/types';
import { coupledIds, mountCandidates, ridersAfterMounts, keepCoupledOnMap, shiftFollowers } from '../mounts';

function token(id: string, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, imageUrl: '', characterId: null, position: { x: 0, y: 0 }, size: { width: 1, height: 1 },
    layer: TokenLayer.TOKEN, visible: true, type: TokenType.NPC, conditions: [], rotation: 0, controlledBy: null,
    metadata: {}, disposition: null, hp: null, showHpBar: false, initiative: null, ...extra,
  };
}

const horse = token('horse', { position: { x: 2, y: 2 }, size: { width: 2, height: 2 } });
const rider = token('rider', { position: { x: 2, y: 2 }, mountedOn: 'horse' });
const wolf = token('wolf', { position: { x: 6, y: 6 } });

describe('map/mounts', () => {
  it('couples a mount and its riders from either end', () => {
    expect(coupledIds([rider, horse, wolf], 'horse')).toEqual(['rider', 'horse']);
    expect(coupledIds([rider, horse, wolf], 'wolf')).toEqual(['wolf']);
  });

  it('draws a rider after its mount, whatever order the two arrived in', () => {
    expect(ridersAfterMounts([rider, wolf, horse]).map((t) => t.id)).toEqual(['wolf', 'horse', 'rider']);
    const plain = [wolf, horse];
    expect(ridersAfterMounts(plain)).toBe(plain);
  });

  it('offers as mounts only tokens on the plane that ride nothing, and none to a token carrying riders', () => {
    const ghost = token('ghost', { layer: TokenLayer.SPIRIT });
    expect(mountCandidates([horse, rider, wolf, ghost], wolf, () => true).map((t) => t.id)).toEqual(['horse']);
    expect(mountCandidates([horse, rider, wolf], horse, () => true)).toEqual([]);
    expect(mountCandidates([horse, rider, wolf], rider, (t) => t.id !== 'wolf')).toEqual([]);
  });

  it('stops an arrow key\'s step where the server stops the pair, at the map\'s edge', () => {
    const map = { width: 10, height: 10 };
    const edgeHorse = { ...horse, position: { x: 8, y: 2 } };
    const edgeRider = { ...rider, position: { x: 8, y: 2 } };
    expect(keepCoupledOnMap([edgeHorse, edgeRider], edgeRider, { x: 9, y: 2 }, map)).toEqual({ x: 8, y: 2 });
    expect(keepCoupledOnMap([horse, rider], rider, { x: 3, y: 2 }, map)).toEqual({ x: 3, y: 2 });
    expect(keepCoupledOnMap([wolf], wolf, { x: 9, y: 9 }, map)).toEqual({ x: 9, y: 9 });
  });

  it('draws a dragged token\'s mount or riders the same step further on, and lets go of them at home', () => {
    const tokens = [horse, rider, wolf];
    expect(shiftFollowers(tokens, {}, 'rider', 3, 1)).toEqual({ horse: { x: 5, y: 3 } });
    expect(shiftFollowers(tokens, { horse: { x: 5, y: 3 } }, 'rider', -3, -1)).toEqual({});
    const none = {};
    expect(shiftFollowers(tokens, none, 'wolf', 3, 1)).toBe(none);
    expect(shiftFollowers(tokens, none, 'rider', 0, 0)).toBe(none);
  });

  it('settles only followers already held when the move is a drop, never pulling the dropped token back', () => {
    expect(shiftFollowers([horse, rider], {}, 'horse', 2, 2, { onlyHeld: true })).toEqual({});
    expect(shiftFollowers([horse, rider], { rider: { x: 4, y: 4 } }, 'horse', 1, 0, { onlyHeld: true })).toEqual({ rider: { x: 5, y: 4 } });
  });

  it('never moves a follower this screen was not sent: a rider whose mount it is not sent names none', () => {
    const hiddenMountRider = token('rider', { position: { x: 2, y: 2 } });
    expect(shiftFollowers([hiddenMountRider, wolf], {}, 'rider', 3, 1)).toEqual({});
  });
});
