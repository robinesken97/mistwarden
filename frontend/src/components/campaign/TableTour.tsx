// Added for Mistwarden on 2026-11-28.
/**
 * The guided tour over the table: a ring around what the step is about and
 * a card saying what it is, with Back, Next (Done, or Skip, where the step
 * asks for something) and End tour. Escape ends it too.
 *
 * Everything but the card lets presses through, so what the step asks for
 * can be done with the tour open. The ring follows its target as the page
 * moves, finding it again if it is redrawn (a reload, a reset, a turn of the
 * tablet), and with no target the card stands in the middle. The steps and
 * how they find their targets are in tour/tourSteps.ts.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import FloatingLayer from '@/components/ui/FloatingLayer';
import { useCompactLayout } from '@/contexts/LayoutContext';
import { useGameStore } from '@/stores/gameStore';
import { controlsToken } from '@/utils/tokenOwnership';
import {
  clearTour, findShown, loadTour, pageDom, revealStep, saveTour, stepNote, TOUR_START_EVENT, TOURS, type TourKind,
} from './tour/tourSteps';

export interface TableTourProps {
  campaignId: string;
  kind: TourKind;
  practice: boolean;
  live: boolean;
  userId?: string;
  role?: string | null;
}

/** The card's gap from the screen's edges and from its target, in pixels. */
const GAP = 16;

interface Box { top: number; left: number; width: number; height: number }

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * The foot of the card's room: the top of the compact layout's bar where it
 * runs along the screen's foot (on a phone on its side it is in the header),
 * else the window's. The card stood over the bar's buttons.
 */
function roomFoot(): number {
  const bar = document.querySelector('[data-tour="bar-map"]')?.closest('nav')?.getBoundingClientRect();
  return bar && bar.top > window.innerHeight / 2 ? bar.top : window.innerHeight;
}

/**
 * Where the card goes: beside its target where the screen has the width,
 * so what the target opens below it (a panel's section, a slide-over) stays
 * clear; else under it, over it, or at the edge farther from its middle.
 * A step with nothing to point at has the card in the middle (null); one
 * whose target is not on screen, such as under a dialog the user opened,
 * has it in the bottom left corner, clear of a dialog in the middle.
 */
function cardPlace(target: Box | null, hasTargets: boolean, cardHeight: number, cardWidth: number): { top: number; left: number } | null {
  const width = window.innerWidth;
  const height = roomFoot();
  if (!target) return hasTargets ? { top: Math.max(GAP, height - cardHeight - GAP), left: GAP } : null;
  const level = Math.min(Math.max(target.top, GAP), Math.max(GAP, height - cardHeight - GAP));
  if (target.left - GAP - cardWidth >= GAP) return { top: level, left: target.left - GAP - cardWidth };
  if (target.left + target.width + GAP + cardWidth <= width - GAP) return { top: level, left: target.left + target.width + GAP };
  const left = Math.min(Math.max(target.left + target.width / 2 - cardWidth / 2, GAP), Math.max(GAP, width - cardWidth - GAP));
  const below = target.top + target.height + GAP;
  if (below + cardHeight <= height - GAP) return { top: below, left };
  const above = target.top - GAP - cardHeight;
  if (above >= GAP) return { top: above, left };
  // The window's middle, not the room's: a target as tall as the room keeps the card at its foot.
  return { top: target.top + target.height / 2 > window.innerHeight / 2 ? GAP : Math.max(GAP, height - cardHeight - GAP), left };
}

export default function TableTour({ campaignId, kind, practice, live, userId, role }: TableTourProps) {
  const steps = TOURS[kind];
  const [index, setIndex] = useState<number | null>(() => loadTour(campaignId, kind));
  const step = index !== null ? steps[index] ?? null : null;
  const compact = useCompactLayout();
  const ownsToken = useGameStore((s) => Object.values(s.tokens).some((t) => controlsToken(t, userId, role)));
  const [revealed, setRevealed] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ width: 352, height: 220 });
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // The desktop's side columns the tour unfolded (show-party, show-session),
  // folded again as it ends, so a tablet keeps the columns it had.
  const unfolded = useRef(new Set<string>());

  // Started by a Tour button, from the first step.
  useEffect(() => {
    const start = () => setIndex(0);
    window.addEventListener(TOUR_START_EVENT, start);
    return () => window.removeEventListener(TOUR_START_EVENT, start);
  }, []);

  // The place, kept on this device; forgotten as the tour ends, and not as
  // another campaign opens with no tour of its own.
  const running = index !== null;
  useEffect(() => {
    if (index !== null) saveTour(campaignId, kind, index);
  }, [campaignId, kind, index]);
  const end = () => {
    clearTour();
    setIndex(null);
  };
  // Folded to its first row, out of the way of what a step asks for; open again on the next step.
  const [folded, setFolded] = useState(false);
  useEffect(() => setFolded(false), [index]);
  useEffect(() => {
    if (running) return;
    for (const anchor of unfolded.current) {
      const fold = findShown([anchor.replace('show-', 'hide-')], pageDom);
      if (fold) pageDom.press(fold);
    }
    unfolded.current.clear();
  }, [running]);

  // As a step opens, or the layout changes under it: its openers pressed, once.
  useEffect(() => {
    if (!step) return undefined;
    let cancelled = false;
    setRevealed(false);
    const press = (el: Element) => {
      const anchor = el.getAttribute('data-tour') ?? '';
      if (anchor.startsWith('show-')) unfolded.current.add(anchor);
      pageDom.press(el);
    };
    void revealStep(step, { ...pageDom, press }, () => cancelled).then(() => {
      if (!cancelled) setRevealed(true);
    });
    return () => { cancelled = true; };
  }, [step, compact]);

  // Then the target followed, found again where it is redrawn.
  useEffect(() => {
    if (!step || !revealed) return undefined;
    const follow = () => {
      const el = findShown(step.targets, pageDom);
      const rect = el?.getBoundingClientRect();
      const next = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null;
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };
    follow();
    // shortcut: looked at every 150 ms rather than observed; enough to keep up with a sheet or a column.
    const timer = window.setInterval(follow, 150);
    window.addEventListener('resize', follow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', follow);
    };
  }, [step, revealed]);

  // The card takes the focus as each step shows, so a screen reader reads it.
  useEffect(() => {
    if (revealed) cardRef.current?.focus({ preventScroll: true });
  }, [revealed, index]);

  // The card's size, for placing it beside its target.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const next = { width: card.offsetWidth, height: card.offsetHeight };
    setCardSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    // Measured again whenever what it holds or where it goes may have changed.
  }, [step, revealed, box, ownsToken, live, practice, folded]);

  // Escape ends the tour before a sheet or a dialog under it takes the key.
  useEffect(() => {
    if (index === null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      clearTour();
      setIndex(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index]);

  if (!step || index === null || !revealed) return null;

  const note = stepNote(step, { practice, ownsToken, live });
  // A step that points at nothing, such as the first, has nothing to try.
  const asks = note?.kind === 'task' && step.targets.length > 0;
  const last = index === steps.length - 1;
  const next = () => (last ? end() : setIndex(index + 1));
  // Folded, it is its two buttons at the screen's left edge, half way down: the
  // least in the way of a bar, a header or a sheet's own buttons.
  const place = folded
    ? { top: Math.max(GAP, window.innerHeight / 2 - cardSize.height / 2), left: GAP }
    : cardPlace(box, step.targets.length > 0, cardSize.height, cardSize.width);

  // On the body, over the sheets and dialogs drawn there (FloatingLayer.tsx).
  return (
    <FloatingLayer>
    <div className="fixed inset-0 z-90 pointer-events-none" style={{ bottom: window.innerHeight - roomFoot() }}>
      {box && (
        // The ring, and the page dimmed around it; neither takes a press.
        <div
          aria-hidden="true"
          className="absolute rounded-cozy outline-3 outline-brand"
          style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8, boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.35)' }}
        />
      )}
      <div
        ref={cardRef}
        data-tour-card=""
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={`pointer-events-auto absolute ${folded ? 'w-auto' : 'w-[min(22rem,calc(100vw-2rem))]'} card-cozy max-h-[calc(100%-2rem)] overflow-y-auto space-y-2 shadow-2xl outline-hidden focus-visible:ring-2 focus-visible:ring-brand ${place ? '' : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'}`}
        style={place ?? undefined}
      >
        <div className="flex items-center gap-2">
          <p className={folded ? 'sr-only' : 'flex-1 text-xs font-semibold uppercase tracking-wide text-ink-muted'}>
            {kind === 'gm' ? 'GM tour' : 'Player tour'} · Step {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={() => setFolded(!folded)}
            aria-label={folded ? 'Show the step' : 'Fold the step away'}
            aria-expanded={!folded}
            aria-controls={bodyId}
            title={folded ? 'Show the step' : 'Fold the step away'}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-cozy text-ink-muted hover:bg-ink/10 hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand"
          >
            {folded ? <ChevronUp className="h-5 w-5" aria-hidden="true" /> : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={end}
            aria-label="End tour"
            title="End tour"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-cozy text-ink-muted hover:bg-ink/10 hover:text-ink focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <h2 id={titleId} className={folded ? 'sr-only' : 'font-heading text-lg font-bold text-brand-ink'}>{step.title}</h2>
        <div id={bodyId} hidden={folded} className="space-y-2 text-sm text-ink">
          <p>{step.body}</p>
          {note && (
            <p className={note.kind === 'task' ? 'alert-info' : 'alert-warning'}>
              {asks && <span className="font-semibold">Try it: </span>}
              {note.text}
            </p>
          )}
        </div>
        <div hidden={folded} className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {index > 0 && <Button variant="ghost" className="min-h-11" onClick={() => setIndex(index - 1)}>Back</Button>}
          {(asks || note?.kind === 'hint') && !last && <Button variant="secondary" className="min-h-11" onClick={next}>Skip</Button>}
          <Button className="min-h-11" onClick={next}>{last ? 'Finish' : asks ? 'Done' : 'Next'}</Button>
        </div>
      </div>
    </div>
    </FloatingLayer>
  );
}
