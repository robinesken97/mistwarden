// Added for Mistwarden on 2026-11-27.
// Mistwarden's two coordinate frames.
//
//   Map pixels (walls, lights, fog rectangles): origin at the TOP-LEFT corner
//   of the map, x to the right, y DOWN. The frame is width * gridSize by
//   height * gridSize; the picture is stretched to fill it.
//
//   Token cells: whole squares, origin at the BOTTOM-LEFT, x to the right,
//   y UP. A token's position is its bottom-left square; it covers `size`
//   squares to the right and upward. The grid starts at (gridOffsetX,
//   gridOffsetY) map pixels, taken within half a square of the corner, and
//   fog squares with it (backend/src/utils/tokenCentre.ts squareOrigin).
//
//   A hex map (gridType hexPointy or hexFlat) numbers its hexes otherwise
//   (backend/src/utils/tokenCentre.ts); the helpers here that turn squares
//   into cells refuse it rather than place a token on the wrong hex.

export const LIMITS = { minSide: 1, maxSide: 500, minGrid: 10, maxGrid: 500 } as const;

export interface MapGrid {
  width: number;
  height: number;
  gridSize: number;
  gridType?: string;
  gridOffsetX?: number;
  gridOffsetY?: number;
}

export function isHexMap(map: { gridType?: string }): boolean {
  return map.gridType === 'hexPointy' || map.gridType === 'hexFlat';
}

/** Where square cell (0, 0) and fog cell (0, 0) start: the offset within half a square of the corner. */
export function squareOrigin(map: MapGrid): { x: number; y: number } {
  const half = (v: number | undefined) => (v ?? 0) - map.gridSize * Math.round((v ?? 0) / map.gridSize);
  return { x: half(map.gridOffsetX), y: half(map.gridOffsetY) };
}

/** Refuses a hex map for the square-cell helpers below. */
function squaresOnly(map: { gridType?: string }): void {
  if (isHexMap(map)) {
    throw new RangeError('This map has a hex grid: give token positions as its hexes, origin bottom-left, as get_map lists them.');
  }
}

/** Bottom-left cell of a token from its top-left square counted from the top row (0). */
export function cellFromTop(column: number, rowFromTop: number, size: number, mapHeight: number, map: { gridType?: string } = {}): { x: number; y: number } {
  squaresOnly(map);
  return { x: column, y: mapHeight - rowFromTop - size };
}

/** The top row (counted from the top, 0) a token at bottom-left cell y reaches. */
export function topRowOf(y: number, size: number, mapHeight: number): number {
  return mapHeight - y - size;
}

/** Bottom-left cell of the square holding a map-pixel point (top-left origin). */
export function cellAtPixel(px: number, py: number, map: MapGrid): { x: number; y: number } {
  squaresOnly(map);
  const o = squareOrigin(map);
  return { x: Math.floor((px - o.x) / map.gridSize), y: map.height - 1 - Math.floor((py - o.y) / map.gridSize) };
}

/**
 * Grid for a picture: either its squares are `gridPx` source pixels wide, or
 * it is `squaresAcross` squares wide. Uses the ORIGINAL picture size, so the
 * map-pixel frame matches the source picture's pixels even when the server
 * shrinks the stored copy.
 */
export function gridForPicture(
  imageWidth: number,
  imageHeight: number,
  grid: { gridPx?: number; squaresAcross?: number },
): MapGrid & { exact: boolean } {
  let gridSize: number;
  if (grid.gridPx !== undefined) gridSize = Math.round(grid.gridPx);
  else if (grid.squaresAcross !== undefined) gridSize = Math.round(imageWidth / grid.squaresAcross);
  else throw new RangeError('Give gridPx (source pixels per square) or squaresAcross.');
  if (gridSize < LIMITS.minGrid || gridSize > LIMITS.maxGrid) {
    throw new RangeError(`A square would be ${gridSize} pixels; Mistwarden takes ${LIMITS.minGrid} to ${LIMITS.maxGrid}.`);
  }
  const width = Math.round(imageWidth / gridSize);
  const height = Math.round(imageHeight / gridSize);
  for (const [side, n] of [['wide', width], ['high', height]] as const) {
    if (n < LIMITS.minSide || n > LIMITS.maxSide) {
      throw new RangeError(`The map would be ${n} squares ${side}; Mistwarden takes ${LIMITS.minSide} to ${LIMITS.maxSide}.`);
    }
  }
  return { width, height, gridSize, exact: width * gridSize === imageWidth && height * gridSize === imageHeight };
}

/**
 * Fog cell indexes (row-major from the top-left, row * width + col) of every
 * square a map-pixel rectangle overlaps.
 */
export function fogCellsInRect(map: MapGrid, rect: { x: number; y: number; width: number; height: number }): number[] {
  const g = map.gridSize;
  // Fog squares start at the grid's origin; the edge squares reach the frame's edges.
  const o = squareOrigin(map);
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const col0 = clamp(Math.floor((rect.x - o.x) / g), map.width - 1);
  const col1 = clamp(Math.ceil((rect.x + rect.width - o.x) / g) - 1, map.width - 1);
  const row0 = clamp(Math.floor((rect.y - o.y) / g), map.height - 1);
  const row1 = clamp(Math.ceil((rect.y + rect.height - o.y) / g) - 1, map.height - 1);
  if (rect.width <= 0 || rect.height <= 0 || rect.x >= map.width * g || rect.y >= map.height * g || rect.x + rect.width <= 0 || rect.y + rect.height <= 0) {
    return [];
  }
  const cells: number[] = [];
  for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) cells.push(row * map.width + col);
  return cells;
}
