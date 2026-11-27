/**
 * Whether a map's tokens snap, through the map routes: a map whose tokens do
 * not snap keeps positions between squares through a grid change and a
 * move from another map, turning snapping on puts every token on its nearest
 * whole square (a rider on its mount's), and a hex map always snaps.
 * Which mover may place between squares is tokenFootprint.e2e.test.ts.
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
let campaignId: string;
let gm: ReturnType<typeof request.agent>;

const token = (over: Record<string, unknown>) => ({
  id: randomUUID(), name: 'Scout', imageUrl: '', position: { x: 1, y: 1 }, size: { width: 1, height: 1 },
  layer: 'token', visible: true, controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...over,
});

async function newMap(data: Record<string, unknown> = {}, tokens: unknown[] = []): Promise<string> {
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Snapping', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: 10, height: 10, gridSize: 50, tokens: toJson(tokens), annotations: [], ...data,
    },
  });
  return map.id;
}
const stored = (mapId: string) => prisma.map.findUniqueOrThrow({ where: { id: mapId } });
const positions = async (mapId: string) => readTokens((await stored(mapId)).tokens).map((t) => t.position);
const at = (path: string) => `/api/campaigns/${campaignId}/maps${path}`;

beforeAll(async () => {
  const stamp = Date.now();
  const user = await createTestUser({ email: `snapping-${stamp}@test.cozyvtt.local` });
  gmId = user.id;
  campaignId = (await createTestCampaign(gmId, { name: `Snapping ${stamp}` })).id;
  await prisma.campaignMembership.create({ data: { userId: gmId, campaignId, role: 'GM', characterIds: [] } });
  gm = request.agent(app);
  expect((await gm.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([gmId]);
  await prisma.$disconnect();
});

describe('turning snapping on', () => {
  it('puts every token on its nearest whole square, kept on the map, a rider on its mount\'s', async () => {
    const loose = token({ position: { x: 2.4, y: 3.6 } });
    const edge = token({ position: { x: 8.6, y: 0.2 }, size: { width: 2, height: 2 } });
    const horse = token({ position: { x: 4.5, y: 5.49 }, size: { width: 2, height: 2 } });
    const rider = token({ position: { x: 4.5, y: 5.49 }, mountedOn: horse.id });
    const mapId = await newMap({ snapTokens: false }, [loose, edge, horse, rider]);

    const res = await gm.put(at(`/${mapId}`)).send({ snapTokens: true });

    expect(res.status).toBe(200);
    expect(res.body.map.snapTokens).toBe(true);
    expect(await positions(mapId)).toEqual([{ x: 2, y: 4 }, { x: 8, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }]);
  });

  it('leaves positions alone when it turns snapping off', async () => {
    const mapId = await newMap({}, [token({ position: { x: 2.5, y: 3 } })]);
    expect((await gm.put(at(`/${mapId}`)).send({ snapTokens: false })).status).toBe(200);
    expect(await positions(mapId)).toEqual([{ x: 2.5, y: 3 }]);
  });

  it('refuses a value that is not a boolean', async () => {
    const mapId = await newMap();
    expect((await gm.put(at(`/${mapId}`)).send({ snapTokens: 'no' })).status).toBe(400);
    expect((await stored(mapId)).snapTokens).toBe(true);
  });
});

describe('a hex map', () => {
  it('always snaps: made with snapping off, or turned off later, it keeps it on', async () => {
    const made = await gm.post(at('')).send({ name: 'Hexes', imageUrl: randomUUID(), width: 10, height: 10, gridType: 'hexPointy', snapTokens: false });
    expect(made.status).toBe(201);
    expect(made.body.map.snapTokens).toBe(true);
    const loose = await gm.post(at('')).send({ name: 'Loose', imageUrl: randomUUID(), width: 10, height: 10, snapTokens: false });
    expect(loose.body.map.snapTokens).toBe(false);

    const mapId = await newMap({ gridType: 'hexFlat' });
    expect((await gm.put(at(`/${mapId}`)).send({ snapTokens: false })).status).toBe(200);
    expect((await stored(mapId)).snapTokens).toBe(true);
  });

  it('turns snapping on when a free square map becomes one', async () => {
    const mapId = await newMap({ snapTokens: false }, [token({ position: { x: 2.37, y: 3.5 } })]);
    expect((await gm.put(at(`/${mapId}`)).send({ gridType: 'hexPointy' })).status).toBe(200);
    const map = await stored(mapId);
    expect(map.snapTokens).toBe(true);
    for (const p of await positions(mapId)) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });
});

describe('changing the grid of a map whose tokens do not snap', () => {
  it('keeps each token where it stood on the picture, to hundredths', async () => {
    const mapId = await newMap({ snapTokens: false }, [token({ position: { x: 2.3, y: 4.7 } })]);
    // The picture is the same; only the grid moves by a fifth of a square.
    expect((await gm.put(at(`/${mapId}`)).send({ gridOffsetX: 10 })).status).toBe(200);
    expect(await positions(mapId)).toEqual([{ x: 2.1, y: 4.7 }]);
  });
});

describe('moving tokens to another map', () => {
  it('keeps a position between squares on a map whose tokens do not snap, and rounds it on one whose do', async () => {
    const from = await newMap({ snapTokens: false }, [token({ id: randomUUID(), position: { x: 2.4, y: 3.6 } })]);
    const [moving] = readTokens((await stored(from)).tokens);
    const free = await newMap({ snapTokens: false });
    const snapped = await newMap();

    expect((await gm.post(at(`/${from}/tokens/move`)).send({ tokenIds: [moving.id], targetMapId: free })).status).toBe(200);
    expect(await positions(free)).toEqual([{ x: 2.4, y: 3.6 }]);

    expect((await gm.post(at(`/${free}/tokens/move`)).send({ tokenIds: [moving.id], targetMapId: snapped })).status).toBe(200);
    expect(await positions(snapped)).toEqual([{ x: 2, y: 4 }]);
  });
});

describe('a new map', () => {
  it('snaps unless asked not to', async () => {
    const res = await gm.post(at('')).send({ name: 'Loose', imageUrl: randomUUID(), width: 10, height: 10, snapTokens: 'yes' });
    expect(res.status).toBe(400);
  });
});
