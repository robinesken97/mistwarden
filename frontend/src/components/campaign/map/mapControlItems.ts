// ============================================
// The map's controls: the colours' names and what the rail's cells and
// popovers do (MapCanvas), written once here.
//
// Pure: no React, no DOM.
// ============================================

export type GridColor = 'black' | 'white';
export type RulerColor = 'amber' | 'purple' | 'black';

/** The grid colour button's name and tooltip: the colour it shows now. */
export const gridColorLabel = (color: GridColor) => `Grid Color: ${color === 'black' ? 'Black' : 'White'}`;

/** The ruler colour button's name and tooltip: the colour it shows now. */
export const rulerColorLabel = (color: RulerColor) =>
  `Ruler color: ${color === 'amber' ? 'Amber' : color === 'purple' ? 'Purple' : 'Black'}`;

/** What each control does. */
export interface MapControlsActions {
  fit: () => void;
  toggleGrid: () => void;
  nextGridColor: () => void;
  toggleRuler: () => void;
  nextRulerColor: () => void;
  toggleAoE: () => void;
  toggleSpiritTokens: () => void;
  toggleTools: () => void;
  togglePaint: () => void;
  togglePlaceFreely: () => void;
}
