// ============================================
// Manual fog-of-war layer (the non-dynamic-lighting fog).
// GM sees semi-transparent fog from the full fogState; players see opaque
// fog everywhere outside their revealed cell set: nothing under an
// unrevealed cell shows through, not the artwork and not what stands on it.
// Pure: no React, no component closures.
// ============================================

import type { FogState } from '@/types/walls';
import type { Viewport } from './types';

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

/**
 * Mist over the rectangle (0, 0, width, height) of `ctx`, drifting with
 * `time`, for the darkness of dynamic lighting (drawLights.ts). False where
 * no mist can be drawn.
 */
export function paintMistRect(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, scale: number, opacity: number): boolean {
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  return fillMist(ctx, time, opacity, scale);
}

/** Lay the mist over the current path, drifting with `time`. The path must already be filled. */
function fillMist(ctx: CanvasRenderingContext2D, time: number, opacity: number, tileScale = 1): boolean {
  const tile = mistTileCanvas();
  if (!tile || typeof DOMMatrix === 'undefined') return false;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern || typeof pattern.setTransform !== 'function') return false;
  // Two layers drifting at different speeds and directions read as moving mist.
  for (const [speedX, speedY, layerScale] of [[0.012, 0.004, 1], [-0.007, 0.009, 1.7]] as const) {
    const scale = layerScale * tileScale;
    pattern.setTransform(new DOMMatrix().translateSelf((time * speedX * tileScale) % (MIST_TILE * scale), (time * speedY * tileScale) % (MIST_TILE * scale)).scaleSelf(scale));
    ctx.globalAlpha = opacity;
    ctx.fillStyle = pattern;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return true;
}

/** The outline of whole cells as one path (see fillCells). */
function cellsPath(ctx: CanvasRenderingContext2D, cells: readonly number[], cols: number, cellPx: number): void {
  ctx.beginPath();
  for (const idx of cells) {
    ctx.rect((idx % cols) * cellPx, Math.floor(idx / cols) * cellPx, cellPx, cellPx);
  }
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
  exempt?: ReadonlySet<number>
): void {
  const h = cellPx / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (isHidden(col, row) || exempt?.has(row * cols + col)) continue;
      const x = col * cellPx;
      const y = row * cellPx;
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
function fillCells(ctx: CanvasRenderingContext2D, cells: readonly number[], cols: number, cellPx: number, style: string): void {
  if (cells.length === 0) return;
  ctx.beginPath();
  for (const idx of cells) {
    ctx.rect((idx % cols) * cellPx, Math.floor(idx / cols) * cellPx, cellPx, cellPx);
  }
  ctx.fillStyle = style;
  ctx.fill();
}

export function drawFog(
  ctx: CanvasRenderingContext2D,
  state: FogDrawState,
  viewport: Viewport
): void {
  // GM fog (semi-transparent, from full fogState)
  if (state.isGM && state.fogState) {
    const { fogCols, fogRows, cellPx, revealed } = state.fogState;
    ctx.save();
    const hidden: number[] = [];
    for (let row = 0; row < fogRows; row++) {
      for (let col = 0; col < fogCols; col++) {
        const idx = row * fogCols + col;
        if (!revealed[idx]) { hidden.push(idx); continue; }
        const fade = state.revealOpacity.get(idx);
        if (fade === undefined) continue;
        ctx.fillStyle = `rgba(15, 12, 25, ${0.55 * fade})`;
        ctx.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);
      }
    }
    // Deep dark purple, semi-transparent for the GM
    if (state.mistTime !== undefined && hidden.length > 0) {
      const isHidden = (c: number, r: number) => c >= 0 && r >= 0 && c < fogCols && r < fogRows && !revealed[r * fogCols + c];
      cellsPath(ctx, hidden, fogCols, cellPx);
      addFogFillets(ctx, isHidden, fogCols, fogRows, cellPx);
      ctx.fillStyle = 'rgba(15, 12, 25, 0.55)';
      ctx.fill();
    } else {
      fillCells(ctx, hidden, fogCols, cellPx, 'rgba(15, 12, 25, 0.55)');
    }
    // Mistwarden: the same mist, still and faint, so the GM sees what the table sees without losing the map.
    if (state.mistTime !== undefined && hidden.length > 0) {
      cellsPath(ctx, hidden, fogCols, cellPx);
      fillMist(ctx, 0, 0.6);
    }
    ctx.restore();
  }

  // Player fog (opaque, from revealedCells; cells are one per grid square)
  if (!state.isGM && state.revealedCells) {
    const cellPx = viewport.gridSize;
    const fogCols = viewport.mapWidth;
    const fogRows = viewport.mapHeight;
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
        ctx.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);
      }
    }
    if (state.mistTime !== undefined && hidden.length > 0 && mistTileCanvas()) {
      // Mistwarden: opaque fill whose shadow softens the edge outward, then the mist on top.
      const hiddenSet = new Set(hidden);
      cellsPath(ctx, hidden, fogCols, cellPx);
      addFogFillets(ctx, (c, r) => c >= 0 && r >= 0 && c < fogCols && r < fogRows && hiddenSet.has(r * fogCols + c), fogCols, fogRows, cellPx, state.exemptCells);
      ctx.shadowColor = 'rgba(15, 12, 25, 0.95)';
      // shadowBlur counts canvas pixels and ignores the transform: scale by it (zoom and the screen's density).
      const scale = typeof ctx.getTransform === 'function' ? Math.abs(ctx.getTransform().a) : viewport.zoom;
      ctx.shadowBlur = cellPx * 0.6 * scale;
      ctx.fillStyle = 'rgba(15, 12, 25, 1)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      fillMist(ctx, state.mistTime ?? 0, 0.75);
    } else {
      fillCells(ctx, hidden, fogCols, cellPx, 'rgba(15, 12, 25, 1)');
    }
    ctx.restore();
  }
}
