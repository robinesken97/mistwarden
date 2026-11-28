/**
 * The area and look the spell seed reads from an SRD spell's own words, on
 * sentences Open5e served (fixtures/open5eSrdSpells.json, SRD 5.1 under
 * CC BY 4.0; see its `_source`). A wrong area is worse than none, so the
 * phrases that name something else (the light a flame sheds, the cube an
 * illusion must fit in) leave a spell without one.
 */

import fixture from './fixtures/open5eSrdSpells.json';
import { spellAreaFromText, spellElementFromText } from '../spellAreaText';
import { SRD_SPELL_OVERRIDES } from '../spellSeed';

const spell = (name: string) => {
  const found = fixture.spells.find((s) => s.name === name);
  if (!found) throw new Error(`No fixture for ${name}`);
  return found;
};
const areaOf = (name: string) => spellAreaFromText(spell(name).range, spell(name).desc);
const elementOf = (name: string) => spellElementFromText(spell(name).desc);

describe('spellAreaFromText', () => {
  it.each([
    ['Burning Hands', { shape: 'cone', sizeFt: 15 }],
    ['Lightning Bolt', { shape: 'line', sizeFt: 100, widthFt: 5 }],
    // The line comes before the light it sheds in a 30-foot radius.
    ['Sunbeam', { shape: 'line', sizeFt: 60, widthFt: 5 }],
    // A cylinder's radius, never its height.
    ['Moonbeam', { shape: 'cylinder', sizeFt: 5 }],
    ['Sleet Storm', { shape: 'cylinder', sizeFt: 40 }],
    ['Flame Strike', { shape: 'cylinder', sizeFt: 10 }],
    ['Fireball', { shape: 'sphere', sizeFt: 20 }],
    // Open5e's stray soft hyphens: "10-­--foot-­--radius".
    ['Shatter', { shape: 'sphere', sizeFt: 10 }],
    ['Entangle', { shape: 'cube', sizeFt: 20 }],
    ['Thunderwave', { shape: 'cube', sizeFt: 15 }],
    ['Hypnotic Pattern', { shape: 'cube', sizeFt: 30 }],
    ['Web', { shape: 'cube', sizeFt: 20 }],
  ])('reads %s', (name, area) => {
    expect(areaOf(name)).toEqual(area);
  });

  it.each([
    ['Light', 'the light it sheds in a 20-foot radius'],
    ['Silent Image', 'an image no larger than a 15-foot cube'],
    ['Disintegrate', 'a 10-foot-cube portion of a target'],
    ['Fabricate', 'an object contained within a 10-foot cube'],
    // Its radius would be 2.5 feet, less than the map can draw.
    ['Flaming Sphere', 'a 5-foot-diameter sphere'],
    ['Magic Missile', 'no area at all'],
  ])('gives %s no area: %s', (name) => {
    expect(areaOf(name)).toBeNull();
  });

  it('reads a range written with its area, and leaves out what the map cannot draw', () => {
    expect(spellAreaFromText('Self (15-foot cone)', '')).toEqual({ shape: 'cone', sizeFt: 15 });
    expect(spellAreaFromText('90 feet', 'Hail fills a cylinder (15-foot radius, 30 feet tall).')).toEqual({ shape: 'cylinder', sizeFt: 15 });
    expect(spellAreaFromText('Self (40-foot line)', 'A 40-foot-long, 10-foot-wide line of sleet.')).toEqual({ shape: 'line', sizeFt: 40, widthFt: 10 });
    expect(spellAreaFromText('Self', 'a 1000-foot-radius sphere')).toBeNull();
    expect(spellAreaFromText(null, null)).toBeNull();
  });
});

describe('spellElementFromText', () => {
  it.each([
    ['Burning Hands', 'fire'],
    ['Lightning Bolt', 'lightning'],
    ['Moonbeam', 'radiant'],
    ['Shatter', 'thunder'],
    ['Magic Missile', 'force'],
    // "takes fire damage equal to the total"
    ['Delayed Blast Fireball', 'fire'],
    // Fire and radiant: neither is the look.
    ['Flame Strike', 'none'],
    // Named, not rolled: "immune to thunder damage".
    ['Silence', 'none'],
    ['Entangle', 'none'],
  ])('gives %s the look %s', (name, element) => {
    expect(elementOf(name)).toBe(element);
  });
});

describe('the seed\'s overrides', () => {
  it('name only spells Open5e served, so none comes from memory', () => {
    expect(fixture.names).toHaveLength(319);
    expect(Object.keys(SRD_SPELL_OVERRIDES).filter((name) => !fixture.names.includes(name))).toEqual([]);
  });

  it('take Call Lightning\'s storm cloud and Conjure Elemental\'s source for no area, and Web\'s burning for no look', () => {
    expect(areaOf('Call Lightning')).toEqual({ shape: 'sphere', sizeFt: 60 });
    expect(SRD_SPELL_OVERRIDES['Call Lightning']).toEqual({ area: null });
    expect(areaOf('Conjure Elemental')).toEqual({ shape: 'cube', sizeFt: 10 });
    expect(SRD_SPELL_OVERRIDES['Conjure Elemental']).toEqual({ area: null });
    expect(elementOf('Web')).toBe('fire');
    expect(SRD_SPELL_OVERRIDES.Web).toEqual({ element: 'none' });
  });
});
