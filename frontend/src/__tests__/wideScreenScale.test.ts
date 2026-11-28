/**
 * A very wide screen scales the page up.
 *
 * On a 4K monitor at 100 % the app was drawn at a laptop's size, its 12 px
 * labels tiny from a desk's distance. index.css grows the root font from
 * 2200 px of width, so every rem size grows with it, and leaves everything
 * narrower alone: the laptops and the 1920 px monitors look as they did.
 * jsdom evaluates no media query, so this reads the rule and works it out at
 * the widths that matter, with the browser's usual 16 px text.
 */
import { describe, it, expect } from 'vitest';
import indexCss from '../index.css?raw';

const RULE =
  /@media \(min-width: (\d+)px\) \{\s*html \{\s*font-size: clamp\((\d+)%, calc\(100% \+ \(100vw - (\d+)px\) \/ (\d+)\), (\d+)%\);\s*\}\s*\}/;

/** The root font size in px at a window `width` px wide, by the rule in index.css. */
function rootPx(width: number): number {
  const match = RULE.exec(indexCss);
  if (!match) throw new Error('index.css has no wide-screen font rule in the expected form');
  const [from, low, start, per, high] = match.slice(1).map(Number);
  if (width < from) return 16;
  return Math.min(Math.max(16 + (width - start) / per, (16 * low) / 100), (16 * high) / 100);
}

describe('the wide-screen scale', () => {
  it('leaves every window up to 2200 px at the browser size', () => {
    for (const width of [390, 1024, 1440, 1512, 1920, 2199, 2200]) expect(rootPx(width)).toBe(16);
  });

  it('is about 112 % at 2560 and 150 % at 3840', () => {
    expect(rootPx(2560) / 16).toBeCloseTo(1.125, 3);
    expect(rootPx(3840) / 16).toBe(1.5);
  });

  it('grows steadily in between and never past 150 %', () => {
    let last = 16;
    for (let width = 2200; width <= 5120; width += 40) {
      const px = rootPx(width);
      expect(px).toBeGreaterThanOrEqual(last);
      expect(px).toBeLessThanOrEqual(24);
      last = px;
    }
  });
});
