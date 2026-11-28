// ============================================
// Where the wide layout's top bar lets the map put its own controls.
//
// As player and the ⋯ menu's Mapmaker row run on the map's state (MapCanvas:
// the preview, Paint), so the map draws them and portals them into these
// elements, which the top bar (DesktopTable.tsx) registers while it shows
// them. Null: nowhere to draw them, as on the compact layout.
// ============================================

import { create } from 'zustand';

interface TableChromeState {
  /** The top bar's place for As player ▾, between AI and ⋯. */
  asPlayerSlot: HTMLElement | null;
  /** The ⋯ menu's place for the Mapmaker row, its first row, while the menu is open. */
  mapmakerSlot: HTMLElement | null;
  /** The open panel's header, where its count and actions go (Chat, Dice), and which tab it shows. */
  panelHeader: { tab: string; el: HTMLElement } | null;
}

export const useTableChrome = create<TableChromeState>(() => ({
  asPlayerSlot: null,
  mapmakerSlot: null,
  panelHeader: null,
}));
