// Ported for Mistwarden on 2026-11-27 from the author's earlier mistwarden-vtt (apps/client/src/dice), same author.
// Roll plan: turns the server result into a fixed sequence - which dice fly, where to,
// how they spin and which face they end on. Everything depends only on the roll, so
// every device shows the same flight. No rendering, no dependencies.

/** One term of a server roll: only dice terms with `sides` and `results` are animated. */
export interface RollTerm {
  type: 'dice' | 'modifier';
  sides?: number;
  results?: number[];
}

import { type DieKind, norm, type Vec } from './geometry';

/** Rolls with more dice than this are not animated; the result then only appears in the log. */
export const MAX_ANIMATED_DICE = 20;
/** Flight duration of a die and gap between starts, in milliseconds. */
export const FLIGHT_MS = 1300;
const STAGGER_MS = 80;
/** Spacing of the resting spots in pixels. */
const SPACING = 96;
const PER_ROW = 5;

export interface PlannedDie {
  kind: DieKind;
  /** Label of each face. */
  labels: string[];
  /** Index of the face that ends up on top. */
  face: number;
  /** Start and target relative to the center of the play area, in pixels (y down). */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Tumble axis and total angle in radians. */
  axis: Vec;
  spin: number;
  /** Start delay in milliseconds. */
  delay: number;
}

const KINDS: readonly number[] = [4, 6, 8, 10, 12, 20];
const numbers = (n: number) =>
  Array.from({ length: n }, (_, i) => String(i + 1));
const TENS = Array.from({ length: 10 }, (_, i) => `${i}0`);
const ONES = Array.from({ length: 10 }, (_, i) => String(i));

/** Dice of a result: the d100 flies as a tens die and a ones die. */
function diceOf(
  terms: RollTerm[],
): Pick<PlannedDie, 'kind' | 'labels' | 'face'>[] {
  const out: Pick<PlannedDie, 'kind' | 'labels' | 'face'>[] = [];
  for (const term of terms) {
    if (term.type !== 'dice' || !term.sides || !term.results) continue;
    for (const result of term.results) {
      if (term.sides === 100) {
        out.push(
          { kind: 10, labels: TENS, face: Math.floor((result % 100) / 10) },
          { kind: 10, labels: ONES, face: result % 10 },
        );
      } else if (KINDS.includes(term.sides)) {
        out.push({
          kind: term.sides as DieKind,
          labels: numbers(term.sides),
          face: result - 1,
        });
      }
    }
  }
  return out;
}

/** Small seeded random generator (mulberry32 over a string hash). */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan for a roll, or null if nothing is animated (no matching dice or
 * more than `MAX_ANIMATED_DICE`). `seed` is the roll's ID.
 */
export function planRoll(terms: RollTerm[], seed: string): PlannedDie[] | null {
  const dice = diceOf(terms);
  if (dice.length === 0 || dice.length > MAX_ANIMATED_DICE) return null;
  const random = seeded(seed);
  const rows = Math.ceil(dice.length / PER_ROW);
  const stagger = Math.min(STAGGER_MS, 600 / dice.length);
  return dice.map((die, i): PlannedDie => {
    const row = Math.floor(i / PER_ROW);
    const inRow = Math.min(PER_ROW, dice.length - row * PER_ROW);
    const to = {
      x: ((i % PER_ROW) - (inRow - 1) / 2) * SPACING + (random() - 0.5) * 14,
      y: (row - (rows - 1) / 2) * SPACING + (random() - 0.5) * 14,
    };
    return {
      ...die,
      to,
      // The dice enter the picture from the bottom left.
      from: { x: to.x - 220, y: to.y + 420 },
      axis: norm([random() - 0.5, random() - 0.5, random() - 0.5]),
      spin: 11 + random() * 5,
      delay: i * stagger,
    };
  });
}

/** Pose of a die `ms` milliseconds after the roll started. */
export function poseAt(
  die: PlannedDie,
  ms: number,
): { x: number; y: number; z: number; angle: number; done: boolean } {
  const p = Math.max(0, Math.min(1, (ms - die.delay) / FLIGHT_MS));
  const ease = 1 - (1 - p) ** 3;
  return {
    x: die.from.x + (die.to.x - die.from.x) * ease,
    y: die.from.y + (die.to.y - die.from.y) * ease,
    // An arc that flattens out toward the end.
    z: Math.sin(Math.min(1, p * 1.25) * Math.PI) * 150 * (1 - p),
    // The tumble fades out; at 0 the die is in its rest pose.
    angle: (1 - ease) * die.spin,
    done: p >= 1,
  };
}
