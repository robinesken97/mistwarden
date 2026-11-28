/**
 * The wide layout's map rail and the map's menus: what a screen reader calls
 * the buttons, their size for a finger, and how the rail fits a short map.
 * jsdom evaluates no media query and lays nothing out, so the size is checked
 * as the classes that set it, and the fit as the rail's columns and the
 * places the panels at the map's top are given from the boxes a browser
 * would measure.
 *
 * The stand-ins are those of MapCanvasTools.test.tsx: the role and current
 * map live in a store the test changes, and the socket records what the page
 * sends. Canvas drawing is switched off.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { CampaignMap, Token } from '@/types';
import type { WallSegment } from '@/types/walls';
import { contact, mouse } from '@/test/pointer';

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  const state = {
    userRole: 'GM' as string,
    currentMap: null as unknown,
    playerSpiritVisible: false as boolean,
  };
  const handlers = new Map<string, Set<(data: never) => void>>();
  const sent: Array<[string, unknown]> = [];
  const raw = {
    on(event: string, fn: (data: never) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return raw;
    },
    off(event: string, fn: (data: never) => void) {
      handlers.get(event)?.delete(fn);
      return raw;
    },
    emit(event: string, payload: unknown) {
      sent.push([event, payload]);
      return raw;
    },
  };
  return {
    state,
    handlers,
    sent,
    raw,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    snapshot: () => version,
    set(patch: Partial<typeof state>) {
      Object.assign(state, patch);
      version += 1;
      listeners.forEach((l) => l());
    },
  };
});

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => undefined }) }));
vi.mock('@/contexts/CampaignContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const mapActions = (await import('@/test/viewedMapContext')).mapActionsFor(() => h.state.currentMap, () => undefined);
  const noop = () => undefined;
  const campaign = {
    id: 'campaign-1', name: 'Test', spiritLayerEnabled: false, status: 'ACTIVE', memberships: [], characters: [],
    maps: [{ id: 'map-a', name: 'Map A' }, { id: 'map-b', name: 'Map B' }],
  };
  return {
    useCampaign: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return {
        currentMap: h.state.currentMap,
        viewedMap: h.state.currentMap,
        setCurrentMap: noop,
        ...mapActions,
        userRole: h.state.userRole,
        campaign,
        updateCampaignSpiritLayer: noop,
        gmViewBothPlanes: false,
        playerSpiritVisible: h.state.playerSpiritVisible,
        setPlayerSpiritVisible: noop,
        activeVibeEffect: null,
        updateVibe: noop,
        activeAtmosphereEffect: null,
        characterHpCache: {},
      };
    },
  };
});

vi.mock('@/contexts/WebSocketContext', async () => {
  const { useSyncExternalStore } = await import('react');
  const record = (event: string) => (payload: unknown) => { h.sent.push([event, payload]); };
  const client = new Proxy({
    getSocket: () => h.raw,
    onMapChanged: (cb: (data: never) => void) => { h.raw.on('map.changed', cb); },
    off: (event: string, cb: (data: never) => void) => { h.raw.off(event, cb); },
    emitTokenMoveStart: record('token.move.start'),
    emitTokenMove: record('token.move'),
    emitTokenMoveEnd: record('token.move.end'),
    emitMapPing: record('map.ping'),
  } as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => () => undefined;
    },
  });
  return {
    useWebSocket: () => {
      useSyncExternalStore(h.subscribe, h.snapshot);
      return { socket: client, joinedEpoch: 1, status: 'connected', reconnectCount: 0 };
    },
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', displayName: 'Me' } }),
}));

vi.mock('@/services/map.service', () => ({
  default: { updateMap: vi.fn().mockResolvedValue({}), getMaps: vi.fn().mockResolvedValue([]), getMap: vi.fn() },
}));

vi.mock('@/services/api', () => {
  const client = new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) });
  return { api: client, default: client };
});

import MapCanvas from '../MapCanvas';
import { useGameStore } from '@/stores/gameStore';

function mapWith(extra: Partial<CampaignMap> = {}): CampaignMap {
  return {
    id: 'map-a',
    campaignId: 'campaign-1',
    name: 'Map A',
    imageUrl: '/api/assets/maps/x',
    width: 20,
    height: 20,
    gridSize: 50,
    tokens: [],
    wallSegments: [],
    lights: [],
    fogEnabled: false,
    lightingEnabled: false,
    globalIllumination: true,
    explorationEnabled: false,
    ...extra,
  } as unknown as CampaignMap;
}

/** A one-square token; grid y counts up from the bottom row, 0, to the top, 19. */
function token(id: string, name: string, x: number, y: number): Token {
  return {
    id, name, imageUrl: '', position: { x, y }, size: { width: 1, height: 1 },
    layer: 'token', visible: true, type: 'npc', conditions: [],
  } as unknown as Token;
}

/** Map pixel (x, y), which at 100% and no pan is the same screen pixel. */
const px = (x: number, y: number) => ({ clientX: x, clientY: y });
/** The centre of square (x, y). */
const square = (x: number, y: number) => px(x * 50 + 25, (19 - y) * 50 + 25);

function surface(): HTMLCanvasElement {
  const input = document.querySelector<HTMLCanvasElement>('canvas[class*="cursor-"]');
  if (!input) throw new Error('no input canvas');
  return input;
}

const classesOf = (el: Element) => el.className.split(/\s+/);

/** The buttons of the menu open now. */
const menuButtons = () => {
  const first = screen.getByText(/^(Edit Token|Open Door)$/);
  return Array.from(first.parentElement!.querySelectorAll('button'));
};

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });
  class RO { observe() {} unobserve() {} disconnect() {} }
  Object.defineProperty(window, 'ResizeObserver', { value: RO, configurable: true });
});

beforeEach(() => {
  h.sent.length = 0;
  h.handlers.clear();
  useGameStore.getState().setTokens([]);
  h.set({ userRole: 'GM', currentMap: mapWith(), playerSpiritVisible: false });
});

/** The wide layout's rail on the map's right edge (map/MapRail.tsx). */
const rail = () => screen.getByRole('navigation', { name: 'Map tools' });
/** The rail's buttons, by their names, in the order they stand. */
const railNames = (el: HTMLElement = rail()) =>
  within(el).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
/** Open the rail's popover behind the cell named `cell`. */
function openPopover(cell: string) {
  fireEvent.click(within(rail()).getByRole('button', { name: cell }));
  return screen.getByRole('group', { name: cell });
}

describe("the rail's names", () => {
  // Each button shows only an icon; its name is its aria-label, and the
  // tooltip shows that name (on hover, focus or a finger's hold), so no
  // title doubles it.
  it('gives every button the name its tooltip shows', () => {
    vi.useFakeTimers();
    try {
      render(<MapCanvas />);
      fireEvent.click(within(rail()).getByRole('button', { name: 'Measure' }));

      expect(railNames()).toEqual([
        'Zoom out', 'Zoom in', 'Fit map', 'Grid', 'Measure', 'Ruler color: Amber', 'Spell area', 'Ping', 'Draw', 'Spirit Layer', 'GM tools',
      ]);
      for (const button of within(rail()).getAllByRole('button')) {
        if (button.getAttribute('aria-label') === 'Ruler color: Amber') continue;
        expect(button).not.toHaveAttribute('title');
        // A mouse resting on it shows its name after a moment.
        fireEvent.pointerOver(button, { pointerType: 'mouse' });
        act(() => { vi.advanceTimersByTime(400); });
        expect(screen.getByRole('tooltip')).toHaveTextContent(button.getAttribute('aria-label')!);
        fireEvent.pointerOut(button, { pointerType: 'mouse' });
        expect(screen.queryByRole('tooltip')).toBeNull();
      }

      expect(within(openPopover('Grid')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Toggle Grid', 'Grid Color: Black', 'Place tokens freely']);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(within(openPopover('Spirit Layer')).getByRole('button', { name: 'Spirit tokens shown, click to hide' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // On a touch screen a press held for half a second shows the name, and
  // the click that follows does nothing else.
  it('shows a name for a finger held on a button, and does nothing more', () => {
    vi.useFakeTimers();
    try {
      render(<MapCanvas />);
      const measure = within(rail()).getByRole('button', { name: 'Measure' });

      fireEvent.pointerDown(measure, { pointerType: 'touch' });
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByRole('tooltip')).toHaveTextContent('Measure');
      fireEvent.pointerUp(measure, { pointerType: 'touch' });
      fireEvent.click(measure);

      expect(measure).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(measure);
      expect(measure).toHaveAttribute('aria-pressed', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('names a button by what it shows now', () => {
    render(<MapCanvas />);
    const grid = openPopover('Grid');
    fireEvent.click(within(grid).getByRole('button', { name: 'Grid Color: Black' }));
    // A row keeps its popover open.
    expect(within(grid).getByRole('button', { name: 'Grid Color: White' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Grid' })).toBeNull();

    const spirit = openPopover('Spirit Layer');
    fireEvent.click(within(spirit).getByRole('button', { name: 'Spirit tokens shown, click to hide' }));
    expect(within(spirit).getByRole('button', { name: 'Spirit tokens hidden — click to show' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers the GM the Spirit Layer settings from its popover', () => {
    const onOpenSpiritLayer = vi.fn();
    render(<MapCanvas onOpenSpiritLayer={onOpenSpiritLayer} />);
    fireEvent.click(within(openPopover('Spirit Layer')).getByRole('button', { name: 'Spirit Layer settings' }));

    expect(onOpenSpiritLayer).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: 'Spirit Layer' })).toBeNull();
  });

  // Toggle Grid is a row now, its state its pressed state; a press outside closes the popover.
  it('toggles the grid from its popover, which a press outside closes', () => {
    render(<MapCanvas />);
    const grid = openPopover('Grid');
    expect(within(rail()).getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(grid).getByRole('button', { name: 'Toggle Grid' }));

    expect(within(grid).getByRole('button', { name: 'Toggle Grid' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(grid).queryByRole('button', { name: /^Grid Color/ })).toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Grid' })).toBeNull();
  });
});

describe("the rail's size", () => {
  // Its cells are 40 pixels with a mouse and 44 on a touch screen: classes,
  // as jsdom evaluates no media query; the popovers' rows are as tall.
  it('sizes every button for a finger', () => {
    render(<MapCanvas />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Measure' }));

    for (const button of within(rail()).getAllByRole('button')) {
      expect(classesOf(button)).toEqual(expect.arrayContaining(['size-10', 'pointer-coarse:size-11']));
    }
    for (const row of within(openPopover('Grid')).getAllByRole('button')) {
      expect(classesOf(row)).toEqual(expect.arrayContaining(['min-h-10', 'pointer-coarse:min-h-11']));
    }
  });
});

// Its shape buttons were about 26 pixels tall and its presets about 22.
describe("the AoE Shape panel's size", () => {
  it('sizes its buttons and its Snap to grid box for a finger', () => {
    render(<MapCanvas />);
    fireEvent.click(screen.getByRole('button', { name: 'Spell area' }));
    // A placement, so the panel offers × Clear placement.
    const canvas = document.querySelector('canvas[class*="cursor-"]')!;
    mouse.down(canvas, { clientX: 125, clientY: 125 });
    mouse.up(canvas, { clientX: 125, clientY: 125 });

    for (const name of ['Circle', 'Cone', 'Line', 'Cube', '10 ft', '15 ft', '20 ft', '30 ft', '60 ft', '× Clear placement']) {
      expect(classesOf(screen.getByRole('button', { name }))).toContain('touch-target');
    }
    expect(classesOf(screen.getByRole('checkbox', { name: 'Snap to grid' }).closest('label')!)).toContain('touch-target');
  });
});

describe('the menus on a touch screen', () => {
  // Each item was 36 pixels tall.
  it("makes the token menu's items, and the maps it moves a token to, tall enough for a finger", () => {
    render(<MapCanvas />);
    act(() => { useGameStore.getState().setTokens([token('tok-goblin', 'Goblin', 0, 19)]); });

    fireEvent.contextMenu(surface(), square(0, 19));
    fireEvent.click(screen.getByText('Move to Map…'));

    const items = menuButtons();
    expect(items.map((b) => b.textContent)).toContain('Map B');
    for (const item of items) expect(classesOf(item)).toContain('pointer-coarse:min-h-11');
  });

  // At 44 pixels an item, the GM's menu for a player's token runs to about
  // 600 pixels, more than a tablet in landscape shows; it went off the
  // bottom of the screen with no way to scroll to its last items. Only there:
  // a scrolling menu would cut the sides off a keyboard's focus ring, and a
  // mouse's menu of 36-pixel items fits.
  it('keeps the token menu and the door menu within the screen on a touch screen, scrolling inside', () => {
    const door: WallSegment = { id: 'd1', x1: 100, y1: 100, x2: 200, y2: 100, type: 'door-closed' };
    h.set({ currentMap: mapWith({ wallSegments: [door] }) });
    render(<MapCanvas />);
    act(() => { useGameStore.getState().setTokens([token('tok-goblin', 'Goblin', 0, 19)]); });
    const capped = ['pointer-coarse:max-h-[calc(100dvh-1rem)]', 'pointer-coarse:overflow-y-auto', 'pointer-coarse:overscroll-contain'];

    fireEvent.contextMenu(surface(), square(0, 19));
    expect(classesOf(screen.getByText('Edit Token').parentElement!)).toEqual(expect.arrayContaining(capped));

    fireEvent.click(document.body);
    fireEvent.contextMenu(surface(), px(150, 104));
    expect(classesOf(screen.getByText('Open Door').parentElement!)).toEqual(expect.arrayContaining(capped));
  });

  // Opening Move to Map… made the menu taller where it already stood, so its
  // foot could pass the bottom of the screen.
  it('places the token menu again when Move to Map… opens, so it stays on the screen', () => {
    render(<MapCanvas />);
    act(() => { useGameStore.getState().setTokens([token('tok-goblin', 'Goblin', 0, 9)]); });

    // Opened at y 525 on a window 768 tall, where it fits below the point.
    fireEvent.contextMenu(surface(), square(0, 9));
    const menu = screen.getByText('Edit Token').parentElement!;
    expect(menu.style.top).toBe('525px');

    // With the maps listed it is 400 tall, so it opens upward from the point.
    menu.getBoundingClientRect = () => ({ left: 25, top: 525, width: 200, height: 400, right: 225, bottom: 925, x: 25, y: 525, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(screen.getByText('Move to Map…'));
    expect(menu.style.top).toBe('125px');
  });

  it("makes the door menu's items tall enough for a finger", () => {
    const door: WallSegment = { id: 'd1', x1: 100, y1: 100, x2: 200, y2: 100, type: 'door-closed' };
    h.set({ currentMap: mapWith({ wallSegments: [door] }) });
    render(<MapCanvas />);

    fireEvent.contextMenu(surface(), px(150, 104));

    const items = menuButtons();
    expect(items.map((b) => b.textContent)).toEqual(['Open Door', 'Lock Door']);
    for (const item of items) expect(classesOf(item)).toContain('pointer-coarse:min-h-11');
  });
});

/** A box at `left, top` of `width` by `height`, as getBoundingClientRect gives it. */
const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** The map's box, `height` tall, as a browser reports it on a resize. */
function mapIsTall(height: number) {
  const container = rail().parentElement!;
  container.getBoundingClientRect = () => box(0, 0, 800, height);
  act(() => { window.dispatchEvent(new Event('resize')); });
}

/** A touch screen's pointer, as `(pointer: coarse)` answers it. */
function coarsePointer() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)', media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

describe('the rail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // The view, the tools and the GM's layers, one column with a line between groups.
  it('stands its cells in one column on a tall map, in groups', () => {
    render(<MapCanvas />);
    mapIsTall(800);

    expect(rail()).toHaveAttribute('data-rail-columns', '1');
    expect(railNames()).toEqual(['Zoom out', 'Zoom in', 'Fit map', 'Grid', 'Measure', 'Spell area', 'Ping', 'Draw', 'Spirit Layer', 'GM tools']);
    const column = rail().lastElementChild!;
    // The zoom between its buttons, and a line before Measure and before GM tools.
    const cells = Array.from(column.children).map((c) => c.getAttribute('aria-hidden') === 'true' ? '---' : c.getAttribute('aria-label') ?? c.querySelector('button')?.getAttribute('aria-label') ?? c.textContent);
    expect(cells).toEqual(['Zoom out', '100%', 'Zoom in', 'Fit map', 'Grid', '---', 'Measure', 'Spell area', 'Ping', 'Draw', 'Spirit Layer', '---', 'GM tools']);
  });

  // One column of a mouse's 11 cells is 498 pixels; with 16 to spare it no longer fits a map 500 tall.
  it('goes to two columns on a short map: the tools inside, the view and the GM’s layers outside', () => {
    render(<MapCanvas />);
    mapIsTall(500);

    expect(rail()).toHaveAttribute('data-rail-columns', '2');
    const [inner, outer] = Array.from(rail().children) as HTMLElement[];
    expect(railNames(inner)).toEqual(['Measure', 'Spell area', 'Ping', 'Draw', 'Spirit Layer']);
    expect(railNames(outer)).toEqual(['Zoom out', 'Zoom in', 'Fit map', 'Grid', 'GM tools']);

    mapIsTall(520);
    expect(rail()).toHaveAttribute('data-rail-columns', '1');
  });

  // This campaign does not let its players draw, so Draw is not offered.
  it('gives a player the view and the tools, and no layers of the GM', () => {
    h.set({ userRole: 'PLAYER' });
    render(<MapCanvas />);
    expect(railNames()).toEqual(['Zoom out', 'Zoom in', 'Fit map', 'Grid', 'Measure', 'Spell area', 'Ping']);
  });

  it('offers only the view with no map open', () => {
    h.set({ currentMap: null });
    render(<MapCanvas />);
    expect(railNames()).toEqual(['Zoom out', 'Zoom in', 'Fit map', 'Grid', 'Spirit Layer']);
  });

  // Its readout is one cell, "300%" in 13 px type.
  it('fits the zoom readout in one button cell, its type no smaller than 12 px', () => {
    render(<MapCanvas />);

    const readout = classesOf(screen.getByText(/^\d+%$/));
    expect(readout).toEqual(expect.arrayContaining(['size-10', 'pointer-coarse:size-11', 'text-[0.8125rem]']));
    expect(readout.filter((c) => /^(pointer-coarse:)?min-w-/.test(c))).toEqual([]);
    expect(screen.getByText(/^\d+%$/)).not.toHaveAttribute('role');
  });

  it('tells a touch screen once to press and hold for names, until it is closed', () => {
    coarsePointer();
    const first = render(<MapCanvas />);
    expect(within(rail()).getByText('Press and hold for names')).toBeInTheDocument();
    fireEvent.click(within(rail()).getByRole('button', { name: 'Close hint' }));
    expect(screen.queryByText('Press and hold for names')).toBeNull();
    expect(localStorage.getItem('mistwarden.railHintSeen')).toBe('1');
    first.unmount();

    render(<MapCanvas />);
    expect(screen.queryByText('Press and hold for names')).toBeNull();
  });

  it('tells a mouse nothing of the kind', () => {
    render(<MapCanvas />);
    expect(screen.queryByText('Press and hold for names')).toBeNull();
  });
});

describe('the spirit realm label', () => {
  // The band spans the map's width at its top; the strip of it beside the
  // label is the map's: a click, a tap, a long-press or the wheel there
  // reaches the map.
  it('lets the map take what lands in the band beside it', () => {
    h.set({ userRole: 'PLAYER', playerSpiritVisible: true });
    render(<MapCanvas />);

    const label = screen.getByText('Spirit Realm').closest('.animate-pulse-soft')!;
    expect(classesOf(label.parentElement!)).toContain('pointer-events-none');
    expect(classesOf(label)).toContain('pointer-events-auto');
  });

  // The label sat over the toolbar's right end, Ping under it; it stands at
  // the map's top left now, and the rail on the right edge, apart from it.
  it('stands at the map’s top left, clear of the rail', () => {
    h.set({ userRole: 'PLAYER', playerSpiritVisible: true });
    render(<MapCanvas />);

    const label = screen.getByText('Spirit Realm').closest('.animate-pulse-soft')!;
    expect(classesOf(label.parentElement!)).toEqual(expect.arrayContaining(['top-2', 'left-2']));
    expect(classesOf(label)).not.toContain('ml-auto');
    expect(label.parentElement).not.toContainElement(rail());
  });
});

describe('what sits at the map’s top', () => {
  const observed: ResizeObserverCallback[] = [];
  class RecordingResizeObserver {
    constructor(callback: ResizeObserverCallback) { observed.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const realObserver = window.ResizeObserver;

  beforeEach(() => {
    observed.length = 0;
    Object.defineProperty(window, 'ResizeObserver', { value: RecordingResizeObserver, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'ResizeObserver', { value: realObserver, configurable: true });
    vi.unstubAllGlobals();
  });

  /**
   * The boxes a browser would give a map 800 wide and `height` tall at the
   * page's top left corner, and Put back, while it shows, 254 wide and
   * `barHeight` tall at the top it is given; then a resize.
   */
  function layOut(height = 800, barHeight = 52) {
    const container = rail().parentElement!;
    container.getBoundingClientRect = () => box(0, 0, 800, height);
    const bar = screen.queryByRole('button', { name: 'Put back' })?.parentElement;
    if (bar) bar.getBoundingClientRect = () => box(273, parseFloat(bar.style.top) || 80, 254, barHeight);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      for (const callback of observed) callback([], {} as ResizeObserver);
    });
  }

  const aoePanel = () => screen.getByText('AoE Shape').parentElement!;
  const putBackBar = () => screen.getByRole('button', { name: 'Put back' }).parentElement!;
  const toolStack = () => screen.getByTitle(/Drag to move the panels/).parentElement!;
  const openAoE = () => fireEvent.click(screen.getByRole('button', { name: 'Spell area' }));
  const showGmTools = () => fireEvent.click(within(rail()).getByRole('button', { name: 'GM tools' }));

  /** The GM holds the goblin with a tap of a finger, so the Put back bar shows. */
  function holdByTap() {
    act(() => { useGameStore.getState().setTokens([token('tok-goblin', 'Goblin', 10, 5)]); });
    const finger = contact('touch', 1);
    finger.down(surface(), square(10, 5));
    finger.up(surface(), square(10, 5));
    finger.leave(surface());
  }

  // No toolbar on the map's top: the AoE panel starts 8 pixels under it,
  // and the tool stack left of the rail, 8 from it.
  it('starts the AoE panel at the map’s top, and the tool stack beside the rail', () => {
    render(<MapCanvas />);
    openAoE();
    showGmTools();
    layOut();

    expect(aoePanel().style.top).toBe('8px');
    expect(toolStack().style.top).toBe('8px');
    // 8, the rail's 50 (a 40 px cell, padding and border), 8.
    expect(toolStack().style.right).toBe('66px');
  });

  it('starts Put back 8 pixels under the map’s top', () => {
    render(<MapCanvas />);
    holdByTap();
    layOut();

    expect(putBackBar().style.top).toBe('8px');
  });

  // Both started at the top, Put back over the AoE panel's shape buttons.
  it('starts the AoE panel under Put back while a token is held, and back at the top after', () => {
    render(<MapCanvas />);
    holdByTap();
    openAoE();
    layOut(800, 62);

    expect(putBackBar().style.top).toBe('8px');
    expect(aoePanel().style.top).toBe('78px');

    fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(aoePanel().style.top).toBe('8px');
  });

  // Moved down, the panel ran past the map's foot on a short tablet, and the
  // map's column scrolled.
  it('keeps a moved AoE panel within the map, scrolling inside', () => {
    render(<MapCanvas />);
    holdByTap();
    openAoE();
    layOut(800, 62);

    expect(aoePanel().style.maxHeight).toContain('78px');
    expect(aoePanel().style.overflowY).toBe('auto');
  });

  // A touch screen's 44-pixel cells make the rail wider, and two columns wider still.
  it('keeps the tool stack beside the rail on a touch screen, in one column and in two', () => {
    coarsePointer();
    render(<MapCanvas />);
    showGmTools();
    layOut(800);
    // 8, the rail's 54, 8.
    expect(toolStack().style.right).toBe('70px');

    layOut(500);
    expect(rail()).toHaveAttribute('data-rail-columns', '2');
    // 8, the rail's 102 (two cells, the gap between, padding and border), 8.
    expect(toolStack().style.right).toBe('118px');
  });
});
