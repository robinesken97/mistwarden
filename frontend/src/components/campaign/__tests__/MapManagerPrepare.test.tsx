/**
 * Opening a scene to prepare from the Scenes panel.
 *
 * Every card but the active scene's offers Open to prepare, which shows that
 * scene on the GM's screen only; a sheet over the map (compact) makes way,
 * the panel beside it stays. The card of the scene being prepared says
 * Preparing and offers Back to the table. Set active and deleting
 * the map on screen ask whatever holds that map (an editor with unsaved
 * work) first.
 */

import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AxiosAdapter, AxiosInstance, AxiosResponse } from 'axios';
import MapManager from '../MapManager';
import { api } from '@/services/api';

const h = vi.hoisted(() => ({
  preparing: null as string | null,
  mayChange: true,
  openToPrepare: vi.fn(),
  backToTable: vi.fn(),
  removeCampaignMap: vi.fn(),
  asked: vi.fn(),
  compact: false,
}));

vi.mock('framer-motion', () => {
  const MotionDiv = (props: Record<string, unknown>) => {
    const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
    const plain = Object.fromEntries(Object.entries(rest).filter(([k]) => !/^(initial|animate|exit|transition|layout|whileHover|whileTap)$/.test(k)));
    return <div {...(plain as Record<string, unknown>)}>{children as never}</div>;
  };
  return {
    useReducedMotionConfig: () => false,
    useIsPresent: () => true,
    motion: new Proxy({}, { get: () => MotionDiv }),
    AnimatePresence: ({ children }: { children?: unknown }) => <>{children as never}</>,
  };
});
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    campaign: { id: 'campaign-1', name: 'The Hollow Crown', currentMapId: 'village' },
    currentMap: { id: 'village', name: 'Village', tokens: [] },
    viewedMap: h.preparing ? { id: h.preparing, name: h.preparing, tokens: [] } : { id: 'village', name: 'Village', tokens: [] },
    isPreparing: h.preparing !== null,
    setCurrentMap: () => {},
    updateMap: () => {},
    showTableMap: () => {},
    openToPrepare: h.openToPrepare,
    backToTable: h.backToTable,
    mayChangeViewedMap: (change: unknown) => { h.asked(change); return Promise.resolve(h.mayChange); },
    upsertCampaignMap: () => {},
    removeCampaignMap: h.removeCampaignMap,
  }),
}));
vi.mock('@/contexts/LayoutContext', () => ({ useCompactLayout: () => h.compact, useTableLayout: () => (h.compact ? 'phone' : 'wide') }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket: null }) }));
vi.mock('@/components/assets/AssetPicker', () => ({ default: () => null }));

const client = (api as unknown as { client: AxiosInstance }).client;
const map = (id: string, name: string) => ({ id, campaignId: 'campaign-1', name, imageUrl: '', width: 10, height: 10, gridSize: 50, tokens: [] });
const requests: string[] = [];
const network: AxiosAdapter = (config) => {
  requests.push(`${config.method} ${config.url}`);
  const answer = (data: unknown) => Promise.resolve({ data, status: 200, statusText: '', headers: {}, config } as AxiosResponse);
  if (config.method === 'get' && config.url === '/api/campaigns/campaign-1/maps') {
    return answer({ maps: [map('village', 'Village'), map('crypt', 'Crypt'), map('tower', 'Tower')] });
  }
  if (config.method === 'get') return answer({ map: map('village', 'Village') });
  return answer({ message: 'ok' });
};

let browserAdapter: typeof client.defaults.adapter;
beforeEach(() => {
  h.preparing = null;
  h.mayChange = true;
  h.openToPrepare.mockReset().mockResolvedValue(true);
  h.backToTable.mockReset().mockResolvedValue(true);
  h.compact = false;
  h.removeCampaignMap.mockReset();
  h.asked.mockReset();
  requests.length = 0;
  browserAdapter = client.defaults.adapter;
  client.defaults.adapter = network;
});
afterEach(() => {
  client.defaults.adapter = browserAdapter;
});

/** A map's card, found by its name. */
const card = async (name: string) => (await screen.findByRole('heading', { name })).closest('div.rounded-xl') as HTMLElement;
/** Presses Delete… in a scene's ⋯ menu. */
const deleteFromMenu = async (name: string) => {
  fireEvent.click(within(await card(name)).getByRole('button', { name: `More for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
};

describe('Open to prepare', () => {
  it('is offered on every card but the active one', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    expect(within(await card('Village')).queryByRole('button', { name: /Open to prepare/ })).toBeNull();
    expect(within(await card('Crypt')).getByRole('button', { name: /Open to prepare/ })).toBeEnabled();
    expect(within(await card('Tower')).getByRole('button', { name: /Open to prepare/ })).toBeEnabled();
  });

  it('opens the map on this page, and the panel beside it stays open', async () => {
    const onClose = vi.fn();
    render(<MapManager isOpen onClose={onClose} />);
    const target = await card('Crypt');
    await act(async () => { fireEvent.click(within(target).getByRole('button', { name: /Open to prepare/ })); });
    expect(h.openToPrepare).toHaveBeenCalledWith('crypt');
    expect(onClose).not.toHaveBeenCalled();
    expect(requests.filter((r) => r.startsWith('put'))).toEqual([]);
  });

  it('closes the sheet over the map on a compact layout', async () => {
    h.compact = true;
    const onClose = vi.fn();
    render(<MapManager isOpen onClose={onClose} />);
    const target = await card('Crypt');
    await act(async () => { fireEvent.click(within(target).getByRole('button', { name: /Open to prepare/ })); });
    expect(h.openToPrepare).toHaveBeenCalledWith('crypt');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says why when the map cannot be opened, and stays open', async () => {
    h.openToPrepare.mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { message: 'Map not found' } } });
    const onClose = vi.fn();
    render(<MapManager isOpen onClose={onClose} />);
    const target = await card('Crypt');
    await act(async () => { fireEvent.click(within(target).getByRole('button', { name: /Open to prepare/ })); });
    expect(await screen.findByText('Map not found')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks the map being prepared', async () => {
    h.preparing = 'crypt';
    render(<MapManager isOpen onClose={() => {}} />);
    const crypt = await card('Crypt');
    expect(within(crypt).getByText('Preparing')).toBeInTheDocument();
    expect(within(crypt).queryByRole('button', { name: /Open to prepare/ })).toBeNull();
    await act(async () => { fireEvent.click(within(crypt).getByRole('button', { name: 'Back to the table' })); });
    expect(h.backToTable).toHaveBeenCalledTimes(1);
  });
});

describe('something holding the map on screen', () => {
  beforeEach(() => { h.mayChange = false; });

  it('stops Set Active', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    const target = await card('Tower');
    await act(async () => { fireEvent.click(within(target).getByRole('button', { name: /Set active/ })); });
    // The tokens to bring are read and offered; the table does not move.
    expect(requests.filter((r) => r.includes('/set-current') || r.includes('/tokens/move'))).toEqual([]);
  });

  it('is told the map on screen is about to be deleted', async () => {
    h.preparing = 'crypt';
    render(<MapManager isOpen onClose={() => {}} />);
    await deleteFromMenu('Crypt');
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete scene' })).getByRole('button', { name: 'Delete' })); });
    expect(h.asked).toHaveBeenCalledWith({ kind: 'delete', toMapId: 'village' });
  });

  it('stops deleting the map being prepared', async () => {
    h.preparing = 'crypt';
    render(<MapManager isOpen onClose={() => {}} />);
    await deleteFromMenu('Crypt');
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete scene' })).getByRole('button', { name: 'Delete' })); });
    expect(requests.filter((r) => r.startsWith('delete'))).toEqual([]);
    expect(h.removeCampaignMap).not.toHaveBeenCalled();
  });

  it('still lets another map be deleted', async () => {
    h.preparing = 'crypt';
    render(<MapManager isOpen onClose={() => {}} />);
    await deleteFromMenu('Tower');
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete scene' })).getByRole('button', { name: 'Delete' })); });
    expect(requests).toContain('delete /api/campaigns/campaign-1/maps/tower');
  });
});

describe("the card's action row", () => {
  it("is Set active and Open to prepare, in two columns, with a finger's size", async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    const open = within(await card('Crypt')).getByRole('button', { name: /Open to prepare/ });
    expect(open.className.split(/\s+/)).toContain('pointer-coarse:min-h-11');
    const row = open.parentElement as HTMLElement;
    expect(row.className.split(/\s+/)).toContain('grid-cols-2');
    expect(within(row).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Set active', 'Open to prepare']);
  });

  it('is not there on the active scene, and its ⋯ cannot delete it', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    const village = await card('Village');
    expect(within(village).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['More for Village']);
    fireEvent.click(within(village).getByRole('button', { name: 'More for Village' }));
    expect(screen.getByRole('menuitem', { name: 'Cannot delete the active scene' })).toBeDisabled();
  });
});
