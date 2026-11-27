// ============================================
// Carried lights while their tokens are held
//
// A device setting (Display on this device): while a token carrying a lit
// light is being dragged, its light is drawn where the token is held, on the
// dragging screen and on every screen sent that drag's frames. Off, the
// light moves when the token is put down, as sight does.
//
// Only the drawing follows. Server sight, and so which tokens players are
// sent, still moves on the drop; the explored memory a screen reports is
// never taken from a composite drawn with a held light (MapCanvas).
// ============================================

import type { Position, Token } from '@/types';
import { optionalStorage } from '@/utils/optionalStorage';

export const LIGHTS_FOLLOW_KEY = 'mistwarden.lightsFollowDrag';
/** Sent when this device's choice changes, so the map redraws without a reload. */
export const LIGHTS_FOLLOW_EVENT = 'mistwarden:lightsfollow';

/** This device's choice; on unless it was turned off. */
export const lightsFollowDrag = (): boolean => optionalStorage.getItem(LIGHTS_FOLLOW_KEY) !== 'off';

export function setLightsFollowDrag(on: boolean): void {
  optionalStorage.setItem(LIGHTS_FOLLOW_KEY, on ? 'on' : 'off');
  window.dispatchEvent(new Event(LIGHTS_FOLLOW_EVENT));
}

/**
 * Where each held token carrying a lit light is, by id: others' drags as
 * their frames place them (`heldAt`), and this screen's own (`local`).
 * Tokens without a lit light are left out, so a plain drag changes nothing.
 */
export function heldLightSquares(
  tokens: ReadonlyArray<Pick<Token, 'id' | 'light'>>,
  heldAt: Readonly<Record<string, Position>>,
  local: { id: string; at: Position } | null
): Array<[string, Position]> {
  const lit = new Set(tokens.filter((t) => t.light?.enabled === true).map((t) => t.id));
  const held = Object.entries(heldAt).filter(([id]) => lit.has(id) && id !== local?.id);
  if (local && lit.has(local.id)) held.push([local.id, local.at]);
  return held;
}
