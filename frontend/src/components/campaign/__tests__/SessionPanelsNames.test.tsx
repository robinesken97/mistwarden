/**
 * What each session panel is: on every layout a tab panel named by its tab,
 * in the column, the dock or the top bar.
 */

import { it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

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

import SessionPanels from '../SessionPanels';
import { LayoutProvider } from '@/contexts/LayoutContext';

const PANELS = ['chat', 'dice', 'initiative', 'notes', 'gallery', 'session'];

it('names each panel by its tab on the desktop', () => {
  const { container } = render(<SessionPanels />);
  const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));
  expect(panels.map((p) => p.getAttribute('aria-labelledby'))).toEqual(PANELS.map((tab) => `session-tab-${tab}`));
  expect(panels.every((p) => !p.hasAttribute('aria-label'))).toBe(true);
});

it('names each panel by its tab on the compact layout too, whose dock has the same tabs', () => {
  const { container } = render(<LayoutProvider compact><SessionPanels /></LayoutProvider>);
  const panels = Array.from(container.querySelectorAll('[role="tabpanel"]'));
  expect(panels.map((p) => p.getAttribute('aria-labelledby'))).toEqual(PANELS.map((tab) => `session-tab-${tab}`));
});

it('clips each panel to its box, so a panel taller than the compact sheet, shown or not, never makes the sheet scroll', () => {
  render(<LayoutProvider compact><SessionPanels /></LayoutProvider>);
  const panels = PANELS.map((tab) => document.getElementById(`session-tabpanel-${tab}`) as HTMLElement);
  for (const panel of panels) {
    const classes = panel.className.split(/\s+/);
    expect(classes, panel.id).toContain('absolute');
    // Exactly one: clipped (Chat, Dice, Notes scroll inside) or scrolling as a whole (Initiative, Gallery, Session).
    expect(classes.filter((c) => c === 'overflow-hidden' || c === 'overflow-y-auto'), panel.id).toHaveLength(1);
  }
});
