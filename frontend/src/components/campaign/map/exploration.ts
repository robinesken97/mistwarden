// ============================================
// Explored memory — which cells a player's vision has covered.
//
// Read off the coverage mask the lighting layer already builds: the mask is
// drawn scaled down to one pixel per grid cell, with smoothing on so each
// pixel's alpha is the average coverage of its cell, and read back once. A
// cell counts as explored when at least a quarter of it was dim-lit (or half
// bright); the disc a token always sees on its own square qualifies.
//
// Pure: no React. The scratch canvas persists between frames (the caller
// passes a holder), since a cols×rows canvas is cheap but not free.
// ============================================

import type { FogOrigin } from './coords';

/** Mutable holder for a persistent scratch canvas (a React ref works). */
export interface ScratchHolder {
  current: HTMLCanvasElement | null;
}

/** Alpha (0–255) at or above which a cell counts as explored. */
export const EXPLORED_ALPHA = 64;

/**
 * The cell indices (row-major, one per grid square) the coverage mask lights
 * at all. Returns null if the scratch canvas cannot give a 2D context.
 */
export function exploredCellsFromCoverage(
  coverage: HTMLCanvasElement,
  cols: number,
  rows: number,
  scratch: ScratchHolder,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
  /**
   * Where fog cell (0, 0) starts and the cell size, in map pixels
   * (map/coords.ts fogOrigin): the coverage, which spans the frame, is
   * drawn shifted back by it, so each scratch pixel is one cell. The strips
   * along the edges the shift leaves out count towards no cell.
   */
  origin: FogOrigin = {},
  cellPx = 1
): Set<number> | null {
  if (cols <= 0 || rows <= 0) return new Set();
  if (!scratch.current || scratch.current.width !== cols || scratch.current.height !== rows) {
    scratch.current = createCanvas();
    scratch.current.width = cols;
    scratch.current.height = rows;
  }
  const ctx = scratch.current.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, cols, rows);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(coverage, -(origin.originX ?? 0) / cellPx, -(origin.originY ?? 0) / cellPx, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);
  const cells = new Set<number>();
  for (let i = 0; i < cols * rows; i++) {
    if (data[i * 4 + 3] >= EXPLORED_ALPHA) cells.add(i);
  }
  return cells;
}

/** The cells in `cells` that `known` does not already hold, in ascending order. */
export function diffNew(known: ReadonlySet<number> | null, cells: ReadonlySet<number>): number[] {
  const fresh: number[] = [];
  for (const idx of cells) {
    if (!known?.has(idx)) fresh.push(idx);
  }
  return fresh.sort((a, b) => a - b);
}
