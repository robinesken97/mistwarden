// Added for Mistwarden on 2026-11-27.
/**
 * A picture written again by sharp, so what is served is never the bytes
 * that arrived: anything a file carries besides its pixels (EXIF, text
 * chunks, an appended payload) is left behind. Used by the ZIP import of
 * the asset library (services/assetZipImport.ts).
 */

import { openPicture } from './sharpInput';

/**
 * The picture at `input` encoded again in its own format, turned as its EXIF
 * says, or null when it is animated. `input` has passed pictureLimits.ts.
 */
export async function reencodePicture(input: string): Promise<Buffer | null> {
  // The pixel count was checked by pictureLimits.ts, which allows more than sharp's default.
  const image = await openPicture(input, { limitInputPixels: false });
  const { pages = 1, format } = await image.metadata();
  // shortcut: an animated GIF or WebP is stored as sent, as shrinkMapPicture leaves it; re-encode every frame if animated imports become common.
  if (pages > 1) return null;
  return image
    // The output carries no EXIF, so a turned photo is turned now, as a browser would show it.
    .rotate()
    .toFormat(format as 'png' | 'jpeg' | 'webp' | 'gif', format === 'jpeg' || format === 'webp' ? { quality: 90 } : {})
    .toBuffer();
}
