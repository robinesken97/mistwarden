// ============================================
// useSessionLayout: the campaign table's column sizes, kept per browser
//
// A layout the user made (dragging a divider, or the header's show/hide
// buttons) is saved and wins on the next visit. Without one, a tablet-width
// window starts with the left column folded. That computed start is never
// saved: it was, so a first visit in a narrow window left the same browser
// folded on a wide one too.
// ============================================

import { useCallback, useRef } from 'react';
import { useDefaultLayout, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';
import { TABLET_WIDTH_QUERY } from '@/constants/layout';
import { optionalStorage } from '@/utils/optionalStorage';
import { useMediaQuery } from './useMediaQuery';

export const SESSION_LAYOUT_ID = 'cozyvtt-session-layout';

export function useSessionLayout() {
  const { defaultLayout: savedLayout, onLayoutChanged: save } = useDefaultLayout({
    id: SESSION_LAYOUT_ID,
    storage: optionalStorage,
  });
  // A saved layout is the user's; until there is one, only their own changes are kept.
  const userLayout = useRef(savedLayout !== undefined);
  // Read where the browser has no matchMedia (tests) too, as not tablet-width.
  const tabletWidth = useMediaQuery(TABLET_WIDTH_QUERY);
  const defaultLayout = savedLayout ?? (tabletWidth ? { party: 0, map: 75, rail: 25 } : undefined);

  const onLayoutChanged = useCallback((layout: Layout, meta: LayoutChangedMeta) => {
    if (meta.isUserInteraction) userLayout.current = true;
    if (userLayout.current) save(layout, meta);
  }, [save]);

  /** Call before a change the library cannot tell is the user's, such as panel.collapse() from a button. */
  const markUserChange = useCallback(() => {
    userLayout.current = true;
  }, []);

  return { defaultLayout, onLayoutChanged, markUserChange };
}
