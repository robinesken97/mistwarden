// ============================================
// The map's controls: the colours' names, what the rail's cells do, and
// which card and rows they show (MapCanvas), written once here.
//
// Pure: no React, no DOM.
// ============================================

export type RulerColor = 'amber' | 'purple' | 'black';

/** The ruler's colours, as Measure's card offers them (drawOverlays.ts draws them). */
export const RULER_COLOURS: { value: RulerColor; name: string; swatch: string }[] = [
  { value: 'amber', name: 'Amber', swatch: 'rgb(251, 191, 36)' },
  { value: 'purple', name: 'Purple', swatch: '#a855f7' },
  { value: 'black', name: 'Black', swatch: '#000000' },
];

/** The grid's line colours the GM picks from for everyone on a scene (the map's gridColor). */
export const GRID_SWATCHES = [
  { name: 'Dark', value: '#000000' },
  { name: 'Light', value: '#ffffff' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Sky', value: '#38bdf8' },
];

/** The grid's line widths, as the map stores them (gridLineWidth). */
export const GRID_WIDTHS = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Thick' },
] as const;

/** What each control does. */
export interface MapControlsActions {
  fit: () => void;
  toggleRuler: () => void;
  toggleAoE: () => void;
  toggleTools: () => void;
  togglePaint: () => void;
}

/** The cards beside the rail; one shows at a time. */
export type RailCardKey = 'draw' | 'measure' | 'aoe' | 'spirit' | 'gm';

/**
 * The card to show, of those whose tool is up: one at a time, so two never
 * lie over each other beside the rail. Opening a card puts the others away
 * (MapCanvas); a tool brought up some other way (a GM tool's key, a sheet's
 * Place area) still shows only one.
 */
export function shownRailCard(up: Record<RailCardKey, boolean>): RailCardKey | null {
  return (['draw', 'measure', 'aoe', 'spirit', 'gm'] as const).find((key) => up[key]) ?? null;
}

/**
 * Place freely (the GM's own moves stop between squares): only on a square
 * grid whose tokens snap, and not while Mapmaker is on.
 */
export function placeFreelyShown(s: { isGM: boolean; hasMap: boolean; snapTokens?: boolean; hex: boolean; paintOn: boolean }): boolean {
  return s.isGM && s.hasMap && s.snapTokens !== false && !s.hex && !s.paintOn;
}

/** Walls' one Snap control in place of two boxes: grid snapping wins, as its box disabled the other. */
export type WallSnap = 'grid' | 'endpoints' | 'off';
export const wallSnapOf = (snapToGrid: boolean, snapToEndpoint: boolean): WallSnap =>
  snapToGrid ? 'grid' : snapToEndpoint ? 'endpoints' : 'off';
export const wallSnapFlags = (snap: WallSnap): { snapToGrid: boolean; snapToEndpoint: boolean } =>
  ({ snapToGrid: snap === 'grid', snapToEndpoint: snap === 'endpoints' });

/** The preset whose radii these are, or "Custom" when the sliders match none. */
export function presetNameOf(presets: { label: string; bright: number; dim: number }[], bright: number, dim: number): string {
  return presets.find((p) => p.bright === bright && p.dim === dim)?.label ?? 'Custom';
}
