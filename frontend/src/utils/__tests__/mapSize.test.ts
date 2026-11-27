import { describe, it, expect } from 'vitest';
import { withinMapLimits, feetPerSquareWithinLimits, detectedGridForMap } from '../mapSize';

describe('withinMapLimits', () => {
  it('keeps a detected grid that is already within the limits', () => {
    expect(withinMapLimits({ width: 30, height: 20, gridSize: 70 })).toEqual({ width: 30, height: 20, gridSize: 70 });
  });

  it('brings a detected grid the server would refuse within the limits', () => {
    // Detection reports squares up to 600 px, and a huge picture more than 500 of them.
    expect(withinMapLimits({ width: 640, height: 2, gridSize: 600 })).toEqual({ width: 500, height: 2, gridSize: 500 });
    expect(withinMapLimits({ width: 0, height: 3, gridSize: 5 })).toEqual({ width: 1, height: 3, gridSize: 10 });
  });
});

describe('feetPerSquareWithinLimits', () => {
  it.each([['5', 5], ['0', 1], ['250', 100], ['', 1]])('reads %j as %s', (raw, expected) => {
    expect(feetPerSquareWithinLimits(raw)).toBe(expected);
  });
});

describe('detectedGridForMap', () => {
  it('keeps a grid size between whole pixels and scales the offsets onto the frame', () => {
    // 1408 px of 70.4 px squares: the frame is the picture, the offsets as found.
    expect(detectedGridForMap({ width: 20, height: 15, gridSize: 70.4, offsetX: 40, offsetY: 12, imageWidth: 1408, imageHeight: 1056 }))
      .toEqual({ width: 20, height: 15, gridSize: 70.4, gridOffsetX: -30.4, gridOffsetY: 12 });
    // A picture twice the frame: offsets halve.
    expect(detectedGridForMap({ width: 10, height: 10, gridSize: 50, offsetX: 20, offsetY: 10, imageWidth: 1000, imageHeight: 1000 }))
      .toEqual({ width: 10, height: 10, gridSize: 50, gridOffsetX: 10, gridOffsetY: 5 });
  });
});
