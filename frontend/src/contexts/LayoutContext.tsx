// ============================================
// Layout Context: which arrangement the campaign page draws
//
// The campaign page draws one table (components/campaign/DesktopTable.tsx)
// in one of four arrangements: wide from 1024 px, and below it (compact) a
// tablet's, a phone's upright or a phone's on its side; the parts they
// arrange are drawn once for the page (components/campaign/tableHosts.tsx).
// The page says which with LayoutProvider; a component that changes with it
// asks useCompactLayout or useTableLayout. The widths are those of
// constants/layout.ts; nothing here writes them again.
//
// While the compact arrangement is up the page's root has no overscroll.
// Its header and bar take the browser's own touch handling, and on Android
// a downward swipe there, at the top of a page that does not scroll, can pull
// to refresh, reloading the table mid-session. The map and the sheets keep
// their own (touch-none, overscroll-contain). The desktop arrangement keeps
// the browser's, such as a trackpad's swipe back. The root's value is the
// page's; it is set on the body too, which costs nothing, since the body
// does not scroll.
// ============================================

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { TableLayout } from '@/constants/layout';

const LayoutContext = createContext<TableLayout>('wide');

/**
 * Gives the components under it the arrangement the campaign page draws:
 * `compact` below 1,024 px, and `layout`, which of the four it is (a compact
 * one without it is the phone's).
 */
export function LayoutProvider({ compact, layout, children }: { compact: boolean; layout?: TableLayout; children: ReactNode }) {
  const value: TableLayout = compact ? (layout && layout !== 'wide' ? layout : 'phone') : 'wide';
  useEffect(() => {
    if (!compact) return undefined;
    const elements = [document.documentElement, document.body];
    const before = elements.map((el) => el.style.overscrollBehavior);
    for (const el of elements) el.style.overscrollBehavior = 'none';
    return () => elements.forEach((el, i) => { el.style.overscrollBehavior = before[i]; });
  }, [compact]);
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

/** Whether the campaign page draws a compact arrangement, below 1,024 px. False outside a LayoutProvider, as on every other page. */
export function useCompactLayout(): boolean {
  return useContext(LayoutContext) !== 'wide';
}

/** Which of the table's four arrangements the page draws; 'wide' outside a LayoutProvider. */
export function useTableLayout(): TableLayout {
  return useContext(LayoutContext);
}

/** Whether the arrangement is a phone's, upright or on its side: slim rail, sheets, strips. */
export function isPhoneLayout(layout: TableLayout): boolean {
  return layout === 'phone' || layout === 'phone-landscape';
}
