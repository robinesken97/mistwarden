import { MAP_LIMITS } from '@/constants/mapLimits';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A detected grid brought within the map limits, so applying it never fills
 * Create Map or Edit Map with a size the server refuses. Detection looks for
 * squares up to 600 pixels, and a large picture can hold more than 500 of
 * them a side.
 */
export function withinMapLimits(grid: { width: number; height: number; gridSize: number }): {
  width: number;
  height: number;
  gridSize: number;
} {
  return {
    width: clamp(Math.round(grid.width), MAP_LIMITS.minSide, MAP_LIMITS.maxSide),
    height: clamp(Math.round(grid.height), MAP_LIMITS.minSide, MAP_LIMITS.maxSide),
    gridSize: clamp(Math.round(grid.gridSize * 100) / 100, MAP_LIMITS.minGridSize, MAP_LIMITS.maxGridSize),
  };
}

/**
 * What Apply puts in the map dialog from a detected grid: its size within
 * the limits, and where its lines start, in the map's own pixels. The frame
 * stretches the picture over width × gridSize, so each offset is scaled by
 * that stretch, and brought within half a square of the corner, which draws
 * the same lines (utils/tokenCentre.ts squareOrigin).
 *
 * shortcut: one grid size for both axes, so a picture that is not a whole
 * number of squares each way is stretched a little differently along each,
 * and the lines drift by up to half a square at its far edges; exact when
 * the picture is whole squares, which detection's count assumes.
 */
export function detectedGridForMap(grid: {
  width: number; height: number; gridSize: number; offsetX: number; offsetY: number; imageWidth: number; imageHeight: number;
}): { width: number; height: number; gridSize: number; gridOffsetX: number; gridOffsetY: number } {
  const fitted = withinMapLimits(grid);
  const within = (offset: number, imagePx: number, squares: number) => {
    const px = imagePx > 0 ? offset * (squares * fitted.gridSize) / imagePx : offset;
    const near = px - fitted.gridSize * Math.round(px / fitted.gridSize);
    return Math.round(near * 100) / 100;
  };
  return {
    ...fitted,
    gridOffsetX: within(grid.offsetX, grid.imageWidth, fitted.width),
    gridOffsetY: within(grid.offsetY, grid.imageHeight, fitted.height),
  };
}

/** A feet-per-square value typed in the Custom box, kept within the limits. */
export function feetPerSquareWithinLimits(raw: string): number {
  const value = parseInt(raw, 10) || MAP_LIMITS.minFeetPerSquare;
  return clamp(value, MAP_LIMITS.minFeetPerSquare, MAP_LIMITS.maxFeetPerSquare);
}
