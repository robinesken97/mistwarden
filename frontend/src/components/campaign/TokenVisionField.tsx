/**
 * TokenVisionField
 * The one control for a token's darkvision, used wherever a token is edited
 * (the Token Manager when placing, the Quick Editor afterwards), so the
 * label, the hint and the bounds are written once.
 *
 * A form that saves later listens to `onChange`, every keystroke. An editor
 * that saves at once listens to `onCommit`, which fires on blur or Enter with
 * the final value, so typing "12" is one save, not one per digit.
 */

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { api } from '@/services/api';
import { GameSystem, type Character } from '@/types';

export const MAX_SIGHT_RADIUS = 200;

/**
 * Feet as squares on a map of this scale, the way the server converts the
 * sheet's darkvision for a linked token (routes/characters.ts), so the two
 * agree on whether the token already has it. Not rounded: 60 ft at 25 ft a
 * square is 2.4.
 */
export function squaresForFeet(feet: number, feetPerSquare: number): number {
  return Math.min(MAX_SIGHT_RADIUS, Math.max(0, feet / (feetPerSquare || 5)));
}

/** The darkvision a 5E sheet records, in feet, or undefined for none or another system. */
export function sheetDarkvisionFeet(character: Character | undefined): number | undefined {
  if (character?.gameSystem !== GameSystem.FIFTH_EDITION) return undefined;
  const feet = (character.data as { darkvisionFeet?: unknown } | undefined)?.darkvisionFeet;
  return typeof feet === 'number' && feet > 0 ? feet : undefined;
}

/**
 * The linked character's sheet darkvision, for the GM's token editors: the
 * campaign's character list carries no sheets, so the one character is
 * fetched. Undefined while loading, on failure, or for no character.
 *
 * shortcut: a plain fetch, not react-query, so the token editors need no
 * QueryClient (nor their tests); refetched only when the id changes. Move to
 * a query hook if the sheet is wanted live while an editor stays open.
 */
export function useSheetDarkvisionFeet(characterId: string | null | undefined): number | undefined {
  const [sheet, setSheet] = useState<{ id: string; feet: number | undefined }>();
  useEffect(() => {
    if (!characterId) return;
    let live = true;
    Promise.resolve()
      .then(() => api.getCharacter(characterId))
      .then(({ character }) => { if (live) setSheet({ id: characterId, feet: sheetDarkvisionFeet(character) }); })
      .catch(() => { /* no hint: the GM sets the sight by hand */ });
    return () => { live = false; };
  }, [characterId]);
  return characterId && sheet?.id === characterId ? sheet.feet : undefined;
}

interface TokenVisionFieldProps {
  /** Darkvision in grid squares; 0 = none. */
  value: number;
  /** The map's scale, so the hint's feet are right for it (12 squares is 60 ft only at 5). */
  feetPerSquare: number;
  onChange?: (squares: number) => void;
  onCommit?: (squares: number) => void;
  disabled?: boolean;
  /**
   * The linked character's sheet darkvision, in feet. When it is not what the
   * field holds, a hint offers to apply it: a player may enter it on their
   * own sheet, and only the GM may put it on the token.
   */
  sheetFeet?: number;
}

/** A whole number of squares within the bounds, or null for nonsense. */
function squaresFrom(raw: string): number | null {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(MAX_SIGHT_RADIUS, n));
}

export default function TokenVisionField({ value, feetPerSquare, onChange, onCommit, disabled, sheetFeet }: TokenVisionFieldProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    // A sight the sheet set need not be whole (60 ft at 25 ft a square is
    // 2.4); leaving the box untouched must not round it.
    if (draft.trim() !== '' && Number(draft) === value) return;
    const squares = squaresFrom(draft);
    if (squares === null) { setDraft(String(value)); return; }
    setDraft(String(squares));
    if (squares !== value) onCommit?.(squares);
  };

  const sheetSquares = sheetFeet === undefined ? undefined : squaresForFeet(sheetFeet, feetPerSquare);
  const applySheet = () => {
    if (sheetSquares === undefined) return;
    setDraft(String(sheetSquares));
    onChange?.(sheetSquares);
    onCommit?.(sheetSquares);
  };

  return (
    <div className="mb-3">
      <label className="text-xs text-stone-gray font-medium block mb-1">
        Darkvision <span className="font-normal opacity-60">(squares)</span>
      </label>
      <input
        type="number"
        min={0}
        max={MAX_SIGHT_RADIUS}
        step={1}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          const squares = squaresFrom(e.target.value);
          if (squares !== null) onChange?.(squares);
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        aria-label="Darkvision in grid squares"
        className="input-cozy input-cozy-number w-full text-sm"
      />
      {sheetSquares !== undefined && sheetSquares !== value && (
        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="text-xs text-stone-gray">Sheet: {sheetFeet} ft</span>
          <Button
            variant="secondary" className="text-xs py-1 px-2"
            onClick={applySheet}
            disabled={disabled}
            aria-label={`Apply the sheet's darkvision, ${sheetFeet} ft`}
          >
            Apply
          </Button>
        </div>
      )}
      <p className="text-[10px] text-stone-gray/60 mt-1">
        How far this token makes things out with no light. 0 = none, 12 = {12 * feetPerSquare} ft on this map. Lit things are seen at any distance.
      </p>
    </div>
  );
}
