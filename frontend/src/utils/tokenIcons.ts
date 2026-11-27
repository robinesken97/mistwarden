// Added for Mistwarden on 2026-11-27.
// ============================================
// The symbols a token with no picture is drawn with: one for each creature
// type, one for each class, and a person for the rest. A token's own `icon`
// names one; without it the creature type its stat block gives decides, then
// its character's class. Byte-identical in backend/src/utils and
// frontend/src/utils (visionParity.test.ts checks): the server works out the
// creature type's symbol for a player, who is not sent the stat block, and
// the GM's client works out the same one.
// ============================================

export const CREATURE_TYPE_ICONS = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey',
  'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
] as const;

export const CLASS_ICONS = [
  'barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin',
  'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard',
] as const;

/** Every symbol a token may name, the one list the server checks `icon` against. */
export const TOKEN_ICONS = [...CREATURE_TYPE_ICONS, ...CLASS_ICONS, 'person'] as const;

export type TokenIcon = (typeof TOKEN_ICONS)[number];

export function isTokenIcon(value: unknown): value is TokenIcon {
  return typeof value === 'string' && (TOKEN_ICONS as readonly string[]).includes(value);
}

/** The first word of `text` that is one of `names` (or one with an s), ignoring case. */
function firstNamed<T extends string>(names: readonly T[], text: unknown): T | null {
  if (typeof text !== 'string') return null;
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const named = names.find((name) => word === name || word === `${name}s`);
    if (named) return named;
  }
  return null;
}

/** The symbol for a creature type as a stat block writes it: "Medium humanoid (goblinoid)" is a humanoid. */
export function creatureTypeIcon(creatureType: unknown): TokenIcon | null {
  return firstNamed(CREATURE_TYPE_ICONS, creatureType);
}

/** The symbol a stat block's creature type gives, if it has one. */
export function statBlockIcon(statBlock: unknown): TokenIcon | null {
  return statBlock && typeof statBlock === 'object'
    ? creatureTypeIcon((statBlock as { creatureType?: unknown }).creatureType)
    : null;
}

/** The symbol for a character's class as its sheet writes it: "Fighter 3 / Wizard 2" is a fighter. */
export function classIcon(className: unknown): TokenIcon | null {
  return firstNamed(CLASS_ICONS, className);
}
