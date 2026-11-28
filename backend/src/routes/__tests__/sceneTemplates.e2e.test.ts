// Added for Mistwarden on 2026-11-28.
/**
 * Scene templates: POST /maps/:id/save-as-template and
 * POST /maps/:id/create-from-template. A template is a map the GM copies
 * scenes from; it is never the current map, so no player is ever sent it,
 * and a campaign archive keeps it a template. Also the campaign setting
 * useCreatureSize, which these share a migration with.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { TEMPLATE_NOT_CURRENT_MESSAGE, NOT_A_TEMPLATE_MESSAGE } from '../maps';

jest.setTimeout(60000);

const app = createTestApp();
let server: WsTestServer;
let gmId: string;
let playerId: string;
let campaignId: string;
let currentMapId: string;
let gm: ReturnType<typeof request.agent>;
let player: ReturnType<typeof request.agent>;
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-templates-'));

async function signIn(email: string) {
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })).status).toBe(200);
  return agent;
}

const mapsUrl = () => `/api/campaigns/${campaignId}/maps`;
const newMap = async (name: string, isTemplate = false) =>
  prisma.map.create({ data: { campaignId, name, imageUrl: '', baseLayerUrl: '', width: 5, height: 5, tokens: [], annotations: [], isTemplate } });

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const gmUser = await createTestUser({ email: `tpl-gm-${stamp}@test.cozyvtt.local`, displayName: 'GM' });
  const playerUser = await createTestUser({ email: `tpl-player-${stamp}@test.cozyvtt.local`, displayName: 'Player' });
  gmId = gmUser.id;
  playerId = playerUser.id;
  campaignId = (await createTestCampaign(gmId, { name: `Templates ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: gmId, campaignId, role: 'GM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  currentMapId = (await newMap('Table')).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId } });
  gm = await signIn(gmUser.email);
  player = await signIn(playerUser.email);
  server = await createWsTestServer();
});

afterAll(async () => {
  await server.close();
  await prisma.campaign.updateMany({ where: { ownerId: { in: [gmId, playerId] } }, data: { currentMapId: null } });
  await prisma.campaign.deleteMany({ where: { ownerId: { in: [gmId, playerId] } } });
  await cleanupUsers([gmId, playerId]);
  await prisma.$disconnect();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

describe('POST /maps/:id/save-as-template', () => {
  it('copies the map as a template under its own name, leaving the source a scene', async () => {
    const source = await newMap(`Crypt ${randomUUID().slice(0, 6)}`);
    const res = await gm.post(`${mapsUrl()}/${source.id}/save-as-template`).send({});
    expect(res.status).toBe(201);
    expect(res.body.map).toMatchObject({ name: source.name, isTemplate: true });
    expect((await prisma.map.findUniqueOrThrow({ where: { id: source.id } })).isTemplate).toBe(false);
  });

  it('adds " (copy)" only when another template has the name', async () => {
    const source = await newMap(`Barrow ${randomUUID().slice(0, 6)}`);
    await gm.post(`${mapsUrl()}/${source.id}/save-as-template`).send({});
    const second = await gm.post(`${mapsUrl()}/${source.id}/save-as-template`).send({});
    expect(second.body.map.name).toBe(`${source.name} (copy)`);
  });

  it('takes the duplicate options, and refuses an unknown one', async () => {
    const source = await newMap(`Keep ${randomUUID().slice(0, 6)}`);
    const named = await gm.post(`${mapsUrl()}/${source.id}/save-as-template`).send({ name: 'Ambush', tokens: false });
    expect(named.status).toBe(201);
    expect(named.body.map).toMatchObject({ name: 'Ambush', isTemplate: true });
    expect((await gm.post(`${mapsUrl()}/${source.id}/save-as-template`).send({ isTemplate: false })).status).toBe(400);
  });

  it('is the GM\'s alone', async () => {
    const source = await newMap('Not yours');
    expect((await player.post(`${mapsUrl()}/${source.id}/save-as-template`).send({})).status).toBe(403);
  });
});

describe('POST /maps/:id/create-from-template', () => {
  it('makes an ordinary scene from a template, named as the template, not made current', async () => {
    const template = await newMap(`Inn ${randomUUID().slice(0, 6)}`, true);
    const res = await gm.post(`${mapsUrl()}/${template.id}/create-from-template`).send({});
    expect(res.status).toBe(201);
    expect(res.body.map).toMatchObject({ name: template.name, isTemplate: false });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).currentMapId).toBe(currentMapId);
    // The scene may be shown; the template stays one.
    expect((await gm.put(`${mapsUrl()}/${res.body.map.id}/set-current`)).status).toBe(200);
    expect((await prisma.map.findUniqueOrThrow({ where: { id: template.id } })).isTemplate).toBe(true);
    await gm.put(`${mapsUrl()}/${currentMapId}/set-current`);
  });

  it('refuses a map that is not a template with 409', async () => {
    const scene = await newMap('Plain scene');
    const res = await gm.post(`${mapsUrl()}/${scene.id}/create-from-template`).send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(NOT_A_TEMPLATE_MESSAGE);
  });
});

describe('a template', () => {
  let templateId: string;
  beforeAll(async () => {
    templateId = (await newMap('Secret template', true)).id;
  });

  it('cannot be made the current map: 409, and the table stays where it was', async () => {
    const res = await gm.put(`${mapsUrl()}/${templateId}/set-current`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(TEMPLATE_NOT_CURRENT_MESSAGE);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).currentMapId).toBe(currentMapId);
  });

  it('is listed for the GM with isTemplate, and never for a player', async () => {
    const gmList = (await gm.get(mapsUrl())).body.maps as Array<{ id: string; isTemplate: boolean }>;
    expect(gmList.find((m) => m.id === templateId)?.isTemplate).toBe(true);
    expect(gmList.find((m) => m.id === currentMapId)?.isTemplate).toBe(false);

    const playerList = (await player.get(mapsUrl())).body.maps as Array<{ id: string }>;
    expect(playerList.map((m) => m.id)).toEqual([currentMapId]);
    expect((await player.get(`${mapsUrl()}/${templateId}`)).status).toBe(404);
    const campaign = (await player.get(`/api/campaigns/${campaignId}`)).body.campaign;
    expect(campaign.maps.map((m: { id: string }) => m.id)).toEqual([currentMapId]);
  });

  it('copied with /duplicate is a template again', async () => {
    const res = await gm.post(`${mapsUrl()}/${templateId}/duplicate`).send({});
    expect(res.status).toBe(201);
    expect(res.body.map).toMatchObject({ name: 'Secret template (copy)', isTemplate: true });
  });

  it('cannot be made a template or a scene by PUT /maps/:id', async () => {
    const res = await gm.put(`${mapsUrl()}/${templateId}`).send({ isTemplate: false, name: 'Renamed template' });
    expect(res.status).toBe(200);
    expect(await prisma.map.findUniqueOrThrow({ where: { id: templateId } })).toMatchObject({ name: 'Renamed template', isTemplate: true });
  });
});

describe('a campaign archive', () => {
  it('keeps templates as templates and the creature size setting, and opens on the first scene, never on a template', async () => {
    const source = await createTestCampaign(gmId, { name: 'Archive with templates' });
    await prisma.campaignMembership.create({ data: { userId: gmId, campaignId: source.id, role: 'GM', characterIds: [] } });
    await prisma.campaign.update({ where: { id: source.id }, data: { useCreatureSize: true } });
    const at = Date.now();
    // The template is the oldest map, which the archive lists first.
    await prisma.map.create({ data: { campaignId: source.id, name: 'Old template', imageUrl: '', baseLayerUrl: '', width: 5, height: 5, tokens: [], annotations: [], isTemplate: true, createdAt: new Date(at - 2000) } });
    await prisma.map.create({ data: { campaignId: source.id, name: 'Scene', imageUrl: '', baseLayerUrl: '', width: 5, height: 5, tokens: [], annotations: [], createdAt: new Date(at - 1000) } });

    const res = await gm.get(`/api/campaigns/${source.id}/export`).buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    const file = path.join(SCRATCH, 'templates.cozyvtt');
    fs.writeFileSync(file, res.body as Buffer);

    const imported = await gm.post('/api/campaigns/import').field('campaignName', 'Imported templates').attach('file', file);
    expect(imported.status).toBe(201);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: imported.body.campaignId }, include: { maps: true } });
    const byName = Object.fromEntries(campaign.maps.map((m) => [m.name, m]));
    expect(byName['Old template'].isTemplate).toBe(true);
    expect(byName['Scene'].isTemplate).toBe(false);
    expect(campaign.currentMapId).toBe(byName['Scene'].id);
    expect(campaign.useCreatureSize).toBe(true);
  });
});

describe('the campaign setting useCreatureSize', () => {
  it('is off for a new campaign', async () => {
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).useCreatureSize).toBe(false);
  });

  it('is set by the GM with PUT /campaigns/:id, and refused when not a boolean', async () => {
    expect((await gm.put(`/api/campaigns/${campaignId}`).send({ useCreatureSize: 'yes' })).status).toBe(400);
    const res = await gm.put(`/api/campaigns/${campaignId}`).send({ useCreatureSize: true });
    expect(res.status).toBe(200);
    expect(res.body.campaign.useCreatureSize).toBe(true);
    expect((await player.put(`/api/campaigns/${campaignId}`).send({ useCreatureSize: false })).status).toBe(403);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).useCreatureSize).toBe(true);
  });
});
