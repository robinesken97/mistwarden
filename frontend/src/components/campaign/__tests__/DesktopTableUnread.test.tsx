/**
 * The tab column's Chat badge, with the real session panels (whose listener
 * keeps the count) moved into the wide panel.
 *
 * The count is of every `chat.message` from someone else that arrives while
 * the chat is not on screen. The server sends a whisper only to its two
 * people, so a whisper to you counts like any other message. The open tab
 * and the count are the game store's, so a table drawn again shows both.
 */

import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MessageType } from '@/types';
import type { Campaign, ChatMessageBroadcast } from '@/types';
import DesktopTable from '../DesktopTable';
import SessionPanels from '../SessionPanels';
import { TableHosts } from '../tableHosts';
import { useGameStore } from '@/stores/gameStore';

const nothing = vi.hoisted(() => () => ({ default: () => null }));
const listeners = vi.hoisted(() => new Set<(data: ChatMessageBroadcast) => void>());
const socket = vi.hoisted(() => ({
  onChatMessage: (fn: (data: ChatMessageBroadcast) => void) => { listeners.add(fn); },
  off: (_event: string, fn: (data: ChatMessageBroadcast) => void) => { listeners.delete(fn); },
}));

vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({ userRole: 'PLAYER' }) }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ status: 'connected', socket }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/hooks/queries', () => ({ useServerConfigQuery: () => ({ data: { ai: { enabled: false } } }) }));
vi.mock('@/hooks/useLeaveGuard', () => ({ useLeavePage: () => () => undefined }));
vi.mock('@/components/ConnectionStatus', nothing);
vi.mock('@/components/campaign/CampaignInfo', nothing);
vi.mock('../ChatPanel', nothing);
vi.mock('../DiceRoller', nothing);
vi.mock('../VibeTracker', nothing);
vi.mock('../InitiativeTracker', nothing);
vi.mock('../SessionControls', nothing);
vi.mock('../SessionHistory', nothing);
vi.mock('../PersonalNotes', nothing);
vi.mock('../GalleryPanel', nothing);

const campaign = { id: 'campaign-1', name: 'Test', status: 'ACTIVE', ownerId: 'dm', memberships: [], characters: [] } as unknown as Campaign;

const renderTable = () => render(
  <TableHosts parts={{ map: <div />, session: <SessionPanels />, party: <div /> }}>
    <DesktopTable
      campaign={campaign}
      isOwner={false}
      onOpenTool={vi.fn()}
      onOpenDocuments={vi.fn()}
      onOpenSpells={vi.fn()}
      onOpenShortcuts={vi.fn()}
      onLeft={vi.fn()}
    />
  </TableHosts>,
);

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const message = (id: string, from: string, extra: Partial<ChatMessageBroadcast> = {}): ChatMessageBroadcast => ({
  id, userId: from, userName: from, content: 'Hi', type: MessageType.PLAYER, timestamp: '2026-10-28T12:00:00.000Z', ...extra,
});
const deliver = (data: ChatMessageBroadcast) => act(() => listeners.forEach((fn) => fn(data)));

beforeEach(() => {
  window.localStorage.clear();
  useGameStore.getState().clearGameState();
});

afterEach(cleanup);

it('counts a whisper to you while another tab is open, and not one you sent', () => {
  renderTable();
  fireEvent.click(tab('Dice'));

  const whisper = { type: MessageType.WHISPER, content: 'Psst' };
  deliver(message('w-1', 'mara', { ...whisper, recipientId: 'me', recipientName: 'me' }));
  deliver(message('w-2', 'me', { ...whisper, recipientId: 'mara', recipientName: 'mara' }));

  expect(screen.getByLabelText('1 unread messages')).toBeTruthy();

  fireEvent.click(tab('Chat'));
  expect(screen.queryByLabelText(/unread messages/)).toBeNull();
});

it('opens on the tab that was open, with the unread count so far', () => {
  const first = renderTable();
  fireEvent.click(tab('Initiative'));
  deliver(message('m-1', 'mara'));
  deliver(message('m-2', 'mara'));
  first.unmount();
  expect(listeners.size).toBe(0);

  renderTable();

  expect(tab('Initiative').getAttribute('aria-selected')).toBe('true');
  expect(screen.getByLabelText('2 unread messages')).toBeTruthy();
  expect(listeners.size).toBe(1);
});
