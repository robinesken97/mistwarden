// ============================================
// Grid overlay layer.
// Pure: no React, no component closures.
//
// Squares or hexes over the map's frame, placed by the grid's type and
// offset (utils/tokenCentre.ts). Every edge is drawn once, only over the part
// of the frame on screen, as one path stroked once: a 100 by 100 hex map
// zoomed out is some 11,000 hexes, and a stroke per line is what an older
// iPad cannot keep up with.
// ============================================

import { cellAt, cellCentre, isHexGrid, squareOrigin } from '@/utils/tokenCentre';
import { mapSizePx, viewportFrame, type Viewport } from './types';

/** How the GM has the grid drawn for everyone on the scene (the map's gridColor, gridOpacity, gridLineWidth). */
export interface GridLook {
  /** #rrggbb */
  color: string;
  /** 0.1 to 1 */
  opacity: number;
  /** On-screen pixels whatever the zoom: 1 thin, 2 medium, 3 thick. */
  lineWidth: number;
}

/** A map saved before the grid had a look of its own is drawn as every grid was: black at 40 %, 2 px. */
export const GRID_LOOK_DEFAULT: GridLook = { color: '#000000', opacity: 0.4, lineWidth: 2 };

/** The map's grid look, its absent fields (older payloads) as the default. */
export const gridLookOf = (map: { gridColor?: string; gridOpacity?: number; gridLineWidth?: number }): GridLook => ({
  color: map.gridColor ?? GRID_LOOK_DEFAULT.color,
  opacity: map.gridOpacity ?? GRID_LOOK_DEFAULT.opacity,
  lineWidth: map.gridLineWidth ?? GRID_LOOK_DEFAULT.lineWidth,
});

/** The stroke a grid look draws with at a zoom: its colour at its opacity, its width kept on screen. */
export function gridStroke(look: GridLook, zoom: number): { strokeStyle: string; lineWidth: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(look.color)?.[1] ?? '000000';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = Math.min(1, Math.max(0, look.opacity));
  return { strokeStyle: `rgba(${r}, ${g}, ${b}, ${a})`, lineWidth: look.lineWidth / zoom };
}

export interface GridDrawState extends GridLook {
  /** The part of the map on screen, in map pixels; null or absent draws the whole frame. */
  visible?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

const SQRT3 = Math.sqrt(3);

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  state: GridDrawState,
  viewport: Viewport
): void {
  const { w: mapWidthPx, h: mapHeightPx } = mapSizePx(viewport);
  const frame = viewportFrame(viewport);
  const g = viewport.gridSize;
  if (!(g > 0)) return;
  const v = state.visible;
  const minX = Math.max(0, v?.minX ?? 0);
  const minY = Math.max(0, v?.minY ?? 0);
  const maxX = Math.min(mapWidthPx, v?.maxX ?? mapWidthPx);
  const maxY = Math.min(mapHeightPx, v?.maxY ?? mapHeightPx);
  if (minX > maxX || minY > maxY) return;

  const stroke = gridStroke(state, viewport.zoom);
  ctx.strokeStyle = stroke.strokeStyle;
  ctx.lineWidth = stroke.lineWidth; // constant on-screen width regardless of zoom
  ctx.beginPath();

  if (!isHexGrid(frame)) {
    // Lines at the origin plus whole squares, those within the frame.
    const o = squareOrigin(frame);
    const eps = g * 1e-6;
    for (let k = Math.ceil((minX - o.x - eps) / g); o.x + k * g <= maxX + eps; k++) {
      const x = o.x + k * g;
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let k = Math.ceil((minY - o.y - eps) / g); o.y + k * g <= maxY + eps; k++) {
      const y = o.y + k * g;
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
    return;
  }

  // Hexes: each draws three of its six edges, the other three being its
  // neighbours'. The range reaches two cells past the area on screen, so the
  // hexes along its edges get the edges their neighbours there would draw,
  // and the frame's own edge is clipped.
  const flat = frame.gridType === 'hexFlat';
  const corners = [cellAt({ x: minX, y: minY }, frame), cellAt({ x: maxX, y: minY }, frame), cellAt({ x: minX, y: maxY }, frame), cellAt({ x: maxX, y: maxY }, frame)];
  const x0 = Math.min(...corners.map((c) => c.x)) - 2;
  const x1 = Math.max(...corners.map((c) => c.x)) + 2;
  const y0 = Math.min(...corners.map((c) => c.y)) - 2;
  const y1 = Math.max(...corners.map((c) => c.y)) + 2;
  const r = g / SQRT3; // centre to corner
  // Along a line of hexes (pointy: x, flat: y) and across it, as map pixels.
  const point = (along: number, across: number) => (flat ? ctx.lineTo(across, along) : ctx.lineTo(along, across));
  const start = (along: number, across: number) => (flat ? ctx.moveTo(across, along) : ctx.moveTo(along, across));
  // From the corner before the point across the top, over the point, to the far side.
  const edges = (a: number, c: number) => {
    start(a - g / 2, c - r / 2);
    point(a, c - r);
    point(a + g / 2, c - r / 2);
    point(a + g / 2, c + r / 2);
  };

  ctx.save();
  ctx.rect(0, 0, mapWidthPx, mapHeightPx);
  ctx.clip();
  ctx.beginPath();
  if (flat) {
    // Lines of hexes are columns: x across them, y along, which counts down.
    for (let x = x0; x <= x1; x++) {
      const base = cellCentre({ x, y: y0 }, frame);
      for (let y = y0; y <= y1; y++) edges(base.y - (y - y0) * g, base.x);
    }
  } else {
    for (let y = y0; y <= y1; y++) {
      const base = cellCentre({ x: x0, y }, frame);
      for (let x = x0; x <= x1; x++) edges(base.x + (x - x0) * g, base.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}
