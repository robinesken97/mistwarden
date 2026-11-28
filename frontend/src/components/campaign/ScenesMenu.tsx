// ============================================
// ScenesMenu: a button that opens a menu of the Scenes panel (a card's ⋯,
// Create scene)
//
// The rows are MenuItems (components/ui/menu.ts), drawn as a popover under
// the button with a mouse, 240 px wide, flipped up where the screen has no
// room below, a submenu's choices in a second list beside it; and as an
// action sheet (compact/ActionSheet.tsx) on a touch screen or a compact
// layout, a submenu's choices replacing the rows with a row back. A command
// that is `busy` is drawn disabled with its busy label, which says why.
// ============================================

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import FloatingLayer from '@/components/ui/FloatingLayer';
import type { MenuItem, MenuSubmenu } from '@/components/ui/menu';
import ActionSheet from '@/components/campaign/compact/ActionSheet';
import { useCompactLayout } from '@/contexts/LayoutContext';
import { useCoarsePointer } from '@/hooks/useMediaQuery';
import { cn } from '@/utils/cn';

const MENU_W = 240;

const ROW =
  'flex w-full items-center gap-3 min-h-10 px-4 text-left text-sm text-ink hover:bg-brand/10 ' +
  'focus-visible:bg-brand/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ' +
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent';
const LIST = 'fixed z-60 py-1 rounded-xl border border-brand/20 bg-surface shadow-[0_10px_25px_var(--color-canvas)]';

interface ScenesMenuProps {
  /** Names the menu, and the action sheet's title. */
  label: string;
  items: MenuItem[];
  /** The button's classes and content; it gets aria-haspopup and aria-expanded. */
  buttonClassName: string;
  children: ReactNode;
  title?: string;
  /** The popover's side under the button. */
  align?: 'left' | 'right';
  /** A small caption over the popover's rows, such as "Start from". */
  caption?: string;
  /** The caption over a submenu's list beside the rows; its command's label by default. */
  subCaption?: string;
  /** The action sheet's title; `label` by default. */
  sheetTitle?: string;
}

/** Moves the focus among a list's enabled rows with the arrows, Home and End. */
function moveFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
  if (rows.length === 0) return;
  e.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1
    : e.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
  rows[next].focus();
}

export default function ScenesMenu({ label, items, buttonClassName, children, title, align = 'right', caption, subCaption, sheetTitle }: ScenesMenuProps) {
  const compact = useCompactLayout();
  const coarse = useCoarsePointer();
  const sheet = compact || coarse;
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<{ item: MenuSubmenu; top: number } | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const subList = useRef<HTMLDivElement>(null);

  const close = (focusButton = false) => {
    setOpen(false);
    setSub(null);
    setAt(null);
    if (focusButton) button.current?.focus();
  };

  // Placed once it is measured: under the button, or over it where the screen has no room below.
  useLayoutEffect(() => {
    if (!open || sheet || !button.current || !list.current) return;
    const b = button.current.getBoundingClientRect();
    const height = list.current.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - MENU_W - 8, align === 'right' ? b.right - MENU_W : b.left));
    const below = b.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, b.top - 6 - height) : below;
    setAt({ left, top });
  }, [open, sheet, align]);

  useEffect(() => {
    if (!open || sheet) return;
    list.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node;
      if (![button.current, list.current, subList.current].some((el) => el?.contains(target))) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, sheet]);

  useEffect(() => {
    if (sub) subList.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [sub]);

  const run = (fn: () => void) => { close(); fn(); };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title ? label : undefined}
        title={title}
        onClick={() => (open ? close() : setOpen(true))}
        className={buttonClassName}
      >
        {children}
      </button>
      {sheet ? (
        open && <ActionSheet open title={sheetTitle ?? label} items={items} onClose={() => close()} />
      ) : open && (
        <FloatingLayer>
          <div
            ref={list}
            role="menu"
            aria-label={label}
            onKeyDown={moveFocus}
            style={{ width: MENU_W, left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? 'visible' : 'hidden' }}
            className={LIST}
          >
            {caption && <div className="px-4 pt-2 pb-1 text-xs font-medium text-ink-muted">{caption}</div>}
            {items.map((item) => {
              if (item.kind === 'separator') return <div key={item.id} role="separator" className="my-1 h-px bg-brand/20" />;
              if (item.kind !== 'command') return <div key={item.id} className="px-4 pt-2 pb-1 text-xs font-medium text-ink-muted">{item.label}</div>;
              const Icon = item.icon;
              const busy = !item.children && item.busy?.active;
              const opened = sub?.item.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  title={item.title}
                  disabled={busy || undefined}
                  aria-haspopup={item.children ? 'menu' : undefined}
                  aria-expanded={item.children ? opened : undefined}
                  onClick={(e) => {
                    if (item.children) {
                      const top = e.currentTarget.getBoundingClientRect().top - 36;
                      setSub(opened ? null : { item, top });
                    } else run(item.run);
                  }}
                  onKeyDown={(e) => {
                    if (item.children && e.key === 'ArrowRight') { e.preventDefault(); e.currentTarget.click(); }
                  }}
                  className={cn(ROW, item.tone === 'danger' && 'text-danger-ink', opened && 'bg-brand/10 text-brand-ink')}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0 text-ink-muted" aria-hidden="true" />}
                  <span className="flex-1 truncate">{busy ? item.busy?.label : item.label}</span>
                  {item.children && <ChevronRight className="w-4 h-4 shrink-0 text-ink-muted" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {sub && at && (
            <div
              ref={subList}
              role="menu"
              aria-label={sub.item.label}
              onKeyDown={(e) => {
                moveFocus(e);
                if (e.key === 'ArrowLeft') { e.preventDefault(); setSub(null); list.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus(); }
              }}
              style={{
                width: MENU_W,
                left: at.left + MENU_W + 4 + MENU_W > window.innerWidth ? Math.max(8, at.left - MENU_W - 4) : at.left + MENU_W + 4,
                top: Math.max(8, sub.top),
              }}
              className={LIST}
            >
              <div className="px-4 pt-2 pb-1 text-xs font-medium text-ink-muted">{subCaption ?? sub.item.label}</div>
              {sub.item.children.map((choice) => (
                <button key={choice.id} type="button" role="menuitem" onClick={() => run(choice.run)} className={ROW}>
                  <span className="flex-1 truncate">{choice.label}</span>
                </button>
              ))}
            </div>
          )}
        </FloatingLayer>
      )}
    </>
  );
}
