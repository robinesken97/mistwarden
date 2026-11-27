// ============================================
// Where a token's centre is, in map pixels, and which grid cell a point is in
//
// The point a token sees from, and the point at which others see it. The
// server decides which tokens to send a player from it; the client draws
// sight from it and picks what a preview shows. It is the same file, byte for
// byte, in backend/src/utils and frontend/src/utils; a backend test fails if
// the two copies drift.
//
// The map's picture frame is width*gridSize by height*gridSize whatever the
// grid, so walls, lights, fog and drawings never move with it. The grid is a
// lattice laid over that frame, anchored at its top-left corner moved by
// (gridOffsetX, gridOffsetY) map pixels. gridSize is the distance between
// the centres of two neighbouring cells, for squares and hexes alike.
//
// Square grid: token positions count x from the left and y from the BOTTOM
// row, and a token covers `size` cells right and upward from its position.
// Map pixels count y from the top. The offset is taken within half a square
// of the corner (squareOrigin), which draws the same lines and keeps column
// 0 and row 0 the first ones whose centre is in the frame.
//
// Hex grids: "hexPointy" has rows of hexes with a point at the top, every
// odd row moved half a hex to the right; "hexFlat" has columns of hexes with
// a flat top, every odd column moved half a hex down. Odd and even are
// counted on the lattice from its anchor (row 0 is the top row of hexes the
// anchor starts, column 0 the left), never from a stored position, so the
// drawn grid does not depend on how many rows fit. A cell is on the map when
// its centre lies strictly inside the frame. A stored position counts from
// the first such column on the left (x = 0) and the last such row at the
// bottom (y = 0), as on a square map. A token of any size stands on one hex
// and is drawn around its centre.
//
// The hex maths follows the old Mistwarden prototype's
// packages/protocol/src/geometry.ts (nearestHexCenter, hexAxial), same
// author, AGPL-3.0.
// ============================================

export const GRID_TYPES = ['square', 'hexPointy', 'hexFlat'] as const;

export type GridType = (typeof GRID_TYPES)[number];

/** A map's frame and the grid on it: what places a cell in map pixels. */
export interface GridFrame {
  /** Squares across and down: the frame is width*gridSize by height*gridSize pixels. */
  width: number;
  height: number;
  gridSize: number;
  gridType: string;
  gridOffsetX: number;
  gridOffsetY: number;
}

export interface CentredToken {
  position: { x: number; y: number };
  size?: { width: number; height: number } | null;
}

interface Point { x: number; y: number }

const SQRT3 = Math.sqrt(3);
/** How far inside the frame a hex centre must lie, in pixels: √3 never lands exactly on an edge. */
const EDGE = 1e-6;

export function isHexGrid(frame: Pick<GridFrame, 'gridType'>): boolean {
  return frame.gridType === 'hexPointy' || frame.gridType === 'hexFlat';
}

/** `value` moved by whole periods to within [-period/2, period/2). */
function withinHalf(value: number, period: number): number {
  return value - period * Math.round(value / period);
}

/**
 * The top-left corner of square cell (0, 0) counted from the top: the offset
 * within half a square of the frame's corner. Fog cells start here too.
 */
export function squareOrigin(frame: Pick<GridFrame, 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>): Point {
  return {
    x: withinHalf(frame.gridOffsetX || 0, frame.gridSize),
    y: withinHalf(frame.gridOffsetY || 0, frame.gridSize),
  };
}

// --- Hex lattice -------------------------------------------------------
//
// Worked along two axes: `along` the rows (pointy: x) cells are gridSize
// apart; `across` them (pointy: y) rows are gridSize*√3/2 apart. Flat hexes
// swap the two. A lattice cell is (p, l): p along its line, l the line.

interface HexAxes {
  flat: boolean;
  g: number;
  /** Anchor along and across the lines, and the frame's size each way. */
  oAlong: number;
  oAcross: number;
  sizeAlong: number;
  sizeAcross: number;
}

function hexAxes(frame: GridFrame): HexAxes {
  const flat = frame.gridType === 'hexFlat';
  const ox = frame.gridOffsetX || 0;
  const oy = frame.gridOffsetY || 0;
  const w = frame.width * frame.gridSize;
  const h = frame.height * frame.gridSize;
  return flat
    ? { flat, g: frame.gridSize, oAlong: oy, oAcross: ox, sizeAlong: h, sizeAcross: w }
    : { flat, g: frame.gridSize, oAlong: ox, oAcross: oy, sizeAlong: w, sizeAcross: h };
}

const odd = (n: number) => ((n % 2) + 2) % 2 === 1;

/** Centre of lattice cell (p, l) along and across. */
function latticeCentre(a: HexAxes, p: number, l: number): { along: number; across: number } {
  const r = a.g / SQRT3; // corner radius: a hex's point is this far from its centre
  return {
    along: a.oAlong + a.g / 2 + p * a.g + (odd(l) ? a.g / 2 : 0),
    across: a.oAcross + r + l * (a.g * SQRT3 / 2),
  };
}

function latticeInFrame(a: HexAxes, p: number, l: number): boolean {
  const c = latticeCentre(a, p, l);
  return c.along > EDGE && c.along < a.sizeAlong - EDGE && c.across > EDGE && c.across < a.sizeAcross - EDGE;
}

/** The first and last line, and the first and last place along any line, whose centres lie in the frame. */
function latticeRange(a: HexAxes): { pMin: number; pMax: number; lMin: number; lMax: number } {
  const r = a.g / SQRT3;
  const step = a.g * SQRT3 / 2;
  const lMin = Math.floor((EDGE - a.oAcross - r) / step) + 1;
  const lMax = Math.ceil((a.sizeAcross - EDGE - a.oAcross - r) / step) - 1;
  let pMin = Infinity;
  let pMax = -Infinity;
  for (const l of lMax > lMin ? [lMin, lMin + 1] : [lMin]) {
    const shift = odd(l) ? a.g / 2 : 0;
    pMin = Math.min(pMin, Math.floor((EDGE - a.oAlong - a.g / 2 - shift) / a.g) + 1);
    pMax = Math.max(pMax, Math.ceil((a.sizeAlong - EDGE - a.oAlong - a.g / 2 - shift) / a.g) - 1);
  }
  return { pMin, pMax, lMin, lMax };
}

/** A stored position as a lattice cell, and back. */
function toLattice(a: HexAxes, cell: Point): { p: number; l: number } {
  const range = latticeRange(a);
  return a.flat
    ? { l: cell.x + range.lMin, p: range.pMax - cell.y }
    : { p: cell.x + range.pMin, l: range.lMax - cell.y };
}

function fromLattice(a: HexAxes, p: number, l: number): Point {
  const range = latticeRange(a);
  return a.flat ? { x: l - range.lMin, y: range.pMax - p } : { x: p - range.pMin, y: range.lMax - l };
}

/** The lattice cell whose centre is nearest a point given along and across. */
function nearestLattice(a: HexAxes, along: number, across: number): { p: number; l: number } {
  // In units of gridSize, from the centre of lattice cell (0, 0).
  const u = (along - a.oAlong - a.g / 2) / a.g;
  const v = (across - a.oAcross - a.g / SQRT3) / a.g;
  // Even lines sit at v = k√3, odd ones half a hex along at v = k√3 + √3/2.
  const evenP = Math.round(u);
  const evenV = Math.round(v / SQRT3) * SQRT3;
  const oddP = Math.round(u - 0.5);
  const oddV = Math.round((v - SQRT3 / 2) / SQRT3) * SQRT3 + SQRT3 / 2;
  const dEven = (evenP - u) ** 2 + (evenV - v) ** 2;
  const dOdd = (oddP + 0.5 - u) ** 2 + (oddV - v) ** 2;
  return dEven <= dOdd
    ? { p: evenP, l: Math.round(evenV / (SQRT3 / 2)) }
    : { p: oddP, l: Math.round(oddV / (SQRT3 / 2)) };
}

/** Axial coordinates of a lattice cell: a step to any neighbour changes them as a vector does. */
function axial(p: number, l: number): { q: number; r: number } {
  return { q: p - Math.floor(l / 2), r: l };
}

function fromAxial(q: number, r: number): { p: number; l: number } {
  return { p: q + Math.floor(r / 2), l: r };
}

// --- Cells ------------------------------------------------------------

/** The centre of a cell (a stored position), in map pixels with y counted from the top. */
export function cellCentre(cell: Point, frame: GridFrame): Point {
  if (!isHexGrid(frame)) {
    const o = squareOrigin(frame);
    return { x: o.x + (cell.x + 0.5) * frame.gridSize, y: o.y + (frame.height - cell.y - 0.5) * frame.gridSize };
  }
  const a = hexAxes(frame);
  const { p, l } = toLattice(a, cell);
  const c = latticeCentre(a, p, l);
  return a.flat ? { x: c.across, y: c.along } : { x: c.along, y: c.across };
}

/** The cell a map-pixel point (y from the top) falls in, whether or not it is on the map. */
export function cellAt(point: Point, frame: GridFrame): Point {
  if (!isHexGrid(frame)) {
    const o = squareOrigin(frame);
    return {
      x: Math.floor((point.x - o.x) / frame.gridSize),
      y: frame.height - 1 - Math.floor((point.y - o.y) / frame.gridSize),
    };
  }
  const a = hexAxes(frame);
  const { p, l } = a.flat ? nearestLattice(a, point.y, point.x) : nearestLattice(a, point.x, point.y);
  return fromLattice(a, p, l);
}

/**
 * Whether a token may stand on `cell`. A square cell is on the map inside
 * width by height; a hex is when its centre lies inside the frame.
 */
export function cellOnMap(cell: Point, frame: GridFrame): boolean {
  if (!isHexGrid(frame)) return cell.x >= 0 && cell.x < frame.width && cell.y >= 0 && cell.y < frame.height;
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) return false;
  const a = hexAxes(frame);
  const { p, l } = toLattice(a, cell);
  return latticeInFrame(a, p, l);
}

/**
 * The nearest hex on the map to `cell` (itself when it is on the map), by
 * its centre. Square maps keep their own rule (clampTokenPosition and
 * friends, which keep a whole footprint on the map); this one is for hexes.
 */
export function nearestHexOnMap(cell: Point, frame: GridFrame): Point {
  const x = Math.round(cell.x);
  const y = Math.round(cell.y);
  if (cellOnMap({ x, y }, frame)) return { x, y };
  const a = hexAxes(frame);
  const from = cellCentre({ x, y }, frame);
  const fromAlong = a.flat ? from.y : from.x;
  const fromAcross = a.flat ? from.x : from.y;
  // The nearest point well inside the frame, then the hexes around it.
  const inset = a.g * 0.01;
  const along = Math.min(Math.max(fromAlong, inset), a.sizeAlong - inset);
  const across = Math.min(Math.max(fromAcross, inset), a.sizeAcross - inset);
  const near = nearestLattice(a, along, across);
  let best: { p: number; l: number } | null = null;
  let bestD = Infinity;
  for (let dl = -2; dl <= 2; dl++) {
    for (let dp = -2; dp <= 2; dp++) {
      const p = near.p + dp;
      const l = near.l + dl;
      if (!latticeInFrame(a, p, l)) continue;
      const c = latticeCentre(a, p, l);
      const d = (c.along - fromAlong) ** 2 + (c.across - fromAcross) ** 2;
      if (d < bestD - EDGE) { best = { p, l }; bestD = d; }
    }
  }
  // A frame too small to hold one hex centre keeps the cell as it was asked.
  return best ? fromLattice(a, best.p, best.l) : { x, y };
}

/** Hexes between two cells on a hex map, each step to a neighbour one. */
export function hexDistance(from: Point, to: Point, frame: GridFrame): number {
  const a = hexAxes(frame);
  const f = toLattice(a, from);
  const t = toLattice(a, to);
  const af = axial(f.p, f.l);
  const at = axial(t.p, t.l);
  const dq = at.q - af.q;
  const dr = at.r - af.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/**
 * `cell` moved by the step that takes `from` to `to`. On squares that is the
 * difference of the positions; on hexes, whose stored positions shift every
 * other row, it is the same step on the lattice, so a rider keeps its place
 * beside its mount.
 */
export function shiftCell(cell: Point, from: Point, to: Point, frame: GridFrame): Point {
  if (!isHexGrid(frame)) return { x: cell.x + to.x - from.x, y: cell.y + to.y - from.y };
  const a = hexAxes(frame);
  const c = toLattice(a, cell);
  const f = toLattice(a, from);
  const t = toLattice(a, to);
  const ac = axial(c.p, c.l);
  const af = axial(f.p, f.l);
  const at = axial(t.p, t.l);
  const moved = fromAxial(ac.q + at.q - af.q, ac.r + at.r - af.r);
  return fromLattice(a, moved.p, moved.l);
}

/** The centre of a token's box, in map pixels with y counted from the top. */
export function tokenCentre(token: CentredToken, frame: GridFrame): { x: number; y: number } {
  if (isHexGrid(frame)) return cellCentre(token.position, frame);
  const width = token.size?.width ?? 1;
  const height = token.size?.height ?? 1;
  const o = squareOrigin(frame);
  return {
    x: o.x + (token.position.x + width / 2) * frame.gridSize,
    y: o.y + (frame.height - token.position.y - height / 2) * frame.gridSize,
  };
}
