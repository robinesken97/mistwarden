// Added for Mistwarden on 2026-11-27.
import { describe, it, expect } from 'vitest';
import { TOKEN_ICONS } from '@/utils/tokenIcons';
import { tokenIcon, tokenIconUrl } from '../tokenSymbols';

describe('token symbols', () => {
  it('has a file for every symbol a token may name', () => {
    expect(TOKEN_ICONS.filter((icon) => !tokenIconUrl(icon))).toEqual([]);
  });

  it('takes the token\'s own symbol, then its stat block\'s creature type, then its class, then a person', () => {
    const classIcons = { 'char-1': 'rogue' as const };
    expect(tokenIcon({ icon: 'dragon', statBlock: { creatureType: 'Huge beast' } as never, characterId: 'char-1' }, classIcons)).toBe('dragon');
    expect(tokenIcon({ icon: null, statBlock: { creatureType: 'Huge beast' } as never, characterId: 'char-1' }, classIcons)).toBe('beast');
    expect(tokenIcon({ icon: null, statBlock: null, characterId: 'char-1' }, classIcons)).toBe('rogue');
    expect(tokenIcon({ statBlock: null, characterId: null }, classIcons)).toBe('person');
  });
});
