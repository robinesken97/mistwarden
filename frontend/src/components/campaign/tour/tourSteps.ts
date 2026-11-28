// Added for Mistwarden on 2026-11-28.
/**
 * The table's guided tours, the GM's and the player's: their steps, how a
 * step finds what it points at, and where the tour's place is kept.
 *
 * A step points at an anchor, an element marked `data-tour="…"`. It names
 * its anchors in order, as each layout has its own (the desktop's header
 * button, the compact layout's More row), and the first one on screen is
 * the one shown. One that sits in something closed (the rail on another
 * tab, the folded party column, More, the map's tools hidden on a phone)
 * names the anchors that open it, its openers, as a chain: the deepest one
 * on screen is pressed, then the ones after it. An opener already open
 * (aria-expanded or aria-selected) is not pressed, as every one of them is
 * a toggle and would close what is open. With nothing found the step is a
 * card in the middle of the screen.
 *
 * Outside the practice campaign the tours only explain; in it, a step can
 * also ask for the thing to be tried (`task`).
 *
 * A tour starts only from its button (startTour), never by itself. Its
 * place is kept on this device (localStorage, as the display settings are),
 * so a reload comes back to the same step.
 */

import { optionalStorage } from '@/utils/optionalStorage';

export type TourKind = 'gm' | 'player';

export interface TourStep {
  id: string;
  title: string;
  /** What the step explains, in any campaign. */
  body: string;
  /** In the practice campaign only: what to try now. */
  task?: string;
  /** The step is about the player's own token, which may not exist yet. */
  needs?: 'own-token';
  /** Anchors, in order; the first on screen is shown. None: a card in the middle. */
  targets: string[];
  /** Anchors that bring a target on screen, outermost first. */
  openers?: string[];
}

/** What the card says about a step beyond its text. */
export interface TourContext {
  practice: boolean;
  /** The player controls a token on the map on screen. */
  ownsToken: boolean;
  /** A session is live, which a player's token waits for. */
  live: boolean;
}

// The openers of each place a step can point into, outermost first.
const MAP = ['bar-map'];
const MAP_TOOLS = ['bar-map', 'map-controls', 'menu-tools'];
const RAIL = (tab: string) => ['show-session', `tab-${tab}`, `bar-${tab}`];
const PARTY = ['show-party', 'bar-party'];
const MORE = ['bar-more'];

const END: TourStep = {
  id: 'end',
  title: 'That is the tour',
  body: 'The Tour button runs it again whenever you like: in the header, or under More on a small screen.',
  targets: ['tour-button', 'menu-tour'],
};

export const GM_TOUR: readonly TourStep[] = [
  {
    id: 'intro',
    title: 'The GM’s tour',
    body: 'A short walk past the tools you run a game with. Next goes on, Back goes back, and End tour or Escape stops it.',
    task: 'This is the practice campaign, so each step also asks you to try the thing. Nothing here matters: Reset practice campaign in Campaign Settings puts it all back.',
    targets: [],
  },
  {
    id: 'map',
    title: 'The map',
    body: 'Everyone at the table sees this map. Drag an empty spot to move it; zoom with the mouse wheel, a pinch or the zoom buttons.',
    task: 'Move the map a little and zoom in on the courtyard.',
    targets: ['map'],
    openers: MAP,
  },
  {
    id: 'grid',
    title: 'The grid',
    body: 'Toggle Grid shows or hides the squares, and the button beside it changes their colour. On a small screen both are under More map controls. The square size is the map’s, in the Map Library.',
    task: 'Hide the grid, then show it again.',
    targets: ['grid', 'map-controls'],
    openers: MAP,
  },
  {
    id: 'fog',
    title: 'Fog of war',
    body: 'Fog hides parts of the map from the players. Reveal and hide it by box, by brush or all at once; you still see the map under it.',
    task: 'Reveal the storehouse.',
    targets: ['fog'],
    openers: MAP_TOOLS,
  },
  {
    id: 'walls',
    title: 'Walls and doors',
    body: 'Walls block what the players’ tokens see and where light falls. A door is a wall that opens and closes.',
    task: 'Open the cellar door, then close it again.',
    targets: ['walls'],
    openers: MAP_TOOLS,
  },
  {
    id: 'lights',
    title: 'Lights',
    body: 'Place lights and set how far and in what colour they shine. With Global Illumination off, players see only what is lit or what their tokens see.',
    task: 'Select the lantern by the storehouse door and change how far it shines.',
    targets: ['lights'],
    openers: MAP_TOOLS,
  },
  {
    id: 'tokens',
    title: 'Tokens',
    body: 'The Token Manager puts tokens on the map: a picture, a size, a player character or an NPC, shown or hidden. The Creature Library and Token Templates add ready-made ones.',
    task: 'Open the Token Manager and look through its choices.',
    targets: ['tool-tokens', 'menu-tokens'],
    openers: MORE,
  },
  {
    id: 'assign',
    title: 'Give a token to a player',
    body: 'The Token Roster lists the tokens on this map. Edit one and choose who controls it: that player can then move it. A player has to join the campaign first, through Invite in Campaign Info.',
    task: 'Invite a second account, then edit the Scout and make that player its controller.',
    targets: ['token-roster'],
    openers: PARTY,
  },
  {
    id: 'initiative',
    title: 'Initiative',
    body: 'The initiative tracker keeps the order of a fight: add tokens, roll or type their initiative and step through the turns. The token whose turn it is has a ring on the map.',
    task: 'Add the Wolf and the Skeleton and run a round.',
    targets: ['panel-initiative'],
    openers: RAIL('initiative'),
  },
  {
    id: 'area',
    title: 'Spell areas',
    body: 'AoE Shape lays a circle, cone, line or square over the map for everyone to see; on a small screen it is under More map controls. A spell on a character sheet places its own area.',
    task: 'Turn on AoE Shape and put a circle on the courtyard.',
    targets: ['aoe', 'map-controls'],
    openers: MAP,
  },
  {
    id: 'session',
    title: 'Start the session',
    body: 'Start Session opens play: players move their tokens only while a session is live. Pause holds the table; End closes the session, with notes for next time.',
    task: 'Start a session.',
    targets: ['start-session', 'panel-session'],
    openers: ['show-session', 'tab-session', 'bar-more', 'menu-session'],
  },
  {
    id: 'display',
    title: 'Display on this device',
    body: 'How this device draws the table: the fog’s mist, the dice animation, token names, lights while dragging and moving spell areas. Each device keeps its own, so a slow tablet can go plain.',
    task: 'Set Fog to Flat, look at the map, then set it back.',
    targets: ['display-panel', 'display'],
    openers: MORE,
  },
  END,
];

export const PLAYER_TOUR: readonly TourStep[] = [
  {
    id: 'intro',
    title: 'The player’s tour',
    body: 'A short walk past what you play with: your token, the dice, your character sheet and the chat. Next goes on, Back goes back, and End tour or Escape stops it.',
    task: 'This is a practice campaign, so each step also asks you to try the thing.',
    targets: [],
  },
  {
    id: 'token',
    title: 'Your token',
    body: 'Drag your token to move it; on a touch screen, press it and drag. Tokens move while the GM’s session is live.',
    task: 'Drag your token a few squares.',
    needs: 'own-token',
    targets: ['map'],
    openers: MAP,
  },
  {
    id: 'dice',
    title: 'Dice',
    body: 'Roll from the dice panel: press the dice or type a roll such as 2d6+3. Every roll goes into the log for the table to see.',
    task: 'Roll a d20.',
    targets: ['panel-dice'],
    openers: RAIL('dice'),
  },
  {
    id: 'sheet',
    title: 'Your character sheet',
    body: 'Your character is in the Campaign Roster. Press it to open the sheet; its rolls use your character’s numbers.',
    task: 'Open your character’s sheet.',
    targets: ['roster'],
    openers: PARTY,
  },
  {
    id: 'chat',
    title: 'Chat',
    body: 'Talk to the table here. Choose someone under To for a whisper only they see.',
    task: 'Say hello to the table.',
    targets: ['panel-chat'],
    openers: RAIL('chat'),
  },
  END,
];

export const TOURS: Record<TourKind, readonly TourStep[]> = { gm: GM_TOUR, player: PLAYER_TOUR };

export const NO_TOKEN_HINT = 'No token on this map is yours yet. The GM gives you one; skip this step until then.';
export const NOT_LIVE_HINT = 'Tokens wait for the GM to start the session; skip this step, or try it once the session is live.';

/** The line under a step's text: what to try (in the practice campaign), or why it cannot be tried yet. */
export function stepNote(step: TourStep, context: TourContext): { kind: 'task' | 'hint'; text: string } | null {
  if (step.needs === 'own-token') {
    if (!context.ownsToken) return { kind: 'hint', text: NO_TOKEN_HINT };
    if (context.practice && !context.live) return { kind: 'hint', text: NOT_LIVE_HINT };
  }
  return context.practice && step.task ? { kind: 'task', text: step.task } : null;
}

// ── Finding a step's target ──

/** What finding a target needs of the page; tests give their own. */
export interface TourDom {
  /** The elements carrying an anchor. */
  find: (anchor: string) => Element[];
  /** Drawn and not covered, so it can be pointed at and pressed. */
  shown: (el: Element) => boolean;
  /** An opener already open, which a press would close. */
  open: (el: Element) => boolean;
  press: (el: Element) => void;
  /** Scrolls an element its container holds out of view into it. */
  scrollIn: (el: Element) => void;
  /** Resolves once `ready` answers true, or after a while. */
  wait: (ready: () => boolean) => Promise<void>;
}

/** The first element of the first anchor on screen. */
export function findShown(anchors: readonly string[], dom: TourDom): Element | null {
  for (const anchor of anchors) {
    const el = dom.find(anchor).find((candidate) => dom.shown(candidate));
    if (el) return el;
  }
  return null;
}

/**
 * Brings a step's target on screen, pressing its openers, and answers it,
 * or null for the card in the middle. Pressed once as a step opens; after
 * that the target is only looked for, so a container the user closes stays
 * closed.
 */
export async function revealStep(step: TourStep, dom: TourDom, cancelled: () => boolean = () => false): Promise<Element | null> {
  if (step.targets.length === 0) return null;
  const target = () => {
    for (const anchor of step.targets) dom.find(anchor).forEach((el) => dom.scrollIn(el));
    return findShown(step.targets, dom);
  };
  // A row of More scrolled out of sight by an earlier step is scrolled back first.
  const pressable = (anchor: string) => dom.find(anchor).find((el) => { dom.scrollIn(el); return dom.shown(el) && !dom.open(el); });
  let openers = step.openers ?? [];
  // After a reload the map's own code and the campaign arrive a moment later.
  await dom.wait(() => target() !== null || openers.some((anchor) => pressable(anchor)));
  while (!cancelled() && target() === null) {
    let deepest = -1;
    openers.forEach((anchor, index) => { if (pressable(anchor)) deepest = index; });
    if (deepest < 0) break;
    dom.press(pressable(openers[deepest])!);
    openers = openers.slice(deepest + 1);
    await dom.wait(() => target() !== null || openers.some((anchor) => pressable(anchor)));
  }
  return cancelled() ? null : target();
}

/** The page itself. */
export const pageDom: TourDom = {
  find: (anchor) => Array.from(document.querySelectorAll(`[data-tour~="${anchor}"]`)),
  shown: (el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return false;
    if (getComputedStyle(el).visibility === 'hidden' || el.closest('[inert]')) return false;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    // Covered by a sheet or a dialog: the press would land on that. The tour's own card does not count.
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    return hit === null || el.contains(hit) || hit.closest('[data-tour-card]') !== null;
  },
  open: (el) => el.getAttribute('aria-expanded') === 'true' || el.getAttribute('aria-selected') === 'true',
  press: (el) => (el as HTMLElement).click(),
  scrollIn: (el) => {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || getComputedStyle(el).visibility === 'hidden' || el.closest('[inert]')) return;
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  },
  // A sheet slides in, a column unfolds: looked at every 50 ms for up to 1.2 s.
  wait: (ready) => new Promise((resolve) => {
    const started = Date.now();
    const look = () => (ready() || Date.now() - started > 1200 ? resolve() : void setTimeout(look, 50));
    setTimeout(look, 50);
  }),
};

// ── Where the tour is ──

export const TOUR_KEY = 'mistwarden.tour';
/** The window event the Tour buttons send; the table's tour starts on it. */
export const TOUR_START_EVENT = 'mistwarden:tour-start';

/** Starts the tour from its first step. */
export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}

/** The step this device was on in this campaign's tour of this kind, or null. */
export function loadTour(campaignId: string, kind: TourKind): number | null {
  try {
    const saved: unknown = JSON.parse(optionalStorage.getItem(TOUR_KEY) ?? 'null');
    if (typeof saved !== 'object' || saved === null) return null;
    const { campaignId: savedCampaign, kind: savedKind, step } = saved as Record<string, unknown>;
    if (savedCampaign !== campaignId || savedKind !== kind) return null;
    return Number.isInteger(step) && (step as number) >= 0 && (step as number) < TOURS[kind].length ? (step as number) : null;
  } catch {
    return null;
  }
}

export function saveTour(campaignId: string, kind: TourKind, step: number): void {
  optionalStorage.setItem(TOUR_KEY, JSON.stringify({ campaignId, kind, step }));
}

export function clearTour(): void {
  optionalStorage.removeItem(TOUR_KEY);
}
