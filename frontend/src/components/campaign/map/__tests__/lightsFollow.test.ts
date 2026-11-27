import { describe, it, expect, beforeEach, vi } from 'vitest';
import { heldLightSquares, lightsFollowDrag, setLightsFollowDrag, LIGHTS_FOLLOW_EVENT, LIGHTS_FOLLOW_KEY } from '../lightsFollow';

const torch = { brightRadius: 4, dimRadius: 8, color: '#ffcc66', enabled: true };

describe('lights follow while dragging (device setting)', () => {
  beforeEach(() => window.localStorage.clear());

  it('is on until this device turns it off, under a stable key, and says so when it changes', () => {
    expect(lightsFollowDrag()).toBe(true);
    const heard = vi.fn();
    window.addEventListener(LIGHTS_FOLLOW_EVENT, heard);
    setLightsFollowDrag(false);
    expect(window.localStorage.getItem('mistwarden.lightsFollowDrag')).toBe('off');
    expect(LIGHTS_FOLLOW_KEY).toBe('mistwarden.lightsFollowDrag');
    expect(lightsFollowDrag()).toBe(false);
    setLightsFollowDrag(true);
    expect(lightsFollowDrag()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(LIGHTS_FOLLOW_EVENT, heard);
  });
});

describe('heldLightSquares', () => {
  const tokens = [
    { id: 'torch', light: torch },
    { id: 'out', light: { ...torch, enabled: false } },
    { id: 'plain', light: null },
  ];

  it('places only held tokens whose light is lit, this screen\'s own drag over a frame for it', () => {
    const heldAt = { torch: { x: 1, y: 1 }, out: { x: 2, y: 2 }, plain: { x: 3, y: 3 } };
    expect(heldLightSquares(tokens, heldAt, null)).toEqual([['torch', { x: 1, y: 1 }]]);
    expect(heldLightSquares(tokens, heldAt, { id: 'torch', at: { x: 9, y: 9 } })).toEqual([['torch', { x: 9, y: 9 }]]);
    expect(heldLightSquares(tokens, {}, { id: 'plain', at: { x: 9, y: 9 } })).toEqual([]);
  });
});
