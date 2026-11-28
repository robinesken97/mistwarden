/**
 * The instance's imported creatures: stat blocks read from Markdown
 * (statblockMarkdown.ts), stored with no campaign under a source tag the
 * administrator gives, as `custom:<tag>`. Every campaign's GM lists them
 * beside the SRD's; players never read the Creature Library, and no campaign
 * archive carries them, since they belong to no campaign.
 *
 * A creature is the same one again where its tag and its name, case and
 * punctuation aside, are (normaliseCreatureName): importing a file twice
 * updates the creatures in place, keeping their ids, favourites and pictures.
 * One of the SRD's name is another creature: both are kept, and the list
 * puts the imported one first.
 */

import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../config/database';
import { toJson } from '../utils/prisma-json';
import { normalizeAssetUrl } from '../utils/asset-urls';
import { issueMessages } from '../validators/issueMessages';
import { readStatBlockMarkdown, normaliseCreatureName, HeadingNotFoundError, type MarkdownBlockRow } from './statblockMarkdown';

/** What an imported creature's source starts with; the tag follows. */
export const IMPORT_SOURCE_PREFIX = 'custom:';
export const importSource = (tag: string): string => `${IMPORT_SOURCE_PREFIX}${tag}`;

/** The most a file may hold, in characters: under the request body's 1 MB (bodyParsers.ts). */
export const MAX_IMPORT_MARKDOWN_LENGTH = 900_000;

const SourceTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'A source tag is 1 to 32 lower-case letters, digits and dashes, starting with a letter or digit');

export const ImportMarkdownSchema = z.object({
  markdown: z.string().min(1, 'The file is empty').max(MAX_IMPORT_MARKDOWN_LENGTH, `A file may hold ${MAX_IMPORT_MARKDOWN_LENGTH.toLocaleString('en-US')} characters`),
  sourceTag: SourceTagSchema,
  onlyUnderHeading: z.string().max(200).optional(),
  dryRun: z.boolean().optional(),
});

export interface ImportOutcome {
  status: number;
  body: unknown;
}

type ReportRow =
  | { line: number; name: string; status: 'imported' | 'updated'; warnings: string[] }
  | { line: number; name: string; status: 'skipped'; reason: string }
  | { line: number; name: string; status: 'error'; errors: string[]; warnings: string[] };

/** One import at a time, in every process: two at once could both add a creature. */
const IMPORT_LOCK_KEY = 703_118_2027;
const IMPORT_WRITE_TIMEOUT_MS = 120_000;

const refused = (message: string): ImportOutcome => ({ status: 400, body: { error: 'Validation Error', message } });

/** Read a file's stat blocks and, unless it is a dry run, store them under the tag. */
export async function importCreatureMarkdown(input: unknown): Promise<ImportOutcome> {
  const parsed = ImportMarkdownSchema.safeParse(input);
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const { markdown, sourceTag, onlyUnderHeading, dryRun = false } = parsed.data;

  let read: ReturnType<typeof readStatBlockMarkdown>;
  try {
    read = readStatBlockMarkdown(markdown, { onlyUnderHeading });
  } catch (error) {
    if (error instanceof HeadingNotFoundError) return refused(error.message);
    throw error;
  }
  const source = importSource(sourceTag);

  const run = async (db: Prisma.TransactionClient): Promise<ReportRow[]> => {
    const existing = await db.creatureTemplate.findMany({ where: { source, campaignId: null }, select: { id: true, name: true } });
    const byName = new Map(existing.map((e) => [normaliseCreatureName(e.name), e.id]));
    const seen = new Set<string>();
    const rows: ReportRow[] = [];
    const toCreate: Prisma.CreatureTemplateCreateManyInput[] = [];
    for (const row of read.rows) {
      const out = await place(db, row, source, byName, seen, dryRun, toCreate);
      rows.push(out);
    }
    if (!dryRun && toCreate.length) await db.creatureTemplate.createMany({ data: toCreate });
    return rows;
  };

  const rows = dryRun
    ? await run(prisma)
    : await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_KEY})`;
      return run(tx);
    }, { timeout: IMPORT_WRITE_TIMEOUT_MS, maxWait: IMPORT_WRITE_TIMEOUT_MS });

  const count = (status: ReportRow['status']) => rows.filter((r) => r.status === status).length;
  return {
    status: 200,
    body: {
      sourceTag,
      dryRun,
      armorClassLines: read.armorClassLines,
      counts: { imported: count('imported'), updated: count('updated'), skipped: count('skipped'), errors: count('error') },
      rows,
    },
  };
}

/** One block's row in the report, written unless this is a dry run. */
async function place(
  db: Prisma.TransactionClient,
  row: MarkdownBlockRow,
  source: string,
  byName: Map<string, string>,
  seen: Set<string>,
  dryRun: boolean,
  toCreate: Prisma.CreatureTemplateCreateManyInput[],
): Promise<ReportRow> {
  if (row.status === 'skipped') return { line: row.line, name: row.name, status: 'skipped', reason: row.reason };
  if (row.status === 'error') return { line: row.line, name: row.name, status: 'error', errors: row.errors, warnings: row.warnings };

  const key = normaliseCreatureName(row.name);
  if (seen.has(key)) return { line: row.line, name: row.name, status: 'skipped', reason: 'Same name as a stat block earlier in the file: not read twice' };
  seen.add(key);

  const c = row.creature;
  const fields = {
    name: c.name,
    gameSystem: c.gameSystem ?? null,
    challengeRating: c.challengeRating ?? null,
    creatureType: c.creatureType ?? null,
    alignment: c.alignment ?? null,
    statBlock: toJson(c.statBlock),
    size: toJson(c.size),
  };
  const id = byName.get(key);
  if (id) {
    // The picture, placement defaults and favourites stay as they are.
    if (!dryRun) await db.creatureTemplate.update({ where: { id }, data: fields });
    return { line: row.line, name: row.name, status: 'updated', warnings: row.warnings };
  }
  toCreate.push({ ...fields, id: randomUUID(), source, campaignId: null, createdById: null, imageUrl: null, disposition: 'hostile', displayMode: 'pog' });
  return { line: row.line, name: row.name, status: 'imported', warnings: row.warnings };
}

/** Delete every creature imported under the tag. */
export async function deleteImportedCreatures(tag: unknown): Promise<ImportOutcome> {
  const parsed = SourceTagSchema.safeParse(tag);
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const { count } = await prisma.creatureTemplate.deleteMany({ where: { source: importSource(parsed.data), campaignId: null } });
  return { status: 200, body: { sourceTag: parsed.data, deleted: count } };
}

const MatchSchema = z.object({ sourceTag: SourceTagSchema.optional() });

/**
 * Give each imported creature with no picture the server's token picture of
 * its name (normaliseCreatureName), where there is one; one with none keeps
 * the symbol of its creature type. Only shared (global) token pictures: a
 * creature every campaign lists cannot show one person's picture, which the
 * other GMs could not place. Where several have the name, the oldest. Run
 * again after uploading more.
 */
export async function matchTokenPictures(input: unknown): Promise<ImportOutcome> {
  const parsed = MatchSchema.safeParse(input ?? {});
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const { sourceTag } = parsed.data;

  const [creatures, pictures] = await Promise.all([
    prisma.creatureTemplate.findMany({
      where: {
        campaignId: null,
        imageUrl: null,
        source: sourceTag ? importSource(sourceTag) : { startsWith: IMPORT_SOURCE_PREFIX },
      },
      select: { id: true, name: true, source: true },
      orderBy: { name: 'asc' },
    }),
    prisma.asset.findMany({
      where: { type: 'TOKEN', scope: 'GLOBAL' },
      select: { id: true, name: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const byName = new Map<string, { id: string; name: string; others: number }>();
  for (const p of pictures) {
    const key = normaliseCreatureName(p.name);
    const found = byName.get(key);
    if (found) found.others++;
    else byName.set(key, { id: p.id, name: p.name, others: 0 });
  }

  const matched: Array<{ creature: string; sourceTag: string; picture: string; otherPicturesOfTheName: number }> = [];
  for (const c of creatures) {
    const picture = byName.get(normaliseCreatureName(c.name));
    if (!picture) continue;
    await prisma.creatureTemplate.updateMany({ where: { id: c.id, imageUrl: null }, data: { imageUrl: normalizeAssetUrl(picture.id, 'tokens') } });
    matched.push({ creature: c.name, sourceTag: c.source.slice(IMPORT_SOURCE_PREFIX.length), picture: picture.name, otherPicturesOfTheName: picture.others });
  }
  return { status: 200, body: { matched, withoutPicture: creatures.length - matched.length } };
}
