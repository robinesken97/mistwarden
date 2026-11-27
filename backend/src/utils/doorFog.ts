// ============================================
// Whether a door sits beside revealed fog.
//
// DUPLICATED FILE — these two copies must stay byte-for-byte identical:
//   backend/src/utils/doorFog.ts
//   frontend/src/utils/doorFog.ts
// backend/src/utils/__tests__/visionParity.test.ts fails while they differ.
// The server refuses a player's door toggle by it; the client offers doors
// by it, so a click it would refuse is never drawn.
//
// Under manual fog a player is offered only a door with a revealed square on
// one side of its middle or the other. A door wholly under fog is one their
// screen covers, and opening it, or being told it is locked, would tell them
// it is there.
// ============================================

/** A map's fog grid: one cell per grid square, counted from the top left. */
export interface FogGrid {
  fogCols: number;
  fogRows: number;
  /** Map pixels per fog cell, the map's grid size. */
  cellPx: number;
  /**
   * Where cell (0, 0) starts, in map pixels: the grid's offset
   * (tokenCentre.ts squareOrigin), 0 when absent. The cells along the
   * frame's edges reach to the edge, so every point of the frame is in one.
   */
  originX?: number;
  originY?: number;
}

/**
 * Whether either square beside the door's middle is revealed. They are found
 * half a square out from the middle, one on each side of the door's line, so
 * a door along a grid line is judged by the two squares it joins.
 */
export function doorBesideRevealed(
  door: { x1: number; y1: number; x2: number; y2: number },
  grid: FogGrid,
  isRevealed: (cellIndex: number) => boolean
): boolean {
  const mx = (door.x1 + door.x2) / 2;
  const my = (door.y1 + door.y2) / 2;
  const length = Math.hypot(door.x2 - door.x1, door.y2 - door.y1);
  // The unit normal; a door with no length is judged by the square it is in.
  const nx = length === 0 ? 0 : -(door.y2 - door.y1) / length;
  const ny = length === 0 ? 0 : (door.x2 - door.x1) / length;
  const half = grid.cellPx / 2;
  for (const side of [1, -1]) {
    const x = mx + side * nx * half;
    const y = my + side * ny * half;
    if (x < 0 || y < 0 || x >= grid.fogCols * grid.cellPx || y >= grid.fogRows * grid.cellPx) continue;
    const col = Math.min(Math.max(Math.floor((x - (grid.originX ?? 0)) / grid.cellPx), 0), grid.fogCols - 1);
    const row = Math.min(Math.max(Math.floor((y - (grid.originY ?? 0)) / grid.cellPx), 0), grid.fogRows - 1);
    if (isRevealed(row * grid.fogCols + col)) return true;
  }
  return false;
}
