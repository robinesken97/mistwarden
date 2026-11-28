/**
 * The instance's imported spells (POST /api/spells/import-markdown, DELETE
 * /api/spells/imported/:sourceTag): who may import and delete (an
 * administrator), what a dry run writes (nothing), what importing again does
 * (updates in place), how one of an SRD spell's name is kept beside it, what
 * a player reads of one (everything but the description, which the GM and an
 * administrator read), and that no campaign archive carries them.
 *
 * The spells are invented for these tests.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-spell-import-'));
process.env.UPLOAD_DIR = path.join(SCRATCH, 'uploads');

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { prepareCampaignExport } from '../../services/campaignExporter';
import { importCampaign } from '../../services/campaignImporter';

jest.setTimeout(60000);

const app = createTestApp();
const run = randomUUID().slice(0, 8);
const tag = `t${run}`;
const users: string[] = [];
const campaigns: string[] = [];

const spell = (name: string, range = '90 feet') => `### ${name}
*2nd-level evocation*
**Casting Time:** 1 action
**Range:** ${range}
**Components:** V, S
**Duration:** Instantaneous

Frost bursts in a 10-foot-radius sphere. Each creature in it takes 3d6 cold damage.
`;

const FILE = [`## Field Spells ${run}`, spell(`Frost Bloom ${run}`), spell(`Rime Step ${run}`)].join('\n\n');

async function signIn(role: 'ADMIN' | 'USER' = 'USER'): Promise<{ id: string; agent: request.Agent }> {
  const user = await createTestUser({ role, displayName: `Spell Import ${role}` });
  users.push(user.id);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  return { id: user.id, agent };
}

let admin: { id: string; agent: request.Agent };
let gm: { id: string; agent: request.Agent };
let player: { id: string; agent: request.Agent };
let campaignId: string;

beforeAll(async () => {
  admin = await signIn('ADMIN');
  gm = await signIn();
  player = await signIn();
  const campaign = await createTestCampaign(gm.id);
  campaignId = campaign.id;
  campaigns.push(campaignId);
  await prisma.campaignMembership.createMany({
    data: [
      { userId: gm.id, campaignId, role: 'GM', characterIds: [] },
      { userId: player.id, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: admin.id, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
});

afterAll(async () => {
  await prisma.spellTemplate.deleteMany({ where: { name: { endsWith: run } } });
  await prisma.campaign.deleteMany({ where: { ownerId: { in: users } } });
  await cleanupCampaigns(campaigns);
  await cleanupUsers(users);
  await prisma.$disconnect();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const imported = () => prisma.spellTemplate.findMany({ where: { source: `custom:${tag}` }, orderBy: { name: 'asc' } });
const importFile = (agent: request.Agent, body: Record<string, unknown>) =>
  agent.post('/api/spells/import-markdown').send({ markdown: FILE, sourceTag: tag, ...body });

describe('POST /api/spells/import-markdown', () => {
  it('is an administrator\'s alone, and refuses a tag it cannot store', async () => {
    expect((await request(app).post('/api/spells/import-markdown').send({ markdown: FILE, sourceTag: tag })).status).toBe(401);
    expect((await importFile(gm.agent, {})).status).toBe(403);
    expect((await importFile(admin.agent, { sourceTag: 'Not a tag!' })).status).toBe(400);
    expect(await imported()).toEqual([]);
  });

  it('reports a dry run, and writes nothing', async () => {
    const res = await importFile(admin.agent, { dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, castingTimeLines: 2, counts: { imported: 2, updated: 0, skipped: 1, errors: 0 } });
    expect(res.body.rows.map((r: { name: string; status: string }) => [r.name, r.status])).toEqual([
      [`Field Spells ${run}`, 'skipped'], [`Frost Bloom ${run}`, 'imported'], [`Rime Step ${run}`, 'imported'],
    ]);
    expect(await imported()).toEqual([]);
  });

  it('reads a name twice in one file once, and lists the second', async () => {
    const res = await admin.agent.post('/api/spells/import-markdown')
      .send({ markdown: `${spell(`Twin Spark ${run}`)}\n${spell(`twin-spark ${run}`)}`, sourceTag: tag, dryRun: true });
    expect(res.body.rows.map((r: { status: string; reason?: string }) => [r.status, r.reason])).toEqual([
      ['imported', undefined], ['skipped', 'Same name as a spell earlier in the file: not read twice'],
    ]);
  });

  it('imports with no campaign under the tag, and updates in place when run again', async () => {
    const first = await importFile(admin.agent, {});
    expect(first.body.counts).toEqual({ imported: 2, updated: 0, skipped: 1, errors: 0 });
    const before = await imported();
    expect(before[0]).toMatchObject({
      name: `Frost Bloom ${run}`, campaignId: null, createdById: null, level: 2, school: 'Evocation', range: '90 feet',
      area: { shape: 'sphere', sizeFt: 10 }, element: 'cold',
    });

    const again = await importFile(admin.agent, { markdown: FILE.replace(spell(`Frost Bloom ${run}`), spell(`Frost Bloom ${run}`, '120 feet')) });
    expect(again.body.counts).toEqual({ imported: 0, updated: 2, skipped: 1, errors: 0 });
    const after = await imported();
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(after[0].range).toBe('120 feet');
  });

  it('keeps one of an SRD spell\'s name beside it, listed after the imported one', async () => {
    const srd = await prisma.spellTemplate.create({ data: { name: `Frost Bloom ${run}`, source: 'srd', level: 2, description: 'The SRD text.' } });
    const res = await gm.agent.get(`/api/campaigns/${campaignId}/spells`);
    const same = res.body.spells.filter((s: { name: string }) => s.name === `Frost Bloom ${run}`);
    expect(same.map((s: { source: string }) => s.source)).toEqual([`custom:${tag}`, 'srd']);
    await prisma.spellTemplate.delete({ where: { id: srd.id } });
  });

  it('shows a player everything of an imported spell but its description, which the GM and an administrator read', async () => {
    const [bloom] = await imported();
    const list = await player.agent.get(`/api/campaigns/${campaignId}/spells`);
    const listed = list.body.spells.find((s: { id: string }) => s.id === bloom.id);
    expect(listed).toMatchObject({ name: bloom.name, level: 2, school: 'Evocation', castingTime: '1 action', area: { shape: 'sphere', sizeFt: 10 }, element: 'cold' });
    expect(listed).not.toHaveProperty('description');

    const asPlayer = await player.agent.get(`/api/campaigns/${campaignId}/spells/${bloom.id}`);
    expect(asPlayer.status).toBe(200);
    expect(asPlayer.body).toMatchObject({ name: bloom.name, range: '120 feet', components: 'V, S', duration: 'Instantaneous', description: null });
    expect((await gm.agent.get(`/api/campaigns/${campaignId}/spells/${bloom.id}`)).body.description).toMatch(/^Frost bursts/);
    expect((await admin.agent.get(`/api/campaigns/${campaignId}/spells/${bloom.id}`)).body.description).toMatch(/^Frost bursts/);

    // An SRD spell's description is the player's to read, as before.
    const srd = await prisma.spellTemplate.create({ data: { name: `Open Spell ${run}`, source: 'srd', level: 1, description: 'Free text.' } });
    expect((await player.agent.get(`/api/campaigns/${campaignId}/spells/${srd.id}`)).body.description).toBe('Free text.');
  });

  it('is changed by no write but an import: the instance\'s and the campaign\'s routes answer 404', async () => {
    const [bloom] = await imported();
    expect((await admin.agent.put(`/api/spells/${bloom.id}`).send({ name: 'Renamed' })).status).toBe(404);
    expect((await admin.agent.delete(`/api/spells/${bloom.id}`)).status).toBe(404);
    expect((await gm.agent.delete(`/api/campaigns/${campaignId}/spells/${bloom.id}`)).status).toBe(404);
  });

  it('stays out of a campaign archive, which carries the campaign\'s own spells', async () => {
    await prisma.spellTemplate.create({ data: { name: `Own Spell ${run}`, source: 'custom', campaignId, createdById: gm.id, level: 1 } });
    const file = path.join(SCRATCH, 'archive.cozyvtt');
    const prepared = await prepareCampaignExport(campaignId, { userId: gm.id, isAdmin: false });
    await prepared.writeTo(fs.createWriteStream(file));
    const result = await importCampaign(file, gm.id);
    const copies = await prisma.spellTemplate.findMany({ where: { campaignId: result.campaignId } });
    expect(copies.map((s) => s.name)).toEqual([`Own Spell ${run}`]);
  });
});

describe('DELETE /api/spells/imported/:sourceTag', () => {
  it('deletes a tag\'s spells, an administrator\'s alone', async () => {
    expect((await gm.agent.delete(`/api/spells/imported/${tag}`)).status).toBe(403);
    const res = await admin.agent.delete(`/api/spells/imported/${tag}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sourceTag: tag, deleted: 2 });
    expect(await imported()).toEqual([]);
    expect((await admin.agent.delete('/api/spells/imported/NOT%20A%20TAG')).status).toBe(400);
  });
});
