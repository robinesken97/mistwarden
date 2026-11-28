/**
 * What a spell area on a map can be, and the limits on it.
 *
 * The server enforces them and the AoE panel keeps to them. This file exists
 * twice, as backend/src/validators/areaLimits.ts and
 * frontend/src/constants/areaLimits.ts, and a test keeps the two copies
 * identical, so the panel never offers what the server refuses.
 */

/** A sphere and a cylinder are a circle seen from above; a cube stays square to the grid. */
export const AREA_SHAPES = ['sphere', 'cylinder', 'cone', 'line', 'cube'] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

/**
 * How an area looks: a colour and a pattern each, not a damage type. `none`
 * is a plain template.
 */
export const AREA_ELEMENTS = [
  'fire', 'cold', 'water', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'thunder', 'force', 'psychic', 'none',
] as const;
export type AreaElement = (typeof AREA_ELEMENTS)[number];

export const AREA_LIMITS = {
  /**
   * Areas one share of a map holds: the GM's (those for the GM alone, and
   * the campaign's GM's own) and the players' (every other), so players
   * filling theirs never stop the GM placing one.
   */
  perShare: 100,
  /** A radius, length or side, in feet. */
  minSizeFt: 5,
  maxSizeFt: 500,
  /** A line's width, in feet. */
  minWidthFt: 5,
  maxWidthFt: 100,
  /** Characters in a label. */
  maxLabelLength: 60,
  /** Characters in the reference to the spell it came from. */
  maxSpellIdLength: 64,
} as const;
