// ============================================
// The spell areas on the map on screen.
//
// Asked for once the campaign is joined, and again on each rejoin, map and
// change of role (`areas:request`), and kept as the server's events change
// them; the server also sends the list by itself after Edit Map resizes the
// map and after a role change. A page whose role is not the GM's drops
// every area for the GM alone at once. Events for any other map are
// ignored.
//
// Nothing is drawn before the server has it: a placed area appears with its
// `area:added`, which every screen is sent with the same stored values, so
// all of them draw the same template. A refusal is said with its reason.
// ============================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DoneAck } from '@/types';
import type {
  MapArea, NewArea, AreaAddAck, AreaAddEvent, AreaRemoveEvent, AreaClearEvent, AreasRequestEvent,
  AreaAddedBroadcast, AreaRemovedBroadcast, AreasClearedBroadcast, AreasStateBroadcast,
} from '@/types/areas';
import { canEraseDrawing, drawingSentTo } from '@/utils/drawingRules';
import { randomId } from '@/utils/uuid';
import type { MapLayer } from './useRenderLoop';

/** The slice of the socket client the areas need; the real one is services/socket.ts. */
export interface MapAreasSocket {
  addArea(data: AreaAddEvent): Promise<AreaAddAck>;
  removeArea(data: AreaRemoveEvent): Promise<DoneAck>;
  clearAreas(data: AreaClearEvent): Promise<DoneAck>;
  requestAreas(data: AreasRequestEvent): void;
  onAreaAdded(cb: (data: AreaAddedBroadcast) => void): void;
  onAreaRemoved(cb: (data: AreaRemovedBroadcast) => void): void;
  onAreasCleared(cb: (data: AreasClearedBroadcast) => void): void;
  onAreasState(cb: (data: AreasStateBroadcast) => void): void;
  off(event: string, cb?: (data: never) => void): void;
}

export interface MapAreasOptions {
  socket: MapAreasSocket | null | undefined;
  mapId: string | undefined;
  /** 0 until the connection has joined the campaign, then a new number per join. */
  joinedEpoch: number;
  role: string | null | undefined;
  userId: string | undefined;
  markDirty: (...layers: MapLayer[]) => void;
  onRefused: (message: string) => void;
}

export interface MapAreas {
  /** The map's areas as this member is sent them, oldest first. */
  areas: MapArea[];
  place(area: NewArea): void;
  erase(area: MapArea): void;
  /** Every area on the map for the GM, this member's own for a player. */
  clear(): void;
  /** Whether this member may erase this area (utils/drawingRules.ts). */
  mayErase(area: MapArea): boolean;
}

export function useMapAreas({ socket, mapId, joinedEpoch, role, userId, markDirty, onRefused }: MapAreasOptions): MapAreas {
  const [held, setHeld] = useState<{ mapId: string | null; areas: MapArea[] }>({ mapId: null, areas: [] });
  const latest = useRef({ mapId, role, userId, onRefused });
  useLayoutEffect(() => {
    latest.current = { mapId, role, userId, onRefused };
  });

  /** Change the list of the map on screen, and repaint. */
  const change = useCallback((forMap: string, next: (areas: MapArea[]) => MapArea[]) => {
    setHeld((was) => {
      if (forMap !== latest.current.mapId) return was;
      return { mapId: forMap, areas: next(was.mapId === forMap ? was.areas : []) };
    });
    markDirty('overlay');
  }, [markDirty]);

  // A page whose role may not have an area for the GM alone keeps none.
  useEffect(() => {
    if (role !== 'GM') setHeld((was) => ({ ...was, areas: was.areas.filter((a) => drawingSentTo(role ?? undefined, a)) }));
  }, [role]);

  useEffect(() => {
    if (!socket || !mapId || !joinedEpoch) return;
    socket.requestAreas({ mapId });
  }, [socket, mapId, joinedEpoch, role]);

  useEffect(() => {
    if (!socket) return;
    const mayHave = (a: MapArea) => drawingSentTo(latest.current.role ?? undefined, a);
    const handleState = (data: AreasStateBroadcast) => change(data.mapId, () => data.areas.filter(mayHave));
    const handleAdded = (data: AreaAddedBroadcast) => {
      if (!mayHave(data.area)) return;
      change(data.mapId, (areas) => [...areas.filter((a) => a.id !== data.area.id), data.area]);
    };
    const handleRemoved = (data: AreaRemovedBroadcast) => change(data.mapId, (areas) => areas.filter((a) => a.id !== data.areaId));
    const handleCleared = (data: AreasClearedBroadcast) => change(data.mapId, (areas) => (data.authorId === undefined
      ? []
      // A player's clear takes their areas for everyone; one for the GM alone they wrote in the GM's seat stays.
      : areas.filter((a) => !(a.authorId === data.authorId && a.audience === 'ALL'))));
    socket.onAreasState(handleState);
    socket.onAreaAdded(handleAdded);
    socket.onAreaRemoved(handleRemoved);
    socket.onAreasCleared(handleCleared);
    return () => {
      socket.off('areas:state', handleState);
      socket.off('area:added', handleAdded);
      socket.off('area:removed', handleRemoved);
      socket.off('areas:cleared', handleCleared);
    };
  }, [socket, change]);

  const answered = useCallback((forMap: string) => (answer: DoneAck | AreaAddAck) => {
    if (answer.ok) return;
    if (latest.current.mapId === forMap) socket?.requestAreas({ mapId: forMap });
    latest.current.onRefused(answer.error);
  }, [socket]);

  const place = useCallback((area: NewArea) => {
    const forMap = latest.current.mapId;
    if (!socket || !forMap) return;
    void socket.addArea({ mapId: forMap, area, opId: randomId() }).then(answered(forMap));
  }, [socket, answered]);

  const erase = useCallback((area: MapArea) => {
    const forMap = latest.current.mapId;
    if (!socket || !forMap) return;
    change(forMap, (areas) => areas.filter((a) => a.id !== area.id));
    void socket.removeArea({ mapId: forMap, areaId: area.id }).then(answered(forMap));
  }, [socket, change, answered]);

  const clear = useCallback(() => {
    const forMap = latest.current.mapId;
    if (!socket || !forMap) return;
    void socket.clearAreas({ mapId: forMap }).then(answered(forMap));
  }, [socket, answered]);

  const mayErase = useCallback((area: MapArea) => canEraseDrawing(role ?? undefined, userId, area), [role, userId]);

  const areas = held.mapId === (mapId ?? null) ? held.areas : NO_AREAS;
  return useMemo(() => ({ areas, place, erase, clear, mayErase }), [areas, place, erase, clear, mayErase]);
}

const NO_AREAS: MapArea[] = [];
