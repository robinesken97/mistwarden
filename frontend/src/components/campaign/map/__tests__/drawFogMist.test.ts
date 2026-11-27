// Added for Mistwarden on 2026-11-27.
/**
 * The mist never thins a player's fog: every hidden cell is filled opaque
 * before any mist is laid on it, and revealed cells get none of that fill.
 */

import { describe, it, expect, vi } from 'vitest';
import { drawFog } from '../layers/drawFog';
import type { Viewport } from '../layers/types';

function recordingContext() {
  const rects: Array<[number, number, number, number]> = [];
  const fills: Array<{ style: unknown; alpha: number; rects: number }> = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(() => { rects.length = 0; }),
    rect: vi.fn((x: number, y: number, w: number, h: number) => { rects.push([x, y, w, h]); }),
    fill: vi.fn(() => { fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha, rects: rects.length }); }),
    fillRect: vi.fn(),
    createPattern: vi.fn(() => null),
    fillStyle: '' as unknown, globalAlpha: 1, shadowBlur: 0, shadowColor: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

const viewport = { gridSize: 10, mapWidth: 3, mapHeight: 2, zoom: 1 } as unknown as Viewport;

describe('the mist over a player’s fog', () => {
  it.each([[0], [null], [undefined]])('fills every hidden cell opaque first (mistTime %s)', (mistTime) => {
    const { ctx, fills } = recordingContext();
    drawFog(ctx, { isGM: false, fogState: null, revealedCells: new Set([0, 4]), revealOpacity: new Map(), mistTime }, viewport);
    // Six cells, two revealed: one opaque fill of the four hidden ones comes first.
    expect(fills[0]).toEqual({ style: 'rgba(15, 12, 25, 1)', alpha: 1, rects: 4 });
  });
});
