// Added for Mistwarden on 2026-11-28.
/**
 * The guided tours' logic: how a step finds its target, opens what holds it
 * and falls back to a card in the middle; what a step asks for in and out
 * of the practice campaign; and where the tour's place is kept.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTour, GM_TOUR, loadTour, NO_TOKEN_HINT, NOT_LIVE_HINT, PLAYER_TOUR, revealStep, saveTour, stepNote,
  TOUR_KEY, TOURS, type TourDom, type TourStep,
} from '../tourSteps';

/**
 * A page of anchors: each shown or not, open or not. Pressing one runs what
 * it does to the page, as a click would; the tours' toggles close what they
 * opened when pressed again.
 */
function fakePage(anchors: Record<string, { shown?: boolean; open?: boolean; onPress?: () => void }>) {
  const elements = new Map(Object.keys(anchors).map((name) => [name, { name } as unknown as Element]));
  const pressed: string[] = [];
  const nameOf = (el: Element) => (el as unknown as { name: string }).name;
  const dom: TourDom = {
    find: (anchor) => (anchors[anchor] ? [elements.get(anchor)!] : []),
    shown: (el) => anchors[nameOf(el)].shown === true,
    open: (el) => anchors[nameOf(el)].open === true,
    press: (el) => { pressed.push(nameOf(el)); anchors[nameOf(el)].onPress?.(); },
    scrollIn: () => {},
    wait: async () => {},
  };
  return { dom, pressed, element: (name: string) => elements.get(name) };
}

const step = (targets: string[], openers?: string[]): TourStep => ({ id: 'x', title: 'X', body: 'X', targets, openers });

describe('finding a step’s target', () => {
  it('points at the first target on screen and presses nothing', async () => {
    const page = fakePage({ grid: { shown: false }, 'map-controls': { shown: true }, 'bar-map': { shown: true } });
    await expect(revealStep(step(['grid', 'map-controls'], ['bar-map']), page.dom)).resolves.toBe(page.element('map-controls'));
    expect(page.pressed).toEqual([]);
  });

  it('opens a closed tab first, on the desktop', async () => {
    const anchors: Parameters<typeof fakePage>[0] = {
      'panel-session': { shown: false },
      'show-session': { shown: false },
      'tab-session': { shown: true, onPress: () => { anchors['panel-session'].shown = true; } },
    };
    const page = fakePage(anchors);
    const found = await revealStep(step(['panel-session'], ['show-session', 'tab-session', 'bar-more', 'menu-session']), page.dom);
    expect(found).toBe(page.element('panel-session'));
    expect(page.pressed).toEqual(['tab-session']);
  });

  it('unfolds a folded column, then opens the tab in it', async () => {
    const anchors: Parameters<typeof fakePage>[0] = {
      'panel-dice': { shown: false },
      'tab-dice': { shown: false, onPress: () => { anchors['panel-dice'].shown = true; } },
      'show-session': { shown: true, onPress: () => { anchors['tab-dice'].shown = true; } },
    };
    const page = fakePage(anchors);
    await expect(revealStep(step(['panel-dice'], ['show-session', 'tab-dice', 'bar-dice']), page.dom)).resolves.toBe(page.element('panel-dice'));
    expect(page.pressed).toEqual(['show-session', 'tab-dice']);
  });

  it('goes through More on the compact layout, one row at a time', async () => {
    const anchors: Parameters<typeof fakePage>[0] = {
      'start-session': { shown: false },
      'bar-more': { shown: true, onPress: () => { anchors['menu-session'].shown = true; anchors['bar-more'].open = true; } },
      'menu-session': { shown: false, onPress: () => { anchors['start-session'].shown = true; } },
    };
    const page = fakePage(anchors);
    await expect(revealStep(step(['start-session'], ['show-session', 'tab-session', 'bar-more', 'menu-session']), page.dom)).resolves.toBe(page.element('start-session'));
    expect(page.pressed).toEqual(['bar-more', 'menu-session']);
  });

  it('starts from the deepest opener on screen: with More open, its row, not More again', async () => {
    const anchors: Parameters<typeof fakePage>[0] = {
      'start-session': { shown: false },
      'bar-more': { shown: true, open: true },
      'menu-session': { shown: true, onPress: () => { anchors['start-session'].shown = true; } },
    };
    const page = fakePage(anchors);
    await revealStep(step(['start-session'], ['bar-more', 'menu-session']), page.dom);
    expect(page.pressed).toEqual(['menu-session']);
  });

  it('never presses an opener that is already open, which would close it', async () => {
    const page = fakePage({ 'panel-initiative': { shown: false }, 'bar-initiative': { shown: true, open: true } });
    await expect(revealStep(step(['panel-initiative'], ['bar-initiative']), page.dom)).resolves.toBeNull();
    expect(page.pressed).toEqual([]);
  });

  it('falls back to the card in the middle when nothing can be found', async () => {
    const page = fakePage({ 'bar-map': { shown: false } });
    await expect(revealStep(step(['fog'], ['bar-map', 'map-controls', 'menu-tools']), page.dom)).resolves.toBeNull();
    expect(page.pressed).toEqual([]);
  });

  it('stops when an opener opens nothing, rather than pressing it again', async () => {
    const page = fakePage({ fog: { shown: false }, 'map-controls': { shown: true } });
    await expect(revealStep(step(['fog'], ['map-controls', 'menu-tools']), page.dom)).resolves.toBeNull();
    expect(page.pressed).toEqual(['map-controls']);
  });

  it('answers a step with no targets at once, without waiting', async () => {
    const page = fakePage({});
    let waited = false;
    page.dom.wait = async () => { waited = true; };
    await expect(revealStep(step([]), page.dom)).resolves.toBeNull();
    expect(waited).toBe(false);
  });

  it('stops pressing once the tour has moved on', async () => {
    const page = fakePage({ panel: { shown: false }, tab: { shown: true } });
    await expect(revealStep(step(['panel'], ['tab']), page.dom, () => true)).resolves.toBeNull();
    expect(page.pressed).toEqual([]);
  });
});

describe('what a step asks for', () => {
  const outside = { practice: false, ownsToken: true, live: true };

  it('only explains outside the practice campaign, in both tours', () => {
    for (const tour of [GM_TOUR, PLAYER_TOUR]) {
      for (const each of tour) expect(stepNote(each, outside)).toBeNull();
    }
  });

  it('asks for the thing to be tried in the practice campaign', () => {
    const fog = GM_TOUR.find((s) => s.id === 'fog')!;
    expect(stepNote(fog, { ...outside, practice: true })).toEqual({ kind: 'task', text: fog.task });
  });

  it('says why a player without a token cannot move one, in any campaign', () => {
    const token = PLAYER_TOUR.find((s) => s.id === 'token')!;
    expect(stepNote(token, { ...outside, ownsToken: false })).toEqual({ kind: 'hint', text: NO_TOKEN_HINT });
    expect(stepNote(token, { practice: true, ownsToken: false, live: true })).toEqual({ kind: 'hint', text: NO_TOKEN_HINT });
  });

  it('says a token waits for the session in the practice campaign, and asks for the move once it is live', () => {
    const token = PLAYER_TOUR.find((s) => s.id === 'token')!;
    expect(stepNote(token, { practice: true, ownsToken: true, live: false })).toEqual({ kind: 'hint', text: NOT_LIVE_HINT });
    expect(stepNote(token, { practice: true, ownsToken: true, live: true })?.kind).toBe('task');
  });

  it('covers what each tour promises', () => {
    expect(GM_TOUR.map((s) => s.id)).toEqual(['intro', 'map', 'grid', 'fog', 'walls', 'lights', 'tokens', 'assign', 'initiative', 'area', 'session', 'display', 'end']);
    expect(PLAYER_TOUR.map((s) => s.id)).toEqual(['intro', 'token', 'dice', 'sheet', 'chat', 'end']);
  });
});

describe('where the tour is kept', () => {
  afterEach(() => window.localStorage.clear());

  it('keeps the step on this device, for this campaign and this tour', () => {
    saveTour('c1', 'gm', 4);
    expect(JSON.parse(window.localStorage.getItem(TOUR_KEY)!)).toEqual({ campaignId: 'c1', kind: 'gm', step: 4 });
    expect(loadTour('c1', 'gm')).toBe(4);
    expect(loadTour('c2', 'gm')).toBeNull();
    expect(loadTour('c1', 'player')).toBeNull();
  });

  it('forgets it as the tour ends', () => {
    saveTour('c1', 'player', 2);
    clearTour();
    expect(window.localStorage.getItem(TOUR_KEY)).toBeNull();
    expect(loadTour('c1', 'player')).toBeNull();
  });

  it('ignores a place it cannot use: not JSON, past the last step, not a whole number', () => {
    window.localStorage.setItem(TOUR_KEY, '{not json');
    expect(loadTour('c1', 'gm')).toBeNull();
    saveTour('c1', 'player', TOURS.player.length);
    expect(loadTour('c1', 'player')).toBeNull();
    window.localStorage.setItem(TOUR_KEY, JSON.stringify({ campaignId: 'c1', kind: 'gm', step: 1.5 }));
    expect(loadTour('c1', 'gm')).toBeNull();
  });
});
