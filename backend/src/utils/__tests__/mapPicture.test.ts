// Added for Mistwarden on 2026-11-27.
import sharp from 'sharp';
import { shrinkMapPicture, MAP_PICTURE_MAX_SIDE } from '../mapPicture';
import { craftedAnimatedWebp } from '../../__tests__/helpers/animatedPictures';

const blank = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#557755' } });

describe('shrinkMapPicture', () => {
  it.each([
    ['png', () => blank(6000, 3000).png().toBuffer()],
    ['jpeg', () => blank(6000, 3000).jpeg().toBuffer()],
    ['webp', () => blank(6000, 3000).webp().toBuffer()],
  ])('shrinks a large %s to the longest side, in its own format', async (format, make) => {
    const shrunk = await shrinkMapPicture(await make());
    expect(shrunk).not.toBeNull();
    const meta = await sharp(shrunk!).metadata();
    expect(meta.format).toBe(format);
    expect([meta.width, meta.height]).toEqual([MAP_PICTURE_MAX_SIDE, MAP_PICTURE_MAX_SIDE / 2]);
  });

  it('shrinks a tall picture by its height', async () => {
    const shrunk = await shrinkMapPicture(await blank(2000, 8000).png().toBuffer());
    const meta = await sharp(shrunk!).metadata();
    expect([meta.width, meta.height]).toEqual([1024, MAP_PICTURE_MAX_SIDE]);
  });

  it('leaves a picture that fits', async () => {
    expect(await shrinkMapPicture(await blank(MAP_PICTURE_MAX_SIDE, 1000).png().toBuffer())).toBeNull();
  });

  it('leaves an animated picture', async () => {
    const animated = await craftedAnimatedWebp({ width: 5000, height: 5000, frames: 2 });
    expect(await shrinkMapPicture(animated)).toBeNull();
  });
});
