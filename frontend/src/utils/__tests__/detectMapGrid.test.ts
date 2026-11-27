import { describe, expect, it } from 'vitest';
import { analyseGrid, type GridDetectionResult } from '../detectMapGrid';

// All images are synthetic grayscale buffers built here; no real maps.

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Gray {
  v: Float32Array;
  constructor(public w: number, public h: number, fill = 200) {
    this.v = new Float32Array(w * h).fill(fill);
  }
  add(fn: (x: number, y: number) => number) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.v[y * this.w + x] += fn(x, y);
    return this;
  }
  /** Darken grid lines of the given thickness starting at (ox, oy); `on` decides per pixel (dashes) */
  grid(p: number, opts: { ox?: number; oy?: number; thick?: number; delta?: number; x1?: number; y1?: number;
    on?: (along: number) => boolean; weight?: (k: number) => number } = {}) {
    const { ox = 0, oy = 0, thick = 1, delta = -80, x1 = this.w, y1 = this.h, on = () => true, weight = () => 1 } = opts;
    for (let k = 0; ox + k * p < x1; k++) {
      const x0 = Math.floor(ox + k * p);
      for (let x = x0; x < x0 + thick && x < x1; x++)
        for (let y = oy; y < y1; y++) if (on(y)) this.v[y * this.w + x] += delta * weight(k);
    }
    for (let k = 0; oy + k * p < y1; k++) {
      const y0 = Math.floor(oy + k * p);
      for (let y = y0; y < y0 + thick && y < y1; y++)
        for (let x = ox; x < x1; x++) if (on(x)) this.v[y * this.w + x] += delta * weight(k);
    }
    return this;
  }
  rgba() {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.v.length; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = this.v[i];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  analyse() {
    return analyseGrid(this.rgba(), this.w, this.h);
  }
}

/** Smooth random texture (bilinear value noise), like stone or parchment */
function valueNoise(cell: number, amp: number, seed: number) {
  const r = rng(seed);
  const g = new Float32Array(400 * 400).map(() => r() * 2 - 1);
  return (x: number, y: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const at = (a: number, b: number) => g[(b % 400) * 400 + (a % 400)];
    const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return amp * (top * (1 - fy) + bottom * fy);
  };
}

function pixelNoise(amp: number, seed: number) {
  const r = rng(seed);
  return () => (r() * 2 - 1) * amp;
}

/** Circular distance between two offsets modulo the period */
function phaseError(a: number, b: number, p: number) {
  const d = Math.abs(a - b) % p;
  return Math.min(d, p - d);
}

/**
 * Period within `tol` px; offsets within 1.5 px of the expected line centres
 * (a 1 px line drawn at x has its centre at x + 0.5).
 */
function expectGrid(r: GridDetectionResult | null, period: number, tol: number, offX: number, offY: number) {
  expect(r).not.toBeNull();
  expect(Math.abs(r!.period - period)).toBeLessThan(tol);
  expect(phaseError(r!.offsetX, offX, period)).toBeLessThanOrEqual(1.5);
  expect(phaseError(r!.offsetY, offY, period)).toBeLessThanOrEqual(1.5);
}

describe('analyseGrid', () => {
  it('finds a plain grid', () => {
    const r = new Gray(1000, 800).grid(50, { thick: 2 }).analyse();
    expectGrid(r, 50, 0.05, 1, 1);
    expect(r).toMatchObject({ width: 20, height: 16, offsetX: 0, offsetY: 0, imageWidth: 1000, imageHeight: 800 });
    expect(r!.gridSize).toBeCloseTo(50, 1);
    expect(r!.confidence).toBeGreaterThan(0.8);
  });

  it('finds the offset of a grid inside a margin', () => {
    const g = new Gray(1100, 900, 90);
    // Parchment-coloured map area with a 37 px / 23 px border around it
    g.add((x, y) => (x >= 37 && y >= 23 && x < 1063 && y < 883 ? 110 : 0));
    const r = g.grid(60, { ox: 37, oy: 23, x1: 1063, y1: 883, thick: 2 }).analyse();
    expectGrid(r, 60, 0.05, 38, 24);
    expect(r).toMatchObject({ width: 18, height: 15 });
  });

  it('finds the offset of a coarse grid with few lines', () => {
    const r = new Gray(1500, 1500).add(pixelNoise(10, 17)).grid(100, { ox: 30, oy: 65, thick: 3 }).analyse();
    expectGrid(r, 100, 0.05, 31.5, 66.5);
  });

  it('finds faint 1 px lines on noise', () => {
    const r = new Gray(1200, 900, 128).add(pixelNoise(40, 1)).grid(45, { delta: -12 }).analyse();
    expectGrid(r, 45, 0.05, 0.5, 0.5);
  });

  it('finds dashed and dotted lines', () => {
    const dashed = new Gray(1000, 1000).add(pixelNoise(10, 2)).grid(50, { on: (a) => a % 12 < 6, delta: -60 }).analyse();
    expectGrid(dashed, 50, 0.05, 0.5, 0.5);
    const dotted = new Gray(1000, 1000).add(pixelNoise(10, 3)).grid(50, { on: (a) => a % 6 < 2, delta: -60 }).analyse();
    expectGrid(dotted, 50, 0.05, 0.5, 0.5);
  });

  it('ignores strong texture, including one-axis plank stripes', () => {
    const g = new Gray(1280, 1024, 140)
      .add(valueNoise(23, 60, 4))
      .add(pixelNoise(25, 5))
      // Wood planks every 17 px along x only, stronger than the grid lines
      .add((x) => (x % 17 === 0 ? -50 : 0))
      .grid(64, { delta: -30 });
    const r = g.analyse();
    expectGrid(r, 64, 0.05, 0.5, 0.5);
    expect(r).toMatchObject({ width: 20, height: 16 });
  });

  it('finds a grid covering only part of a rectangular image', () => {
    const g = new Gray(1600, 900, 150).add(valueNoise(31, 50, 6)).add(pixelNoise(15, 7));
    const r = g.grid(50, { x1: 1000, delta: -50 }).analyse();
    expectGrid(r, 50, 0.05, 0.5, 0.5);
    expect(r).toMatchObject({ width: 32, height: 18 });
  });

  it('measures a non-integer period to sub-pixel precision', () => {
    const r = new Gray(1408, 1056).add(pixelNoise(10, 8)).grid(70.4, { delta: -60 }).analyse();
    expectGrid(r, 70.4, 0.05, 0.5, 0.5);
    // Kept between whole pixels, no longer rounded to 70.
    expect(r).toMatchObject({ width: 20, height: 15 });
    expect(r!.gridSize).toBeCloseTo(70.4, 1);
  });

  it('keeps sub-pixel precision and the offset after downsampling', () => {
    // A 2048 px map with 1 px lines every 70.4 px from (40, 12), box-downsampled to 1024 px
    const big = new Gray(2048, 2048).add(pixelNoise(10, 9)).grid(70.4, { ox: 40, oy: 12, delta: -80 });
    const small = new Gray(1024, 1024, 0).add((x, y) => {
      const i = 2 * y * 2048 + 2 * x;
      return (big.v[i] + big.v[i + 1] + big.v[i + 2048] + big.v[i + 2049]) / 4;
    });
    const r = analyseGrid(small.rgba(), 1024, 1024, 2048, 2048);
    expectGrid(r, 70.4, 0.05, 40.5, 12.5);
    expect(r!.width).toBe(29);
  });

  it('returns null without a grid', () => {
    expect(new Gray(1000, 800).analyse()).toBeNull();
    expect(new Gray(1000, 800, 128).add(pixelNoise(40, 10)).analyse()).toBeNull();
    expect(new Gray(1200, 900, 140).add(valueNoise(19, 70, 11)).add(pixelNoise(20, 12)).analyse()).toBeNull();
  });

  it('returns null for irregular texture without a grid', () => {
    // Plank edges at jittered positions in both axes, like a rough wooden floor
    const r = rng(13);
    const edges = (n: number) => {
      const s = new Set<number>();
      for (let p = 0; p < n; p += 20 + Math.floor(r() * 40)) s.add(p);
      return s;
    };
    const ex = edges(1200);
    const ey = edges(900);
    const g = new Gray(1200, 900, 150)
      .add(valueNoise(27, 40, 14))
      .add((x, y) => (ex.has(x) || ey.has(y) ? -60 : 0));
    expect(g.analyse()).toBeNull();
  });

  it('does not pick twice the period when every second line is heavier', () => {
    // The 2× trap: major lines every 2 squares, minor ones between them.
    // Plain autocorrelation peaks at 80; the grid is 40.
    const r = new Gray(1200, 960)
      .add(pixelNoise(10, 15))
      .grid(40, { thick: 2, delta: -100, weight: (k) => (k % 2 === 0 ? 1 : 0.25) })
      .analyse();
    expectGrid(r, 40, 0.05, 1, 1);
    expect(r!.width).toBe(30);
  });

  it('does not pick half the period of a plain grid', () => {
    const r = new Gray(1200, 960).add(pixelNoise(10, 16)).grid(80, { thick: 3, delta: -90 }).analyse();
    expectGrid(r, 80, 0.05, 1.5, 1.5);
  });
});

