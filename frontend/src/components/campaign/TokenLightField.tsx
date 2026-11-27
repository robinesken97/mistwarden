/**
 * TokenLightField
 * The light a token carries (a torch, a lantern), wherever the GM edits a
 * token: the Token Manager when placing, the Quick Editor afterwards. Lit at
 * the token's centre, it moves with the token. The presets and colours are
 * the Lights panel's, so a carried torch is the torch placed on the map.
 *
 * Every change is one save: the switch, a preset and a colour at once, a
 * radius on blur or Enter, so typing "12" is not one save per digit.
 */

import { useEffect, useState } from 'react';
import type { CarriedLight } from '@/types/walls';
import { LIGHT_COLOR_PRESETS, LIGHT_PRESETS } from './GmLightControls';

const MAX_RADIUS = 100;
const MIN_DIM = 0.5;
const TORCH = LIGHT_PRESETS.find((p) => p.label === 'Torch') ?? LIGHT_PRESETS[0];

const pill = (on: boolean) =>
  `touch-hit px-2 py-0.5 text-xs rounded-full border transition-colors ${
    on ? 'bg-warm-amber/25 border-warm-amber text-accent-ink' : 'border-warm-amber/30 text-warm-gray hover:bg-warm-amber/10'
  }`;

interface TokenLightFieldProps {
  value: CarriedLight | null | undefined;
  onChange: (light: CarriedLight | null) => void;
  disabled?: boolean;
}

/** Radii the server takes: dim at least bright and at least half a square, both at most MAX_RADIUS. */
function fitted(light: CarriedLight): CarriedLight {
  const bright = Math.max(0, Math.min(MAX_RADIUS, light.brightRadius));
  const dim = Math.max(bright, MIN_DIM, Math.min(MAX_RADIUS, light.dimRadius));
  return { ...light, brightRadius: bright, dimRadius: dim };
}

function RadiusInput({ label, value, onCommit, disabled }: { label: string; value: number; onCommit: (n: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) { setDraft(String(value)); return; }
    if (n !== value) onCommit(n);
  };
  return (
    <label className="flex-1 text-xs text-stone-gray">
      {label} <span className="opacity-60">(squares)</span>
      <input
        type="number" min={0} max={MAX_RADIUS} step={0.5}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        aria-label={`${label} light radius in grid squares`}
        className="input-cozy input-cozy-number w-full text-sm mt-1"
      />
    </label>
  );
}

export default function TokenLightField({ value, onChange, disabled }: TokenLightFieldProps) {
  const lit = value?.enabled === true;
  const light: CarriedLight = value ?? { brightRadius: TORCH.bright, dimRadius: TORCH.dim, color: LIGHT_COLOR_PRESETS[0].value, enabled: false };
  const change = (next: Partial<CarriedLight>) => onChange(fitted({ ...light, ...next }));

  return (
    <div className="mb-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={lit}
          disabled={disabled}
          onChange={(e) => change({ enabled: e.target.checked })}
          className="rounded-sm"
        />
        <span className="text-xs text-stone-gray font-medium">Carries a light</span>
      </label>
      {lit && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Light presets">
            {LIGHT_PRESETS.map((p) => (
              <button
                key={p.label} type="button" disabled={disabled}
                className={pill(light.brightRadius === p.bright && light.dimRadius === p.dim)}
                aria-pressed={light.brightRadius === p.bright && light.dimRadius === p.dim}
                title={`Bright ${p.bright} sq, dim ${p.dim} sq`}
                onClick={() => change({ brightRadius: p.bright, dimRadius: p.dim })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <RadiusInput label="Bright" value={light.brightRadius} disabled={disabled} onCommit={(n) => change({ brightRadius: n })} />
            <RadiusInput label="Dim" value={light.dimRadius} disabled={disabled} onCommit={(n) => change({ dimRadius: n })} />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Light colour">
            {LIGHT_COLOR_PRESETS.map((c) => (
              <button
                key={c.value} type="button" disabled={disabled}
                className={`touch-hit w-5 h-5 rounded-full border-2 ${light.color === c.value ? 'border-ink' : 'border-transparent'}`}
                style={{ backgroundColor: c.value }}
                aria-label={c.label}
                aria-pressed={light.color === c.value}
                onClick={() => change({ color: c.value })}
              />
            ))}
          </div>
        </div>
      )}
      <p className="text-[10px] text-stone-gray/60 mt-1">
        Lit at the token and moves with it. Players see by it only while they can see the token.
      </p>
    </div>
  );
}
