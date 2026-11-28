// ============================================
// Campaign Page
// The game table: the map, the session panels and the Party content, drawn
// once (components/campaign/tableHosts.tsx) and arranged by the table
// (components/campaign/DesktopTable.tsx) in one of four ways: wide from
// 1024 px (COMPACT_LAYOUT_QUERY), and below it a tablet's, a phone's upright
// (PHONE_QUERY) or a phone's on its side (SIDEWAYS_QUERY), each with the map
// under one top bar and its panel tabs in a dock, a column or the bar.
// Everything an arrangement change must keep
// stays here: the page's listeners, every window and slide-over and whether
// it is open, the Library panel's content (a table part, shown in the panel
// slot or a sheet), and the token quick editor.
// ============================================

import { useState, useEffect, lazy, Suspense } from 'react';
import { isCampaignOwner } from '@/utils/campaignRoles';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { COMPACT_LAYOUT_QUERY, PHONE_QUERY, SIDEWAYS_QUERY, type TableLayout } from '@/constants/layout';
import { CampaignProvider, useCampaign } from '@/contexts/CampaignContext';
import { WebSocketProvider, useWebSocket } from '@/contexts/WebSocketContext';
import { LayoutProvider, useTableLayout } from '@/contexts/LayoutContext';
import { useGameStore } from '@/stores/gameStore';
import { useInitiativeSync } from '@/hooks/useInitiativeSync';
import { usePresenceSync } from '@/hooks/usePresenceSync';
import { ArrowLeft, Loader2 } from 'lucide-react';

// Campaign components
import { InvitePlayerButton } from '@/components/campaign/CampaignInfo';
import LeaveCampaign from '@/components/campaign/LeaveCampaign';
import PreparingBanner from '@/components/campaign/PreparingBanner';
import CampaignRoster from '@/components/campaign/CampaignRoster';
// Lazy-loaded — MapCanvas is by far the largest component in the app; splitting
// it into its own chunk keeps the CampaignPage shell fast to load and paints
// the sidebars while the canvas code downloads.
const MapCanvas = lazy(() => import('@/components/campaign/MapCanvas'));
import MapManager from '@/components/campaign/MapManager';
import TokenManager from '@/components/campaign/TokenManager';
import SpiritLayerControls from '@/components/campaign/SpiritLayerControls';
import AtmospherePanel from '@/components/campaign/AtmospherePanel';
import AtmospherePlayer from '@/components/campaign/AtmospherePlayer';
import GalleryPopup from '@/components/campaign/GalleryPopup';
import DiceOverlay from '@/components/campaign/DiceOverlay';
import TableRefusals from '@/components/campaign/TableRefusals';
import NpcQuickEditor from '@/components/campaign/NpcQuickEditor';
import CreatureLibrary from '@/components/campaign/CreatureLibrary';
import SpellLibrary from '@/components/campaign/SpellLibrary';
import { SpellAreaCampaign } from '@/utils/spells';
import TokenTemplateLibrary from '@/components/campaign/TokenTemplateLibrary';
import TokenRoster from '@/components/campaign/TokenRoster';
import CampaignSettingsModal from '@/components/campaign/CampaignSettingsModal';
import CampaignDocumentsModal from '@/components/documents/CampaignDocumentsModal';
import ShortcutsPanel from '@/components/campaign/ShortcutsPanel';
import TableTour from '@/components/campaign/TableTour';
import SessionPanels from '@/components/campaign/SessionPanels';
import DesktopTable from '@/components/campaign/DesktopTable';
import { TableHosts, type TableParts } from '@/components/campaign/tableHosts';
import { InPanelContext } from '@/components/ui/SlideOver';
import { closeLibrary, openLibrary, useTableChrome } from '@/stores/tableChromeStore';
import { type SessionToolKey } from '@/components/campaign/SessionToolbar';
import { CampaignStatus } from '@/types';
import type { Token } from '@/types';
import Button from '@/components/ui/Button';
import { useOnRejoin } from '@/hooks/useOnRejoin';
import { useAccessRevoked } from '@/hooks/useAccessRevoked';

// ============================================
// Campaign Page Content (inside provider)
// ============================================

function CampaignPageContent() {
  const navigate = useNavigate();
  const { campaign, viewedMap, loading, error, userRole, updateCampaignStatus, setActiveSession, refreshCurrentMap, catchUpAfterReconnect } = useCampaign();
  const { user } = useAuth();

  /**
   * Owning a campaign and running it are different things once the GM seat can
   * move. The owner keeps the powers that are theirs — deleting the campaign,
   * and taking the seat back — so they need a way into the settings panel even
   * when somebody else is the GM. Without this, handing the game over left the
   * campaign with nobody able to delete it: the owner had the permission and no
   * route to it, the new GM had the route and no permission.
   */
  const isOwner = isCampaignOwner(campaign, user?.id);
  const canOpenSettings = userRole === 'GM' || isOwner;
  const { socket, joinedEpoch, status } = useWebSocket();

  // Mirror combat/initiative state into the game store. Owned here rather than
  // by the initiative panel so both the tracker and the map's active-token
  // ring read one source, and so the subscription survives the panel being
  // collapsed or unmounted.
  useInitiativeSync();
  // Who is online, for the roster's dots and the chat's To list, the same way.
  usePresenceSync(campaign?.id);

  // After a WebSocket reconnect, catch up via REST. The real-time stream
  // only pushes deltas; moves, wall edits and fog ops, a pause or an end, a
  // member's new role and a switch to another map that broadcast while this
  // client was offline are not replayed, so without this the page stays on
  // its pre-disconnect state until the next live event arrives (or a hard
  // refresh). Once the connection has joined the campaign again, so nothing
  // sent while the read is in flight is missed.
  useOnRejoin(joinedEpoch, catchUpAfterReconnect);

  // Removed from the campaign, left it, the campaign deleted, or the sign-in
  // ended elsewhere: say why and leave the table. Leave Campaign, in the
  // Campaign Info panel, is told the same way.
  const endTable = useAccessRevoked();

  // A player changing their character's token image rewrites the image on every
  // token bound to that character, server-side — tokens hold their own copy. The
  // map has to refetch to show it, but only when tokens really changed: this
  // event also fires for every HP tweak and sheet save.
  useEffect(() => {
    if (!socket) return;
    const handleCharacterUpdated = (data: { tokensChanged?: boolean }) => {
      if (data?.tokensChanged) refreshCurrentMap();
    };
    socket.on('character.updated', handleCharacterUpdated);
    return () => {
      socket.off('character.updated', handleCharacterUpdated);
    };
    // refreshCurrentMap MUST be a dependency. It is a useCallback keyed on the
    // campaign and map ids, so its identity changes once they load. Keyed on
    // `socket` alone this effect would run once and capture the version built
    // before either existed — whose body returns immediately — and the refresh
    // would silently never happen. (`socket` is a module singleton, so it never
    // changes identity and cannot re-trigger this on its own.)
  }, [socket, refreshCurrentMap]);
  const [isSpiritLayerOpen, setIsSpiritLayerOpen] = useState(false);
  const [isAtmospherePanelOpen, setIsAtmospherePanelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
  // The keyboard shortcuts window, opened from the header or by ? on the map.
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  // Scenes, Tokens, Creatures, Token Templates and Spells: shown in the
  // panel slot, or a sheet on a compact layout (DesktopTable).
  const library = useTableChrome((s) => s.library);
  // The token in the quick editor, with the map it was opened on, which its
  // saves name: the map on screen can change under it (the table moved from
  // elsewhere, the map being prepared deleted).
  const [quickEdit, setQuickEdit] = useState<{ token: Token; mapId: string } | null>(null);
  const editToken = (token: Token) => {
    if (viewedMap) setQuickEdit({ token, mapId: viewedMap.id });
  };
  const layout = useTableLayout();

  // SessionToolbar reports which tool was clicked; the open/close state
  // for each slide-over stays here.
  const sessionPanelOpeners: Record<SessionToolKey, () => void> = {
    maps: () => openLibrary('scenes'),
    tokens: () => openLibrary('tokens'),
    creatures: () => openLibrary('creatures'),
    templates: () => openLibrary('templates'),
    spirit: () => setIsSpiritLayerOpen(true),
    atmosphere: () => setIsAtmospherePanelOpen(true),
    settings: () => setIsSettingsOpen(true),
  };

  // ============================================
  // Session WebSocket listeners
  // All clients (GM + Players) listen so campaign status stays in sync
  // ============================================
  useEffect(() => {
    // Register on the live socket only once it is actually connected. The socket
    // wrapper is a stable singleton whose underlying connection is created
    // asynchronously, so registering before the connection exists would silently
    // no-op. Re-running when `status` flips to 'connected' — including after a
    // reconnect that recreates the socket — (re)registers on the live socket.
    if (!socket || status !== 'connected') return;

    const handleStarted = (data: { sessionId: string; sessionNumber: number; startedAt: string }) => {
      updateCampaignStatus(CampaignStatus.ACTIVE);
      setActiveSession({ id: data.sessionId, sessionNumber: data.sessionNumber, startedAt: data.startedAt });
    };
    const handlePaused = () => {
      updateCampaignStatus(CampaignStatus.PAUSED);
    };
    const handleEnded = () => {
      updateCampaignStatus(CampaignStatus.INACTIVE);
      setActiveSession(null);
    };
    const handleResumed = (data: { sessionId: string; sessionNumber: number; startedAt: string }) => {
      updateCampaignStatus(CampaignStatus.ACTIVE);
      setActiveSession({ id: data.sessionId, sessionNumber: data.sessionNumber, startedAt: data.startedAt });
    };

    socket.onSessionStarted(handleStarted);
    socket.onSessionPaused(handlePaused);
    socket.onSessionEnded(handleEnded);
    socket.onSessionResumed(handleResumed);

    return () => {
      // Through the client, not the raw io instance. The client keeps a registry
      // so listeners survive a reconnect, and `getSocket().off()` only detaches
      // from the current instance — the registry entry would survive and be
      // re-attached on the next reconnect, stacking up four more stale handlers
      // every time this effect re-ran.
      socket.off('session.started', handleStarted);
      socket.off('session.paused', handlePaused);
      socket.off('session.ended', handleEnded);
      socket.off('session.resumed', handleResumed);
    };
  }, [socket, status, updateCampaignStatus, setActiveSession]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-page flex items-center justify-center bg-linear-to-br/srgb from-soft-cream via-parchment to-warm-amber/20">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-brand-ink animate-spin mx-auto" />
          <p className="text-stone-gray">Loading campaign...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-page flex items-center justify-center bg-linear-to-br/srgb from-soft-cream via-parchment to-warm-amber/20">
        <div className="card-cozy max-w-md text-center space-y-4">
          <p className="text-danger-ink font-medium">{error}</p>
          <Button onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-4 h-4 inline mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // No campaign loaded
  if (!campaign) {
    return (
      <div className="min-h-page flex items-center justify-center bg-linear-to-br/srgb from-soft-cream via-parchment to-warm-amber/20">
        <div className="card-cozy max-w-md text-center space-y-4">
          <p className="text-stone-gray">Campaign not found</p>
          <Button onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="w-4 h-4 inline mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // The map, the session panels and the Party content, each drawn once here
  // and moved into the slots of the arrangement on screen, so a change of
  // arrangement remounts none of them.
  const tableParts: TableParts = {
    map: (
      // The banner over a map the GM is preparing, then the map below it.
      <div className="flex h-full w-full flex-col">
        <PreparingBanner />
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center" aria-live="polite" aria-label="Loading map">
                <Loader2 className="w-8 h-8 text-brand-ink animate-spin" aria-hidden="true" />
              </div>
            }
          >
            <MapCanvas onEditToken={editToken} onShowShortcuts={() => setIsShortcutsOpen(true)} onOpenSpiritLayer={() => setIsSpiritLayerOpen(true)} />
          </Suspense>
        </div>
      </div>
    ),
    session: <SessionPanels />,
    party: (
      <div className="space-y-4">
        {/* The Campaign Info card is in ⋯ › Campaign info; the Party tab
            keeps its Invite Player or Leave Campaign at the top. */}
        {userRole === 'GM'
          ? <InvitePlayerButton />
          : userRole && <LeaveCampaign campaign={campaign} userRole={userRole} onLeft={endTable} />}
        <CampaignRoster />
        {/* Token Roster — GM only */}
        {userRole === 'GM' && (
          <TokenRoster onEditToken={editToken} />
        )}
      </div>
    ),
    // The Library panel: each library's content, drawn in the panel slot (wide) or a sheet (compact).
    library: (
      <InPanelContext.Provider value={true}>
        {userRole === 'GM' && (
          <>
            <MapManager isOpen={library === 'scenes'} onClose={closeLibrary} />
            <TokenManager isOpen={library === 'tokens'} onClose={closeLibrary} />
            <CreatureLibrary isOpen={library === 'creatures'} onClose={closeLibrary} />
            <TokenTemplateLibrary isOpen={library === 'templates'} onClose={closeLibrary} />
          </>
        )}
        {/* Every member reads the Spell Library. */}
        <SpellLibrary isOpen={library === 'spells'} onClose={closeLibrary} />
      </InPanelContext.Provider>
    ),
  };

  return (
    // The dynamic viewport height: on a phone or a tablet the browser's
    // toolbar comes and goes, and h-screen (100vh) is the height without it,
    // which put the bottom of the page under the toolbar. Its top clears a
    // notch or a home-screen app's status bar (index.css pads the other pages).
    <div data-table-page="" className="h-dvh pt-[env(safe-area-inset-top)] flex flex-col bg-linear-to-br/srgb from-soft-cream via-parchment to-warm-amber/20">
      {/* A sheet's Place area places on the map shown (utils/spells.ts). */}
      <SpellAreaCampaign.Provider value={viewedMap && campaign ? campaign.id : null}>
      <TableHosts parts={tableParts}>
        <DesktopTable
          layout={layout}
          campaign={campaign}
          isOwner={isOwner}
          onOpenTool={(key) => sessionPanelOpeners[key]()}
          onOpenDocuments={() => setIsDocumentsOpen(true)}
          onOpenSpells={() => openLibrary('spells')}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          onLeft={endTable}
        />
      </TableHosts>
      </SpellAreaCampaign.Provider>

      {/* Spirit Layer Controls slide-over panel (GM only) */}
      {userRole === 'GM' && (
        <SpiritLayerControls
          isOpen={isSpiritLayerOpen}
          onClose={() => setIsSpiritLayerOpen(false)}
        />
      )}

      {/* Atmosphere Panel slide-over (GM only) */}
      {userRole === 'GM' && (
        <AtmospherePanel
          isOpen={isAtmospherePanelOpen}
          onClose={() => setIsAtmospherePanelOpen(false)}
        />
      )}

      {/* NPC Quick Editor — GM only */}
      {userRole === 'GM' && quickEdit && campaign && (
        <NpcQuickEditor
          token={quickEdit.token}
          campaignId={campaign.id}
          mapId={quickEdit.mapId}
          onClose={() => setQuickEdit(null)}
          onTokenUpdate={(updated) => {
            // A stat block saves when the editor closes, so its answer often
            // arrives after the GM closed the editor or opened another token.
            // Update the editor only while it still shows this token.
            setQuickEdit((open) => (open?.token.id === updated.id ? { ...open, token: updated } : open));
            useGameStore.getState().replaceToken(updated, quickEdit.mapId);
          }}
        />
      )}

      {/* Campaign Settings slide-over panel — the GM, or the owner, who sees
          only the parts that are theirs (see CampaignSettingsModal). */}
      {canOpenSettings && (
        <CampaignSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onDeleted={endTable}
        />
      )}

      {campaign?.id && (
        <CampaignDocumentsModal
          isOpen={isDocumentsOpen}
          onClose={() => setIsDocumentsOpen(false)}
          campaignId={campaign.id}
          isGM={userRole === 'GM'}
        />
      )}

      <ShortcutsPanel open={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} role={userRole} />

      {/* Atmosphere Player — mounts for ALL users, manages ambient audio sync */}
      <AtmospherePlayer />
      <GalleryPopup />
      <DiceOverlay />

      {/* What the server refuses, shown as a message */}
      <TableRefusals />

      {/* Mistwarden, 2026-11-28: the guided tour, started from its Tour button. */}
      <TableTour
        campaignId={campaign.id}
        kind={userRole === 'GM' ? 'gm' : 'player'}
        practice={campaign.isPractice === true}
        live={campaign.status === CampaignStatus.ACTIVE}
        userId={user?.id}
        role={userRole}
      />
    </div>
  );
}

// ============================================
// Campaign Page (with provider wrapper)
// ============================================

export default function CampaignPage() {
  // The page's questions of the screen: below 1024 px the compact
  // arrangements, on any device, a narrow desktop window included.
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const sideways = useMediaQuery(SIDEWAYS_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);
  const layout: TableLayout = !compact ? 'wide' : sideways ? 'phone-landscape' : phone ? 'phone' : 'tablet';
  return (
    <CampaignProvider>
      <WebSocketProvider>
        <LayoutProvider compact={compact} layout={layout}>
          <CampaignPageContent />
        </LayoutProvider>
      </WebSocketProvider>
    </CampaignProvider>
  );
}
