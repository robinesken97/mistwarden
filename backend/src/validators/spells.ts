/**
 * What a spell in the Spell Library may be: as an administrator or a GM
 * writes one, as the SRD seed stores one, and as a campaign archive carries
 * one. Its area takes the AoE tool's shapes and limits (areaLimits.ts), so
 * any spell's area can be placed on a map as it is.
 */

import { z } from 'zod';
import { GameSystemSchema } from './gameSystem';
import { AREA_ELEMENTS, AREA_LIMITS, AREA_SHAPES } from './areaLimits';
import { AREA_ELEMENT_REFUSAL, AREA_SHAPE_REFUSAL, AREA_SIZE_REFUSAL, AREA_WIDTH_REFUSAL, AREA_WIDTH_ON_SHAPE_REFUSAL } from './areas';

export const SPELL_LIMITS = {
  maxNameLength: 100,
  /** School, casting time, range, duration. */
  maxShortLength: 300,
  /** With the material, which in the SRD runs to over 300 characters (Clone). */
  maxComponentsLength: 1000,
  /** The SRD's longest description is under 7,000 characters. */
  maxDescriptionLength: 20_000,
} as const;

export const SpellAreaSchema = z
  .object({
    shape: z.enum(AREA_SHAPES, { error: AREA_SHAPE_REFUSAL }),
    sizeFt: z.number({ error: AREA_SIZE_REFUSAL }).int({ error: AREA_SIZE_REFUSAL })
      .min(AREA_LIMITS.minSizeFt, { error: AREA_SIZE_REFUSAL }).max(AREA_LIMITS.maxSizeFt, { error: AREA_SIZE_REFUSAL }),
    widthFt: z.number({ error: AREA_WIDTH_REFUSAL }).int({ error: AREA_WIDTH_REFUSAL })
      .min(AREA_LIMITS.minWidthFt, { error: AREA_WIDTH_REFUSAL }).max(AREA_LIMITS.maxWidthFt, { error: AREA_WIDTH_REFUSAL })
      .optional(),
  }, { error: "A spell's area is a shape and a size in feet, or none" })
  .refine((a) => a.shape === 'line' || a.widthFt === undefined, { error: AREA_WIDTH_ON_SHAPE_REFUSAL });

const short = (what: string, max: number = SPELL_LIMITS.maxShortLength) =>
  z.string({ error: `A spell's ${what} is text` }).trim()
    .max(max, { error: `A spell's ${what} is at most ${max} characters` })
    .transform((s) => (s === '' ? null : s)).nullable().optional();

const spellFields = {
  gameSystem: GameSystemSchema.nullable().optional(),
  level: z.number({ error: "A spell's level is a whole number from 0 (a cantrip) to 9" }).int().min(0).max(9),
  school: short('school'),
  castingTime: short('casting time'),
  range: short('range'),
  components: short('components', SPELL_LIMITS.maxComponentsLength),
  duration: short('duration'),
  concentration: z.boolean().optional(),
  ritual: z.boolean().optional(),
  description: z.string().max(SPELL_LIMITS.maxDescriptionLength, {
    error: `A spell's description is at most ${SPELL_LIMITS.maxDescriptionLength.toLocaleString('en-US')} characters`,
  }).optional(),
  area: SpellAreaSchema.nullable().optional(),
  element: z.enum(AREA_ELEMENTS, { error: AREA_ELEMENT_REFUSAL }).optional(),
};

const name = z.string({ error: 'A spell needs a name' }).trim()
  .min(1, { error: 'A spell needs a name' })
  .max(SPELL_LIMITS.maxNameLength, { error: `A spell's name is at most ${SPELL_LIMITS.maxNameLength} characters` });

export const CreateSpellSchema = z.object({ name, ...spellFields, level: spellFields.level.default(0) }, { error: 'Invalid spell' });
export const UpdateSpellSchema = z.object({ name, ...spellFields }, { error: 'Invalid spell' }).partial();

export type CreateSpell = z.infer<typeof CreateSpellSchema>;
export type SpellAreaData = z.infer<typeof SpellAreaSchema>;
