/**
 * The helpers that decide and keep where a token may stand between squares
 * (utils/mapTokens.ts): who may place freely on which map, the rounding to
 * hundredths the client shares, and what turning snapping on does to a list.
 */

import { isWholeCell, mayPlaceFreely, roundTokenPosition, snapTokenPositions, tokensSnap } from '../mapTokens';
import type { GridFrame } from '../tokenCentre';

const square: GridFrame = { width: 10, height: 10, gridSize: 50, gridType: 'square', gridOffsetX: 0, gridOffsetY: 0 };

describe('mayPlaceFreely', () => {
  it('lets anyone on a square map whose tokens do not snap, the GM alone on one whose do, and nobody on a hex map', () => {
    expect(mayPlaceFreely('PLAYER', { gridType: 'square', snapTokens: false })).toBe(true);
    expect(mayPlaceFreely('PLAYER', { gridType: 'square', snapTokens: true })).toBe(false);
    expect(mayPlaceFreely('SPECTATOR', { gridType: 'square', snapTokens: true })).toBe(false);
    expect(mayPlaceFreely('GM', { gridType: 'square', snapTokens: true })).toBe(true);
    expect(mayPlaceFreely('GM', { gridType: 'hexPointy', snapTokens: false })).toBe(false);
    expect(tokensSnap({ gridType: 'hexFlat', snapTokens: false })).toBe(true);
  });
});

describe('roundTokenPosition', () => {
  it('keeps whole squares, rounds to hundredths, and never gives -0', () => {
    expect(roundTokenPosition({ x: 3, y: 0 })).toEqual({ x: 3, y: 0 });
    expect(roundTokenPosition({ x: 1.005 + 0.1, y: 2.3333 })).toEqual({ x: Math.round((1.005 + 0.1) * 100) / 100, y: 2.33 });
    expect(Object.is(roundTokenPosition({ x: -0.001, y: 0 }).x, 0)).toBe(true);
    expect(isWholeCell(roundTokenPosition({ x: 4.0001, y: 1 }))).toBe(true);
    expect(isWholeCell({ x: 4.5, y: 1 })).toBe(false);
  });
});

describe('snapTokenPositions', () => {
  it('rounds and clamps each token, and puts a rider on its mount\'s square', () => {
    const tokens = [
      { id: 'a', position: { x: 2.5, y: 3.49 }, size: { width: 1, height: 1 } },
      { id: 'b', position: { x: 9.6, y: -0.2 }, size: { width: 2, height: 2 } },
      { id: 'horse', position: { x: 4.6, y: 4.6 }, size: { width: 2, height: 2 } },
      { id: 'rider', position: { x: 4.4, y: 4.4 }, size: { width: 1, height: 1 }, mountedOn: 'horse' },
    ];
    expect(snapTokenPositions(tokens, square).map((t) => t.position)).toEqual([
      { x: 3, y: 3 }, { x: 8, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 },
    ]);
  });
});
