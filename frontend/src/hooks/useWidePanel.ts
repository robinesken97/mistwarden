// ============================================
// useWidePanel: the wide layout's panel beside the tab column, kept per browser
//
// Which tab it shows and whether it is open. Without a saved choice it opens
// from 1,280 px wide and starts folded below (WIDE_PANEL_OPEN_QUERY); that
// computed start is never saved, so a first visit in a narrow window does
// not leave the same browser folded on a wide one. A tab the user opens or
// folds is saved and wins on the next visit.
// ============================================

import { useCallback, useState } from 'react';
import { WIDE_PANEL_OPEN_QUERY } from '@/constants/layout';
import { optionalStorage } from '@/utils/optionalStorage';
import { useMediaQuery } from './useMediaQuery';

export const WIDE_PANEL_KEY = 'mistwarden.widePanel';
/** The three resizable columns' saved sizes (react-resizable-panels), which this replaces. */
const OLD_LAYOUT_KEY = 'react-resizable-panels:cozyvtt-session-layout';

interface SavedPanel {
  open: boolean;
  /** Party shows, rather than the session panel the game store names. */
  party: boolean;
}

/** The saved choice, or null for none or one that cannot be read. */
export function loadWidePanel(): SavedPanel | null {
  try {
    const saved: unknown = JSON.parse(optionalStorage.getItem(WIDE_PANEL_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return null;
    const { open, party } = saved as Record<string, unknown>;
    return typeof open === 'boolean' ? { open, party: party === true } : null;
  } catch {
    return null;
  }
}

export function useWidePanel() {
  const wide = useMediaQuery(WIDE_PANEL_OPEN_QUERY);
  const [saved, setSaved] = useState<SavedPanel | null>(() => {
    optionalStorage.removeItem(OLD_LAYOUT_KEY);
    return loadWidePanel();
  });
  const panel = saved ?? { open: wide, party: false };

  /** The user's choice, saved for the next visit. */
  const choose = useCallback((next: SavedPanel) => {
    setSaved(next);
    optionalStorage.setItem(WIDE_PANEL_KEY, JSON.stringify(next));
  }, []);

  return { open: panel.open, party: panel.party, choose };
}

// ============================================
// useDockPanel: the dock's panel on a tablet or a phone held upright, kept
// per browser: whether it is open, on Party or a session panel, and how
// tall. Folded by default, to its tab row.
// ============================================

export const DOCK_PANEL_KEY = 'mistwarden.tableDock';

/** How tall the open dock is: 40 % of the screen, or tall (60 % on a tablet, up to the top bar on a phone). */
export type DockSize = 'mid' | 'tall';

interface SavedDock extends SavedPanel {
  size: DockSize;
}

/** The saved dock, or null for none or one that cannot be read. */
export function loadDockPanel(): SavedDock | null {
  try {
    const saved: unknown = JSON.parse(optionalStorage.getItem(DOCK_PANEL_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return null;
    const { open, party, size } = saved as Record<string, unknown>;
    return typeof open === 'boolean' ? { open, party: party === true, size: size === 'tall' ? 'tall' : 'mid' } : null;
  } catch {
    return null;
  }
}

export function useDockPanel() {
  const [dock, setDock] = useState<SavedDock>(() => loadDockPanel() ?? { open: false, party: false, size: 'mid' });

  /** The user's choice, saved for the next visit; a size left out stays as it was. */
  const choose = useCallback((next: SavedPanel & { size?: DockSize }) => {
    setDock((prev) => {
      const saved = { ...next, size: next.size ?? prev.size };
      optionalStorage.setItem(DOCK_PANEL_KEY, JSON.stringify(saved));
      return saved;
    });
  }, []);

  return { open: dock.open, party: dock.party, size: dock.size, choose };
}
