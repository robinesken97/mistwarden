// Added for Mistwarden on 2026-11-27.
/** The names and tags a ZIP import gives its pictures. */

import { nameFromFile, tagsFor } from '../assetZipImport';

describe('nameFromFile', () => {
  it('drops the extension, reads underscores as spaces and collapses spaces', () => {
    expect(nameFromFile('brown_horse.png')).toBe('brown horse');
    expect(nameFromFile('  Giant   Rat .webp')).toBe('Giant Rat');
    expect(nameFromFile('half-orc.v2.png')).toBe('half-orc.v2');
  });

  it('composes a name a Mac wrote decomposed', () => {
    expect(nameFromFile('Bär.png')).toBe('Bär');
  });
});

describe('tagsFor', () => {
  it('puts the given tags first, keeps each once and never the tag kept for Paint', () => {
    expect(tagsFor(['Beasts', 'beasts', 'cozyvtt-drawn-map', 'Höhle'], ['Drive'])).toEqual(['Drive', 'Beasts', 'beasts', 'Höhle']);
  });

  it('cuts a long folder name and keeps at most 50 tags', () => {
    expect(tagsFor(['x'.repeat(80)], [])).toEqual(['x'.repeat(50)]);
    expect(tagsFor(Array.from({ length: 60 }, (_, i) => `t${i}`), [])).toHaveLength(50);
  });
});
