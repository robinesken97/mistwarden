/**
 * GmFogControls
 * GM tools' Fog tab.
 * Carries the per-map switch: with fog on, the GM reveals or hides regions
 * by dragging a box over the map (the selection snaps to whole grid squares)
 * plus bulk reveal/hide actions; with fog off the panel says so and offers
 * nothing that would change what players see.
 */

import { useState } from 'react';
import type { FogShape } from '@/components/campaign/map/tools/useFogTool';
import { Binary, ButtonRow, CardButton, GroupHeading, Help, Seg, Sep, type SegOption } from './map/cardParts';

export type FogToolMode = 'fog-reveal' | 'fog-hide' | null;

interface GmFogControlsProps {
  fogMode: FogToolMode;
  onFogModeChange: (mode: FogToolMode) => void;
  /** Mistwarden: the shape a drag makes, and the brush's radius in squares. */
  fogShape?: FogShape;
  onFogShapeChange?: (shape: FogShape) => void;
  brushSquares?: number;
  onBrushSquaresChange?: (squares: number) => void;
  onRevealAll: () => void;
  onHideAll: () => void;
  /** Whether manual fog applies on this map. */
  fogEnabled: boolean;
  /** The GM ticked or unticked "Fog of war on this map". */
  onFogEnabledChange: (enabled: boolean) => void;
  /**
   * Forget what every player has seen of this map. Absent when the map has
   * no explored memory to forget (lighting off, or the setting off).
   */
  onResetExploration?: () => void;
}

const SHAPES: SegOption<FogShape>[] = [
  { value: 'box', label: 'Box' },
  { value: 'brush', label: 'Brush' },
  { value: 'lasso', label: 'Lasso' },
];
/** The brush's radius in squares. */
const BRUSH_SIZES: SegOption<number>[] = [
  { value: 0.5, label: 'Small' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'Large' },
];
const MODES: SegOption<'fog-reveal' | 'fog-hide'>[] = [
  { value: 'fog-reveal', label: 'Reveal' },
  { value: 'fog-hide', label: 'Hide' },
];

/** A button asked twice: its first press turns it into Confirm?, a press elsewhere puts that back. */
function useAskTwice(run: () => void) {
  const [asking, setAsking] = useState(false);
  return {
    asking,
    press: () => {
      if (!asking) { setAsking(true); return; }
      setAsking(false);
      run();
    },
    reset: () => setAsking(false),
  };
}

/** GM tools' Fog tab (the card's body; MapCanvas puts the armed tool down when the tab or card closes). */
export default function GmFogControls({
  fogMode,
  onFogModeChange,
  fogShape = 'box',
  onFogShapeChange,
  brushSquares = 1,
  onBrushSquaresChange,
  onRevealAll,
  onHideAll,
  fogEnabled,
  onFogEnabledChange,
  onResetExploration,
}: GmFogControlsProps) {
  const revealAll = useAskTwice(onRevealAll);
  const hideAll = useAskTwice(onHideAll);
  const reset = useAskTwice(() => onResetExploration?.());
  const verb = fogMode === 'fog-reveal' ? 'reveal' : 'hide';

  return (
    <>
      <GroupHeading>For everyone on this scene</GroupHeading>
      {/* Off puts an armed tool down first: a reveal box dragged with fog off would change nothing players can see. */}
      <Binary
        label="Fog"
        value={fogEnabled}
        onChange={(next) => {
          if (!next) onFogModeChange(null);
          onFogEnabledChange(next);
        }}
      />
      {!fogEnabled && (
        <Help>
          Fog is off. Players see the whole map (dynamic lighting still applies).
          What you had revealed is kept for when you turn it back on.
        </Help>
      )}

      {fogEnabled && (<>
        <Sep />
        {/* Disarm: a press on the chosen mode again. */}
        <Seg label="Mode" options={MODES} value={fogMode} onChange={onFogModeChange} deselect />
        {onFogShapeChange && <Seg label="Shape" options={SHAPES} value={fogShape} onChange={(v) => v && onFogShapeChange(v)} />}
        {onBrushSquaresChange && fogShape === 'brush' && (
          <Seg label="Brush size" options={BRUSH_SIZES} value={brushSquares} onChange={(v) => v !== null && onBrushSquaresChange(v)} />
        )}
        {fogMode && (
          <Help>
            {fogShape === 'brush'
              ? <>Paint over the map to {verb} what the brush touches.</>
              : fogShape === 'lasso'
                ? <>Draw round an area; letting go {fogMode === 'fog-reveal' ? 'reveals' : 'hides'} what is inside.</>
                : <>Drag a box over the map. The selection snaps to whole squares; click a single square to {verb} just that one.</>}
            {' '}Esc or right-drag cancels.
          </Help>
        )}
        <Sep />
        <ButtonRow>
          <CardButton
            onClick={revealAll.press}
            onBlur={revealAll.reset}
            title={revealAll.asking ? 'Press again to confirm: reveal the entire map' : 'Reveal all: show the entire map to players'}
          >
            {revealAll.asking ? 'Confirm?' : 'Reveal all'}
          </CardButton>
          <CardButton
            onClick={hideAll.press}
            onBlur={hideAll.reset}
            title={hideAll.asking ? 'Press again to confirm: hide the entire map' : 'Hide all: cover the entire map with fog'}
          >
            {hideAll.asking ? 'Confirm?' : 'Hide all'}
          </CardButton>
        </ButtonRow>
      </>)}

      {/* Explored memory is separate from fog: it is what players' own
          vision has uncovered on a lit map, and only the GM can forget it. */}
      {onResetExploration && (
        <CardButton
          onClick={reset.press}
          onBlur={reset.reset}
          title={reset.asking ? 'Press again to confirm: forget what every player has seen' : 'Reset explored areas: players forget what they have seen of this map; their view now is unchanged'}
        >
          {reset.asking ? 'Confirm?' : 'Reset explored areas'}
        </CardButton>
      )}
    </>
  );
}
