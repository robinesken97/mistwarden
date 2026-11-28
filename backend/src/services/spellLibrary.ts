/**
 * The Spell Library's custom spells: the instance's own (scope null, an
 * administrator's) and a campaign's own (its GM's). One set of writes for
 * both routers, each confined to its scope: a spell of another scope, the
 * SRD's included, answers as one that is not there, so an id proves nothing.
 *
 * Which spell a name means, where several share it: the campaign's, then
 * the instance's, then the SRD's (the frontend's resolveSpellByName).
 */

import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../config/database';
import { CreateSpellSchema, UpdateSpellSchema } from '../validators/spells';
import { issueMessages } from '../validators/issueMessages';
import { spellAreaJson } from './spellSeed';

/** A campaign's id, or null for the instance's own spells. */
export type SpellScope = string | null;

export interface SpellOutcome {
  status: number;
  body: unknown;
}

/** The most custom spells one scope holds, which is what a campaign archive carries. */
export const MAX_SPELLS_PER_SCOPE = 2000;

export const SPELL_NOT_FOUND = 'Spell not found';

/** Every field but the description, which a list leaves out: the SRD's alone is half a megabyte. */
export const SPELL_LIST_SELECT = {
  id: true, name: true, source: true, gameSystem: true, campaignId: true, level: true, school: true,
  castingTime: true, range: true, components: true, duration: true, concentration: true, ritual: true,
  area: true, element: true,
} as const satisfies Prisma.SpellTemplateSelect;

/** What a campaign's members are shown: the SRD's and the instance's spells, and the campaign's own. */
export const visibleFrom = (campaignId: string): Prisma.SpellTemplateWhereInput => ({
  OR: [{ campaignId: null }, { campaignId }],
});

const notFound = (): SpellOutcome => ({ status: 404, body: { error: 'Not Found', message: SPELL_NOT_FOUND } });
const refused = (message: string): SpellOutcome => ({ status: 400, body: { error: 'Validation Error', message } });

/** A custom spell of this scope, or null: never the SRD's, nor another scope's. */
async function ownSpell(scope: SpellScope, spellId: string) {
  const spell = await prisma.spellTemplate.findUnique({ where: { id: spellId } });
  return spell && spell.source === 'custom' && spell.campaignId === scope ? spell : null;
}

/** Whether another spell of this scope has the name already, in any case. */
async function nameTaken(scope: SpellScope, name: string, exceptId?: string): Promise<boolean> {
  const clash = await prisma.spellTemplate.findFirst({
    where: { campaignId: scope, source: 'custom', name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return clash !== null;
}

const nameTakenOutcome = (scope: SpellScope): SpellOutcome => ({
  status: 409,
  body: { error: 'Conflict', message: `${scope ? 'This campaign' : 'This server'} has a spell of that name already. Give this one another name, or edit that one.` },
});

export async function createSpell(scope: SpellScope, userId: string, input: unknown): Promise<SpellOutcome> {
  const parsed = CreateSpellSchema.safeParse(input);
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const data = parsed.data;
  if (await nameTaken(scope, data.name)) return nameTakenOutcome(scope);
  if (await prisma.spellTemplate.count({ where: { campaignId: scope, source: 'custom' } }) >= MAX_SPELLS_PER_SCOPE) {
    return refused(`${scope ? 'A campaign' : 'This server'} can hold ${MAX_SPELLS_PER_SCOPE.toLocaleString('en-US')} spells of its own. Delete one it no longer uses first.`);
  }
  const spell = await prisma.spellTemplate.create({
    data: { ...data, area: spellAreaJson(data.area), id: randomUUID(), source: 'custom', campaignId: scope, createdById: userId },
  });
  return { status: 201, body: spell };
}

export async function updateSpell(scope: SpellScope, spellId: string, input: unknown): Promise<SpellOutcome> {
  const parsed = UpdateSpellSchema.safeParse(input);
  if (!parsed.success) return refused(issueMessages(parsed.error));
  const existing = await ownSpell(scope, spellId);
  if (!existing) return notFound();
  const { area, ...data } = parsed.data;
  if (data.name !== undefined && await nameTaken(scope, data.name, spellId)) return nameTakenOutcome(scope);
  const spell = await prisma.spellTemplate.update({
    where: { id: spellId },
    data: { ...data, ...(area !== undefined && { area: spellAreaJson(area) }) },
  });
  return { status: 200, body: spell };
}

export async function deleteSpell(scope: SpellScope, spellId: string): Promise<SpellOutcome> {
  if (!(await ownSpell(scope, spellId))) return notFound();
  await prisma.spellTemplate.delete({ where: { id: spellId } });
  return { status: 200, body: { message: 'Spell deleted' } };
}
