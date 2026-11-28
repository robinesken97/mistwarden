// ============================================
// SpiritLayerControls
// The Spirit Layer card beside the map's rail (GM): this screen's view,
// the campaign's veil and atmosphere, the scene's spirit tokens
// Spirit Layer Implementation
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCampaign } from '@/contexts/CampaignContext';
import { useTokenListIgnoringMovement } from '@/stores/gameStore';
import { useWebSocket } from '@/contexts/WebSocketContext';
import campaignService from '@/services/campaign.service';
import type { Token } from '@/types';
import { Binary, Caption, ColourGrid, GroupHeading, Help, Seg, Sep } from './map/cardParts';
import { parseSpiritStyle } from '@/utils/styleAllowlists';
import { apiErrorMessage } from '@/utils/errors';

// ============================================
// Spirit Layer Style Options
// ============================================

const SPIRIT_STYLES = [
  {
    id: 'wispy',
    label: 'Wispy',
    description: 'Drifting mist — default ethereal look',
    previewColor: 'rgba(180, 210, 230, 0.5)',
    overlayClass: 'spirit-overlay-wispy',
  },
  {
    id: 'ethereal',
    label: 'Ethereal',
    description: 'Shimmering silver-teal glow',
    previewColor: 'rgba(100, 220, 200, 0.5)',
    overlayClass: 'spirit-overlay-ethereal',
  },
  {
    id: 'shadow',
    label: 'Shadow',
    description: 'Dark and ominous — spirit of death',
    previewColor: 'rgba(30, 10, 60, 0.6)',
    overlayClass: 'spirit-overlay-shadow',
  },
  {
    id: 'dream',
    label: 'Dream',
    description: 'Shifting violet — fey or psychic realm',
    previewColor: 'rgba(140, 80, 220, 0.5)',
    overlayClass: 'spirit-overlay-dream',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Your own hue for a unique realm',
    previewColor: '',
    overlayClass: 'spirit-overlay-custom',
  },
] as const;

type SpiritStyleId = (typeof SPIRIT_STYLES)[number]['id'];

/** How long the veil switch waits for the server's answer before it can be pressed again. */
const VEIL_WAIT_MS = 5000;

/** Effect animation types available for the Custom style */
type CustomEffectId = 'wispy' | 'ethereal' | 'shadow' | 'dream';

const CUSTOM_EFFECTS: { id: CustomEffectId; label: string; description: string }[] = [
  { id: 'wispy',    label: 'Particles', description: 'Rising motes' },
  { id: 'ethereal', label: 'Shimmer',   description: 'Bright sweep' },
  { id: 'shadow',   label: 'Shadow',    description: 'Dark fog'     },
  { id: 'dream',    label: 'Rainbow',   description: 'Colour shift' },
];


// ============================================
// Helpers
// ============================================

/**
 * Parse style string.
 * Named style:  "wispy" | "ethereal" | "shadow" | "dream"
 * Custom style: "custom:#hexcolor" (legacy) or "custom:#hexcolor:effectId"
 */
function parseStyle(raw: string): { styleId: SpiritStyleId; customColor: string; customEffect: CustomEffectId } {
  // The same parser the map renders with, so the editor and the overlay can
  // never disagree about what a stored style means.
  const { effect, customColor } = parseSpiritStyle(raw);
  if (customColor) return { styleId: 'custom', customColor, customEffect: effect };
  return { styleId: effect, customColor: '#9370DB', customEffect: 'wispy' };
}

function encodeStyle(styleId: SpiritStyleId, customColor: string, customEffect: CustomEffectId = 'wispy'): string {
  return styleId === 'custom' ? `custom:${customColor}:${customEffect}` : styleId;
}

// ============================================
// Component
// ============================================

interface SpiritLayerControlsProps {
  /** Spirit tokens drawn on this screen (the GM's own view). */
  spiritTokensShown: boolean;
  onSpiritTokensShownChange: (shown: boolean) => void;
}

/** The Spirit Layer card's body (the rail's ghost cell). */
export default function SpiritLayerControls({ spiritTokensShown, onSpiritTokensShownChange }: SpiritLayerControlsProps) {
  const { campaign, viewedMap, updateCampaignSpiritLayer, gmViewBothPlanes, setGmViewBothPlanes } = useCampaign();
  // Lists spirit tokens by name — no need to re-render on token movement.
  const tokens = useTokenListIgnoringMovement();
  const { socket } = useWebSocket();

  // Derived state from campaign
  const enabled = campaign?.spiritLayerEnabled ?? false;
  const { styleId: initialStyleId, customColor: initialColor, customEffect: initialEffect } = parseStyle(
    campaign?.spiritLayerStyle ?? 'wispy'
  );

  // Local UI state
  const [selectedStyle, setSelectedStyle] = useState<SpiritStyleId>(initialStyleId);
  const [customColor, setCustomColor] = useState(initialColor);
  const [customEffect, setCustomEffect] = useState<CustomEffectId>(initialEffect);
  const [isSavingStyle, setIsSavingStyle] = useState(false);
  const [isTogglingLayer, setIsTogglingLayer] = useState(false);
  const [tokenTogglingIds, setTokenTogglingIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync style state when campaign changes (including real-time WS updates)
  useEffect(() => {
    if (!campaign) return;
    const { styleId, customColor: color, customEffect: effect } = parseStyle(campaign.spiritLayerStyle);
    setSelectedStyle(styleId);
    setCustomColor(color);
    setCustomEffect(effect);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the saved style; a refetched campaign with the same style keeps the choice being made
  }, [campaign?.spiritLayerStyle]);

  // Spirit layer tokens from current map
  const spiritTokens: Token[] = tokens.filter((t) => t.layer === 'spirit');

  // ============================================
  // Spirit Layer Toggle
  // ============================================

  // Opening or closing the veil is the server's to do. The page changes when
  // its broadcast arrives (spirit_layer.toggled, sent to every member, this
  // one included), and a refusal comes back as a message; marking it open
  // here first left the page saying so after a refusal. The switch waits
  // meanwhile, for a few seconds at most.
  const handleToggleLayer = useCallback(() => {
    if (!socket || !campaign) return;
    setErrorMsg(null);
    setIsTogglingLayer(true);
    socket.emitSpiritLayerToggle({ visible: !enabled });
  }, [socket, campaign, enabled]);

  useEffect(() => {
    setIsTogglingLayer(false);
  }, [enabled]);

  useEffect(() => {
    if (!isTogglingLayer) return;
    const timer = setTimeout(() => setIsTogglingLayer(false), VEIL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isTogglingLayer]);

  // ============================================
  // Style Selector
  // ============================================

  // The veil as the page holds it now, for a save that answers after the
  // server has opened or closed it: the answer must not put back the veil
  // as it was when the save began.
  const enabledNow = useRef(enabled);
  useEffect(() => {
    enabledNow.current = enabled;
  }, [enabled]);

  // A style is saved, then announced to the table. The picker shows the
  // choice meanwhile and goes back to the stored style when the save is
  // refused, saying why.
  const saveStyle = async (encoded: string, failure: string) => {
    if (!campaign) return;
    setIsSavingStyle(true);
    setErrorMsg(null);
    try {
      await campaignService.updateCampaign(campaign.id, { spiritLayerStyle: encoded });
      updateCampaignSpiritLayer(enabledNow.current, encoded);
      socket?.emitSpiritLayerStyleChange(encoded);
    } catch (err) {
      const stored = parseStyle(campaign.spiritLayerStyle ?? 'wispy');
      setSelectedStyle(stored.styleId);
      setCustomColor(stored.customColor);
      setCustomEffect(stored.customEffect);
      setErrorMsg(apiErrorMessage(err) || failure);
    } finally {
      setIsSavingStyle(false);
    }
  };

  const handleStyleSelect = (styleId: SpiritStyleId) => {
    setSelectedStyle(styleId);
    void saveStyle(encodeStyle(styleId, customColor, customEffect), 'Failed to save style');
  };

  // The picker reports every move: shown at once, saved once it rests.
  const colourSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (colourSave.current) clearTimeout(colourSave.current); }, []);
  const handleCustomColorChange = (color: string) => {
    setCustomColor(color);
    if (colourSave.current) clearTimeout(colourSave.current);
    colourSave.current = setTimeout(() => { void saveStyle(encodeStyle('custom', color, customEffect), 'Failed to save colour'); }, 400);
  };

  const handleCustomEffectChange = (effect: CustomEffectId) => {
    setCustomEffect(effect);
    void saveStyle(encodeStyle('custom', customColor, effect), 'Failed to save effect');
  };

  // ============================================
  // Per-Token Visibility Toggle
  // ============================================

  const handleTokenVisibilityToggle = useCallback(
    async (token: Token) => {
      if (!socket || !viewedMap) return;
      setTokenTogglingIds((prev) => new Set(prev).add(token.id));
      setErrorMsg(null);

      try {
        socket.emitSpiritLayerTokenToggle(viewedMap.id, token.id, !token.visible);
      } catch {
        setErrorMsg('Failed to toggle token visibility');
      } finally {
        setTokenTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(token.id);
          return next;
        });
      }
    },
    [socket, viewedMap]
  );

  // ============================================
  // Render
  // ============================================

  const style = SPIRIT_STYLES.find((st) => st.id === selectedStyle) ?? SPIRIT_STYLES[0];
  const swatchOf = (id: SpiritStyleId) => (id === 'custom' ? customColor : SPIRIT_STYLES.find((st) => st.id === id)?.previewColor);

  return (
    <>
      {errorMsg && <p role="alert" className="m-0 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger-ink">{errorMsg}</p>}

      <GroupHeading>Only on your screen</GroupHeading>
      <Binary label="Planes" off="Active" on="Both" value={gmViewBothPlanes} onChange={setGmViewBothPlanes} />
      <Binary label="Spirit tokens" off="Hidden" on="Shown" value={spiritTokensShown} onChange={onSpiritTokensShownChange} />

      <Sep />
      <GroupHeading>For everyone in this campaign</GroupHeading>
      {/* The server opens or closes the veil; the control waits for its answer. */}
      <Binary label="Spirit realm" off="Closed" on="Open" value={enabled} disabled={isTogglingLayer} onChange={(open) => { if (open !== enabled) handleToggleLayer(); }} />
      <Help>Open lets players cross into the spirit realm. You always see into it.</Help>
      <Caption value={isSavingStyle ? 'Saving…' : undefined}>Atmosphere</Caption>
      <div className="relative shrink-0">
        <i aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 rounded-full border border-ink/30" style={{ background: swatchOf(selectedStyle) }} />
        <select aria-label="Atmosphere" value={selectedStyle} onChange={(e) => handleStyleSelect(e.target.value as SpiritStyleId)} className="input-cozy w-full pl-9 text-sm">
          {SPIRIT_STYLES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
        </select>
      </div>
      <Help>{style.description}</Help>
      {selectedStyle === 'custom' && (<>
        <ColourGrid label="Hue" swatches={[]} value={customColor} onChange={handleCustomColorChange} />
        <Seg
          label="Effect"
          options={CUSTOM_EFFECTS.map((eff) => ({ value: eff.id, label: eff.label, title: eff.description }))}
          value={customEffect}
          onChange={(v) => v && handleCustomEffectChange(v)}
          columns={2}
        />
      </>)}

      <Sep />
      <GroupHeading>For everyone on this scene</GroupHeading>
      {!viewedMap ? (
        <Help>No scene is loaded.</Help>
      ) : spiritTokens.length === 0 ? (
        <Help>No tokens are in the spirit realm on this scene.</Help>
      ) : (<>
        <Caption>{`Spirits in the realm (${spiritTokens.length})`}</Caption>
        {/* Its own scroll, at most 3 rows tall, so the card stays shorter than the map. */}
        <div role="group" aria-label="Spirits in the realm" tabIndex={0} className="flex max-h-[12.25rem] pointer-coarse:max-h-[14.5rem] shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl border border-ink/10 p-2 focus-visible:outline-2 focus-visible:outline-brand">
          {spiritTokens.map((token) => (
            <Binary
              key={token.id}
              label={token.name}
              off="Hidden"
              on="Shown"
              value={token.visible}
              disabled={tokenTogglingIds.has(token.id)}
              onChange={(shown) => { if (shown !== token.visible) void handleTokenVisibilityToggle(token); }}
            />
          ))}
        </div>
      </>)}
      <Help>Send a token here from its menu: Send to Spirit Realm.</Help>
    </>
  );
}
