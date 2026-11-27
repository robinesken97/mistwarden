// ============================================
// MapGridShapeFields
// The grid's type and where it starts, in Create Map and Edit Map: squares
// or hexes (utils/tokenCentre.ts), and an offset in map pixels that lines
// the drawn grid up with one printed on the picture.
// ============================================

import { useId } from 'react';
import type { GridType } from '@/utils/tokenCentre';
import { MAP_LIMITS } from '@/constants/mapLimits';

const CHOICES: ReadonlyArray<{ type: GridType; label: string }> = [
  { type: 'square', label: 'Squares' },
  { type: 'hexPointy', label: 'Hexes, point up' },
  { type: 'hexFlat', label: 'Hexes, flat top' },
];

/** An offset typed in its box, kept within the limits; anything unreadable is 0. */
export function gridOffsetWithinLimits(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAP_LIMITS.maxGridOffset, Math.min(MAP_LIMITS.maxGridOffset, value));
}

export default function MapGridShapeFields({
  gridType,
  onGridType,
  offsetX,
  offsetY,
  onOffsetX,
  onOffsetY,
}: {
  gridType: GridType;
  onGridType: (type: GridType) => void;
  offsetX: number;
  offsetY: number;
  onOffsetX: (value: number) => void;
  onOffsetY: (value: number) => void;
}) {
  const xId = useId();
  const yId = useId();
  return (
    <>
      <div>
        <span className="block text-xs font-medium text-stone-gray mb-2">Grid Type</span>
        <div className="flex gap-2 flex-wrap">
          {CHOICES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              aria-pressed={gridType === type}
              onClick={() => onGridType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors border ${
                gridType === type
                  ? 'bg-moss-green text-brand-text border-moss-green'
                  : 'bg-paper-white text-stone-gray border-moss-green/30 hover:border-moss-green/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {gridType !== 'square' && (
          <p className="text-xs text-stone-gray/50 mt-1">
            Grid Size is the distance between neighbouring hex centres. Fog stays in squares, and templates are placed freely.
          </p>
        )}
      </div>

      <div>
        <span className="block text-xs font-medium text-stone-gray mb-2">Grid Offset (px)</span>
        <div className="flex gap-2">
          <label htmlFor={xId} className="flex items-center gap-1.5 text-xs text-stone-gray/70">
            X
            <input
              id={xId}
              type="number"
              step="any"
              value={offsetX}
              onChange={(e) => onOffsetX(gridOffsetWithinLimits(e.target.value))}
              min={-MAP_LIMITS.maxGridOffset}
              max={MAP_LIMITS.maxGridOffset}
              className="input-cozy w-24"
            />
          </label>
          <label htmlFor={yId} className="flex items-center gap-1.5 text-xs text-stone-gray/70">
            Y
            <input
              id={yId}
              type="number"
              step="any"
              value={offsetY}
              onChange={(e) => onOffsetY(gridOffsetWithinLimits(e.target.value))}
              min={-MAP_LIMITS.maxGridOffset}
              max={MAP_LIMITS.maxGridOffset}
              className="input-cozy w-24"
            />
          </label>
        </div>
        <p className="text-xs text-stone-gray/50 mt-1">Where the grid starts, from the picture&apos;s top-left corner.</p>
      </div>
    </>
  );
}
