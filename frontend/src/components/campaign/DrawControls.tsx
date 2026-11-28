/**
 * DrawControls
 * Draw's card body: the tool, its colour (the user's player colour first),
 * width, fill and snap, who sees the GM's drawing, a polygon's Done and
 * Cancel, and clearing. It sets no place of its own: MapCanvas puts it in a
 * card beside the rail, or on a phone in a strip across the map's foot.
 */

import { useState } from 'react';
import { ArrowUpRight, Circle, Crosshair, Eraser, Minus, Pencil, Pentagon, Square, Type, type LucideIcon } from 'lucide-react';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { DRAWING_LIMITS } from '@/constants/drawingLimits';
import { DRAW_TOOL_KINDS, type DrawSettings, type DrawToolKind } from './map/tools/useDrawTool';
import { ButtonRow, CardButton, ColourGrid, Help, Seg, Sep, Slider, type SegOption, type Swatch } from './map/cardParts';

/** Each tool's name, as its button is called, and its icon. */
export const TOOLS: Record<DrawToolKind, { label: string; short: string; icon: LucideIcon }> = {
  pen: { label: 'Pen', short: 'Pen', icon: Pencil },
  line: { label: 'Line', short: 'Line', icon: Minus },
  arrow: { label: 'Arrow', short: 'Arrow', icon: ArrowUpRight },
  rect: { label: 'Rectangle', short: 'Rectangle', icon: Square },
  ellipse: { label: 'Ellipse', short: 'Ellipse', icon: Circle },
  polygon: { label: 'Polygon', short: 'Polygon', icon: Pentagon },
  text: { label: 'Text label', short: 'Text', icon: Type },
  eraser: { label: 'Eraser', short: 'Eraser', icon: Eraser },
  laser: { label: 'Laser pointer', short: 'Laser', icon: Crosshair },
};

/** The named colours, by DRAWING_LIMITS.namedColors' order. */
export const COLOUR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'White', 'Black'] as const;

/** What each tool does, in a line under the tools. */
export const HINTS: Record<DrawToolKind, string> = {
  pen: 'Drag to draw.',
  line: 'Drag from one end to the other.',
  arrow: 'Drag from the tail to the point.',
  rect: 'Drag from one corner to the other.',
  ellipse: 'Drag across the box it fills.',
  polygon: 'Tap or click each corner, then the first again or Done to close it.',
  text: 'Tap or click where the label goes, type it, then press Enter.',
  eraser: 'Tap or click a drawing to erase it.',
  laser: 'Drag to point. Everyone sees it fade; nothing is kept.',
};

/** The tools Snap to grid applies to, and of those the ones Fill shapes does. */
export const SHAPES = new Set<DrawToolKind>(['line', 'arrow', 'rect', 'ellipse', 'polygon']);
export const FILLABLE = new Set<DrawToolKind>(['rect', 'ellipse', 'polygon']);

/** A member with drawings on the map the GM may clear, and how many. */
export interface MemberDrawings {
  authorId: string;
  /** Null for someone no longer in the campaign. */
  name: string | null;
  count: number;
}

export interface DrawControlsProps {
  kind: DrawToolKind;
  onKindChange: (kind: DrawToolKind) => void;
  settings: DrawSettings;
  onSettingsChange: (patch: Partial<DrawSettings>) => void;
  /** The GM's panel offers Only I can see this and Clear drawings; a player's, Clear mine. */
  isGM: boolean;
  /**
   * A player who may not draw now (a pause, or Players may draw off) is
   * offered only the eraser and Clear mine, for their own drawings.
   */
  onlyErase?: boolean;
  /** The corners of the polygon being drawn, for Done and Cancel. */
  polygonCorners: number;
  onPolygonDone: () => void;
  onPolygonCancel: () => void;
  /** How many drawings on the map this member may clear: their own, or for the GM every one. */
  clearable: number;
  onClear: () => void;
  /** For the GM: the other members with drawings on the map, each to clear alone. */
  members: MemberDrawings[];
  onClearMember: (authorId: string) => void;
  onClose: () => void;
  /** The user's player colour (utils/playerColor.ts), the first swatch and where new drawings and the laser start. */
  playerColour: string;
}

/** "Mara's drawings", or for someone who has left, saying so. */
export const drawingsOf = (member: MemberDrawings) => (member.name === null ? 'the drawings of someone who has left' : `${member.name}'s drawings`);
const howMany = (count: number) => (count === 1 ? '1 drawing' : `${count} drawings`);


/** What the GM is asked before a clear: about every drawing on the map, or one member's. */
export type ClearAsking = 'all' | MemberDrawings | null;

interface ClearDrawingsDialogsProps {
  asking: ClearAsking;
  /** The question is answered either way, or put aside. */
  onAnswered: () => void;
  clearable: number;
  onClear: () => void;
  onClearMember: (authorId: string) => void;
}

/** The GM's questions before a clear, which cannot be undone: how many, and whose. */
export function ClearDrawingsDialogs({ asking, onAnswered, clearable, onClear, onClearMember }: ClearDrawingsDialogsProps) {
  const member = asking !== null && asking !== 'all' ? asking : null;
  return (
    <>
      <ConfirmDialog
        isOpen={asking === 'all'}
        title="Clear every drawing on this map?"
        message={`This erases all ${clearable === 1 ? '1 drawing' : `${clearable} drawings`} on this map, yours and the players', for everyone. It cannot be undone.`}
        confirmLabel="Clear drawings"
        onConfirm={() => {
          onAnswered();
          onClear();
        }}
        onCancel={onAnswered}
      />
      <ConfirmDialog
        isOpen={member !== null}
        title={member ? `Clear ${drawingsOf(member)}?` : ''}
        message={member
          ? `This erases ${member.name === null ? 'the' : `${member.name}'s`} ${howMany(member.count)}${member.name === null ? ' of someone who has left' : ''} on this map, for everyone. Nobody else's are touched. It cannot be undone.`
          : ''}
        confirmLabel={member ? `Clear ${member.name === null ? 'their drawings' : drawingsOf(member)}` : ''}
        onConfirm={() => {
          if (member) onClearMember(member.authorId);
          onAnswered();
        }}
        onCancel={onAnswered}
      />
    </>
  );
}

const FILLS: SegOption<boolean>[] = [{ value: false, label: 'Outline' }, { value: true, label: 'Filled' }];
const SNAPS: SegOption<boolean>[] = [{ value: true, label: 'Grid' }, { value: false, label: 'Off' }];
const AUDIENCES: SegOption<boolean>[] = [{ value: false, label: 'Everyone' }, { value: true, label: 'Only me' }];

/** The colour's name at the caption's right: the user's own, a named one, or Custom. */
export function drawColourName(colour: string, playerColour: string): string {
  const c = colour.toLowerCase();
  if (c === playerColour.toLowerCase()) return 'Your colour';
  const named = (DRAWING_LIMITS.namedColors as readonly string[]).indexOf(c);
  return named >= 0 ? COLOUR_NAMES[named] : 'Custom';
}

/** The swatches: the user's player colour first, then the eight named. */
export const drawSwatches = (playerColour: string): Swatch[] => [
  { name: 'Your colour', value: playerColour, me: true },
  ...DRAWING_LIMITS.namedColors.map((value, i) => ({ name: COLOUR_NAMES[i], value })),
];

/** Draw's card body (the rail's pencil; on a phone the same body as a strip). */
export default function DrawControls({
  kind, onKindChange, settings, onSettingsChange, isGM, onlyErase = false, polygonCorners, onPolygonDone, onPolygonCancel, clearable, onClear, members, onClearMember, playerColour,
}: DrawControlsProps) {
  const [asking, setAsking] = useState<ClearAsking>(null);
  const tools: SegOption<DrawToolKind>[] = DRAW_TOOL_KINDS.filter((tool) => !onlyErase || tool === 'eraser')
    .map((tool) => ({ value: tool, label: TOOLS[tool].short, icon: TOOLS[tool].icon, title: TOOLS[tool].label }));

  return (
    <>
      <Seg label="Tool" options={tools} value={kind} onChange={(v) => v && onKindChange(v)} columns={onlyErase ? 1 : 3} tools />
      <Help>
        {onlyErase && 'Drawing is off for now. '}
        {HINTS[kind]}
        {kind === 'eraser' && !isGM && ' You can erase only your own.'}
      </Help>

      {kind === 'polygon' && polygonCorners > 0 && (
        <ButtonRow>
          <CardButton onClick={onPolygonDone} disabled={polygonCorners < 3} pressed>Done</CardButton>
          <CardButton onClick={onPolygonCancel}>Cancel</CardButton>
        </ButtonRow>
      )}

      {kind !== 'eraser' && (
        <ColourGrid
          label="Colour"
          swatches={drawSwatches(playerColour)}
          value={settings.color}
          valueName={drawColourName(settings.color, playerColour)}
          onChange={(color) => onSettingsChange({ color })}
        />
      )}
      {kind !== 'eraser' && kind !== 'laser' && (
        <Slider
          label="Width"
          valueText={kind === 'text' ? `${settings.width} (letters ${settings.width * 4} px)` : String(settings.width)}
          min={DRAWING_LIMITS.minWidth}
          max={DRAWING_LIMITS.maxWidth}
          step={1}
          value={settings.width}
          onChange={(width) => onSettingsChange({ width })}
        />
      )}
      {FILLABLE.has(kind) && <Seg label="Fill" options={FILLS} value={settings.fill} onChange={(v) => v !== null && onSettingsChange({ fill: v })} />}
      {SHAPES.has(kind) && <Seg label="Snap" options={SNAPS} value={settings.snap} onChange={(v) => v !== null && onSettingsChange({ snap: v })} />}

      {/* The laser pointer goes to everyone, so who sees it is not asked. */}
      {isGM && kind !== 'eraser' && kind !== 'laser' && (
        <Seg label="Who sees it" options={AUDIENCES} value={settings.gmOnly} onChange={(v) => v !== null && onSettingsChange({ gmOnly: v })} />
      )}
      {isGM && kind === 'laser' && <Help>Everyone sees the laser pointer.</Help>}

      <Sep />
      <CardButton onClick={() => (isGM ? setAsking('all') : onClear())} disabled={clearable === 0} danger>
        {isGM ? 'Clear drawings' : 'Clear mine'}
      </CardButton>
      {isGM && members.map((member) => (
        <CardButton key={member.authorId} onClick={() => setAsking(member)} danger>
          {`Clear ${drawingsOf(member)} (${member.count})`}
        </CardButton>
      ))}

      <ClearDrawingsDialogs asking={asking} onAnswered={() => setAsking(null)} clearable={clearable} onClear={onClear} onClearMember={onClearMember} />
    </>
  );
}
