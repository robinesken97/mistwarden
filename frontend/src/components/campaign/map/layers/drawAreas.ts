// ============================================
// Spell areas placed on the map, each in its element's colour and pattern.
//
// Drawn on the overlay with the drawings, over a player's fog and the lit
// darkness, so the table sees a template laid over ground it cannot see,
// as it sees the drawings there. An area for the GM alone shows in the
// GM's own view only.
//
// Each element's pattern is a small tile painted once per page and repeated
// (no blur, no filter: Safari 17 has no canvas filter). An animated area
// moves its tile, flickers or sends rings out on the overlay's mist timer,
// about ten frames a second, and stands still when `now` is null (reduced
// motion, the device setting off, or the area made still).
// ============================================

import type { MapArea } from '@/types/areas';
import type { AreaElement } from '@/constants/areaLimits';
import { areaBounds, areaPath, traceArea, type AreaFrame, type AreaPath } from '../aoeGeometry';
import { areaSizeLabel } from './drawOverlays';
import type { Viewport } from './types';

/** How an element moves while animated. */
type Motion = 'drift' | 'flicker' | 'rings' | 'crackle' | 'pulse' | 'swirl' | 'none';

interface ElementStyle {
  /** The chip's name in the AoE panel. */
  name: string;
  fill: string;
  stroke: string;
  /** The label's colour, readable on the fill. */
  ink: string;
  motion: Motion;
  /** Paints one tile of the pattern, `variant` 0 or 1, into a square `size` across. */
  tile?: (c: CanvasRenderingContext2D, size: number, variant: number) => void;
}

const TILE = 64;
const TAU = Math.PI * 2;

/** A small seeded spread of points, so every page paints the same tile. */
function spots(n: number, seed: number): Array<[number, number, number]> {
  let s = seed;
  const next = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: n }, () => [next(), next(), next()]);
}

function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, inner: string, outer: string): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

/** Every element's look, `none` a plain neutral template. */
export const AREA_ELEMENT_STYLES: Record<AreaElement, ElementStyle> = {
  fire: {
    name: 'Fire', fill: 'rgba(234, 88, 12, 0.32)', stroke: 'rgba(249, 115, 22, 0.95)', ink: '#fed7aa', motion: 'flicker',
    tile(c, s) {
      for (const [x, y, k] of spots(7, 3)) {
        const cx = x * s;
        const cy = y * s;
        const h = 10 + k * 12;
        const g = c.createLinearGradient(cx, cy + h / 2, cx, cy - h / 2);
        g.addColorStop(0, 'rgba(220, 38, 38, 0.75)');
        g.addColorStop(0.6, 'rgba(249, 115, 22, 0.7)');
        g.addColorStop(1, 'rgba(253, 224, 71, 0.6)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(cx, cy - h / 2);
        c.quadraticCurveTo(cx + h * 0.45, cy, cx, cy + h / 2);
        c.quadraticCurveTo(cx - h * 0.45, cy, cx, cy - h / 2);
        c.fill();
      }
    },
  },
  cold: {
    name: 'Cold', fill: 'rgba(186, 230, 253, 0.3)', stroke: 'rgba(125, 211, 252, 0.95)', ink: '#e0f2fe', motion: 'drift',
    tile(c, s) {
      c.strokeStyle = 'rgba(240, 249, 255, 0.85)';
      c.lineWidth = 1.2;
      for (const [x, y, k] of spots(5, 11)) {
        const r = 4 + k * 5;
        for (let a = 0; a < 6; a++) {
          const t = (a / 6) * TAU;
          c.beginPath();
          c.moveTo(x * s, y * s);
          c.lineTo(x * s + Math.cos(t) * r, y * s + Math.sin(t) * r);
          c.stroke();
        }
      }
    },
  },
  water: {
    name: 'Water', fill: 'rgba(37, 99, 235, 0.28)', stroke: 'rgba(59, 130, 246, 0.95)', ink: '#dbeafe', motion: 'drift',
    tile(c, s) {
      c.strokeStyle = 'rgba(191, 219, 254, 0.7)';
      c.lineWidth = 1.5;
      for (const [x, y, k] of spots(4, 23)) {
        for (const r of [4, 8 + k * 4]) {
          c.beginPath();
          c.arc(x * s, y * s, r, Math.PI * 0.15, Math.PI * 0.85);
          c.stroke();
        }
      }
    },
  },
  lightning: {
    name: 'Lightning', fill: 'rgba(250, 204, 21, 0.22)', stroke: 'rgba(254, 240, 138, 1)', ink: '#fefce8', motion: 'crackle',
    tile(c, s, variant) {
      c.strokeStyle = 'rgba(255, 255, 240, 0.9)';
      c.lineWidth = 1.6;
      for (const [x, , k] of spots(3, variant ? 41 : 37)) {
        c.beginPath();
        let px = x * s;
        let py = 0;
        c.moveTo(px, py);
        while (py < s) {
          px += (k - 0.5) * 10 + (py % 16 < 8 ? 6 : -6);
          py += 8;
          c.lineTo(px, py);
        }
        c.stroke();
      }
    },
  },
  acid: {
    name: 'Acid', fill: 'rgba(132, 204, 22, 0.3)', stroke: 'rgba(163, 230, 53, 0.95)', ink: '#ecfccb', motion: 'drift',
    tile(c, s) {
      for (const [x, y, k] of spots(6, 53)) {
        const r = 2 + k * 4;
        glow(c, x * s, y * s, r, 'rgba(217, 249, 157, 0.9)', 'rgba(101, 163, 13, 0.35)');
      }
    },
  },
  poison: {
    name: 'Poison', fill: 'rgba(101, 163, 13, 0.24)', stroke: 'rgba(132, 204, 22, 0.9)', ink: '#f7fee7', motion: 'drift',
    tile(c, s) {
      spots(5, 67).forEach(([x, y, k], i) => {
        glow(c, x * s, y * s, 10 + k * 10, i % 2 ? 'rgba(139, 92, 246, 0.45)' : 'rgba(132, 204, 22, 0.45)', 'rgba(0, 0, 0, 0)');
      });
    },
  },
  necrotic: {
    name: 'Necrotic', fill: 'rgba(46, 16, 101, 0.4)', stroke: 'rgba(109, 40, 217, 0.95)', ink: '#ede9fe', motion: 'drift',
    tile(c, s) {
      for (const [x, y, k] of spots(4, 79)) glow(c, x * s, y * s, 10 + k * 8, 'rgba(10, 5, 20, 0.6)', 'rgba(0, 0, 0, 0)');
      c.strokeStyle = 'rgba(167, 139, 250, 0.5)';
      c.lineWidth = 1.2;
      for (const [x, y] of spots(3, 83)) {
        c.beginPath();
        c.moveTo(x * s, y * s);
        c.bezierCurveTo(x * s + 8, y * s - 10, x * s - 8, y * s - 16, x * s + 4, y * s - 24);
        c.stroke();
      }
    },
  },
  radiant: {
    name: 'Radiant', fill: 'rgba(250, 204, 21, 0.25)', stroke: 'rgba(253, 224, 71, 1)', ink: '#fffbeb', motion: 'pulse',
    tile(c, s) {
      for (const [x, y, k] of spots(4, 97)) {
        glow(c, x * s, y * s, 6 + k * 6, 'rgba(255, 251, 235, 0.9)', 'rgba(250, 204, 21, 0)');
        c.strokeStyle = 'rgba(254, 240, 138, 0.6)';
        c.lineWidth = 1;
        for (let a = 0; a < 8; a++) {
          const t = (a / 8) * TAU;
          c.beginPath();
          c.moveTo(x * s + Math.cos(t) * 4, y * s + Math.sin(t) * 4);
          c.lineTo(x * s + Math.cos(t) * 11, y * s + Math.sin(t) * 11);
          c.stroke();
        }
      }
    },
  },
  thunder: {
    // Rings from where it starts, drawn round the area rather than tiled.
    name: 'Thunder', fill: 'rgba(100, 116, 139, 0.3)', stroke: 'rgba(148, 163, 184, 0.95)', ink: '#f1f5f9', motion: 'rings',
  },
  force: {
    name: 'Force', fill: 'rgba(167, 139, 250, 0.2)', stroke: 'rgba(196, 181, 253, 0.95)', ink: '#f5f3ff', motion: 'pulse',
    tile(c, s) {
      c.strokeStyle = 'rgba(221, 214, 254, 0.55)';
      c.lineWidth = 1;
      const r = s / 4;
      const h = (Math.sqrt(3) / 2) * r;
      for (let row = -1; row < 4; row++) {
        for (let col = -1; col < 3; col++) {
          const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0);
          const cy = row * h;
          c.beginPath();
          for (let a = 0; a <= 6; a++) {
            const t = (a / 6) * TAU;
            const px = cx + Math.cos(t) * r;
            const py = cy + Math.sin(t) * r;
            if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.stroke();
        }
      }
    },
  },
  psychic: {
    name: 'Psychic', fill: 'rgba(219, 39, 119, 0.25)', stroke: 'rgba(236, 72, 153, 0.95)', ink: '#fce7f3', motion: 'swirl',
    tile(c, s) {
      c.lineWidth = 1.5;
      spots(3, 113).forEach(([x, y], i) => {
        c.strokeStyle = i % 2 ? 'rgba(244, 114, 182, 0.75)' : 'rgba(217, 70, 239, 0.75)';
        c.beginPath();
        for (let t = 0; t < 3 * TAU; t += 0.3) {
          const r = t * 1.3;
          const px = x * s + Math.cos(t) * r;
          const py = y * s + Math.sin(t) * r;
          if (t === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
      });
    },
  },
  none: { name: 'None', fill: 'rgba(120, 113, 108, 0.22)', stroke: 'rgba(87, 83, 78, 0.9)', ink: '#fafaf9', motion: 'none' },
};

/** An element's style, a stored name this page does not know drawn as none. */
export function areaStyle(element: string): ElementStyle {
  return (AREA_ELEMENT_STYLES as Record<string, ElementStyle | undefined>)[element] ?? AREA_ELEMENT_STYLES.none;
}

/** The painted tiles, by element and variant; null where this page has no canvas to paint on. */
const tiles = new Map<string, HTMLCanvasElement | null>();

function tileFor(element: string, variant: number): HTMLCanvasElement | null {
  const style = areaStyle(element);
  if (!style.tile) return null;
  const key = `${element}:${variant}`;
  if (tiles.has(key)) return tiles.get(key)!;
  let canvas: HTMLCanvasElement | null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const c = canvas.getContext('2d');
    if (c) style.tile(c, TILE, variant);
    else canvas = null;
  } catch {
    canvas = null;
  }
  tiles.set(key, canvas);
  return canvas;
}

/** Whether an area moves at all when animated. */
const moves = (area: Pick<MapArea, 'animated' | 'element'>) => area.animated && areaStyle(area.element).motion !== 'none';

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const overlaps = (a: Box, b: Box | null) => !b || (a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY);

/**
 * Whether any area this viewer is shown would move on the screen now:
 * animated, of an element that moves, and in `visible`. The overlay's timer
 * runs for it, so a map whose areas are off screen or still costs nothing.
 */
export function areasAnimate(areas: readonly MapArea[], frame: AreaFrame, showGmOnly: boolean, visible: Box | null): boolean {
  return areas.some((a) => (showGmOnly || a.audience === 'ALL') && moves(a) && overlaps(areaBounds(areaPath(a, frame).outline), visible));
}

export interface AreasLayerState {
  areas: readonly MapArea[];
  frame: AreaFrame;
  showGmOnly: boolean;
  /** performance.now() while areas move, null to hold every one still. */
  now: number | null;
  /** The area tapped, drawn with a ring. */
  selectedId: string | null;
  /** The centres and radii of the tokens the selected area covers, ringed. */
  highlighted: ReadonlyArray<{ x: number; y: number; r: number }>;
  /** The part of the map on screen; null draws everything. */
  visible: Box | null;
}

function fillPattern(ctx: CanvasRenderingContext2D, area: MapArea, path: AreaPath, box: Box, now: number | null): void {
  const style = areaStyle(area.element);
  const t = now !== null && area.animated ? now / 1000 : 0;
  if (style.motion === 'rings') {
    // Rings sent out from where the area starts, one every second.
    const { origin } = path;
    const reach = Math.max(box.maxX - box.minX, box.maxY - box.minY);
    const step = Math.max(reach / 4, 8);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.lineWidth = Math.max(2, step / 8);
    for (let r = (t * step) % step; r < reach * 1.5; r += step) {
      if (r <= 0) continue;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, TAU);
      ctx.stroke();
    }
    return;
  }
  const tile = tileFor(area.element, style.motion === 'crackle' && Math.floor(t * 6) % 2 ? 1 : 0);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  if (style.motion === 'flicker') ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 11) * Math.sin(t * 7.3);
  if (style.motion === 'pulse') ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 2.5);
  // Moving the context moves where the tile starts, so the pattern drifts or turns.
  let dx = 0;
  let dy = 0;
  if (style.motion === 'drift') {
    dx = (t * 6) % TILE;
    dy = (t * 4) % TILE;
  } else if (style.motion === 'flicker') {
    dy = -((t * 14) % TILE);
  }
  if (style.motion === 'swirl') {
    ctx.translate(path.origin.x, path.origin.y);
    ctx.rotate(t * 0.4);
    ctx.translate(-path.origin.x, -path.origin.y);
  }
  ctx.translate(dx, dy);
  ctx.fillStyle = pattern;
  // Big enough to cover the box however the context turned.
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  ctx.fillRect(box.minX - pad - dx, box.minY - pad - dy, (box.maxX - box.minX) + pad * 2, (box.maxY - box.minY) + pad * 2);
  ctx.restore();
}

/** Every area this viewer is shown, oldest first, so the newest lies on top. */
export function drawAreas(ctx: CanvasRenderingContext2D, state: AreasLayerState, viewport: Viewport): void {
  const { zoom } = viewport;
  for (const area of state.areas) {
    if (!state.showGmOnly && area.audience !== 'ALL') continue;
    const path = areaPath(area, state.frame);
    const box = areaBounds(path.outline);
    if (!overlaps(box, state.visible)) continue;
    const style = areaStyle(area.element);
    ctx.save();
    traceArea(ctx, path.outline);
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.save();
    ctx.clip();
    fillPattern(ctx, area, path, box, moves(area) ? state.now : null);
    ctx.restore();
    traceArea(ctx, path.outline);
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 2 / zoom;
    if (area.audience === 'GM') ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.stroke();
    if (area.id === state.selectedId) {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 4 / zoom;
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // The label, or the size, over where it starts.
    const text = area.label ?? areaSizeLabel(area);
    const fontSize = Math.max(10, 12 / zoom);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const tw = ctx.measureText(text).width;
    const pad = 4 / zoom;
    const { x: ox, y: oy } = path.origin;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(ox - tw / 2 - pad, oy - fontSize * 2 - pad, tw + pad * 2, fontSize + pad * 2);
    ctx.fillStyle = style.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, ox, oy - fontSize - 2 / zoom);
    ctx.restore();
  }

  if (state.highlighted.length > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 3 / zoom;
    for (const h of state.highlighted) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}
