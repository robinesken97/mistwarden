/**
 * Dropping a rider or its mount over the socket moves the pair as one.
 *
 * token.move.end checks the dragged token alone: a player who drags their
 * own rider takes the GM-coupled horse with it, and everyone who may have
 * each token is told where it went, on a lit map by their own sight as for
 * the dragged token.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { readTokens, toJson } from '../../utils/prisma-json';
import { createWsTestServer, WsTestServer } from '../../__tests__/helpers/websocket-test-server';

jest.setTimeout(20000);

const runId = randomUUID().slice(0, 8);
const email = (name: string) => `mounteddrop-${name}-${runId}@test.cozyvtt.local`;

let server: WsTestServer;
let gmId: string;
let riderOwnerId: string;
let otherId: string;
let campaignId: string;
let mapId: string;
const cookies: Record<string, string> = {};

function token(id: string, x: number, y: number, controlledBy: string | null, extra: Record<string, unknown> = {}) {
  return {
    id, name: id, imageUrl: '', position: { x, y }, size: { width: 1, height: 1 }, layer: 'token',
    visible: true, controlledBy, rotation: 0, conditions: [], metadata: {}, ...extra,
  };
}

const pair = () => [
  token('horse', 2, 2, null, { size: { width: 2, height: 2 } }),
  token('rider', 2, 2, riderOwnerId, { mountedOn: 'horse' }),
  // On a lit map a player sees from their own tokens.
  token('scout', 0, 9, otherId),
];

/** Every token.moved a socket is sent, by token id, the last one kept. */
function movesTo(client: ClientSocket): Map<string, { x: number; y: number }> {
  const seen = new Map<string, { x: number; y: number }>();
  client.on('token.moved', (e: { tokenId: string; x: number; y: number; dragging?: boolean }) => {
    if (!e.dragging) seen.set(e.tokenId, { x: e.x, y: e.y });
  });
  return seen;
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  const [gm, owner, other] = await Promise.all(
    ['dm', 'owner', 'other'].map((name) =>
      prisma.user.create({ data: { email: email(name), passwordHash: 'not-used-by-socket-auth', displayName: `Mounted ${name}` } })
    )
  );
  gmId = gm.id;
  riderOwnerId = owner.id;
  otherId = other.id;
  const campaign = await prisma.campaign.create({ data: { name: `Mounted Drop ${runId}`, ownerId: gmId, vibeSettings: {}, status: 'ACTIVE' } });
  campaignId = campaign.id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: gmId, campaignId, role: 'GM', characterIds: [] },
      { userId: riderOwnerId, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: otherId, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  const map = await prisma.map.create({
    data: {
      campaignId, name: 'Mounted Map', imageUrl: '/api/assets/maps/none', baseLayerUrl: '/api/assets/maps/none',
      width: 10, height: 10, gridSize: 50, tokens: toJson(pair()), annotations: [], wallSegments: toJson([]), lights: toJson([]),
    },
  });
  mapId = map.id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });
  server = await createWsTestServer();
  [cookies.gm, cookies.owner, cookies.other] = await Promise.all([gmId, riderOwnerId, otherId].map((id) => server.loginAs(id)));
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: [gmId, riderOwnerId, otherId] } } });
  await prisma.$disconnect();
});

describe.each([
  ['an unlit map', { lightingEnabled: false, globalIllumination: false }],
  ['a lit map in daylight', { lightingEnabled: true, globalIllumination: true }],
])('dropping a rider on %s', (_label, lighting) => {
  beforeEach(async () => {
    await prisma.map.update({ where: { id: mapId }, data: { tokens: toJson(pair()), ...lighting } });
  });

  it('takes the GM-coupled horse along, and tells the GM, the rider and another player of both', async () => {
    const owner = await server.connectAndAuth(cookies.owner, campaignId);
    const other = await server.connectAndAuth(cookies.other, campaignId);
    const gm = await server.connectAndAuth(cookies.gm, campaignId);
    const [toOwner, toOther, toGm] = [owner, other, gm].map(movesTo);

    owner.emit('token.move.start', { tokenId: 'rider', mapId });
    owner.emit('token.move.end', { tokenId: 'rider', mapId, x: 5, y: 4 });

    await until(() => [toOwner, toOther, toGm].every((m) => m.has('rider') && m.has('horse')));
    for (const seen of [toOwner, toOther, toGm]) {
      expect(seen.get('rider')).toEqual({ x: 5, y: 4 });
      expect(seen.get('horse')).toEqual({ x: 5, y: 4 });
    }
    const stored = readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens);
    expect(stored.map((t) => [t.id, t.position])).toEqual([['horse', { x: 5, y: 4 }], ['rider', { x: 5, y: 4 }], ['scout', { x: 0, y: 9 }]]);
  });

  it('stops the pair as one at the edge', async () => {
    const owner = await server.connectAndAuth(cookies.owner, campaignId);
    const seen = movesTo(owner);
    owner.emit('token.move.start', { tokenId: 'rider', mapId });
    owner.emit('token.move.end', { tokenId: 'rider', mapId, x: 9, y: 9 });
    await until(() => seen.has('rider') && seen.has('horse'));
    expect([seen.get('horse'), seen.get('rider')]).toEqual([{ x: 8, y: 8 }, { x: 8, y: 8 }]);
  });

  it('still refuses the player dropping the horse they do not control', async () => {
    const owner = await server.connectAndAuth(cookies.owner, campaignId);
    owner.emit('token.move.end', { tokenId: 'horse', mapId, x: 6, y: 6 });
    await new Promise((r) => setTimeout(r, 300));
    const stored = readTokens((await prisma.map.findUniqueOrThrow({ where: { id: mapId } })).tokens);
    expect(stored.map((t) => t.position)).toEqual([{ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 0, y: 9 }]);
  });
});
