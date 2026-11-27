// Ported for Mistwarden on 2026-11-27 from the author's earlier mistwarden-vtt (apps/client/src/dice), same author.
// Dice animation over the map: timing and choice of view. The 3D view
// (three.js) is only loaded on the first roll; if it fails or 'simple' is selected,
// the CSS view draws the same bodies without a second WebGL context.
import { createCssView } from './css-view';
import type { DiceMode } from './mode';
import { type PlannedDie, poseAt } from './plan';

export type Pose = ReturnType<typeof poseAt>;

/** One view of the dice; coordinates relative to the center of the area, y down. */
export interface DiceView {
  build(dice: PlannedDie[], color: string, textColor: string): void;
  frame(poses: Pose[], opacity: number, width: number, height: number): void;
  clear(): void;
  destroy(): void;
}

/** Half diameter of a die in pixels. */
export const DIE_SCALE = 34;
/** The dice stay put this long, then fade out. */
const HOLD_MS = 1800;
const FADE_MS = 400;
/** After this idle time the 3D view releases its WebGL context. */
const RELEASE_MS = 30_000;

/** Black or white, whichever is more readable on `color` (#rrggbb). */
export function readableOn(color: string): string {
  const n = Number.parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#1b1a1d' : '#ffffff';
}

export function createDiceLayer(mode: () => DiceMode) {
  const el = document.createElement('div');
  el.className = 'dice-layer';
  el.setAttribute('aria-hidden', 'true');
  let view: DiceView | null = null;
  let viewIs3d = false;
  let raf = 0;
  let release: ReturnType<typeof setTimeout> | undefined;
  let run = 0;
  const reduce = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  function drop(): void {
    cancelAnimationFrame(raf);
    view?.destroy();
    view = null;
  }

  async function viewFor(want3d: boolean): Promise<DiceView> {
    if (view && viewIs3d === want3d) return view;
    drop();
    if (want3d) {
      try {
        const { createThreeView } = await import('./three-view');
        view = createThreeView(el);
        viewIs3d = true;
        return view;
      } catch {
        // No WebGL or loading failed: simple view.
      }
    }
    view = createCssView(el);
    viewIs3d = false;
    return view;
  }

  return {
    el,
    /** Shows a roll; a running one is replaced. `color` is the roller's color. */
    async play(dice: PlannedDie[], color: string): Promise<void> {
      const current = mode();
      if (current === 'off') return;
      const id = ++run;
      clearTimeout(release);
      const v = await viewFor(current === '3d');
      if (id !== run) return;
      cancelAnimationFrame(raf);
      v.build(dice, color, readableOn(color));
      // Without motion: show the rest pose right away.
      const start = performance.now() - (reduce ? 10_000 : 0);
      const tick = (now: number) => {
        const ms = now - start;
        const poses = dice.map((d) => poseAt(d, ms));
        const settled = Math.max(...dice.map((d) => d.delay)) + 1300;
        const rest = ms - settled - (reduce ? -10_000 : 0);
        const opacity = Math.max(
          0,
          Math.min(1, 1 - (rest - HOLD_MS) / FADE_MS),
        );
        v.frame(poses, opacity, el.clientWidth, el.clientHeight);
        if (opacity > 0) {
          raf = requestAnimationFrame(tick);
          return;
        }
        v.clear();
        release = setTimeout(drop, RELEASE_MS);
      };
      raf = requestAnimationFrame(tick);
    },
    destroy(): void {
      run++;
      clearTimeout(release);
      drop();
      el.remove();
    },
  };
}
