/**
 * The grid cells (utils/tokenCentre.ts): cell to pixel and back for every
 * cell of square and hex maps, which cells are on the map, hex distance and
 * the step that moves a rider with its mount.
 */

import { cellAt, cellCentre, cellOnMap, hexDistance, nearestHexOnMap, shiftCell, squareOrigin, tokenCentre, type GridFrame } from '../tokenCentre';

const frame = (gridType: string, width: number, height: number, gridSize = 50, gridOffsetX = 0, gridOffsetY = 0): GridFrame =>
  ({ width, height, gridSize, gridType, gridOffsetX, gridOffsetY });

/** Every cell on the map, found by scanning a margin around the frame. */
function cellsOnMap(f: GridFrame): Array<{ x: number; y: number }> {
  const cells = [];
  for (let x = -3; x < f.width * 2 + 3; x++) for (let y = -3; y < f.height * 2 + 3; y++) if (cellOnMap({ x, y }, f)) cells.push({ x, y });
  return cells;
}

const HEX_FRAMES: Array<[string, GridFrame]> = [];
for (const type of ['hexPointy', 'hexFlat']) {
  for (const [w, h] of [[10, 10], [9, 7], [8, 11], [1, 1], [2, 3]]) {
    HEX_FRAMES.push([`${type} ${w}x${h}`, frame(type, w, h)]);
    HEX_FRAMES.push([`${type} ${w}x${h} offset`, frame(type, w, h, 70.4, 13.5, -21.25)]);
  }
}

describe.each(HEX_FRAMES)('a %s map', (_name, f) => {
  const cells = cellsOnMap(f);

  it('has cells, the first column x 0 and the bottom row y 0', () => {
    expect(cells.length).toBeGreaterThan(0);
    expect(Math.min(...cells.map((c) => c.x))).toBe(0);
    expect(Math.min(...cells.map((c) => c.y))).toBe(0);
  });

  it('puts every centre strictly inside the frame', () => {
    for (const c of cells) {
      const p = cellCentre(c, f);
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(f.width * f.gridSize);
      expect(p.y).toBeLessThan(f.height * f.gridSize);
    }
  });

  it('finds every cell again at its centre and near it', () => {
    for (const c of cells) {
      const p = cellCentre(c, f);
      expect(cellAt(p, f)).toEqual(c);
      expect(cellAt({ x: p.x + f.gridSize * 0.4, y: p.y }, f)).toEqual(c);
      expect(cellAt({ x: p.x, y: p.y - f.gridSize * 0.4 }, f)).toEqual(c);
    }
  });

  it('has six neighbours gridSize from each centre, one step away', () => {
    for (const c of cells) {
      const p = cellCentre(c, f);
      const near = [];
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const n = { x: c.x + dx, y: c.y + dy };
          const q = cellCentre(n, f);
          if (Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - f.gridSize) < 1e-6) near.push(n);
        }
      }
      expect(near).toHaveLength(6);
      for (const n of near) expect(hexDistance(c, n, f)).toBe(1);
    }
  });

  it('keeps a cell on the map where it is, and brings one off it to the nearest', () => {
    for (const c of cells) expect(nearestHexOnMap(c, f)).toEqual(c);
    for (const off of [{ x: -5, y: 0 }, { x: 0, y: -5 }, { x: f.width * 3, y: f.height * 3 }, { x: 3, y: f.height * 4 }]) {
      expect(cellOnMap(nearestHexOnMap(off, f), f)).toBe(true);
    }
  });

  it('centres a token of any size on its hex', () => {
    const c = cells[0]!;
    expect(tokenCentre({ position: c, size: { width: 3, height: 3 } }, f)).toEqual(cellCentre(c, f));
  });
});

describe('a pointy hex map', () => {
  const f = frame('hexPointy', 10, 10);

  it('has whole rows of 10 hexes and shifted rows of 9 at the top left', () => {
    const cells = cellsOnMap(f);
    const rows = new Map<number, number>();
    for (const c of cells) rows.set(c.y, (rows.get(c.y) ?? 0) + 1);
    // 500 px tall: rows every 43.3 px from 28.9 px, the last centre at 474.2 px.
    expect(rows.size).toBe(11);
    const top = Math.max(...rows.keys());
    expect(rows.get(top)).toBe(10);
    expect(rows.get(top - 1)).toBe(9);
    expect(cellCentre({ x: 0, y: top }, f)).toEqual({ x: 25, y: 50 / Math.sqrt(3) });
    expect(cellCentre({ x: 0, y: top - 1 }, f).x).toBe(50);
  });

  it('takes the top row and not one above it', () => {
    const top = Math.max(...cellsOnMap(f).map((c) => c.y));
    expect(cellOnMap({ x: 3, y: top }, f)).toBe(true);
    expect(cellOnMap({ x: 3, y: top + 1 }, f)).toBe(false);
    expect(cellOnMap({ x: 10, y: top }, f)).toBe(false);
    expect(cellOnMap({ x: 9, y: top - 1 }, f)).toBe(false);
  });

  it('counts hexes as steps to a neighbour', () => {
    expect(hexDistance({ x: 0, y: 0 }, { x: 5, y: 0 }, f)).toBe(5);
    expect(hexDistance({ x: 0, y: 0 }, { x: 0, y: 4 }, f)).toBe(4);
    expect(hexDistance({ x: 2, y: 2 }, { x: 4, y: 6 }, f)).toBe(4);
  });

  it('moves a cell by the step between two others, on the lattice', () => {
    const from = { x: 3, y: 4 };
    const to = { x: 5, y: 7 };
    const dx = cellCentre(to, f).x - cellCentre(from, f).x;
    const dy = cellCentre(to, f).y - cellCentre(from, f).y;
    for (const c of [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 6, y: 5 }]) {
      const moved = cellCentre(shiftCell(c, from, to, f), f);
      const was = cellCentre(c, f);
      expect(moved.x - was.x).toBeCloseTo(dx, 6);
      expect(moved.y - was.y).toBeCloseTo(dy, 6);
    }
  });
});

describe('a flat hex map', () => {
  it('has whole columns at the left and shifted columns beside them', () => {
    const f = frame('hexFlat', 10, 10);
    const cells = cellsOnMap(f);
    const cols = new Map<number, number>();
    for (const c of cells) cols.set(c.x, (cols.get(c.x) ?? 0) + 1);
    expect(cols.get(0)).toBe(10);
    expect(cols.get(1)).toBe(9);
    expect(cellCentre({ x: 0, y: 9 }, f)).toEqual({ x: 50 / Math.sqrt(3), y: 25 });
  });
});

describe('a square map', () => {
  it('is the map as it always was with no offset', () => {
    const f = frame('square', 10, 8);
    expect(cellCentre({ x: 0, y: 0 }, f)).toEqual({ x: 25, y: 375 });
    expect(cellAt({ x: 499, y: 1 }, f)).toEqual({ x: 9, y: 7 });
    expect(tokenCentre({ position: { x: 2, y: 3 }, size: { width: 2, height: 2 } }, f)).toEqual({ x: 150, y: 200 });
  });

  it('moves every cell by the offset, taken within half a square of the corner', () => {
    expect(squareOrigin({ gridSize: 50, gridOffsetX: 10, gridOffsetY: 40 })).toEqual({ x: 10, y: -10 });
    expect(squareOrigin({ gridSize: 70.4, gridOffsetX: -80, gridOffsetY: 0 }).x).toBeCloseTo(-9.6, 9);
    const f = frame('square', 10, 8, 50, 10, 40);
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 8; y++) {
        const p = cellCentre({ x, y }, f);
        expect(p.x).toBe(10 + (x + 0.5) * 50);
        expect(p.y).toBe(-10 + (8 - y - 0.5) * 50);
        expect(cellAt(p, f)).toEqual({ x, y });
        expect(cellOnMap({ x, y }, f)).toBe(true);
      }
    }
  });
});
