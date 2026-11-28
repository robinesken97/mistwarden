// ============================================
// Desktop Table: the campaign page's wide arrangement, from 1024 px
//
// A slim top bar (back · title · connection · Live · Library ▾ · AI ·
// As player ▾ · ⋯), then a labelled tab column on the left, the panel of
// the chosen tab beside it, and the map taking the rest. Tapping the open
// tab folds the panel to the column: folded by default below 1,280 px, open
// from there, and the user's choice kept per device (useWidePanel). The
// map's own tools are a rail on its right edge (MapCanvas).
//
// The map, the session panels and the Party content are the page's, drawn
// once and moved into this arrangement's slots (tableHosts.tsx), so they
// outlive it. A folded panel stays laid out, clipped to nothing and inert,
// so the chat keeps scrolling to its newest message and the roster keeps
// filling the hit points the map's bars read. The windows the bar opens are
// the page's too, so its buttons only ask the page to open them.
// ============================================

import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft, BookOpen, ChevronLeft, Cloud, Ellipsis, Info, Keyboard, LibraryBig, Map as MapIcon, MonitorCog,
  PanelLeftClose, PauseCircle, Settings, Signpost, Skull, Sparkles, Stamp, Sun, Swords, Wand,
} from 'lucide-react';
import { useLeavePage } from '@/hooks/useLeaveGuard';
import { useWidePanel } from '@/hooks/useWidePanel';
import { useServerConfigQuery } from '@/hooks/queries';
import { useCampaign } from '@/contexts/CampaignContext';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useGameStore } from '@/stores/gameStore';
import { useTableChrome } from '@/stores/tableChromeStore';
import { DisplaySettings, DISPLAY_SETTINGS_LABEL } from '@/components/campaign/DisplaySettings';
import { startTour } from '@/components/campaign/tour/tourSteps';
import { type SessionToolKey } from '@/components/campaign/SessionToolbar';
import { useTableSlot } from '@/components/campaign/tableHosts';
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

/** The session status chip after the title: Live, Paused or Inactive. */
function StatusChip({ status }: { status: CampaignStatus }) {
  const label = SESSION_STATUS_LABELS[status];
  if (!label) return null;
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

export default function DesktopTable({
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

  const sessionTab = useGameStore((s) => s.sessionTab);
  const setSessionTab = useGameStore((s) => s.setSessionTab);
  const setSessionShown = useGameStore((s) => s.setSessionShown);
  const unreadChat = useGameStore((s) => s.unreadChat);
  const panel = useWidePanel();
  const activeTab: WideTab = panel.party ? 'party' : sessionTab;

  // The chat counts as read only while its panel shows; folded or on Party,
  // what arrives counts on the Chat tab's badge.
  useEffect(() => {
    setSessionShown(panel.open && !panel.party);
  }, [panel.open, panel.party, setSessionShown]);
  // Another page shows the panels again; set directly, so a switch to the
  // compact layout, which sets its own value, does not read the chat as seen.
  useEffect(() => () => useGameStore.setState({ sessionShown: true }), []);

  /** Show `tab`, or fold the panel when `tab` is the one open. */
  const selectTab = (tab: WideTab) => {
    if (panel.open && tab === activeTab) {
      panel.choose({ open: false, party: panel.party });
      return;
    }
    if (tab !== 'party') setSessionTab(tab);
    panel.choose({ open: true, party: tab === 'party' });
  };

  // The arrows, Home and End move between the tabs and show the one reached.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = WIDE_TABS.length;
    const target = e.key === 'ArrowUp' ? (index - 1 + count) % count
      : e.key === 'ArrowDown' ? (index + 1) % count
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
    useTableChrome.setState({ panelHeader: headerSlot && panel.open ? { tab: activeTab, el: headerSlot } : null });
    return () => useTableChrome.setState({ panelHeader: null });
  }, [headerSlot, panel.open, activeTab]);

  // The ⋯ menu shows its rows, or Display on this device in their place.
  const [moreView, setMoreView] = useState<'rows' | 'display'>('rows');
  const [infoOpen, setInfoOpen] = useState(false);

  const aiOffered = isGM && serverConfig?.ai?.enabled === true;
  const header = 'bg-[color-mix(in_srgb,var(--color-brand)_10%,var(--color-canvas))]';

  return (
    <>
      <header className={cn('relative z-40 flex h-12 pointer-coarse:h-13 shrink-0 items-center gap-1 px-2 border-b border-brand/20', header)}>
        <button
          type="button"
          // Asking first about work the page holds, such as Paint not saved.
          onClick={() => leavePage('/dashboard')}
          className="inline-flex shrink-0 items-center gap-2 h-10 pointer-coarse:h-11 px-4 rounded-xl border border-brand text-base font-medium text-brand-ink hover:bg-brand/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Dashboard
        </button>
        <span className="h-6 w-px shrink-0 bg-brand/20" aria-hidden="true" />
        <h1 className="mx-1 min-w-0 truncate font-heading text-lg leading-6 font-bold text-brand-ink" title={campaign.name}>
          {campaign.name}
        </h1>
        {/* Only while not connected: connecting, offline, or an error with Retry. */}
        {status !== 'connected' && <ConnectionStatus />}
        <StatusChip status={campaign.status} />
        {campaign.currentVibe && (
          <span className="inline-flex shrink-0 items-center text-accent-ink" title={`Vibe: ${campaign.currentVibe}`}>
            <Sun className="w-4 h-4" aria-hidden="true" />
            <span className="sr-only">Vibe: {campaign.currentVibe}</span>
          </span>
        )}
        <span className="min-w-1 flex-1" />

        <TopBarMenu label="Library" icon={LibraryBig} text="Library" tour="library">
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
        </TopBarMenu>

        {aiOffered && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(AI_WRITE_EVENT))}
            aria-label="AI writing help"
            title="AI writing help"
            className={cn(BAR_BUTTON, 'border border-brand text-brand-ink font-semibold')}
          >
            <Wand className="w-4 h-4" aria-hidden="true" />
            AI
          </button>
        )}

        {/* As player ▾ runs on the map's preview, so the map draws it here (MapCanvas). */}
        <span ref={asPlayerSlot} className="contents" />

        <TopBarMenu
          label="More"
          icon={Ellipsis}
          align="right"
          tour="more-menu"
          onOpenChange={(open) => { if (!open) setMoreView('rows'); }}
          listClassName={moreView === 'display' ? 'w-72' : undefined}
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
              <MenuRow icon={Keyboard} label="Keyboard shortcuts" onSelect={onOpenShortcuts} />
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
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <nav
          role="tablist"
          aria-label="Panels"
          aria-orientation="vertical"
          className="flex w-[5.25rem] shrink-0 flex-col gap-1 overflow-y-auto px-1.5 py-2 bg-surface border-r border-brand/20"
        >
          {WIDE_TABS.map((key, index) => {
            const { label, icon: Icon } = WIDE_TAB_LOOKS[key];
            const shown = panel.open && activeTab === key;
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
                  'relative flex h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-[10px] px-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                  shown ? 'bg-brand/15 text-brand-ink font-semibold shadow-[inset_3px_0_0_var(--color-brand)]' : 'text-ink-muted hover:text-ink hover:bg-ink/5',
                )}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                {label}
                {key === 'chat' && unreadChat > 0 && (
                  <span
                    className="absolute top-1 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-brand-text text-[10px] font-bold flex items-center justify-center"
                    aria-label={unreadBadge(unreadChat).label}
                  >
                    {unreadBadge(unreadChat).text}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* The panel: 320 px below 1,280 px wide, 384 from there (in rem, so
            a 4K screen's larger text widens it too). Folded, it is clipped to
            nothing but stays laid out, and inert. */}
        <section
          id="wide-panel"
          aria-label={WIDE_TAB_LOOKS[activeTab].label}
          inert={!panel.open || undefined}
          className={cn(
            'relative shrink-0 overflow-hidden border-brand/20 bg-[color-mix(in_srgb,var(--color-surface)_30%,var(--color-canvas))]',
            panel.open ? 'w-80 xl:w-96 border-r' : 'w-0',
          )}
        >
          <div className="flex h-full w-80 xl:w-96 flex-col">
            <div className="flex h-13 shrink-0 items-center gap-2 pl-4 pr-1 border-b border-ink/10">
              <h2 className="min-w-0 flex-1 truncate font-heading text-xl font-bold text-brand-ink">{WIDE_TAB_LOOKS[activeTab].label}</h2>
              <div ref={setHeaderSlot} className="flex shrink-0 items-center gap-1 text-[0.8125rem] text-ink-muted" />
              <button
                type="button"
                onClick={() => panel.choose({ open: false, party: panel.party })}
                aria-label="Fold panel"
                title="Fold panel"
                className="inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand"
              >
                <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              {/* The session panels are the page's, moved in here (tableHosts.tsx). */}
              <div ref={sessionSlot.ref} className={cn('absolute inset-0', panel.party && 'invisible')} />
              {/* The Party content is the page's, moved in here. */}
              <div
                ref={partySlot.ref}
                role="tabpanel"
                aria-labelledby="session-tab-party"
                data-tour="panel-party"
                className={cn('absolute inset-0 overflow-y-auto p-4', !panel.party && 'invisible')}
              />
            </div>
          </div>
        </section>

        {/* The map is the page's, moved in here (tableHosts.tsx). */}
        <main ref={mapSlot.ref} className="relative min-w-0 flex-1 bg-canvas" />
      </div>

      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title="Campaign info" size="sm">
        <CampaignInfo onLeft={onLeft} />
      </Modal>
    </>
  );
}
