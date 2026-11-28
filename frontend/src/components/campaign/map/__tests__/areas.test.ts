/**
 * Spell areas: one path (areaPath) for the preview, a placed area and what it
 * covers, every shape on squares, an offset grid and hexes; the centre rule
 * for tokens, between squares too; the affected list from the drawn tokens
 * alone; and the area layer drawing every element.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { aimAngle, areaPath, pointInArea, tokensInArea, type AreaFrame, type AreaSpec } from '../aoeGeometry';
import { AREA_ELEMENT_STYLES, areasAnimate, drawAreas } from '../layers/drawAreas';
import { isTokenVisibleTo } from '../tokenHitTest';
import { tokenFogCell } from '../coords';
import { recordingContext } from '@/test/recordingCanvas';
import { AREA_ELEMENTS } from '@/constants/areaLimits';
import { cellCentre } from '@/utils/tokenCentre';
import type { MapArea } from '@/types/areas';
import type { Token } from '@/types';
import type { Viewport } from '../layers/types';

const frame = (over: Partial<AreaFrame> = {}): AreaFrame => ({
  width: 10, height: 10, gridSize: 50, gridType: 'square', gridOffsetX: 0, gridOffsetY: 0,
  feetPerSquare: 5, coneRule: 'width-equals-distance', ...over,
});
const spec = (over: Partial<AreaSpec>): AreaSpec => ({
  shape: 'sphere', anchorX: 130, anchorY: 120, angle: 0, sizeFt: 10, widthFt: null, exact: false, ...over,
});
/** A token whose position is in grid squares, y counted from the bottom, as the store holds it. */
const token = (id: string, x: number, y: number, size = 1) =>
  ({ id, name: id, position: { x, y }, size: { width: size, height: size }, visible: true }) as unknown as Token;
const ids = (tokens: Token[]) => tokens.map((t) => t.id);

describe('areaPath', () => {
  it('puts a snapped circle on the centre of the square it was placed in', () => {
    const { outline, origin } = areaPath(spec({}), frame());
    expect(outline).toEqual({ kind: 'circle', centre: { x: 125, y: 125 }, radius: 100 });
    expect(origin).toEqual({ x: 125, y: 125 });
    expect(areaPath(spec({ shape: 'cylinder' }), frame()).outline).toEqual(outline);
  });

  it('puts a free circle on the point itself, and every area on a hex map', () => {
    expect(areaPath(spec({ exact: true }), frame()).outline).toMatchObject({ centre: { x: 130, y: 120 } });
    expect(areaPath(spec({}), frame({ gridType: 'hexPointy' })).outline).toMatchObject({ centre: { x: 130, y: 120 } });
  });

  it('covers whole squares with a snapped cube', () => {
    const { outline } = areaPath(spec({ shape: 'cube' }), frame());
    expect(outline).toEqual({ kind: 'polygon', points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }] });
  });

  it('starts a cone where its aim leaves the anchor square, as wide as it is long', () => {
    const { outline, origin } = areaPath(spec({ shape: 'cone', sizeFt: 15 }), frame());
    expect(origin).toEqual({ x: 150, y: 125 });
    expect(outline).toEqual({ kind: 'polygon', points: [{ x: 150, y: 125 }, { x: 300, y: 50 }, { x: 300, y: 200 }] });
    expect(areaPath(spec({ shape: 'cone', sizeFt: 15 }), frame({ coneRule: 'quarter-circle' })).outline)
      .toEqual({ kind: 'sector', centre: { x: 150, y: 125 }, radius: 150, from: -Math.PI / 4, to: Math.PI / 4 });
  });

  it('runs a line from the square edge it is aimed through, its width either side', () => {
    const { outline } = areaPath(spec({ shape: 'line', sizeFt: 30, widthFt: 5, angle: Math.PI / 2 }), frame());
    if (outline.kind !== 'polygon') throw new Error('a line is a polygon');
    const xs = outline.points.map((p) => Math.round(p.x));
    const ys = outline.points.map((p) => Math.round(p.y));
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([100, 150, 150, 450]);
  });

  it('lines up with the squares of a grid drawn with an offset', () => {
    expect(areaPath(spec({}), frame({ gridOffsetX: 20 })).outline).toMatchObject({ centre: { x: 145, y: 125 } });
  });

  it('aims from the pivot, so the preview and the placed area agree', () => {
    expect(aimAngle({ x: 130, y: 120 }, false, { x: 225, y: 125 }, frame())).toBe(0);
    expect(aimAngle({ x: 130, y: 120 }, true, { x: 130, y: 220 }, frame())).toBeCloseTo(Math.PI / 2);
  });
});

describe('tokensInArea: a token is in when its centre is', () => {
  const tokens = [token('in', 2, 7), token('out', 5, 7), token('between', 3.5, 7), token('large', 1, 6, 2)];

  it('in a circle, a token between squares and a large one by their centres', () => {
    expect(ids(tokensInArea(tokens, areaPath(spec({}), frame()).outline, frame()))).toEqual(['in', 'between', 'large']);
  });

  it('in a cone and in a quarter circle, not beside them', () => {
    const cone = [token('ahead', 4, 7), token('above', 4, 9)];
    expect(ids(tokensInArea(cone, areaPath(spec({ shape: 'cone', sizeFt: 15 }), frame()).outline, frame()))).toEqual(['ahead']);
    const sector = areaPath(spec({ shape: 'cone', sizeFt: 15 }), frame({ coneRule: 'quarter-circle' })).outline;
    expect(ids(tokensInArea(cone, sector, frame()))).toEqual(['ahead']);
    expect(pointInArea(sector, { x: 150, y: 25 })).toBe(false);
  });

  it('in a line, not beside it', () => {
    const line = areaPath(spec({ shape: 'line', sizeFt: 30, widthFt: 5, angle: Math.PI / 2 }), frame()).outline;
    expect(ids(tokensInArea([token('on', 2, 4), token('beside', 3, 4)], line, frame()))).toEqual(['on']);
  });

  it('on an offset grid and on hexes', () => {
    expect(ids(tokensInArea([token('in', 2, 7)], areaPath(spec({}), frame({ gridOffsetX: 20 })).outline, frame({ gridOffsetX: 20 })))).toEqual(['in']);
    const hex = frame({ gridType: 'hexPointy' });
    const c = cellCentre({ x: 4, y: 4 }, hex);
    const hexes = [token('here', 4, 4), token('far', 9, 0)];
    expect(ids(tokensInArea(hexes, areaPath(spec({ anchorX: c.x, anchorY: c.y }), hex).outline, hex))).toEqual(['here']);
  });

  it('names none the screen does not draw: a token under manual fog is left out', () => {
    const map = frame();
    const hidden = token('fogged', 3, 7);
    const shown = token('seen', 2, 7);
    // The viewer's revealed cells hold the seen token's cell alone.
    const revealed = new Set([tokenFogCell(shown as never, map)]);
    const view = { isGM: false, revealedCells: revealed, isOwnToken: () => false, gmShowSpiritTokens: false, mapWidth: 10, mapHeight: 10, grid: map };
    const drawn = [hidden, shown].filter((t) => isTokenVisibleTo(t, view));
    const outline = areaPath(spec({}), map).outline;
    expect(ids(tokensInArea([hidden, shown], outline, map))).toEqual(['fogged', 'seen']);
    expect(ids(tokensInArea(drawn, outline, map))).toEqual(['seen']);
  });
});

describe('the area layer', () => {
  afterEach(() => vi.restoreAllMocks());
  const viewport: Viewport = { zoom: 1, panOffset: { x: 0, y: 0 }, gridSize: 50, mapWidth: 10, mapHeight: 10 };
  const area = (element: string, over: Partial<MapArea> = {}): MapArea => ({
    id: element, authorId: null, audience: 'ALL', shape: 'cone', anchorX: 130, anchorY: 120, angle: 0.3, sizeFt: 15, widthFt: null,
    exact: false, element, animated: true, label: null, spellId: null, createdAt: '2026-11-28T00:00:00.000Z', ...over,
  });

  it('draws every element with its colour, pattern and label, moving or still', () => {
    // Tiles are painted on canvases of their own; give them a recording context too.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return recordingContext(this).ctx as never;
    });
    const areas = AREA_ELEMENTS.map((e) => area(e));
    for (const now of [1234, null]) {
      const { ctx, calls } = recordingContext(document.createElement('canvas'));
      const fills: unknown[] = [];
      const fill = new Proxy(ctx, {
        get(target, prop) {
          if (prop === 'fill') return () => fills.push((target as unknown as { fillStyle: unknown }).fillStyle);
          const v = Reflect.get(target, prop);
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set(target, prop, value) { return Reflect.set(target, prop, value); },
      });
      drawAreas(fill as CanvasRenderingContext2D, { areas, frame: frame(), showGmOnly: false, now, selectedId: 'fire', highlighted: [{ x: 1, y: 1, r: 5 }], visible: null }, viewport);
      for (const e of AREA_ELEMENTS) expect(fills).toContain(AREA_ELEMENT_STYLES[e].fill);
      expect(calls.filter((c) => c.method === 'fillText')).toHaveLength(AREA_ELEMENTS.length);
      expect(calls.some((c) => c.method === 'createPattern')).toBe(true);
    }
  });

  it('draws an area for the GM alone for the GM only', () => {
    const { ctx, calls } = recordingContext(document.createElement('canvas'));
    const state = { areas: [area('fire', { audience: 'GM', label: 'Trap' })], frame: frame(), now: null, selectedId: null, highlighted: [], visible: null };
    drawAreas(ctx, { ...state, showGmOnly: false }, viewport);
    expect(calls.some((c) => c.method === 'fillText')).toBe(false);
    drawAreas(ctx, { ...state, showGmOnly: true }, viewport);
    expect(calls.find((c) => c.method === 'fillText')?.args[0]).toBe('Trap');
  });

  it('asks for the timer only while a moving area is on the screen', () => {
    const screen = { minX: 0, minY: 0, maxX: 500, maxY: 500 };
    expect(areasAnimate([area('fire')], frame(), false, screen)).toBe(true);
    expect(areasAnimate([area('none')], frame(), false, screen)).toBe(false);
    expect(areasAnimate([area('fire', { animated: false })], frame(), false, screen)).toBe(false);
    expect(areasAnimate([area('fire')], frame(), false, { minX: 2000, minY: 2000, maxX: 2500, maxY: 2500 })).toBe(false);
    expect(areasAnimate([area('fire', { audience: 'GM' })], frame(), false, screen)).toBe(false);
  });
});
