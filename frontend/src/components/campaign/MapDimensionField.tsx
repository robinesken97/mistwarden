// ============================================
// MapDimensionField
// Number input paired with a range slider for easier adjustment,
// in Create Map and Edit Map. The label names the number box; the
// slider is named "<label> slider".
// ============================================

import { useId } from 'react';

export default function MapDimensionField({
  label,
  value,
  onChange,
  min,
  max,
  decimals = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  /** Takes hundredths of a unit typed in the box, as a grid size between whole pixels. */
  decimals?: boolean;
}) {
  const boxId = useId();
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const read = (raw: string) => (decimals ? Math.round(parseFloat(raw) * 100) / 100 : parseInt(raw));
  return (
    <div>
      <label htmlFor={boxId} className="block text-xs text-stone-gray mb-1">{label}</label>
      <input
        id={boxId}
        type="number"
        value={value}
        onChange={(e) => onChange(clamp(read(e.target.value) || min))}
        min={min}
        max={max}
        step={decimals ? 'any' : undefined}
        className="input-cozy"
      />
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full mt-1.5 accent-moss-green cursor-pointer"
        aria-label={`${label} slider`}
      />
    </div>
  );
}
