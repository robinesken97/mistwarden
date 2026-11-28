// ============================================
// The wide layout's map rail (MapCanvas): its cells, the popovers beside
// them, and the one-time hint for touch screens.
//
// A cell's name shows beside it: with a mouse on hover or keyboard focus,
// on a touch screen while a finger presses and holds it, which then does
// nothing else. The first visit on a touch screen shows "Press and hold for
// names" beside the rail until it is closed or a name has been held up.
// ============================================

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { optionalStorage } from '@/utils/optionalStorage';
import { cn } from '@/utils/cn';
import { useDismiss } from '../TopBarMenu';

/** How long a finger holds a cell before its name shows. */
const HOLD_MS = 500;
/** How long a held name stays after the finger lifts. */
const NAME_STAYS_MS = 1500;
export const RAIL_HINT_KEY = 'mistwarden.railHintSeen';

export interface RailCellProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** A toggle's state: aria-pressed, and drawn pressed. */
  pressed?: boolean;
  /** A cell that opens a popover or card: aria-expanded, and drawn pressed while open. */
  expanded?: boolean;
  disabled?: boolean;
  /** Drawn pressed without being a toggle, as Grid while the grid shows. */
  lit?: boolean;
  tour?: string;
  spirit?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  /** Told when a finger has held the cell up to its name. */
  onNameHeld?: () => void;
  /** What opens beside the cell (RailPopover). */
  children?: ReactNode;
}

export function RailCell({ label, icon: Icon, onClick, pressed, expanded, disabled, lit, tour, spirit, buttonRef, onNameHeld, children }: RailCellProps) {
  const [named, setNamed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const showLater = (ms: number, then?: () => void) => {
    clear();
    timer.current = setTimeout(() => { setNamed(true); then?.(); }, ms);
  };
  const hideLater = (ms: number) => {
    clear();
    timer.current = setTimeout(() => setNamed(false), ms);
  };
  const on = pressed === true || expanded === true || lit === true;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        data-tour={tour}
        disabled={disabled}
        onClick={() => {
          // A press held up to the name does nothing else.
          if (held.current) { held.current = false; return; }
          setNamed(false);
          onClick();
        }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') showLater(400); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') { clear(); setNamed(false); } }}
        onPointerDown={(e) => {
          held.current = false;
          if (e.pointerType === 'mouse') return;
          showLater(HOLD_MS, () => { held.current = true; onNameHeld?.(); });
        }}
        onPointerUp={(e) => { if (e.pointerType !== 'mouse') { if (held.current) hideLater(NAME_STAYS_MS); else { clear(); } } }}
        onPointerCancel={() => { clear(); setNamed(false); }}
        onContextMenu={(e) => e.preventDefault()}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setNamed(true); }}
        onBlur={() => { clear(); setNamed(false); }}
        className={cn(
          'flex size-10 pointer-coarse:size-11 items-center justify-center rounded-[10px] transition-colors select-none [-webkit-touch-callout:none]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 disabled:cursor-not-allowed',
          on ? 'bg-brand/20 text-brand-ink shadow-[inset_0_0_0_1px_var(--color-brand)]' : 'hover:bg-ink/5',
          spirit ? 'text-spirit-ink' : !on && 'text-ink',
        )}
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </button>
      {named && !expanded && (
        <span
          role="tooltip"
          className="pointer-events-none absolute right-[calc(100%+8px)] top-1/2 -translate-y-1/2 z-70 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium bg-ink text-canvas shadow-lg"
        >
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/** The zoom level, one cell of the rail. */
export function RailReadout({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-10 pointer-coarse:size-11 items-center justify-center text-[0.8125rem] leading-4 text-ink-secondary tabular-nums">
      {children}
    </span>
  );
}

/** A card left of its cell, top-aligned with it; Escape or a press outside closes it. */
export function RailPopover({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // The cell that opened it takes the keys back on Escape.
    returnTo.current = root.current?.parentElement?.querySelector('button') ?? null;
  }, []);
  // A press on the cell itself toggles it shut there, not here.
  const cellRoot = useRef<HTMLElement | null>(null);
  useEffect(() => { cellRoot.current = root.current?.parentElement ?? null; }, []);
  useDismiss(true, cellRoot, onClose, returnTo);
  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      className={cn(
        'absolute right-[calc(100%+8px)] top-0 z-40 w-60 py-1 rounded-xl border border-brand/20 bg-surface/95 shadow-[0_10px_25px_var(--color-canvas)] backdrop-blur-xs',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The one-time hint on a touch screen, left of the rail's top. */
export function useRailHint(coarse: boolean) {
  const [seen, setSeen] = useState(() => optionalStorage.getItem(RAIL_HINT_KEY) === '1');
  const dismiss = () => {
    setSeen(true);
    optionalStorage.setItem(RAIL_HINT_KEY, '1');
  };
  return { shown: coarse && !seen, dismiss };
}

export function RailHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute right-[calc(100%+8px)] top-0 z-30 flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-brand bg-surface/95 pl-4 text-sm font-medium text-brand-ink shadow-lg">
      Press and hold for names
      <button type="button" onClick={onDismiss} aria-label="Close hint" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:text-ink">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The rail: the view's cells, the tools' and the GM's layers, in one column
 * with a line between groups, or in two (`twoColumns`): the tools inside,
 * the view and the GM's layers outside.
 */
export function MapRail({ view, tools, gm, twoColumns, hint }: { view: ReactNode[]; tools: ReactNode[]; gm: ReactNode[]; twoColumns: boolean; hint?: ReactNode }) {
  const groups = [view, tools, gm].map((g) => g.filter(Boolean));
  const line = (key: string) => <div key={key} className="mx-1.5 h-px shrink-0 bg-brand/20" aria-hidden="true" />;
  const column = (parts: ReactNode[][], key: string) => (
    <div key={key} className="flex flex-col gap-1">
      {parts.filter((p) => p.length > 0).flatMap((p, i) => (i > 0 ? [line(`${key}-${i}`), ...p] : p))}
    </div>
  );
  const [v, t, g] = groups;
  return (
    <nav
      aria-label="Map tools"
      data-rail-columns={twoColumns ? 2 : 1}
      // In rem as the cells are (gap and padding 4 px, railLayout.ts), so a 4K screen's larger text scales it whole.
      className="absolute right-2 top-2 z-30 flex gap-1 p-1 rounded-xl border border-ink/15 bg-surface/90 shadow-lg backdrop-blur-xs"
    >
      {hint}
      {twoColumns ? [column([t], 'inner'), column([v, g], 'outer')] : column([v, t, g], 'one')}
    </nav>
  );
}
