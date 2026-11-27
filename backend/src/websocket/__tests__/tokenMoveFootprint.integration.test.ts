/**
 * A dropped token stands where the map lets its mover put it, with its
 * footprint on the map, as over REST (tokenFootprint.e2e.test.ts). On a map
 * whose tokens snap (the default) a player's drop between squares is refused
 * and only the GM may place freely; on one whose tokens do not, anyone may,
 * to hundredths of a square. The client floors or rounds and clamps a drop;
 * this is what a scripted one gets.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/database';
import { readTokens, toJson } from '../../utils/prisma-json';
import { createWsTestServer, expectNoEvent, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let gmId: string;
let playerId: string;
let campaignId: string;
let gmCookie: string;
let playerCookie: string;

const ogre = (controlledBy: string | null = null) => ({
  id: randomUUID(), name: 'Ogre', imageUrl: '', position: { x: 1, y: 1 }, size: { width: 2, height: 2 },
  layer: 'token', visible: true, controlledBy, rotation: 0, conditions: [], metadata: {},
});

async function newMap(tokens: unknown[], extra: { snapTokens?: boolean; gridType?: string } = {}): Promise<string> {
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Drop', imageUrl: '/api/assets/maps/x', baseLayerUrl: '/api/assets/maps/x',
      width: 10, height: 10, gridSize: 50, tokens: toJson(tokens), annotations: [], ...extra,
    },
  });
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: map.id } });
  return map.id;
}
const storedPosition = async (mapId: string) =>
  readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } })).tokens)[0].position;

beforeAll(async () => {
  const gm = await prisma.user.create({ data: { email: `drop-dm-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Drop GM' } });
  const player = await prisma.user.create({ data: { email: `drop-pl-${runId}@test.cozyvtt.local`, passwordHash: 'x', displayName: 'Drop Player' } });
  gmId = gm.id;
  playerId = player.id;
  campaignId = (await prisma.campaign.create({ data: { name: `Drop ${runId}`, ownerId: gmId, vibeSettings: {}, status: 'ACTIVE' } })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: gmId, campaignId, role: 'GM', characterIds: [] },
      { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  server = await createWsTestServer();
  gmCookie = await server.loginAs(gmId);
  playerCookie = await server.loginAs(playerId);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [gmId, playerId] } } });
  await prisma.$disconnect();
});

it('refuses a player\'s drop between squares on a map whose tokens snap, and the token stays where it was', async () => {
  const token = ogre(playerId);
  const mapId = await newMap([token]);
  const player = await server.connectAndAuth(playerCookie, campaignId);
  const error = waitForEvent<{ message: string }>(player, 'error');
  const putBack = waitForEvent<{ x: number; y: number }>(player, 'token.moved');

  player.emit('token.move.end', { tokenId: token.id, mapId, x: 3.5, y: 2 });

  expect((await error).message).toMatch(/Invalid token move data/);
  expect(await putBack).toMatchObject({ x: 1, y: 1 });
  expect(await storedPosition(mapId)).toEqual({ x: 1, y: 1 });
  player.disconnect();
});

it('takes the GM\'s drop between squares on a map whose tokens snap, to hundredths', async () => {
  const token = ogre();
  const mapId = await newMap([token]);
  const gm = await server.connectAndAuth(gmCookie, campaignId);
  const moved = waitForEvent<{ x: number; y: number }>(gm, 'token.moved');

  gm.emit('token.move.end', { tokenId: token.id, mapId, x: 3.456, y: 2.5 });

  expect(await moved).toMatchObject({ x: 3.46, y: 2.5 });
  expect(await storedPosition(mapId)).toEqual({ x: 3.46, y: 2.5 });
  gm.disconnect();
});

it('takes a player\'s drop between squares on a map whose tokens do not snap, to hundredths', async () => {
  const token = ogre(playerId);
  const mapId = await newMap([token], { snapTokens: false });
  const player = await server.connectAndAuth(playerCookie, campaignId);
  const moved = waitForEvent<{ x: number; y: number }>(player, 'token.moved');

  player.emit('token.move.end', { tokenId: token.id, mapId, x: 3.14159, y: 2.005 });

  const { x, y } = await moved;
  expect({ x, y }).toEqual(await storedPosition(mapId));
  expect(await storedPosition(mapId)).toEqual({ x: 3.14, y: Math.round(2.005 * 100) / 100 });
  player.disconnect();
});

it('refuses even the GM\'s drop between hexes, whatever the column says', async () => {
  const token = { ...ogre(), position: { x: 1, y: 1 }, size: { width: 1, height: 1 } };
  const mapId = await newMap([token], { gridType: 'hexPointy', snapTokens: false });
  const gm = await server.connectAndAuth(gmCookie, campaignId);
  const error = waitForEvent<{ message: string }>(gm, 'error');

  gm.emit('token.move.end', { tokenId: token.id, mapId, x: 2.5, y: 1 });

  expect((await error).message).toMatch(/Invalid token move data/);
  expect(await storedPosition(mapId)).toEqual({ x: 1, y: 1 });
  gm.disconnect();
});

describe('drag frames', () => {
  it('drops a frame that is not a finite number, and relays the next good one rounded', async () => {
    const token = ogre(playerId);
    const mapId = await newMap([token], { snapTokens: false });
    const gm = await server.connectAndAuth(gmCookie, campaignId);
    const player = await server.connectAndAuth(playerCookie, campaignId);
    player.emit('token.move.start', { tokenId: token.id, mapId });

    const none = expectNoEvent(gm, 'token.moved', 400);
    player.emit('token.move', { tokenId: token.id, mapId, x: Infinity, y: 2 });
    player.emit('token.move', { tokenId: token.id, mapId, x: 'NaN', y: 2 });
    await none;

    const frame = waitForEvent<{ x: number; y: number }>(gm, 'token.moved');
    player.emit('token.move', { tokenId: token.id, mapId, x: 4.444, y: 2 });
    expect(await frame).toMatchObject({ x: 4.44, y: 2 });
    gm.disconnect();
    player.disconnect();
  });

  it('drops a player\'s frame between squares on a map whose tokens snap', async () => {
    const token = ogre(playerId);
    const mapId = await newMap([token]);
    const gm = await server.connectAndAuth(gmCookie, campaignId);
    const player = await server.connectAndAuth(playerCookie, campaignId);
    player.emit('token.move.start', { tokenId: token.id, mapId });

    const none = expectNoEvent(gm, 'token.moved', 400);
    player.emit('token.move', { tokenId: token.id, mapId, x: 4.5, y: 2 });
    await none;
    gm.disconnect();
    player.disconnect();
  });

  it('relays a player\'s frame back to where a token the GM placed between squares stands, as a cancelled hold sends', async () => {
    const token = { ...ogre(playerId), position: { x: 1.25, y: 1 } };
    const mapId = await newMap([token]);
    const gm = await server.connectAndAuth(gmCookie, campaignId);
    const player = await server.connectAndAuth(playerCookie, campaignId);
    player.emit('token.move.start', { tokenId: token.id, mapId });

    const frame = waitForEvent<{ x: number; y: number }>(gm, 'token.moved');
    player.emit('token.move', { tokenId: token.id, mapId, x: 1.25, y: 1 });
    expect(await frame).toMatchObject({ x: 1.25, y: 1 });
    gm.disconnect();
    player.disconnect();
  });
});

it('pulls a drop that would hang off the edge back onto the map, and says where it went', async () => {
  const token = ogre();
  const mapId = await newMap([token]);
  const gm = await server.connectAndAuth(gmCookie, campaignId);
  const moved = waitForEvent<{ x: number; y: number }>(gm, 'token.moved');

  gm.emit('token.move.end', { tokenId: token.id, mapId, x: 9, y: 9 });

  expect(await moved).toMatchObject({ x: 8, y: 8 });
  expect(await storedPosition(mapId)).toEqual({ x: 8, y: 8 });
  gm.disconnect();
});
