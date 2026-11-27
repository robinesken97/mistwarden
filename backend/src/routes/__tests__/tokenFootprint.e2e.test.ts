/**
 * A token stands where the map lets its mover put it, with its whole
 * footprint on the map.
 *
 * The routes checked only that a token's corner square was on the map, and
 * took a fractional square, so a script could store positions the client
 * never produces. On a map whose tokens snap (the default) a player's
 * fraction is refused and only the GM may place between squares; on one
 * whose tokens do not, anyone may, to hundredths; a hex map takes whole
 * hexes only. A footprint that would hang off the far edge is pulled back
 * onto the map, the rule the client applies when it offers a move
 * (clampTokenPosition). Placing a large creature at the centre of a small
 * map lands it on the map.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { readTokens, toJson } from '../../utils/prisma-json';

const app = createTestApp();
let gmId: string;
let playerId: string;
let campaignId: string;
let gm: ReturnType<typeof request.agent>;
let player: ReturnType<typeof request.agent>;

const token = (over: Record<string, unknown>) => ({
  id: randomUUID(), name: 'Ogre', imageUrl: '', position: { x: 1, y: 1 }, size: { width: 2, height: 2 },
  layer: 'token', visible: true, controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...over,
});

async function newMap(tokens: unknown[] = [], extra: { snapTokens?: boolean; gridType?: string } = {}): Promise<string> {
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Footprint', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: 10, height: 10, gridSize: 50, tokens: toJson(tokens), annotations: [], ...extra,
    },
  });
  // A player reads only the map the table is on.
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });
  return map.id;
}
const storedTokens = async (mapId: string) =>
  readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } })).tokens);
const tokens = (mapId: string) => `/api/campaigns/${campaignId}/maps/${mapId}/tokens`;

beforeAll(async () => {
  const stamp = Date.now();
  const user = await createTestUser({ email: `footprint-${stamp}@test.cozyvtt.local` });
  gmId = user.id;
  campaignId = (await createTestCampaign(gmId, { name: `Footprint ${stamp}` })).id;
  const playerUser = await createTestUser({ email: `footprint-player-${stamp}@test.cozyvtt.local` });
  playerId = playerUser.id;
  await prisma.campaignMembership.create({ data: { userId: gmId, campaignId, role: 'GM', characterIds: [] } });
  await prisma.campaignMembership.create({ data: { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });
  gm = request.agent(app);
  expect((await gm.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  player = request.agent(app);
  expect((await player.post('/api/auth/login').send({ email: playerUser.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([gmId, playerId]);
  await prisma.$disconnect();
});

describe('POST /tokens', () => {
  it('refuses a position between hexes', async () => {
    const mapId = await newMap([], { gridType: 'hexPointy' });

    const res = await gm.post(tokens(mapId)).send({ name: 'Ogre', position: { x: 5.5, y: 3 } });

    expect(res.status).toBe(400);
    expect(await storedTokens(mapId)).toEqual([]);
  });

  it('takes the GM\'s position between squares, to hundredths', async () => {
    const mapId = await newMap();

    const res = await gm.post(tokens(mapId)).send({ name: 'Ogre', position: { x: 5.555, y: 3.1 } });

    expect(res.status).toBe(201);
    expect((await storedTokens(mapId))[0].position).toEqual({ x: 5.56, y: 3.1 });
  });

  it('pulls a footprint that would hang off the far edge back onto the map', async () => {
    const mapId = await newMap();

    const res = await gm.post(tokens(mapId)).send({ name: 'Giant', position: { x: 8, y: 9 }, size: { width: 4, height: 4 } });

    expect(res.status).toBe(201);
    expect(res.body.token.position).toEqual({ x: 6, y: 6 });
    expect((await storedTokens(mapId))[0].position).toEqual({ x: 6, y: 6 });
  });

  it('puts a token larger than the map at its corner', async () => {
    const mapId = await newMap();

    const res = await gm.post(tokens(mapId)).send({ name: 'Colossus', position: { x: 5, y: 5 }, size: { width: 10, height: 10 } });

    expect(res.body.token.position).toEqual({ x: 0, y: 0 });
  });

  it('still refuses a corner off the map', async () => {
    const mapId = await newMap();

    expect((await gm.post(tokens(mapId)).send({ name: 'Ogre', position: { x: 10, y: 0 } })).status).toBe(400);
  });
});

describe('PUT /tokens/:tokenId', () => {
  it('refuses a player\'s position between squares on a map whose tokens snap, and leaves the token where it was', async () => {
    const ogre = token({ controlledBy: playerId });
    const mapId = await newMap([ogre]);

    const res = await player.put(`${tokens(mapId)}/${ogre.id}`).send({ position: { x: 2.5, y: 1 } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/whole number of squares/);
    expect((await storedTokens(mapId))[0].position).toEqual({ x: 1, y: 1 });
  });

  it('takes the GM\'s position between squares on a map whose tokens snap', async () => {
    const ogre = token({});
    const mapId = await newMap([ogre]);

    const res = await gm.put(`${tokens(mapId)}/${ogre.id}`).send({ position: { x: 2.5, y: 1.25 } });

    expect(res.status).toBe(200);
    expect((await storedTokens(mapId))[0].position).toEqual({ x: 2.5, y: 1.25 });
  });

  it('takes a player\'s position between squares on a map whose tokens do not snap, to hundredths', async () => {
    const ogre = token({ controlledBy: playerId });
    const mapId = await newMap([ogre], { snapTokens: false });

    const res = await player.put(`${tokens(mapId)}/${ogre.id}`).send({ position: { x: 2.333, y: 1.666 } });

    expect(res.status).toBe(200);
    expect((await storedTokens(mapId))[0].position).toEqual({ x: 2.33, y: 1.67 });
  });

  it('keeps a rider on its mount when the mount moves between squares', async () => {
    const horse = token({ name: 'Horse', position: { x: 1.1, y: 1 }, size: { width: 2, height: 2 } });
    const rider = token({ name: 'Rider', position: { x: 1.1, y: 1 }, size: { width: 1, height: 1 }, mountedOn: horse.id });
    const mapId = await newMap([horse, rider], { snapTokens: false });

    await gm.put(`${tokens(mapId)}/${horse.id}`).send({ position: { x: 1.3, y: 1.2 } });

    const [h, r] = await storedTokens(mapId);
    expect(h.position).toEqual({ x: 1.3, y: 1.2 });
    expect(r.position).toEqual(h.position);
  });

  it('pulls a move that would hang off the edge back onto the map, by the token\'s size', async () => {
    const ogre = token({});
    const mapId = await newMap([ogre]);

    const res = await gm.put(`${tokens(mapId)}/${ogre.id}`).send({ position: { x: 9, y: 0 } });

    expect(res.status).toBe(200);
    expect((await storedTokens(mapId))[0].position).toEqual({ x: 8, y: 0 });
  });

  it('uses the new size when the same request changes it', async () => {
    const ogre = token({});
    const mapId = await newMap([ogre]);

    await gm.put(`${tokens(mapId)}/${ogre.id}`).send({ position: { x: 8, y: 8 }, size: { width: 3, height: 3 } });

    expect((await storedTokens(mapId))[0].position).toEqual({ x: 7, y: 7 });
  });
});
