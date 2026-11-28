// Added for Mistwarden on 2026-11-28.
/**
 * The guided tour's card: it starts only from its button, keeps its place
 * on this device, lets presses through to the page, and ends on End tour
 * or Escape. A step whose target is not on the page shows the card in the
 * middle (tour/tourSteps.ts finds targets; its own tests cover that).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TableTour from '../TableTour';
import { saveTour, startTour, TOUR_KEY } from '../tour/tourSteps';

const tour = (practice = false) => <TableTour campaignId="c1" kind="gm" practice={practice} live={false} userId="u1" role="GM" />;

afterEach(() => window.localStorage.clear());

describe('TableTour', () => {
  it('shows nothing until its button starts it', async () => {
    render(tour());
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => startTour());
    expect(await screen.findByRole('dialog', { name: 'The GM’s tour' })).toBeInTheDocument();
  });

  it('lets presses through everywhere but its card', async () => {
    render(tour());
    act(() => startTour());
    const card = await screen.findByRole('dialog');
    // The first step points at nothing: the card in the middle.
    expect(card.className).toContain('top-1/2');
    expect(card.className).toContain('pointer-events-auto');
    expect(card.parentElement?.className).toContain('pointer-events-none');
  });

  it('only explains outside the practice campaign, and asks for a try in it', async () => {
    const { unmount } = render(tour());
    act(() => startTour());
    await screen.findByRole('dialog');
    expect(screen.queryByText(/Try it/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    unmount();
    render(tour(true));
    act(() => startTour());
    expect(await screen.findByText(/Try it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
  });

  it('keeps its place as it goes on, and puts the card in a corner when its target is not on screen', async () => {
    render(tour());
    act(() => startTour());
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(JSON.parse(window.localStorage.getItem(TOUR_KEY)!)).toMatchObject({ campaignId: 'c1', kind: 'gm', step: 1 });
    // No map on this page: after a moment's looking, the card in the bottom left corner, clear of a dialog.
    const card = await screen.findByRole('dialog', { name: 'The map' });
    expect(card.className).not.toContain('top-1/2');
    expect(card.style.left).toBe('16px');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('comes back to the step it was on after a reload', async () => {
    saveTour('c1', 'gm', 0);
    render(tour());
    expect(await screen.findByRole('dialog', { name: 'The GM’s tour' })).toBeInTheDocument();
  });

  it('ends on Escape and forgets its place', async () => {
    render(tour());
    act(() => startTour());
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(TOUR_KEY)).toBeNull();
  });

  it('ends on End tour, a named button', async () => {
    render(tour());
    act(() => startTour());
    fireEvent.click(await screen.findByRole('button', { name: 'End tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
