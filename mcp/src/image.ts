// Added for Mistwarden on 2026-11-27.
// Picture size and type from the file header, for the formats the server takes.

export interface PictureInfo {
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

// shortcut: ignores JPEG EXIF rotation; a sideways phone photo reports its stored size. Upgrade if such maps turn up.
export function pictureInfo(b: Buffer): PictureInfo {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') {
    return { mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { mime: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      // Start-of-frame markers carry the size; C4, C8 and CC are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  throw new Error('Not a PNG, JPEG, WebP or GIF picture.');
}
