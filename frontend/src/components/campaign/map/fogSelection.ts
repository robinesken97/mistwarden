// ============================================
// Fog rectangle selection — drag corners to fog cell indices
//
// The GM drags a box; these functions turn the two corners into the exact set
// of fog cells it covers. Everything is in MAP PIXELS, which are already
// top-left origin like the fog raster — so the bottom-left token convention
// never enters the picture and there is no flip to get wrong. See coords.ts.
//
// Pure: no React, no canvas.
// ============================================

import type { FogState } from '@/types/walls';
import { fogCellBox, fogCellIndex, type FogOrigin } from './coords';

export interface FogRect {
  colMin: number;
  colMax: number;
  rowMin: number;
  rowMax: number;
}

/** Clamp to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Snap two drag corners (map pixels) to the whole fog cells they cover.
 *
 * Corners are normalised, so dragging right-to-left or bottom-to-top gives the
 * same rectangle as the forward drag. The bounds snap *outward*: any cell the
 * drag touches at all is included, which is what makes a zero-movement click
 * resolve to a single square rather than nothing.
 *
 * Returns null only when the rectangle lies entirely off the map — a drag that
 * starts outside and ends inside is clamped rather than rejected.
 */
export function fogRectFromDrag(
  fog: FogState & FogOrigin,
  ax: number,
  ay: number,
  bx: number,
  by: number
): FogRect | null {
  const { fogCols, fogRows, cellPx } = fog;
  const ox = fog.originX ?? 0;
  const oy = fog.originY ?? 0;

  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);

  // Entirely off one side — nothing to reveal.
  if (maxX < 0 || maxY < 0 || minX >= fogCols * cellPx || minY >= fogRows * cellPx) {
    return null;
  }

  return {
    colMin: clamp(Math.floor((minX - ox) / cellPx), 0, fogCols - 1),
    colMax: clamp(Math.floor((maxX - ox) / cellPx), 0, fogCols - 1),
    rowMin: clamp(Math.floor((minY - oy) / cellPx), 0, fogRows - 1),
    rowMax: clamp(Math.floor((maxY - oy) / cellPx), 0, fogRows - 1),
  };
}

/** Every fog cell index inside a rectangle, row-major. */
export function fogCellsInRect(fog: FogState & FogOrigin, rect: FogRect): number[] {
  const cells: number[] = [];
  for (let row = rect.rowMin; row <= rect.rowMax; row++) {
    for (let col = rect.colMin; col <= rect.colMax; col++) {
      cells.push(fogCellIndex(col, row, fog));
    }
  }
  return cells;
}

/** Size in whole squares — for the "4 × 7" readout while dragging. */
export function fogRectSize(rect: FogRect): { cols: number; rows: number } {
  return {
    cols: rect.colMax - rect.colMin + 1,
    rows: rect.rowMax - rect.rowMin + 1,
  };
}

/** Pixel bounds of a snapped rectangle, for drawing the preview. */
export function fogRectToPx(
  fog: FogState & FogOrigin,
  rect: FogRect
): { x: number; y: number; w: number; h: number } {
  // The cells' own boxes, the edge cells reaching the frame's edges.
  const first = fogCellBox(rect.colMin, rect.rowMin, fog);
  const last = fogCellBox(rect.colMax, rect.rowMax, fog);
  return { x: first.x, y: first.y, w: last.x + last.w - first.x, h: last.y + last.h - first.y };
}

/**
 * The revealed cells of a full fog grid, as the set a player's view is drawn
 * from. Lets the GM's Player Preview draw fog the way a player sees it from
 * the grid the GM already holds. No grid (or no fog) means nothing revealed.
 */
export function revealedSetFromFogState(fog: FogState | null): Set<number> {
  const revealed = new Set<number>();
  if (!fog) return revealed;
  fog.revealed.forEach((isRevealed, idx) => {
    if (isRevealed) revealed.add(idx);
  });
  return revealed;
}

// ── Mistwarden, 2026-11-27: the brush and the lasso ─────────────────────────
// Both give squares of the fog raster, like the box: the brush every cell
// whose middle lies within `radius` map pixels of its path, the lasso every
// cell whose middle lies inside the shape drawn.

type Pt = { x: number; y: number };

/** Cells whose middle lies within `radius` of the segment from `a` to `b` (a dab when they are the same). */
export function fogCellsAlongStroke(fog: FogState & FogOrigin, a: Pt, b: Pt, radius: number): number[] {
  const { fogCols, fogRows, cellPx } = fog;
  const ox = fog.originX ?? 0;
  const oy = fog.originY ?? 0;
  const colMin = clamp(Math.floor((Math.min(a.x, b.x) - radius - ox) / cellPx), 0, fogCols - 1);
  const colMax = clamp(Math.floor((Math.max(a.x, b.x) + radius - ox) / cellPx), 0, fogCols - 1);
  const rowMin = clamp(Math.floor((Math.min(a.y, b.y) - radius - oy) / cellPx), 0, fogRows - 1);
  const rowMax = clamp(Math.floor((Math.max(a.y, b.y) + radius - oy) / cellPx), 0, fogRows - 1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const cells: number[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const cx = ox + (col + 0.5) * cellPx;
      const cy = oy + (row + 0.5) * cellPx;
      const t = lengthSq === 0 ? 0 : clamp(((cx - a.x) * dx + (cy - a.y) * dy) / lengthSq, 0, 1);
      const px = a.x + t * dx - cx;
      const py = a.y + t * dy - cy;
      if (px * px + py * py <= radius * radius) cells.push(fogCellIndex(col, row, fog));
    }
  }
  return cells;
}

/** Cells whose middle lies inside the polygon `points` (even-odd rule); none for fewer than three points. */
export function fogCellsInPolygon(fog: FogState & FogOrigin, points: readonly Pt[]): number[] {
  if (points.length < 3) return [];
  const { fogCols, fogRows, cellPx } = fog;
  const ox = fog.originX ?? 0;
  const oy = fog.originY ?? 0;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const colMin = clamp(Math.floor((Math.min(...xs) - ox) / cellPx), 0, fogCols - 1);
  const colMax = clamp(Math.floor((Math.max(...xs) - ox) / cellPx), 0, fogCols - 1);
  const rowMin = clamp(Math.floor((Math.min(...ys) - oy) / cellPx), 0, fogRows - 1);
  const rowMax = clamp(Math.floor((Math.max(...ys) - oy) / cellPx), 0, fogRows - 1);
  const cells: number[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    const cy = oy + (row + 0.5) * cellPx;
    for (let col = colMin; col <= colMax; col++) {
      const cx = ox + (col + 0.5) * cellPx;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const pi = points[i];
        const pj = points[j];
        if ((pi.y > cy) !== (pj.y > cy) && cx < ((pj.x - pi.x) * (cy - pi.y)) / (pj.y - pi.y) + pi.x) inside = !inside;
      }
      if (inside) cells.push(fogCellIndex(col, row, fog));
    }
  }
  return cells;
}
