/**
 * GmLightControls
 * GM tools' Lights tab.
 * Supports placing lights with pre-configured defaults (including 5E presets),
 * selecting/editing/moving properties, toggling, and deleting.
 *
 * Light model: each source has a brightRadius (full visibility) and dimRadius
 * (lightly obscured / reduced glow). This matches 5E, Fantasy d20, and most
 * TTRPG light mechanics.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { LightSource } from '@/types/walls';
import { Binary, CardButton, CardSelect, ColourGrid, GroupHeading, Help, Seg, Sep, Slider, type SegOption } from './map/cardParts';
import { presetNameOf } from './map/mapControlItems';

export type LightToolMode = 'light-place' | 'light-select' | null;

/** Defaults used when placing a new light — exposed to parent via onDefaultsChange. */
export interface LightPlacementDefaults {
  brightRadius: number;
  dimRadius: number;
  color: string;
}

const DEFAULT_PLACEMENT: LightPlacementDefaults = {
  brightRadius: 4,
  dimRadius: 8,
  color: '#ffcc66',
};

/** Named presets matching common TTRPG light sources (radii in grid squares). */
export const LIGHT_PRESETS: Array<{ label: string; bright: number; dim: number }> = [
  { label: 'Candle',    bright: 1,  dim: 2 },
  { label: 'Torch',     bright: 4,  dim: 8 },
  { label: 'Lamp',      bright: 3,  dim: 6 },
  { label: 'Lantern',   bright: 6,  dim: 12 },
  { label: 'Campfire',  bright: 8,  dim: 16 },
];

/** Preset glow colors for the palette. */
export const LIGHT_COLOR_PRESETS = [
  { label: 'Warm Amber', value: '#ffcc66' },
  { label: 'Candlelight', value: '#ff9933' },
  { label: 'Daylight', value: '#ffffee' },
  { label: 'Cool Blue', value: '#66aaff' },
  { label: 'Eerie Green', value: '#66ff99' },
  { label: 'Arcane Purple', value: '#cc66ff' },
  { label: 'Firelight', value: '#ff6633' },
  { label: 'Moonlight', value: '#aabbdd' },
];

const MODES: SegOption<Exclude<LightToolMode, null>>[] = [
  { value: 'light-place', label: 'Place' },
  { value: 'light-select', label: 'Select' },
];
const SWATCHES = LIGHT_COLOR_PRESETS.map((c) => ({ name: c.label, value: c.value }));

interface GmLightControlsProps {
  lightMode: LightToolMode;
  onLightModeChange: (mode: LightToolMode) => void;
  lightCount: number;
  onClearAll: () => void;
  selectedLight?: LightSource | null;
  onSelectedLightChange?: (light: LightSource) => void;
  onDeleteSelected?: () => void;
  lightingEnabled?: boolean;
  /** The map's Global Illumination flag: everything in line of sight counts as lit. */
  globalIllumination?: boolean;
  /** The GM ticked or unticked Global Illumination. Absent: no switch is shown. */
  onGlobalIlluminationChange?: (on: boolean) => void;
  /** Called when placement defaults change so parent can use them for new lights. */
  onDefaultsChange?: (defaults: LightPlacementDefaults) => void;
  /** Current placement defaults (parent is source of truth). */
  placementDefaults?: LightPlacementDefaults;
}

/**
 * Debounce helper: returns a stable callback that only fires `fn` after
 * `delay` ms of inactivity. Used to throttle socket emissions during slider drags.
 */
 
function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  fn: T,
  delay: number
): T {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

   
  return useCallback((...args: never[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]) as T;
}

export default function GmLightControls({
  lightMode,
  onLightModeChange,
  lightCount,
  onClearAll,
  selectedLight = null,
  onSelectedLightChange,
  onDeleteSelected,
  lightingEnabled = false,
  globalIllumination = true,
  onGlobalIlluminationChange,
  onDefaultsChange,
  placementDefaults = DEFAULT_PLACEMENT,
}: GmLightControlsProps) {
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClearAll = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    onClearAll();
  };


  // Debounced version of onSelectedLightChange for slider drags — prevents
  // raycasting on every input tick (fixes the freezing issue).
  const debouncedSelectedChange = useDebouncedCallback(
    (light: LightSource) => onSelectedLightChange?.(light),
    80
  );

  // Local transient state for slider drags so the UI feels responsive
  // even though socket emission is debounced.
  const [localBright, setLocalBright] = useState<number | null>(null);
  const [localDim, setLocalDim] = useState<number | null>(null);


  // Sync local overrides when selected light changes externally
  useEffect(() => {
    setLocalBright(null);
    setLocalDim(null);
  }, [selectedLight?.id]);

  const updateSelected = (changes: Partial<LightSource>) => {
    if (!selectedLight || !onSelectedLightChange) return;
    onSelectedLightChange({ ...selectedLight, ...changes });
  };

  /** Slider-specific update: sets local state immediately, debounces socket emit. */
  const updateSelectedSlider = (changes: Partial<LightSource>) => {
    if (!selectedLight) return;
    if ('brightRadius' in changes) setLocalBright(changes.brightRadius!);
    if ('dimRadius' in changes) setLocalDim(changes.dimRadius!);
    debouncedSelectedChange({ ...selectedLight, ...changes } as LightSource);
  };

  const updateDefaults = (changes: Partial<LightPlacementDefaults>) => {
    onDefaultsChange?.({ ...placementDefaults, ...changes });
  };

  // Determine which values to show in the editor panel:
  // - If a light is selected in select mode, show that light's properties
  // - If in place mode (or select with no selection), show placement defaults
  const isEditing = selectedLight && lightMode === 'light-select';
  const displayBright = isEditing
    ? (localBright ?? selectedLight.brightRadius)
    : placementDefaults.brightRadius;
  const displayDim = isEditing
    ? (localDim ?? selectedLight.dimRadius)
    : placementDefaults.dimRadius;
  const displayColor = isEditing ? selectedLight.color : placementDefaults.color;

  const applyPreset = (label: string) => {
    const p = LIGHT_PRESETS.find((x) => x.label === label);
    if (!p) return;
    if (isEditing) updateSelected({ brightRadius: p.bright, dimRadius: p.dim });
    else updateDefaults({ brightRadius: p.bright, dimRadius: p.dim });
  };
  const preset = presetNameOf(LIGHT_PRESETS, displayBright, displayDim);
  const setColour = (color: string) => (isEditing ? updateSelected({ color }) : updateDefaults({ color }));

  return (
    <>
      {onGlobalIlluminationChange && (<>
        <GroupHeading>For everyone on this scene</GroupHeading>
        {/* Global light: everything in line of sight counts as lit. Off, lights and darkvision decide, which is when lights matter. */}
        <Binary label="Global light" value={globalIllumination} disabled={!lightingEnabled} onChange={onGlobalIlluminationChange} />
      </>)}
      {!lightingEnabled && (
        <Help>Dynamic lighting is off. Turn it on in the scene&apos;s settings for lights to change what players see.</Help>
      )}
      {lightingEnabled && !globalIllumination && lightCount === 0 && (
        <Help>No lights placed and Global light is off: players see only their darkvision.</Help>
      )}
      <Sep />
      <Seg label="Mode" options={MODES} value={lightMode} onChange={onLightModeChange} deselect />
      {lightMode && (
        <Help>{lightMode === 'light-place' ? 'Click the map to place a light.' : 'Click a light to change it; drag it to move it.'}</Help>
      )}

      {/* The light's settings: the chosen one's in Select, the next one's in Place. */}
      {lightMode && (<>
        {isEditing && (
          <Binary label="This light" off="Out" on="Lit" value={selectedLight.enabled} onChange={(enabled) => updateSelected({ enabled })} />
        )}
        <CardSelect label="Preset" value={preset} onChange={applyPreset}>
          {LIGHT_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          {preset === 'Custom' && <option value="Custom">Custom</option>}
        </CardSelect>
        <Slider
          label="Bright light"
          valueText={`${displayBright.toFixed(1)} sq`}
          min={0}
          max={50}
          step={0.5}
          value={displayBright}
          onChange={(v) => {
            // Dim stays at least as far as bright.
            if (isEditing) updateSelectedSlider({ brightRadius: v, dimRadius: Math.max(v, localDim ?? selectedLight.dimRadius) });
            else updateDefaults({ brightRadius: v, dimRadius: Math.max(v, placementDefaults.dimRadius) });
          }}
        />
        <Slider
          label="Dim light"
          valueText={`${displayDim.toFixed(1)} sq`}
          min={0.5}
          max={50}
          step={0.5}
          value={displayDim}
          onChange={(v) => {
            // Bright stays at most as far as dim.
            if (isEditing) updateSelectedSlider({ dimRadius: v, brightRadius: Math.min(v, localBright ?? selectedLight.brightRadius) });
            else updateDefaults({ dimRadius: v, brightRadius: Math.min(v, placementDefaults.brightRadius) });
          }}
        />
        <ColourGrid label="Colour" swatches={SWATCHES} value={displayColor} onChange={setColour} />
        {isEditing && <CardButton onClick={() => onDeleteSelected?.()} danger>Delete light</CardButton>}
      </>)}

      {lightCount > 0 && (<>
        <Sep />
        <CardButton onClick={handleClearAll} onBlur={() => setConfirmClear(false)} danger>
          {confirmClear ? 'Confirm clear all?' : `Clear all (${lightCount})`}
        </CardButton>
      </>)}
    </>
  );
}
