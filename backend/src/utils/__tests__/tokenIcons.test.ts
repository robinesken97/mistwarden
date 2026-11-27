// Added for Mistwarden on 2026-11-27.
import { classIcon, creatureTypeIcon, isTokenIcon, statBlockIcon, TOKEN_ICONS } from '../tokenIcons';

describe('token symbols', () => {
  it('reads the creature type a stat block writes', () => {
    expect(creatureTypeIcon('Medium humanoid (goblinoid)')).toBe('humanoid');
    expect(creatureTypeIcon('Large Beast')).toBe('beast');
    expect(creatureTypeIcon('Medium swarm of Tiny beasts')).toBe('beast');
    expect(creatureTypeIcon('Gargantuan monstrosity (titan)')).toBe('monstrosity');
    expect(creatureTypeIcon('Medium creature')).toBeNull();
    expect(creatureTypeIcon(undefined)).toBeNull();
    expect(statBlockIcon({ creatureType: 'Huge giant' })).toBe('giant');
    expect(statBlockIcon(null)).toBeNull();
  });

  it('reads the first class a sheet names', () => {
    expect(classIcon('Wizard 2 / Fighter 3')).toBe('wizard');
    expect(classIcon('rogue')).toBe('rogue');
    expect(classIcon('Commoner')).toBeNull();
    expect(classIcon(7)).toBeNull();
  });

  it('allows only the symbols it has files for', () => {
    expect(TOKEN_ICONS).toHaveLength(27);
    expect(isTokenIcon('person')).toBe(true);
    expect(isTokenIcon('../../etc/passwd')).toBe(false);
  });
});
