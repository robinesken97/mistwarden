/**
 * The instance's imported creatures (routes/creatureImport.ts): who may
 * import, delete and match pictures (an administrator), what a dry run
 * writes (nothing), what importing again does (updates in place), how one of
 * an SRD creature's name is kept beside it, who reads them (a campaign's GM,
 * never a player), and that no campaign archive carries them.
 *
 * The stat blocks are invented for these tests.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cozyvtt-creature-import-'));
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
const assets: string[] = [];

const block = (name: string, hp = 11) => `### ${name}

*Medium beast, unaligned*

**Armor Class** 12

**Hit Points** ${hp} (2d8 + 2)

**Speed** 30 ft.

| STR | DEX | CON | INT | WIS | CHA |
|-----|-----|-----|-----|-----|-----|
| 12 (+1) | 14 (+2) | 12 (+1) | 3 (-4) | 10 (+0) | 5 (-3) |

**Senses** passive Perception 10

**Languages** —

**Challenge** 1/4 (50 XP)

**Actions**

**Bite.** Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.
`;

const FILE = [
  `# Field Notes ${run}`,
  `## Draft`,
  block(`Draft Beast ${run}`),
  `## Checked Blocks`,
  block(`Moss Toad ${run}`),
  block(`Reed Stalker ${run}`),
  `### Swarm Template ${run}\n\nA swarm uses these rules.\n`,
].join('\n\n');

async function signIn(role: 'ADMIN' | 'USER' = 'USER'): Promise<{ id: string; agent: request.Agent }> {
  const user = await createTestUser({ role, displayName: `Import ${role}` });
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
    ],
  });
});

afterAll(async () => {
  await prisma.creatureTemplate.deleteMany({ where: { name: { endsWith: run } } });
  await prisma.asset.deleteMany({ where: { id: { in: assets } } });
  await prisma.campaign.deleteMany({ where: { ownerId: { in: users } } });
  await cleanupCampaigns(campaigns);
  await cleanupUsers(users);
  await prisma.$disconnect();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const imported = () => prisma.creatureTemplate.findMany({ where: { source: `custom:${tag}` }, orderBy: { name: 'asc' } });
const importFile = (agent: request.Agent, body: Record<string, unknown>) =>
  agent.post('/api/creatures/import-markdown').send({ markdown: FILE, sourceTag: tag, ...body });

describe('POST /api/creatures/import-markdown', () => {
  it('is an administrator\'s alone', async () => {
    expect((await request(app).post('/api/creatures/import-markdown').send({ markdown: FILE, sourceTag: tag })).status).toBe(401);
    expect((await importFile(gm.agent, {})).status).toBe(403);
    expect(await imported()).toEqual([]);
  });

  it('refuses a tag it cannot store and a heading the file does not have', async () => {
    expect((await importFile(admin.agent, { sourceTag: 'Not a tag!' })).status).toBe(400);
    const missing = await importFile(admin.agent, { onlyUnderHeading: 'Nowhere' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toBe('The file has no heading "Nowhere"');
  });

  it('reports a dry run, and writes nothing', async () => {
    const res = await importFile(admin.agent, { dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, armorClassLines: 3, counts: { imported: 3, updated: 0, skipped: 1, errors: 0 } });
    expect(res.body.rows.map((r: { name: string; status: string }) => [r.name, r.status])).toEqual([
      [`Draft Beast ${run}`, 'imported'], [`Moss Toad ${run}`, 'imported'], [`Reed Stalker ${run}`, 'imported'], [`Swarm Template ${run}`, 'skipped'],
    ]);
    expect(await imported()).toEqual([]);
  });

  it('imports only the blocks under a heading, and updates them in place when run again', async () => {
    const first = await importFile(admin.agent, { onlyUnderHeading: '## Checked Blocks' });
    expect(first.status).toBe(200);
    expect(first.body.counts).toEqual({ imported: 2, updated: 0, skipped: 1, errors: 0 });
    const before = await imported();
    expect(before.map((c) => c.name)).toEqual([`Moss Toad ${run}`, `Reed Stalker ${run}`]);
    expect(before[0]).toMatchObject({ campaignId: null, createdById: null, imageUrl: null, challengeRating: '1/4', creatureType: 'Medium beast', alignment: 'unaligned' });

    const again = await importFile(admin.agent, { onlyUnderHeading: 'Checked Blocks', markdown: FILE.replace(block(`Moss Toad ${run}`), block(`Moss Toad ${run}`, 13)) });
    expect(again.body.counts).toEqual({ imported: 0, updated: 2, skipped: 1, errors: 0 });
    const after = await imported();
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    expect((after[0].statBlock as { hpMax: number }).hpMax).toBe(13);
  });

  it('keeps one of an SRD creature\'s name beside it, and lists the imported one first', async () => {
    const srd = await prisma.creatureTemplate.create({
      data: { name: `Moss Toad ${run}`, source: 'srd', gameSystem: 'FIFTH_EDITION', statBlock: { ac: 10, speed: '20 ft.', abilities: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } } },
    });
    const res = await gm.agent.get(`/api/campaigns/${campaignId}/creatures`).query({ search: `Moss Toad ${run}` });
    expect(res.status).toBe(200);
    expect(res.body.creatures.map((c: { source: string }) => c.source)).toEqual([`custom:${tag}`, 'srd']);
    expect((await prisma.creatureTemplate.findUnique({ where: { id: srd.id } }))?.statBlock).toMatchObject({ ac: 10 });
    await prisma.creatureTemplate.delete({ where: { id: srd.id } });
  });

  it('is read by a campaign\'s GM, not changed by one, and never read by a player', async () => {
    const [toad] = await imported();
    expect((await gm.agent.get(`/api/campaigns/${campaignId}/creatures/${toad.id}`)).status).toBe(200);
    expect((await gm.agent.put(`/api/campaigns/${campaignId}/creatures/${toad.id}`).send({ name: 'Renamed' })).status).toBe(403);
    expect((await gm.agent.delete(`/api/campaigns/${campaignId}/creatures/${toad.id}`)).status).toBe(403);
    expect((await player.agent.get(`/api/campaigns/${campaignId}/creatures`)).status).toBe(403);
    expect((await player.agent.get(`/api/campaigns/${campaignId}/creatures/${toad.id}`)).status).toBe(403);
  });

  it('stays out of a campaign archive, which carries the campaign\'s own creatures', async () => {
    await prisma.creatureTemplate.create({
      data: { name: `Own Beast ${run}`, source: 'custom', campaignId, createdById: gm.id, statBlock: { ac: 10, speed: '30 ft.', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } } },
    });
    const file = path.join(SCRATCH, 'archive.cozyvtt');
    const prepared = await prepareCampaignExport(campaignId, { userId: gm.id, isAdmin: false });
    await prepared.writeTo(fs.createWriteStream(file));
    const result = await importCampaign(file, gm.id);
    const copies = await prisma.creatureTemplate.findMany({ where: { campaignId: result.campaignId } });
    expect(copies.map((c) => c.name)).toEqual([`Own Beast ${run}`]);
  });
});

describe('POST /api/creatures/match-token-pictures', () => {
  it('gives an imported creature with no picture the shared token picture of its name, and only that', async () => {
    const picture = (name: string, scope: 'GLOBAL' | 'USER') => prisma.asset.create({
      data: { type: 'TOKEN', scope, uploadedById: admin.id, filename: `${randomUUID()}.webp`, originalName: `${name}.webp`, mimeType: 'image/webp', fileSize: 10, filePath: `tokens/${name}.webp`, name, tags: [] },
    });
    const shared = await picture(`moss_toad-${run}`, 'GLOBAL');
    const personal = await picture(`Reed Stalker ${run}`, 'USER');
    assets.push(shared.id, personal.id);

    expect((await gm.agent.post('/api/creatures/match-token-pictures').send({ sourceTag: tag })).status).toBe(403);
    const res = await admin.agent.post('/api/creatures/match-token-pictures').send({ sourceTag: tag });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matched: [{ creature: `Moss Toad ${run}`, sourceTag: tag, picture: `moss_toad-${run}`, otherPicturesOfTheName: 0 }], withoutPicture: 1 });
    const [toad, stalker] = await imported();
    expect(toad.imageUrl).toBe(`/api/assets/tokens/${shared.id}`);
    expect(stalker.imageUrl).toBeNull();

    // Repeatable: a creature that has a picture is left alone.
    expect((await admin.agent.post('/api/creatures/match-token-pictures').send({})).body.matched).toEqual([]);
  });

  it('keeps the picture when the file is imported again', async () => {
    await importFile(admin.agent, { onlyUnderHeading: 'Checked Blocks' });
    expect((await imported())[0].imageUrl).toMatch(/^\/api\/assets\/tokens\//);
  });
});

describe('DELETE /api/creatures/imported/:sourceTag', () => {
  it('deletes a tag\'s creatures, an administrator\'s alone', async () => {
    expect((await gm.agent.delete(`/api/creatures/imported/${tag}`)).status).toBe(403);
    const res = await admin.agent.delete(`/api/creatures/imported/${tag}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sourceTag: tag, deleted: 2 });
    expect(await imported()).toEqual([]);
    expect((await admin.agent.delete('/api/creatures/imported/NOT%20A%20TAG')).status).toBe(400);
  });
});
