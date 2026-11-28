/**
 * The session rail's tabs fit the rail.
 *
 * Five labelled tabs need about 400 pixels and the rail is often narrower,
 * so the last one, **Session**, was cut off at its edge. Below that width
 * only the open tab shows its label (a container query, which only a
 * browser can measure); the others keep their names for screen readers and
 * show them as a hover title. The open tab's label goes too in a rail too
 * narrow for it, which is wider where the other tabs are a finger's size:
 * on a tablet it was cut to "Sessio".
 */

import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const nothing = vi.hoisted(() => () => ({ default: () => null }));
vi.mock('@/contexts/WebSocketContext', () => ({ useWebSocket: () => ({ socket: null }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('../ChatPanel', nothing);
vi.mock('../DiceRoller', nothing);
vi.mock('../VibeTracker', nothing);
vi.mock('../InitiativeTracker', nothing);
vi.mock('../SessionControls', nothing);
vi.mock('../SessionHistory', nothing);
vi.mock('../PersonalNotes', nothing);
vi.mock('../GalleryPanel', nothing);

import SessionSidebar from '../SessionSidebar';

const label = (name: string) => screen.getByRole('tab', { name }).querySelector('span')!;
const plainSrOnly = /(^|\s)sr-only(\s|$)/;

it('names every tab, and shows only the open tab\'s label in a narrow rail', () => {
  render(<SessionSidebar />);

  for (const name of ['Chat', 'Dice', 'Initiative', 'Notes', 'Session']) {
    expect(screen.getByRole('tab', { name }).getAttribute('title')).toBe(name);
  }
  expect(label('Chat').className).not.toMatch(plainSrOnly);
  expect(label('Session').className).toMatch(plainSrOnly);

  fireEvent.click(screen.getByRole('tab', { name: 'Session' }));

  expect(label('Session').className).not.toMatch(plainSrOnly);
  expect(label('Chat').className).toMatch(plainSrOnly);
});

it("hides the open tab's label only in a rail too narrow for it, narrower for a mouse than a finger", () => {
  render(<SessionSidebar />);
  const open = screen.getByRole('tab', { selected: true }).querySelector('span')!;
  expect(open.className.split(' ')).toEqual(['@max-[19rem]:sr-only', 'pointer-coarse:@max-[23rem]:sr-only']);
});
