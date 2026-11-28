/**
 * Seeds the Spell Library with the SRD 5.1 spells from Open5e, as
 * creatureSeed.ts does the creatures, through the same pager (one host, a
 * time limit per page, a page cap). Each spell's area and look are read
 * from its own text (spellAreaText.ts), with the few overrides below.
 *
 * SRD 5.1 content is used under CC BY 4.0, and reaches us through Open5e.
 * GAME_CONTENT_NOTICES.md has the attribution that licence asks for.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { fetchOpen5eList, OPEN5E_ORIGIN, type SeedOptions } from './creatureSeed';
import { spellAreaFromText, spellElementFromText, type SpellArea } from './spellAreaText';
import { CreateSpellSchema } from '../validators/spells';
import type { AreaElement } from '../validators/areaLimits';
import { toJson } from '../utils/prisma-json';
import logger from '../utils/logger';

/** The fields of an Open5e v1 spell the seed reads. */
interface Open5eSpell {
  name: string;
  desc: string;
  higher_level: string;
  range: string;
  components: string;
  material: string;
  ritual: string;
  can_be_cast_as_ritual?: boolean;
  duration: string;
  requires_concentration?: boolean;
  concentration: string;
  casting_time: string;
  level_int: number;
  school: string;
}

// v1 has no area fields; v2 has them for 49 spells, some wrong (spellAreaText.ts).
const FIRST_PAGE = `${OPEN5E_ORIGIN}/v1/spells/?format=json&limit=50&document__slug=wotc-srd`;

/**
 * Where a spell's own words name something other than where it strikes, read
 * from the seeded text, by name. Every name is one Open5e served
 * (__tests__/spellAreaText.test.ts holds them to its list).
 */
export const SRD_SPELL_OVERRIDES: Record<string, { area?: SpellArea | null; element?: AreaElement }> = {
  // "a cylinder that is 10 feet tall with a 60-foot radius ... 100 feet
  // directly above you" is the storm cloud; each bolt strikes within 5 feet of a point.
  'Call Lightning': { area: null },
  // "an area ... that fills a 10-foot cube" is where the elemental comes from.
  'Conjure Elemental': { area: null },
  // Its "2d4 fire damage" is the web burning, not the spell.
  Web: { element: 'none' },
};

/** An Open5e spell as the library stores it, checked as a GM's spell is. */
export function transformSpell(s: Open5eSpell) {
  const override = SRD_SPELL_OVERRIDES[s.name] ?? {};
  const material = (s.material ?? '').trim().replace(/\.$/, '');
  const description = [s.desc ?? '', s.higher_level ? `**At Higher Levels.** ${s.higher_level}` : '']
    .filter((part) => part.trim() !== '')
    .join('\n\n');
  const area = 'area' in override ? override.area ?? null : spellAreaFromText(s.range, s.desc);
  return CreateSpellSchema.parse({
    name: s.name,
    gameSystem: 'FIFTH_EDITION',
    level: s.level_int,
    school: s.school,
    castingTime: s.casting_time,
    range: s.range,
    components: material ? `${s.components} (${material})` : s.components,
    duration: s.duration,
    concentration: s.requires_concentration ?? s.concentration === 'yes',
    ritual: s.can_be_cast_as_ritual ?? s.ritual === 'yes',
    description,
    area,
    element: override.element ?? (area ? spellElementFromText(s.desc) : 'none'),
  });
}

export interface SpellSeedResult {
  fetched: number;
  created: number;
  /** SRD spells already stored, brought up to what Open5e and the parser give now. */
  updated: number;
  /** Spells Open5e listed that the library would refuse, so not stored. */
  rejected: number;
}

/** Held while the SRD spells are read and written, by every seed in every process. */
export const SPELL_SEED_LOCK_KEY = 703_118_2027;
const SEED_WRITE_TIMEOUT_MS = 120_000;

/**
 * Seed the SRD spells. Safe to run again: a spell is found by its name among
 * the SRD ones (a unique index cannot hold where campaignId is null), under
 * a lock, so two seeds at once cannot both add it. An SRD spell no one can
 * edit, so a second run brings each stored one up to date instead of
 * skipping it. Custom spells are never touched. Throws SeedSourceError,
 * having written nothing, when Open5e cannot be read.
 */
export async function seedSrdSpells(prisma: PrismaClient, options: SeedOptions = {}): Promise<SpellSeedResult> {
  const spells = await fetchOpen5eList<Open5eSpell>(FIRST_PAGE, 'spells', options);

  let rejected = 0;
  const ready = new Map<string, ReturnType<typeof transformSpell>>();
  for (const spell of spells) {
    try {
      const data = transformSpell(spell);
      if (!ready.has(data.name)) ready.set(data.name, data);
    } catch (err) {
      rejected++;
      logger.warn(`Left out SRD spell "${String(spell?.name)}": it could not be read`, { err });
    }
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<SpellSeedResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SPELL_SEED_LOCK_KEY})`;
    const existing = await tx.spellTemplate.findMany({ where: { source: 'srd' }, select: { id: true, name: true } });
    const idByName = new Map(existing.map((e) => [e.name, e.id]));

    let updated = 0;
    const toCreate: Prisma.SpellTemplateCreateManyInput[] = [];
    for (const data of ready.values()) {
      const row = { ...data, area: spellAreaJson(data.area) };
      const id = idByName.get(data.name);
      if (id) {
        await tx.spellTemplate.update({ where: { id }, data: row });
        updated++;
      } else {
        toCreate.push({ ...row, id: randomUUID(), source: 'srd', campaignId: null, createdById: null });
      }
    }
    if (toCreate.length > 0) await tx.spellTemplate.createMany({ data: toCreate });
    return { fetched: spells.length, created: toCreate.length, updated, rejected };
  }, { timeout: SEED_WRITE_TIMEOUT_MS, maxWait: SEED_WRITE_TIMEOUT_MS });
}

/** A spell's area as its JSON column takes it: none is the database's null. */
export function spellAreaJson(area: SpellArea | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return area ? toJson(area) : Prisma.DbNull;
}

/** How many SRD spells this instance holds. */
export async function getSpellSeedStatus(prisma: PrismaClient): Promise<{ srdCount: number }> {
  return { srdCount: await prisma.spellTemplate.count({ where: { source: 'srd' } }) };
}
