/**
 * GmWallControls
 * GM tools' Walls tab.
 * Supports wall type selection, snap-to-grid, delete mode,
 * custom wall color, split mode, erase brush, brush paint tool,
 * and inline type picker for selected segments.
 */

import { useEffect, useRef, useState } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import type { WallType } from '@/types/walls';
import { Binary, ButtonRow, CardButton, CardSelect, ColourGrid, Help, Seg, Sep, Slider, type SegOption } from './map/cardParts';
import { wallSnapFlags, wallSnapOf, type WallSnap } from './map/mapControlItems';

export type WallToolMode = 'wall-draw' | 'wall-select' | 'wall-split' | 'wall-erase' | 'wall-polygon' | 'wall-brush' | null;

export const WALL_PRESET_COLORS = [
  { label: 'Orange (default)', value: '#f97316' },
  { label: 'White', value: '#ffffff' },
  { label: 'Yellow', value: '#facc15' },
  { label: 'Cyan', value: '#22d3ee' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Green', value: '#4ade80' },
];

export interface GmWallControlsProps {
  wallMode: WallToolMode;
  onWallModeChange: (mode: WallToolMode) => void;
  /** Puts the tool down with the line or polygon it began; MapCanvas calls it as the tab or card closes. */
  onCollapse?: () => void;
  wallType: WallType;
  onWallTypeChange: (type: WallType) => void;
  snapToGrid: boolean;
  onSnapToGridChange: (snap: boolean) => void;
  snapToEndpoint: boolean;
  onSnapToEndpointChange: (snap: boolean) => void;
  wallCount: number;
  onClearAll: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  wallColor: string;
  onWallColorChange: (color: string) => void;
  selectedSegmentType?: WallType | null;
  onSelectedTypeChange?: (type: WallType) => void;
  /** How many walls the Select tool holds, of whatever types. */
  selectedCount?: number;
  onDeleteSelected?: () => void;
  /** A click or a box adds to the selection, as Shift does. */
  addToSelection?: boolean;
  onAddToSelectionChange?: (on: boolean) => void;
  /** A line is being drawn: Done ends it, as a double-click or Esc does. */
  lineInProgress?: boolean;
  onFinishLine?: () => void;
  /** Corners placed of a polygon not yet closed. */
  polygonCorners?: number;
  /** Close the polygon, as a double-click does; Cancel drops it, as Esc does. */
  onClosePolygon?: () => void;
  onDropPolygon?: () => void;
  selectedEndpoint?: { x: number; y: number } | null;
  onMergeEndpoint?: () => void;
  brushSize?: number;
  onBrushSizeChange?: (v: number) => void;
}

const WALL_TYPE_LABELS: Record<WallType, string> = {
  'wall':        'Wall',
  'door-closed': 'Door',
  'door-open':   'Open Door',
  'door-locked': 'Locked',
  'window':      'Window',
};

const ALL_WALL_TYPES: WallType[] = ['wall', 'door-closed', 'door-open', 'door-locked', 'window'];

const MODES: SegOption<Exclude<WallToolMode, null>>[] = [
  { value: 'wall-draw', label: 'Draw' },
  { value: 'wall-select', label: 'Select' },
  { value: 'wall-split', label: 'Split' },
  { value: 'wall-erase', label: 'Erase' },
  { value: 'wall-polygon', label: 'Polygon' },
  { value: 'wall-brush', label: 'Brush' },
];

/** What the armed mode does, under the modes. */
const MODE_HINTS: Record<Exclude<WallToolMode, null>, string> = {
  'wall-draw': 'Click to place points; double-click or Esc finishes the line.',
  'wall-select': 'Click a wall to change its type or delete it; Shift or Add to selection adds more.',
  'wall-split': 'Point at a wall to see where it splits; click to split it.',
  'wall-erase': 'Drag over walls to erase them.',
  'wall-polygon': 'Click each corner; double-click or Done closes the room.',
  'wall-brush': 'Paint over walls to trace them. Snap Grid keeps them straight.',
};

const SNAPS: SegOption<WallSnap>[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'endpoints', label: 'Endpoints' },
  { value: 'off', label: 'Off' },
];

const SWATCHES = WALL_PRESET_COLORS.map((c) => ({ name: c.label, value: c.value }));

/** GM tools' Walls tab (the card's body; MapCanvas puts the armed tool down when the tab or card closes). */
export default function GmWallControls({
  wallMode,
  onWallModeChange,
  wallType,
  onWallTypeChange,
  snapToGrid,
  onSnapToGridChange,
  snapToEndpoint,
  onSnapToEndpointChange,
  wallCount,
  onClearAll,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  wallColor,
  onWallColorChange,
  selectedSegmentType,
  onSelectedTypeChange,
  selectedCount = 0,
  onDeleteSelected,
  addToSelection = false,
  onAddToSelectionChange,
  lineInProgress = false,
  onFinishLine,
  polygonCorners = 0,
  onClosePolygon,
  onDropPolygon,
  selectedEndpoint,
  onMergeEndpoint,
  brushSize = 20,
  onBrushSizeChange,
}: GmWallControlsProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  // Done, and Cancel for a polygon, come in under the mode buttons as the
  // first point is placed. The card's body scrolls on a short screen, which
  // left them out of sight; each time they appear they are brought into
  // view, and left alone while they stay.
  const finishing = (wallMode === 'wall-draw' && lineInProgress && !!onFinishLine) || (wallMode === 'wall-polygon' && polygonCorners > 0);
  const finishRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (finishing) finishRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [finishing]);

  const handleClearAll = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    onClearAll();
  };
  const drawing = wallMode === 'wall-draw' || wallMode === 'wall-polygon' || wallMode === 'wall-brush';

  return (
    <>
      <Seg label="Mode" options={MODES} value={wallMode} onChange={onWallModeChange} columns={3} deselect />
      {wallMode && <Help>{MODE_HINTS[wallMode]}</Help>}

      {/* What a double-click or Esc ends, as buttons: a finger or a pen has
          no Esc, and a double tap is easy to miss. A line's walls are sent
          click by click, so only a polygon has anything to cancel. */}
      {finishing && (
        <div ref={finishRef} className="grid shrink-0 auto-cols-fr grid-flow-col gap-2">
          {wallMode === 'wall-draw' ? (
            <CardButton onClick={() => onFinishLine?.()} title="Finish the line, as a double-click or Esc does" pressed>Done</CardButton>
          ) : (<>
            <CardButton
              onClick={() => onClosePolygon?.()}
              disabled={polygonCorners < 3}
              title={polygonCorners < 3 ? 'Place at least three corners first' : 'Close the shape, as a double-click does'}
              pressed
            >
              Done
            </CardButton>
            <CardButton onClick={() => onDropPolygon?.()} title="Drop the corners, as Esc does">Cancel</CardButton>
          </>)}
        </div>
      )}

      {wallMode === 'wall-brush' && onBrushSizeChange && (
        <Slider label="Brush size" valueText={`${brushSize} px`} min={8} max={60} step={2} value={brushSize} onChange={onBrushSizeChange} />
      )}

      {/* The selection: its type, when it is all one, and Delete, for any selection, as the Delete key. */}
      {wallMode === 'wall-select' && selectedCount > 0 && (<>
        {selectedSegmentType != null && (
          <CardSelect label="Type of the selected walls" value={selectedSegmentType} onChange={(v) => onSelectedTypeChange?.(v as WallType)}>
            {ALL_WALL_TYPES.map((t) => <option key={t} value={t}>{WALL_TYPE_LABELS[t]}</option>)}
          </CardSelect>
        )}
        <CardButton
          onClick={() => onDeleteSelected?.()}
          danger
          title={selectedCount === 1 ? 'Delete the selected wall segment' : `Delete the ${selectedCount} selected wall segments`}
        >
          {selectedCount === 1 ? 'Delete segment' : `Delete ${selectedCount} segments`}
        </CardButton>
      </>)}

      {/* Shift's adding to the selection, for a finger or a pen. */}
      {wallMode === 'wall-select' && onAddToSelectionChange && (
        <Binary label="Add to selection" value={addToSelection} onChange={onAddToSelectionChange} />
      )}

      {/* An endpoint chosen with Select: merge the two walls there into one straight wall. */}
      {wallMode === 'wall-select' && selectedEndpoint != null && selectedSegmentType == null && (<>
        <CardButton onClick={() => onMergeEndpoint?.()}>Merge point</CardButton>
        <Help>Removes this point and joins the two segments into one straight wall.</Help>
      </>)}

      {drawing && (
        <CardSelect label="Draw type" value={wallType} onChange={(v) => onWallTypeChange(v as WallType)}>
          {ALL_WALL_TYPES.map((t) => <option key={t} value={t}>{WALL_TYPE_LABELS[t]}</option>)}
        </CardSelect>
      )}

      <ColourGrid label="Colour" swatches={SWATCHES} value={wallColor} onChange={onWallColorChange} />

      <Seg
        label="Snap"
        options={SNAPS}
        value={wallSnapOf(snapToGrid, snapToEndpoint)}
        onChange={(v) => {
          if (!v) return;
          const flags = wallSnapFlags(v);
          onSnapToGridChange(flags.snapToGrid);
          onSnapToEndpointChange(flags.snapToEndpoint);
        }}
      />

      {(onUndo || onRedo) && (
        <ButtonRow>
          <CardButton onClick={() => onUndo?.()} disabled={!canUndo} icon={Undo2} title="Undo the last corner, the line being drawn or the last wall change (Ctrl+Z)">Undo</CardButton>
          <CardButton onClick={() => onRedo?.()} disabled={!canRedo} icon={Redo2} title="Redo wall change (Ctrl+Y)">Redo</CardButton>
        </ButtonRow>
      )}

      {wallCount > 0 && (<>
        <Sep />
        <CardButton
          onClick={handleClearAll}
          onBlur={() => setConfirmClear(false)}
          danger
          title={confirmClear ? 'Press again to confirm: delete all walls' : 'Delete all wall segments'}
        >
          {confirmClear ? 'Confirm clear all?' : `Clear all (${wallCount})`}
        </CardButton>
      </>)}
    </>
  );
}
