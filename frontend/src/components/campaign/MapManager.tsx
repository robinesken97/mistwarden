// ============================================
// MapManager: the Scenes panel (Library › Scenes)
//
// A campaign's maps are its scenes. Shown in the page's panel slot, or a
// sheet on a compact layout (InPanelContext). Import UVTT | Create scene at
// the top, a card per scene, and below them the scene templates, a section
// that folds (kept per device). A scene's card: Set active | Open to
// prepare, Set active | Back to the table on the scene being prepared, none
// on the active scene; ⋯ holds Duplicate…, Save as template…, Edit…,
// Export as .uvtt file and Delete…. A template's: Use template, and ⋯ with
// Edit…, Duplicate… and Delete…. A template is never active and never
// reaches players.
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMotionExit } from '@/utils/motion';
import {
  Plus,
  MapPin,
  Loader2,
  Pencil,
  Trash2,
  CheckCircle,
  CircleCheck,
  AlertTriangle,
  Upload,
  Download,
  Eye,
  Copy,
  BookmarkPlus,
  LayoutTemplate,
  Square,
  Images,
  Ellipsis,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCompactLayout } from '@/contexts/LayoutContext';
import { useTableSwitch } from '@/hooks/useTableSwitch';
import { api } from '@/services/api';
import mapService from '@/services/map.service';
import type { Asset, CampaignMap } from '@/types';
import type { MenuItem } from '@/components/ui/menu';
import CreateMapModal from './CreateMapModal';
import TokenTransferConfirmation from './TokenTransferConfirmation';
import EditMapModal from './EditMapModal';
import ScenesMenu from './ScenesMenu';
import SceneCopyDialog, { SCENE_BUTTON_PRIMARY, SCENE_BUTTON_SECONDARY, type SceneCopyKind } from './SceneCopyDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ChoiceSegments from '@/components/ui/ChoiceSegments';
import SlideOver, { SlideOverClose, SlideOverTitle } from '@/components/ui/SlideOver';
import { optionalStorage } from '@/utils/optionalStorage';
import { assetAddressVersion, extractAssetId } from '@/utils/assetUrl';
import { pictureIsDrawn, rememberPictureAsset } from './map/paint/mapPicture';
import { usePaintStore } from '@/stores/paintStore';
import { dropDrafts, paintDraftStore } from './map/paint/paintDrafts';
import { apiErrorCode, apiErrorMessage } from '@/utils/errors';
import { cn } from '@/utils/cn';
import {
  uvttImportDecision,
  uvttImportMessage,
  uvttImportTitle,
  hasOutOfBounds,
} from '@/utils/uvttImport';
import type { UvttImportDecision } from '@/utils/uvttImport';

interface MapManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Whether the Templates section is open, kept per device. */
export const SCENE_TEMPLATES_KEY = 'mistwarden.sceneTemplates';

/** A scene's grid in short: "24×18 · 70 px". */
export const sceneGridInfo = (map: CampaignMap) => `${map.width}×${map.height} · ${map.gridSize} px`;

const BADGE = 'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold';

// ============================================
// Scene card
// ============================================

interface SceneCardProps {
  map: CampaignMap;
  /** active: the table's scene; preparing: open on the GM's screen only; template: a scene template. */
  state: 'active' | 'preparing' | 'template' | 'other';
  menu: MenuItem[];
  /** The card's action row: none on the active scene. */
  children?: React.ReactNode;
}

function SceneCard({ map, state, menu, children }: SceneCardProps) {
  const thumbnailId = extractAssetId(map.imageUrl);
  const cardExit = useMotionExit({ opacity: 0, scale: 0.95 });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={cardExit}
      className={cn('flex shrink-0 flex-col gap-3 rounded-xl border bg-paper p-3', state === 'active' ? 'border-brand' : 'border-ink/10')}
    >
      <div className="flex items-start gap-3">
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-ink/10 bg-canvas">
          {thumbnailId ? (
            <img
              src={api.getAssetThumbnailUrl(thumbnailId, 'maps') + assetAddressVersion(map.imageUrl)}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                const t = e.target as HTMLImageElement;
                t.onerror = null;
                t.style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <MapPin className="w-6 h-6 text-ink-muted/40" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          {/* Two lines at most, balanced, never cut short by an ellipsis on one line. */}
          <h3 className="line-clamp-2 max-w-full font-heading text-base leading-5 font-bold text-brand-ink [overflow-wrap:anywhere] [text-wrap:balance]">{map.name}</h3>
          <p className="whitespace-nowrap text-xs text-ink-muted">{sceneGridInfo(map)}</p>
          {state === 'active' && <span className={cn(BADGE, 'bg-brand text-brand-text')}><CircleCheck className="w-3 h-3" aria-hidden="true" />Active</span>}
          {state === 'preparing' && <span className={cn(BADGE, 'bg-paper text-info-ink ring-1 ring-inset ring-info-ink')}><Eye className="w-3 h-3" aria-hidden="true" />Preparing</span>}
          {state === 'template' && <span className={cn(BADGE, 'bg-paper text-brand-ink ring-1 ring-inset ring-brand-ink')}><LayoutTemplate className="w-3 h-3" aria-hidden="true" />Template</span>}
        </div>
        <ScenesMenu
          label={`More for ${map.name}`}
          sheetTitle={map.name}
          title={`More for ${map.name}`}
          items={menu}
          buttonClassName={cn(
            '-mt-1 -mr-1 inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-ink',
            'focus-visible:outline-2 focus-visible:outline-brand aria-expanded:bg-brand/20 aria-expanded:text-brand-ink aria-expanded:shadow-[inset_0_0_0_1px_var(--color-brand)]',
          )}
        >
          <Ellipsis className="w-5 h-5" aria-hidden="true" />
        </ScenesMenu>
      </div>
      {children && <div className="grid grid-cols-2 gap-2">{children}</div>}
    </motion.div>
  );
}

// ============================================
// MapManager (main component)
// ============================================

export default function MapManager({ isOpen, onClose }: MapManagerProps) {
  const { campaign, currentMap, viewedMap, isPreparing, updateMap, upsertCampaignMap, removeCampaignMap, openToPrepare, backToTable, mayChangeViewedMap } = useCampaign();
  const tableSwitch = useTableSwitch();
  // On a compact layout the panel is a sheet over the map: it makes way for a scene opened to prepare.
  const compact = useCompactLayout();

  const [maps, setMaps] = useState<CampaignMap[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create scene: from a picture or blank (drawn), chosen in its menu.
  const [createStart, setCreateStart] = useState<'picture' | 'drawing' | null>(null);
  const [editingMap, setEditingMap] = useState<CampaignMap | null>(null);
  // Duplicate…, Save as template…: the dialog and what it copies.
  const [copying, setCopying] = useState<{ kind: SceneCopyKind; map: CampaignMap } | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(() => optionalStorage.getItem(SCENE_TEMPLATES_KEY) === 'open');
  const showTemplates = (open: boolean) => {
    setTemplatesOpen(open);
    optionalStorage.setItem(SCENE_TEMPLATES_KEY, open ? 'open' : 'folded');
  };

  // The map being opened to prepare, while it loads.
  const [openingId, setOpeningId] = useState<string | null>(null);

  // The active map comes straight from the campaign: setCurrentMap keeps
  // campaign.currentMapId in step with every switch, so there is no separate
  // copy here to fall out of date.
  const activeMapId = campaign?.currentMapId ?? null;

  const preparedMapId = isPreparing ? viewedMap?.id ?? null : null;
  const scenes = maps.filter((m) => !m.isTemplate);
  const templates = maps.filter((m) => m.isTemplate);

  // Confirm delete
  const [mapToDelete, setMapToDelete] = useState<CampaignMap | null>(null);
  /**
   * For a drawn map: its picture can go with it, if the GM says so
   * (null while it is not a drawn map, or not yet known to be one).
   */
  const [deletePicture, setDeletePicture] = useState<boolean | null>(null);
  /** What a delete left to say: a picture kept because it is in use. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The map the question about its picture was asked for: a late answer about another map is dropped. */
  const askedAboutRef = useRef<string | null>(null);

  // UVTT import
  const uvttInputRef = useRef<HTMLInputElement>(null);
  const [isImportingUVTT, setIsImportingUVTT] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  /**
   * A UVTT the server would not import without being asked: its walls reach
   * outside its picture, or it carries walls for its furniture, or both. Held
   * here so the same file can be sent again with the answer.
   */
  const [uvttToConfirm, setUvttToConfirm] = useState<{
    file: File;
    decision: UvttImportDecision;
  } | null>(null);
  const [includeObjectWalls, setIncludeObjectWalls] = useState(false);

  // Fetch maps when the panel opens
  const fetchMaps = useCallback(async () => {
    if (!campaign?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await mapService.getMaps(campaign.id);
      setMaps(fetched);
    } catch {
      setError('Failed to load scenes.');
    } finally {
      setIsLoading(false);
    }
  }, [campaign?.id]);

  useEffect(() => {
    if (isOpen) {
      fetchMaps();
    }
  }, [isOpen, fetchMaps]);

  // ---- CRUD handlers ----

  /** A copy or a new scene, at the top of its list; a template stays out of the campaign's scenes. */
  const addMap = (map: CampaignMap) => {
    setMaps((prev) => [map, ...prev]);
    if (!map.isTemplate) upsertCampaignMap(map);
  };

  const handleCreated = (map: CampaignMap, drawnPicture?: Asset) => {
    addMap(map);
    // A drawn map opens on this screen with Paint on, the players staying
    // where they are; its picture is known to be drawn without asking.
    if (drawnPicture) {
      rememberPictureAsset(drawnPicture);
      usePaintStore.getState().openWhenShown(map.id);
      // Not opened (Not now kept paint on the map on screen, or it failed):
      // Paint does not turn on by itself when the map is shown later.
      void handleOpenToPrepare(map).then((opened) => {
        if (!opened && usePaintStore.getState().openOnMapId === map.id) usePaintStore.getState().openWhenShown(null);
      });
    }
  };

  const handleUpdated = (updated: CampaignMap) => {
    setMaps((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    if (!updated.isTemplate) upsertCampaignMap(updated);
    // The table's map or the one being prepared, whichever this is. A map
    // being prepared is told of its edit by nothing else: the server sends
    // map.changed for the table's map alone.
    updateMap(updated.id, updated);
  };

  const handleExport = async (map: CampaignMap) => {
    if (!campaign?.id) return;
    setError(null);
    try {
      await api.downloadUVTTExport(campaign.id, map.id, `${map.name}.uvtt`);
    } catch (err: unknown) {
      setError(apiErrorMessage(err) || 'Failed to export scene.');
    }
  };

  /**
   * Duplicate…, Save as template…: the copy the dialog asked for, with all
   * three of its choices. A copy of a scene opens to prepare; a template's
   * copy is a template, and a template stays in its list, shown.
   */
  const handleCopy = async (kind: SceneCopyKind, source: CampaignMap, request: { name: string; tokens: boolean; fog: boolean; drawings: boolean }): Promise<string | null> => {
    if (!campaign?.id) return null;
    try {
      const { map } = kind === 'saveAsTemplate'
        ? await api.saveMapAsTemplate(campaign.id, source.id, request)
        : await api.duplicateMap(campaign.id, source.id, request);
      addMap(map);
      setCopying(null);
      if (map.isTemplate) showTemplates(true);
      else void handleOpenToPrepare(map);
      return null;
    } catch (err: unknown) {
      return apiErrorMessage(err) || 'Could not copy it. Try again.';
    }
  };

  /** Use template: a fresh scene from it, opened to prepare; the table stays where it is. */
  const handleUseTemplate = async (template: CampaignMap) => {
    if (!campaign?.id) return;
    setError(null);
    setOpeningId(template.id);
    try {
      const { map } = await api.createMapFromTemplate(campaign.id, template.id);
      addMap(map);
      await handleOpenToPrepare(map);
    } catch (err: unknown) {
      setError(apiErrorMessage(err) || 'Could not make a scene from that template.');
    } finally {
      setOpeningId((opening) => (opening === template.id ? null : opening));
    }
  };

  const handleDeleteClick = (map: CampaignMap) => {
    setMapToDelete(map);
    setDeletePicture(null);
    setNotice(null);
    askedAboutRef.current = map.id;
    // Only a picture Paint made is offered; it starts as Keep. The answer
    // counts only while the question is still about this map.
    void pictureIsDrawn(map.imageUrl, campaign?.id).then((drawn) => {
      if (drawn && askedAboutRef.current === map.id) setDeletePicture((now) => now ?? false);
    });
  };

  const handleConfirmDelete = async () => {
    if (!campaign?.id || !mapToDelete) return;
    const map = mapToDelete;
    const alsoPicture = deletePicture === true;
    setMapToDelete(null);
    setDeletePicture(null);
    askedAboutRef.current = null;
    // The map on screen, being prepared: whatever holds it is asked first.
    // Deleting it ends preparing (removeCampaignMap).
    if (map.id === preparedMapId && !(await mayChangeViewedMap({ kind: 'delete', toMapId: activeMapId }))) return;
    try {
      await mapService.deleteMap(campaign.id, map.id);
      setMaps((prev) => prev.filter((m) => m.id !== map.id));
      removeCampaignMap(map.id);
      // A draft of painting on it, kept in this browser, has no map to go back to.
      const campaignId = campaign.id;
      void dropDrafts(paintDraftStore(), (draft) => draft.campaignId === campaignId && draft.mapId === map.id);
    } catch (err: unknown) {
      setError(apiErrorMessage(err) || 'Failed to delete scene.');
      return;
    }
    // Without force: a picture something else still uses stays.
    const pictureId = alsoPicture ? extractAssetId(map.imageUrl) : null;
    if (!pictureId) return;
    try {
      await api.deleteAsset(pictureId);
    } catch (err: unknown) {
      setNotice(apiErrorCode(err) === 'ASSET_IN_USE'
        ? `${map.name} is deleted. Its picture is used elsewhere, so it stays in the Asset Library.`
        : `${map.name} is deleted. Its picture could not be deleted; delete it in the Asset Library.`);
    }
  };

  // ---- UVTT import ----

  const runUVTTImport = async (
    file: File,
    opts: { confirm?: boolean; includeObjectWalls?: boolean } = {}
  ) => {
    if (!campaign?.id) return;
    setIsImportingUVTT(true);
    setError(null);
    setImportSuccess(null);
    try {
      const result = await mapService.importUVTT(campaign.id, file, undefined, undefined, opts);
      addMap(result.map);
      const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
      const parts = [count(result.totalSegments, 'wall segment')];
      if (result.portalCount > 0) parts.push(count(result.portalCount, 'door'));
      if (result.lightCount > 0) parts.push(count(result.lightCount, 'light'));
      setImportSuccess(`Imported "${result.map.name}" with ${parts.join(', ')}`);
      // Auto-clear success message after 5 seconds
      setTimeout(() => setImportSuccess(null), 5000);
    } catch (err: unknown) {
      // The file needs an answer before it can become a map. Nothing has been
      // created; ask, then send the same file again with the decision.
      if (apiErrorCode(err) === 'UVTT_IMPORT_NEEDS_CONFIRMATION') {
        const decision = uvttImportDecision(err);
        if (decision) {
          setIncludeObjectWalls(false);
          setUvttToConfirm({ file, decision });
          return;
        }
      }
      setError(apiErrorMessage(err) || 'Failed to import UVTT file.');
    } finally {
      setIsImportingUVTT(false);
    }
  };

  const handleUVTTImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !campaign?.id) return;
    // Reset input so the same file can be re-selected
    e.target.value = '';
    await runUVTTImport(file);
  };

  const handleConfirmUVTTImport = async () => {
    const pending = uvttToConfirm;
    setUvttToConfirm(null);
    if (pending) await runUVTTImport(pending.file, { confirm: true, includeObjectWalls });
  };

  // ---- Map switching ----

  /** Open the map to prepare, answering whether it opened. */
  const handleOpenToPrepare = async (map: CampaignMap): Promise<boolean> => {
    setError(null);
    setOpeningId(map.id);
    try {
      // On this page only. Beside the map the panel stays; a sheet over it makes way.
      const opened = await openToPrepare(map.id);
      if (opened && compact) onClose();
      return opened;
    } catch (err: unknown) {
      setError(apiErrorMessage(err) || 'Could not open that scene. Try again.');
      return false;
    } finally {
      // Only this card's: a second card opened meanwhile keeps its spinner.
      setOpeningId((opening) => (opening === map.id ? null : opening));
    }
  };

  const handleBackToTable = async () => {
    setError(null);
    try {
      await backToTable();
    } catch (err: unknown) {
      setError(apiErrorMessage(err) || 'Could not go back to the table. Try again.');
    }
  };

  if (!campaign) return null;

  const switchingToId = tableSwitch.switching ? tableSwitch.pending?.id ?? null : null;
  const spinner = <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />;

  const sceneMenu = (map: CampaignMap, active: boolean): MenuItem[] => [
    { kind: 'command', id: 'duplicate', label: 'Duplicate…', icon: Copy, run: () => setCopying({ kind: 'duplicate', map }) },
    { kind: 'command', id: 'save-as-template', label: 'Save as template…', icon: BookmarkPlus, run: () => setCopying({ kind: 'saveAsTemplate', map }) },
    { kind: 'command', id: 'edit', label: 'Edit…', icon: Pencil, run: () => setEditingMap(map) },
    { kind: 'command', id: 'export', label: 'Export as .uvtt file', icon: Download, run: () => { void handleExport(map); } },
    { kind: 'separator', id: 'sep' },
    {
      kind: 'command', id: 'delete', label: 'Delete…', icon: Trash2, tone: 'danger', run: () => handleDeleteClick(map),
      busy: { active, label: 'Cannot delete the active scene' },
    },
  ];
  const templateMenu = (map: CampaignMap): MenuItem[] => [
    { kind: 'command', id: 'edit', label: 'Edit…', icon: Pencil, run: () => setEditingMap(map) },
    { kind: 'command', id: 'duplicate', label: 'Duplicate…', icon: Copy, run: () => setCopying({ kind: 'duplicateTemplate', map }) },
    { kind: 'separator', id: 'sep' },
    { kind: 'command', id: 'delete', label: 'Delete…', icon: Trash2, tone: 'danger', run: () => handleDeleteClick(map) },
  ];
  const createMenu: MenuItem[] = [
    { kind: 'command', id: 'blank', label: 'Blank scene', icon: Square, title: 'An empty scene to draw in Mapmaker', run: () => setCreateStart('drawing') },
    { kind: 'command', id: 'picture', label: 'From a map picture', icon: Images, title: 'Pick or upload a map picture, then name it', run: () => setCreateStart('picture') },
    templates.length > 0
      ? {
        kind: 'command', id: 'template', label: 'From template', icon: LayoutTemplate,
        children: templates.map((t) => ({ id: t.id, label: t.name, run: () => { void handleUseTemplate(t); } })),
      }
      : { kind: 'command', id: 'template', label: 'From template', icon: LayoutTemplate, run: () => {}, busy: { active: true, label: 'No templates yet' } },
  ];

  return (
    <>
      <SlideOver
        open={isOpen}
        onClose={onClose}
        className="flex h-full max-w-xl flex-col overflow-hidden bg-paper-white shadow-2xl"
      >
        {/* Header: the panel's own, as the tab panels' */}
        <div className="flex h-13 shrink-0 items-center gap-2 pl-4 pr-1 border-b border-ink/10">
          <SlideOverTitle className="min-w-0 flex-1 truncate font-heading text-xl font-bold text-brand-ink">Scenes</SlideOverTitle>
          <span className="shrink-0 text-[0.8125rem] text-ink-muted" aria-label={`${scenes.length} scenes`}>{scenes.length}</span>
          <SlideOverClose
            className="inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-ink"
            iconClassName="w-5 h-5"
            title="Close"
          />
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-4">
          <button
            type="button"
            onClick={() => uvttInputRef.current?.click()}
            disabled={isImportingUVTT}
            className={SCENE_BUTTON_SECONDARY}
            title="Import a .uvtt or .dd2vtt file (Dungeondraft, DunGen, Dungeon Alchemist, etc.)"
          >
            {isImportingUVTT ? spinner : <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />}
            Import UVTT
          </button>
          <input
            ref={uvttInputRef}
            type="file"
            accept=".uvtt,.dd2vtt,.df2vtt"
            onChange={handleUVTTImport}
            className="hidden"
          />
          <ScenesMenu label="Create scene" sheetTitle="Create scene" caption="Start from" subCaption="Templates" align="left" items={createMenu} buttonClassName={SCENE_BUTTON_PRIMARY}>
            <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
            Create scene
          </ScenesMenu>
        </div>

        {(error ?? tableSwitch.error ?? notice ?? importSuccess) && (
          <div className="shrink-0 space-y-2 px-4 pt-3">
            {(error ?? tableSwitch.error) && (
              <div className="p-3 bg-danger/10 border border-danger/20 rounded-lg text-danger-ink text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {error ?? tableSwitch.error}
              </div>
            )}
            {notice && (
              <div role="status" className="p-3 bg-brand/10 border border-brand/30 rounded-lg text-brand-ink text-sm flex items-start gap-2">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {notice}
              </div>
            )}
            {importSuccess && (
              <div className="p-3 bg-brand/10 border border-brand/30 rounded-lg text-brand-ink text-sm flex items-start gap-2">
                <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {importSuccess}
              </div>
            )}
          </div>
        )}

        {/* The scenes: they scroll, the templates stay pinned under them */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-4">
          <div className="text-xs font-medium text-ink-muted">Scenes</div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-brand-ink animate-spin" aria-label="Loading scenes" />
            </div>
          ) : scenes.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">No scenes yet. Create scene or Import UVTT makes the first.</p>
          ) : (
            <AnimatePresence>
              {scenes.map((map) => {
                const active = map.id === activeMapId;
                const preparing = map.id === preparedMapId;
                return (
                  <div key={map.id} className="flex shrink-0 flex-col gap-2">
                    <SceneCard map={map} state={active ? 'active' : preparing ? 'preparing' : 'other'} menu={sceneMenu(map, active)}>
                      {!active && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setError(null); void tableSwitch.requestSwitch(map); }}
                            disabled={switchingToId === map.id}
                            title="Set as active scene"
                            className={SCENE_BUTTON_SECONDARY}
                          >
                            {switchingToId === map.id && spinner}
                            Set active
                          </button>
                          {preparing ? (
                            <button
                              type="button"
                              onClick={() => { void handleBackToTable(); }}
                              title="Stop preparing and return to the scene the table is on"
                              className={cn(SCENE_BUTTON_SECONDARY, 'whitespace-normal px-2 text-center leading-[18px] [text-wrap:balance]')}
                            >
                              Back to the table
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { void handleOpenToPrepare(map); }}
                              disabled={openingId === map.id}
                              title="Open on your screen only, while the players stay on the active scene"
                              className={SCENE_BUTTON_SECONDARY}
                            >
                              {openingId === map.id && spinner}
                              Open to prepare
                            </button>
                          )}
                        </>
                      )}
                    </SceneCard>
                    {/* Token transfer confirmation (shown under the target card) */}
                    {tableSwitch.pending?.id === map.id && (
                      <TokenTransferConfirmation
                        tokens={tableSwitch.tableTokens}
                        fromMap={currentMap}
                        targetMap={map}
                        onConfirm={(ids) => { void tableSwitch.confirm(ids); }}
                        onCancel={tableSwitch.cancel}
                        isSwitching={tableSwitch.switching}
                      />
                    )}
                  </div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        <section
          aria-label="Templates"
          className={cn('flex max-h-[60%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-ink/10 bg-surface px-4 pt-1', templatesOpen ? 'pb-3' : 'pb-1')}
        >
          <div className="flex min-h-10 pointer-coarse:min-h-11 shrink-0 items-center justify-between text-xs font-medium text-ink-muted">
            <span>Templates ({templates.length})</span>
            <button
              type="button"
              onClick={() => showTemplates(!templatesOpen)}
              aria-expanded={templatesOpen}
              aria-label={templatesOpen ? 'Fold templates' : 'Show templates'}
              title={templatesOpen ? 'Fold templates' : 'Show templates'}
              className="-mr-1 inline-flex size-10 pointer-coarse:size-11 items-center justify-center rounded-xl text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
            >
              {templatesOpen ? <ChevronDown className="w-5 h-5" aria-hidden="true" /> : <ChevronRight className="w-5 h-5" aria-hidden="true" />}
            </button>
          </div>
          {templatesOpen && (
            <>
              {templates.length === 0 && (
                <p className="text-[0.8125rem] leading-[18px] text-ink-muted">No templates yet. Save as template… in a scene’s ⋯ keeps one for this campaign.</p>
              )}
              {templates.map((map) => (
                <SceneCard key={map.id} map={map} state="template" menu={templateMenu(map)}>
                  <button
                    type="button"
                    onClick={() => { void handleUseTemplate(map); }}
                    disabled={openingId === map.id}
                    title="Makes a fresh copy of this template and opens it on your screen only, to prepare"
                    className={cn(SCENE_BUTTON_SECONDARY, 'col-span-2')}
                  >
                    {openingId === map.id && spinner}
                    Use template
                  </button>
                </SceneCard>
              ))}
              <p className="text-[0.8125rem] leading-[18px] text-ink-muted">Templates are never active and never reach players.</p>
            </>
          )}
        </section>
      </SlideOver>

      {/* Create scene: blank or from a picture */}
      {createStart && (
        <CreateMapModal
          isOpen
          start={createStart}
          campaignId={campaign.id}
          onClose={() => setCreateStart(null)}
          onCreated={handleCreated}
        />
      )}

      {copying && (
        <SceneCopyDialog
          kind={copying.kind}
          sourceName={copying.map.name}
          tableName={currentMap?.name}
          onSubmit={(request) => handleCopy(copying.kind, copying.map, request)}
          onClose={() => setCopying(null)}
        />
      )}

      {/* Edit scene */}
      {editingMap && (
        <EditMapModal
          isOpen={!!editingMap}
          map={editingMap}
          campaignId={campaign.id}
          onClose={() => setEditingMap(null)}
          onUpdated={handleUpdated}
        />
      )}
      <ConfirmDialog
        isOpen={!!uvttToConfirm}
        title={uvttImportTitle(uvttToConfirm?.decision)}
        message={uvttImportMessage(uvttToConfirm?.decision)}
        confirmLabel={
          uvttToConfirm && !hasOutOfBounds(uvttToConfirm.decision.outOfBounds)
            ? 'Import'
            : 'Import anyway'
        }
        variant="warning"
        onConfirm={handleConfirmUVTTImport}
        onCancel={() => setUvttToConfirm(null)}
      >
        {uvttToConfirm && uvttToConfirm.decision.objectWalls > 0 && (
          <ChoiceSegments
            label="Furniture"
            value={includeObjectWalls ? 'block' : 'through'}
            onChange={(v) => setIncludeObjectWalls(v === 'block')}
            options={[['through', 'Sight passes'], ['block', 'Blocks sight']]}
          />
        )}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={!!mapToDelete}
        title={mapToDelete?.isTemplate ? 'Delete template' : 'Delete scene'}
        message={`Delete "${mapToDelete?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setMapToDelete(null);
          setDeletePicture(null);
          askedAboutRef.current = null;
        }}
      >
        {deletePicture !== null && (
          <ChoiceSegments
            label="Its picture in the Asset Library"
            value={deletePicture ? 'delete' : 'keep'}
            onChange={(v) => setDeletePicture(v === 'delete')}
            options={[['keep', 'Keep'], ['delete', 'Delete']]}
          />
        )}
      </ConfirmDialog>
    </>
  );
}
