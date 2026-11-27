// Added for Mistwarden on 2026-11-27.
import { describe, expect, it } from 'vitest';
import { cellAtPixel, cellFromTop, fogCellsInRect, gridForPicture, topRowOf } from '../src/coords.ts';
import { pictureInfo } from '../src/image.ts';
import { gridPng } from './png.ts';

describe('token cells (bottom-left origin)', () => {
  it('turns a top-left square into the bottom-left cell the server stores', () => {
    // 10 rows high: the top row is y 9 for a 1-square token, y 8 for a 2-square one.
    expect(cellFromTop(3, 0, 1, 10)).toEqual({ x: 3, y: 9 });
    expect(cellFromTop(3, 0, 2, 10)).toEqual({ x: 3, y: 8 });
    expect(cellFromTop(0, 9, 1, 10)).toEqual({ x: 0, y: 0 });
  });

  it('gives back the top row, the inverse of cellFromTop', () => {
    for (const size of [1, 2, 3]) {
      for (let row = 0; row + size <= 10; row++) expect(topRowOf(cellFromTop(0, row, size, 10).y, size, 10)).toBe(row);
    }
  });

  it('finds the cell under a map pixel', () => {
    const map = { width: 20, height: 10, gridSize: 50 };
    expect(cellAtPixel(0, 0, map)).toEqual({ x: 0, y: 9 });
    expect(cellAtPixel(999, 499, map)).toEqual({ x: 19, y: 0 });
    expect(cellAtPixel(125, 260, map)).toEqual({ x: 2, y: 4 });
  });
});

describe('grid from the original picture', () => {
  it('counts squares from source pixels per square', () => {
    expect(gridForPicture(3000, 2000, { gridPx: 100 })).toEqual({ width: 30, height: 20, gridSize: 100, exact: true });
  });

  it('derives the square size from squares across', () => {
    expect(gridForPicture(5000, 2500, { squaresAcross: 50 })).toEqual({ width: 50, height: 25, gridSize: 100, exact: true });
  });

  it('says when the picture does not divide evenly', () => {
    expect(gridForPicture(1030, 700, { gridPx: 70 }).exact).toBe(false);
  });

  it('refuses sizes the server refuses', () => {
    expect(() => gridForPicture(1000, 1000, { gridPx: 5 })).toThrow(/10 to 500/);
    expect(() => gridForPicture(60000, 100, { gridPx: 100 })).toThrow(/600 squares wide/);
    expect(() => gridForPicture(1000, 1000, {})).toThrow(/gridPx/);
  });
});

describe('fog cells in a pixel rectangle (top-left origin, row-major)', () => {
  const map = { width: 4, height: 3, gridSize: 10 };

  it('covers every square the rectangle touches', () => {
    expect(fogCellsInRect(map, { x: 5, y: 5, width: 10, height: 10 })).toEqual([0, 1, 4, 5]);
  });

  it('keeps an exact square to itself', () => {
    expect(fogCellsInRect(map, { x: 10, y: 10, width: 10, height: 10 })).toEqual([5]);
  });

  it('clips to the map and ignores rectangles off it', () => {
    expect(fogCellsInRect(map, { x: -50, y: 25, width: 1000, height: 1000 })).toEqual([8, 9, 10, 11]);
    expect(fogCellsInRect(map, { x: 40, y: 0, width: 10, height: 10 })).toEqual([]);
  });
});

describe('picture header', () => {
  it('reads a PNG size', () => {
    expect(pictureInfo(gridPng(123, 45))).toEqual({ mime: 'image/png', width: 123, height: 45 });
  });

  it('refuses what is not a picture', () => {
    expect(() => pictureInfo(Buffer.from('hello world, not a picture at all'))).toThrow(/Not a PNG/);
  });
});
