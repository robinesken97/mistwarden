// ============================================
// Desktop Table: the campaign table, in each of its four arrangements
//
// A slim top bar (back · title · connection · Live · Library ▾ · AI ·
// As player ▾ · ⋯) over the map, and the panel tabs (Chat, Dice,
// Initiative, Party, Notes, Gallery, Table), placed by `layout`:
//
// - wide (from 1,024 px): a labelled tab column on the left and the chosen
//   tab's panel beside it. Tapping the open tab folds the panel to the
//   column: folded by default below 1,280 px, open from there, the choice
//   kept per device (useWidePanel).
// - tablet (an iPad upright) and phone (a phone upright): a dock at the
//   foot, folded to its tab row by default. A tab opens its panel at 40 %
//   of the screen over the map's foot, tapping it again folds it, and its
//   grip drags it between folded, 40 % and tall (60 % on a tablet, up to the
//   top bar on a phone), kept per device (useDockPanel). The map keeps its
//   size and view under an open dock; its controls move above it
//   (tableChromeStore's mapCover).
// - phone-landscape (a phone on its side): the tabs in the top bar, a
//   panel opening on the left as on the wide layout.
//
// On a phone the bar is slimmer: the session's state is a dot, AI and
// As player are icons, and Library moves to the top of ⋯, which rises as a
// sheet. The map's own tools are a rail on its right edge (MapCanvas).
//
// The map, the session panels and the Party content are the page's, drawn
// once and moved into this arrangement's slots (tableHosts.tsx), so they
// outlive it. A folded panel stays laid out, clipped to nothing and inert,
// so the chat keeps scrolling to its newest message and the roster keeps
// filling the hit points the map's bars read. The windows the bar opens are
// the page's too, so its buttons only ask the page to open them.
// ============================================

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronLeft, Cloud, Ellipsis, Info, Keyboard, LibraryBig, Map as MapIcon, MonitorCog,
  PanelLeftClose, PauseCircle, Settings, Signpost, Skull, Sparkles, Stamp, Sun, Swords, Wand, type LucideIcon,
} from 'lucide-react';
import { useLeavePage } from '@/hooks/useLeaveGuard';
import { nearestDockSnap, useDockPanel, useWidePanel } from '@/hooks/useWidePanel';
import type { TableLayout } from '@/constants/layout';
import { useServerConfigQuery } from '@/hooks/queries';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useGameStore } from '@/stores/gameStore';
import { closeLibrary, useTableChrome, type LibraryPanel } from '@/stores/tableChromeStore';
import { useSheet } from '@/components/campaign/compact/BottomSheet';
import { DisplaySettings, DISPLAY_SETTINGS_LABEL } from '@/components/campaign/DisplaySettings';
import { startTour } from '@/components/campaign/tour/tourSteps';
import { type SessionToolKey } from '@/components/campaign/SessionToolbar';
import { partHoldingFocus, useTableSlot } from '@/components/campaign/tableHosts';
import { WIDE_TABS, WIDE_TAB_LOOKS, unreadBadge, type WideTab } from '@/components/campaign/sessionTabs';
import CampaignInfo from '@/components/campaign/CampaignInfo';
import { AI_WRITE_EVENT } from '@/components/campaign/AiWriteDialog';
import TopBarMenu, { BAR_BUTTON, MenuRow, MenuSeparator } from '@/components/campaign/TopBarMenu';
import ConnectionStatus from '@/components/ConnectionStatus';
import { SESSION_STATUS_LABELS, SessionPausedBanner } from '@/components/campaign/sessionStatus';
import Modal from '@/components/ui/Modal';
import { CampaignStatus } from '@/types';
import type { AccessRevoked, Campaign } from '@/types';
import { cn } from '@/utils/cn';

interface DesktopTableProps {
  /** Which arrangement to draw; the wide one by default. */
  layout?: TableLayout;
  campaign: Campaign;
  /** Whether the viewer owns the campaign, which may differ from running it. */
  isOwner: boolean;
  /** Open one of the GM's slide-overs; `settings` is also an owner's way to the settings. */
  onOpenTool: (key: SessionToolKey) => void;
  onOpenDocuments: () => void;
  /** The Spell Library, every member's. */
  onOpenSpells?: () => void;
  onOpenShortcuts: () => void;
  /** Told when the member has left the campaign from Campaign info. */
  onLeft: (revoked: AccessRevoked) => void;
}

// Where the map draws its controls into the bar; stable, so they are registered once.
const asPlayerSlot = (el: HTMLElement | null) => { useTableChrome.setState({ asPlayerSlot: el }); };
const mapmakerSlot = (el: HTMLElement | null) => { useTableChrome.setState({ mapmakerSlot: el }); };

/** The session status chip after the title: Live, Paused or Inactive; on a phone a dot, named for screen readers. */
function StatusChip({ status, dot = false }: { status: CampaignStatus; dot?: boolean }) {
  const label = SESSION_STATUS_LABELS[status];
  if (!label) return null;
  if (dot) {
    const fill = status === CampaignStatus.ACTIVE ? 'bg-success' : status === CampaignStatus.PAUSED ? 'bg-warm-amber' : 'bg-stone-gray/50';
    return <span role="img" aria-label={label} title={label} className={cn('mx-1 size-2 shrink-0 rounded-full', fill)} />;
  }
  const look = status === CampaignStatus.ACTIVE
    ? 'bg-success/10 text-success-ink'
    : status === CampaignStatus.PAUSED ? 'bg-warm-amber/10 text-accent-ink' : 'bg-stone-gray/10 text-stone-gray';
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', look)}>
      {status === CampaignStatus.PAUSED
        ? <PauseCircle className="w-3.5 h-3.5" aria-hidden="true" />
        : <span className={cn('w-2 h-2 rounded-full', status === CampaignStatus.ACTIVE ? 'bg-success animate-pulse' : 'bg-stone-gray/50')} />}
      {label}
    </span>
  );
}

/** The dock's tab row: 56 px and its border on a phone, 52 and its border on a tablet, above the home indicator. */
const DOCK_TABS_PHONE = 'calc(57px + env(safe-area-inset-bottom))';
const DOCK_TABS_TABLET = 'calc(53px + env(safe-area-inset-bottom))';

/** The Library panels' names, for the sheet that shows one on a compact layout. */
const LIBRARY_NAMES: Record<LibraryPanel, string> = {
  scenes: 'Scenes', tokens: 'Tokens', creatures: 'Creatures', templates: 'Token Templates', spells: 'Spells',
};

/** A Library tile at the top of the phone's ⋯ sheet: its icon over a 12 px label, 64 px tall. */
function LibraryTile({ icon: Icon, label, tour, onSelect }: { icon: LucideIcon; label: string; tour: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-tour={tour}
      onClick={onSelect}
      className="flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl bg-ink/5 px-1 text-xs font-medium text-ink hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

export default function DesktopTable({
  layout = 'wide',
  campaign,
  isOwner,
  onOpenTool,
  onOpenDocuments,
  onOpenSpells,
  onOpenShortcuts,
  onLeft,
}: DesktopTableProps) {
  const leavePage = useLeavePage();
  const { userRole } = useCampaign();
  const { status } = useWebSocket();
  const isGM = userRole === 'GM';
  const { data: serverConfig } = useServerConfigQuery();
  const mapSlot = useTableSlot('map');
  const sessionSlot = useTableSlot('session');
  const partySlot = useTableSlot('party');
  const librarySlot = useTableSlot('library');
  // A Library panel (Scenes, Tokens, ...) shows in the panel slot, or a sheet
  // on the dock, without choosing a tab: closing it shows what was there.
  const library = useTableChrome((s) => s.library);

  const sessionTab = useGameStore((s) => s.sessionTab);
  const setSessionTab = useGameStore((s) => s.setSessionTab);
  const setSessionShown = useGameStore((s) => s.setSessionShown);
  const unreadChat = useGameStore((s) => s.unreadChat);
  const phone = layout === 'phone' || layout === 'phone-landscape';
  const docked = layout === 'tablet' || layout === 'phone';
  const widePanel = useWidePanel();
  const dock = useDockPanel();
  const panel = docked ? dock : widePanel;
  const activeTab: WideTab = panel.party ? 'party' : sessionTab;
  /** The panel beside the tabs shows: a tab's, or a Library panel over it. */
  const sideShown = panel.open || library !== null;

  // The chat counts as read only while its panel shows; folded or on Party,
  // what arrives counts on the Chat tab's badge.
  useEffect(() => {
    setSessionShown(panel.open && !panel.party && library === null);
  }, [panel.open, panel.party, library, setSessionShown]);
  // Another page shows the panels again; set directly, so a switch to the
  // compact layout, which sets its own value, does not read the chat as seen.
  // A Library panel left open is not open on the next table.
  useEffect(() => () => {
    useGameStore.setState({ sessionShown: true });
    closeLibrary();
  }, []);

  // Turning between a panel beside the tabs and the dock with the keyboard
  // in the session panels or Party shows that part, so the control stays in
  // sight.
  useEffect(() => {
    const part = partHoldingFocus();
    if ((part === 'session' || part === 'party') && !panel.open) panel.choose({ open: true, party: part === 'party' });
    // As the layout mounts, and as the panel moves between the side and the dock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);

  /** Show `tab`, or fold the panel when `tab` is the one open; a folded dock opens at 40 %. */
  const selectTab = (tab: WideTab) => {
    // Over a Library panel a tab shows its own panel, never folds it.
    if (library !== null) closeLibrary();
    if (panel.open && tab === activeTab && library === null) {
      panel.choose({ open: false, party: panel.party });
      return;
    }
    if (tab !== 'party') setSessionTab(tab);
    if (docked && !panel.open) dock.choose({ open: true, party: tab === 'party', size: 'mid' });
    else panel.choose({ open: true, party: tab === 'party' });
  };

  // The arrows, Home and End move between the tabs and show the one reached:
  // up and down in the column, left and right in a row.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = WIDE_TABS.length;
    const back = layout === 'wide' ? 'ArrowUp' : 'ArrowLeft';
    const forward = layout === 'wide' ? 'ArrowDown' : 'ArrowRight';
    const target = e.key === back ? (index - 1 + count) % count
      : e.key === forward ? (index + 1) % count
        : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null;
    if (target === null) return;
    e.preventDefault();
    const next = WIDE_TABS[target];
    if (next !== 'party') setSessionTab(next);
    panel.choose({ open: true, party: next === 'party' });
    document.getElementById(`session-tab-${next}`)?.focus();
  };

  // The open panel's header takes its count and actions (ChatPanel, DiceRoller).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    useTableChrome.setState({ panelHeader: headerSlot && panel.open && library === null ? { tab: activeTab, el: headerSlot } : null });
    return () => useTableChrome.setState({ panelHeader: null });
  }, [headerSlot, panel.open, activeTab, library]);

  // The ⋯ menu shows its rows, or Display on this device in their place.
  const [moreView, setMoreView] = useState<'rows' | 'display'>('rows');
  const [infoOpen, setInfoOpen] = useState(false);

  // ── The dock (tablet, phone upright) ──
  // Its panel stands on the tab row, over the map's foot; while the grip is
  // dragged it follows the finger, and on release it snaps to folded, 40 %
  // or tall, whichever is nearest. How much of the map it covers goes to
  // the map (tableChromeStore), which keeps its rail and cards above it.
  const area = useRef<HTMLDivElement>(null);
  const dockPanel = useRef<HTMLElement>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; height: number; moved: boolean } | null>(null);
  const tabRows = layout === 'phone' ? DOCK_TABS_PHONE : DOCK_TABS_TABLET;
  /** The panel's height at each snap, in px, from the screen's height and the room under the bar. */
  const snapHeights = () => {
    const room = area.current?.clientHeight ?? 0;
    const tabs = room - (dockPanel.current ? dockPanel.current.offsetTop + dockPanel.current.offsetHeight : room);
    const share = (f: number) => Math.min(room - tabs, Math.round(window.innerHeight * f) - tabs);
    return { mid: share(0.4), tall: layout === 'phone' ? room - tabs : share(0.6) };
  };
  const onGripDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dockPanel.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, height: dockPanel.current.offsetHeight, moved: false };
  };
  const onGripMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y) > 4) d.moved = true;
    if (d.moved) setDragHeight(Math.max(0, d.height + d.y - e.clientY));
  };
  const onGripUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    setDragHeight(null);
    // A tap switches between 40 % and tall.
    if (!d.moved) { dock.choose({ open: true, party: dock.party, size: dock.size === 'mid' ? 'tall' : 'mid' }); return; }
    const height = Math.max(0, d.height + d.y - e.clientY);
    const { mid, tall } = snapHeights();
    const snap = nearestDockSnap(height, mid, tall);
    if (snap === 'folded') dock.choose({ open: false, party: dock.party });
    else dock.choose({ open: true, party: dock.party, size: snap });
  };
  useLayoutEffect(() => {
    const el = dockPanel.current;
    if (!docked || !el) {
      useTableChrome.setState({ mapCover: 0 });
      return undefined;
    }
    const measure = () => {
      if (!drag.current) useTableChrome.setState({ mapCover: dock.open ? el.offsetHeight : 0 });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      useTableChrome.setState({ mapCover: 0 });
    };
  }, [docked, dock.open, dock.size, dragHeight]);
  const dockStyle = (): React.CSSProperties => {
    if (dragHeight !== null) return { bottom: tabRows, height: dragHeight };
    if (dock.size === 'tall' && layout === 'phone') return { bottom: tabRows, top: 0 };
    return { bottom: tabRows, height: `calc(${dock.size === 'tall' ? 60 : 40}dvh - ${tabRows})` };
  };

  const aiOffered = isGM && serverConfig?.ai?.enabled === true;
  const header = 'bg-[color-mix(in_srgb,var(--color-brand)_10%,var(--color-canvas))]';

  // ── The tabs: a column (wide), a row in the dock, or a row in the bar (phone on its side) ──
  const tabs = (
    <nav
      role="tablist"
      aria-label="Panels"
      aria-orientation={layout === 'wide' ? 'vertical' : 'horizontal'}
      className={cn(
        'flex shrink-0',
        layout === 'wide' && 'w-[5.25rem] flex-col gap-1 overflow-y-auto px-1.5 py-2 bg-surface border-r border-brand/20',
        docked && 'border-t border-brand/20 bg-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
        layout === 'tablet' && 'h-[calc(53px+env(safe-area-inset-bottom))]',
        layout === 'phone' && 'h-[calc(57px+env(safe-area-inset-bottom))]',
        layout === 'phone-landscape' && 'h-full',
      )}
    >
      {WIDE_TABS.map((key, index) => {
        const { label, icon: Icon } = WIDE_TAB_LOOKS[key];
        const shown = panel.open && library === null && activeTab === key;
        return (
          <button
            key={key}
            type="button"
            id={`session-tab-${key}`}
            data-tour={`tab-${key}`}
            role="tab"
            aria-selected={shown}
            aria-controls="wide-panel"
            tabIndex={activeTab === key ? 0 : -1}
            onClick={() => selectTab(key)}
            onKeyDown={(e) => onTabKey(e, index)}
            className={cn(
              'relative flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
              layout === 'wide' && 'h-14 flex-col gap-0.5 rounded-[10px] px-1.5 text-xs focus-visible:outline-offset-2',
              layout === 'tablet' && 'h-13 flex-1 flex-row gap-2 px-1.5 text-sm',
              layout === 'phone' && 'h-14 min-w-11 flex-1 flex-col gap-0.5 px-1.5 text-xs',
              layout === 'phone-landscape' && 'h-13 min-w-[3.625rem] flex-col gap-0.5 px-1.5 text-xs',
              shown ? 'bg-brand/15 text-brand-ink font-semibold' : 'text-ink-muted hover:text-ink hover:bg-ink/5',
              shown && (layout === 'wide' ? 'shadow-[inset_3px_0_0_var(--color-brand)]'
                : docked ? 'shadow-[inset_0_3px_0_var(--color-brand)]' : 'shadow-[inset_0_-3px_0_var(--color-brand)]'),
            )}
          >
            <Icon className={layout === 'tablet' ? 'w-4 h-4' : 'w-5 h-5'} aria-hidden="true" />
            {label}
            {key === 'chat' && unreadChat > 0 && (
              <span
                className="absolute top-1 right-2 min-w-5 h-5 px-1 rounded-full bg-brand text-brand-text text-xs font-bold flex items-center justify-center"
                aria-label={unreadBadge(unreadChat).label}
              >
                {unreadBadge(unreadChat).text}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  // ── The panel: beside the tabs (wide, phone on its side) or in the dock ──
  // Folded it stays laid out and inert: beside the tabs clipped to nothing,
  // in the dock out of sight at its 40 % height.
  const panelBody = (
    <div className="relative min-h-0 flex-1">
      {/* The session panels are the page's, moved in here (tableHosts.tsx). */}
      <div ref={sessionSlot.ref} className={cn('absolute inset-0', layout !== 'wide' && 'finger-controls', panel.party && 'invisible')} />
      {/* The Party content is the page's, moved in here. */}
      <div
        ref={partySlot.ref}
        role="tabpanel"
        aria-labelledby="session-tab-party"
        data-tour="panel-party"
        className={cn('absolute inset-0 overflow-y-auto p-4', layout !== 'wide' && 'finger-controls', !panel.party && 'invisible')}
      />
    </div>
  );
  const foldButton = (
    <button
      type="button"
      onClick={() => panel.choose({ open: false, party: panel.party })}
      aria-label="Fold panel"
      title="Fold panel"
      className="inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand"
    >
      {docked ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <PanelLeftClose className="w-4 h-4" aria-hidden="true" />}
    </button>
  );
  const panelHeading = (
    <h2 className="min-w-0 flex-1 truncate font-heading text-xl font-bold text-brand-ink">{WIDE_TAB_LOOKS[activeTab].label}</h2>
  );
  const sidePanel = (
    <section
      id="wide-panel"
      aria-label={library ? LIBRARY_NAMES[library] : WIDE_TAB_LOOKS[activeTab].label}
      inert={!sideShown || undefined}
      className={cn(
        'relative shrink-0 overflow-hidden border-brand/20 bg-[color-mix(in_srgb,var(--color-surface)_30%,var(--color-canvas))]',
        sideShown ? 'w-80 xl:w-96 border-r' : 'w-0',
      )}
    >
      {/* A Library panel over the tab's, which stays laid out under it. */}
      {library && <div ref={librarySlot.ref} className={cn('absolute inset-y-0 left-0 z-10 flex w-80 xl:w-96 flex-col overflow-y-auto bg-inherit', layout !== 'wide' && 'finger-controls')} />}
      {/* 320 px below 1,280 px wide, 384 from there (in rem, so a 4K screen's larger text widens it too). */}
      <div className={cn('flex h-full w-80 xl:w-96 flex-col', library && 'invisible')} inert={library !== null || undefined}>
        <div className="flex h-13 shrink-0 items-center gap-2 pl-4 pr-1 border-b border-ink/10">
          {panelHeading}
          <div ref={setHeaderSlot} className="flex shrink-0 items-center gap-1 text-[0.8125rem] text-ink-muted" />
          {foldButton}
        </div>
        {panelBody}
      </div>
    </section>
  );
  const dockSection = (
    <section
      ref={dockPanel}
      id="wide-panel"
      aria-label={WIDE_TAB_LOOKS[activeTab].label}
      inert={!panel.open || undefined}
      data-dock-size={panel.open ? dock.size : 'folded'}
      style={dockStyle()}
      className={cn(
        'absolute inset-x-0 z-40 flex flex-col overflow-hidden rounded-t-2xl border-t border-brand/20 bg-surface shadow-[0_-8px_24px_rgb(0_0_0/0.25)]',
        'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
        !panel.open && dragHeight === null && 'invisible',
      )}
    >
      {/* The grip: drag between folded, 40 % and tall; a tap switches 40 % and tall. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Panel height"
        title="Drag to resize; tap to switch heights"
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={() => { drag.current = null; setDragHeight(null); }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          dock.choose({ open: true, party: dock.party, size: dock.size === 'mid' ? 'tall' : 'mid' });
        }}
        className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className="h-1 w-9 rounded-full bg-ink/25" aria-hidden="true" />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 pl-4 pr-1 border-b border-ink/10">
        {panelHeading}
        <div ref={setHeaderSlot} className="flex shrink-0 items-center gap-1 text-[0.8125rem] text-ink-muted" />
        {foldButton}
      </div>
      {panelBody}
    </section>
  );

  // ── A Library panel on the dock: a sheet from 8 px under the bar to the
  // tab row, over a backdrop; Back, Escape, the backdrop and its × close it,
  // and a tab shows its own panel in its place.
  const librarySheetRef = useSheet(docked && library !== null, true, closeLibrary);
  const librarySheet = docked && library && (
    <>
      <div aria-hidden="true" onClick={closeLibrary} style={{ bottom: tabRows }} className="absolute inset-x-0 top-0 z-40 bg-black/40" />
      <div
        ref={librarySheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={LIBRARY_NAMES[library]}
        style={{ bottom: tabRows }}
        className="absolute inset-x-0 top-2 z-40 flex flex-col overflow-hidden rounded-t-2xl border-t border-brand/20 bg-surface shadow-[0_-8px_24px_rgb(0_0_0/0.25)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      >
        <div aria-hidden="true" className="flex h-5 shrink-0 items-center justify-center">
          <span className="h-1 w-9 rounded-full bg-ink/25" />
        </div>
        <div ref={librarySlot.ref} className="finger-controls flex min-h-0 flex-1 flex-col overflow-y-auto" />
      </div>
    </>
  );

  // ── Library: a menu in the bar, or tiles at the top of a phone's ⋯ ──
  const libraryRows = (
    <>
      {isGM && (
        <>
          <MenuRow icon={MapIcon} label="Scenes" tour="tool-maps" onSelect={() => onOpenTool('maps')} />
          <MenuRow icon={Swords} label="Tokens" tour="tool-tokens" onSelect={() => onOpenTool('tokens')} />
          <MenuRow icon={Skull} label="Creatures" tour="tool-creatures" onSelect={() => onOpenTool('creatures')} />
          <MenuRow icon={Stamp} label="Token Templates" tour="tool-templates" onSelect={() => onOpenTool('templates')} />
          <MenuSeparator />
        </>
      )}
      {onOpenSpells && <MenuRow icon={Sparkles} label="Spells" tour="spells" onSelect={onOpenSpells} />}
      <MenuRow icon={BookOpen} label="Documents" tour="documents" onSelect={onOpenDocuments} />
    </>
  );
  const libraryTiles = (
    <div role="group" aria-label="Library" className="px-4 pt-1 pb-2">
      <div className="pb-2 text-xs font-medium text-ink-muted">Library</div>
      <div className="grid grid-cols-3 gap-2">
        {isGM && (
          <>
            <LibraryTile icon={MapIcon} label="Scenes" tour="tool-maps" onSelect={() => onOpenTool('maps')} />
            <LibraryTile icon={Swords} label="Tokens" tour="tool-tokens" onSelect={() => onOpenTool('tokens')} />
            <LibraryTile icon={Skull} label="Creatures" tour="tool-creatures" onSelect={() => onOpenTool('creatures')} />
            <LibraryTile icon={Stamp} label="Token Templates" tour="tool-templates" onSelect={() => onOpenTool('templates')} />
          </>
        )}
        {onOpenSpells && <LibraryTile icon={Sparkles} label="Spells" tour="spells" onSelect={onOpenSpells} />}
        <LibraryTile icon={BookOpen} label="Documents" tour="documents" onSelect={onOpenDocuments} />
      </div>
    </div>
  );

  return (
    <>
      <header
        className={cn(
          'relative z-40 flex h-12 pointer-coarse:h-13 shrink-0 items-center gap-1 border-b border-brand/20',
          layout === 'wide' ? 'px-2' : 'pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))]',
          phone && 'h-13',
          header,
        )}
      >
        {layout === 'wide' ? (
          <button
            type="button"
            // Asking first about work the page holds, such as Paint not saved.
            onClick={() => leavePage('/dashboard')}
            className="inline-flex shrink-0 items-center gap-2 h-10 pointer-coarse:h-11 px-4 rounded-xl border border-brand text-base font-medium text-brand-ink hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Dashboard
          </button>
        ) : (
          <button
            type="button"
            onClick={() => leavePage('/dashboard')}
            aria-label="Back to the dashboard"
            title="Dashboard"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <ChevronLeft className="w-5.5 h-5.5" aria-hidden="true" />
          </button>
        )}
        {layout === 'wide' && <span className="h-6 w-px shrink-0 bg-brand/20" aria-hidden="true" />}
        <h1
          className={cn('mx-1 min-w-0 truncate font-heading leading-6 font-bold text-brand-ink', phone ? 'text-[17px]' : 'text-lg')}
          title={campaign.name}
        >
          {campaign.name}
        </h1>
        {/* Only while not connected: connecting, offline, or an error with Retry. */}
        {status !== 'connected' && <ConnectionStatus />}
        <StatusChip status={campaign.status} dot={phone} />
        {campaign.currentVibe && !phone && (
          <span className="inline-flex shrink-0 items-center text-accent-ink" title={`Vibe: ${campaign.currentVibe}`}>
            <Sun className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Vibe: {campaign.currentVibe}</span>
          </span>
        )}
        <span className="min-w-1 flex-1" />
        {layout === 'phone-landscape' && tabs}

        {!phone && (
          <TopBarMenu label="Library" icon={LibraryBig} text="Library" tour="library">
            {libraryRows}
          </TopBarMenu>
        )}

        {aiOffered && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(AI_WRITE_EVENT))}
            aria-label="AI writing help"
            title="AI writing help"
            className={cn(BAR_BUTTON, 'border border-brand text-brand-ink font-semibold', phone && 'px-0')}
          >
            <Wand className="w-4 h-4" aria-hidden="true" />
            {!phone && 'AI'}
          </button>
        )}

        {/* As player ▾ runs on the map's preview, so the map draws it here (MapCanvas). */}
        <span ref={asPlayerSlot} className="contents" />

        <TopBarMenu
          label="More"
          icon={Ellipsis}
          align="right"
          tour="more-menu"
          sheet={layout === 'phone'}
          onOpenChange={(open) => { if (!open) setMoreView('rows'); }}
          listClassName={layout === 'phone'
            ? 'bottom-[calc(57px+env(safe-area-inset-bottom))]'
            : moreView === 'display' || layout === 'phone-landscape' ? 'w-72' : undefined}
        >
          {moreView === 'display' ? (
            <div data-tour="display-panel" role="group" aria-label={DISPLAY_SETTINGS_LABEL} className="px-3 pb-3">
              <button
                type="button"
                data-keep-open
                onClick={() => setMoreView('rows')}
                className="-ml-1 mb-1 inline-flex min-h-10 pointer-coarse:min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-ink hover:bg-brand/10"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                {DISPLAY_SETTINGS_LABEL}
              </button>
              <DisplaySettings />
            </div>
          ) : (
            <>
              {/* On a phone Library is the top of ⋯, as tiles. */}
              {phone && libraryTiles}
              {isOwner && !isGM && (
                <MenuRow icon={Settings} label="Owner Settings" title="Owner settings — delete, or take back the GM role" onSelect={() => onOpenTool('settings')} />
              )}
              {isGM && (
                <>
                  {/* Mapmaker, where the map offers it, is the map's own row (MapCanvas). */}
                  <span ref={mapmakerSlot} className="contents" />
                  <MenuRow icon={Cloud} label="Atmosphere" tour="tool-atmosphere" onSelect={() => onOpenTool('atmosphere')} />
                  <MenuRow icon={Settings} label="Campaign Settings" tour="tool-settings" onSelect={() => onOpenTool('settings')} />
                </>
              )}
              {(isGM || isOwner) && <MenuSeparator />}
              <MenuRow icon={Keyboard} label={phone ? 'Shortcuts' : 'Keyboard shortcuts'} onSelect={onOpenShortcuts} />
              <MenuRow icon={Signpost} label="Tour" tour="tour-button" onSelect={startTour} />
              <MenuRow icon={MonitorCog} label={DISPLAY_SETTINGS_LABEL} tour="display" more keepOpen expanded={false} onSelect={() => setMoreView('display')} />
              <MenuRow icon={Info} label="Campaign info" more onSelect={() => setInfoOpen(true)} />
            </>
          )}
        </TopBarMenu>
      </header>

      {/* Session Paused Banner — visible to players when session is paused */}
      {campaign.status === CampaignStatus.PAUSED && !isGM && <SessionPausedBanner />}

      {/* Relative, so it clips what is absolutely placed inside it. */}
      <div ref={area} className={cn('relative flex min-h-0 flex-1 overflow-hidden', docked && 'flex-col')}>
        {layout === 'wide' && tabs}
        {(layout === 'wide' || layout === 'phone-landscape') && sidePanel}

        {/* The map is the page's, moved in here (tableHosts.tsx). */}
        <main ref={mapSlot.ref} className={cn('relative min-w-0 min-h-0 flex-1 bg-canvas', layout !== 'wide' && 'finger-controls')} />

        {docked && dockSection}
        {librarySheet}
        {docked && tabs}
      </div>

      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title="Campaign info" size="sm">
        <CampaignInfo onLeft={onLeft} />
      </Modal>
    </>
  );
}
