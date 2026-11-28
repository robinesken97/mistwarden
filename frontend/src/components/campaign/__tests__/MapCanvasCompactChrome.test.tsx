/**
 * The map's chrome on a phone: the slim rail, the dock at the map's foot,
 * the Draw strip, and the GM's tool stack behind the GM tools cell. jsdom evaluates no media query and lays nothing out, so a size
 * is checked as the classes that set it, and a place as the one given from
 * the boxes a browser would measure.
 *
 * The stand-ins are MapCanvasToolbar.test.tsx's: the role and current map
 * live in a store the test changes, and the socket records what the page
 * sends. Canvas drawing is switched off.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { CampaignMap, Token } from '@/types';
import { contact } from '@/test/pointer';

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let version = 0;
  const state = {
    userRole: 'GM' as string,
    currentMap: null as unknown,
  };
  const sent: Array<[string, unknown]> = [];
  const raw = {
    on() { return raw; },
    off() { return raw; },
    emit(event: string, payload: unknown) {
      sent.push([event, payload]);
      return raw;
    },
  };
  return {
    state,
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
    id: 'campaign-1', name: 'Test', spiritLayerEnabled: false, status: 'ACTIVE', playersMayDraw: true,
    memberships: [], characters: [], maps: [{ id: 'map-a', name: 'Map A' }],
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
        playerSpiritVisible: false,
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
  const client = new Proxy({
    getSocket: () => h.raw,
    sendDrawingPreview: (payload: unknown) => { h.sent.push(['drawing:preview', payload]); },
    // Sent, and never answered: the drawing stays on its way.
    addDrawing: (payload: unknown) => {
      h.sent.push(['drawing:add', payload]);
      return new Promise(() => undefined);
    },
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

import MapCanvasOnly from '../MapCanvas';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { useGameStore } from '@/stores/gameStore';
import { useTableChrome } from '@/stores/tableChromeStore';

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

/** The map as a phone held upright draws it. */
function MapCanvas() {
  return (
    <LayoutProvider compact layout="phone">
      <MapCanvasOnly />
    </LayoutProvider>
  );
}

/** A one-square token; grid y counts up from the bottom row, 0, to the top, 19. */
function token(id: string, name: string, x: number, y: number): Token {
  return {
    id, name, imageUrl: '', position: { x, y }, size: { width: 1, height: 1 },
    layer: 'token', visible: true, type: 'npc', conditions: [],
  } as unknown as Token;
}

/** The centre of square (x, y), at 100% and no pan. */
const square = (x: number, y: number) => ({ clientX: x * 50 + 25, clientY: (19 - y) * 50 + 25 });

function surface(): HTMLCanvasElement {
  const input = document.querySelector<HTMLCanvasElement>('canvas[class*="cursor-"]');
  if (!input) throw new Error('no input canvas');
  return input;
}


/** A finger's tap at `at`. */
function tap(id: number, at: { clientX: number; clientY: number }) {
  const finger = contact('touch', id);
  finger.down(surface(), at);
  finger.up(surface(), at);
  finger.leave(surface());
}

const classesOf = (el: Element) => el.className.split(/\s+/);


const rail = () => screen.getByRole('navigation', { name: 'Map tools' });
/** The rail's cells, by name, top to bottom. */
const cells = () => within(rail()).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null, configurable: true });
  class RO { observe() {} unobserve() {} disconnect() {} }
  Object.defineProperty(window, 'ResizeObserver', { value: RO, configurable: true });
});

beforeEach(() => {
  h.sent.length = 0;
  useGameStore.getState().setTokens([]);
  h.set({ userRole: 'GM', currentMap: mapWith() });
});

describe('the phone rail', () => {
  it('holds the zoom chip, Grid, the tools and the GM tools for the GM: eight cells, no zoom buttons', () => {
    render(<MapCanvas />);
    expect(cells()).toEqual(['Fit map', 'Grid', 'Measure', 'Spell area', 'Ping', 'Draw', 'Spirit Layer', 'GM tools']);
    // The chip shows the zoom; pinching zooms.
    expect(within(rail()).getByRole('button', { name: 'Fit map' })).toHaveTextContent('%');
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });

  it('holds six cells for a player who may draw', () => {
    h.set({ userRole: 'PLAYER' });
    render(<MapCanvas />);
    expect(cells()).toEqual(['Fit map', 'Grid', 'Measure', 'Spell area', 'Ping', 'Draw']);
  });

  it('is centred on the map shown above the dock, and gives way when the dock covers the map', () => {
    render(<MapCanvas />);
    expect(rail().parentElement).toHaveStyle({ bottom: '0px' });
    expect(classesOf(rail().parentElement!)).toEqual(expect.arrayContaining(['absolute', 'top-0', 'items-center']));
    // jsdom lays nothing out, so any dock covers the whole of its map.
    act(() => { useTableChrome.setState({ mapCover: 338 }); });
    expect(screen.queryByRole('navigation', { name: 'Map tools' })).toBeNull();
    act(() => { useTableChrome.setState({ mapCover: 0 }); });
    expect(rail()).toBeInTheDocument();
  });

  it('opens the grid popover beside its cell', () => {
    render(<MapCanvas />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Grid' }));
    expect(screen.getByRole('group', { name: 'Grid' })).toBeInTheDocument();
  });
});

describe('the dock at the map’s foot', () => {
  const dock = () => document.querySelector<HTMLElement>('[data-map-dock]')!;

  it('stands above an open dock', () => {
    render(<MapCanvas />);
    act(() => { useTableChrome.setState({ mapCover: 200 }); });
    expect(dock()).toHaveStyle({ bottom: '200px' });
    act(() => { useTableChrome.setState({ mapCover: 0 }); });
  });

  it('shows the details card a tap shows at the map’s bottom left, as wide as its content', () => {
    h.set({ userRole: 'PLAYER' });
    render(<MapCanvas />);
    act(() => { useGameStore.getState().setTokens([token('tok-goblin', 'Goblin', 4, 15)]); });
    tap(1, square(4, 15));
    const card = screen.getByText('Goblin').closest('.absolute') as HTMLElement;
    expect(classesOf(card)).toEqual(expect.arrayContaining(['bottom-2', 'left-2', 'w-max']));
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByText('Goblin')).toBeNull();
  });
});

describe('the Draw strip', () => {
  const dock = () => document.querySelector<HTMLElement>('[data-map-dock]')!;
  const drawingTools = () => screen.getByRole('region', { name: 'Drawing tools' });

  it('opens across the map’s foot, last in the dock, and not in the GM’s tool stack', () => {
    render(<MapCanvas />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Draw' }));
    expect(dock().firstElementChild!.lastElementChild).toBe(drawingTools());
    expect(screen.queryByRole('region', { name: 'GM tools' })).toBeNull();
  });
});

describe('the GM tools strip behind GM tools', () => {
  const dock = () => document.querySelector<HTMLElement>('[data-map-dock]')!;
  const strip = () => screen.queryByRole('region', { name: 'GM tools' });

  it('starts away and shows in the dock on the GM tools cell, which puts it away again', () => {
    render(<MapCanvas />);
    expect(strip()).toBeNull();
    fireEvent.click(within(rail()).getByRole('button', { name: 'GM tools' }));
    expect(dock()).toContainElement(strip());
    expect(within(strip()!).getByRole('tab', { name: 'Fog' })).toBeInTheDocument();
    fireEvent.click(within(rail()).getByRole('button', { name: 'GM tools' }));
    expect(strip()).toBeNull();
  });

  it('takes turns with the Draw strip', () => {
    render(<MapCanvas />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'GM tools' }));
    fireEvent.click(within(rail()).getByRole('button', { name: 'Draw' }));
    expect(strip()).toBeNull();
    expect(screen.getByRole('region', { name: 'Drawing tools' })).toBeInTheDocument();
  });
});
