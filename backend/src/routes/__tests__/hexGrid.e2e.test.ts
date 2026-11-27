/**
 * A hex map through the map and token routes: where a token may stand is
 * judged by its hex (a cell is on the map when its centre lies in the frame,
 * utils/tokenCentre.ts), a change of the grid moves every token to the cell
 * nearest where it stood on the picture under the map's lock, the new fields
 * are checked, and a hex map is not exported as a Universal VTT file.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { readTokens, toJson } from '../../utils/prisma-json';
import { cellOnMap, isHexGrid, tokenCentre } from '../../utils/tokenCentre';
import { UVTT_HEX_REFUSAL } from '../maps';

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
      campaignId, name: 'Hexes', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: 10, height: 10, gridSize: 50, tokens: toJson(tokens), annotations: [], ...data,
    },
  });
  return map.id;
}
const stored = (mapId: string) => prisma.map.findUniqueOrThrow({ where: { id: mapId } });
const at = (path: string) => `/api/campaigns/${campaignId}/maps${path}`;

beforeAll(async () => {
  const stamp = Date.now();
  const user = await createTestUser({ email: `hexgrid-${stamp}@test.cozyvtt.local` });
  gmId = user.id;
  campaignId = (await createTestCampaign(gmId, { name: `Hex grid ${stamp}` })).id;
  await prisma.campaignMembership.create({ data: { userId: gmId, campaignId, role: 'GM', characterIds: [] } });
  gm = request.agent(app);
  expect((await gm.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await cleanupCampaigns([campaignId]);
  await cleanupUsers([gmId]);
  await prisma.$disconnect();
});

// A pointy hex map 10 by 10 squares at 50 px: eleven rows of hexes, the top
// one (y 10) whole, so the top row is y 10 and one above it is off the map.
describe('tokens on a pointy hex map', () => {
  it('takes a token on the top hex row and refuses one above it', async () => {
    const mapId = await newMap({ gridType: 'hexPointy' });

    const top = await gm.post(at(`/${mapId}/tokens`)).send({ name: 'Top', position: { x: 3, y: 10 } });
    expect(top.status).toBe(201);
    expect(top.body.token.position).toEqual({ x: 3, y: 10 });

    const above = await gm.post(at(`/${mapId}/tokens`)).send({ name: 'Above', position: { x: 3, y: 11 } });
    expect(above.status).toBe(400);

    const moveUp = await gm.put(at(`/${mapId}/tokens/${top.body.token.id}`)).send({ position: { x: 3, y: 11 } });
    expect(moveUp.status).toBe(400);
    // The last hex of a shifted row is one short of a whole row's.
    const shiftedEnd = await gm.put(at(`/${mapId}/tokens/${top.body.token.id}`)).send({ position: { x: 9, y: 9 } });
    expect(shiftedEnd.status).toBe(400);
    const wholeEnd = await gm.put(at(`/${mapId}/tokens/${top.body.token.id}`)).send({ position: { x: 9, y: 10 } });
    expect(wholeEnd.status).toBe(200);
    expect(readTokens((await stored(mapId)).tokens).map((t) => t.position)).toEqual([{ x: 9, y: 10 }]);
  });
});

describe('changing the grid', () => {
  it('moves every token to the cell nearest where it stood on the picture, a rider with its mount', async () => {
    const onEdge = token({ position: { x: 9, y: 9 } });
    const inside = token({ position: { x: 3, y: 3 } });
    const horse = token({ position: { x: 5, y: 5 }, size: { width: 2, height: 2 } });
    const rider = token({ position: { x: 5, y: 5 }, mountedOn: horse.id });
    const mapId = await newMap({}, [onEdge, inside, horse, rider]);
    let map = await stored(mapId);

    // Each switch moves a centre at most to the nearest cell centre: within
    // gridSize/√3 of a hex centre, within half a square each way of a square's.
    const steps: Array<[Record<string, unknown>, (dx: number, dy: number) => boolean]> = [
      [{ gridType: 'hexPointy' }, (dx, dy) => Math.hypot(dx, dy) <= 50 / Math.sqrt(3) + 1e-6],
      [{ gridType: 'square' }, (dx, dy) => dx <= 25 + 1e-6 && dy <= 25 + 1e-6],
      [{ gridType: 'hexFlat', gridOffsetX: 12.5 }, (dx, dy) => Math.hypot(dx, dy) <= 50 / Math.sqrt(3) + 1e-6],
      [{ gridType: 'square', gridOffsetX: 0 }, (dx, dy) => dx <= 25 + 1e-6 && dy <= 25 + 1e-6],
    ];
    for (const [edit, near] of steps) {
      const before = map;
      expect((await gm.put(at(`/${mapId}`)).send(edit)).status).toBe(200);
      map = await stored(mapId);
      const was = Object.fromEntries(readTokens(before.tokens).map((t) => [t.id, tokenCentre(t, before)]));
      const now = readTokens(map.tokens);
      for (const t of now.filter((t) => t.id !== rider.id)) {
        const c = tokenCentre(t, map);
        expect(near(Math.abs(c.x - was[t.id].x), Math.abs(c.y - was[t.id].y))).toBe(true);
        if (isHexGrid(map)) expect(cellOnMap(t.position, map)).toBe(true);
      }
      const byId = Object.fromEntries(now.map((t) => [t.id, t]));
      expect(byId[rider.id].position).toEqual(byId[horse.id].position);
    }
  });

  it("keeps every position when only a square grid's size changes", async () => {
    const tokens = [token({ position: { x: 9, y: 9 } }), token({ position: { x: 2, y: 6 }, size: { width: 3, height: 3 } })];
    const mapId = await newMap({}, tokens);
    expect((await gm.put(at(`/${mapId}`)).send({ gridSize: 70.4 })).status).toBe(200);
    expect(readTokens((await stored(mapId)).tokens).map((t) => t.position)).toEqual(tokens.map((t) => t.position));
  });

  it('refuses a grid type or offset it does not know, and takes a grid size between whole pixels', async () => {
    const mapId = await newMap();
    expect((await gm.put(at(`/${mapId}`)).send({ gridType: 'triangle' })).status).toBe(400);
    expect((await gm.put(at(`/${mapId}`)).send({ gridOffsetX: 501 })).status).toBe(400);
    expect((await gm.put(at(`/${mapId}`)).send({ gridOffsetY: 'ten' })).status).toBe(400);
    const res = await gm.put(at(`/${mapId}`)).send({ gridSize: 70.4, gridOffsetX: -12.25, gridOffsetY: 30 });
    expect(res.status).toBe(200);
    const map = await stored(mapId);
    expect([map.gridSize, map.gridOffsetX, map.gridOffsetY, map.gridType]).toEqual([70.4, -12.25, 30, 'square']);
  });

  it('refuses a new map with a grid type it does not know', async () => {
    const res = await gm.post(at('')).send({ name: 'Odd', imageUrl: 'x', width: 10, height: 10, gridType: 'triangle' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/gridType/);
  });
});

describe('a Universal VTT export of a hex map', () => {
  it('is refused with the reason', async () => {
    const mapId = await newMap({ gridType: 'hexFlat' });
    const res = await gm.get(at(`/${mapId}/export-uvtt`));
    expect(res.status).toBe(422);
    expect(res.body.message).toBe(UVTT_HEX_REFUSAL);
  });
});
