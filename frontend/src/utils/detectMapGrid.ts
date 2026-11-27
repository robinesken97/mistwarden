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
//   6. Locate the centre of every grid line near its predicted position and
//      fit position = phase + k·period by least squares: sub-pixel period,
//      and the phase gives the offset of the first grid line on each axis.
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
  gridSize: number;    // px per square in the original image, to a hundredth of a pixel
  period: number;      // unrounded px per square in the original image
  width: number;       // grid columns across the whole image
  height: number;      // grid rows across the whole image
  offsetX: number;     // px from the left edge to the first vertical grid line, in [0, period)
  offsetY: number;     // px from the top edge to the first horizontal grid line, in [0, period)
  confidence: number;  // 0.5–1, higher = more certain
  imageWidth: number;  // the original image's size in px, which the map's frame stretches it to
  imageHeight: number;
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

  // Halve step by step: one big drawImage step samples without prefiltering
  // (seen in Chromium), so 1 px grid lines vanish depending on their phase.
  let source: HTMLImageElement | HTMLCanvasElement = img;
  let sw = img.width;
  let sh = img.height;
  for (;;) {
    const tw = sw > 2 * w ? Math.ceil(sw / 2) : w;
    const th = sh > 2 * h ? Math.ceil(sh / 2) : h;
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, tw, th);
    if (source instanceof HTMLCanvasElement) source.width = 0; // free the step's memory now
    source = canvas;
    sw = tw;
    sh = th;
    if (tw === w && th === h) {
      const { data } = ctx.getImageData(0, 0, w, h);
      canvas.width = 0;
      return analyseGrid(data, w, h, img.width, img.height);
    }
  }
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
  let best: { p: number; score: number } | null = null;
  for (let p = minP; p <= maxP; p *= step) {
    const score = joint(fold(x, p).z, fold(y, p).z);
    if (!best || score > best.score) best = { p, score };
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

  // Sub-pixel period and phase: locate every grid line, then fit x_k = phase + k·period.
  // The second pass re-centres the search windows on the first fit.
  let period = p;
  let phases = [x, y].map((prof) => {
    const f = fold(prof, p);
    return ((f.peak + 0.5) * p) / f.bins.length;
  });
  for (let pass = 0; pass < 2; pass++) {
    const fit = fitLines([teeth(x, period, phases[0]), teeth(y, period, phases[1])]);
    if (!fit || Math.abs(fit.period - p) > 0.05 * p) break;
    ({ period, phases } = fit);
  }

  const finalScore = joint(fold(x, period).z, fold(y, period).z);
  if (finalScore < MIN_SCORE) return null;

  const periodPx = period / scale;
  // Not rounded to whole pixels: the map takes a grid size between them, and
  // a 70.4 px grid drawn at 70 drifts a whole square off in 176 px.
  const gridSize = Math.round(periodPx * 100) / 100;
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
    offsetX: toOffset(phases[0] / scale, periodPx),
    offsetY: toOffset(phases[1] / scale, periodPx),
    confidence: Math.min(1, 0.5 + 0.5 * (finalScore - MIN_SCORE) / (FULL_SCORE - MIN_SCORE)),
    imageWidth: originalW,
    imageHeight: originalH,
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

interface Tooth {
  k: number;       // line number
  pos: number;     // measured line centre in profile px
  height: number;  // response above the mean, used as weight
}

/**
 * Centre of each grid line near phase + k·p: the centroid of the response
 * above half its local maximum (both edges of a thick line count equally).
 * Lines much weaker than the typical one (missing, outside a partial grid) are dropped.
 */
function teeth(prof: Profile, p: number, phase: number): Tooth[] {
  const { v, mean } = prof;
  const half = Math.max(1, Math.floor(p / 4));
  const found: Tooth[] = [];
  for (let k = 0; phase + k * p + half < v.length; k++) {
    const c = Math.round(phase + k * p);
    if (c - half < 0) continue;
    let top = -Infinity;
    for (let i = c - half; i <= c + half; i++) top = Math.max(top, v[i]);
    const cut = (top + mean) / 2;
    let sw = 0;
    let sx = 0;
    for (let i = c - half; i <= c + half; i++) {
      if (v[i] > cut) {
        sw += v[i] - cut;
        sx += (v[i] - cut) * i;
      }
    }
    if (sw > 0) found.push({ k, pos: sx / sw, height: top - mean });
  }
  const heights = found.map((t) => t.height).sort((a, b) => a - b);
  const typical = heights[heights.length >> 1] ?? 0;
  return found.filter((t) => t.height > 0 && t.height > 0.5 * typical);
}

/** Weighted least squares with one shared period and a phase per axis */
function fitLines(axes: Tooth[][]): { period: number; phases: number[] } | null {
  if (axes.some((ts) => ts.length < 2)) return null;
  const centres = axes.map((ts) => {
    let sw = 0;
    let sk = 0;
    let sx = 0;
    for (const t of ts) {
      sw += t.height;
      sk += t.height * t.k;
      sx += t.height * t.pos;
    }
    return { k: sk / sw, x: sx / sw };
  });
  let num = 0;
  let den = 0;
  axes.forEach((ts, a) => {
    for (const t of ts) {
      num += t.height * (t.k - centres[a].k) * (t.pos - centres[a].x);
      den += t.height * (t.k - centres[a].k) ** 2;
    }
  });
  if (!(den > 0)) return null;
  const period = num / den;
  return { period, phases: centres.map((c) => c.x - period * c.k) };
}

/** Phase in original px reduced to [0, period); within 2 px of a line at 0 counts as 0 */
function toOffset(phase: number, periodPx: number) {
  const rounded = Math.round(((phase % periodPx) + periodPx) % periodPx);
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
