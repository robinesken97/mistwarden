// Added for Mistwarden on 2026-11-27.
/**
 * A ZIP of pictures is imported into the asset library, one asset each.
 *
 * Nested folders become tags and the file its name; entries that leave the
 * archive, links, files of other types, and pictures over their upload limit
 * are skipped and reported; the stored picture is written again, so the
 * bytes that arrived are never served; a picture already in the library by
 * name and tags is skipped unless asked for; only a campaign's GM imports
 * into its library; and the archive's entry count and unpacked size are
 * capped.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mistwarden-zip-import-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;
// Small caps, so one test can pass each.
process.env.ASSET_ZIP_MAX_FILES = '20';
process.env.ASSET_ZIP_MAX_UNPACKED_MB = '1';

import { randomBytes } from 'crypto';
import request from 'supertest';
import sharp from 'sharp';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { writeZip, renameEntry, repeatedBytes, writeManyEntryZip, type FixtureEntry } from '../../__tests__/helpers/zipFixtures';

const app = createTestApp();
const users: string[] = [];
const campaigns: string[] = [];
let gm: ReturnType<typeof request.agent>;
let player: ReturnType<typeof request.agent>;
let campaignId: string;

async function signedIn(displayName: string) {
  const user = await createTestUser({ displayName });
  users.push(user.id);
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
  return { id: user.id, agent };
}

beforeAll(async () => {
  const g = await signedIn('Zip GM');
  const p = await signedIn('Zip Player');
  gm = g.agent;
  player = p.agent;
  const campaign = await createTestCampaign(g.id);
  campaigns.push(campaign.id);
  campaignId = campaign.id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: g.id, campaignId, role: 'GM', characterIds: [] },
      { userId: p.id, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
});

afterAll(async () => {
  await prisma.asset.deleteMany({ where: { uploadedById: { in: users } } });
  await cleanupCampaigns(campaigns);
  await cleanupUsers(users);
  await prisma.$disconnect();
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

const MARKER = 'imported-as-sent';

/** A small PNG carrying a text chunk, as a picture from elsewhere may. */
async function markedPng(colour: string): Promise<Buffer> {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: colour } }).png().toBuffer();
  const data = Buffer.from(`Comment\0${MARKER}`, 'latin1');
  const type = Buffer.from('tEXt', 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])), 8 + data.length);
  // After the signature and the IHDR chunk.
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

let fixture = 0;
async function zipOf(entries: FixtureEntry[], rename?: [string, string]): Promise<string> {
  fixture += 1;
  const file = path.join(UPLOAD_DIR, `fixture-${fixture}.zip`);
  await writeZip(file, entries);
  if (rename) renameEntry(file, rename[0], rename[1]);
  return file;
}

async function collection(): Promise<{ zip: string; horse: Buffer }> {
  const horse = await markedPng('#7a4a2a');
  const zip = await zipOf(
    [
      { name: 'Tokens/Beasts/Horses/brown_horse.png', data: horse },
      { name: 'Tokens/Beasts/wolf.png', data: await markedPng('#555555') },
      { name: 'Tokens/readme.txt', data: 'not a picture' },
      { name: 'Tokens/fake.png', data: 'text dressed as a picture' },
      { name: 'Tokens/XXevil.png', data: await markedPng('#ff0000') },
      { name: 'Tokens/link.png', data: '/etc/passwd', mode: 0o120777 },
      { name: 'Tokens/.DS_Store', data: 'finder' },
      { name: '__MACOSX/Tokens/._wolf.png', data: 'fork' },
      { name: 'Tokens/huge.png', data: () => repeatedBytes(6 * 1024 * 1024) },
    ],
    // yazl will not write a name that leaves the folder, so it is put there afterwards.
    ['Tokens/XXevil.png', '../../../evil.png']
  );
  return { zip, horse };
}

interface Job {
  id: string;
  status: string;
  total: number;
  processed: number;
  imported: { id: string; name: string }[];
  skipped: { file: string; reason: string }[];
  duplicates: string[];
  duplicateCount: number;
  message?: string;
}

async function finished(agent: ReturnType<typeof request.agent>, started: request.Response): Promise<Job> {
  expect(started.status).toBe(202);
  const id = started.body.job.id as string;
  for (let i = 0; i < 200; i++) {
    const res = await agent.get(`/api/assets/import-zip/${id}`).expect(200);
    if (res.body.job.status !== 'running') return res.body.job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the import did not finish');
}

const send = (agent: ReturnType<typeof request.agent>, zip: string, fields: Record<string, string>) => {
  let req = agent.post('/api/assets/import-zip');
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req.attach('file', zip, { filename: 'collection.zip', contentType: 'application/zip' });
};

describe('POST /api/assets/import-zip', () => {
  let job: Job;
  let horseBytes: Buffer;

  beforeAll(async () => {
    const { zip, horse } = await collection();
    horseBytes = horse;
    job = await finished(gm, await send(gm, zip, { type: 'TOKEN', scope: 'USER' }));
  });

  it('imports each picture named after its file and tagged with its folders, the shared top folder left out', async () => {
    expect(job.status).toBe('done');
    expect(job.imported.map((a) => a.name).sort()).toEqual(['brown horse', 'wolf']);
    const rows = await prisma.asset.findMany({ where: { id: { in: job.imported.map((a) => a.id) } }, orderBy: { name: 'asc' } });
    expect(rows.map((r) => [r.name, r.tags, r.type, r.scope])).toEqual([
      ['brown horse', ['Beasts', 'Horses'], 'TOKEN', 'USER'],
      ['wolf', ['Beasts'], 'TOKEN', 'USER'],
    ]);
    expect(rows.every((r) => r.thumbnailPath)).toBe(true);
  });

  it('skips and reports a traversal, a link, other files and a picture over its limit, and passes over hidden files', () => {
    const reasons = Object.fromEntries(job.skipped.map((s) => [s.file, s.reason]));
    expect(Object.keys(reasons).sort()).toEqual(
      ['../../../evil.png', 'Tokens/fake.png', 'Tokens/huge.png', 'Tokens/link.png', 'Tokens/readme.txt'].sort()
    );
    expect(reasons['Tokens/link.png']).toMatch(/link/);
    expect(reasons['Tokens/readme.txt']).toMatch(/Not a picture/);
    expect(reasons['Tokens/fake.png']).toMatch(/content is not a picture/);
    expect(reasons['Tokens/huge.png']).toMatch(/larger than/);
    expect(job.skipped.some((s) => s.reason.includes('leaves the archive'))).toBe(true);
    expect(fs.existsSync(path.join(UPLOAD_DIR, '..', 'evil.png'))).toBe(false);
  });

  it('serves the picture written again, not the bytes that arrived', async () => {
    const horse = job.imported.find((a) => a.name === 'brown horse')!;
    const res = await gm.get(`/api/assets/tokens/${horse.id}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const served = res.body as Buffer;
    expect(served.subarray(0, 8)).toEqual(horseBytes.subarray(0, 8));
    expect(served.equals(horseBytes)).toBe(false);
    expect(served.includes(Buffer.from(MARKER))).toBe(false);
    expect(horseBytes.includes(Buffer.from(MARKER))).toBe(true);
  });

  it('is found by a folder tag in the library and the token picker', async () => {
    for (const query of ['?search=horses', '?search=Horses&type=TOKEN&usable=true']) {
      const res = await gm.get(`/api/assets${query}`).expect(200);
      expect(res.body.assets.map((a: { name: string }) => a.name)).toEqual(['brown horse']);
    }
  });

  it('skips a picture the library has by name and tags, and imports it again when asked', async () => {
    const again = await finished(gm, await send(gm, (await collection()).zip, { type: 'TOKEN', scope: 'USER' }));
    expect(again.imported).toEqual([]);
    expect(again.duplicateCount).toBe(2);
    expect(again.duplicates.sort()).toEqual(['Tokens/Beasts/Horses/brown_horse.png', 'Tokens/Beasts/wolf.png']);

    const anyway = await finished(gm, await send(gm, (await collection()).zip, { type: 'TOKEN', scope: 'USER', allowDuplicates: 'true' }));
    expect(anyway.imported).toHaveLength(2);
    expect(anyway.duplicateCount).toBe(0);
  });

  it('keeps the top folder as a tag when asked, and adds the tags given', async () => {
    const zip = await zipOf([{ name: 'Pack/Undead/skeleton archer.png', data: await markedPng('#eeeeee') }]);
    const done = await finished(gm, await send(gm, zip, { type: 'TOKEN', dropTopFolder: 'false', tags: 'Drive, Set 1' }));
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: done.imported[0].id } });
    expect([row.name, row.tags]).toEqual(['skeleton archer', ['Drive', 'Set 1', 'Pack', 'Undead']]);
  });

  it("lets the campaign's GM import into its library, and refuses a player", async () => {
    const zip = await zipOf([{ name: 'Npcs/guard.png', data: await markedPng('#3333aa') }]);
    const refused = await send(player, zip, { type: 'TOKEN', scope: 'CAMPAIGN', campaignId });
    expect(refused.status).toBe(403);
    const done = await finished(gm, await send(gm, zip, { type: 'TOKEN', scope: 'CAMPAIGN', campaignId }));
    const row = await prisma.asset.findUniqueOrThrow({ where: { id: done.imported[0].id } });
    expect([row.scope, row.campaignId]).toEqual(['CAMPAIGN', campaignId]);
    expect(row.filePath).toContain(path.join('tokens', 'campaigns', campaignId));
  });

  it('refuses a GLOBAL import from anyone but an admin or global asset manager, and other types', async () => {
    const zip = await zipOf([{ name: 'a.png', data: await markedPng('#000000') }]);
    expect((await send(player, zip, { type: 'TOKEN', scope: 'GLOBAL' })).status).toBe(403);
    expect((await send(player, zip, { type: 'AUDIO' })).status).toBe(400);
  });

  it('refuses an archive listing more entries than it may hold, and a file that is not a ZIP', async () => {
    const many = path.join(UPLOAD_DIR, 'many.zip');
    await writeManyEntryZip(many, 21);
    const res = await send(player, many, { type: 'TOKEN' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/more than the 20/);
    const notZip = path.join(UPLOAD_DIR, 'not.zip');
    fs.writeFileSync(notZip, 'plain text');
    expect((await send(player, notZip, { type: 'TOKEN' })).status).toBe(400);
  });

  it('stops once the archive has unpacked more than it may, keeping what came before', async () => {
    const zip = await zipOf([
      { name: 'a.png', data: randomBytes(700 * 1024), store: true },
      { name: 'b.png', data: randomBytes(700 * 1024), store: true },
    ]);
    const done = await finished(player, await send(player, zip, { type: 'TOKEN' }));
    expect(done.status).toBe('failed');
    expect(done.message).toMatch(/unpacks to more than 1 MB/);
    expect(done.processed).toBe(1);
  });

  it('answers 404 for a job that is not the caller’s', async () => {
    const zip = await zipOf([{ name: 'mine.png', data: await markedPng('#123456') }]);
    const started = await send(gm, zip, { type: 'TOKEN' });
    await finished(gm, started);
    expect((await player.get(`/api/assets/import-zip/${started.body.job.id}`)).status).toBe(404);
  });

  it('leaves no archive behind', () => {
    const dir = path.join(UPLOAD_DIR, 'temp', 'asset-zip-imports');
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });
});
