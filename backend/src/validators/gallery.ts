// Added for Mistwarden on 2026-11-27.
/**
 * A campaign's gallery: pictures the GM files in folders and shows to players.
 * Whether a picture, or a player it is shown to, belongs to the campaign is
 * decided by the route against the database.
 */

import { z } from 'zod';

const name = z.string().trim().min(1, 'A picture needs a name').max(120, 'A name can be at most 120 characters');
const folder = z.string().trim().max(80, 'A folder name can be at most 80 characters');

export const AddGalleryPictureSchema = z.object({
  assetId: z.string().uuid('A picture must be named by its asset id'),
  name,
  folder: folder.optional(),
});

export const UpdateGalleryPictureSchema = z
  .object({
    name: name.optional(),
    folder: folder.optional(),
    shownToAll: z.boolean().optional(),
    shownTo: z.array(z.string().uuid('Players are named by their user id')).max(100).optional(),
  })
  .strict();
