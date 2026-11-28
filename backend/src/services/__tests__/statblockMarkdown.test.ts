/**
 * Reading 5e-style stat blocks from Markdown (statblockMarkdown.ts).
 *
 * The Goblin is SRD 5.1 text (CC BY 4.0, GAME_CONTENT_NOTICES.md); every
 * other creature here is invented for these tests.
 */

import {
  readStatBlockMarkdown,
  normaliseCreatureName,
  HeadingNotFoundError,
  SKIPPED_NO_ARMOR_CLASS,
  SKIPPED_ONE_LINE_FORMAT,
  SKIPPED_OUTSIDE_BLOCK,
  type MarkdownBlockRow,
} from '../statblockMarkdown';

const GOBLIN = `### Goblin

*Small humanoid (goblinoid), neutral evil*

**Armor Class** 15 (leather armor, shield)

**Hit Points** 7 (2d6)

**Speed** 30 ft.

| STR | DEX | CON | INT | WIS | CHA |
|-----|-----|-----|-----|-----|-----|
| 8 (-1) | 14 (+2) | 10 (+0) | 10 (+0) | 8 (-1) | 8 (-1) |

**Skills** Stealth +6

**Senses** darkvision 60 ft., passive Perception 9

**Languages** Common, Goblin

**Challenge** 1/4 (50 XP)

**Nimble Escape.** The goblin can take the Disengage or Hide action as a bonus action on each of its turns.

**Actions**

**Scimitar.** Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.

**Shortbow.** Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.
`;

const DRAKE = `### Thrumwing Drake

*Large dragon, chaotic neutral*

**Armor Class** 17 (natural armor)

**Hit Points** 136 (16d10 + 48)

**Speed** 40 ft., fly 80 ft.

| STR | DEX | CON | INT | WIS | CHA |
|-----|-----|-----|-----|-----|-----|
| 19 (+4) | 12 (+1) | 17 (+3) | 9 (−1) | 13 (+1) | 14 (+2) |

**Saving Throws** Dex +5, Con +7, Wis +5

**Skills** Perception +9, Sleight of Hand +5

**Damage Vulnerabilities** cold

**Damage Resistances** lightning, thunder

**Damage Immunities** fire

**Condition Immunities** frightened, prone

**Senses** blindsight 30 ft., darkvision 120 ft., passive Perception 19

**Languages** Draconic

**Challenge** 8 (3,900 XP)

**Proficiency Bonus** +4

**Actions**

**Multiattack.** The drake makes two claw attacks.

**Claw.** Melee Weapon Attack: +8 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage.

**Breath Weapons (Recharge 5–6).** The drake uses one of the following breath weapons:

**Ember Breath.** The drake exhales embers in a 30-foot cone. Each creature in that area must make a DC 15 Dexterity saving throw, taking 35 (10d6) fire damage on a failed save, or half as much on a successful one.

**Dust Breath.** The drake exhales grit in a 30-foot cone. Each creature in that area must succeed on a DC 15 Constitution saving throw or be blinded for 1 minute.

**Reactions**

**Wing Flick.** When a creature the drake can see hits it with a melee attack, the drake moves 10 feet without provoking opportunity attacks.

**Legendary Actions**

The drake can take 2 legendary actions, choosing from the options below. It regains spent legendary actions at the start of its turn.

**Tail Sweep.** The drake makes a claw attack.

**Rise (Costs 2 Actions).** The drake flies up to half its flying speed.

Thrumwing drakes nest in the hollow tops of old towers and hum when they sleep.

Their eggs are warm to the touch for a century.

<!-- p. 12 -->
`;

const LANTERN = `### Ninefold Lantern

*Small construct, unaligned*

**Armor Class** 13

**Hit Points** 27 (6d6 + 6)

**Speed** 0 ft., fly 30 ft. (hover)

| STR | DEX | CON | INT | WIS | CHA |
|-----|-----|-----|-----|-----|-----|
| 3 (-4) | 16 (+3) | 12 (+1) | 6 (-2) | 10 (+0) | 5 (-3) |

**Senses** passive Perception 10

**Languages** -

**Challenge** 2 (450 XP)

**Actions**

**Lantern Beams.** The lantern shines two of the following beams at random, at targets it can see within 60 feet of it:

1. Glare Beam. The target must succeed on a DC 12 Constitution saving throw or be blinded until the end of its next turn.

2. Chill Beam. The target takes 7 (2d6) cold damage.

If the target is an object, it is coated in frost instead.

3. Pull Beam. The target is pulled up to 10 feet toward the lantern.

A ninefold lantern is a cage of glass and brass that drifts through old mines.
`;

const ADEPT = `### Coilborn Adept

*Medium monstrosity (shapechanger, coilborn); neutral evil*

**Armor Class** 12 (15 with mage armor)

**Hit Points** 66 (12d8 + 12)

**Speed** 30 ft.

| STR | DEX | CON | INT | WIS | CHA |
|-----|-----|-----|-----|-----|-----|
| 10 (+0) | 14 (+2) | 12 (+1) | 18 (+4) | 13 (+1) | 11 (+0) |

**Saving Throws** Int +7, Wis +4

**Damage Resistance** damage from spells

**Senses** passive Perception 11

**Languages** --

**Challenge** 6 (2,300 XP)

**Spellcasting.** The adept is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 15). It has the following wizard spells prepared:

Cantrips (at will): fire bolt, light, mage hand

1st level (4 slots): mage armor,* magic missile, shield

2nd level (3 slots): misty step

*The adept casts mage armor on itself before combat.

**Form Shift.** The adept has one of the following forms:

Form 1: Coiled lower body

Form 2: Coils for arms

**Actions for Form 1**

**Constrict.** Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) bludgeoning damage.

**Actions for Form 2**

**Lash.** Melee Weapon Attack: +4 to hit, reach 10 ft., one target. Hit: 5 (1d6 + 2) bludgeoning damage.

**Bonus Actions**

**Slither.** The adept moves up to half its speed.
`;

const HOUND = `### Pebble Hound
*Small beast, unaligned*

- **Armor Class:** 12
- **Hit Points:** 19 ($3\\text{d}8 + 6$)
- **Speed:** 40 ft.

| STR | DEX | CON | INT | WIS | CHA |
|:---:|:---:|:---:|:---:|:---:|:---:|
| 13 (+1) | 14 (+2) | 14 (+2) | 3 (-4) | 12 (+1) | 6 (-2) |

- **Skills:** Perception +3
- **Senses:** Passive Perception 13
- **Languages:** —
- **Challenge:** 1/2 (100 XP)

***Stubborn.*** If damage reduces the hound to 0 hit points, it must make a Constitution saving throw with a DC of $5 + \\text{the damage taken}$.

#### Actions
***Bite.*** *Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 6 ($1\\text{d}8 + 2$) piercing damage.

---

### Pebble Hound Pack

A pack of pebble hounds uses the pebble hound statistics.
`;

const OLD = `## MARSH LURKER

Small beast, unaligned

Armor Class 12 Hit Points 9 (2d8) Speed 30 ft.

STR DEX CON INT WIS CHA
`;

function only<T extends MarkdownBlockRow['status']>(rows: MarkdownBlockRow[], status: T): Extract<MarkdownBlockRow, { status: T }>[] {
  return rows.filter((r): r is Extract<MarkdownBlockRow, { status: T }> => r.status === status);
}

function creature(markdown: string) {
  const { rows } = readStatBlockMarkdown(markdown);
  const [row] = only(rows, 'creature');
  if (!row) throw new Error(`no creature in ${JSON.stringify(rows)}`);
  return row;
}

/** Each bold Armor Class line is one row: a creature, a refusal, or one not read. */
function accountsForEveryArmorClass(markdown: string, options = {}) {
  const { rows, armorClassLines } = readStatBlockMarkdown(markdown, options);
  const carrying = rows.filter((r) => r.status !== 'skipped' || r.reason === SKIPPED_OUTSIDE_BLOCK).length;
  expect(carrying).toBe(armorClassLines);
}

describe('readStatBlockMarkdown', () => {
  it('reads a plain block into the stat block the SRD seed stores', () => {
    const { creature: c, warnings } = creature(GOBLIN);
    expect(warnings).toEqual([]);
    expect(c.name).toBe('Goblin');
    expect(c.creatureType).toBe('Small humanoid (goblinoid)');
    expect(c.alignment).toBe('neutral evil');
    expect(c.challengeRating).toBe('1/4');
    expect(c.size).toEqual({ width: 1, height: 1 });
    expect(c.statBlock).toMatchObject({
      ac: 15,
      armorDescription: 'leather armor, shield',
      hpMax: 7,
      hitDice: '2d6',
      speed: '30 ft.',
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      skills: { stealth: 6 },
      senses: 'darkvision 60 ft., passive Perception 9',
      languages: 'Common, Goblin',
      xp: 50,
      gameSystem: 'FIFTH_EDITION',
      traits: [{ name: 'Nimble Escape', description: expect.stringMatching(/^The goblin can take/) }],
    });
    expect(c.statBlock.actions?.map((a) => a.name)).toEqual(['Scimitar', 'Shortbow']);
  });

  it('reads saves, skills, damage and condition fields, a recharge action, breath options, reactions and legendary actions', () => {
    const { creature: c } = creature(DRAKE);
    expect(c.size).toEqual({ width: 2, height: 2 });
    expect(c.statBlock.abilities.int).toBe(9);
    expect(c.statBlock.savingThrows).toEqual({ dex: 5, con: 7, wis: 5 });
    expect(c.statBlock.skills).toEqual({ perception: 9, sleightOfHand: 5 });
    expect(c.statBlock).toMatchObject({
      damageVulnerabilities: 'cold',
      damageResistances: 'lightning, thunder',
      damageImmunities: 'fire',
      conditionImmunities: 'frightened, prone',
      xp: 3900,
      // Printed +4 where challenge 8 gives +3.
      proficiencies: { bonusOverride: 4 },
    });
    expect(c.statBlock.actions?.map((a) => a.name)).toEqual([
      'Multiattack', 'Claw', 'Breath Weapons (Recharge 5–6)', 'Ember Breath', 'Dust Breath',
    ]);
    expect(c.statBlock.reactions?.map((a) => a.name)).toEqual(['Wing Flick']);
    expect(c.statBlock.legendaryActions?.map((a) => a.name)).toEqual(['Legendary Actions', 'Tail Sweep', 'Rise (Costs 2 Actions)']);
    expect(c.statBlock.legendaryActions?.[0].description).toMatch(/^The drake can take 2 legendary actions/);
  });

  it('leaves out the description after the last action, and says so', () => {
    const row = creature(DRAKE);
    const rise = row.creature.statBlock.legendaryActions?.at(-1);
    expect(rise?.description).toBe('The drake flies up to half its flying speed.');
    expect(row.warnings).toEqual([expect.stringMatching(/^Left out 2 paragraphs after "Rise \(Costs 2 Actions\)"/)]);
    expect(JSON.stringify(row.creature)).not.toMatch(/hollow tops|warm to the touch/);
  });

  it('keeps numbered options with the action that lists them, and a paragraph between them', () => {
    const row = creature(LANTERN);
    const [beams] = row.creature.statBlock.actions ?? [];
    expect(beams.name).toBe('Lantern Beams');
    expect(beams.description.split('\n')).toEqual([
      expect.stringMatching(/^The lantern shines two/),
      expect.stringMatching(/^1\. Glare Beam/),
      expect.stringMatching(/^2\. Chill Beam/),
      'If the target is an object, it is coated in frost instead.',
      expect.stringMatching(/^3\. Pull Beam/),
    ]);
    expect(row.warnings).toEqual([expect.stringMatching(/^Left out 1 paragraph after "Lantern Beams"/)]);
  });

  it('reads a ";" before the alignment, a singular damage field, spell lists and actions grouped by form', () => {
    const { creature: c } = creature(ADEPT);
    expect(c.creatureType).toBe('Medium monstrosity (shapechanger, coilborn)');
    expect(c.alignment).toBe('neutral evil');
    expect(c.statBlock.armorDescription).toBe('15 with mage armor');
    expect(c.statBlock.damageResistances).toBe('damage from spells');
    const [spellcasting, formShift] = c.statBlock.traits ?? [];
    expect(spellcasting.description.split('\n')).toEqual([
      expect.stringMatching(/^The adept is a 9th-level spellcaster/),
      'Cantrips (at will): fire bolt, light, mage hand',
      '1st level (4 slots): mage armor,* magic missile, shield',
      '2nd level (3 slots): misty step',
      '*The adept casts mage armor on itself before combat.',
    ]);
    expect(formShift.description).toContain('Form 2: Coils for arms');
    expect(c.statBlock.actions?.map((a) => a.name)).toEqual(['Form 1: Constrict', 'Form 2: Lash']);
    expect(c.statBlock.bonusActions?.map((a) => a.name)).toEqual(['Slither']);
  });

  it.each([['—'], ['--'], ['-'], ['']])('reads Languages "%s" as none', (written) => {
    const { creature: c } = creature(GOBLIN.replace('**Languages** Common, Goblin', `**Languages** ${written}`));
    expect(c.statBlock.languages).toBe('—');
  });

  it('reads a list of colon labels, LaTeX dice, emphasis and a #### section, and stops at a rule', () => {
    const { rows } = readStatBlockMarkdown(HOUND);
    const [row] = only(rows, 'creature');
    expect(row.warnings).toEqual([]);
    expect(row.creature.statBlock).toMatchObject({
      ac: 12,
      hpMax: 19,
      hitDice: '3d8 + 6',
      speed: '40 ft.',
      skills: { perception: 3 },
      languages: '—',
      challengeRating: '1/2',
      traits: [{ name: 'Stubborn', description: expect.stringContaining('with a DC of 5 + the damage taken.') }],
      actions: [{ name: 'Bite', description: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 6 (1d8 + 2) piercing damage.' }],
    });
    expect(only(rows, 'skipped')).toEqual([expect.objectContaining({ name: 'Pebble Hound Pack', reason: SKIPPED_NO_ARMOR_CLASS })]);
  });

  it('skips and lists a heading without Armor Class, an older one-line block and an Armor Class outside a heading', () => {
    const markdown = `${OLD}\n### Spectral Template\n\nA creature with this template gains the following traits.\n\n${GOBLIN}\n<!-- p. 3 -->\n\n**Armor Class** 11\n`;
    const { rows } = readStatBlockMarkdown(markdown);
    expect(rows.map((r) => [r.name, r.status === 'skipped' ? r.reason : r.status])).toEqual([
      ['MARSH LURKER', SKIPPED_ONE_LINE_FORMAT],
      ['Spectral Template', SKIPPED_NO_ARMOR_CLASS],
      ['Goblin', 'creature'],
      [expect.stringMatching(/^\(line \d+\)$/), SKIPPED_OUTSIDE_BLOCK],
    ]);
    accountsForEveryArmorClass(markdown);
  });

  it('refuses a block it cannot read whole, with each reason', () => {
    const broken = GOBLIN.replace(/\| 8 \(-1\) \| 14.*\n/, '').replace('**Speed** 30 ft.\n', '');
    const [row] = only(readStatBlockMarkdown(broken).rows, 'error');
    expect(row.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^Ability scores/), 'Speed: missing']));
  });

  it('refuses a block the Creature Library would refuse, saying which field', () => {
    const long = GOBLIN.replace('**Nimble Escape.** The goblin', `**Nimble Escape.** ${'x'.repeat(5001)}`);
    const [row] = only(readStatBlockMarkdown(long).rows, 'error');
    expect(row.errors).toEqual([expect.stringMatching(/^statBlock\.traits\.0\.description: /)]);
  });

  it('reads only the blocks under a heading when asked', () => {
    const markdown = `# Book\n\n## Chapter\n\n${GOBLIN}\n## Checked Blocks\n\n${DRAKE}\n${LANTERN}\n## Index\n\n${ADEPT}`;
    const { rows } = readStatBlockMarkdown(markdown, { onlyUnderHeading: '## Checked Blocks' });
    expect(rows.map((r) => r.name)).toEqual(['Thrumwing Drake', 'Ninefold Lantern']);
    expect(readStatBlockMarkdown(markdown, { onlyUnderHeading: 'checked blocks' }).rows).toHaveLength(2);
    expect(() => readStatBlockMarkdown(markdown, { onlyUnderHeading: 'Missing' })).toThrow(HeadingNotFoundError);
    accountsForEveryArmorClass(markdown);
    accountsForEveryArmorClass(markdown, { onlyUnderHeading: 'Checked Blocks' });
  });

  it('keeps a paragraph of rules after the last action, and stops at a lair section, which is not part of the stat block', () => {
    const markdown = GOBLIN.trimEnd()
      + '\n\nA prone target hit by the shortbow takes 2 (1d4) extra damage.'
      + '\n\nGoblins keep caves.\n\n**Lair Actions**\n\nOn initiative count 20 the lair shakes.\n';
    const row = creature(markdown);
    expect(row.creature.statBlock.actions?.at(-1)?.description).toMatch(/piercing damage\.\nA prone target hit by the shortbow takes 2 \(1d4\) extra damage\.$/);
    expect(row.warnings).toEqual([expect.stringMatching(/^Left out 1 paragraph after "Shortbow" as description, not stat block, from "Goblins keep caves\."/)]);
  });
});

describe('readStatBlockMarkdown, sections', () => {
  it('takes another "… Actions" section as legendary-style actions, with its own words first', () => {
    const markdown = GOBLIN.trimEnd() + '\n\n**Rally Actions**\n\nWhile its banner stands, the goblin can use the options below as legendary actions.\n\n**Regroup.** The goblin moves up to its speed.\n';
    const { creature: c } = creature(markdown);
    expect(c.statBlock.legendaryActions?.map((a) => a.name)).toEqual(['Rally Actions', 'Regroup']);
  });

  it('judges what follows the last action as trailing when a section after it stays empty', () => {
    const markdown = ADEPT.trimEnd() + '\n\nAt will: stray words left by a scan\n\n#### Actions for Form 2\n\n<!-- p. 9 -->\n';
    const row = creature(markdown);
    expect(row.creature.statBlock.bonusActions?.at(-1)?.description).toBe('The adept moves up to half its speed.');
    expect(row.warnings).toEqual([expect.stringMatching(/^Left out 1 paragraph after "Slither"/)]);
  });
});

describe('normaliseCreatureName', () => {
  it('ignores case, accents, spaces and punctuation', () => {
    expect(normaliseCreatureName('Pebble-Hound')).toBe(normaliseCreatureName(' pebble hound '));
    expect(normaliseCreatureName('Élan Wisp')).toBe('elanwisp');
  });
});
