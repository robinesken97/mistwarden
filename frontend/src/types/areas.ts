// ============================================
// Spell areas on the map, as the server sends them and as the AoE panel
// sends them (backend/docs/WEBSOCKET_DOCUMENTATION.md).
//
// `MapArea` has the fields of the server's AreaSent
// (backend/src/services/mapAreas.ts), and each broadcast the same fields as
// the server's; backend/src/__tests__/keepInStep.test.ts fails while they differ.
// ============================================

import type { AreaElement, AreaShape } from '@/constants/areaLimits';

/** An area as the server sends it. */
export interface MapArea {
  id: string;
  /** Who placed it; null once their account is deleted. */
  authorId: string | null;
  audience: 'ALL' | 'GM';
  shape: string;
  /** Map pixels from the map's top-left corner. */
  anchorX: number;
  anchorY: number;
  /** Radians, clockwise from pointing right. */
  angle: number;
  sizeFt: number;
  widthFt: number | null;
  exact: boolean;
  element: string;
  animated: boolean;
  label: string | null;
  spellId: string | null;
  createdAt: string;
}

/** An area as `area:add` takes it; the server sets its id, author and time. */
export interface NewArea {
  shape: AreaShape;
  anchorX: number;
  anchorY: number;
  angle: number;
  sizeFt: number;
  widthFt: number | null;
  exact: boolean;
  element: AreaElement;
  animated?: boolean;
  label?: string | null;
  spellId?: string | null;
  /** The GM's choice; a player's is for everyone whatever this says. */
  audience?: 'ALL' | 'GM';
}

export interface AreaAddEvent { mapId: string; area: NewArea; opId?: string }
export type AreaAddAck = { ok: true; id: string; opId?: string } | { ok: false; error: string };
export interface AreaRemoveEvent { mapId: string; areaId: string }
export interface AreaClearEvent { mapId: string }
export interface AreasRequestEvent { mapId: string }

/** `area:added`: to each reader the area may be sent to, the sender included. */
export interface AreaAddedBroadcast {
  mapId: string;
  area: MapArea;
  opId?: string;
}

/** `area:removed`: to the readers who had the area. */
export interface AreaRemovedBroadcast {
  mapId: string;
  areaId: string;
  opId?: string;
}

/** `areas:cleared`: to the readers who had any of them; `authorId` for one member's own. */
export interface AreasClearedBroadcast {
  mapId: string;
  authorId?: string;
  opId?: string;
}

/** `areas:state`: a map's areas as the reader may be sent them, oldest first. */
export interface AreasStateBroadcast {
  mapId: string;
  areas: MapArea[];
}
