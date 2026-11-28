// ============================================
// Where the wide layout's top bar lets the map put its own controls.
//
// As player and the ⋯ menu's Mapmaker row run on the map's state (MapCanvas:
// the preview, Paint), so the map draws them and portals them into these
// elements, which the top bar (DesktopTable.tsx) registers while it shows
// them. Null: nowhere to draw them, as on the compact layout.
// ============================================

import { create } from 'zustand';

/** A Library row that opens in the panel slot (wide) or a sheet (compact); Documents keeps its window. */
export type LibraryPanel = 'scenes' | 'tokens' | 'creatures' | 'templates' | 'spells';

interface TableChromeState {
  /** The top bar's place for As player ▾, between AI and ⋯. */
  asPlayerSlot: HTMLElement | null;
  /** The ⋯ menu's place for the Mapmaker row, its first row, while the menu is open. */
  mapmakerSlot: HTMLElement | null;
  /** The open panel's header, where its count and actions go (Chat, Dice), and which tab it shows. */
  panelHeader: { tab: string; el: HTMLElement } | null;
  /** How much of the map's foot an open dock covers, in CSS px: the map keeps its size and view under it, and its controls stand above it. */
  mapCover: number;
  /** The Library panel shown in the panel slot or the sheet, in place of the tab panels; null: none. */
  library: LibraryPanel | null;
}

export const useTableChrome = create<TableChromeState>(() => ({
  asPlayerSlot: null,
  mapmakerSlot: null,
  panelHeader: null,
  mapCover: 0,
  library: null,
}));

/** Show `library` in the panel slot, or the sheet on a compact layout. */
export const openLibrary = (library: LibraryPanel) => useTableChrome.setState({ library });
/** Close the Library panel: the tab that was open shows again. */
export const closeLibrary = () => useTableChrome.setState({ library: null });
