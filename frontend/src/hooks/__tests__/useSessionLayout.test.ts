/**
 * The campaign table keeps only the column sizes the user made.
 *
 * A tablet-width window without a saved layout starts with the left column
 * folded, and that start was saved as the library committed it, so the same
 * browser later opened folded on a wide window too.
 */

import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SESSION_LAYOUT_ID, useSessionLayout } from '../useSessionLayout';

/** The library's storage key for the group (react-resizable-panels: id plus its panel ids, none here). */
const savedKeys = () => Object.keys(localStorage).filter((key) => key.includes(SESSION_LAYOUT_ID));

const narrow = (matches: boolean) =>
  vi.stubGlobal('matchMedia', (media: string) => ({ matches, media, addEventListener() {}, removeEventListener() {} }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const folded = { party: 0, map: 75, rail: 25 };

it('starts folded on a tablet-width window and does not save that start', () => {
  narrow(true);
  const { result } = renderHook(() => useSessionLayout());
  expect(result.current.defaultLayout).toEqual(folded);
  act(() => result.current.onLayoutChanged(folded, { isUserInteraction: false }));
  expect(savedKeys()).toEqual([]);

  // The same browser on a wide window then starts with the library's defaults.
  narrow(false);
  expect(renderHook(() => useSessionLayout()).result.current.defaultLayout).toBeUndefined();
});

it('saves a divider the user dragged, and opens with it', () => {
  narrow(true);
  const { result } = renderHook(() => useSessionLayout());
  const dragged = { party: 30, map: 45, rail: 25 };
  act(() => result.current.onLayoutChanged(dragged, { isUserInteraction: true }));
  expect(savedKeys()).toHaveLength(1);

  narrow(false);
  expect(renderHook(() => useSessionLayout()).result.current.defaultLayout).toEqual(dragged);
});

it('saves a column shown or hidden from the header buttons', () => {
  narrow(true);
  const { result } = renderHook(() => useSessionLayout());
  const shown = { party: 20, map: 55, rail: 25 };
  act(() => {
    result.current.markUserChange();
    result.current.onLayoutChanged(shown, { isUserInteraction: false });
  });
  expect(savedKeys()).toHaveLength(1);
});
