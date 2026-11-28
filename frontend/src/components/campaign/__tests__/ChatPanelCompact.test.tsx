/**
 * The chat in the compact layout's Chat sheet.
 *
 * A half sheet on a phone is about 330 px tall. The panel's own header, a
 * two-line message box and the line about Enter and Shift+Enter took nearly
 * all of it, so the log had a sliver. On the compact layout the sheet's
 * heading names the chat, so the panel's heading is kept for screen readers
 * only, the box is one line to start with, with a placeholder that fits
 * it, and the hint about the keys is read out but not shown. The count of
 * messages shown and the GM's eraser go at the top of the log, beside Load
 * More, so no line above the log holds them, and the messages sit closer
 * together. The desktop is as it was.
 */

import { it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MessageType, type MessageHistoryPage } from '@/types';
import { LayoutProvider } from '@/contexts/LayoutContext';

vi.mock('react-router', () => ({ useParams: () => ({ id: 'campaign-1' }) }));
const seat = vi.hoisted(() => ({ role: 'PLAYER' }));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ userRole: seat.role, campaign: { id: 'campaign-1', status: 'ACTIVE', memberships: [], characters: [], chatCooldownEnabled: false } }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', displayName: 'Me' } }) }));
const socket = { onChatMessage: vi.fn(), onChatSystem: vi.fn(), off: vi.fn(), sendChatMessage: vi.fn() };
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket, joinedEpoch: 1 }) }));
const history = vi.hoisted(() => ({ page: { messages: [], pagination: { limit: 50, hasMore: false, nextCursor: null } } as MessageHistoryPage }));
vi.mock('@/services/message.service', () => ({ getMessages: async () => history.page }));
vi.mock('@/services/api', () => ({ api: {}, default: {} }));

import ChatPanel from '../ChatPanel';

async function open(compact: boolean) {
  render(<LayoutProvider compact={compact}><ChatPanel /></LayoutProvider>);
  return screen.findByRole('textbox', { name: 'Chat message' });
}

const classes = (el: Element) => el.className.split(/\s+/);

const KEYS = 'Press Enter to send, Shift+Enter for new line';

it('puts the recipient, a one-line box and a square Send on one row, the keys said by the box alone', async () => {
  const box = await open(true);
  expect(classes(screen.getByRole('heading', { name: 'Chat' }))).toContain('sr-only');
  expect(box).toHaveAttribute('rows', '1');
  // No hint line under the row: the box's title and description carry it.
  expect(screen.queryByText(KEYS)).toBeNull();
  expect(box).toHaveAttribute('title', KEYS);
  expect(box).toHaveAttribute('aria-description', KEYS);
  expect(box).toHaveAttribute('placeholder', 'Type a message…');
  // No "To" label: the list is named Send to; 128 px, Everyone whole beside its chevron.
  const toList = screen.getByRole('combobox', { name: 'Send to' });
  expect(classes(toList)).toContain('w-32');
  const send = screen.getByRole('button', { name: 'Send message' });
  // Square, as tall as the box's one line: 40 px, 44 on a touch screen.
  expect(classes(send)).toEqual(expect.arrayContaining(['size-10', 'pointer-coarse:size-11']));
  expect(classes(box)).toContain('min-h-10');
  expect(toList.parentElement).toBe(box.parentElement);
  expect(box.parentElement).toContainElement(send);
});

it('puts the count and the GM\'s eraser at the top of the log on the compact layout, beside Load More', async () => {
  seat.role = 'GM';
  history.page = {
    messages: [{ id: 'm1', campaignId: 'campaign-1', userId: 'u2', user: { id: 'u2', displayName: 'Cass' }, type: MessageType.PLAYER, content: 'lol', metadata: null, createdAt: '2026-10-31T23:18:00Z' }],
    pagination: { limit: 50, hasMore: true, nextCursor: 'older' },
  };
  try {
    await open(true);
    // No line above the log, and no card inside the panel: its heading is all there is of it.
    expect(screen.getByRole('heading', { name: 'Chat' }).parentElement).not.toHaveClass('glass-panel');
    const log = screen.getByRole('log', { name: 'Chat messages' });
    expect(classes(log)).toEqual(expect.arrayContaining(['px-2', 'py-1.5', 'space-y-1.5']));
    expect(classes(log)).not.toContain('p-4');
    const top = await within(log).findByText('1 shown');
    const row = top.parentElement!;
    expect(row).toBe(log.firstElementChild);
    expect(within(row).getByRole('button', { name: 'Load More' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Clear old join and leave messages' })).toBeTruthy();
  } finally {
    seat.role = 'PLAYER';
    history.page = { messages: [], pagination: { limit: 50, hasMore: false, nextCursor: null } };
  }
});

it('keeps the box, its draft and its focus as the arrangement changes', async () => {
  const { rerender } = render(<LayoutProvider compact={false}><ChatPanel /></LayoutProvider>);
  const box = await screen.findByRole('textbox', { name: 'Chat message' });
  fireEvent.change(box, { target: { value: 'draft' } });
  box.focus();
  for (const compact of [true, false, true]) {
    rerender(<LayoutProvider compact={compact}><ChatPanel /></LayoutProvider>);
    expect(screen.getByRole('textbox', { name: 'Chat message' })).toBe(box);
    expect(document.activeElement).toBe(box);
  }
  expect(box).toHaveValue('draft');
});

it('lays the composer out the same on the desktop, under a heading of its own outside the table', async () => {
  const box = await open(false);
  expect(classes(screen.getByRole('heading', { name: 'Chat' }))).not.toContain('sr-only');
  expect(box).toHaveAttribute('rows', '1');
  expect(screen.queryByText(KEYS)).toBeNull();
  expect(box).toHaveAttribute('placeholder', 'Type a message…');
  expect(screen.getByRole('combobox', { name: 'Send to' }).parentElement).toBe(box.parentElement);
  expect(classes(screen.getByRole('log', { name: 'Chat messages' }))).toEqual(expect.arrayContaining(['p-4', 'space-y-3']));
  expect(classes(screen.getByRole('heading', { name: 'Chat' }).parentElement!)).toContain('p-4');
});
