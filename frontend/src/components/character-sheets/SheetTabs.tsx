/**
 * The tab bar of a tabbed character sheet, its editor's too.
 *
 * It wraps: where six tabs do not fit on one row, as on a phone or an iPad
 * held upright, the rest go onto a second row, or a third, and every tab
 * stays where a finger reaches it. On a desktop they fit one row. The open
 * tab is underlined in the header colour and labelled in the theme's text
 * colour.
 *
 * It is a row of tabs for a screen reader (`tablist`, `tab`, `aria-selected`)
 * and the keyboard: the open tab is the one stop for Tab, the arrows open the
 * tab before or after, round the ends, and Home and End the first and the
 * last (`tabKeyTarget`). The sheet's body is their panel: the sheet spreads
 * `sheetTabPanel(id, active)` on it, with the `id` it gave the bar.
 */
import { useRef, type ElementType } from 'react';
import { tabKeyTarget } from '@/utils/tabKeys';

export interface SheetTab<Id extends string> {
  id: Id;
  label: string;
  icon: ElementType;
}

interface SheetTabsProps<Id extends string> {
  /** Unique on the page (`useId`): names the tabs and the panel. */
  id: string;
  tabs: readonly SheetTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  /** The header colour, a CSS colour, drawn as the open tab's underline. */
  underline?: string;
  /**
   * `boxed`: the 5E sheet's bar, a box of equal tabs in the sheet's accent
   * (the `--sheet-*` variables, fifth-edition/sheetStyle.ts), the open tab
   * filled. How many share a row follows the bar's own width, not the
   * screen's: one row where six fit, else three to a row, else two.
   */
  variant?: 'underline' | 'boxed';
  /**
   * Boxed only: a label as long as "Stats & Skills" (about 90 px), which
   * needs wider tabs than "Biography" before the bar goes to fewer rows.
   */
  longLabels?: boolean;
}

/**
 * The boxed bar's columns, against its wrapper's width. A tab needs its label
 * plus about 30 px (icon, gap, padding), and the bar 50 px of gaps and frame
 * around six: tabs up to "Biography" need about 40 rem in one row and 20.5 rem
 * three to a row, "Stats & Skills" 47.5 rem and 24.5 rem; each step sits a
 * little above. Whole class strings, for Tailwind to find.
 */
const BOXED_COLUMNS = {
  short: 'grid-cols-2 @min-[21rem]:grid-cols-3 @min-[42rem]:grid-flow-col @min-[42rem]:auto-cols-fr @min-[42rem]:grid-cols-none',
  long: 'grid-cols-2 @min-[25rem]:grid-cols-3 @min-[50rem]:grid-flow-col @min-[50rem]:auto-cols-fr @min-[50rem]:grid-cols-none',
};

const tabId = (id: string, tab: string) => `${id}-tab-${tab}`;
const panelId = (id: string) => `${id}-panel`;

/** What the sheet's body carries as the panel of the bar named `id`, showing `active`. */
export function sheetTabPanel(id: string, active: string) {
  return { role: 'tabpanel', id: panelId(id), 'aria-labelledby': tabId(id, active) } as const;
}

export function SheetTabs<Id extends string>({ id, tabs, active, onSelect, underline, variant = 'underline', longLabels = false }: SheetTabsProps<Id>) {
  const boxed = variant === 'boxed';
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = tabKeyTarget(event.key, index, tabs.length);
    if (target === null) return;
    event.preventDefault();
    onSelect(tabs[target].id);
    tabRefs.current[target]?.focus();
  };

  const bar = (
    <div
      data-sheet-tabs
      role="tablist"
      aria-label="Sheet sections"
      className={boxed
        ? `grid gap-1.5 rounded-[15px] border-4 border-(--sheet-accent) bg-(--sheet-accent-bg) p-1.5 ${BOXED_COLUMNS[longLabels ? 'long' : 'short']}`
        : 'flex flex-wrap gap-1 border-b-2 border-ink/10 bg-ink/5 px-4'}
    >
      {tabs.map(({ id: tab, label, icon: Icon }, index) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            ref={(button) => { tabRefs.current[index] = button; }}
            type="button"
            role="tab"
            id={tabId(id, tab)}
            aria-selected={isActive}
            aria-controls={panelId(id)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={boxed
              ? `flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sheet-accent) ${
                isActive ? 'bg-(--sheet-fill) text-(--sheet-on-fill)' : 'text-ink hover:bg-ink/10'
              }`
              : `flex items-center gap-2 px-4 py-3 font-medium transition-colors ${
                isActive ? 'text-ink border-b-2 -mb-0.5 bg-paper' : 'text-ink-secondary hover:text-ink hover:bg-ink/10'
              }`}
            style={isActive && !boxed ? { borderBottomColor: underline } : undefined}
          >
            <Icon className={`w-4 h-4 shrink-0 ${boxed && !isActive ? 'text-(--sheet-accent)' : ''}`} aria-hidden="true" />
            <span className={boxed ? 'whitespace-nowrap' : undefined}>{label}</span>
          </button>
        );
      })}
    </div>
  );
  // The wrapper is the container the boxed bar's columns query.
  return boxed ? <div className="@container">{bar}</div> : bar;
}
