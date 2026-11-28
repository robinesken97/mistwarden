/**
 * The Scenes panel's copies: Duplicate… (always all three choices sent),
 * Save as template…, Use template and Create scene › From template, and the
 * Templates section. A copy of a scene and a scene from a template open to
 * prepare; a template's copy stays a template, never opened or made active.
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
const bodies: { url: string; body: unknown }[] = [];
const network: AxiosAdapter = (config) => {
  requests.push(`${config.method} ${config.url}`);
  const answer = (data: unknown) => Promise.resolve({ data, status: 200, statusText: '', headers: {}, config } as AxiosResponse);
  if (config.method === 'get' && config.url === '/api/campaigns/campaign-1/maps') {
    return answer({ maps: [map('village', 'Village'), map('crypt', 'Crypt'), { ...map('ambush', 'Ambush'), isTemplate: true }] });
  }
  if (config.method === 'post') {
    bodies.push({ url: config.url ?? '', body: JSON.parse(String(config.data ?? '{}')) });
    const template = config.url?.endsWith('/save-as-template') || config.url?.includes('/ambush/duplicate');
    return answer({ map: { ...map(`copy-${bodies.length}`, `Copy ${bodies.length}`), isTemplate: template } });
  }
  if (config.method === 'get') return answer({ map: map('village', 'Village') });
  return answer({ message: 'ok' });
};

let browserAdapter: typeof client.defaults.adapter;
beforeEach(() => {
  h.preparing = null;
  h.openToPrepare.mockReset().mockResolvedValue(true);
  h.compact = false;
  requests.length = 0;
  bodies.length = 0;
  window.localStorage.clear();
  browserAdapter = client.defaults.adapter;
  client.defaults.adapter = network;
});
afterEach(() => {
  client.defaults.adapter = browserAdapter;
});

const card = async (name: string) => (await screen.findByRole('heading', { name })).closest('div.rounded-xl') as HTMLElement;
const menuRow = async (name: string, row: string) => {
  fireEvent.click(within(await card(name)).getByRole('button', { name: `More for ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: row }));
};

describe('Duplicate scene', () => {
  it('starts as a full copy named "(copy)" and sends all three choices, then opens the copy to prepare', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    await menuRow('Crypt', 'Duplicate…');
    const dialog = screen.getByRole('dialog', { name: 'Duplicate scene' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Crypt (copy)');
    for (const group of ['Tokens', 'Fog', 'Drawings']) {
      expect(within(within(dialog).getByRole('radiogroup', { name: group })).getByRole('radio', { name: 'Copy' })).toBeChecked();
    }
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate and open to prepare' })); });
    expect(bodies).toEqual([{ url: '/api/campaigns/campaign-1/maps/crypt/duplicate', body: { name: 'Crypt (copy)', tokens: true, fog: true, drawings: true } }]);
    expect(h.openToPrepare).toHaveBeenCalledWith('copy-1');
    expect(screen.queryByRole('dialog', { name: 'Duplicate scene' })).toBeNull();
  });

  it('sends false for each part left out, and the name as typed', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    await menuRow('Crypt', 'Duplicate…');
    const dialog = screen.getByRole('dialog', { name: 'Duplicate scene' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Crypt, flooded ' } });
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Tokens' })).getByRole('radio', { name: 'Leave out' }));
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Fog' })).getByRole('radio', { name: 'Reset' }));
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Drawings' })).getByRole('radio', { name: 'Leave out' }));
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate and open to prepare' })); });
    expect(bodies[0].body).toEqual({ name: 'Crypt, flooded', tokens: false, fog: false, drawings: false });
  });

  it('keeps a template\'s copy a template, in its list, and opens nothing', async () => {
    window.localStorage.setItem('mistwarden.sceneTemplates', 'open');
    render(<MapManager isOpen onClose={() => {}} />);
    await menuRow('Ambush', 'Duplicate…');
    const dialog = screen.getByRole('dialog', { name: 'Duplicate template' });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' })); });
    expect(bodies[0]).toEqual({ url: '/api/campaigns/campaign-1/maps/ambush/duplicate', body: { name: 'Ambush (copy)', tokens: true, fog: true, drawings: true } });
    expect(h.openToPrepare).not.toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'Templates' })).getByRole('heading', { name: 'Copy 1' })).toBeInTheDocument();
  });
});

describe('Templates', () => {
  it('Save as template… keeps the scene\'s name, sends all three choices and shows the template, folded section opened', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    expect(await screen.findByText('Templates (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show templates' })).toHaveAttribute('aria-expanded', 'false');
    await menuRow('Crypt', 'Save as template…');
    const dialog = screen.getByRole('dialog', { name: 'Save as template' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Crypt');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save as template' })); });
    expect(bodies[0]).toEqual({ url: '/api/campaigns/campaign-1/maps/crypt/save-as-template', body: { name: 'Crypt', tokens: true, fog: true, drawings: true } });
    expect(h.openToPrepare).not.toHaveBeenCalled();
    const templates = screen.getByRole('region', { name: 'Templates' });
    expect(within(templates).getByRole('heading', { name: 'Copy 1' })).toBeInTheDocument();
    expect(screen.getByText('Templates (2)')).toBeInTheDocument();
    expect(window.localStorage.getItem('mistwarden.sceneTemplates')).toBe('open');
  });

  it('shows a template with its badge, Use template alone and no Set active, and says it never reaches players', async () => {
    window.localStorage.setItem('mistwarden.sceneTemplates', 'open');
    render(<MapManager isOpen onClose={() => {}} />);
    const ambush = await card('Ambush');
    expect(within(ambush).getByText('Template')).toBeInTheDocument();
    expect(within(ambush).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['More for Ambush', 'Use template']);
    expect(screen.getByText('Templates are never active and never reach players.')).toBeInTheDocument();
    // The scenes list holds no template.
    expect(screen.getByLabelText('2 scenes')).toBeInTheDocument();
  });

  it('Use template makes a fresh scene from it, sending no name, and opens it to prepare', async () => {
    window.localStorage.setItem('mistwarden.sceneTemplates', 'open');
    render(<MapManager isOpen onClose={() => {}} />);
    const ambush = await card('Ambush');
    await act(async () => { fireEvent.click(within(ambush).getByRole('button', { name: 'Use template' })); });
    expect(bodies).toEqual([{ url: '/api/campaigns/campaign-1/maps/ambush/create-from-template', body: {} }]);
    expect(h.openToPrepare).toHaveBeenCalledWith('copy-1');
    expect(requests.filter((r) => r.startsWith('put'))).toEqual([]);
  });

  it('folds and opens, and the choice is kept for the next visit', async () => {
    const { unmount } = render(<MapManager isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show templates' }));
    expect(await card('Ambush')).toBeInTheDocument();
    unmount();
    render(<MapManager isOpen onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Fold templates' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Create scene', () => {
  it('offers Blank scene, From a map picture and From template, whose list makes a scene from the one chosen', async () => {
    render(<MapManager isOpen onClose={() => {}} />);
    await card('Crypt');
    fireEvent.click(screen.getByRole('button', { name: 'Create scene' }));
    const menu = screen.getByRole('menu', { name: 'Create scene' });
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Blank scene', 'From a map picture', 'From template']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'From template' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('menu', { name: 'From template' })).getByRole('menuitem', { name: 'Ambush' })); });
    expect(bodies).toEqual([{ url: '/api/campaigns/campaign-1/maps/ambush/create-from-template', body: {} }]);
    expect(h.openToPrepare).toHaveBeenCalledWith('copy-1');
  });

  it('says No templates yet, disabled, when the campaign has none', async () => {
    client.defaults.adapter = (config) => (config.method === 'get' && config.url === '/api/campaigns/campaign-1/maps'
      ? Promise.resolve({ data: { maps: [map('village', 'Village')] }, status: 200, statusText: '', headers: {}, config } as AxiosResponse)
      : network(config));
    render(<MapManager isOpen onClose={() => {}} />);
    await card('Village');
    fireEvent.click(screen.getByRole('button', { name: 'Create scene' }));
    expect(screen.getByRole('menuitem', { name: 'No templates yet' })).toBeDisabled();
  });
});
