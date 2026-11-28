// Added for Mistwarden on 2026-11-27.
/**
 * How this device draws the table: the fog's mist, the dice animation,
 * token names, whether carried lights follow a token while it is dragged,
 * and whether spell areas move.
 * Each choice stays on the device that made it (localStorage), so a slow
 * tablet can go flat while the laptop keeps the mist. The desk layout opens
 * it from the header (DisplaySettingsButton), the compact one from More.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { MonitorCog } from 'lucide-react';
import Button from '@/components/ui/Button';
import Tooltip from '@/components/ui/Tooltip';
import { DICE_MODES, type DiceMode } from '@/dice/mode';
import { optionalStorage } from '@/utils/optionalStorage';
import { DICE_MODE_KEY, diceMode, FOG_MIST_EVENT, FOG_MIST_KEY, FOG_MIST_MODES, fogMistMode, type FogMistMode } from './DiceOverlay';
import { lightsFollowDrag, setLightsFollowDrag } from './map/lightsFollow';
import { animateAreas, setAnimateAreas } from './map/areaAnimation';
import { setTokenNameMode, tokenNameMode, TOKEN_NAME_MODES, type TokenNameMode } from './map/namePlates';

export const DISPLAY_SETTINGS_LABEL = 'Display on this device';

const DICE_LABELS: Record<DiceMode, string> = { '3d': '3D', simple: 'Simple', off: 'Off' };
const MIST_LABELS: Record<FogMistMode, string> = { mist: 'Mist', still: 'Still mist', flat: 'Flat' };
const NAME_LABELS: Record<TokenNameMode, string> = { always: 'Always', hover: 'On hover or tap', never: 'Never' };

// A height, not a min-height: WebKit ignores min-height on a styled select.
const SELECT = 'w-full px-2 py-1 pointer-coarse:h-11 text-sm border border-warm-amber/30 rounded-cozy bg-parchment/60';

/** The choices, each with a line saying what it does. */
export function DisplaySettings() {
  const fogId = useId();
  const diceId = useId();
  const lightsId = useId();
  const namesId = useId();
  const areasId = useId();
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={fogId} className="block text-sm font-semibold text-ink">Fog</label>
        <select
          id={fogId}
          aria-describedby={`${fogId}-help`}
          defaultValue={fogMistMode()}
          onChange={(e) => { optionalStorage.setItem(FOG_MIST_KEY, e.target.value); window.dispatchEvent(new Event(FOG_MIST_EVENT)); }}
          className={`mt-1 ${SELECT}`}
        >
          {FOG_MIST_MODES.map((mode) => <option key={mode} value={mode}>{MIST_LABELS[mode]}</option>)}
        </select>
        <p id={`${fogId}-help`} className="mt-1 text-xs text-ink-muted">Drifting mist, the same mist held still, or plain dark fog for a slower device.</p>
      </div>
      <div>
        <label htmlFor={diceId} className="block text-sm font-semibold text-ink">Dice animation</label>
        <select
          id={diceId}
          aria-describedby={`${diceId}-help`}
          defaultValue={diceMode()}
          onChange={(e) => optionalStorage.setItem(DICE_MODE_KEY, e.target.value)}
          className={`mt-1 ${SELECT}`}
        >
          {DICE_MODES.map((mode) => <option key={mode} value={mode}>{DICE_LABELS[mode]}</option>)}
        </select>
        <p id={`${diceId}-help`} className="mt-1 text-xs text-ink-muted">How rolls tumble across the screen. The result in the log is the same either way.</p>
      </div>
      <div>
        <label htmlFor={namesId} className="block text-sm font-semibold text-ink">Token names</label>
        <select
          id={namesId}
          aria-describedby={`${namesId}-help`}
          defaultValue={tokenNameMode()}
          onChange={(e) => setTokenNameMode(e.target.value as TokenNameMode)}
          className={`mt-1 ${SELECT}`}
        >
          {TOKEN_NAME_MODES.map((mode) => <option key={mode} value={mode}>{NAME_LABELS[mode]}</option>)}
        </select>
        <p id={`${namesId}-help`} className="mt-1 text-xs text-ink-muted">A name under each token, under the one pointed at or tapped, or none. Too small a token shows none.</p>
      </div>
      <div>
        <label className="flex items-center gap-2 pointer-coarse:min-h-11 text-sm font-semibold text-ink cursor-pointer">
          <input
            type="checkbox"
            aria-describedby={`${lightsId}-help`}
            defaultChecked={lightsFollowDrag()}
            onChange={(e) => setLightsFollowDrag(e.target.checked)}
            className="rounded-sm"
          />
          Lights follow while dragging
        </label>
        <p id={`${lightsId}-help`} className="mt-1 text-xs text-ink-muted">A torch a token carries moves with it as it is dragged. Off, the light moves when the token is put down.</p>
      </div>
      <div>
        <label className="flex items-center gap-2 pointer-coarse:min-h-11 text-sm font-semibold text-ink cursor-pointer">
          <input
            type="checkbox"
            aria-describedby={`${areasId}-help`}
            defaultChecked={animateAreas()}
            onChange={(e) => setAnimateAreas(e.target.checked)}
            className="rounded-sm"
          />
          Animate spell areas
        </label>
        <p id={`${areasId}-help`} className="mt-1 text-xs text-ink-muted">Fire flickers and frost drifts in a placed area. Off, or with reduced motion, they hold still.</p>
      </div>
    </div>
  );
}

/** The header's button for DisplaySettings, opening them in a small panel below it. */
export function DisplaySettingsButton() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Closes on a press outside it or on Escape, which hands focus back to the button.
  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Tooltip content={DISPLAY_SETTINGS_LABEL} side="bottom">
        <Button
          ref={button}
          variant="ghost"
          iconOnly
          icon={MonitorCog}
          aria-label={DISPLAY_SETTINGS_LABEL}
          data-tour="display"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((was) => !was)}
        />
      </Tooltip>
      {/* z-80: over the button's own tooltip (z-70), which stays up while the button has focus. */}
      {open && (
        <div
          id={panelId}
          data-tour="display-panel"
          role="group"
          aria-label={DISPLAY_SETTINGS_LABEL}
          className="absolute right-0 top-full z-80 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-cozy border border-ink/10 bg-paper p-3 shadow-xl"
        >
          <h2 className="mb-2 text-sm font-semibold text-ink">{DISPLAY_SETTINGS_LABEL}</h2>
          <DisplaySettings />
        </div>
      )}
    </div>
  );
}
