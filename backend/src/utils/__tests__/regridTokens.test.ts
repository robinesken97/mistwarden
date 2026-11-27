/**
 * A change of the grid moves every token to the cell nearest where it stood
 * on the picture (utils/mapTokens.ts regridTokens): no cell on the map is
 * nearer its old centre, a centre whose own cell is on the map moves at most
 * to that cell's centre, a plain change of a square grid's size leaves
 * positions as they were, and a rider stays on its mount.
 */

import { regridTokens } from '../mapTokens';
import { cellAt, cellOnMap, tokenCentre, type GridFrame } from '../tokenCentre';

const frame = (gridType: string, width = 10, height = 10, gridSize = 50, gridOffsetX = 0, gridOffsetY = 0): GridFrame =>
  ({ width, height, gridSize, gridType, gridOffsetX, gridOffsetY });

type T = ReturnType<typeof token>;
const token = (id: string, x: number, y: number, size = 1, mountedOn: string | null = null) =>
  ({ id, position: { x, y }, size: { width: size, height: size }, mountedOn });

/** A 1x1 token on every square cell of the frame. */
const everySquare = (f: GridFrame): T[] => {
  const tokens = [];
  for (let x = 0; x < f.width; x++) for (let y = 0; y < f.height; y++) tokens.push(token(`${x},${y}`, x, y));
  return tokens;
};

/** Every position a token of `size` may take on the map, found by scanning around the frame. */
function positionsOnMap(f: GridFrame, size: number): Array<{ x: number; y: number }> {
  const out = [];
  for (let x = -3; x < f.width * 2 + 3; x++) {
    for (let y = -3; y < f.height * 2 + 3; y++) {
      const fits = f.gridType === 'square'
        ? x >= 0 && y >= 0 && x + size <= f.width && y + size <= f.height
        : cellOnMap({ x, y }, f);
      if (fits) out.push({ x, y });
    }
  }
  return out;
}

const EPS = 1e-6;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Checks each token of `tokens` moved from `from` to `to` against every place it could have gone. */
function expectNearest(tokens: T[], from: GridFrame, to: GridFrame): T[] {
  const kx = (to.width * to.gridSize) / (from.width * from.gridSize);
  const ky = (to.height * to.gridSize) / (from.height * from.gridSize);
  const after = regridTokens(tokens, from, to);
  after.forEach((t, i) => {
    const before = tokens[i];
    if (before.mountedOn) return; // placed on its mount, below
    const c = tokenCentre(before, from);
    const was = { x: c.x * kx, y: c.y * ky };
    const now = tokenCentre(t, to);
    const best = Math.min(...positionsOnMap(to, t.size.width).map((p) => dist(was, tokenCentre({ ...t, position: p }, to))));
    expect(dist(was, now)).toBeLessThanOrEqual(best + EPS);
    // Away from the edges, never further than the new cell's centre.
    if (to.gridType !== 'square' && cellOnMap(cellAt(was, to), to)) {
      expect(dist(was, now)).toBeLessThanOrEqual(to.gridSize / Math.sqrt(3) + EPS);
    }
    if (to.gridType === 'square' && t.size.width === 1 && cellOnMap(cellAt(was, to), to)) {
      expect(Math.abs(now.x - was.x)).toBeLessThanOrEqual(to.gridSize / 2 + EPS);
      expect(Math.abs(now.y - was.y)).toBeLessThanOrEqual(to.gridSize / 2 + EPS);
    }
  });
  return after;
}

describe.each([
  ['10x10', frame('square')],
  ['9x7 at 70.4 with an offset', frame('square', 9, 7, 70.4, 13.5, -21.25)],
])('square %s', (_name, square) => {
  describe.each(['hexPointy', 'hexFlat'])('to %s and back', (type) => {
    const hex = { ...square, gridType: type };

    it('takes every token to the nearest hex on the map, and back to the nearest square', () => {
      const onHexes = expectNearest(everySquare(square), square, hex);
      expectNearest(onHexes, hex, square);
    });

    it('keeps a rider on its mount, and large tokens on the map', () => {
      const tokens = [token('horse', 4, 4, 2), token('rider', 4, 4, 1, 'horse'), token('ogre', 6, 0, 3)];
      const onHexes = expectNearest(tokens, square, hex);
      expect(onHexes[1].position).toEqual(onHexes[0].position);
      const back = expectNearest(onHexes, hex, square);
      expect(back[1].position).toEqual(back[0].position);
    });
  });
});

describe('a square map 10x10 at 50 px', () => {
  const square = frame('square');

  it.each(['hexPointy', 'hexFlat'])('comes back from %s on its own square or a neighbour', (type) => {
    const start = everySquare(square);
    const back = regridTokens(regridTokens(start, square, { ...square, gridType: type }), { ...square, gridType: type }, square);
    back.forEach((t, i) => {
      expect(Math.abs(t.position.x - start[i].position.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(t.position.y - start[i].position.y)).toBeLessThanOrEqual(1);
    });
  });

  it.each([100, 70.4, 25])('keeps every position when only the size changes, to %s px, large tokens included', (gridSize) => {
    const tokens = [...everySquare(square), token('big', 3, 5, 2), token('huge', 0, 7, 3)];
    expect(regridTokens(tokens, square, { ...square, gridSize }).map((t) => t.position)).toEqual(tokens.map((t) => t.position));
  });

  it('takes every token to the nearest square when the grid is moved by an offset', () => {
    expectNearest(everySquare(square), square, { ...square, gridOffsetX: 20, gridOffsetY: -30 });
  });
});

describe('a map whose tokens do not snap', () => {
  it('keeps each centre where it stood on the picture, to hundredths, the footprint on the map', () => {
    const from = frame('square');
    const to = frame('square', 10, 10, 50, 10, 0);
    const [moved, edge] = regridTokens([token('a', 2.3, 4.7, 2), token('b', 0.1, 0)], from, to, false);
    // The grid moved a fifth of a square right, so the token is a fifth further left on it.
    expect(moved.position).toEqual({ x: 2.1, y: 4.7 });
    expect(edge.position).toEqual({ x: 0, y: 0 });
  });
});
