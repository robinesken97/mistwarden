// ============================================
// Map coordinate conversions
//
// The map deliberately uses TWO Y conventions. This is not a bug, and the
// difference is why this module exists:
//
//   • Token grid coords are BOTTOM-LEFT origin — grid Y 0 is the bottom row.
//     That is the tabletop convention (see useMapControls.screenToGrid), and
//     `token.position.y` is persisted that way in every map's token JSON.
//
//   • Canvas pixels and fog rows are TOP-LEFT origin, because that is what a
//     2D context uses and because fog is a raster indexed row-major from the
//     top (`row * fogCols + col`).
//
// Converting between them used to be bare `mapHeight - 1 - y` arithmetic
// copy-pasted across the draw layers, the vision raycaster and the map
// controls hook. Getting the off-by-one or the direction wrong puts a token
// or a fog cell in the mirror-image row, which is easy to write and hard to
// spot. Everything now goes through the named, tested helpers below.
//
// Pure: no React, no canvas.
// ============================================

import type { FogState } from '@/types/walls';
import { isHexGrid, squareOrigin, tokenCentre, type GridFrame } from '@/utils/tokenCentre';

/**
 * Convert a Y between bottom-left and top-left row indexing.
 *
 * The operation is its own inverse — applying it twice returns the input —
 * so one function serves both directions.
 */
export function flipGridY(gridY: number, mapHeight: number): number {
  return mapHeight - 1 - gridY;
}

/**
 * Top pixel edge of a token's box.
 *
 * A token occupies `heightInCells` rows *upward* from its grid position, so
 * its top edge is that many rows above the position's own row.
 */
export function gridYToTopPx(
  gridY: number,
  heightInCells: number,
  mapHeight: number,
  gridSize: number
): number {
  return (mapHeight - gridY - heightInCells) * gridSize;
}

/** Centre pixel Y of a token's box — for glows, vision sources and labels. */
export function gridYToCentrePx(
  gridY: number,
  heightInCells: number,
  mapHeight: number,
  gridSize: number
): number {
  return (mapHeight - gridY - heightInCells / 2) * gridSize;
}

/** Fog row containing the centre of a token's box. */
export function gridYToFogRow(gridY: number, heightInCells: number, mapHeight: number): number {
  return flipGridY(Math.floor(gridY + (heightInCells - 1) / 2), mapHeight);
}

/** Fog column containing the centre of a token's box. X needs no flip. */
export function gridXToFogCol(gridX: number, widthInCells: number): number {
  return Math.floor(gridX + (widthInCells - 1) / 2);
}

/** Row-major index of a fog cell. */
export function fogCellIndex(col: number, row: number, fog: Pick<FogState, 'fogCols'>): number {
  return row * fog.fogCols + col;
}

/**
 * Where fog cell (0, 0) starts, in map pixels: the grid's offset within half
 * a square of the corner (squareOrigin), so on a square map fog cells lie on
 * the drawn squares. The cells along the frame's edges reach to the edge, so
 * every point of the frame is in one (fogColAt, fogRowAt).
 */
export interface FogOrigin { originX?: number; originY?: number }

export function fogOrigin(frame: Pick<GridFrame, 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>): Required<FogOrigin> {
  const o = squareOrigin(frame);
  return { originX: o.x, originY: o.y };
}

/** The fog column a map-pixel x inside the frame falls in, the edge columns reaching to the edges. */
export function fogColAt(x: number, fog: Pick<FogState, 'fogCols' | 'cellPx'> & FogOrigin): number {
  return Math.min(Math.max(Math.floor((x - (fog.originX ?? 0)) / fog.cellPx), 0), fog.fogCols - 1);
}

/** The fog row a map-pixel y inside the frame falls in, the edge rows reaching to the edges. */
export function fogRowAt(y: number, fog: Pick<FogState, 'fogRows' | 'cellPx'> & FogOrigin): number {
  return Math.min(Math.max(Math.floor((y - (fog.originY ?? 0)) / fog.cellPx), 0), fog.fogRows - 1);
}

/**
 * The pixel box of a fog cell: its square from the origin, the cells along
 * the frame's edges stretched or cut to the edge, so the cells cover the
 * frame exactly, with no strip left uncovered.
 */
export function fogCellBox(
  col: number,
  row: number,
  fog: Pick<FogState, 'fogCols' | 'fogRows' | 'cellPx'> & FogOrigin
): { x: number; y: number; w: number; h: number } {
  const ox = fog.originX ?? 0;
  const oy = fog.originY ?? 0;
  const x0 = col === 0 ? 0 : ox + col * fog.cellPx;
  const y0 = row === 0 ? 0 : oy + row * fog.cellPx;
  const x1 = col === fog.fogCols - 1 ? fog.fogCols * fog.cellPx : ox + (col + 1) * fog.cellPx;
  const y1 = row === fog.fogRows - 1 ? fog.fogRows * fog.cellPx : oy + (row + 1) * fog.cellPx;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Which fog cell a map-pixel point falls in. Map pixels are already top-left
 * origin, so this needs no flip — that is exactly why the fog selection tool
 * works in pixels rather than grid coords.
 *
 * Returns null when the point is outside the map, so callers clamp or bail
 * rather than computing an index that silently wraps to the wrong row.
 */
export function mapPxToFogCell(
  x: number,
  y: number,
  fog: FogState & FogOrigin
): { col: number; row: number; index: number } | null {
  if (x < 0 || y < 0 || x >= fog.fogCols * fog.cellPx || y >= fog.fogRows * fog.cellPx) return null;
  const col = fogColAt(x, fog);
  const row = fogRowAt(y, fog);
  return { col, row, index: fogCellIndex(col, row, fog) };
}

/**
 * The fog cell a token stands in. On a square map the token's own square,
 * whose index the fog shares (both start at squareOrigin); on a hex map the
 * fog square under its hex's centre.
 */
export function tokenFogCell(
  token: { position: { x: number; y: number }; size: { width: number; height: number } },
  frame: GridFrame
): number {
  if (!isHexGrid(frame)) {
    return fogCellIndex(gridXToFogCol(token.position.x, token.size.width), gridYToFogRow(token.position.y, token.size.height, frame.height), { fogCols: frame.width });
  }
  const c = tokenCentre(token, frame);
  const fog = { fogCols: frame.width, fogRows: frame.height, cellPx: frame.gridSize, ...fogOrigin(frame) };
  return fogCellIndex(fogColAt(c.x, fog), fogRowAt(c.y, fog), fog);
}
