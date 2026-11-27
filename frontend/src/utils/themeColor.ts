/**
 * The custom header colour a character sheet saves.
 *
 * The server accepts a preset's name or a six-digit `#rrggbb` colour (see
 * styleAllowlists). The editors' hex box takes what a person types, and `#fff`
 * is a colour every browser understands, so the three-digit form is expanded
 * here. Anything else, from a bare `#` to five digits, is not a colour yet.
 */

import { isHexColor } from './styleAllowlists';
import { AA_TEXT, ensureReadable, parseRgb, readableTextOn, relativeLuminance, toChannels } from './color';

/** What the editors say when the hex box holds something that is not a colour. */
export const HEX_COLOUR_HINT = 'Enter a colour as #rgb or #rrggbb';

/** `value` as `#rrggbb`, or null when it is not a hex colour. */
export function toStoredHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (isHexColor(trimmed)) return trimmed;
  const short = /^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/.exec(trimmed);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/**
 * Whether text on a header of this `#rrggbb` colour should be white: true when
 * the readable text colour for it (readableTextOn, which the themes use too)
 * is lighter than the colour, false for dark text. One rule, so a sheet's
 * editor and its read-only view cannot choose differently.
 */
export function shouldUseWhiteText(hexColor: string): boolean {
  const hex = hexColor.replace('#', '');
  const background = parseRgb([0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(' '));
  const text = parseRgb(readableTextOn(toChannels(background)));
  return relativeLuminance(text) > relativeLuminance(background);
}

/**
 * The classes for what sits on a read-only sheet's header of this `#rrggbb`
 * colour: its text, softer text, and the translucent fills and borders of its
 * buttons, chips and picture. The fills under a label move the header away
 * from the label's colour (darker under white text, lighter under black), so a
 * label on a button or chip is never harder to read than on the header itself.
 */
export function headerInk(hexColor: string) {
  const white = shouldUseWhiteText(hexColor);
  return {
    text: white ? 'text-white' : 'text-black',
    soft: white ? 'text-white/90' : 'text-black/80',
    softer: white ? 'text-white/80' : 'text-black/80',
    button: white ? 'bg-black/20 hover:bg-black/30' : 'bg-white/30 hover:bg-white/45',
    chip: white ? 'bg-black/20' : 'bg-white/30',
    chipFaint: white ? 'bg-black/10' : 'bg-white/15',
    border: white ? 'border-white/20' : 'border-black/20',
  };
}

/** The colours a 5E sheet draws its boxes in, as CSS colours. */
export interface SheetAccent {
  /** Borders, headings and labels: readable as text on the page. */
  accent: string;
  /** The open tab's fill. */
  fill: string;
  /** Text on that fill. */
  onFill: string;
}

/** A sheet with no colour of its own takes the theme's accent. */
export const THEME_SHEET_ACCENT: SheetAccent = {
  accent: 'rgb(var(--rgb-accent-ink))',
  fill: 'rgb(var(--rgb-accent))',
  onFill: 'rgb(var(--rgb-accent-text))',
};

/**
 * The accent of a sheet whose colour is this `#rrggbb` (a preset's or a custom
 * one), on a page of `pageChannels` ("R G B"): the colour moved, keeping its
 * hue, until it reads as text there, so a dark preset is lightened on a dark
 * theme and left as it is on a light one. Without a colour, the theme's accent.
 */
export function sheetAccent(hexColor: string | null | undefined, pageChannels: string): SheetAccent {
  const hex = hexColor ? toStoredHexColor(hexColor) : null;
  if (!hex) return THEME_SHEET_ACCENT;
  const colour = parseRgb([1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(' '));
  const readable = toChannels(ensureReadable(colour, parseRgb(pageChannels), AA_TEXT));
  return { accent: `rgb(${readable})`, fill: `rgb(${readable})`, onFill: `rgb(${readableTextOn(readable)})` };
}

