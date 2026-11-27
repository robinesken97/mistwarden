// Added for Mistwarden on 2026-11-27.
/**
 * A campaign's gallery shows a picture to the players the GM chose and to
 * nobody else: not in the gallery list, not in the asset list, and not when
 * the file or its thumbnail is asked for by address.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import sharp from 'sharp';

const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mistwarden-gallery-'));
process.env.UPLOAD_DIR = UPLOAD_DIR;

jest.mock('../../websocket/utils', () => ({
  ...jest.requireActual('../../websocket/utils'),
  broadcastToCampaign: jest.fn(),
  broadcastToUser: jest.fn(),
}));

import { broadcastToCampaign, broadcastToUser } from '../../websocket/utils';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';

const app = createTestApp();

type Agent = ReturnType<typeof request.agent>;
let campaignId: string;
let otherCampaignId: string;
const ids: Record<'gm' | 'a' | 'b' | 'stranger', string> = { gm: '', a: '', b: '', stranger: '' };
const agents = {} as Record<'gm' | 'a' | 'b', Agent>;
let assetId: string;
let pictureId: string;

async function signIn(email: string): Promise<Agent> {
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })).status).toBe(200);
  return agent;
}

beforeAll(async () => {
  const stamp = Date.now();
  for (const who of ['gm', 'a', 'b', 'stranger'] as const) {
    ids[who] = (await createTestUser({ email: `gallery-${who}-${stamp}@test.cozyvtt.local`, displayName: `Gallery ${who}` })).id;
  }
  campaignId = (await createTestCampaign(ids.gm, { name: `Gallery ${stamp}` })).id;
  otherCampaignId = (await createTestCampaign(ids.stranger, { name: `Elsewhere ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: ids.gm, campaignId, role: 'GM', characterIds: [] },
      { userId: ids.a, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: ids.b, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: ids.stranger, campaignId: otherCampaignId, role: 'GM', characterIds: [] },
    ],
  });
  agents.gm = await signIn(`gallery-gm-${stamp}@test.cozyvtt.local`);
  agents.a = await signIn(`gallery-a-${stamp}@test.cozyvtt.local`);
  agents.b = await signIn(`gallery-b-${stamp}@test.cozyvtt.local`);

  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#553344' } }).png().toBuffer();
  const upload = await agents.gm
    .post('/api/assets/upload')
    .field('type', 'MAP')
    .field('scope', 'CAMPAIGN')
    .field('campaignId', campaignId)
    .attach('file', png, { filename: 'crypt.png' });
  expect(upload.status).toBe(201);
  assetId = upload.body.asset.id;
});

afterAll(async () => {
  await prisma.asset.deleteMany({ where: { uploadedById: ids.gm } });
  await cleanupCampaigns([campaignId, otherCampaignId]);
  await cleanupUsers(Object.values(ids));
  await prisma.$disconnect();
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

const gallery = (who: 'gm' | 'a' | 'b') => agents[who].get(`/api/campaigns/${campaignId}/gallery`);
const listed = async (who: 'a' | 'b') =>
  (await agents[who].get(`/api/assets?campaignId=${campaignId}`)).body.assets?.map((x: { id: string }) => x.id) ?? [];
const opens = async (who: 'a' | 'b') => ({
  file: (await agents[who].get(`/api/assets/maps/${assetId}`)).status,
  thumbnail: (await agents[who].get(`/api/assets/maps/${assetId}/thumbnail`)).status,
});
const change = (body: object) => agents.gm.patch(`/api/campaigns/${campaignId}/gallery/${pictureId}`).send(body);

describe('the campaign gallery', () => {
  it('files a picture for the GM and shows it to nobody yet', async () => {
    const res = await agents.gm.post(`/api/campaigns/${campaignId}/gallery`).send({ assetId, name: 'The crypt', folder: 'Act 1' });
    expect(res.status).toBe(201);
    pictureId = res.body.picture.id;
    expect((await gallery('gm')).body.pictures).toEqual([expect.objectContaining({ name: 'The crypt', folder: 'Act 1', shownTo: [] })]);
    for (const who of ['a', 'b'] as const) {
      expect((await gallery(who)).body.pictures).toEqual([]);
      expect(await listed(who)).not.toContain(assetId);
      const { file, thumbnail } = await opens(who);
      expect([file, thumbnail]).toEqual([404, 404]);
    }
  });

  it('shows a picture to the chosen player alone', async () => {
    jest.mocked(broadcastToUser).mockClear();
    expect((await change({ shownTo: [ids.a] })).status).toBe(200);
    // Only A is told to open it, with no folder in what they are sent.
    expect(jest.mocked(broadcastToUser).mock.calls).toEqual([
      [ids.a, 'gallery.shown', { campaignId, picture: expect.not.objectContaining({ folder: expect.anything() }) }],
    ]);
    expect(broadcastToCampaign).toHaveBeenCalledWith(campaignId, 'gallery.changed', { campaignId });
    // Saving it again opens nothing new.
    jest.mocked(broadcastToUser).mockClear();
    expect((await change({ shownTo: [ids.a], name: 'The crypt' })).status).toBe(200);
    expect(broadcastToUser).not.toHaveBeenCalled();
    expect((await gallery('a')).body.pictures).toEqual([expect.objectContaining({ id: pictureId, name: 'The crypt' })]);
    expect((await gallery('a')).body.pictures[0]).not.toHaveProperty('folder');
    expect(await opens('a')).toEqual({ file: 200, thumbnail: 200 });

    expect((await gallery('b')).body.pictures).toEqual([]);
    expect(await listed('b')).not.toContain(assetId);
    expect(await opens('b')).toEqual({ file: 404, thumbnail: 404 });
  });

  it('shows a picture to every player, and hides it again', async () => {
    jest.mocked(broadcastToUser).mockClear();
    expect((await change({ shownTo: [], shownToAll: true })).status).toBe(200);
    expect(jest.mocked(broadcastToUser).mock.calls.map((c) => c[0])).toEqual([ids.b]);
    expect(await opens('b')).toEqual({ file: 200, thumbnail: 200 });
    expect((await change({ shownToAll: false })).status).toBe(200);
    for (const who of ['a', 'b'] as const) {
      expect((await gallery(who)).body.pictures).toEqual([]);
      expect(await opens(who)).toEqual({ file: 404, thumbnail: 404 });
    }
  });

  it('refuses to show a picture to someone outside the campaign', async () => {
    const res = await change({ shownTo: [ids.stranger] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/players of this campaign/);
  });

  it('lets only the GM change the gallery', async () => {
    expect((await agents.a.patch(`/api/campaigns/${campaignId}/gallery/${pictureId}`).send({ shownToAll: true })).status).toBe(403);
    expect((await agents.a.post(`/api/campaigns/${campaignId}/gallery`).send({ assetId, name: 'x' })).status).toBe(403);
  });

  it('takes no picture from another campaign', async () => {
    const res = await agents.gm.post(`/api/campaigns/${otherCampaignId}/gallery`).send({ assetId, name: 'x' });
    expect(res.status).toBe(403);
  });

  it('hides the picture again when it leaves the gallery', async () => {
    expect((await change({ shownToAll: true })).status).toBe(200);
    expect((await agents.gm.delete(`/api/campaigns/${campaignId}/gallery/${pictureId}`)).status).toBe(200);
    expect(await opens('a')).toEqual({ file: 404, thumbnail: 404 });
  });
});
