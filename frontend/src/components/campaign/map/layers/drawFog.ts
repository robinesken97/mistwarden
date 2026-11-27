// ============================================
// Manual fog-of-war layer (the non-dynamic-lighting fog).
// GM sees semi-transparent fog from the full fogState; players see opaque
// fog everywhere outside their revealed cell set: nothing under an
// unrevealed cell shows through, not the artwork and not what stands on it.
// Pure: no React, no component closures.
// ============================================

import type { FogState } from '@/types/walls';
import { viewportFrame, type Viewport } from './types';
import { fogCellBox, fogOrigin, type FogOrigin } from '../coords';

export interface FogDrawState {
  isGM: boolean;
  /** Full fog grid — GM only. */
  fogState: FogState | null;
  /** Revealed cell indices — players only; null = no fog to draw. */
  revealedCells: Set<number> | null;
  /**
   * Cells left clear whatever the revealed set says — the ones a player's own
   * tokens stand on. Players always see their own tokens; the fog that covers
   * the overlay must not paint over them.
   */
  exemptCells?: ReadonlySet<number>;
  /**
   * The fog left over a cell that has just been revealed, as it fades out:
   * 1 = still full, falling to 0. A hidden cell is always drawn full.
   */
  revealOpacity: ReadonlyMap<number, number>;
  /**
   * Mistwarden, 2026-11-27: the mist's clock in milliseconds, for its drift;
   * null draws it still (the GM, reduced motion). Absent: flat fog, as before.
   */
  mistTime?: number | null;
}

// ── Mistwarden, 2026-11-27: mist instead of flat fog ────────────────────────
// A tile of soft wisps, made once in code (no picture file), laid over the
// fog as a pattern that drifts. Hidden cells stay fully covered: the mist is
// drawn on top of the opaque fill, and the soft edge is a shadow that falls
// outward over revealed ground, never thinning what is hidden.

const MIST_TILE = 512;
let mistTile: HTMLCanvasElement | null | undefined;

/** The mist tile, or null where a canvas cannot be drawn (tests). Seamless: each wisp is drawn wrapped. */
function mistTileCanvas(): HTMLCanvasElement | null {
  if (mistTile !== undefined) return mistTile;
  mistTile = null;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MIST_TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // A fixed sequence, so every screen shows the same mist.
  let seed = 0x6d2b79f5;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 90; i++) {
    const x = random() * MIST_TILE;
    const y = random() * MIST_TILE;
    const r = 30 + random() * 110;
    const alpha = 0.018 + random() * 0.04;
    for (const ox of [-MIST_TILE, 0, MIST_TILE]) {
      for (const oy of [-MIST_TILE, 0, MIST_TILE]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(205, 200, 222, ${alpha})`);
        g.addColorStop(1, 'rgba(205, 200, 222, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  mistTile = canvas;
  return canvas;
}

/** The smallest the tile is drawn on screen, in CSS pixels; under it the repeats line up into a visible grid. */
const MIST_MIN_SCREEN_PX = 400;

/**
 * How much larger than map size the tile is drawn at `zoom`, so that it never
 * covers fewer than MIST_MIN_SCREEN_PX on screen: 1 from about 80% zoom up,
 * so the mist looks as it always has there.
 */
export function mistTileBoost(zoom: number): number {
  return zoom > 0 ? Math.max(1, MIST_MIN_SCREEN_PX / (MIST_TILE * zoom)) : 1;
}

/** Lay the mist over the current path, drifting with `time`. The path must already be filled. */
function fillMist(ctx: CanvasRenderingContext2D, time: number, opacity: number, zoom: number): boolean {
  const tile = mistTileCanvas();
  if (!tile || typeof DOMMatrix === 'undefined') return false;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern || typeof pattern.setTransform !== 'function') return false;
  const boost = mistTileBoost(zoom);
  // Two layers drifting at different speeds and directions read as moving mist.
  for (const [speedX, speedY, layerScale] of [[0.012, 0.004, 1], [-0.007, 0.009, 1.7]] as const) {
    const scale = layerScale * boost;
    pattern.setTransform(new DOMMatrix().translateSelf((time * speedX) % (MIST_TILE * scale), (time * speedY) % (MIST_TILE * scale)).scaleSelf(scale));
    ctx.globalAlpha = opacity;
    ctx.fillStyle = pattern;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return true;
}

/** A fog grid's cells and where they start (map/coords.ts fogCellBox). */
type FogCells = { fogCols: number; fogRows: number; cellPx: number } & FogOrigin;

/** Fill or outline one cell's box. */
function cellRect(ctx: CanvasRenderingContext2D, idx: number, fog: FogCells, fill = false): void {
  const b = fogCellBox(idx % fog.fogCols, Math.floor(idx / fog.fogCols), fog);
  if (fill) ctx.fillRect(b.x, b.y, b.w, b.h);
  else ctx.rect(b.x, b.y, b.w, b.h);
}

/** The outline of whole cells as one path (see fillCells). */
function cellsPath(ctx: CanvasRenderingContext2D, cells: readonly number[], fog: FogCells): void {
  ctx.beginPath();
  for (const idx of cells) cellRect(ctx, idx, fog);
}

/**
 * Mistwarden, 2026-11-27: round off the fog's steps. Where a clear cell
 * meets hidden cells on two sides that share a corner, a triangle of fog
 * with legs of half a cell fills that corner of the clear cell, so a
 * staircase reads as a slope. Only ever over clear ground, never off the
 * hidden; a cell in `exempt` (a player's own token) is left alone.
 */
export function addFogFillets(
  ctx: CanvasRenderingContext2D,
  isHidden: (col: number, row: number) => boolean,
  cols: number,
  rows: number,
  cellPx: number,
  exempt?: ReadonlySet<number>,
  origin: FogOrigin = {}
): void {
  const h = cellPx / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isHidden(col, row) || exempt?.has(row * cols + col)) continue;
      // The corners of the cell's square; an edge cell's outer corners have
      // no hidden neighbour to round towards, so its own box does not matter.
      const x = (origin.originX ?? 0) + col * cellPx;
      const y = (origin.originY ?? 0) + row * cellPx;
      const up = isHidden(col, row - 1);
      const down = isHidden(col, row + 1);
      const left = isHidden(col - 1, row);
      const right = isHidden(col + 1, row);
      const corner = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath();
      };
      if (up && left) corner(x, y, x + h, y, x, y + h);
      if (up && right) corner(x + cellPx, y, x + cellPx, y + h, x + cellPx - h, y);
      if (down && left) corner(x, y + cellPx, x, y + cellPx - h, x + h, y + cellPx);
      if (down && right) corner(x + cellPx, y + cellPx, x + cellPx - h, y + cellPx, x + cellPx, y + cellPx - h);
    }
  }
}

/**
 * Fill whole fog cells as one shape. Squares filled one by one each leave
 * their edge part-painted where it falls between screen pixels, and two
 * part-painted edges side by side let the picture under the fog through as a
 * hairline: the walls and the grid, which lie on those edges. One path holds
 * no edge between neighbouring cells.
 */
function fillCells(ctx: CanvasRenderingContext2D, cells: readonly number[], fog: FogCells, style: string): void {
  if (cells.length === 0) return;
  ctx.beginPath();
  for (const idx of cells) cellRect(ctx, idx, fog);
  ctx.fillStyle = style;
  ctx.fill();
}

export function drawFog(
  ctx: CanvasRenderingContext2D,
  state: FogDrawState,
  viewport: Viewport
): void {
  // Fog cells start at the grid's offset, within half a square of the corner (map/coords.ts).
  const origin = fogOrigin(viewportFrame(viewport));
  // GM fog (semi-transparent, from full fogState)
  if (state.isGM && state.fogState) {
    const { fogCols, fogRows, cellPx, revealed } = state.fogState;
    const cells: FogCells = { fogCols, fogRows, cellPx, ...origin };
    ctx.save();
    const hidden: number[] = [];
    for (let row = 0; row < fogRows; row++) {
      for (let col = 0; col < fogCols; col++) {
        const idx = row * fogCols + col;
        if (!revealed[idx]) { hidden.push(idx); continue; }
        const fade = state.revealOpacity.get(idx);
        if (fade === undefined) continue;
        ctx.fillStyle = `rgba(15, 12, 25, ${0.55 * fade})`;
        cellRect(ctx, idx, cells, true);
      }
    }
    // Deep dark purple, semi-transparent for the GM
    if (state.mistTime !== undefined && hidden.length > 0) {
      const isHidden = (c: number, r: number) => c >= 0 && r >= 0 && c < fogCols && r < fogRows && !revealed[r * fogCols + c];
      cellsPath(ctx, hidden, cells);
      addFogFillets(ctx, isHidden, fogCols, fogRows, cellPx, undefined, origin);
      ctx.fillStyle = 'rgba(15, 12, 25, 0.55)';
      ctx.fill();
    } else {
      fillCells(ctx, hidden, cells, 'rgba(15, 12, 25, 0.55)');
    }
    // Mistwarden: the same mist, still and faint, so the GM sees what the table sees without losing the map.
    if (state.mistTime !== undefined && hidden.length > 0) {
      cellsPath(ctx, hidden, cells);
      fillMist(ctx, 0, 0.6, viewport.zoom);
    }
    ctx.restore();
  }

  // Player fog (opaque, from revealedCells; cells are one per grid square)
  if (!state.isGM && state.revealedCells) {
    const cellPx = viewport.gridSize;
    const fogCols = viewport.mapWidth;
    const fogRows = viewport.mapHeight;
    const cells: FogCells = { fogCols, fogRows, cellPx, ...origin };
    ctx.save();
    const hidden: number[] = [];
    for (let row = 0; row < fogRows; row++) {
      for (let col = 0; col < fogCols; col++) {
        const idx = row * fogCols + col;
        if (state.exemptCells?.has(idx)) continue;
        if (!state.revealedCells.has(idx)) { hidden.push(idx); continue; }
        const fade = state.revealOpacity.get(idx);
        if (fade === undefined) continue;
        ctx.fillStyle = `rgba(15, 12, 25, ${fade})`;
        cellRect(ctx, idx, cells, true);
      }
    }
    if (state.mistTime !== undefined && hidden.length > 0 && mistTileCanvas()) {
      // Mistwarden: opaque fill whose shadow softens the edge outward, then the mist on top.
      const hiddenSet = new Set(hidden);
      cellsPath(ctx, hidden, cells);
      addFogFillets(ctx, (c, r) => c >= 0 && r >= 0 && c < fogCols && r < fogRows && hiddenSet.has(r * fogCols + c), fogCols, fogRows, cellPx, state.exemptCells, origin);
      ctx.shadowColor = 'rgba(15, 12, 25, 0.95)';
      // shadowBlur counts canvas pixels and ignores the transform: scale by it (zoom and the screen's density).
      const scale = typeof ctx.getTransform === 'function' ? Math.abs(ctx.getTransform().a) : viewport.zoom;
      ctx.shadowBlur = cellPx * 0.6 * scale;
      ctx.fillStyle = 'rgba(15, 12, 25, 1)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      fillMist(ctx, state.mistTime ?? 0, 0.75, viewport.zoom);
    } else {
      fillCells(ctx, hidden, cells, 'rgba(15, 12, 25, 1)');
    }
    ctx.restore();
  }
}
