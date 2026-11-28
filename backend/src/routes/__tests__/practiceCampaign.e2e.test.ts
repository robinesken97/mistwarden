/**
 * The practice campaign: one per user, made through the checks every other
 * way in goes through, reset only when it is one, by its GM alone, keeping
 * its members and their characters. Campaign.isPractice is the server's
 * alone: no create, update or import sets it.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'mistwarden-practice-'));
process.env.UPLOAD_DIR = path.join(SCRATCH, 'uploads');

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { writeZip } from '../../__tests__/helpers/zipFixtures';
import { validateTokenShapes } from '../../validators/tokens';
import { WallSegmentsArraySchema, LightSourcesArraySchema } from '../../validators/walls';
import { ImportFogSchema, CampaignSettingsSchema } from '../../validators/campaignImport';
import { validateCharacterData } from '../../validators/game-systems';
import { getState, setState } from '../../websocket/initiativeState';
import { PRACTICE_CHARACTER_NAME, PRACTICE_NOTE_TITLE } from '../../services/practiceCampaign';

jest.setTimeout(60000);

const app = createTestApp();
const userIds: string[] = [];

async function signIn(displayName: string) {
  const user = await createTestUser({ displayName });
  userIds.push(user.id);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  return { id: user.id, agent };
}

afterAll(async () => {
  await prisma.campaign.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.asset.deleteMany({ where: { uploadedById: { in: userIds } } });
  await cleanupUsers(userIds);
  await prisma.$disconnect();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

const contentOf = (campaignId: string) =>
  prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { maps: { include: { areas: true } }, galleryPictures: true, personalNotes: true, characters: true, memberships: true, assets: true },
  });

describe('POST /api/campaigns/practice', () => {
  it('makes one practice campaign per user and opens it again after', async () => {
    const gm = await signIn('Practice Once');
    const first = await gm.agent.post('/api/campaigns/practice');
    expect(first.status).toBe(201);
    expect(first.body.campaign).toMatchObject({ isPractice: true, ownerId: gm.id, gameSystem: 'FIFTH_EDITION' });

    const again = await gm.agent.post('/api/campaigns/practice');
    expect(again.status).toBe(200);
    expect(again.body.campaign.id).toBe(first.body.campaign.id);
    expect(await prisma.campaign.count({ where: { ownerId: gm.id, isPractice: true } })).toBe(1);
  });

  it('makes only one when two requests arrive at once', async () => {
    const gm = await signIn('Practice Twice');
    const [a, b] = await Promise.all([gm.agent.post('/api/campaigns/practice'), gm.agent.post('/api/campaigns/practice')]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.campaign.id).toBe(b.body.campaign.id);
    expect(await prisma.campaign.count({ where: { ownerId: gm.id, isPractice: true } })).toBe(1);
    // The loser's pictures were removed again: only the winner's are on disk.
    const assets = await prisma.asset.findMany({ where: { uploadedById: gm.id } });
    expect(assets).toHaveLength(2);
    const folder = path.dirname(path.resolve(assets[0].filePath));
    expect(fs.readdirSync(folder).sort()).toEqual(assets.flatMap((x) => [x.filename, `thumb_${x.filename}`]).sort());
  });

  it('refuses a caller who is not signed in', async () => {
    expect((await request(app).post('/api/campaigns/practice')).status).toBe(401);
  });

  it('stores content that passes every check the routes apply', async () => {
    const gm = await signIn('Practice Content');
    const res = await gm.agent.post('/api/campaigns/practice');
    const campaign = await contentOf(res.body.campaign.id);

    expect(campaign.maps).toHaveLength(1);
    const map = campaign.maps[0];
    expect(campaign.currentMapId).toBe(map.id);
    expect(map).toMatchObject({ width: 24, height: 18, gridSize: 70, fogEnabled: true, lightingEnabled: true });
    // The grid as every map from before its look was the map's: black, 0.4, 2 px.
    expect(map).toMatchObject({ gridColor: '#000000', gridOpacity: 0.4, gridLineWidth: 2, isTemplate: false });
    expect(map.imageUrl).toMatch(/^\/api\/assets\/maps\//);

    const tokens = map.tokens as Array<Record<string, unknown>>;
    for (const token of tokens) expect(validateTokenShapes(token)).toMatchObject({ ok: true });
    const by = (disposition: string) => tokens.filter((t) => t.disposition === disposition);
    expect(by('friendly')).toHaveLength(2);
    expect(by('friendly').every((t) => t.controlledBy === null)).toBe(true);
    expect(by('hostile').map((t) => t.icon).sort()).toEqual(['beast', 'undead']);
    expect(by('neutral')).toHaveLength(1);
    // In the cellar, row 13 from the top: a stored position counts rows from the bottom.
    expect(tokens.find((t) => t.name === 'Skeleton')?.position).toEqual({ x: 20, y: 4 });

    const walls = WallSegmentsArraySchema.parse(map.wallSegments);
    expect(walls.filter((w) => w.type.startsWith('door')).map((w) => w.type).sort()).toEqual(['door-closed', 'door-open']);
    expect(LightSourcesArraySchema.parse(map.lights)).toHaveLength(1);
    const fog = ImportFogSchema.parse(map.fogData);
    expect(fog).toMatchObject({ fogCols: 24, fogRows: 18, cellPx: 70 });
    // The courtyard is revealed, the cellar (lower right) is not.
    expect(fog.revealed[10 * 24 + 5]).toBe(true);
    expect(fog.revealed[13 * 24 + 20]).toBe(false);

    // Both pictures are stored files of the campaign, one shown on the map, one in the gallery.
    expect(campaign.assets).toHaveLength(2);
    for (const asset of campaign.assets) expect(fs.existsSync(path.resolve(asset.filePath))).toBe(true);
    expect(map.imageUrl).toBe(`/api/assets/maps/${campaign.assets.find((a) => a.originalName === 'courtyard.png')!.id}`);
    expect(campaign.galleryPictures).toEqual([expect.objectContaining({ name: 'Practice notice', folder: 'Handouts', shownToAll: false })]);
    expect(campaign.personalNotes).toEqual([expect.objectContaining({ userId: gm.id, title: PRACTICE_NOTE_TITLE })]);

    expect(campaign.characters).toHaveLength(1);
    const hero = campaign.characters[0];
    expect(hero).toMatchObject({ name: PRACTICE_CHARACTER_NAME, userId: gm.id, gameSystem: 'FIFTH_EDITION' });
    expect(validateCharacterData('FIFTH_EDITION', hero.data)).toMatchObject({ success: true });
    expect(hero.data).toMatchObject({ darkvisionFeet: 60 });
    expect(campaign.memberships).toEqual([expect.objectContaining({ userId: gm.id, role: 'GM', characterIds: [hero.id] })]);

    // And the routes read it back as any campaign.
    expect((await gm.agent.get(`/api/campaigns/${campaign.id}`)).body.campaign.isPractice).toBe(true);
    expect((await gm.agent.get(`/api/campaigns/${campaign.id}/maps/${map.id}`)).status).toBe(200);
    expect((await gm.agent.get(map.imageUrl)).status).toBe(200);
  });
});

describe('POST /api/campaigns/:campaignId/practice/reset', () => {
  it('puts the content back, keeping members and their characters', async () => {
    const gm = await signIn('Practice Reset GM');
    const player = await signIn('Practice Reset Player');
    const campaignId = (await gm.agent.post('/api/campaigns/practice')).body.campaign.id as string;
    const before = await contentOf(campaignId);

    // A player with a character of their own, a spell area, a note of theirs, a second map, an initiative order.
    await prisma.campaignMembership.create({ data: { userId: player.id, campaignId, role: 'PLAYER', characterIds: [] } });
    // Named as the sample character, which the reset must leave alone: it is the player's.
    const own = await prisma.character.create({ data: { userId: player.id, campaignId, name: PRACTICE_CHARACTER_NAME, data: { mine: true }, gameSystem: 'FIFTH_EDITION' } });
    await prisma.campaignMembership.update({ where: { userId_campaignId: { userId: player.id, campaignId } }, data: { characterIds: [own.id] } });
    await prisma.mapArea.create({ data: { mapId: before.maps[0].id, shape: 'circle', anchorX: 100, anchorY: 100, sizeFt: 20 } });
    await prisma.map.update({ where: { id: before.maps[0].id }, data: { gridColor: '#ffffff', gridOpacity: 1, gridLineWidth: 3 } });
    await prisma.personalNote.create({ data: { userId: player.id, campaignId, title: 'Mine', content: '' } });
    await prisma.map.create({ data: { campaignId, name: 'Extra', imageUrl: '', baseLayerUrl: '', width: 5, height: 5, tokens: [], annotations: [] } });
    await prisma.character.update({ where: { id: before.characters[0].id }, data: { data: { characterName: 'Changed' } } });
    setState(campaignId, { active: true, round: 3, currentTokenId: null, combatants: [] });

    const res = await gm.agent.post(`/api/campaigns/${campaignId}/practice/reset`);
    expect(res.status).toBe(200);

    const after = await contentOf(campaignId);
    expect(after.maps).toHaveLength(1);
    expect(after.maps[0].id).toBe(res.body.mapId);
    expect(after.currentMapId).toBe(res.body.mapId);
    expect(after.maps[0].areas).toEqual([]);
    expect(after.maps[0]).toMatchObject({ gridColor: '#000000', gridOpacity: 0.4, gridLineWidth: 2 });
    expect(after.personalNotes.map((n) => n.title)).toEqual([PRACTICE_NOTE_TITLE]);
    expect(after.galleryPictures).toHaveLength(1);
    expect(getState(campaignId)).toMatchObject({ active: false, combatants: [] });
    expect(after.rollHistoryClearedAt).not.toBeNull();

    // Members and their characters stay; the sample character is put back, not made twice.
    expect(after.memberships.map((m) => m.userId).sort()).toEqual([gm.id, player.id].sort());
    expect(after.characters.map((c) => c.id).sort()).toEqual([before.characters[0].id, own.id].sort());
    expect(after.characters.find((c) => c.id === own.id)!.data).toEqual({ mine: true });
    expect(after.characters.find((c) => c.id === before.characters[0].id)!.data).toMatchObject({ darkvisionFeet: 60 });
    // The pictures are used again, not stored anew.
    expect(after.assets.map((a) => a.id).sort()).toEqual(before.assets.map((a) => a.id).sort());
  });

  it('refuses a campaign that is not a practice campaign and changes nothing', async () => {
    const gm = await signIn('Normal GM');
    const campaign = await createTestCampaign(gm.id);
    await prisma.campaignMembership.create({ data: { userId: gm.id, campaignId: campaign.id, role: 'GM', characterIds: [] } });
    await prisma.map.create({ data: { campaignId: campaign.id, name: 'Kept', imageUrl: '', baseLayerUrl: '', width: 5, height: 5, tokens: [], annotations: [] } });
    await prisma.personalNote.create({ data: { userId: gm.id, campaignId: campaign.id, title: 'Kept', content: '' } });
    const before = await contentOf(campaign.id);

    const res = await gm.agent.post(`/api/campaigns/${campaign.id}/practice/reset`);
    expect(res.status).toBe(409);
    expect(await contentOf(campaign.id)).toEqual(before);
  });

  it('refuses a player of the practice campaign', async () => {
    const gm = await signIn('Practice Guard GM');
    const player = await signIn('Practice Guard Player');
    const campaignId = (await gm.agent.post('/api/campaigns/practice')).body.campaign.id as string;
    await prisma.campaignMembership.create({ data: { userId: player.id, campaignId, role: 'PLAYER', characterIds: [] } });
    const before = await contentOf(campaignId);

    expect((await player.agent.post(`/api/campaigns/${campaignId}/practice/reset`)).status).toBe(403);
    expect(await contentOf(campaignId)).toEqual(before);
  });
});

describe('Campaign.isPractice is set by the server alone', () => {
  it('is not taken from a campaign create or update', async () => {
    const gm = await signIn('Practice Flag');
    const created = await gm.agent.post('/api/campaigns').send({ name: 'Not practice', isPractice: true });
    expect(created.status).toBe(201);
    expect(created.body.campaign.isPractice).toBe(false);
    const updated = await gm.agent.put(`/api/campaigns/${created.body.campaign.id}`).send({ name: 'Still not', isPractice: true });
    expect(updated.status).toBe(200);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: created.body.campaign.id } })).isPractice).toBe(false);
  });

  it('is left out of an imported campaign, whatever the archive says', async () => {
    expect(CampaignSettingsSchema.parse({ name: 'Archived', isPractice: true })).not.toHaveProperty('isPractice');

    const gm = await signIn('Practice Import');
    const file = path.join(SCRATCH, 'practice-flag.cozyvtt');
    await writeZip(file, [
      {
        name: 'manifest.json',
        data: JSON.stringify({
          formatVersion: 1, exportedAt: '2026-11-28T00:00:00.000Z', exportedFrom: 'Mistwarden test', campaignName: 'Archived',
          gameSystem: 'FIFTH_EDITION', mapCount: 0, tokenCount: 0, creatureCount: 0, tokenTemplateCount: 0, assetCount: 0,
          includesAudio: false, totalSizeBytes: 0,
        }),
      },
      { name: 'campaign.json', data: JSON.stringify({ name: 'Archived', isPractice: true }) },
    ]);
    const res = await gm.agent.post('/api/campaigns/import').attach('file', file);
    expect(res.status).toBe(201);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: res.body.campaignId } })).isPractice).toBe(false);
    // Nor does it count as the user's practice campaign.
    expect((await gm.agent.post('/api/campaigns/practice')).status).toBe(201);
  });
});
