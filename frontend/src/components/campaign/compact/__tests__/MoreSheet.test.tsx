/**
 * More on the compact layout: what the desktop's header and rail offer that
 * the bar does not, by who is looking, each row closing More and opening
 * what it names.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SessionToolbar from '@/components/campaign/SessionToolbar';

const seat = vi.hoisted(() => ({ role: 'GM' as string }));
vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => ({ userRole: seat.role }) }));

import MoreSheet from '../MoreSheet';
import { TOUR_START_EVENT } from '@/components/campaign/tour/tourSteps';

const onSheetEntry = () => (window.history.state as Record<string, unknown> | null)?.cozyvttSheet === true;

beforeEach(() => {
  seat.role = 'GM';
});

afterEach(async () => {
  cleanup();
  await waitFor(() => expect(onSheetEntry()).toBe(false));
});

function more({ isOwner = false } = {}) {
  const handlers = {
    onClose: vi.fn(),
    onOpenTool: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenPanel: vi.fn(),
  };
  render(<MoreSheet open isOwner={isOwner} {...handlers} />);
  return handlers;
}

/** Each group's heading and its rows, as the sheet shows them. */
function groups(): Array<[string, string[]]> {
  const sheet = screen.getByRole('dialog', { name: 'More' });
  return within(sheet).getAllByRole('group').map((group) => [
    within(group).getByRole('heading', { level: 3 }).textContent ?? '',
    within(group).queryAllByRole('button').map((row) => row.textContent ?? ''),
  ]);
}

const AT_THE_TABLE: [string, string[]] = ['At the table', ['Notes', 'Gallery', 'Session', 'Documents', 'Shortcuts', 'Tour']];
/** This device's display settings: two dropdowns, no rows. */
const DISPLAY: [string, string[]] = ['Display on this device', []];

describe('More', () => {
  it('is a modal sheet at full height, named More', () => {
    more();
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
  });

  it("offers the GM the table's panels and every tool of the header's toolbar, in its order", () => {
    more();
    render(<SessionToolbar openPanels={{}} onOpen={() => undefined} />);
    const toolbar = within(screen.getByRole('toolbar', { name: 'GM tools' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(toolbar).toHaveLength(7);
    expect(groups()).toEqual([AT_THE_TABLE, DISPLAY, ['GM tools', toolbar]]);
  });

  it('offers a player the table alone', () => {
    seat.role = 'PLAYER';
    more();
    expect(groups()).toEqual([AT_THE_TABLE, DISPLAY]);
  });

  it('offers an owner who is not the GM Owner Settings, as the desktop header does', () => {
    seat.role = 'PLAYER';
    more({ isOwner: true });
    expect(groups()).toEqual([AT_THE_TABLE, DISPLAY, ['Owner', ['Owner Settings']]]);
  });

  it('offers a GM who owns the campaign Campaign Settings, and no Owner Settings', () => {
    more({ isOwner: true });
    expect(screen.queryByRole('button', { name: 'Owner Settings' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Campaign Settings' })).toBeInTheDocument();
  });

  it.each([
    ['Notes', 'onOpenPanel', ['notes']],
    ['Gallery', 'onOpenPanel', ['gallery']],
    ['Session', 'onOpenPanel', ['session']],
    ['Documents', 'onOpenDocuments', []],
    ['Shortcuts', 'onOpenShortcuts', []],
    ['Map Library', 'onOpenTool', ['maps']],
    ['Spirit Layer', 'onOpenTool', ['spirit']],
    ['Campaign Settings', 'onOpenTool', ['settings']],
  ] as const)('%s closes More and opens it', (label, handler, args) => {
    const handlers = more();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(handlers[handler]).toHaveBeenCalledWith(...args);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('Tour closes More and starts the guided tour', () => {
    const started = vi.fn();
    window.addEventListener(TOUR_START_EVENT, started);
    const handlers = more();
    fireEvent.click(screen.getByRole('button', { name: 'Tour' }));
    window.removeEventListener(TOUR_START_EVENT, started);
    expect(started).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("Owner Settings opens the campaign's settings", () => {
    seat.role = 'PLAYER';
    const handlers = more({ isOwner: true });
    fireEvent.click(screen.getByRole('button', { name: 'Owner Settings' }));
    expect(handlers.onOpenTool).toHaveBeenCalledWith('settings');
  });

  it('draws rows a finger can press', () => {
    more();
    for (const row of within(screen.getByRole('dialog', { name: 'More' })).getAllByRole('group').flatMap((g) => within(g).queryAllByRole('button'))) {
      expect(row.className).toContain('min-h-13');
    }
  });

  it("changes this device's fog and dice animation in place, keeping the stored choices", () => {
    localStorage.setItem('mistwarden.fogMist', 'still');
    const redraw = vi.fn();
    window.addEventListener('mistwarden:fogmist', redraw);
    more();
    const fog = screen.getByRole('combobox', { name: 'Fog' });
    expect(fog).toHaveValue('still');
    fireEvent.change(fog, { target: { value: 'flat' } });
    expect(localStorage.getItem('mistwarden.fogMist')).toBe('flat');
    expect(redraw).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Dice animation' }), { target: { value: 'off' } });
    expect(localStorage.getItem('mistwarden.diceMode')).toBe('off');
    window.removeEventListener('mistwarden:fogmist', redraw);
    localStorage.clear();
  });
});
