/**
 * The GM's table actions over REST reach the table as they do over the socket.
 *
 * Chat, dice, the vibe, atmosphere, spell areas and explored-memory resets
 * were socket events only, so a script or the MCP bridge, which hold no
 * socket, could not send them. Each route calls the function its socket
 * handler calls, so a player's page is sent the same event, with the same
 * fields, whichever way the GM acted. A player is refused every route; a
 * whisper reaches its recipient and no one else at the table; a secret roll
 * reaches no player; an area for the GM alone reaches no player.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, cleanupCampaigns, cleanupUsers, TEST_PASSWORD } from '../../__tests__/helpers/db';
import { createWsTestServer, waitForEvent, expectNoEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { toJson } from '../../utils/prisma-json';

jest.setTimeout(60000);

type Payload = Record<string, unknown>;

const app = createTestApp();
const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let campaignId: string;
let mapId: string;
const ids = { gm: '', p1: '', p2: '' };
const cookies = { gm: '', p1: '', p2: '' };
let gmRest: ReturnType<typeof request.agent>;
let playerRest: ReturnType<typeof request.agent>;
let gm: ClientSocket;
let p1: ClientSocket;
let p2: ClientSocket;

const keys = (payload: Payload) => Object.keys(payload).sort();
const base = () => `/api/campaigns/${campaignId}`;
const cone = (audience: 'ALL' | 'GM') => ({ shape: 'cone', anchorX: 125, anchorY: 75, angle: 0.5, sizeFt: 15, element: 'fire', audience });

beforeAll(async () => {
  const users = await Promise.all(
    (['gm', 'p1', 'p2'] as const).map((who) => createTestUser({ email: `rest-table-${who}-${runId}@test.cozyvtt.local`, displayName: `Rest ${who}` }))
  );
  [ids.gm, ids.p1, ids.p2] = users.map((u) => u.id);
  campaignId = (await prisma.campaign.create({
    data: {
      name: `REST table ${runId}`, ownerId: ids.gm, status: 'ACTIVE',
      vibeSettings: toJson({ enabled: true, periods: [{ name: 'Dawn', hue: '#FFB347', filter: 'none', audio: null }, { name: 'Dusk', hue: '#8E7CC3', filter: 'none', audio: null }] }),
    },
  })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: ids.gm, campaignId, role: 'GM', characterIds: [] },
      { userId: ids.p1, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: ids.p2, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  mapId = (await prisma.map.create({
    data: { campaignId, name: 'Shown', imageUrl: '', baseLayerUrl: '', width: 10, height: 10, gridSize: 50, tokens: [], annotations: [] },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId } });

  gmRest = request.agent(app);
  expect((await gmRest.post('/api/auth/login').send({ email: users[0].email, password: TEST_PASSWORD })).status).toBe(200);
  playerRest = request.agent(app);
  expect((await playerRest.post('/api/auth/login').send({ email: users[1].email, password: TEST_PASSWORD })).status).toBe(200);

  server = await createWsTestServer();
  for (const who of ['gm', 'p1', 'p2'] as const) cookies[who] = await server.loginAs(ids[who]);
});

beforeEach(async () => {
  [gm, p1, p2] = await Promise.all((['gm', 'p1', 'p2'] as const).map((who) => server.connectAndAuth(cookies[who], campaignId)));
});

afterEach(() => {
  [gm, p1, p2].forEach((c) => c.disconnect());
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await cleanupCampaigns([campaignId]);
  await cleanupUsers(Object.values(ids));
  await prisma.$disconnect();
});

it('refuses a player every route with 403', async () => {
  const sent = [
    playerRest.put(`${base()}/vibe/current`).send({ period: 'Dusk' }),
    playerRest.put(`${base()}/atmosphere/effect`).send({ effect: 'rain' }),
    playerRest.put(`${base()}/atmosphere/audio`).send({ assetId: null }),
    playerRest.post(`${base()}/messages`).send({ content: 'hello' }),
    playerRest.post(`${base()}/dice-rolls`).send({ expression: '1d20' }),
    playerRest.post(`${base()}/maps/${mapId}/areas`).send({ area: cone('ALL') }),
    playerRest.delete(`${base()}/maps/${mapId}/areas/${randomUUID()}`),
    playerRest.delete(`${base()}/maps/${mapId}/areas`),
    playerRest.post(`${base()}/maps/${mapId}/exploration/reset`),
  ];
  for (const res of await Promise.all(sent)) expect(res.status).toBe(403);
});

describe('chat', () => {
  it('sends a GM message to every player with the fields the socket sends', async () => {
    const viaSocket = [waitForEvent<Payload>(p1, 'chat.message'), waitForEvent<Payload>(p2, 'chat.message')];
    gm.emit('chat.message', { content: 'by socket' });
    const socketShape = keys((await Promise.all(viaSocket))[0]);

    const heard = [waitForEvent<Payload>(p1, 'chat.message'), waitForEvent<Payload>(p2, 'chat.message')];
    const res = await gmRest.post(`${base()}/messages`).send({ content: '  by rest  ' });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ userId: ids.gm, content: 'by rest', type: 'GM' });
    for (const event of await Promise.all(heard)) {
      expect(event).toEqual(res.body.message);
      expect(keys(event)).toEqual(socketShape);
    }
  });

  it('sends a whisper to its recipient and the GM who sent it, and to no other player', async () => {
    const toP1 = waitForEvent<Payload>(p1, 'chat.message');
    const toGm = waitForEvent<Payload>(gm, 'chat.message');
    const notP2 = expectNoEvent(p2, 'chat.message', 500);
    const res = await gmRest.post(`${base()}/messages`).send({ content: 'psst', recipientId: ids.p1 });
    expect(res.status).toBe(201);
    expect(await toP1).toMatchObject({ type: 'WHISPER', recipientId: ids.p1, content: 'psst' });
    expect((await toGm).id).toBe(res.body.message.id);
    await notP2;
  });

  it('refuses a whisper to someone outside the campaign, and a blank message', async () => {
    expect((await gmRest.post(`${base()}/messages`).send({ content: 'psst', recipientId: randomUUID() })).status).toBe(400);
    expect((await gmRest.post(`${base()}/messages`).send({ content: '   ' })).status).toBe(400);
  });

  it('holds the GM to the campaign chat cooldown, shared with the socket', async () => {
    await prisma.campaign.update({ where: { id: campaignId }, data: { chatCooldownEnabled: true, chatCooldownSeconds: 30 } });
    try {
      const first = await gmRest.post(`${base()}/messages`).send({ content: 'one' });
      expect(first.status).toBe(201);
      const second = await gmRest.post(`${base()}/messages`).send({ content: 'two' });
      expect(second.status).toBe(429);
      expect(second.body.message).toBe('Rate limit: wait 30s between messages.');
    } finally {
      await prisma.campaign.update({ where: { id: campaignId }, data: { chatCooldownEnabled: false } });
    }
  });
});

describe('dice', () => {
  it('sends a public roll to every player with the fields the socket sends', async () => {
    const viaSocket = [waitForEvent<Payload>(p1, 'dice.rolled'), waitForEvent<Payload>(p2, 'dice.rolled')];
    gm.emit('dice.roll', { expression: '1d6' });
    const socketShape = keys((await Promise.all(viaSocket))[0]);

    const heard = waitForEvent<Payload>(p2, 'dice.rolled');
    const res = await gmRest.post(`${base()}/dice-rolls`).send({ expression: '2d8+1', purpose: 'Damage', characterName: 'Goblin' });
    expect(res.status).toBe(201);
    const event = await heard;
    expect(event).toEqual(res.body.roll);
    expect(event).toMatchObject({ userId: ids.gm, expression: '2d8+1', purpose: 'Damage', characterName: 'Goblin', secret: false });
    expect(keys(event)).toEqual(socketShape);
  });

  it('sends a secret roll to the GM and to no player', async () => {
    const toGm = waitForEvent<Payload>(gm, 'dice.rolled');
    const silent = [p1, p2].flatMap((p) => [expectNoEvent(p, 'dice.rolled', 500), expectNoEvent(p, 'dice.rolled.secret', 500)]);
    const res = await gmRest.post(`${base()}/dice-rolls`).send({ expression: '1d20', secret: true });
    expect(res.status).toBe(201);
    expect(await toGm).toMatchObject({ id: res.body.roll.id, secret: true });
    await Promise.all(silent);
    expect(await prisma.diceRoll.findUnique({ where: { id: res.body.roll.id }, select: { secret: true } })).toEqual({ secret: true });
  });

  it('refuses an expression that does not parse', async () => {
    const res = await gmRest.post(`${base()}/dice-rolls`).send({ expression: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Invalid dice expression/);
  });
});

describe('vibe', () => {
  it('switches the period: vibe.updated as over the socket, and the system message', async () => {
    const viaSocket = waitForEvent<Payload>(p1, 'vibe.updated');
    const socketSystem = waitForEvent<Payload>(p2, 'chat.system');
    gm.emit('vibe.update', { period: 'Dawn' });
    const socketShape = keys(await viaSocket);
    expect(await socketSystem).toMatchObject({ content: 'Time advances to Dawn.' });

    const updated = waitForEvent<Payload>(p1, 'vibe.updated');
    const system = waitForEvent<Payload>(p2, 'chat.system');
    const res = await gmRest.put(`${base()}/vibe/current`).send({ period: 'dusk' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ period: 'Dusk' });
    const event = await updated;
    expect(event).toMatchObject({ period: 'Dusk', hue: '#8E7CC3', updatedBy: ids.gm });
    expect(keys(event)).toEqual(socketShape);
    expect(await system).toMatchObject({ content: 'Time advances to Dusk.' });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } })).currentVibe).toBe('Dusk');
  });

  it('refuses a period the campaign does not have', async () => {
    const res = await gmRest.put(`${base()}/vibe/current`).send({ period: 'Midnight' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Unknown vibe period 'Midnight'. Available: Dawn, Dusk");
  });
});

describe('atmosphere', () => {
  it('sets the weather for every player with the fields the socket sends, and refuses an unknown one', async () => {
    const viaSocket = waitForEvent<Payload>(p1, 'atmosphere.effect.updated');
    gm.emit('atmosphere.effect.set', { effect: 'snow' });
    const socketShape = keys(await viaSocket);

    const heard = waitForEvent<Payload>(p1, 'atmosphere.effect.updated');
    expect((await gmRest.put(`${base()}/atmosphere/effect`).send({ effect: 'rain' })).status).toBe(200);
    const event = await heard;
    expect(event).toMatchObject({ effect: 'rain', setBy: ids.gm });
    expect(keys(event)).toEqual(socketShape);

    expect((await gmRest.put(`${base()}/atmosphere/effect`).send({ effect: 'lava' })).status).toBe(400);
  });

  it('stops the ambient audio for every player, and answers a track that is not there as not found', async () => {
    const heard = waitForEvent<Payload>(p1, 'atmosphere.audio.updated');
    expect((await gmRest.put(`${base()}/atmosphere/audio`).send({ assetId: null })).status).toBe(200);
    expect(await heard).toMatchObject({ assetId: null, audioUrl: null });

    const missing = await gmRest.put(`${base()}/atmosphere/audio`).send({ assetId: randomUUID(), volume: 0.3 });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Audio asset not found');
  });
});

describe('spell areas', () => {
  beforeEach(async () => {
    await prisma.mapArea.deleteMany({ where: { mapId } });
  });

  it('places an area for everyone with the fields the socket sends, and erases it', async () => {
    const viaSocket = waitForEvent<Payload>(p1, 'area:added');
    gm.emit('area:add', { mapId, area: cone('ALL') });
    const socketShape = keys((await viaSocket).area as Payload);

    const added = waitForEvent<Payload>(p1, 'area:added');
    const res = await gmRest.post(`${base()}/maps/${mapId}/areas`).send({ area: cone('ALL') });
    expect(res.status).toBe(201);
    const event = await added;
    expect(event).toMatchObject({ mapId, area: { id: res.body.id, audience: 'ALL', authorId: ids.gm } });
    expect(keys(event.area as Payload)).toEqual(socketShape);

    const removed = waitForEvent<Payload>(p1, 'area:removed');
    expect((await gmRest.delete(`${base()}/maps/${mapId}/areas/${res.body.id}`)).status).toBe(200);
    expect(await removed).toEqual({ mapId, areaId: res.body.id });
    expect((await gmRest.delete(`${base()}/maps/${mapId}/areas/${res.body.id}`)).status).toBe(404);
  });

  it('sends an area for the GM alone to the GM and to no player', async () => {
    const toGm = waitForEvent<Payload>(gm, 'area:added');
    const silent = [expectNoEvent(p1, 'area:added', 500), expectNoEvent(p2, 'area:added', 500)];
    const res = await gmRest.post(`${base()}/maps/${mapId}/areas`).send({ area: cone('GM') });
    expect(res.status).toBe(201);
    expect(await toGm).toMatchObject({ area: { id: res.body.id, audience: 'GM' } });
    await Promise.all(silent);

    // Cleared: the players had none of them, so only the GM is told.
    const clearedGm = waitForEvent<Payload>(gm, 'areas:cleared');
    const notP1 = expectNoEvent(p1, 'areas:cleared', 500);
    expect((await gmRest.delete(`${base()}/maps/${mapId}/areas`)).status).toBe(200);
    expect(await clearedGm).toEqual({ mapId });
    await notP1;
    expect(await prisma.mapArea.count({ where: { mapId } })).toBe(0);
  });

  it('clears areas for everyone and tells the players', async () => {
    expect((await gmRest.post(`${base()}/maps/${mapId}/areas`).send({ area: cone('ALL') })).status).toBe(201);
    const cleared = waitForEvent<Payload>(p1, 'areas:cleared');
    expect((await gmRest.delete(`${base()}/maps/${mapId}/areas`)).status).toBe(200);
    expect(await cleared).toEqual({ mapId });
  });

  it('refuses an area off the map, and a map of another campaign as not found', async () => {
    expect((await gmRest.post(`${base()}/maps/${mapId}/areas`).send({ area: { ...cone('ALL'), anchorX: 99999 } })).status).toBe(400);
    expect((await gmRest.post(`${base()}/maps/${randomUUID()}/areas`).send({ area: cone('ALL') })).status).toBe(404);
  });
});

describe('explored memory', () => {
  it('forgets every player\'s memory of the map and sends its readers the empty state', async () => {
    await prisma.mapExploration.createMany({ data: [ids.p1, ids.p2].map((userId) => ({ mapId, userId, explored: toJson({}) })) });
    const state = waitForEvent<Payload>(p1, 'exploration:state');
    const res = await gmRest.post(`${base()}/maps/${mapId}/exploration/reset`);
    expect(res.status).toBe(200);
    expect(await state).toEqual({ mapId, userId: null, cells: [] });
    expect(await prisma.mapExploration.count({ where: { mapId } })).toBe(0);

    expect((await gmRest.post(`${base()}/maps/${randomUUID()}/exploration/reset`)).status).toBe(404);
  });
});
