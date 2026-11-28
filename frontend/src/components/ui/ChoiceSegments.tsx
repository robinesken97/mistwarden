// ============================================
// ChoiceSegments: a caption over two or more choices side by side, one on
//
// The house's segmented control: equal columns in a tinted track, the chosen
// one raised; 32 px segments in a 40 px track with a mouse, 44 px segments on
// a touch screen. A radiogroup: the arrows move the choice, Tab reaches only
// the chosen segment.
// ============================================

import { useId, useRef } from 'react';
import { cn } from '@/utils/cn';

export interface ChoiceSegmentsProps<T extends string> {
  /** The caption above, which names the group. */
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Described by, such as a help line under the control. */
  describedBy?: string;
  className?: string;
}

export default function ChoiceSegments<T extends string>({ label, value, options, onChange, disabled, describedBy, className }: ChoiceSegmentsProps<T>) {
  const labelId = useId();
  const group = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = options.findIndex(([v]) => v === value);
    const next = (at + step + options.length) % options.length;
    onChange(options[next][0]);
    group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className={className}>
      <div id={labelId} className="mb-1 text-xs font-medium text-ink-muted">{label}</div>
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        onKeyDown={onKeyDown}
        className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-ink/5 p-1"
      >
        {options.map(([v, text]) => {
          const on = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={cn(
                'flex h-8 pointer-coarse:h-11 min-w-0 items-center justify-center rounded-lg px-3 text-sm whitespace-nowrap transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60',
                on ? 'bg-surface-light font-semibold text-brand-ink shadow-[0_1px_2px_rgb(0_0_0/0.25)]' : 'font-medium text-ink-muted hover:text-ink',
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
