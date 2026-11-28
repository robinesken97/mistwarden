/**
 * GmToolPanelContainer
 * Draggable container that stacks GM tool panels (Fog, Walls, Lights)
 * vertically with no overlap. GM can drag the container header to
 * reposition it anywhere on the map canvas.
 *
 * On the compact layout the stack is shown and hidden behind Tools: it stays
 * mounted while hidden, so the panels keep what is folded and where the
 * stack was dropped; its handle offers Hide tools, and a drag keeps it under
 * the map's band.
 */

import { useState, useRef, useCallback, useEffect, type ReactNode, type RefObject } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { stackCornerTop, type TopBand } from './map/toolbarLayout';

interface GmToolPanelContainerProps {
  children: ReactNode;
  /** Ref to the map container element — the stack is placed and kept within it. */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * The band across the top of the map, measured: the stack's corner moves
   * under it when the toolbar wraps or its buttons reach the corner.
   */
  band?: TopBand | null;
  /** Hidden, still mounted: the compact layout's Tools is off. */
  hidden?: boolean;
  /** Given, the handle offers Hide tools, which calls it. */
  onHide?: () => void;
  /** The least top a drag leaves the stack at, in pixels from the map's: under the compact layout's band. */
  topLimit?: number;
  /**
   * The room to keep below the stack, in pixels, in place of ROOM_BELOW:
   * the compact layout's dock at the map's foot, as tall as it is.
   */
  roomBelow?: number;
  /** The card's heading: "GM tools", or what a player's Draw panel is under. */
  label?: string;
  /** Its place before it is dragged, in px from the map's top and right edges: on the wide layout, left of the rail. */
  corner?: { top: number; right: number };
}

/**
 * Where the stack starts: the map's top right corner, beside its toolbar,
 * or under it where the toolbar reaches the corner.
 */
// Mistwarden, 2026-11-27: one card in the toolbar's style, its top level with
// the toolbar's (top-4) and as far in from the right edge as the toolbar is
// from the left (left-4); 200 pixels of panels inside its padding.
const CORNER_TOP = '1rem';
/**
 * The stack's gap from the map's right edge, and its one width, in rem (16
 * and 216 px at the usual text size): set here and read for the toolbar's
 * reach. In rem so the stack grows with the page on a very wide screen
 * (index.css scales the root font from 2200 px).
 */
const CORNER_RIGHT_REM = 1;
const STACK_WIDTH_REM = 13.5;
/**
 * Room kept below the stack for the Preview Player View button, which sits
 * 5rem above the map's bottom edge: that, its height and a gap. A taller
 * stack scrolls inside itself; it ran over the button and hid the Lights
 * panel's Place button behind it. On the compact layout the button is in
 * the dock at the map's foot, over the details card, and the map gives the
 * dock's height (`roomBelow`).
 */
const ROOM_BELOW = '8rem';
/** The stack is never cut shorter than this, wherever it is dropped. */
const SHORTEST = '6rem';

export default function GmToolPanelContainer({ children, containerRef, band = null, hidden = false, onHide, topLimit = 0, roomBelow, label = 'GM tools', corner: cornerAt }: GmToolPanelContainerProps) {
  // Where the stack was dropped, in pixels from the map container's top left
  // corner; null for its place in the top right corner. It was fixed to the
  // window, so it stayed put when the map moved or shrank and could be left
  // off the map.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /** The nearest position that keeps the whole stack on the map. */
  const onTheMap = useCallback((x: number, y: number) => {
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return { x, y };
    const map = container.getBoundingClientRect();
    // A map with no size is between two arrangements of the page, waiting
    // a frame in a box of none (tableHosts.tsx): the stack keeps its place
    // for the map's next size.
    if (map.width === 0 || map.height === 0) return { x, y };
    const stack = panel.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(x, map.width - stack.width)),
      y: Math.max(topLimit, Math.min(y, map.height - stack.height)),
    };
  }, [containerRef, topLimit]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    const panel = panelRef.current;
    if (!container || !panel) return;
    const map = container.getBoundingClientRect();
    const stack = panel.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: stack.left - map.left, origY: stack.top - map.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [containerRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPosition(onTheMap(drag.origX + e.clientX - drag.startX, drag.origY + e.clientY - drag.startY));
  }, [onTheMap]);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // The map changes size with the window and the side panels; a stack
  // dropped near its far edge is brought back onto it. A hidden stack has
  // no size and is left alone; the observer's first report, as it starts
  // observing, brings it back onto the map as it shows.
  const moved = position !== null;
  useEffect(() => {
    if (!moved || hidden) return undefined;
    const keepOnTheMap = () => setPosition((at) => {
      if (!at) return at;
      const next = onTheMap(at.x, at.y);
      return next.x === at.x && next.y === at.y ? at : next;
    });
    window.addEventListener('resize', keepOnTheMap);
    const container = containerRef.current;
    const observer = container && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(keepOnTheMap) : null;
    if (container) observer?.observe(container);
    return () => {
      window.removeEventListener('resize', keepOnTheMap);
      observer?.disconnect();
    };
  }, [moved, hidden, onTheMap, containerRef]);

  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const underBand = stackCornerTop(band, STACK_WIDTH_REM * rem, CORNER_RIGHT_REM * rem);
  const corner = cornerAt ? `${cornerAt.top}px` : underBand !== null ? `${underBand}px` : CORNER_TOP;
  const top = position ? `${position.y}px` : corner;
  const style: React.CSSProperties = {
    position: 'absolute',
    ...(position ? { left: position.x, top: position.y } : { top: corner, right: cornerAt ? cornerAt.right : CORNER_RIGHT_REM * rem }),
    width: STACK_WIDTH_REM * rem,
    zIndex: 30,
    maxHeight: `max(${SHORTEST}, calc(100% - ${top} - ${roomBelow !== undefined ? `${roomBelow}px` : ROOM_BELOW}))`,
  };

  // One width for the stack, the one Walls and Lights take, so a section's
  // notes wrap instead of widening every panel when it is opened. The card is
  // the toolbar's (glass-panel p-2 bg-parchment/90 backdrop-blur-xs).
  return (
    <div ref={panelRef} style={style} hidden={hidden || undefined} className="gm-panels glass-panel p-2 bg-parchment/90 backdrop-blur-xs flex flex-col gap-1.5 overflow-y-auto *:shrink-0">
      {/* The card's heading, which is its drag handle, kept in view while the
          panels below it scroll. Taller for a finger on a touch screen, and
          it takes the touch itself: left to the browser, a finger's drag
          scrolled the stack and cancelled the move. Once moved, it offers
          Reset position, the double-click's way back, which a finger rarely
          lands; on a touch screen the row then grows to hold the button's
          44 pixels. */}
      <div
        className={`sticky top-0 z-10 flex items-center gap-1 pl-1 pb-1 border-b border-ink/10 bg-parchment/95 ${onHide ? 'min-h-11' : position ? 'pointer-coarse:min-h-6' : 'pointer-coarse:h-6'} touch-none cursor-grab active:cursor-grabbing select-none`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => setPosition(null)}
        title="Drag to move the panels; double-click to put them back in the corner"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
        <GripHorizontal className="ml-auto w-4 h-4 shrink-0 text-ink-muted" aria-hidden="true" />
        {position && (
          <button
            type="button"
            // A press here is the button's, not the start of a move.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPosition(null)}
            title="Put the panels back in the corner"
            className="touch-target shrink-0 px-1.5 py-0.5 rounded-sm text-[10px] leading-none text-ink-muted hover:text-ink hover:bg-ink/10 transition-colors"
          >
            Reset position
          </button>
        )}
        {/* The compact layout's way to put the stack away, beside Map
            controls' Hide tools: the row is 44 pixels tall to hold it. */}
        {onHide && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onHide}
            aria-label="Hide tools"
            title="Hide tools"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:text-ink hover:bg-ink/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
