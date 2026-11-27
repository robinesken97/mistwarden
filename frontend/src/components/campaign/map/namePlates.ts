// Added for Mistwarden on 2026-11-27.
// ============================================
// Name plates: a token's name in a small dark pill under it, readable on a
// light map and a dark one. A device setting (Display on this device) shows
// them always, on the token pointed at or tapped, or never; a token smaller
// than NAME_PLATE_MIN_TOKEN_PX on screen gets none. Drawn in screen pixels,
// so a plate keeps its size at any zoom.
// ============================================

import { optionalStorage } from '@/utils/optionalStorage';

export const TOKEN_NAME_MODES = ['always', 'hover', 'never'] as const;
export type TokenNameMode = (typeof TOKEN_NAME_MODES)[number];
export const TOKEN_NAMES_KEY = 'mistwarden.tokenNames';
/** Sent when this device's choice changes, so the map redraws without a reload. */
export const TOKEN_NAMES_EVENT = 'mistwarden:tokennames';

/** This device's choice; on the token pointed at or tapped unless it chose otherwise. */
export const tokenNameMode = (): TokenNameMode => {
  const value = optionalStorage.getItem(TOKEN_NAMES_KEY);
  return TOKEN_NAME_MODES.some((m) => m === value) ? (value as TokenNameMode) : 'hover';
};

export function setTokenNameMode(mode: TokenNameMode): void {
  optionalStorage.setItem(TOKEN_NAMES_KEY, mode);
  window.dispatchEvent(new Event(TOKEN_NAMES_EVENT));
}

/** A token narrower than this on screen, in CSS pixels, gets no plate. */
export const NAME_PLATE_MIN_TOKEN_PX = 28;

const FONT = "600 11px 'Inter', system-ui, sans-serif";
const HEIGHT = 17;
const PAD_X = 6;
const MAX_TEXT = 120;
/** Room for the GM's hidden-name mark, left of the name. */
const MARK = 13;

/** Each name as it fits a plate, with its width: measured once, not every frame. */
const fitted = new Map<string, { text: string; width: number }>();

function fit(ctx: CanvasRenderingContext2D, name: string): { text: string; width: number } {
  const known = fitted.get(name);
  if (known) return known;
  let text = name;
  let width = ctx.measureText(text).width;
  if (width > MAX_TEXT) {
    let chars = [...name];
    while (chars.length > 1 && ctx.measureText(`${chars.join('').trimEnd()}…`).width > MAX_TEXT) chars = chars.slice(0, -1);
    text = `${chars.join('').trimEnd()}…`;
    width = ctx.measureText(text).width;
  }
  // shortcut: one cache for the page, emptied at 500 names; no table has that many.
  if (fitted.size >= 500) fitted.clear();
  const entry = { text, width };
  fitted.set(name, entry);
  return entry;
}

/**
 * A plate centred under `x`, its top at `y` (map units), at `zoom`. `hidden`
 * marks a name the GM keeps from the table: a dashed amber edge and a
 * crossed eye, on the GM's screen only.
 */
export function drawNamePlate(ctx: CanvasRenderingContext2D, x: number, y: number, zoom: number, name: string, hidden: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / zoom, 1 / zoom);
  ctx.font = FONT;
  const { text, width } = fit(ctx, name);
  const mark = hidden ? MARK : 0;
  const w = width + PAD_X * 2 + mark;
  const left = -w / 2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(left, 0, w, HEIGHT, HEIGHT / 2);
  else ctx.rect(left, 0, w, HEIGHT);
  ctx.fillStyle = 'rgba(14, 13, 20, 0.74)';
  ctx.fill();
  if (hidden) {
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = 'rgba(217, 180, 74, 0.95)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    // A crossed eye: an almond, its pupil, and a stroke through both.
    const ex = left + PAD_X + 5;
    const ey = HEIGHT / 2;
    ctx.strokeStyle = 'rgba(244, 241, 234, 0.85)';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 5, 3, 0, 0, Math.PI * 2);
    ctx.moveTo(ex + 1.2, ey);
    ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
    ctx.moveTo(ex - 5, ey + 4);
    ctx.lineTo(ex + 5, ey - 4);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hidden ? 'rgba(244, 241, 234, 0.8)' : '#f4f1ea';
  ctx.fillText(text, left + PAD_X + mark, HEIGHT / 2 + 0.5);
  ctx.restore();
}
