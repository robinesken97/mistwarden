/**
 * The wide layout's rail: one column while it fits the map's height with
 * 16 px to spare, else two (layout spec, frames w1, m1, p5).
 */
import { it, expect } from 'vitest';
import { railColumnHeight, railTwoColumns, railWidth } from '../railLayout';

// The GM's rail: view 5 (zoom out, zoom %, zoom in, fit, grid), tools 5, GM tools 1.
const GM = [5, 5, 1];
const PLAYER = [5, 4, 0];

it('measures a column as the spec does: cells, gaps, a line between groups, padding', () => {
  expect(railColumnHeight(GM, 40)).toBe(11 * 40 + 10 * 4 + 2 * 5 + 8);
  expect(railColumnHeight(GM, 44)).toBe(11 * 44 + 10 * 4 + 2 * 5 + 8);
  // An empty group draws no line.
  expect(railColumnHeight(PLAYER, 40)).toBe(9 * 40 + 8 * 4 + 5 + 8);
});

it('stays one column while it fits with 16 px to spare, and splits a pixel shorter', () => {
  const fits = railColumnHeight(GM, 40) + 16;
  expect(railTwoColumns(GM, 40, fits)).toBe(false);
  expect(railTwoColumns(GM, 40, fits - 1)).toBe(true);
  // The iPad landscape map (716 px under the 52 px bar) keeps one column of 44 px cells.
  expect(railTwoColumns(GM, 44, 716)).toBe(false);
  // Before the map is measured, one column.
  expect(railTwoColumns(GM, 40, 0)).toBe(false);
});

it('is one or two cells wide, with its padding and border', () => {
  expect(railWidth(1, 40)).toBe(50);
  expect(railWidth(2, 40)).toBe(94);
  expect(railWidth(1, 44)).toBe(54);
});
