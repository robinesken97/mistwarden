/**
 * The wide campaign page on a touch screen: its tabs and its top bar's
 * buttons are big enough for a finger.
 *
 * A tab is 56 pixels tall for everyone; the bar's buttons and the panel's
 * Fold button are 40 with a mouse and 44, the size a finger needs, where the
 * primary pointer is coarse. jsdom lays nothing out and does not answer the
 * pointer query, so what is checked is the classes the page asks for.
 */

import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The page subscribes to many socket events; each method is a harmless stub.
const anySocket = vi.hoisted(() => new Proxy({}, { get: () => () => undefined }));

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dm', displayName: 'GM' } }) }));
vi.mock('@/contexts/CampaignContext', () => ({
  CampaignProvider: ({ children }: { children?: unknown }) => <>{children as never}</>,
  useCampaign: () => ({
    campaign: { id: 'campaign-1', name: 'Test', status: 'ACTIVE', ownerId: 'dm', memberships: [], characters: [] },
    currentMap: { id: 'map-1', name: 'Map', tokens: [] },
    viewedMap: { id: 'map-1', name: 'Map', tokens: [] },
    loading: false,
    error: null,
    userRole: 'GM',
    updateCampaignStatus: vi.fn(),
    setActiveSession: vi.fn(),
    refreshCurrentMap: vi.fn(),
    catchUpAfterReconnect: vi.fn(),
  }),
}));
vi.mock('@/contexts/WebSocketContext', () => ({
  WebSocketProvider: ({ children }: { children?: unknown }) => <>{children as never}</>,
  useWebSocket: () => ({ socket: anySocket, joinedEpoch: 1, status: 'connected' }),
}));
vi.mock('@/hooks/useInitiativeSync', () => ({ useInitiativeSync: () => undefined }));
vi.mock('@/hooks/useOnRejoin', () => ({ useOnRejoin: () => undefined }));
vi.mock('@/hooks/useAccessRevoked', () => ({ useAccessRevoked: () => undefined }));
// The bar asks the server's settings whether to offer AI writing help: here it does not.
vi.mock('@/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/queries')>()),
  useServerConfigQuery: () => ({ data: { ai: { enabled: false } } }),
}));

const nothing = vi.hoisted(() => () => ({ default: () => null }));
// The banner over a map being prepared: none here, no map is.
vi.mock('@/components/campaign/PreparingBanner', nothing);
vi.mock('@/components/campaign/CampaignInfo', () => ({ default: () => null, InvitePlayerButton: () => null }));
vi.mock('@/components/campaign/CampaignRoster', nothing);
vi.mock('@/components/campaign/MapManager', nothing);
vi.mock('@/components/campaign/TokenManager', nothing);
vi.mock('@/components/campaign/SpiritLayerControls', nothing);
vi.mock('@/components/campaign/AtmospherePanel', nothing);
vi.mock('@/components/campaign/AtmospherePlayer', nothing);
vi.mock('@/components/campaign/TableRefusals', nothing);
vi.mock('@/components/campaign/CreatureLibrary', nothing);
vi.mock('@/components/campaign/TokenTemplateLibrary', nothing);
vi.mock('@/components/campaign/CampaignSettingsModal', nothing);
vi.mock('@/components/documents/CampaignDocumentsModal', nothing);
vi.mock('@/components/campaign/SessionPanels', nothing);
vi.mock('@/components/campaign/SessionToolbar', nothing);
vi.mock('@/components/ConnectionStatus', nothing);
vi.mock('@/components/campaign/MapCanvas', nothing);

vi.mock('@/components/campaign/TokenRoster', nothing);
vi.mock('@/components/campaign/NpcQuickEditor', nothing);

import CampaignPage from '../CampaignPage';

beforeEach(() => {
  window.localStorage.clear();
});

const classes = (el: HTMLElement) => el.className.split(/\s+/);

it('gives the tabs 56 pixels and the bar a finger its 44 and a mouse its 40', () => {
  render(<CampaignPage />);

  const tabs = within(screen.getByRole('tablist', { name: 'Panels' })).getAllByRole('tab');
  expect(tabs.length).toBeGreaterThan(0);
  for (const tab of tabs) expect(classes(tab)).toContain('h-14');

  for (const name of ['Dashboard', 'Library', 'More']) {
    expect(classes(screen.getByRole('button', { name })), name).toEqual(expect.arrayContaining(['h-10', 'pointer-coarse:h-11']));
  }
  expect(classes(screen.getByRole('button', { name: 'Fold panel', hidden: true })))
    .toEqual(expect.arrayContaining(['size-10', 'pointer-coarse:size-11']));
});
