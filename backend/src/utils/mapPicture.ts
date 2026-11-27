// Added for Mistwarden on 2026-11-27.
/**
 * Large map pictures are shrunk when they arrive.
 *
 * A browser holds a picture unpacked, four bytes a pixel: a 9,000 pixel map
 * takes over 300 MB in every player's tab, more than a tablet with 2 GB can
 * keep, and the canvas it is drawn on holds no more than 4,096 squared
 * anyway (MAX_BACKING_PIXELS in the frontend). Walls, lights and tokens are
 * stored in map pixels, not picture pixels, and the picture is stretched
 * across the map, so nothing else has to change with it.
 *
 * Animated pictures are left as they are: shrinking every frame is a job
 * of its own, and their pixels are capped by pictureLimits.ts.
 */

import { openPicture } from './sharpInput';

/** The longest side a stored map picture may have, in pixels. */
export const MAP_PICTURE_MAX_SIDE = 4096;

/**
 * The picture shrunk to MAP_PICTURE_MAX_SIDE on its longer side, in its own
 * format, or null when it fits already or is animated. `input` is bytes or
 * the path of a file nothing rewrites, already checked by pictureLimits.ts.
 */
export async function shrinkMapPicture(input: Buffer | string): Promise<Buffer | null> {
  const image = await openPicture(input, { limitInputPixels: false });
  const { width = 0, height = 0, pages = 1, format } = await image.metadata();
  if (pages > 1 || Math.max(width, height) <= MAP_PICTURE_MAX_SIDE) return null;
  return image
    // The output carries no EXIF, so a turned photo is turned now, as a browser would show it.
    .rotate()
    .resize(MAP_PICTURE_MAX_SIDE, MAP_PICTURE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .toFormat(format as 'png' | 'jpeg' | 'webp' | 'gif', format === 'jpeg' || format === 'webp' ? { quality: 90 } : {})
    .toBuffer();
}
