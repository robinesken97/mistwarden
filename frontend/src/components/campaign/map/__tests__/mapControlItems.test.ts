import { describe, it, expect } from 'vitest';
import { placeFreelyShown, presetNameOf, shownRailCard, wallSnapFlags, wallSnapOf, type RailCardKey } from '../mapControlItems';

const none: Record<RailCardKey, boolean> = { draw: false, measure: false, aoe: false, spirit: false, gm: false };

describe('rail cards', () => {
  it('shows one card at a time', () => {
    expect(shownRailCard(none)).toBeNull();
    expect(shownRailCard({ ...none, gm: true })).toBe('gm');
    // A GM tool armed by its key while Measure is open: Measure's card alone.
    expect(shownRailCard({ ...none, gm: true, measure: true })).toBe('measure');
    expect(shownRailCard({ ...none, spirit: true, gm: true })).toBe('spirit');
    expect(shownRailCard({ ...none, draw: true, aoe: true })).toBe('draw');
  });
});

describe('Place freely', () => {
  const square = { isGM: true, hasMap: true, snapTokens: true, hex: false, paintOn: false };
  it('is offered to the GM on a snapping square grid', () => {
    expect(placeFreelyShown(square)).toBe(true);
    // Older payloads without snapTokens snap.
    expect(placeFreelyShown({ ...square, snapTokens: undefined })).toBe(true);
  });
  it('is hidden for players, with snapping off, on hexes and under Mapmaker', () => {
    expect(placeFreelyShown({ ...square, isGM: false })).toBe(false);
    expect(placeFreelyShown({ ...square, snapTokens: false })).toBe(false);
    expect(placeFreelyShown({ ...square, hex: true })).toBe(false);
    expect(placeFreelyShown({ ...square, paintOn: true })).toBe(false);
    expect(placeFreelyShown({ ...square, hasMap: false })).toBe(false);
  });
});

describe("Walls' Snap", () => {
  it('maps the two old boxes to one choice, grid winning as its box disabled the other', () => {
    expect(wallSnapOf(true, false)).toBe('grid');
    expect(wallSnapOf(true, true)).toBe('grid');
    expect(wallSnapOf(false, true)).toBe('endpoints');
    expect(wallSnapOf(false, false)).toBe('off');
  });
  it('maps each choice back to the boxes, round trip', () => {
    for (const snap of ['grid', 'endpoints', 'off'] as const) {
      const { snapToGrid, snapToEndpoint } = wallSnapFlags(snap);
      expect(wallSnapOf(snapToGrid, snapToEndpoint)).toBe(snap);
      expect(snapToGrid && snapToEndpoint).toBe(false);
    }
  });
});

it("names a light's preset, or Custom when the radii match none", () => {
  const presets = [{ label: 'Torch', bright: 4, dim: 8 }, { label: 'Candle', bright: 1, dim: 2 }];
  expect(presetNameOf(presets, 4, 8)).toBe('Torch');
  expect(presetNameOf(presets, 4, 9)).toBe('Custom');
});
