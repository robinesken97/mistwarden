// Ported for Mistwarden on 2026-11-27 from the author's earlier mistwarden-vtt (apps/client/src/dice), same author.
// Dice animation setting per device.
export const DICE_MODES = ['3d', 'simple', 'off'] as const;
export type DiceMode = (typeof DICE_MODES)[number];

/** Unknown or missing values mean: 3D. */
export function parseDiceMode(value: string | null): DiceMode {
  return DICE_MODES.includes(value as DiceMode) ? (value as DiceMode) : '3d';
}
