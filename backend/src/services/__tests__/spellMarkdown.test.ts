/**
 * Spells read from Markdown (spellMarkdown.ts): the header's level, school
 * and fields, written as lines or as list items, the description up to the
 * next heading, and the reasons a heading is skipped or a block refused.
 *
 * The spells are invented for these tests.
 */

import { readSpellMarkdown, titleCase, SKIPPED_NO_CASTING_TIME, SKIPPED_OUTSIDE_HEADING } from '../spellMarkdown';
import { SPELL_LIMITS } from '../../validators/spells';

/** Header lines as the files write them: each ends in two spaces, a Markdown line break. */
const header = (...lines: string[]) => lines.map((line) => `${line}  `).join('\n');

const LEVELLED = `### Cinder Fan

${header('*3rd-level evocation*', '**Casting Time:** 1 action', '**Range:** Self (30-foot cone)', '**Components:** V, S, M (a pinch of ash)', '**Duration:** Instantaneous')}

Embers sweep out from your hand. Each creature in a 30-foot cone must make a Dexterity saving throw, taking $6\\text{d}6$ fire damage on a failed save.

**At Higher Levels.** When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.
`;

const spellOf = (markdown: string) => {
  const row = readSpellMarkdown(markdown).rows.find((r) => r.status === 'spell');
  if (!row || row.status !== 'spell') throw new Error('No spell read');
  return row;
};

describe('readSpellMarkdown', () => {
  it('reads a levelled spell: fields, description with its higher-levels paragraph, area and look', () => {
    const { spell, warnings } = spellOf(LEVELLED);
    expect(spell).toMatchObject({
      name: 'Cinder Fan', gameSystem: 'FIFTH_EDITION', level: 3, school: 'Evocation', castingTime: '1 action',
      range: 'Self (30-foot cone)', components: 'V, S, M (a pinch of ash)', duration: 'Instantaneous',
      concentration: false, ritual: false, area: { shape: 'cone', sizeFt: 30 }, element: 'fire',
    });
    expect(spell.description).toBe(
      'Embers sweep out from your hand. Each creature in a 30-foot cone must make a Dexterity saving throw, taking 6d6 fire damage on a failed save.\n\n'
      + '**At Higher Levels.** When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.',
    );
    expect(warnings).toEqual([]);
    // A byte order mark at the start of a file is no part of its first heading.
    expect(spellOf(`\uFEFF${LEVELLED}`).name).toBe('Cinder Fan');
  });

  it('reads a cantrip, a ritual and a concentration spell', () => {
    const file = `### Pebble Song
*Transmutation cantrip*
**Casting Time:** 1 action
**Range:** 10 feet
**Components:** V
**Duration:** 1 minute

A pebble hums.

### Quiet Lantern
*1st-level divination (ritual)*
**Casting Time:** 10 minutes
**Range:** Touch
**Components:** V, S
**Duration:** Concentration, up to 1 hour

A lantern glows in a 20-foot-radius sphere around it.
`;
    const [cantrip, ritual] = readSpellMarkdown(file).rows;
    expect(cantrip).toMatchObject({ status: 'spell', spell: { level: 0, school: 'Transmutation', ritual: false, concentration: false, area: null, element: 'none' } });
    expect(ritual).toMatchObject({
      status: 'spell',
      spell: { level: 1, school: 'Divination', ritual: true, concentration: true, duration: 'Concentration, up to 1 hour', area: { shape: 'sphere', sizeFt: 20 } },
    });
  });

  it('reads fields written as list items under a heading in capitals, and leaves the rule between spells out', () => {
    const file = `## SPELLS

## BRAMBLE OF THE NORTH WIND

*2nd-level conjuration*

* **Casting Time:** 1 bonus action
- **Range:** 60 feet
* **Components:** V, S
* **Duration:** Concentration, up to 1 minute

Thorns fill a 10-foot cube.

***At Higher Levels.*** The cube grows by 5 feet for each slot level above 2nd.

---
`;
    const result = readSpellMarkdown(file);
    expect(result.castingTimeLines).toBe(1);
    expect(result.rows.map((r) => [r.name, r.status])).toEqual([['Spells', 'skipped'], ['Bramble of the North Wind', 'spell']]);
    const row = result.rows[1];
    if (row.status !== 'spell') throw new Error('not a spell');
    expect(row.spell).toMatchObject({ level: 2, castingTime: '1 bonus action', range: '60 feet', concentration: true, area: { shape: 'cube', sizeFt: 10 } });
    expect(row.spell.description).toBe('Thorns fill a 10-foot cube.\n\n***At Higher Levels.*** The cube grows by 5 feet for each slot level above 2nd.');
    expect(row.warnings).toEqual(['Name written in capitals: stored as "Bramble of the North Wind"']);
  });

  it('skips a spell list or summary chapter, whose headings have no Casting Time', () => {
    const file = `# Chapter: Spell Lists

## Spells Beginning with Q

### Quiet Lantern
* *School:* 1st-level divination | *Casting Time:* 10 minutes
* **Summary:** A lantern glows.
`;
    const result = readSpellMarkdown(file);
    expect(result.castingTimeLines).toBe(0);
    expect(result.rows.map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(result.rows[2]).toMatchObject({ name: 'Quiet Lantern', reason: SKIPPED_NO_CASTING_TIME });
  });

  it('says where a block ends early: a page marker before more text, a heading below it', () => {
    const file = `${LEVELLED}
<!-- p. 12 -->

More text after the marker.

#### Ember Familiar
*Tiny elemental*
`;
    const [spell, familiar] = readSpellMarkdown(file).rows;
    expect(spell.status).toBe('spell');
    expect(spell.status === 'spell' && spell.warnings).toEqual([
      expect.stringMatching(/^Ends at the page marker on line \d+: 1 line\(s\) after it/),
      expect.stringMatching(/^Ends at the heading "Ember Familiar" on line \d+, read as a block of its own$/),
    ]);
    expect(familiar).toMatchObject({ status: 'skipped', reason: SKIPPED_NO_CASTING_TIME });
  });

  it('refuses a block with no level line or with two spells in it, and says why', () => {
    const noLevel = LEVELLED.replace('*3rd-level evocation*  \n', '');
    expect(readSpellMarkdown(noLevel).rows[0]).toMatchObject({ status: 'error', errors: [expect.stringMatching(/^No level and school line/)] });

    const merged = `${LEVELLED}\n${LEVELLED.split('\n').slice(2).join('\n')}`;
    const result = readSpellMarkdown(merged);
    expect(result.castingTimeLines).toBe(2);
    expect(result.rows).toEqual([expect.objectContaining({ status: 'error', errors: [expect.stringMatching(/a second Casting Time in the text/)] })]);
  });

  it('refuses rather than cuts text over the library\'s limits', () => {
    const long = LEVELLED.replace('Embers sweep', `${'x'.repeat(SPELL_LIMITS.maxDescriptionLength)} Embers sweep`);
    expect(readSpellMarkdown(long).rows[0]).toMatchObject({ status: 'error', errors: [expect.stringMatching(/description is at most/)] });
  });

  it('lists a Casting Time before the first heading, and fields it has no place for', () => {
    const file = `**Casting Time:** 1 action\n\n${LEVELLED.replace('**Duration:** Instantaneous  \n', '**Duration:** Instantaneous  \n**Glow:** faint  \n')}`;
    const result = readSpellMarkdown(file);
    expect(result.castingTimeLines).toBe(2);
    expect(result.rows[0]).toMatchObject({ status: 'skipped', reason: SKIPPED_OUTSIDE_HEADING });
    expect(result.rows[1]).toMatchObject({ status: 'spell', warnings: [expect.stringMatching(/field "Glow" has no place in a spell/)] });
  });
});

describe('titleCase', () => {
  it('capitalises each word and each part of a hyphenated one, not the small words', () => {
    expect(titleCase("LANTERN OF THE MOSS-KING'S WAKE")).toBe("Lantern of the Moss-King's Wake");
    expect(titleCase('THE GREY OWL')).toBe('The Grey Owl');
  });
});
