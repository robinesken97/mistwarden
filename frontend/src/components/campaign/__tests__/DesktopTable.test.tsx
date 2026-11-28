/**
 * The wide arrangement on its own: the tab column and its panel, which folds
 * and remembers the choice; the top bar's Library and ⋯ lists by role; the
 * AI button; and the connection status, shown only while not connected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import DesktopTable from '../DesktopTable';
import { TableHosts } from '../tableHosts';
import { AI_WRITE_EVENT } from '../AiWriteDialog';
import { WIDE_PANEL_OPEN_QUERY } from '@/constants/layout';
import { useGameStore } from '@/stores/gameStore';
import type { Campaign } from '@/types';

const state = vi.hoisted(() => ({
  role: 'GM' as string | null,
  status: 'connected',
  ai: false,
  leavePage: (() => undefined) as (to: string) => void,
  infoProps: [] as Array<{ onLeft?: unknown }>,
}));

vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({ userRole: state.role }) }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ status: state.status }) }));
vi.mock('@/hooks/queries', () => ({ useServerConfigQuery: () => ({ data: { ai: { enabled: state.ai } } }) }));
vi.mock('@/hooks/useLeaveGuard', () => ({ useLeavePage: () => state.leavePage }));
vi.mock('@/components/ConnectionStatus', () => ({ default: () => <div>Connection status</div> }));
vi.mock('@/components/campaign/CampaignInfo', () => ({
  default: (props: { onLeft?: unknown }) => { state.infoProps.push(props); return <div>Campaign info card</div>; },
}));
vi.mock('@/components/campaign/DisplaySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/campaign/DisplaySettings')>()),
  DisplaySettings: () => <div>Display settings</div>,
}));

const campaign = { id: 'campaign-1', name: 'Test', status: 'ACTIVE', ownerId: 'dm', memberships: [], characters: [] } as unknown as Campaign;

function stubWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query === WIDE_PANEL_OPEN_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderTable({ isOwner = false } = {}) {
  const props = {
    onOpenTool: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenSpells: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onLeft: vi.fn(),
  };
  render(
    <TableHosts parts={{ map: <div>Map part</div>, session: <div>Session part</div>, party: <div>Party part</div> }}>
      <DesktopTable campaign={campaign} isOwner={isOwner} {...props} />
    </TableHosts>,
  );
  return props;
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const selectedTabs = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true');
const panel = () => document.getElementById('wide-panel')!;
const folded = () => panel().hasAttribute('inert') && panel().className.split(/\s+/).includes('w-0');
const openList = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('group', { name });
};
const rowNames = (list: HTMLElement) => within(list).getAllByRole('button').map((b) => b.textContent);

beforeEach(() => {
  state.role = 'GM';
  state.status = 'connected';
  state.ai = false;
  state.infoProps.length = 0;
  window.localStorage.clear();
  useGameStore.getState().clearGameState();
  stubWidth(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the tabs and their panel', () => {
  it('starts folded below 1,280 px wide, with no tab selected', () => {
    renderTable();
    expect(screen.getAllByRole('tab').map((t) => t.textContent))
      .toEqual(['Chat', 'Dice', 'Initiative', 'Party', 'Notes', 'Gallery', 'Table']);
    expect(selectedTabs()).toHaveLength(0);
    expect(folded()).toBe(true);
  });

  it('starts open on the chosen tab from 1,280 px wide', () => {
    stubWidth(true);
    renderTable();
    expect(selectedTabs()).toEqual([tab('Chat')]);
    expect(folded()).toBe(false);
  });

  it('opens on a tab pressed, folds when it is pressed again, and shows Party in its own slot', () => {
    renderTable();
    fireEvent.click(tab('Dice'));
    expect(selectedTabs()).toEqual([tab('Dice')]);
    expect(folded()).toBe(false);
    expect(useGameStore.getState().sessionTab).toBe('dice');
    expect(useGameStore.getState().sessionShown).toBe(true);

    fireEvent.click(tab('Dice'));
    expect(selectedTabs()).toHaveLength(0);
    expect(folded()).toBe(true);
    // Folded, what arrives in the chat counts as unread.
    expect(useGameStore.getState().sessionShown).toBe(false);

    fireEvent.click(tab('Party'));
    expect(selectedTabs()).toEqual([tab('Party')]);
    const partySlot = screen.getByText('Party part').closest('[role="tabpanel"]')!;
    expect(partySlot.className.split(/\s+/)).not.toContain('invisible');
    expect(screen.getByText('Session part').closest('.absolute')!.className.split(/\s+/)).toContain('invisible');
    expect(useGameStore.getState().sessionShown).toBe(false);
  });

  it('folds on the panel’s Fold button, and keeps the choice for the next visit', () => {
    stubWidth(true);
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Fold panel' }));
    expect(folded()).toBe(true);

    cleanup();
    renderTable();
    expect(folded()).toBe(true);

    fireEvent.click(tab('Notes'));
    cleanup();
    stubWidth(false);
    renderTable();
    expect(selectedTabs()).toEqual([tab('Notes')]);
  });
});

describe('the Library list', () => {
  it("gives the GM the table's libraries, then Spells and Documents", () => {
    const props = renderTable();
    const list = openList('Library');
    expect(rowNames(list)).toEqual(['Scenes', 'Tokens', 'Creatures', 'Token Templates', 'Spells', 'Documents']);
    // The separator stands between the GM's rows and everyone's.
    const separator = within(list).getByRole('separator');
    expect(separator.previousElementSibling).toBe(within(list).getByRole('button', { name: 'Token Templates' }));

    fireEvent.click(within(list).getByRole('button', { name: 'Creatures' }));
    expect(props.onOpenTool).toHaveBeenCalledWith('creatures');
    expect(screen.queryByRole('group', { name: 'Library' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Library' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives a player Spells and Documents only, each opening its window', () => {
    state.role = 'PLAYER';
    const props = renderTable();
    const list = openList('Library');
    expect(rowNames(list)).toEqual(['Spells', 'Documents']);
    expect(within(list).queryByRole('separator')).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: 'Spells' }));
    expect(props.onOpenSpells).toHaveBeenCalledTimes(1);
    fireEvent.click(within(openList('Library')).getByRole('button', { name: 'Documents' }));
    expect(props.onOpenDocuments).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Library' })).toBeNull();
  });
});

describe('the ⋯ list', () => {
  const everyone = ['Keyboard shortcuts', 'Tour', 'Display on this device', 'Campaign info'];

  it("gives the GM Atmosphere and Campaign Settings first", () => {
    const props = renderTable();
    expect(rowNames(openList('More'))).toEqual(['Atmosphere', 'Campaign Settings', ...everyone]);
    fireEvent.click(screen.getByRole('button', { name: 'Atmosphere' }));
    expect(props.onOpenTool).toHaveBeenCalledWith('atmosphere');
    fireEvent.click(within(openList('More')).getByRole('button', { name: 'Campaign Settings' }));
    expect(props.onOpenTool).toHaveBeenCalledWith('settings');
    fireEvent.click(within(openList('More')).getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(props.onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("gives a player only everyone's rows", () => {
    state.role = 'PLAYER';
    renderTable();
    expect(rowNames(openList('More'))).toEqual(everyone);
  });

  it('gives an owner who is not running the table Owner Settings first', () => {
    state.role = 'PLAYER';
    const props = renderTable({ isOwner: true });
    expect(rowNames(openList('More'))).toEqual(['Owner Settings', ...everyone]);
    fireEvent.click(screen.getByRole('button', { name: 'Owner Settings' }));
    expect(props.onOpenTool).toHaveBeenCalledWith('settings');
  });

  it('opens Campaign info in a window, handing it the end-of-table handler', () => {
    const props = renderTable();
    fireEvent.click(within(openList('More')).getByRole('button', { name: 'Campaign info' }));
    expect(screen.queryByRole('group', { name: 'More' })).toBeNull();
    expect(within(screen.getByRole('dialog', { name: 'Campaign info' })).getByText('Campaign info card')).toBeTruthy();
    expect(state.infoProps.every((p) => p.onLeft === props.onLeft)).toBe(true);
  });

  it('shows Display on this device in the list’s place, with a way back, and stays open', () => {
    renderTable();
    fireEvent.click(within(openList('More')).getByRole('button', { name: 'Display on this device' }));
    const list = screen.getByRole('group', { name: 'More' });
    expect(within(list).getByText('Display settings')).toBeTruthy();
    expect(within(list).queryByRole('button', { name: 'Tour' })).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: 'Display on this device' }));
    expect(rowNames(screen.getByRole('group', { name: 'More' }))).toContain('Tour');
  });
});

describe('the AI button', () => {
  it.each([
    ['GM', true, 1],
    ['GM', false, 0],
    ['PLAYER', true, 0],
  ] as const)('is offered to %s with AI enabled %s: %d', (role, ai, count) => {
    state.role = role;
    state.ai = ai;
    renderTable();
    expect(screen.queryAllByRole('button', { name: 'AI writing help' })).toHaveLength(count);
  });

  it('asks for the AI writing window', () => {
    state.ai = true;
    const heard = vi.fn();
    window.addEventListener(AI_WRITE_EVENT, heard);
    try {
      renderTable();
      fireEvent.click(screen.getByRole('button', { name: 'AI writing help' }));
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(AI_WRITE_EVENT, heard);
    }
  });
});

describe('the top bar', () => {
  it.each([
    ['connected', false],
    ['connecting', true],
    ['disconnected', true],
  ] as const)('shows the connection status while %s: %s', (status, shown) => {
    state.status = status;
    renderTable();
    expect(screen.queryByText('Connection status') !== null).toBe(shown);
  });

  it('asks the page to leave for the dashboard', () => {
    const leave = vi.fn();
    state.leavePage = leave;
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(leave).toHaveBeenCalledWith('/dashboard');
  });
});
