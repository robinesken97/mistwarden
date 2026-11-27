/**
 * A drop on a hex map is judged by its hex, as over REST (hexGrid.e2e.test.ts):
 * a cell is on the map when its centre lies in the frame, so on a pointy map
 * 10 by 10 squares at 50 px the top row of hexes is y 10 and one above it is
 * off the map.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { readTokens, toJson } from '../../utils/prisma-json';
import { createWsTestServer, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let gmId: string;
let campaignId: string;
let gmCookie: string;

const scout = () => ({
  id: randomUUID(), name: 'Scout', imageUrl: '', position: { x: 3, y: 5 }, size: { width: 1, height: 1 },
  layer: 'token', visible: true, controlledBy: null, rotation: 0, conditions: [], metadata: {},
});

async function newMap(tokens: unknown[]): Promise<string> {
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Hex drop', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: 10, height: 10, gridSize: 50, gridType: 'hexPointy', tokens: toJson(tokens), annotations: [],
    },
  });
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });
  return map.id;
}
const storedPosition = async (mapId: string) =>
  readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } })).tokens)[0].position;

beforeAll(async () => {
  const gm = await prisma.user.create({ data: { email: `hexdrop-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Hex drop GM' } });
  gmId = gm.id;
  campaignId = (await prisma.campaign.create({ data: { name: `Hex drop ${runId}`, ownerId: gmId, vibeSettings: {}, status: 'ACTIVE' } })).id;
  await prisma.campaignMembership.create({ data: { userId: gmId, campaignId, role: 'GM', characterIds: [] } });
  server = await createWsTestServer();
  gmCookie = await server.loginAs(gmId);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: gmId } });
  await prisma.$disconnect();
});

it('refuses a drop one row above the top hex row, and the token stays where it was', async () => {
  const token = scout();
  const mapId = await newMap([token]);
  const gm = await server.connectAndAuth(gmCookie, campaignId);
  const error = waitForEvent<{ message: string }>(gm, 'error');

  gm.emit('token.move.end', { tokenId: token.id, mapId, x: 3, y: 11 });

  expect((await error).message).toBe('Token position out of bounds');
  expect(await storedPosition(mapId)).toEqual({ x: 3, y: 5 });
  gm.disconnect();
});

it('takes a drop on the top hex row', async () => {
  const token = scout();
  const mapId = await newMap([token]);
  const gm = await server.connectAndAuth(gmCookie, campaignId);
  const moved = waitForEvent<{ x: number; y: number }>(gm, 'token.moved');

  gm.emit('token.move.end', { tokenId: token.id, mapId, x: 3, y: 10 });

  expect(await moved).toMatchObject({ x: 3, y: 10 });
  expect(await storedPosition(mapId)).toEqual({ x: 3, y: 10 });
  gm.disconnect();
});
