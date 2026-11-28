/**
 * What a spell area on a map may be, as `area:add` takes it and a campaign
 * archive carries it (validators/areaLimits.ts holds the lists and limits).
 */

import { z } from 'zod';
import { AREA_ELEMENTS, AREA_LIMITS, AREA_SHAPES } from './areaLimits';
import { DRAWING_AUDIENCES } from './drawingLimits';
import { cleanLabel } from './drawings';
import { geometryRegion, type MapExtent } from './maps';

export { AREA_ELEMENTS, AREA_LIMITS, AREA_SHAPES } from './areaLimits';

export const AREA_SHAPE_REFUSAL = `An area must be one of: ${AREA_SHAPES.join(', ')}`;
export const AREA_ELEMENT_REFUSAL = `An area's element must be one of: ${AREA_ELEMENTS.join(', ')}`;
export const AREA_SIZE_REFUSAL = `An area's size is a whole number of feet from ${AREA_LIMITS.minSizeFt} to ${AREA_LIMITS.maxSizeFt}`;
export const AREA_WIDTH_REFUSAL = `A line's width is a whole number of feet from ${AREA_LIMITS.minWidthFt} to ${AREA_LIMITS.maxWidthFt}`;
export const AREA_WIDTH_ON_SHAPE_REFUSAL = 'Only a line has a width';
export const AREA_ANCHOR_REFUSAL = "An area's anchor is a point in map pixels";
export const AREA_ANGLE_REFUSAL = "An area's angle is radians from -2π to 2π";
export const AREA_LABEL_REFUSAL = `An area's label is at most ${AREA_LIMITS.maxLabelLength} characters`;
export const AREA_SPELL_REFUSAL = `An area's spell is at most ${AREA_LIMITS.maxSpellIdLength} characters`;
export const AREA_OUTSIDE_MAP_MESSAGE = 'An area must be placed on the map.';
export const AREA_SHARE_FULL = {
  GM: `This map holds ${AREA_LIMITS.perShare} areas of the GM's already. Erase one, then place it again.`,
  PLAYERS: `The players have placed ${AREA_LIMITS.perShare} areas on this map already. Erase one, then place it again.`,
} as const;

const coordinate = z.number({ error: AREA_ANCHOR_REFUSAL }).finite({ error: AREA_ANCHOR_REFUSAL });

/** An area as it is placed: everything but its id, author and time, which the server sets. */
export const NewAreaSchema = z
  .object(
    {
      shape: z.enum(AREA_SHAPES, { error: AREA_SHAPE_REFUSAL }),
      anchorX: coordinate,
      anchorY: coordinate,
      angle: z.number({ error: AREA_ANGLE_REFUSAL }).finite({ error: AREA_ANGLE_REFUSAL })
        .min(-2 * Math.PI, { error: AREA_ANGLE_REFUSAL }).max(2 * Math.PI, { error: AREA_ANGLE_REFUSAL }).default(0),
      sizeFt: z.number({ error: AREA_SIZE_REFUSAL }).int({ error: AREA_SIZE_REFUSAL })
        .min(AREA_LIMITS.minSizeFt, { error: AREA_SIZE_REFUSAL }).max(AREA_LIMITS.maxSizeFt, { error: AREA_SIZE_REFUSAL }),
      widthFt: z.number({ error: AREA_WIDTH_REFUSAL }).int({ error: AREA_WIDTH_REFUSAL })
        .min(AREA_LIMITS.minWidthFt, { error: AREA_WIDTH_REFUSAL }).max(AREA_LIMITS.maxWidthFt, { error: AREA_WIDTH_REFUSAL })
        .nullable().default(null),
      exact: z.boolean().default(false),
      element: z.enum(AREA_ELEMENTS, { error: AREA_ELEMENT_REFUSAL }).default('none'),
      animated: z.boolean().default(true),
      // Cleaned as a drawing's text is; a blank one is none.
      label: z.string({ error: AREA_LABEL_REFUSAL }).transform(cleanLabel)
        .pipe(z.string().max(AREA_LIMITS.maxLabelLength, { error: AREA_LABEL_REFUSAL }))
        .transform((s) => (s === '' ? null : s)).nullable().default(null),
      spellId: z.string({ error: AREA_SPELL_REFUSAL }).min(1, { error: AREA_SPELL_REFUSAL })
        .max(AREA_LIMITS.maxSpellIdLength, { error: AREA_SPELL_REFUSAL }).nullable().default(null),
      audience: z.enum(DRAWING_AUDIENCES).default('ALL'),
    },
    { error: 'Invalid area' }
  )
  .refine((a) => a.shape === 'line' || a.widthFt === null, { error: AREA_WIDTH_ON_SHAPE_REFUSAL });

export type NewArea = z.infer<typeof NewAreaSchema>;

/** Whether an area's anchor lies outside the region its map's walls and drawings may reach (validators/maps.ts). */
export function areaOutsideMap(area: { anchorX: number; anchorY: number }, map: MapExtent): boolean {
  const r = geometryRegion(map);
  return area.anchorX < r.minX || area.anchorX > r.maxX || area.anchorY < r.minY || area.anchorY > r.maxY;
}

const MapIdSchema = z.uuid({ error: 'Map not found' });

/** `area:add`: an area for a map. */
export const AreaAddEventSchema = z.object({ mapId: MapIdSchema, area: NewAreaSchema }, { error: 'Map not found' });

/** `area:remove`: one area, by its id. */
export const AreaRemoveEventSchema = z.object(
  { mapId: MapIdSchema, areaId: z.uuid({ error: 'Area not found' }) },
  { error: 'Map not found' }
);

/** `area:clear`: a map's areas, every one for the GM, a player's own for a player. */
export const AreaClearEventSchema = z.object({ mapId: MapIdSchema }, { error: 'Map not found' });

/** `areas:request`: a map's areas, as the sender may be sent them. */
export const AreasRequestEventSchema = z.object({ mapId: MapIdSchema });
