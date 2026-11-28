// Added for Mistwarden on 2026-11-28.
/**
 * POST /api/campaigns/:campaignId/maps/:id/duplicate: the GM copies a map
 * within the campaign, to prepare a scene from one they have. The copy holds
 * everything the map holds, its tokens under new ids with every rider still
 * on its own mount, and nothing of what players explored on it or the fight
 * on it. Nobody is told of the copy: it is a prepared map, the GM's alone.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Map as MapRow } from '@prisma/client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson } from '../../utils/prisma-json';
import { MAP_LIMITS } from '../../validators/mapLimits';

jest.setTimeout(30000);

const app = createTestApp();
let server: WsTestServer;
let gmId: string;
let playerId: string;
let otherGmId: string;
let campaignId: string;
let otherCampaignId: string;
let currentMapId: string;
let gm: ReturnType<typeof request.agent>;
let player: ReturnType<typeof request.agent>;
let otherGm: ReturnType<typeof request.agent>;

const MOUNT = 'aaaaaaaa-0000-4000-8000-000000000001';
const RIDER = 'aaaaaaaa-0000-4000-8000-000000000002';
const STRAY = 'aaaaaaaa-0000-4000-8000-000000000003';
const GUARD = 'aaaaaaaa-0000-4000-8000-000000000004';
const GONE = 'aaaaaaaa-0000-4000-8000-0000000000ff';

const base = { imageUrl: '', size: { width: 1, height: 1 }, layer: 'token', rotation: 0, conditions: [] as string[], metadata: {} };

function tokens(controller: string) {
  return [
    { ...base, id: MOUNT, name: 'Horse', position: { x: 2, y: 2 }, visible: true, controlledBy: controller, initiative: 12 },
    { ...base, id: RIDER, name: 'Knight', position: { x: 2, y: 2 }, visible: true, controlledBy: controller, mountedOn: MOUNT, sightRadius: 12 },
    // Names a mount no longer on the map.
    { ...base, id: STRAY, name: 'Squire', position: { x: 4, y: 4 }, visible: true, controlledBy: null, mountedOn: GONE },
    {
      ...base, id: GUARD, name: 'Hidden guard', position: { x: 6, y: 1 }, visible: false, controlledBy: null, rotation: 90,
      conditions: ['prone'], hp: { current: 7, max: 11, temp: 2 }, showHpBar: true, statBlock: { hpMax: 11, ac: 16 },
      light: { brightRadius: 4, dimRadius: 8, color: '#ffcc66', enabled: true }, nameHidden: true, obscured: true, icon: 'humanoid',
      type: 'npc', disposition: 'hostile', notes: 'Bribable', creatureTemplateId: null, initiative: 17,
    },
  ];
}

async function signIn(email: string) {
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email, password: TEST_PASSWORD })).status).toBe(200);
  return agent;
}

/** A map with something of everything a map holds. */
async function makeSource(name = `Crypt ${randomUUID().slice(0, 6)}`): Promise<MapRow> {
  const map = await prisma.map.create({
    data: {
      campaignId, name, imageUrl: '/api/assets/maps/crypt', baseLayerUrl: '/api/assets/maps/crypt', spiritLayerUrl: '/api/assets/maps/crypt-spirit',
      width: 10, height: 8, gridSize: 70.5, gridType: 'square', gridOffsetX: 3.5, gridOffsetY: -2, feetPerSquare: 10, diagonalRule: 'alternating',
      snapTokens: false, drawnBackground: '#223344', gridColor: '#ffffff', gridOpacity: 0.8, gridLineWidth: 3,
      tokens: toJson(tokens(playerId)), annotations: [],
      wallSegments: toJson([{ id: 'w1', x1: 0, y1: 0, x2: 70, y2: 0, type: 'door-locked' }, { id: 'w2', x1: 0, y1: 0, x2: 0, y2: 70, type: 'wall' }]),
      lights: toJson([{ id: 'l1', x: 35, y: 35, brightRadius: 2, dimRadius: 4, color: '#ffcc66', enabled: false }]),
      fogData: toJson({ fogCols: 10, fogRows: 8, cellPx: 70.5, revealed: Array.from({ length: 80 }, (_, i) => i < 5) }),
      lightingEnabled: true, fogEnabled: true, globalIllumination: false, explorationEnabled: true,
    },
  });
  await prisma.mapDrawing.create({ data: { mapId: map.id, authorId: playerId, audience: 'ALL', kind: 'pen', color: '#ff0000', width: 3, points: [[1, 1], [5, 5]], sortKey: 2, createdAt: new Date('2026-11-01T10:00:00Z') } });
  await prisma.mapDrawing.create({ data: { mapId: map.id, authorId: gmId, audience: 'GM', layer: 'MARKUP', kind: 'text', color: '#000000', width: 1, points: [[9, 9]], text: 'Trap here', createdAt: new Date('2026-11-02T10:00:00Z') } });
  await prisma.mapArea.create({ data: { mapId: map.id, authorId: gmId, audience: 'GM', shape: 'cone', anchorX: 100, anchorY: 120, angle: 1.5, sizeFt: 30, element: 'fire', label: 'Breath', animated: false } });
  await prisma.mapExploration.create({ data: { mapId: map.id, userId: playerId, explored: { fogCols: 10, fogRows: 8, cellPx: 70.5, revealed: Array.from({ length: 80 }, () => true) } } });
  return map;
}

const duplicate = (agent: ReturnType<typeof request.agent>, mapId: string, body: object = {}, campaign = campaignId) =>
  agent.post(`/api/campaigns/${campaign}/maps/${mapId}/duplicate`).send(body);

const storedTokens = async (mapId: string) =>
  (await prisma.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } })).tokens as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  const stamp = randomUUID().slice(0, 8);
  const gmUser = await createTestUser({ email: `dup-gm-${stamp}@test.cozyvtt.local`, displayName: 'GM' });
  const playerUser = await createTestUser({ email: `dup-player-${stamp}@test.cozyvtt.local`, displayName: 'Player' });
  const otherUser = await createTestUser({ email: `dup-other-${stamp}@test.cozyvtt.local`, displayName: 'Other GM' });
  gmId = gmUser.id;
  playerId = playerUser.id;
  otherGmId = otherUser.id;
  campaignId = (await createTestCampaign(gmId, { name: `Duplicate ${stamp}` })).id;
  otherCampaignId = (await createTestCampaign(otherGmId, { name: `Elsewhere ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: gmId, campaignId, role: 'GM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: otherGmId, campaignId: otherCampaignId, role: 'GM', characterIds: [] },
    ],
  });
  currentMapId = (await prisma.map.create({ data: { campaignId, name: 'Table', imageUrl: '', baseLayerUrl: '', width: 5, height: 5, tokens: [], annotations: [] } })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId } });
  gm = await signIn(gmUser.email);
  player = await signIn(playerUser.email);
  otherGm = await signIn(otherUser.email);
  server = await createWsTestServer();
});

afterAll(async () => {
  await server.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await cleanupCampaigns([campaignId, otherCampaignId]);
  await cleanupUsers([gmId, playerId, otherGmId]);
  await prisma.$disconnect();
});

describe('a copy with everything', () => {
  let source: MapRow;
  let copy: MapRow;

  beforeAll(async () => {
    source = await makeSource();
    const res = await duplicate(gm, source.id);
    expect(res.status).toBe(201);
    copy = await prisma.map.findUniqueOrThrow({ where: { id: res.body.map.id } });
    expect(res.body.map.id).toBe(copy.id);
  });

  it('is a new map, named as a copy, and not the one on the table', async () => {
    expect(copy.id).not.toBe(source.id);
    expect(copy.campaignId).toBe(campaignId);
    expect(copy.name).toBe(`${source.name} (copy)`);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).currentMapId).toBe(currentMapId);
  });

  it('holds every column of the source but its id, name, times and tokens', () => {
    const rest = (m: MapRow) => {
      const { id: _id, name: _name, createdAt: _c, updatedAt: _u, tokens: _t, ...others } = m;
      return others;
    };
    expect(rest(copy)).toEqual(rest(source));
  });

  it('gives every token a new id, keeping everything else, and each rider on its own mount', async () => {
    const before = await storedTokens(source.id);
    const after = await storedTokens(copy.id);
    expect(after).toHaveLength(before.length);
    const oldIds = new Set(before.map((t) => t.id));
    expect(after.every((t) => !oldIds.has(t.id as string))).toBe(true);
    expect(new Set(after.map((t) => t.id)).size).toBe(after.length);

    const [mount, rider, stray, guard] = after;
    expect(rider.mountedOn).toBe(mount.id);
    // Its mount was not on the map, so it rides nothing.
    expect(stray.mountedOn).toBeNull();
    // The fight stays on the source map.
    expect(mount.initiative).toBeNull();
    expect(guard.initiative).toBeNull();
    // Everything else as it was, the carried light, hit points and what players are kept from included.
    const { id: _a, initiative: _b, ...guardBefore } = before[3];
    const { id: _c, initiative: _d, ...guardAfter } = guard;
    expect(guardAfter).toEqual(guardBefore);
    expect(rider).toMatchObject({ name: 'Knight', controlledBy: playerId, sightRadius: 12 });
  });

  it('copies the drawings and spell areas with their authors, audiences and times', async () => {
    const pick = <T extends { id: string; mapId: string }>({ id: _id, mapId: _mapId, ...rest }: T) => rest;
    const order = [{ createdAt: 'asc' as const }];
    const drawings = await prisma.mapDrawing.findMany({ where: { mapId: copy.id }, orderBy: order });
    expect(drawings.map(pick)).toEqual((await prisma.mapDrawing.findMany({ where: { mapId: source.id }, orderBy: order })).map(pick));
    expect(drawings).toHaveLength(2);
    const areas = await prisma.mapArea.findMany({ where: { mapId: copy.id } });
    expect(areas.map(pick)).toEqual((await prisma.mapArea.findMany({ where: { mapId: source.id } })).map(pick));
    expect(areas).toHaveLength(1);
  });

  it('remembers nothing players explored on the source', async () => {
    expect(await prisma.mapExploration.count({ where: { mapId: copy.id } })).toBe(0);
    expect(await prisma.mapExploration.count({ where: { mapId: source.id } })).toBe(1);
  });

  it('leaves the source as it was', async () => {
    expect(await storedTokens(source.id)).toEqual(tokens(playerId));
  });

  it('names the next copy "(copy 2)"', async () => {
    const res = await duplicate(gm, source.id);
    expect(res.status).toBe(201);
    expect(res.body.map.name).toBe(`${source.name} (copy 2)`);
  });
});

describe('what the copy leaves out when asked', () => {
  it('takes no tokens, fog or drawings, keeping the areas and the fog setting', async () => {
    const source = await makeSource();
    const res = await duplicate(gm, source.id, { tokens: false, fog: false, drawings: false, name: '  Crypt, empty  ' });
    expect(res.status).toBe(201);
    const copy = await prisma.map.findUniqueOrThrow({ where: { id: res.body.map.id } });
    expect(copy.name).toBe('Crypt, empty');
    expect(copy.tokens).toEqual([]);
    expect(copy.fogData).toBeNull();
    expect(copy.fogEnabled).toBe(true);
    expect(copy.wallSegments).toEqual(source.wallSegments);
    expect(await prisma.mapDrawing.count({ where: { mapId: copy.id } })).toBe(0);
    expect(await prisma.mapArea.count({ where: { mapId: copy.id } })).toBe(1);
  });

  it('keeps a copy of a long name within the limit', async () => {
    const source = await makeSource('x'.repeat(MAP_LIMITS.maxNameLength));
    const res = await duplicate(gm, source.id, { tokens: false });
    expect(res.status).toBe(201);
    expect(res.body.map.name).toHaveLength(MAP_LIMITS.maxNameLength);
    expect(res.body.map.name.endsWith(' (copy)')).toBe(true);
  });
});

describe('refusals', () => {
  it('refuses a player, and the GM of another campaign', async () => {
    const source = await makeSource();
    expect((await duplicate(player, source.id)).status).toBe(403);
    // Through their own campaign the map is not there.
    expect((await duplicate(otherGm, source.id, {}, otherCampaignId)).status).toBe(404);
    expect((await duplicate(gm, randomUUID())).status).toBe(404);
    expect(await prisma.map.count({ where: { name: { startsWith: `${source.name} (copy` } } })).toBe(0);
  });

  it.each([
    [{ tokens: 'no' }, 'tokens'],
    [{ fog: 1 }, 'fog'],
    [{ name: '' }, 'name'],
    [{ name: 'y'.repeat(MAP_LIMITS.maxNameLength + 1) }, 'at most'],
    [{ current: true }, 'current'],
  ])('refuses %p', async (body, says) => {
    const source = await makeSource();
    const res = await duplicate(gm, source.id, body);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(says);
  });

  it('does not copy a map holding more tokens than a map may', async () => {
    const source = await makeSource();
    const many = Array.from({ length: MAP_LIMITS.maxTokens + 1 }, (_, i) => ({ ...base, id: randomUUID(), name: `Rat ${i}`, position: { x: 0, y: 0 }, visible: true, controlledBy: null }));
    await prisma.map.update({ where: { id: source.id }, data: { tokens: toJson(many) } });
    const res = await duplicate(gm, source.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Limit Exceeded');
    // Without its tokens it is within the limits.
    expect((await duplicate(gm, source.id, { tokens: false })).status).toBe(201);
  });
});

describe('who is told', () => {
  it('tells no player anything', async () => {
    const source = await makeSource();
    const client = await server.connectAndAuth(await server.loginAs(playerId), campaignId);
    const heard: string[] = [];
    client.onAny((event: string) => heard.push(event));
    expect((await duplicate(gm, source.id)).status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(heard).toEqual([]);
    client.disconnect();
  });
});
