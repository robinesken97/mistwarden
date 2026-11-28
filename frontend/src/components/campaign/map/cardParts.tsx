// ============================================
// The parts of the cards the map's rail opens (Grid, GM tools, Draw, Spirit
// Layer, Measure, Spell area), written once so the cards keep one grid:
// 336 px wide, padding 16, gap 8, every control the inner width in equal
// columns, a 12 px caption above each control, binaries as two segments.
//
// A card stands beside the rail, bottom- or top-aligned with its cell and
// moved to stay inside the map (BesideRail); on a phone the same body is a
// strip across the map's foot (RailCard with `strip`).
// ============================================

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Pipette, User, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';
import { scrollFade, useScrollMore } from '@/components/ui/ScrollCue';

/** A caption above its control: 12 px sentence case, muted; a value may sit at its right. */
export function Caption({ children, value, slider = false, id }: { children: ReactNode; value?: ReactNode; slider?: boolean; id?: string }) {
  return (
    <div id={id} className={cn('flex items-baseline justify-between gap-2 text-xs leading-4 font-medium text-ink-muted', slider ? '-mb-2' : '-mb-1')}>
      <span>{children}</span>
      {value !== undefined && <b className="font-semibold text-ink-secondary tabular-nums">{value}</b>}
    </div>
  );
}

/** Whom a group of settings reaches: "Only on your screen", "For everyone on this scene". */
export function GroupHeading({ children }: { children: ReactNode }) {
  return <div className="-mb-1 text-[0.8125rem] leading-4 font-semibold text-brand-ink">{children}</div>;
}

/** Help under the control it explains: 13 px, muted, left. */
export function Help({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 text-[0.8125rem] leading-[1.125rem] text-ink-muted', className)}>{children}</p>;
}

/** A line between groups. */
export function Sep({ wide = false }: { wide?: boolean }) {
  return <div aria-hidden="true" className={cn('h-px shrink-0 bg-ink/10', wide && '-mx-4')} />;
}

export interface SegOption<T> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** A longer name, as the tooltip (Draw's "Laser pointer"). */
  title?: string;
}

interface SegProps<T> {
  /** The caption, and the group's name. */
  label: string;
  /** Hidden captions name the group alone (a spirit token's row is captioned by its name). */
  caption?: ReactNode;
  options: SegOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  /** Columns; options.length by default. */
  columns?: number;
  /** Icon over a 12 px label (Draw's tools). */
  tools?: boolean;
  /** A press on the chosen segment clears the choice (Fog's Reveal | Hide). */
  deselect?: boolean;
  disabled?: boolean;
  /** Tour anchor on the group. */
  tour?: string;
}

/**
 * Segments in equal columns, one chosen: a radio group, the arrow keys
 * moving the choice as a radio group's do.
 */
export function Seg<T extends string | number | boolean>({ label, caption, options, value, onChange, columns, tools = false, deselect = false, disabled = false, tour }: SegProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const chosen = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || disabled) return;
    e.preventDefault();
    const next = (Math.max(chosen, 0) + step + options.length) % options.length;
    onChange(options[next].value);
    (group.current?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <>
      {caption !== null && <Caption>{caption ?? label}</Caption>}
      <div
        ref={group}
        role="radiogroup"
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-tour={tour}
        onKeyDown={onKeyDown}
        className="grid shrink-0 gap-1 rounded-xl bg-ink/5 p-1"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o, i) => {
          const on = i === chosen;
          const Icon = o.icon;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.title}
              aria-label={o.title}
              disabled={disabled}
              tabIndex={on || (chosen < 0 && i === 0) ? 0 : -1}
              onClick={() => onChange(on && deselect ? null : o.value)}
              className={cn(
                'flex min-w-0 items-center justify-center rounded-lg px-2 whitespace-nowrap transition-colors select-none',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-not-allowed',
                tools ? 'h-12 pointer-coarse:h-13 flex-col gap-0.5 text-xs leading-4' : 'h-8 pointer-coarse:h-11 gap-1.5 text-sm',
                on ? 'bg-surface-light font-semibold text-brand-ink shadow-[0_1px_2px_var(--color-canvas)]' : 'font-medium text-ink-muted hover:text-ink',
              )}
            >
              {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
              <span className="truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Off | On, or two named states, as two segments. */
export function Binary({ label, caption, value, onChange, off = 'Off', on = 'On', disabled, tour }: {
  label: string; caption?: ReactNode; value: boolean; onChange: (on: boolean) => void; off?: string; on?: string; disabled?: boolean; tour?: string;
}) {
  return (
    <Seg<boolean>
      label={label}
      caption={caption}
      options={[{ value: false, label: off }, { value: true, label: on }]}
      value={value}
      onChange={(v) => { if (v !== null) onChange(v); }}
      disabled={disabled}
      tour={tour}
    />
  );
}

/** A slider with its caption and value above; the 44 px hit area starts under the caption. */
export function Slider({ label, valueText, min, max, step, value, onChange, onCommit }: {
  label: string; valueText: string; min: number; max: number; step: number; value: number;
  onChange: (value: number) => void;
  /** Told when a drag or a key ends, for a save that should not follow every step. */
  onCommit?: () => void;
}) {
  return (
    <>
      <Caption slider value={valueText}>{label}</Caption>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="card-slider h-10 pointer-coarse:h-11 w-full shrink-0 cursor-pointer"
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </>
  );
}

/** A full-width (or grid-cell) button: an action on the whole scene, or Undo / Redo. */
export function CardButton({ children, onClick, disabled, danger, icon: Icon, title, label, pressed, onBlur }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean; icon?: LucideIcon; title?: string; label?: string; pressed?: boolean; onBlur?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={onBlur}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-10 pointer-coarse:h-11 min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-not-allowed',
        pressed ? 'border-brand bg-brand/15 text-brand-ink' : 'border-ink/15 bg-ink/5 hover:bg-ink/10',
        danger ? 'text-danger-ink' : !pressed && 'text-ink',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Buttons side by side in equal columns. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <div className="grid shrink-0 auto-cols-fr grid-flow-col gap-2">{children}</div>;
}

/** The app's select, full width under its caption. */
export function CardSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <>
      <Caption>{label}</Caption>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="input-cozy w-full shrink-0 text-sm">
        {children}
      </select>
    </>
  );
}

export interface Swatch {
  name: string;
  value: string;
  /** The user's player colour: drawn with a person glyph. */
  me?: boolean;
}

const HEX = /^#?([0-9a-f]{6})$/i;
/** A typed colour as #rrggbb, or null while it is not one yet. */
export const parseHex = (typed: string): string | null => {
  const m = HEX.exec(typed.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
};

/**
 * One colour grid (Walls, Lights, Draw): 6 columns of 44 px cells, the
 * swatches, then the pipette (the system's colour picker) and the hex field
 * over the rest of the last row, at least two cells. With `hex` off, the
 * pipette alone ends the row (the grid popover's line colour).
 */
export function ColourGrid({ label, swatches, value, onChange, valueName, hex = true, custom = true, columns = 6 }: {
  label: string; swatches: Swatch[]; value: string; onChange: (colour: string) => void;
  /** The chosen colour's name at the caption's right. */
  valueName?: string;
  hex?: boolean;
  /** The pipette, for any colour; off where only the swatches may be had (the ruler). */
  custom?: boolean;
  columns?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const lower = value.toLowerCase();
  const named = swatches.some((s) => s.value.toLowerCase() === lower);
  const used = (swatches.length % columns) + 1;
  const span = Math.max(2, columns - used);
  return (
    <>
      <Caption value={valueName}>{label}</Caption>
      <div role="radiogroup" aria-label={label} className="grid shrink-0 justify-items-center gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {swatches.map((s) => {
          const on = s.value.toLowerCase() === lower;
          return (
            <button
              key={s.value + s.name}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={s.name}
              title={s.name}
              onClick={() => { setDraft(null); onChange(s.value.toLowerCase()); }}
              className="flex size-10 pointer-coarse:size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-brand"
            >
              <i
                className={cn('flex size-6 items-center justify-center rounded-full border border-ink/30 not-italic', on && 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-brand)]')}
                style={{ background: s.value }}
              >
                {s.me && <User className="size-3.5 text-canvas" strokeWidth={2.5} aria-hidden="true" />}
              </i>
            </button>
          );
        })}
        {custom && <label
          title="Pick a custom colour"
          className={cn(
            'relative flex size-10 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-xl border text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
            !named ? 'border-brand bg-brand/15 text-brand-ink' : 'border-ink/15 bg-ink/5 hover:bg-ink/10',
          )}
        >
          <Pipette className="size-4" aria-hidden="true" />
          <input
            type="color"
            aria-label="Pick a custom colour"
            value={/^#[0-9a-f]{6}$/.test(lower) ? lower : '#000000'}
            onChange={(e) => { setDraft(null); onChange(e.target.value.toLowerCase()); }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>}
        {custom && hex && (
          <input
            type="text"
            aria-label="Custom colour hex code"
            value={draft ?? lower}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setDraft(e.target.value);
              const colour = parseHex(e.target.value);
              if (colour) onChange(colour);
            }}
            onBlur={() => setDraft(null)}
            className="input-cozy h-10 pointer-coarse:h-11 w-full min-w-0 justify-self-stretch font-mono text-sm pointer-coarse:text-base"
            style={{ gridColumn: `span ${span}` }}
          />
        )}
      </div>
    </>
  );
}

/**
 * Where a card or popover beside the rail goes: left of the rail (8 px),
 * aligned with its cell's bottom (`bottom`) or top, moved to stay inside the
 * map shown (the nearest [data-rail-area]), 8 px in from its edges. Placed
 * inside the cell's own box (RailCell), so a press on the cell stays inside.
 */
function useBesideRail(align: 'top' | 'bottom') {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ style: CSSProperties; before: number; after: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const cell = el?.parentElement;
    const rail = el?.closest('nav');
    const area = el?.closest<HTMLElement>('[data-rail-area]');
    if (!el || !cell || !rail || !area) return;
    const place = () => {
      const c = cell.getBoundingClientRect();
      const r = rail.getBoundingClientRect();
      const a = area.getBoundingClientRect();
      const height = Math.max(0, a.height - 16);
      const top = a.top + 8 - c.top;
      setBox({
        style: { top, right: c.right - r.left + 8, height },
        // The room before and after the card along the column, which gives way first when the card is taller.
        before: align === 'top' ? Math.max(0, c.top - a.top - 8) : 0,
        after: align === 'bottom' ? Math.max(0, a.bottom - 8 - c.bottom) : 0,
      });
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(area);
    watch.observe(rail);
    return () => watch.disconnect();
  }, [align]);
  return { ref, box };
}

/** A column beside the rail that holds a card or popover where useBesideRail says. */
export function BesideRail({ align = 'bottom', children }: { align?: 'top' | 'bottom'; children: ReactNode }) {
  const { ref, box } = useBesideRail(align);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-40 flex flex-col"
      // Unplaced for the one frame before it is measured.
      style={box ? box.style : { visibility: 'hidden', top: 0, right: 0 }}
    >
      <div className="min-h-0" style={{ flex: align === 'top' ? `0 1 ${box?.before ?? 0}px` : '1 1 0' }} />
      <div className="pointer-events-auto flex max-h-full min-h-0 shrink-0 flex-col">{children}</div>
      <div className="min-h-0" style={{ flex: align === 'bottom' ? `0 1 ${box?.after ?? 0}px` : '1 1 0' }} />
    </div>
  );
}

export interface RailCardProps {
  title: string;
  /** The region's name, where it is not the title ("Drawing tools"). */
  label?: string;
  /** Before the title (Spirit Layer's ghost). */
  icon?: LucideIcon;
  onClose: () => void;
  /** The close button's name. */
  closeLabel?: string;
  /** Under the header, fixed with it (GM tools' tabs). */
  tabs?: ReactNode;
  children: ReactNode;
  /** A phone's strip across the map's foot, rather than a card beside the rail. */
  strip?: boolean;
}

/**
 * A tool's card: the header (and tabs) fixed, the rest scrolling under them
 * with a fade where there is more. As a strip on a phone it is at most half
 * the map's height (the dock is its size container).
 */
export function RailCard({ title, label = title, icon: Icon, onClose, closeLabel = 'Close', tabs, children, strip = false }: RailCardProps) {
  const { ref: bodyCue, more } = useScrollMore<HTMLDivElement>();
  return (
    <section
      aria-label={label}
      className={cn(
        'pointer-events-auto flex min-h-0 flex-col text-ink',
        strip
          ? 'max-h-[50cqh] short:max-h-[45cqh] w-full border-t border-brand/20 bg-surface-light shadow-[0_-10px_30px_var(--color-canvas)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]'
          : 'max-h-full w-[21rem] max-w-[calc(100vw-2rem)] rounded-xl border border-brand/20 bg-surface/95 px-4 shadow-[0_10px_25px_var(--color-canvas)] backdrop-blur-xs',
      )}
    >
      <div className={cn('flex shrink-0 flex-col', strip ? 'pt-1' : 'pt-1')}>
        <div className="-mr-3 flex items-center gap-2">
          {Icon && <Icon className="size-5 shrink-0 text-spirit-ink" aria-hidden="true" />}
          <h3 className="m-0 min-w-0 flex-1 truncate font-heading text-lg leading-6 font-bold text-brand-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="inline-flex size-10 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {tabs}
      </div>
      <div ref={bodyCue} data-card-body="" className={cn('-mx-4 flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-4 pt-2 pb-4', scrollFade(more))}>
        {children}
      </div>
    </section>
  );
}

/** A card's tabs (GM tools' Fog · Walls · Lights): underlined, so they do not read as a mode switch. */
export function CardTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: { value: T; label: string; tour?: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 grid auto-cols-fr grid-flow-col border-b border-ink/10 px-4">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          data-tour={t.tour}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex h-10 pointer-coarse:h-11 items-center justify-center px-1 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
            t.value === value ? 'font-semibold text-brand-ink shadow-[inset_0_-3px_0_var(--color-brand)]' : 'font-medium text-ink-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
