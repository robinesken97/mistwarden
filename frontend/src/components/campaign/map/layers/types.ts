// ============================================
// Map layer types — shared by the pure draw modules
//
// Layer modules follow one rule: `(ctx, state, viewport) => void`,
// no React imports, no component closures. All inputs arrive as
// explicit readonly state so the functions are unit-testable with a
// mock 2D context and reusable across the layered canvases.
// ============================================

import type { GridFrame } from '@/utils/tokenCentre';

/** Camera + map metrics. Sizes are in grid CELLS; gridSize is px per cell. */
export interface Viewport {
  zoom: number;
  panOffset: { x: number; y: number };
  gridSize: number;
  mapWidth: number;
  mapHeight: number;
  /** The map's grid (utils/tokenCentre.ts); absent means squares from the corner. */
  gridType?: string;
  gridOffsetX?: number;
  gridOffsetY?: number;
}

/** A map's size and grid as the client may hold it: the grid fields absent on older payloads. */
export interface MapGrid {
  width: number;
  height: number;
  /** Only the hex cells of a map with an offset depend on it; real maps always carry it. */
  gridSize?: number;
  gridType?: string;
  gridOffsetX?: number;
  gridOffsetY?: number;
}

/** The frame and grid that place a map's cells (utils/tokenCentre.ts), absent fields as squares from the corner. */
export function gridFrame(map: MapGrid): GridFrame {
  return {
    width: map.width,
    height: map.height,
    gridSize: map.gridSize ?? 50,
    gridType: map.gridType ?? 'square',
    gridOffsetX: map.gridOffsetX ?? 0,
    gridOffsetY: map.gridOffsetY ?? 0,
  };
}

/** What of a viewport places a token's centre: a cell's centre needs no width. */
export type ViewportGrid = Pick<Viewport, 'gridSize' | 'mapHeight'> & Partial<Pick<Viewport, 'mapWidth' | 'gridType' | 'gridOffsetX' | 'gridOffsetY'>>;

/** A viewport's map frame and grid. */
export function viewportFrame(viewport: ViewportGrid): GridFrame {
  return gridFrame({ ...viewport, width: viewport.mapWidth ?? 0, height: viewport.mapHeight });
}

/** The grid fields of a map, to spread into a Viewport. */
export function viewportGrid(map: MapGrid): Pick<Viewport, 'gridType' | 'gridOffsetX' | 'gridOffsetY'> {
  return { gridType: map.gridType ?? 'square', gridOffsetX: map.gridOffsetX ?? 0, gridOffsetY: map.gridOffsetY ?? 0 };
}

/** Map dimensions in pixels (world space). */
export function mapSizePx(viewport: Viewport): { w: number; h: number } {
  return {
    w: viewport.mapWidth * viewport.gridSize,
    h: viewport.mapHeight * viewport.gridSize,
  };
}

/** In-flight tween for a remotely-moved token. */
export interface TokenAnimation {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTime: number;
  duration: number;
}
