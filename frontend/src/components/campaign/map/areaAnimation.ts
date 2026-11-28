// ============================================
// Whether spell areas move on this device
//
// A device setting (Display on this device): an animated area's fire
// flickers, its frost drifts, its rings go out. Off, every area is drawn
// still, as under reduced motion, so a slow tablet keeps its frames.
// ============================================

import { optionalStorage } from '@/utils/optionalStorage';

export const ANIMATE_AREAS_KEY = 'mistwarden.animateAreas';
/** Sent when this device's choice changes, so the map redraws without a reload. */
export const ANIMATE_AREAS_EVENT = 'mistwarden:animateareas';

/** This device's choice; on unless it was turned off. */
export const animateAreas = (): boolean => optionalStorage.getItem(ANIMATE_AREAS_KEY) !== 'off';

export function setAnimateAreas(on: boolean): void {
  optionalStorage.setItem(ANIMATE_AREAS_KEY, on ? 'on' : 'off');
  window.dispatchEvent(new Event(ANIMATE_AREAS_EVENT));
}
