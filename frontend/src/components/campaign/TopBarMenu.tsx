// ============================================
// The wide layout's top bar: its buttons, and the lists they open
// (Library ▾, As player ▾, ⋯).
//
// A list is a popover of buttons under its button, 240 px wide: it closes
// on a press outside it, on Escape (the keys go back to its button) and
// after one of its rows is pressed, unless the row keeps it open. The arrow
// keys move between its rows. Rows a map draws into it through a portal
// (stores/tableChromeStore.ts) count as its own.
// ============================================

import { useEffect, useId, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';

/** A top-bar button's look: 40 px with a mouse, 44 on a touch screen, text 14 px. */
export const BAR_BUTTON =
  'inline-flex shrink-0 items-center justify-center gap-1.5 h-10 min-w-10 pointer-coarse:h-11 pointer-coarse:min-w-11 px-3 rounded-xl ' +
  'text-sm font-medium text-ink whitespace-nowrap transition-colors hover:bg-ink/5 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50 disabled:cursor-not-allowed';
/** Pressed: a list open, or what it chose running (As player). */
export const BAR_BUTTON_ON = 'bg-brand/20! text-brand-ink font-semibold shadow-[inset_0_0_0_1px_var(--color-brand)]';

/**
 * While `open`, a press outside `root` or Escape calls `close`; Escape
 * hands the keys back to `returnTo`.
 */
export function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void, returnTo?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeRef.current();
      returnTo?.current?.focus();
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, root, returnTo]);
}

export interface MenuRowProps {
  icon?: LucideIcon;
  label: string;
  onSelect: () => void;
  /** Opens more (a submenu or a dialog): a chevron at the end. */
  more?: boolean;
  /** Pressed, as a choice that is on. */
  pressed?: boolean;
  /** The list stays open after the press (a submenu shown in its place). */
  keepOpen?: boolean;
  tour?: string;
  title?: string;
  tone?: 'plain' | 'brand';
  expanded?: boolean;
}

/** One row of a top-bar list: 40 px with a mouse, 44 on a touch screen. */
export function MenuRow({ icon: Icon, label, onSelect, more, pressed, keepOpen, tour, title, tone = 'plain', expanded }: MenuRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-tour={tour}
      data-keep-open={keepOpen || undefined}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={title}
      className={cn(
        'flex w-full items-center gap-3 min-h-10 pointer-coarse:min-h-11 px-4 text-left text-sm',
        'hover:bg-brand/10 focus-visible:bg-brand/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        tone === 'brand' || pressed ? 'text-brand-ink' : 'text-ink',
        pressed && 'font-semibold',
      )}
    >
      {Icon && <Icon className={cn('w-4 h-4 shrink-0', tone === 'brand' || pressed ? 'text-brand-ink' : 'text-ink-muted')} aria-hidden="true" />}
      <span className="flex-1 truncate">{label}</span>
      {more && <ChevronRight className="w-4 h-4 shrink-0 text-ink-muted" aria-hidden="true" />}
    </button>
  );
}

/** A line between groups of rows. */
export function MenuSeparator() {
  return <div className="my-1 h-px bg-brand/20" role="separator" />;
}

/** A small heading over a group of rows. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-2 pb-1 text-xs font-medium text-ink-muted">{children}</div>;
}

export interface TopBarMenuProps {
  /** The button's name, and the list's. */
  label: string;
  icon: LucideIcon;
  /** Words on the button beside the icon; none: an icon button. */
  text?: string;
  /** Drawn pressed while closed too (As player while a preview runs). */
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  tour?: string;
  /** The list's side: under the button's left edge, or its right edge. */
  align?: 'left' | 'right';
  className?: string;
  /** The list's own classes, such as a wider list. */
  listClassName?: string;
  /** The rows; given `close`, for a row that keeps the list open and closes it later. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Told as the list opens and closes. */
  onOpenChange?: (open: boolean) => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export default function TopBarMenu({
  label, icon: Icon, text, pressed = false, disabled, title, tour, align = 'left', className, listClassName, children, onOpenChange, buttonRef,
}: TopBarMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const setShown = (shown: boolean) => {
    setOpen(shown);
    onOpenChange?.(shown);
  };
  const close = () => setShown(false);
  const closeRef = useRef(close);
  closeRef.current = close;

  useDismiss(open, root, close, button);
  // A row pressed closes the list, rows a map portals in included: their
  // clicks reach this element in the page, though not in React's tree.
  useEffect(() => {
    if (!open) return;
    const panel = list.current;
    const onClick = (e: MouseEvent) => {
      const row = (e.target as Element).closest('button');
      if (row && !row.hasAttribute('data-keep-open')) closeRef.current();
    };
    panel?.addEventListener('click', onClick);
    panel?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => panel?.removeEventListener('click', onClick);
  }, [open]);

  const moveFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    if (rows.length === 0) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
      : e.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
    rows[next].focus();
  };

  return (
    <div ref={root} className={cn('relative shrink-0', className)}>
      <button
        ref={(el) => {
          button.current = el;
          if (typeof buttonRef === 'function') buttonRef(el);
          else if (buttonRef) buttonRef.current = el;
        }}
        type="button"
        onClick={() => setShown(!open)}
        disabled={disabled}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        title={title ?? label}
        data-tour={tour}
        className={cn(BAR_BUTTON, (open || pressed) && BAR_BUTTON_ON, !text && 'px-0')}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        {text && <span>{text}</span>}
        {text && <ChevronDown className="-ml-0.5 w-3 h-3 shrink-0 text-ink-muted" strokeWidth={3} aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={list}
          id={listId}
          role="group"
          aria-label={label}
          onKeyDown={moveFocus}
          className={cn(
            'absolute top-[calc(100%+6px)] z-80 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-4rem)] overflow-y-auto',
            'py-1 rounded-xl border border-brand/20 bg-surface/95 shadow-[0_10px_25px_var(--color-canvas)] backdrop-blur-xs',
            align === 'right' ? 'right-0' : 'left-0',
            listClassName ?? 'w-60',
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
