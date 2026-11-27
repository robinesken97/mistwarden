// ============================================
// detectMapGrid
// Client-side detection of a square grid baked into a map image.
//
// How it works:
//   1. Downsample the image to at most ANALYSIS_MAX_DIM px (DOM wrapper only).
//   2. Build a line-response profile per axis: the absolute value of the
//      column (row) sum of the horizontal (vertical) second difference.
//      Straight grid lines add up coherently along their length, while noise
//      and texture cancel out, so faint, thin and dashed lines still show.
//   3. Score every candidate period with a comb: fold the profile modulo the
//      period and compare the strongest phase bin with the mean, in units of
//      the standard error. The fundamental period scores highest; its
//      multiples and fractions score lower because they hold fewer lines or
//      dilute them with empty positions.
//   4. Score both axes together, so a texture that repeats along one axis
//      only (wood planks) cannot win.
//   5. Harmonic check: if the positions halfway (or a third) between the
//      chosen lines also hold lines, the real grid is finer.
//   6. Refine the period to sub-pixel precision with the Fourier magnitude
//      at 1/period and a parabola, and read the phase (offset of the first
//      grid line) from the Fourier phase.
//
// Returns null when no confident grid is found: a wrong guess is worse than
// no guess, because the GM still confirms the suggestion.
// ============================================

/** Maximum dimension to downsample to before analysis (1024² RGBA = 4 MB) */
const ANALYSIS_MAX_DIM = 1024;

/** Grid squares smaller than this in original pixels are ignored */
const MIN_GRID_PX = 15;

/** Grid squares larger than this in original pixels are ignored */
const MAX_GRID_PX = 600;

/** Need at least this many grid squares per axis to confirm the pattern */
const MIN_GRID_COUNT = 3;

/** Combined comb score (in standard errors) a grid must reach */
const MIN_SCORE = 8;

/** Score at which confidence reaches 100% */
const FULL_SCORE = 2 * MIN_SCORE;

/** A finer harmonic must reach this score on each axis to be taken */
const MIN_HARMONIC_SCORE = 5;

export interface GridDetectionResult {
  gridSize: number;    // px per square in the original image, snapped to a whole number
  period: number;      // unrounded px per square in the original image
  width: number;       // grid columns across the whole image
  height: number;      // grid rows across the whole image
  offsetX: number;     // px from the left edge to the first vertical grid line, in [0, period)
  offsetY: number;     // px from the top edge to the first horizontal grid line, in [0, period)
  confidence: number;  // 0.5–1, higher = more certain
}

/**
 * Analyse a map image URL and return the detected grid parameters,
 * or null if no confident grid pattern is found.
 */
export async function detectMapGrid(imageUrl: string): Promise<GridDetectionResult | null> {
  const img = await loadImage(imageUrl);
  if (!img.width || !img.height) return null;

  // Downsample: keep aspect ratio, limit to ANALYSIS_MAX_DIM
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  return analyseGrid(data, w, h, img.width, img.height);
}

/**
 * The DOM-free part: find a grid in RGBA pixels of size w×h, which are the
 * original image (originalW×originalH) scaled down. Results are in original px.
 */
export function analyseGrid(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  originalW = w,
  originalH = h,
): GridDetectionResult | null {
  const scale = w / originalW;
  const minP = Math.max(3, MIN_GRID_PX * scale);
  const maxP = Math.min(Math.min(w, h) / MIN_GRID_COUNT, MAX_GRID_PX * scale);
  if (maxP <= minP) return null;

  const { cols, rows } = lineProfiles(pixels, w, h);
  const x = prepare(cols);
  const y = prepare(rows);
  if (!x || !y) return null;

  // Coarse search: steps small enough that the comb drifts at most 0.5 px over the profile
  const step = 1 + 1 / Math.max(w, h);
  let best: { p: number; score: number; fx: Fold; fy: Fold } | null = null;
  for (let p = minP; p <= maxP; p *= step) {
    const fx = fold(x, p);
    const fy = fold(y, p);
    const score = joint(fx.z, fy.z);
    if (!best || score > best.score) best = { p, score, fx, fy };
  }
  if (!best || best.score < MIN_SCORE) return null;

  // Harmonic check: lines halfway (or a third) between the found ones mean a finer grid
  let { p } = best;
  for (let changed = true; changed;) {
    changed = false;
    for (const d of [2, 3]) {
      if (p / d < minP) continue;
      const fx = fold(x, p);
      const fy = fold(y, p);
      if (hasLinesBetween(fx, d) && hasLinesBetween(fy, d)) {
        p /= d;
        changed = true;
        break;
      }
    }
  }

  // Sub-pixel refinement of the period
  const n = Math.max(w, h);
  const samples: number[] = [];
  const ts: number[] = [];
  for (let t = -2; t <= 2.0001; t += 0.1) {
    const pt = p * (1 + t / n);
    ts.push(pt);
    samples.push(fourier(x, pt).mag + fourier(y, pt).mag);
  }
  let iMax = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i] > samples[iMax]) iMax = i;
  let period = ts[iMax];
  if (iMax > 0 && iMax < samples.length - 1) {
    const [a, b, c] = [samples[iMax - 1], samples[iMax], samples[iMax + 1]];
    const denom = a - 2 * b + c;
    if (denom < 0) period += (0.5 * (a - c) / denom) * (ts[iMax + 1] - ts[iMax]);
  }

  const finalScore = joint(fold(x, period).z, fold(y, period).z);
  if (finalScore < MIN_SCORE) return null;

  const periodPx = period / scale;
  const gridSize = snapToNice(periodPx);
  if (gridSize < MIN_GRID_PX) return null;

  // The map stretches the image over width×gridSize, so counts cover the whole
  // image (margins included) to keep its proportions.
  const width = Math.round(originalW / periodPx);
  const height = Math.round(originalH / periodPx);
  if (width < MIN_GRID_COUNT || height < MIN_GRID_COUNT) return null;

  return {
    gridSize,
    period: periodPx,
    width,
    height,
    offsetX: phaseToOffset(fourier(x, period).phase, periodPx),
    offsetY: phaseToOffset(fourier(y, period).phase, periodPx),
    confidence: Math.min(1, 0.5 + 0.5 * (finalScore - MIN_SCORE) / (FULL_SCORE - MIN_SCORE)),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Profile {
  v: Float64Array;  // line response, compressed and smoothed
  mean: number;
  sd: number;
}

interface Fold {
  bins: Float64Array;   // mean response per phase bin
  z: number;            // strongest bin above the mean, in standard errors
  peak: number;         // index of the strongest bin
  se: number;           // standard error of one bin
  mean: number;
}

/** Column and row sums of the second difference across each line direction */
function lineProfiles(px: Uint8ClampedArray, w: number, h: number) {
  const cols = new Float64Array(w);
  const rows = new Float64Array(h);
  const gray = new Float32Array(w * 3); // rolling buffer of three rows
  const lum = (i: number) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  for (let y = 0; y < h; y++) {
    const cur = (y % 3) * w;
    for (let x = 0; x < w; x++) gray[cur + x] = lum((y * w + x) * 4);
    let rowSum = 0;
    for (let x = 1; x < w - 1; x++) cols[x] += 2 * gray[cur + x] - gray[cur + x - 1] - gray[cur + x + 1];
    if (y >= 2) {
      const prev = ((y - 1) % 3) * w;
      const prev2 = ((y - 2) % 3) * w;
      for (let x = 0; x < w; x++) rowSum += 2 * gray[prev + x] - gray[prev2 + x] - gray[cur + x];
      rows[y - 1] = rowSum;
    }
  }
  for (let x = 0; x < w; x++) cols[x] = Math.abs(cols[x]) / h;
  for (let y = 0; y < h; y++) rows[y] = Math.abs(rows[y]) / w;
  return { cols, rows };
}

/** Log-compress (so one strong wall cannot outweigh many grid lines) and smooth [1 2 1] */
function prepare(raw: Float64Array): Profile | null {
  const n = raw.length;
  // A floor keeps flat, noise-free images from dividing by zero
  let sum = 0;
  for (let i = 0; i < n; i++) sum += raw[i];
  const unit = Math.max(sum / n, 0.05);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.log1p(raw[i] / unit);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = (2 * c[i] + c[Math.max(0, i - 1)] + c[Math.min(n - 1, i + 1)]) / 4;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += v[i];
  mean /= n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (v[i] - mean) ** 2;
  const sd = Math.sqrt(ss / n);
  if (sd < 1e-9) return null;
  return { v, mean, sd };
}

function fold(prof: Profile, p: number): Fold {
  const B = Math.max(4, Math.round(p));
  const bins = new Float64Array(B);
  const counts = new Uint32Array(B);
  const { v } = prof;
  const k = B / p;
  for (let i = 0; i < v.length; i++) {
    const b = Math.floor((i % p) * k) % B;
    bins[b] += v[i];
    counts[b]++;
  }
  let peak = 0;
  for (let b = 0; b < B; b++) {
    bins[b] = counts[b] ? bins[b] / counts[b] : prof.mean;
    if (bins[b] > bins[peak]) peak = b;
  }
  const se = prof.sd / Math.sqrt(v.length / p);
  return { bins, z: (bins[peak] - prof.mean) / se, peak, se, mean: prof.mean };
}

/** Geometric mean of both axes' scores: both must show the grid */
function joint(zx: number, zy: number) {
  return zx > 0 && zy > 0 ? Math.sqrt(zx * zy) : 0;
}

/** Do the d-1 positions evenly between the comb's teeth also hold lines? */
function hasLinesBetween(f: Fold, d: number) {
  const B = f.bins.length;
  for (let j = 1; j < d; j++) {
    const c = Math.round(f.peak + (j * B) / d);
    const near = Math.max(f.bins[(c - 1 + B) % B], f.bins[c % B], f.bins[(c + 1) % B]);
    const z = (near - f.mean) / f.se;
    if (z < MIN_HARMONIC_SCORE || z < 0.25 * f.z) return false;
  }
  return true;
}

/** Fourier component of the profile at frequency 1/p */
function fourier(prof: Profile, p: number) {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI) / p;
  const { v, mean } = prof;
  for (let i = 0; i < v.length; i++) {
    const a = v[i] - mean;
    re += a * Math.cos(w * i);
    im += a * Math.sin(w * i);
  }
  return { mag: Math.hypot(re, im) / v.length, phase: Math.atan2(im, re) };
}

/** Line centre from the Fourier phase, in original px within [0, period); within 2 px of the edge counts as 0 */
function phaseToOffset(phase: number, periodPx: number) {
  const off = (((phase / (2 * Math.PI)) * periodPx) % periodPx + periodPx) % periodPx;
  const rounded = Math.round(off);
  return rounded <= 2 || rounded >= periodPx - 2 ? 0 : rounded;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}

/**
 * Round a raw pixel period to the nearest integer,
 * then nudge toward the closest multiple of 5 if it's within 2px.
 * e.g. 48 → 50, 97 → 100, 53 → 53 (not close enough)
 */
function snapToNice(px: number): number {
  const rounded = Math.round(px);
  const nearestFive = Math.round(rounded / 5) * 5;
  return Math.abs(nearestFive - rounded) <= 2 ? nearestFive : rounded;
}
