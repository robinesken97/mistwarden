/**
 * A campaign archive carries the campaign's own spells, in
 * `spells/spells.json`, and an import gives them to the new campaign. The
 * SRD's spells and the instance's own belong to the server, not the
 * campaign, and stay out. A spell the library would refuse is left out and
 * listed; text longer than it keeps is cut.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-archive-spells-'));
process.env.UPLOAD_DIR = path.join(SCRATCH, 'uploads');

import { importCampaign } from '../campaignImporter';
import { prepareCampaignExport } from '../campaignExporter';
import { prisma, createTestUser, createTestCampaign, cleanupUsers } from '../../__tests__/helpers/db';
import { writeZip } from '../../__tests__/helpers/zipFixtures';
import { openArchiveFile } from '../../utils/archive';
import { SPELL_LIMITS } from '../../validators/spells';

jest.setTimeout(60000);

const run = randomUUID().slice(0, 8);
let userId: string;

beforeAll(async () => {
  userId = (await createTestUser({ displayName: 'Archive Spells' })).id;
});

afterAll(async () => {
  await prisma.spellTemplate.deleteMany({ where: { name: { endsWith: run } } });
  await prisma.campaign.deleteMany({ where: { ownerId: userId } });
  await cleanupUsers([userId]);
  await prisma.$disconnect();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

it('carries the campaign\'s own spells there and back, and neither the SRD\'s nor the instance\'s', async () => {
  const source = await createTestCampaign(userId, { name: 'Spellbook' });
  await prisma.campaignMembership.create({ data: { userId, campaignId: source.id, role: 'GM', characterIds: [] } });
  await prisma.spellTemplate.createMany({
    data: [
      {
        name: `Ember Rain ${run}`, source: 'custom', campaignId: source.id, createdById: userId, level: 2, school: 'Evocation',
        castingTime: '1 action', range: '60 feet', components: 'V, S', duration: 'Instantaneous', concentration: true, ritual: false,
        description: 'Embers fall in a 10-foot-radius, 20-foot-high cylinder.', area: { shape: 'cylinder', sizeFt: 10 }, element: 'fire',
      },
      { name: `Quiet Word ${run}`, source: 'custom', campaignId: source.id, createdById: userId, level: 0 },
      { name: `Server Spell ${run}`, source: 'custom', campaignId: null, createdById: userId, level: 1 },
      { name: `SRD Spell ${run}`, source: 'srd', campaignId: null, level: 1, area: { shape: 'cone', sizeFt: 15 } },
    ],
  });

  const file = path.join(SCRATCH, 'spellbook.cozyvtt');
  const prepared = await prepareCampaignExport(source.id, { userId, isAdmin: false });
  await prepared.writeTo(fs.createWriteStream(file));
  const directory = await openArchiveFile(file, 100);
  expect(directory.files.map((f) => f.path)).toContain('spells/spells.json');

  const result = await importCampaign(file, userId);
  expect(result.skipped).toEqual([]);
  const imported = await prisma.spellTemplate.findMany({ where: { campaignId: result.campaignId }, orderBy: { name: 'asc' } });
  expect(imported.map((s) => s.name)).toEqual([`Ember Rain ${run}`, `Quiet Word ${run}`]);
  expect(imported[0]).toMatchObject({
    source: 'custom', createdById: userId, level: 2, school: 'Evocation', castingTime: '1 action', range: '60 feet',
    components: 'V, S', duration: 'Instantaneous', concentration: true, ritual: false,
    description: 'Embers fall in a 10-foot-radius, 20-foot-high cylinder.', area: { shape: 'cylinder', sizeFt: 10 }, element: 'fire',
  });
  expect(imported[1]).toMatchObject({ area: null, element: 'none', description: '' });
});

it('leaves out a spell the library would refuse, and cuts text it would not keep', async () => {
  const file = path.join(SCRATCH, 'crafted.cozyvtt');
  await writeZip(file, [
    {
      name: 'manifest.json',
      data: JSON.stringify({
        formatVersion: 1, exportedAt: '2026-11-28T12:00:00.000Z', exportedFrom: 'Mistwarden v1.0.0', campaignName: 'Crafted',
        gameSystem: 'NONE', mapCount: 0, tokenCount: 0, creatureCount: 0, tokenTemplateCount: 0, assetCount: 0,
        includesAudio: false, totalSizeBytes: 0,
      }),
    },
    { name: 'campaign.json', data: JSON.stringify({ name: 'Crafted', description: null, gameSystem: null, vibeSettings: { periods: [] } }) },
    {
      name: 'spells/spells.json',
      data: JSON.stringify([
        { name: `Long Tale ${run}`, level: 1, description: 'x'.repeat(SPELL_LIMITS.maxDescriptionLength + 50) },
        { name: `Bad Area ${run}`, level: 1, area: { shape: 'blob', sizeFt: 10 } },
      ]),
    },
    { name: 'assets/asset-manifest.json', data: '{}' },
  ]);

  const result = await importCampaign(file, userId);
  expect(result.skipped).toEqual([expect.objectContaining({ kind: 'spell', name: `Bad Area ${run}` })]);
  const [kept] = await prisma.spellTemplate.findMany({ where: { campaignId: result.campaignId } });
  expect(kept.name).toBe(`Long Tale ${run}`);
  expect(kept.description.length).toBeLessThanOrEqual(SPELL_LIMITS.maxDescriptionLength);
  expect(result.warnings.some((w) => w.startsWith(`Spell "Long Tale ${run}": shortened its description`))).toBe(true);
});
