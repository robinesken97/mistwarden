/**
 * The dock on a tablet or a phone: folded by default, the user's choice
 * (open, Party, height) kept per browser, and a drag let go settling on the
 * nearest of folded, 40 % and tall.
 */
import { it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DOCK_PANEL_KEY, nearestDockSnap, useDockPanel } from '../useWidePanel';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('starts folded at 40 %, and saves nothing until the user chooses', () => {
  expect(renderHook(() => useDockPanel()).result.current).toMatchObject({ open: false, party: false, size: 'mid' });
  expect(localStorage.getItem(DOCK_PANEL_KEY)).toBeNull();
});

it('keeps the dock as it was left for the next visit, a size left out staying as it was', () => {
  const { result } = renderHook(() => useDockPanel());
  act(() => result.current.choose({ open: true, party: true, size: 'tall' }));
  act(() => result.current.choose({ open: false, party: true }));
  expect(result.current).toMatchObject({ open: false, party: true, size: 'tall' });
  expect(renderHook(() => useDockPanel()).result.current).toMatchObject({ open: false, party: true, size: 'tall' });
});

it('ignores a saved dock it cannot read', () => {
  localStorage.setItem(DOCK_PANEL_KEY, '{not json');
  expect(renderHook(() => useDockPanel()).result.current.open).toBe(false);
  localStorage.setItem(DOCK_PANEL_KEY, '{"open":true,"size":"huge"}');
  expect(renderHook(() => useDockPanel()).result.current).toMatchObject({ open: true, size: 'mid' });
});

it('settles a drag on the nearest snap', () => {
  // A tablet 1,024 tall: 40 % is 357 above the tab row, 60 % is 561.
  expect(nearestDockSnap(100, 357, 561)).toBe('folded');
  expect(nearestDockSnap(300, 357, 561)).toBe('mid');
  expect(nearestDockSnap(470, 357, 561)).toBe('tall');
  expect(nearestDockSnap(900, 357, 561)).toBe('tall');
});
