/**
 * The instance's imported spells: read from Markdown (spellMarkdown.ts),
 * stored with no campaign under a source tag the administrator gives, as
 * `custom:<tag>`, as creatureImport.ts does creatures. Every campaign lists
 * them; a player is told everything but the description, which only the GM
 * and an administrator read (routes/campaignSpells.ts), since an imported
 * book's text is not the SRD's to share. No campaign archive carries them:
 * they belong to no campaign. They cannot be edited, only imported again.
 *
 * A spell is the same one again where its tag and its name, case and
 * punctuation aside, are: importing a file twice updates the spells in
 * place, keeping their ids. One of an SRD spell's name is another spell:
 * both are kept, and a name means the imported one (resolveSpellByName).
 */

import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../config/database';
import { issueMessages } from '../validators/issueMessages';
import { ImportMarkdownSchema, SourceTagSchema, importSource, type ImportOutcome } from './creatureImport';
import { normaliseCreatureName as normaliseName } from './statblockMarkdown';
import { readSpellMarkdown, type SpellBlockRow } from './spellMarkdown';
import { SPELL_SEED_LOCK_KEY, spellAreaJson } from './spellSeed';

const ImportSpellMarkdownSchema = ImportMarkdownSchema.omit({ onlyUnderHeading: true }).strict();
const IMPORT_WRITE_TIMEOUT_MS = 120_000;

type ReportRow =
  | { line: number; name: string; status: 'imported' | 'updated'; warnings: string[] }
  | { line: number; name: string; status: 'skipped'; reason: string }
  | { line: number; name: string; status: 'error'; errors: string[]; warnings: string[] };

const refused = (message: string): ImportOutcome => ({ status: 400, body: { error: 'Validation Error', message } });

/** Read a file's spells and, unless it is a dry run, store them under the tag. */
export async function importSpellMarkdown(input: unknown): Promise<ImportOutcome> {
  const parsed = ImportSpellMarkdownSchema.safeParse(input);
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const { markdown, sourceTag, dryRun = false } = parsed.data;
  const read = readSpellMarkdown(markdown);
  const source = importSource(sourceTag);

  const run = async (db: Prisma.TransactionClient): Promise<ReportRow[]> => {
    const existing = await db.spellTemplate.findMany({ where: { source, campaignId: null }, select: { id: true, name: true } });
    const byName = new Map(existing.map((e) => [normaliseName(e.name), e.id]));
    const seen = new Set<string>();
    const rows: ReportRow[] = [];
    const toCreate: Prisma.SpellTemplateCreateManyInput[] = [];
    for (const row of read.rows) rows.push(await place(db, row, source, byName, seen, dryRun, toCreate));
    if (!dryRun && toCreate.length) await db.spellTemplate.createMany({ data: toCreate });
    return rows;
  };

  // One import or SRD seed at a time, in every process: two at once could both add a spell.
  const rows = dryRun
    ? await run(prisma)
    : await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SPELL_SEED_LOCK_KEY})`;
      return run(tx);
    }, { timeout: IMPORT_WRITE_TIMEOUT_MS, maxWait: IMPORT_WRITE_TIMEOUT_MS });

  const count = (status: ReportRow['status']) => rows.filter((r) => r.status === status).length;
  return {
    status: 200,
    body: {
      sourceTag,
      dryRun,
      castingTimeLines: read.castingTimeLines,
      counts: { imported: count('imported'), updated: count('updated'), skipped: count('skipped'), errors: count('error') },
      rows,
    },
  };
}

/** One block's row in the report, written unless this is a dry run. */
async function place(
  db: Prisma.TransactionClient,
  row: SpellBlockRow,
  source: string,
  byName: Map<string, string>,
  seen: Set<string>,
  dryRun: boolean,
  toCreate: Prisma.SpellTemplateCreateManyInput[],
): Promise<ReportRow> {
  if (row.status === 'skipped') return { line: row.line, name: row.name, status: 'skipped', reason: row.reason };
  if (row.status === 'error') return { line: row.line, name: row.name, status: 'error', errors: row.errors, warnings: row.warnings };

  const key = normaliseName(row.name);
  if (seen.has(key)) return { line: row.line, name: row.name, status: 'skipped', reason: 'Same name as a spell earlier in the file: not read twice' };
  seen.add(key);

  const fields = { ...row.spell, area: spellAreaJson(row.spell.area) };
  const id = byName.get(key);
  if (id) {
    if (!dryRun) await db.spellTemplate.update({ where: { id }, data: fields });
    return { line: row.line, name: row.name, status: 'updated', warnings: row.warnings };
  }
  toCreate.push({ ...fields, id: randomUUID(), source, campaignId: null, createdById: null });
  return { line: row.line, name: row.name, status: 'imported', warnings: row.warnings };
}

/** Delete every spell imported under the tag. */
export async function deleteImportedSpells(tag: unknown): Promise<ImportOutcome> {
  const parsed = SourceTagSchema.safeParse(tag);
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const { count } = await prisma.spellTemplate.deleteMany({ where: { source: importSource(parsed.data), campaignId: null } });
  return { status: 200, body: { sourceTag: parsed.data, deleted: count } };
}
