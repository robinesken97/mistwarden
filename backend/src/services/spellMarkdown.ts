/**
 * 5e-style spells read from Markdown, into the Spell Library's fields
 * (validators/spells.ts), as spellImport.ts stores them.
 *
 * A spell is a heading (any level) whose first lines hold a bold
 * `**Casting Time:**` field:
 *
 *   ### Spell Name
 *   *3rd-level evocation*            or *Evocation cantrip*, "(ritual)" after the school
 *   **Casting Time:** 1 action       each field on its own line, or as list items
 *   **Range:** 150 feet              (`- **Range:** ...`, `* **Range:** ...`)
 *   **Components:** V, S, M (...)
 *   **Duration:** Concentration, up to 1 minute
 *
 *   Description paragraphs, an "At Higher Levels." paragraph among them.
 *
 * The header ends at the first blank line after a field; everything after it,
 * up to the next heading of any level or a page marker `<!-- p. 12 -->`, is
 * the description. Rules (`---`) are left out of it, LaTeX dice
 * (`$2\text{d}6$`) are read as plain text. A name written in capitals is
 * stored in title case. The area and the look come from the spell's own
 * words, by the rules the SRD seed uses (spellAreaText.ts).
 *
 * Nothing is dropped unsaid: every heading comes back as a spell, as skipped
 * with the reason (no Casting Time: a chapter, a spell list, a summary), or as
 * refused with each reason. Text the header has no place for, and text a
 * block ends before, is in its warnings. Every Casting Time line in the file
 * is in exactly one row that is not "no Casting Time".
 */

import { CreateSpellSchema, type CreateSpell } from '../validators/spells';
import { issueMessages } from '../validators/issueMessages';
import { spellAreaFromText, spellElementFromText } from './spellAreaText';
import { SRD_SPELL_OVERRIDES } from './spellSeed';
import { plainLatex } from './statblockMarkdown';

export type SpellBlockRow =
  | { status: 'spell'; line: number; name: string; spell: CreateSpell; warnings: string[] }
  | { status: 'skipped'; line: number; name: string; reason: string }
  | { status: 'error'; line: number; name: string; errors: string[]; warnings: string[] };

export interface SpellMarkdownResult {
  rows: SpellBlockRow[];
  /** How many bold Casting Time lines the file holds: each is in one row, a spell, refused, or outside a heading. */
  castingTimeLines: number;
}

export const SKIPPED_NO_CASTING_TIME = 'No Casting Time: not a spell (a chapter, a spell list or another heading)';
export const SKIPPED_OUTSIDE_HEADING = 'Casting Time before the first heading: not read';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const PAGE_MARKER = /^<!--\s*p\.\s*\d+\s*-->$/i;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
/** `**Label:** value`, `**Label**: value`, either as a list item. */
const FIELD = /^\s*(?:[-*+]\s+)?\*\*([^*]+?)(?::\*\*|\*\*:)\s*(.*)$/;
const FIELDS = { 'casting time': 'castingTime', range: 'range', components: 'components', duration: 'duration' } as const;
type FieldKey = (typeof FIELDS)[keyof typeof FIELDS];

const isCastingTime = (line: string) => FIELD.exec(line)?.[1].trim().toLowerCase() === 'casting time';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);

/** "LANTERN OF THE MOSS-KING'S WAKE" → "Lantern of the Moss-King's Wake": each word capitalised, small ones not. */
export function titleCase(name: string): string {
  return name.toLowerCase().split(' ').map((word, i) =>
    (i > 0 && SMALL_WORDS.has(word) ? word : word.replace(/(^|[-/(])([a-z])/g, (_m, before: string, c: string) => before + c.toUpperCase())),
  ).join(' ');
}

/** The heading's text as a name: emphasis taken off, capitals made title case. */
function readName(text: string, warnings: string[]): string {
  const name = text.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
  if (!/[a-z]/.test(name) && /[A-Z]/.test(name)) {
    const cased = titleCase(name);
    warnings.push(`Name written in capitals: stored as "${cased}"`);
    return cased;
  }
  return name;
}

interface LevelLine { level: number; school: string; ritual: boolean; rest: string }

/** "*3rd-level evocation (ritual)*", "*Evocation cantrip*" → level, school, ritual; null when it is neither. */
function readLevelLine(text: string): LevelLine | null {
  const plain = text.replace(/[*_]/g, '').trim();
  const m = /^(\d)(?:st|nd|rd|th)[- ]level\s+([a-z]+)\b(.*)$/i.exec(plain) ?? /^([a-z]+)\s+cantrip\b(.*)$/i.exec(plain);
  if (!m) return null;
  const levelled = m.length === 4;
  const school = levelled ? m[2] : m[1];
  let rest = (levelled ? m[3] : m[2]).trim();
  const ritual = /\(ritual\)/i.test(rest);
  rest = rest.replace(/\(ritual\)/i, '').trim();
  return { level: levelled ? Number(m[1]) : 0, school: school[0].toUpperCase() + school.slice(1).toLowerCase(), ritual, rest };
}

/** The description's lines as text: LaTeX made plain, rules out, blank runs one paragraph break. */
function readDescription(lines: string[]): string {
  const kept: string[] = [];
  for (const raw of lines) {
    if (RULE.test(raw)) continue;
    const line = plainLatex(raw).trimEnd();
    if (line.trim() === '' && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(line.trim() === '' ? '' : line);
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
}

interface Block {
  /** 1-based line of the heading. */
  line: number;
  level: number;
  heading: string;
  body: Array<{ text: string; line: number }>;
  /** Why the block ended before the next heading, and the lines it left unread. */
  cutAt?: { line: number; unread: number };
  /** The heading it ends at, when that one is below it. */
  nextDeeper?: { line: number; heading: string };
}

function readSpell(block: Block): SpellBlockRow {
  const warnings: string[] = [];
  const errors: string[] = [];
  const name = readName(block.heading, warnings);
  const fields: Partial<Record<FieldKey, string>> = {};
  let levelLine: LevelLine | null = null;
  let seenField = false;
  let i = 0;

  for (; i < block.body.length; i++) {
    const { text, line } = block.body[i];
    if (text.trim() === '') {
      if (seenField) break;
      continue;
    }
    const field = FIELD.exec(text);
    if (field) {
      seenField = true;
      const key = FIELDS[field[1].trim().toLowerCase() as keyof typeof FIELDS];
      const value = plainLatex(field[2]).trim();
      if (!key) warnings.push(`Line ${line}: field "${field[1].trim()}" has no place in a spell, not read`);
      else if (fields[key] !== undefined) warnings.push(`Line ${line}: a second ${field[1].trim()} field, not read`);
      else fields[key] = value;
      continue;
    }
    const read: LevelLine | null = !seenField && !levelLine ? readLevelLine(text) : null;
    if (read) {
      levelLine = read;
      if (read.rest) warnings.push(`Line ${line}: "${read.rest}" after the school, not read`);
      continue;
    }
    // A line that is no field ends the header too ("**Casting Time:** 1 action" then text with no blank line).
    if (seenField) break;
    warnings.push(`Line ${line}: text before the fields, not read`);
  }

  const descriptionLines = block.body.slice(i);
  const strayCastingTime = descriptionLines.find((l) => isCastingTime(l.text));
  if (strayCastingTime) errors.push(`Line ${strayCastingTime.line}: a second Casting Time in the text, so a spell's heading is missing`);
  if (!levelLine) errors.push('No level and school line, such as *3rd-level evocation* or *Evocation cantrip*');
  for (const [label, key] of Object.entries(FIELDS)) {
    if (fields[key] === undefined && key !== 'castingTime') warnings.push(`No ${label[0].toUpperCase()}${label.slice(1)} field`);
  }
  if (block.cutAt) warnings.push(`Ends at the page marker on line ${block.cutAt.line}: ${block.cutAt.unread} line(s) after it, up to the next heading, not read`);
  if (block.nextDeeper) warnings.push(`Ends at the heading "${block.nextDeeper.heading}" on line ${block.nextDeeper.line}, read as a block of its own`);
  if (errors.length) return { status: 'error', line: block.line, name, errors, warnings };

  const description = readDescription(descriptionLines.map((l) => l.text));
  const override = SRD_SPELL_OVERRIDES[name] ?? {};
  const area = 'area' in override ? override.area ?? null : spellAreaFromText(fields.range, description);
  const checked = CreateSpellSchema.safeParse({
    name,
    gameSystem: 'FIFTH_EDITION',
    level: levelLine!.level,
    school: levelLine!.school,
    castingTime: fields.castingTime,
    range: fields.range,
    components: fields.components,
    duration: fields.duration,
    concentration: /^concentration\b/i.test(fields.duration ?? ''),
    ritual: levelLine!.ritual,
    description,
    area,
    element: override.element ?? (area ? spellElementFromText(description) : 'none'),
  });
  if (!checked.success) return { status: 'error', line: block.line, name, errors: [issueMessages(checked.error)], warnings };
  return { status: 'spell', line: block.line, name, spell: checked.data, warnings };
}

/** Every heading's block in the file, as a spell, skipped or refused. */
export function readSpellMarkdown(markdown: string): SpellMarkdownResult {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows: SpellBlockRow[] = [];
  let castingTimeLines = 0;
  let beforeFirstHeading = 0;
  const blocks: Block[] = [];
  let current: Block | null = null;

  lines.forEach((text, index) => {
    const line = index + 1;
    if (isCastingTime(text)) {
      castingTimeLines++;
      if (!current) beforeFirstHeading++;
    }
    const heading = HEADING.exec(text);
    if (heading) {
      const level = heading[1].length;
      if (current && level > current.level) current.nextDeeper = { line, heading: heading[2] };
      current = { line, level, heading: heading[2], body: [] };
      blocks.push(current);
      return;
    }
    if (!current) return;
    if (current.cutAt) {
      if (text.trim() !== '') current.cutAt.unread++;
      return;
    }
    if (PAGE_MARKER.test(text.trim())) {
      current.cutAt = { line, unread: 0 };
      return;
    }
    current.body.push({ text, line });
  });

  if (beforeFirstHeading) rows.push({ status: 'skipped', line: 1, name: '(before the first heading)', reason: SKIPPED_OUTSIDE_HEADING });
  for (const block of blocks) {
    if (block.cutAt && block.cutAt.unread === 0) delete block.cutAt;
    if (!block.body.some((l) => isCastingTime(l.text))) {
      rows.push({ status: 'skipped', line: block.line, name: readName(block.heading, []) || '(empty heading)', reason: SKIPPED_NO_CASTING_TIME });
      continue;
    }
    rows.push(readSpell(block));
  }
  return { rows, castingTimeLines };
}
