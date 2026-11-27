/**
 * The look the 5E sheet and its editor share: accent-bordered boxes with a
 * serif heading, in the sheet's own colour.
 *
 * The colour is set once, as CSS variables on the sheet's root
 * (`sheetAccentVariables`), and every class here reads them, so a box never
 * needs to know which colour the sheet has.
 */
import type { CSSProperties } from 'react';
import { sheetAccent } from '@/utils/themeColor';
import { isHexColor } from '@/utils/styleAllowlists';
import { PRESET_THEMES } from '@/themes';
import { COLOR_PRESETS } from './colorPresets';

/** A box: 4 px accent border, 15 px corners, the accent's tint behind it; 12 px in on a phone, 20 from sm up. */
export const SHEET_BOX = 'rounded-[15px] border-4 border-(--sheet-accent) bg-(--sheet-accent-bg) px-3 pt-3 pb-3.5 sm:px-5 sm:pt-3.5 sm:pb-4';
/** A box's heading, in the heading font and the accent, underlined. */
export const SHEET_BOX_HEADING =
  'mb-2.5 flex items-baseline justify-between gap-2 border-b-2 border-(--sheet-accent) pb-1 font-heading text-lg leading-tight font-semibold text-(--sheet-accent)';
/** A heading sharing its row with a button; the row carries SHEET_BOX_HEADING's underline. */
export const SHEET_BOX_TITLE = 'font-heading text-lg leading-tight font-semibold text-(--sheet-accent)';
/** A bold label before its value. */
export const SHEET_LABEL = 'font-bold text-(--sheet-accent)';
/** The rounded bar between parts of a box. */
export const SHEET_BAR = 'my-2.5 h-[3px] rounded-[5px] border-0 bg-(--sheet-accent)';
/** The one space between boxes. */
export const SHEET_GAP = 'gap-4';

/**
 * The page colour the accent has to read on, as "R G B": the theme's, as
 * applied to the document.
 *
 * shortcut: read once per render, so a theme switched while a sheet is open
 * is picked up at its next render; follow the theme in a context if that lags.
 */
function pageChannels(): string {
  const applied = typeof document === 'undefined'
    ? ''
    : getComputedStyle(document.documentElement).getPropertyValue('--rgb-bg-base').trim();
  return applied || PRESET_THEMES[0].colors.bgBase;
}

/** A stored `themeColor` (a preset's name or `#rrggbb`) as a hex colour, or null for none. */
export function sheetThemeHex(themeColor: string | undefined): string | null {
  if (!themeColor) return null;
  const preset = COLOR_PRESETS.find((c) => c.name === themeColor);
  if (preset) return preset.hex;
  return isHexColor(themeColor) ? themeColor : null;
}

/** The CSS variables a sheet's root carries for its colour (`themeColor` as stored). */
export function sheetAccentVariables(themeColor: string | undefined): CSSProperties {
  const { accent, fill, onFill } = sheetAccent(sheetThemeHex(themeColor), pageChannels());
  return {
    '--sheet-accent': accent,
    '--sheet-accent-bg': 'color-mix(in srgb, var(--sheet-accent) 8%, transparent)',
    '--sheet-fill': fill,
    '--sheet-on-fill': onFill,
  } as CSSProperties;
}
