// ============================================
// The GM's fog boxes, Reveal and Hide: the box is anchored on mouse down,
// follows the cursor, and sends the squares it covers when the button is let
// go (map/fogSends.ts). Mistwarden adds a brush and a lasso (FogShape).
// ============================================

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { FogState } from '@/types/walls';
import type { FogToolMode } from '@/components/campaign/GmFogControls';
import { fogRectFromDrag, fogCellsInRect, fogCellsAlongStroke, fogCellsInPolygon, type FogRect } from '../fogSelection';
import { fogOperationsForBox, cellsInParts, CELL_LIST_BYTES } from '../fogSends';

/** Mistwarden, 2026-11-27: what a fog drag makes, a box, a brush stroke or a lassoed shape. */
export type FogShape = 'box' | 'brush' | 'lasso';
import type { MapLayer } from '../useRenderLoop';
import type { MapControls, MapTool, PointerAt, ToolSocketSource } from './types';

interface UseFogToolArgs {
  isGM: boolean;
  mapId: string | undefined;
  fogMode: FogToolMode;
  /** Mistwarden: the shape a drag makes. */
  fogShape: FogShape;
  /** Mistwarden: the brush's radius, in map pixels. */
  brushRadius: number;
  fogState: FogState | null;
  setFogState: Dispatch<SetStateAction<FogState | null>>;
  socket: ToolSocketSource | null | undefined;
  mapControls: MapControls;
  /** True while the right button pans the map under a GM tool (MapCanvas starts it). */
  rightPanActiveRef: RefObject<boolean>;
  markDirty: (...layers: MapLayer[]) => void;
}

export function useFogTool({ isGM, mapId, fogMode, fogShape, brushRadius, fogState, setFogState, socket, mapControls, rightPanActiveRef, markDirty }: UseFogToolArgs) {
  // Fog selection drag: anchor is fixed on mousedown, current follows the
  // cursor. Both in map pixels — the fog raster is top-left origin like map
  // pixels, so the box never touches the bottom-left grid convention.
  const fogDragAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const [fogDragCurrent, setFogDragCurrentState] = useState<{ x: number; y: number } | null>(null);
  // The same point as it is now, for the release. A tap's down and up arrive
  // in one event, before the state is drawn, and it still held where a mouse
  // last hovered.
  const fogDragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const setFogDragCurrent = useCallback((point: { x: number; y: number } | null) => {
    fogDragCurrentRef.current = point;
    setFogDragCurrentState(point);
  }, []);

  /**
   * Apply a fog box: optimistic local update, then its operations: one for
   * an ordinary box, reveal_all or hide_all for the whole map, and parts for
   * one too long for a single message (map/fogSends.ts).
   *
   * A rectangle drag produces exactly one call here, which is why the old
   * pending-cells buffer and its 80ms flush interval are gone — those existed
   * only to batch the continuous stream a brush stroke produced.
   */
  const applyFogBox = useCallback((fog: FogState, rect: FogRect) => {
    if (!mapId || !fogMode) return;

    const reveal = fogMode === 'fog-reveal';
    const cells = fogCellsInRect(fog, rect);

    setFogState((prev) => {
      if (!prev) return prev;
      const revealed = [...prev.revealed];
      for (const idx of cells) {
        if (idx >= 0 && idx < revealed.length) revealed[idx] = reveal;
      }
      return { ...prev, revealed };
    });

    const sock = socket?.getSocket();
    for (const operation of fogOperationsForBox(fog, rect, reveal)) {
      sock?.emit('fog:operation', { mapId, operation });
    }
  }, [mapId, fogMode, socket, setFogState]);

  // Mistwarden, 2026-11-27: the brush paints as it goes and sends what it
  // painted on release; the lasso sends the cells inside its shape.
  const brushCellsRef = useRef<Set<number>>(new Set());
  const brushLastRef = useRef<{ x: number; y: number } | null>(null);
  const [lassoPoints, setLassoPoints] = useState<Array<{ x: number; y: number }> | null>(null);
  const lassoRef = useRef<Array<{ x: number; y: number }> | null>(null);

  /** Show `cells` at once, before the server has them. */
  const paintLocally = useCallback((cells: number[], reveal: boolean) => {
    setFogState((prev) => {
      if (!prev) return prev;
      const revealed = [...prev.revealed];
      for (const idx of cells) {
        if (idx >= 0 && idx < revealed.length) revealed[idx] = reveal;
      }
      return { ...prev, revealed };
    });
  }, [setFogState]);

  /** Send `cells` in operations the live table reads. */
  const sendCells = useCallback((cells: number[], reveal: boolean) => {
    if (!mapId || cells.length === 0) return;
    const sock = socket?.getSocket();
    for (const part of cellsInParts(cells, CELL_LIST_BYTES)) {
      sock?.emit('fog:operation', { mapId, operation: { op: reveal ? 'reveal' : 'hide', cells: part } });
    }
  }, [mapId, socket]);

  const brushTo = useCallback((fog: FogState, point: { x: number; y: number }) => {
    const from = brushLastRef.current ?? point;
    brushLastRef.current = point;
    const fresh = fogCellsAlongStroke(fog, from, point, brushRadius).filter((c) => !brushCellsRef.current.has(c));
    for (const c of fresh) brushCellsRef.current.add(c);
    if (fresh.length > 0) paintLocally(fresh, fogMode === 'fog-reveal');
  }, [brushRadius, paintLocally, fogMode]);

  const endStrokes = useCallback(() => {
    brushCellsRef.current = new Set();
    brushLastRef.current = null;
    lassoRef.current = null;
    setLassoPoints(null);
  }, []);

  /** Finish a fog drag: compute the snapped rectangle once and apply it. */
  const commitFogDrag = useCallback((endX: number, endY: number) => {
    const anchor = fogDragAnchorRef.current;
    fogDragAnchorRef.current = null;
    setFogDragCurrent(null);
    if (!anchor || !fogState) return;

    const rect = fogRectFromDrag(fogState, anchor.x, anchor.y, endX, endY);
    if (!rect) return; // Entirely off the map
    applyFogBox(fogState, rect);
  }, [fogState, applyFogBox, setFogDragCurrent]);

  /** Abandon a drag without changing anything (Escape, right-click, map change). */
  const cancelFogDrag = useCallback(() => {
    fogDragAnchorRef.current = null;
    setFogDragCurrent(null);
    // A brush stroke already painted stays painted on this screen only until
    // the next state from the server; nothing of it was sent.
    endStrokes();
  }, [setFogDragCurrent, endStrokes]);

  // Leaving fog mode, or switching maps, drops any drag in progress.
  useEffect(() => {
    cancelFogDrag();
  }, [fogMode, fogShape, mapId, cancelFogDrag]);

  const tool: MapTool = {
    // Fog selection: anchor the box on mousedown
    down({ e, mapPx }: PointerAt) {
      if (!(fogMode && isGM && fogState)) return false;
      e.preventDefault(); // Prevent native drag — keeps mousemove firing during the drag
      fogDragAnchorRef.current = mapPx;
      setFogDragCurrent(mapPx);
      if (fogShape === 'brush') brushTo(fogState, mapPx);
      if (fogShape === 'lasso') { lassoRef.current = [mapPx]; setLassoPoints([mapPx]); }
      return true;
    },
    // Fog selection: track the cursor. Also runs with no button held, so the
    // idle single-cell outline follows the mouse before a drag starts.
    move({ e, mapPx }: PointerAt) {
      if (!(fogMode && isGM && fogState)) return false;
      if (rightPanActiveRef.current) {
        mapControls.handleDrag(e);
        markDirty('terrain', 'tokens', 'overlay');
        return true;
      }
      setFogDragCurrent(mapPx);
      if (fogDragAnchorRef.current && fogShape === 'brush') brushTo(fogState, mapPx);
      if (fogDragAnchorRef.current && fogShape === 'lasso' && lassoRef.current) {
        const last = lassoRef.current[lassoRef.current.length - 1];
        // A point every half fog cell is enough for the shape, and keeps the list short.
        if (Math.hypot(mapPx.x - last.x, mapPx.y - last.y) >= fogState.cellPx / 2) {
          lassoRef.current = [...lassoRef.current, mapPx];
          setLassoPoints(lassoRef.current);
        }
      }
      markDirty('overlay');
      return true;
    },
    // Commit the fog selection box on mouse release — one operation per drag.
    up() {
      if (!(fogMode && fogDragAnchorRef.current)) return;
      const reveal = fogMode === 'fog-reveal';
      if (fogShape === 'brush') {
        sendCells([...brushCellsRef.current], reveal);
        fogDragAnchorRef.current = null;
        setFogDragCurrent(null);
        endStrokes();
        return;
      }
      if (fogShape === 'lasso') {
        const shape = lassoRef.current ?? [];
        fogDragAnchorRef.current = null;
        setFogDragCurrent(null);
        endStrokes();
        if (!fogState) return;
        // Fewer than three points is a click: the cell under it, as the box does.
        const click = shape.length < 3 && shape[0] ? fogRectFromDrag(fogState, shape[0].x, shape[0].y, shape[0].x, shape[0].y) : null;
        const cells = shape.length >= 3 ? fogCellsInPolygon(fogState, shape) : click ? fogCellsInRect(fogState, click) : [];
        paintLocally(cells, reveal);
        sendCells(cells, reveal);
        return;
      }
      const end = fogDragCurrentRef.current ?? fogDragAnchorRef.current;
      commitFogDrag(end.x, end.y);
    },
    // The browser or a second finger took the pointer: the box is abandoned.
    cancel() {
      cancelFogDrag();
    },
    // A fog box being dragged is abandoned before any other Escape action
    escape() {
      if (!fogDragAnchorRef.current) return false;
      cancelFogDrag();
      return true;
    },
  };

  return { tool, fogDragAnchorRef, fogDragCurrent, cancelFogDrag, lassoPoints };
}
