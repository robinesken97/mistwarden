/**
 * 5e-style stat blocks read from Markdown, into the Creature Library's
 * stat block (the shape the SRD seed stores, creatureSeed.ts).
 *
 * A stat block is a `### Name` heading whose lines hold a bold
 * `**Armor Class**` field. Two ways of writing the fields are read:
 *
 *   **Armor Class** 15 (natural armor)        one field per paragraph
 *   - **Armor Class:** 15                     a list, the colon in the label
 *
 * then the six scores as a table (`| STR | DEX | ... |`, cells "16 (+3)"),
 * traits and actions as `**Name.** text` (or `***Name.***`), and sections as a
 * bold line or a `####` heading (`**Actions**`, `#### Reactions`). A plain
 * paragraph after an entry belongs to it: a list of spells, numbered options.
 * Dice written as LaTeX (`$2\text{d}6 + 3$`) are read as plain text.
 *
 * A block ends at the next heading (a `####` that is no section), a page
 * marker `<!-- p. 12 -->`, a rule `---`, or a bold line that is no section
 * (Lair Actions and Regional Effects are the creature's lair, not its stat
 * block). Paragraphs after the last entry are kept while they go on with it
 * (the items of a list it introduced, or rules: saves, damage, distances); from
 * the first that does not, such as a description of the creature, they are
 * left out, and the block's warnings say how many and where they start.
 *
 * Nothing is dropped unsaid: every block comes back as a creature, as skipped
 * with the reason (a heading with no Armor Class, such as a template; a block
 * in an older one-line format with unbolded fields), or as refused with each
 * reason. What a creature's stat block has no place for is in its warnings.
 */

import { CreateCreatureSchema, type CreateCreatureInput } from '../validators/creatures';
import { normalizeSkillKey, proficiencyBonusForCR, MAX_PROFICIENCY_BONUS } from '../utils/rules/fifthEdition';
import { SIZE_MAP } from './creatureSeed';

/** A creature read from a block, checked as the Creature Library checks one it is given. */
export type ReadCreature = CreateCreatureInput & { size: { width: number; height: number } };

export type MarkdownBlockRow =
  | { status: 'creature'; line: number; name: string; creature: ReadCreature; warnings: string[] }
  | { status: 'skipped'; line: number; name: string; reason: string }
  | { status: 'error'; line: number; name: string; errors: string[]; warnings: string[] };

export interface MarkdownReadResult {
  rows: MarkdownBlockRow[];
  /** How many bold Armor Class lines the part read holds: each is one row, a creature or refused. */
  armorClassLines: number;
}

export interface MarkdownReadOptions {
  /** Read only the blocks under this heading (its text, with or without the #s), up to the next heading of its level. */
  onlyUnderHeading?: string;
}

/** The heading asked for is not in the file. */
export class HeadingNotFoundError extends Error {}

export const SKIPPED_NO_ARMOR_CLASS = 'No Armor Class: not a stat block (a template, a variant or another heading)';
export const SKIPPED_ONE_LINE_FORMAT = 'Older one-line format with unbolded fields: not read';
export const SKIPPED_OUTSIDE_BLOCK = 'Armor Class outside a ### heading: not read';

type ListKey = 'traits' | 'actions' | 'bonusActions' | 'reactions' | 'legendaryActions';

/** A field's label, lower case, and the stat block key its text goes to. */
const TEXT_FIELDS: Record<string, string> = {
  speed: 'speed',
  'damage vulnerabilities': 'damageVulnerabilities',
  'damage vulnerability': 'damageVulnerabilities',
  'damage resistances': 'damageResistances',
  'damage resistance': 'damageResistances',
  'damage immunities': 'damageImmunities',
  'damage immunity': 'damageImmunities',
  'condition immunities': 'conditionImmunities',
  'condition immunity': 'conditionImmunities',
  senses: 'senses',
  languages: 'languages',
};
const OTHER_FIELDS = new Set(['armor class', 'hit points', 'saving throws', 'skills', 'challenge', 'proficiency bonus']);

const SECTIONS: Record<string, ListKey> = {
  actions: 'actions',
  'bonus actions': 'bonusActions',
  reactions: 'reactions',
  'legendary actions': 'legendaryActions',
};
/** The creature's lair, which follows its stat block. */
const LAIR_SECTIONS = new Set(['lair actions', 'regional effects']);

const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const PAGE_MARKER = /^<!--\s*p\.\s*\d+\s*-->$/i;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BOLD_ARMOR_CLASS = /^(?:[-*]\s+)?\*\*Armor Class:?\*\*/i;
const PLAIN_ARMOR_CLASS = /^Armor Class:?\s+\d/i;
/** A bold run at the start of a line, and the rest: `**Label**`, `**Label:**`, `***Name.***`. */
const BOLD_START = /^\*{2,3}([^*]+?)\*{2,3}\s*(.*)$/;

/** LaTeX as a converter writes dice and sums: `$3\text{d}8 + 6$` → `3d8 + 6`. */
function plainLatex(line: string): string {
  return line.replace(/\$([^$]+)\$/g, (_m, inner: string) =>
    inner
      .replace(/\\text\{([^}]*)\}/g, '$1')
      .replace(/\\times/g, '×')
      .replace(/\\[,;: ]/g, ' ')
      .replace(/\\([a-zA-Z]+)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim());
}

/** Single-asterisk emphasis taken off (`*Melee Weapon Attack:*`); a lone asterisk, a footnote's, stays. */
function plainEmphasis(text: string): string {
  return text.replace(/(^|[\s(])\*([^*\s](?:[^*]*[^*\s])?)\*(?=[\s.,:;)]|$)/g, '$1$2');
}

const normaliseMinus = (text: string): string => text.replace(/[−–]/g, '-');

/** The name a creature is known by for matching: case, accents, spaces and punctuation aside. */
export function normaliseCreatureName(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** "Medium aberration (shapechanger); chaotic neutral" → type and alignment, split outside brackets. */
function splitTypeLine(text: string): { creatureType: string; alignment?: string } {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if ((c === ',' || c === ';') && depth === 0) {
      const alignment = text.slice(i + 1).trim();
      return { creatureType: text.slice(0, i).trim(), ...(alignment && { alignment }) };
    }
  }
  return { creatureType: text.trim() };
}

/** "Int +8, Wis +7" → bonuses; the parts it cannot read are returned too. */
function readBonuses(text: string, keyOf: (label: string) => string | null): { values: Record<string, number>; unread: string[] } {
  const values: Record<string, number> = {};
  const unread: string[] = [];
  for (const part of text.split(/[,;]/).map((p) => p.trim()).filter(Boolean)) {
    // "Perception +5 (+7 in fog)": the bonus is kept, the condition said to be left out.
    const m = /^(.+?)\s*([+-]\s*\d+)\s*(\(.*\))?$/.exec(normaliseMinus(part));
    const key = m ? keyOf(m[1]) : null;
    if (m && key) values[key] = Number(m[2].replace(/\s/g, ''));
    if (!m || !key || m[3]) unread.push(m && key ? m[3] : part);
  }
  return { values, unread };
}

const saveKey = (label: string): string | null => {
  const key = label.trim().slice(0, 3).toLowerCase();
  return (ABILITY_ORDER as readonly string[]).includes(key) ? key : null;
};

interface Entry { name: string; parts: string[] }

/** Whether a paragraph reads as one item of a list an entry introduced ("1. ...", "At will: ..."). */
const isListItem = (text: string): boolean => /^\d+(?:-\d+)?\.\s/.test(normaliseMinus(text)) || /^[^.:]{1,60}:\s*\S/.test(text);

/**
 * Whether a paragraph after the last entry goes on with its rules ("If the
 * target dies, ..."): it speaks of saves, damage, dice or distances, and is
 * neither the lair's nor a lone "Name. text" copied from the description.
 */
const continuesRules = (text: string): boolean =>
  /\bDC \d|\b\d+d\d+\b|saving throw|\bsaves?\b|hit points?\b|\bdamage\b|\bAC\b|\bfeet\b|\bft\.|\b(?:restrained|grappled|charmed|frightened|immune|disease)\b|\b(?:its|their) (?:next )?turn\b/i.test(text)
  && /^[A-Z0-9]/.test(text)
  && !/^[A-Z][\w' -]{0,40}(?: \([^)]*\))?\.\s/.test(text)
  && !/^(?:Armor Class|Hit Points|Speed|Senses|Languages|Challenge)\b/.test(text)
  && !/\b(?:its|the|a) lair\b|\bregion containing\b|\binitiative count 20\b/i.test(text);

/** One block's lines, from the line after its heading. Returns the row and the index it stopped at. */
function readBlock(lines: string[], start: number, end: number, name: string, headingLine: number): { row: MarkdownBlockRow; stop: number } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const block: Record<string, unknown> = { gameSystem: 'FIFTH_EDITION' };
  const lists: Record<ListKey, Entry[]> = { traits: [], actions: [], bonusActions: [], reactions: [], legendaryActions: [] };
  let section: { list: ListKey; label: string; prefix: string } = { list: 'traits', label: 'Traits', prefix: '' };
  /** The entry last written, how many of its parts came before the last bold line, and whether the section has one yet. */
  const at: { last: Entry | null; anchor: number; inSection: boolean } = { last: null, anchor: 0, inSection: false };
  let typeLine: string | null = null;
  let boldArmorClass = 0;
  let plainArmorClass = false;
  let pb: number | null = null;
  let i = start;

  const addEntry = (entryName: string, text: string) => {
    at.last = { name: entryName, parts: text ? [text] : [] };
    lists[section.list].push(at.last);
    at.anchor = at.last.parts.length;
    at.inSection = true;
  };
  // The entry before keeps its anchor: a section that gets no entry of its
  // own leaves the paragraphs before it trailing, to be judged as such.
  const enterSection = (next: typeof section) => {
    section = next;
    at.inSection = false;
  };

  for (; i < end; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const heading = HEADING.exec(raw);
    if (heading) {
      const known = heading[1].length === 4 ? sectionOf(heading[2]) : null;
      if (!known) break;
      enterSection(known);
      continue;
    }
    if (PAGE_MARKER.test(raw) || RULE.test(raw)) break;
    if (raw.startsWith('|')) {
      if (!block.abilities && /\|\s*STR\s*\|/i.test(raw)) {
        const values = lines.slice(i + 1, end).map((l) => l.trim()).find((l) => l.startsWith('|') && !/^\|[\s:|-]+\|$/.test(l));
        const cells = values?.split('|').slice(1, -1).map((c) => /^(\d+)/.exec(c.trim())?.[1]);
        if (cells && cells.length === 6 && cells.every(Boolean)) {
          block.abilities = Object.fromEntries(ABILITY_ORDER.map((k, n) => [k, Number(cells[n])]));
        } else {
          errors.push('Ability scores: the row under STR … CHA does not hold six scores');
        }
      }
      continue;
    }
    if (PLAIN_ARMOR_CLASS.test(raw)) plainArmorClass = true;
    const line = plainLatex(raw.replace(/^[-*]\s+(?=\*\*)/, ''));

    if (!typeLine && boldArmorClass === 0 && /^[*_][^*_].*[*_]$/.test(line)) {
      typeLine = line.slice(1, -1).trim();
      continue;
    }

    const bold = BOLD_START.exec(line);
    if (bold) {
      const inner = bold[1].trim();
      const rest = plainEmphasis(bold[2].replace(/^:\s*/, '').trim());
      if (inner.endsWith('.')) {
        addEntry(section.prefix + inner.slice(0, -1).trim(), rest);
        continue;
      }
      const label = inner.replace(/:$/, '').trim();
      const key = label.toLowerCase();
      if (!rest && !TEXT_FIELDS[key] && !OTHER_FIELDS.has(key)) {
        const known = sectionOf(label);
        if (known) {
          enterSection(known);
          continue;
        }
        if (!LAIR_SECTIONS.has(key)) warnings.push(`Stopped reading at line ${i + 1}: "${label}" is not a stat block section`);
        break;
      }
      if (key === 'armor class') {
        boldArmorClass++;
        const ac = /^(\d+)\s*(.*)$/.exec(rest);
        if (!ac) errors.push(`Armor Class: no number in "${rest}"`);
        else {
          block.ac = Number(ac[1]);
          const note = ac[2].replace(/^\((.*)\)$/, '$1').trim();
          if (note) block.armorDescription = note;
        }
      } else if (key === 'hit points') {
        const hp = /^(\d+)\s*(?:\(([^)]*)\))?/.exec(rest);
        if (!hp) errors.push(`Hit Points: no number in "${rest}"`);
        else {
          block.hpMax = Number(hp[1]);
          if (hp[2]?.trim()) block.hitDice = hp[2].trim();
        }
      } else if (key === 'saving throws') {
        const { values, unread } = readBonuses(rest, saveKey);
        if (Object.keys(values).length) block.savingThrows = values;
        if (unread.length) warnings.push(`Saving Throws: left out "${unread.join(', ')}"`);
      } else if (key === 'skills') {
        const { values, unread } = readBonuses(rest, (l) => normalizeSkillKey(l));
        if (Object.keys(values).length) block.skills = values;
        if (unread.length) warnings.push(`Skills: left out "${unread.join(', ')}"`);
      } else if (key === 'challenge') {
        const cr = /^(\d+(?:\/\d+)?)\s*(?:\(\s*([\d,]+)\s*XP\s*\))?\s*(.*)$/i.exec(rest);
        if (!cr) errors.push(`Challenge: no rating in "${rest}"`);
        else {
          block.challengeRating = cr[1];
          if (cr[2]) block.xp = Number(cr[2].replace(/,/g, ''));
          if (cr[3]) warnings.push(`Challenge: kept "${cr[1]}${cr[2] ? ` (${cr[2]} XP)` : ''}", left out "${cr[3]}"`);
        }
      } else if (key === 'proficiency bonus') {
        const m = /^\+?(\d+)/.exec(rest);
        if (m) pb = Number(m[1]);
      } else if (TEXT_FIELDS[key]) {
        if (key === 'languages' && /^[-—–]*$/.test(rest)) block.languages = '—';
        else if (rest) block[TEXT_FIELDS[key]] = rest;
      } else if (!OTHER_FIELDS.has(key)) {
        warnings.push(`Left out the field "${label}"`);
      }
      continue;
    }

    // A plain paragraph: part of the entry before it, or a section's own words.
    const text = plainEmphasis(line);
    if (at.last && at.inSection) {
      at.last.parts.push(text);
    } else {
      addEntry(section.label, text);
    }
  }

  // Paragraphs after the last entry that do not continue it are the creature's description.
  if (at.last) {
    const entry = at.last;
    const tail = entry.parts.slice(at.anchor);
    // An entry with no words of its own on its line has them in the next paragraph.
    let keep = at.anchor === 0 && tail.length ? 1 : 0;
    let listing = /:\s*$/.test(entry.parts[at.anchor + keep - 1] ?? '');
    while (keep < tail.length) {
      const listed = listing && (isListItem(tail[keep]) || isListItem(tail[keep + 1] ?? ''));
      if (!listed && !continuesRules(tail[keep])) break;
      listing = listed || /:\s*$/.test(tail[keep]);
      keep++;
    }
    const left = tail.length - keep;
    if (left > 0) {
      const first = tail[keep];
      entry.parts.splice(at.anchor + keep);
      warnings.push(`Left out ${left} paragraph${left === 1 ? '' : 's'} after "${entry.name}" as description, not stat block, from "${first.length > 40 ? `${first.slice(0, 40)}…` : first}"`);
    }
  }

  if (boldArmorClass === 0) {
    return { row: { status: 'skipped', line: headingLine, name, reason: plainArmorClass ? SKIPPED_ONE_LINE_FORMAT : SKIPPED_NO_ARMOR_CLASS }, stop: i };
  }
  if (boldArmorClass > 1) errors.push(`${boldArmorClass} Armor Class lines under one heading: one stat block each`);
  if (!block.abilities) errors.push('Ability scores: no STR … CHA table');
  if (block.hpMax === undefined) errors.push('Hit Points: missing');
  if (block.speed === undefined) errors.push('Speed: missing');

  const type = typeLine ? splitTypeLine(typeLine) : null;
  if (!type) warnings.push('No size and type line');
  if (type) {
    block.creatureType = type.creatureType;
    if (type.alignment) block.alignment = type.alignment;
  }
  if (pb !== null && pb !== proficiencyBonusForCR(block.challengeRating as string | undefined) && pb <= MAX_PROFICIENCY_BONUS) {
    block.proficiencies = { bonusOverride: pb };
  }
  for (const key of Object.keys(lists) as ListKey[]) {
    if (lists[key].length) block[key] = lists[key].map((e) => ({ name: e.name, description: e.parts.join('\n') }));
  }

  const sizeWord = type?.creatureType.split(/\s+/)[0] ?? '';
  const sizeName = Object.keys(SIZE_MAP).find((s) => s.toLowerCase() === sizeWord.toLowerCase());
  if (type && !sizeName) warnings.push(`Size "${sizeWord}" not known: placed as one square`);

  if (errors.length) return { row: { status: 'error', line: headingLine, name, errors, warnings }, stop: i };

  const parsed = CreateCreatureSchema.safeParse({
    name,
    gameSystem: 'FIFTH_EDITION',
    challengeRating: block.challengeRating ?? null,
    creatureType: block.creatureType ?? null,
    alignment: block.alignment ?? null,
    statBlock: block,
    size: sizeName ? SIZE_MAP[sizeName] : { width: 1, height: 1 },
  });
  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => (issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message));
    return { row: { status: 'error', line: headingLine, name, errors: messages, warnings }, stop: i };
  }
  return { row: { status: 'creature', line: headingLine, name, creature: parsed.data as ReadCreature, warnings }, stop: i };
}

/** A section a bold line or `####` heading names, or null. "Actions for X" groups actions under X. */
function sectionOf(label: string): { list: ListKey; label: string; prefix: string } | null {
  const text = label.replace(/^\*\*|\*\*$/g, '').trim();
  const key = text.toLowerCase();
  if (SECTIONS[key]) return { list: SECTIONS[key], label: text, prefix: '' };
  const group = /^actions for (.+)$/i.exec(text);
  if (group) return { list: 'actions', label: text, prefix: `${group[1].trim()}: ` };
  // Any other "… Actions" but the lair's is taken in place of legendary actions.
  if (/^\S.* actions$/i.test(text) && !LAIR_SECTIONS.has(key)) return { list: 'legendaryActions', label: text, prefix: '' };
  return null;
}

/** Every stat block in `markdown`, or under one heading of it. */
export function readStatBlockMarkdown(markdown: string, options: MarkdownReadOptions = {}): MarkdownReadResult {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  let from = 0;
  let to = lines.length;
  if (options.onlyUnderHeading?.trim()) {
    const wanted = options.onlyUnderHeading.replace(/^#+\s*/, '').trim().toLowerCase();
    const at = lines.findIndex((l) => HEADING.exec(l.trim())?.[2].toLowerCase() === wanted);
    if (at < 0) throw new HeadingNotFoundError(`The file has no heading "${options.onlyUnderHeading.trim()}"`);
    const level = HEADING.exec(lines[at].trim())![1].length;
    from = at + 1;
    const next = lines.findIndex((l, n) => n > at && (HEADING.exec(l.trim())?.[1].length ?? 99) <= level);
    if (next >= 0) to = next;
  }

  const rows: MarkdownBlockRow[] = [];
  let armorClassLines = 0;
  for (let i = from; i < to; i++) {
    const raw = lines[i].trim();
    if (BOLD_ARMOR_CLASS.test(raw)) armorClassLines++;
    const heading = HEADING.exec(raw);
    if (heading && heading[1].length === 3) {
      const { row, stop } = readBlock(lines, i + 1, to, heading[2], i + 1);
      rows.push(row);
      for (let n = i + 1; n < stop; n++) if (BOLD_ARMOR_CLASS.test(lines[n].trim())) armorClassLines++;
      i = stop - 1;
      continue;
    }
    if (heading && heading[1].length === 2) {
      // An older block: a ## heading, its fields unbolded on one line.
      const next = lines.findIndex((l, n) => n > i && HEADING.test(l.trim()));
      const body = lines.slice(i + 1, next < 0 || next > to ? to : next);
      if (body.some((l) => PLAIN_ARMOR_CLASS.test(l.trim()))) rows.push({ status: 'skipped', line: i + 1, name: heading[2], reason: SKIPPED_ONE_LINE_FORMAT });
      continue;
    }
    if (BOLD_ARMOR_CLASS.test(raw)) rows.push({ status: 'skipped', line: i + 1, name: `(line ${i + 1})`, reason: SKIPPED_OUTSIDE_BLOCK });
  }
  return { rows, armorClassLines };
}
