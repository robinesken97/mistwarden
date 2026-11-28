/**
 * The wide layout's panel: folded by default below 1,280 px, open from
 * there; the user's choice is kept per browser, the computed default never.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWidePanel, WIDE_PANEL_KEY } from '../useWidePanel';

const wide = (matches: boolean) =>
  vi.stubGlobal('matchMedia', (media: string) => ({ matches, media, addEventListener() {}, removeEventListener() {} }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('starts folded below 1,280 px and open from there, and saves neither start', () => {
  wide(false);
  expect(renderHook(() => useWidePanel()).result.current.open).toBe(false);
  wide(true);
  expect(renderHook(() => useWidePanel()).result.current.open).toBe(true);
  expect(localStorage.getItem(WIDE_PANEL_KEY)).toBeNull();
});

it('keeps a tab the user opened or folded, on any width', () => {
  wide(false);
  const { result } = renderHook(() => useWidePanel());
  act(() => result.current.choose({ open: true, party: true }));
  expect(result.current).toMatchObject({ open: true, party: true });
  wide(true);
  const again = renderHook(() => useWidePanel()).result.current;
  expect(again).toMatchObject({ open: true, party: true });
  act(() => again.choose({ open: false, party: false }));
  wide(true);
  expect(renderHook(() => useWidePanel()).result.current.open).toBe(false);
});

it('drops the old column sizes and ignores a saved value it cannot read', () => {
  localStorage.setItem('react-resizable-panels:cozyvtt-session-layout', '{"party":0,"map":75,"rail":25}');
  localStorage.setItem(WIDE_PANEL_KEY, '{not json');
  wide(true);
  expect(renderHook(() => useWidePanel()).result.current).toMatchObject({ open: true, party: false });
  expect(localStorage.getItem('react-resizable-panels:cozyvtt-session-layout')).toBeNull();
  localStorage.setItem(WIDE_PANEL_KEY, '{"open":"yes"}');
  wide(false);
  expect(renderHook(() => useWidePanel()).result.current.open).toBe(false);
});
