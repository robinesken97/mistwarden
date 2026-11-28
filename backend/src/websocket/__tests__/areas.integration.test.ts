/**
 * Spell areas on a map over the live table.
 *
 * The GM places one at any time; a player while Players may draw is on,
 * except while the session is paused or has ended; a spectator never. A
 * player's is for everyone. One for the GM alone never reaches anyone else:
 * not when placed, erased or cleared, and not in the list a page asks for.
 * A player erases and clears only their own; the GM any. Each share of a
 * map, the GM's and the players', holds AREA_LIMITS.perShare. The REST read
 * gives each role what the socket does; Edit Map's resize moves anchors.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { prisma } from '../../config/database';
import { createWsTestServer, expectNoEvent, waitForEvent, WsTestServer } from '../../__tests__/helpers/websocket-test-server';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { TEST_PASSWORD, createTestUser } from '../../__tests__/helpers/db';
import type { AckAnswer } from '../ack';
import { AREA_LIMITS, AREA_SHARE_FULL, AREA_OUTSIDE_MAP_MESSAGE } from '../../validators/areas';
import {
  DRAW_PAUSED_REFUSAL, DRAW_SETTING_REFUSAL, DRAW_SPECTATOR_REFUSAL, ERASE_OTHERS_REFUSAL, ERASE_SPECTATOR_REFUSAL,
} from '../../utils/drawingRules';

jest.setTimeout(60000);

const runId = randomUUID().slice(0, 8);
let server: WsTestServer;
let campaignId: string;
let shownId: string;
const ids: Record<'gm' | 'p1' | 'p2' | 'spectator', string> = { gm: '', p1: '', p2: '', spectator: '' };
const cookies: Record<keyof typeof ids, string> = { gm: '', p1: '', p2: '', spectator: '' };
const emails: Record<keyof typeof ids, string> = { gm: '', p1: '', p2: '', spectator: '' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cone = (extra: Record<string, unknown> = {}) => ({ shape: 'cone', anchorX: 125, anchorY: 75, angle: 0.5, sizeFt: 15, element: 'fire', label: ' Burning hands ', ...extra });

function ask(client: ClientSocket, event: string, payload: unknown): Promise<AckAnswer> {
  return client.timeout(5000).emitWithAck(event, payload) as Promise<AckAnswer>;
}
function idOf(answer: AckAnswer): string {
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return String(answer.id);
}
/** An area put straight into the table, as one placed earlier. */
const stored = (authorId: string | null, extra: Record<string, unknown> = {}) =>
  prisma.mapArea.create({ data: { mapId: shownId, authorId, shape: 'sphere', anchorX: 100, anchorY: 100, sizeFt: 20, ...extra } });

type Seated = Record<keyof typeof ids, ClientSocket>;
async function seat(): Promise<Seated> {
  const [gm, p1, p2, spectator] = await Promise.all(
    (['gm', 'p1', 'p2', 'spectator'] as const).map((who) => server.connectAndAuth(cookies[who], campaignId))
  );
  return { gm, p1, p2, spectator };
}
const leave = (table: Seated) => Object.values(table).forEach((c) => c.disconnect());

beforeAll(async () => {
  const users = await Promise.all(
    (Object.keys(ids) as Array<keyof typeof ids>).map((who) => {
      emails[who] = `areas-${who}-${runId}@test.cozyvtt.local`;
      return createTestUser({ email: emails[who], displayName: `Area ${who}` });
    })
  );
  (Object.keys(ids) as Array<keyof typeof ids>).forEach((who, i) => { ids[who] = users[i].id; });
  campaignId = (await prisma.campaign.create({ data: { name: `Areas ${runId}`, ownerId: ids.gm, vibeSettings: {}, status: 'ACTIVE' } })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: ids.gm, campaignId, role: 'GM', characterIds: [] },
      { userId: ids.p1, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: ids.p2, campaignId, role: 'PLAYER', characterIds: [] },
      { userId: ids.spectator, campaignId, role: 'SPECTATOR', characterIds: [] },
    ],
  });
  shownId = (await prisma.map.create({
    data: { campaignId, name: 'Shown', imageUrl: '', baseLayerUrl: '', width: 10, height: 10, gridSize: 50, tokens: [], annotations: [] },
  })).id;
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: shownId } });
  server = await createWsTestServer();
  for (const who of Object.keys(ids) as Array<keyof typeof ids>) cookies[who] = await server.loginAs(ids[who]);
});

beforeEach(async () => {
  await prisma.mapArea.deleteMany({ where: { mapId: shownId } });
  await prisma.map.update({ where: { id: shownId }, data: { width: 10, height: 10, gridSize: 50 } });
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE', playersMayDraw: true } });
  await sleep(1100);
});

afterAll(async () => {
  await server?.close();
  await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
  await prisma.map.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { id: campaignId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

describe('area:add', () => {
  it("stores a player's cone as theirs and for everyone, and sends the same area to every seat", async () => {
    const table = await seat();
    const heard = (['gm', 'p1', 'p2', 'spectator'] as const).map((who) => waitForEvent<Record<string, unknown>>(table[who], 'area:added'));
    const answer = await ask(table.p1, 'area:add', { mapId: shownId, area: cone({ audience: 'GM' }), opId: 'op-1' });
    expect(answer).toEqual({ ok: true, id: expect.any(String), opId: 'op-1' });
    const id = idOf(answer);
    const events = await Promise.all(heard);
    for (const event of events) {
      expect(event).toEqual({
        mapId: shownId, opId: 'op-1',
        area: {
          id, authorId: ids.p1, audience: 'ALL', shape: 'cone', anchorX: 125, anchorY: 75, angle: 0.5, sizeFt: 15, widthFt: null,
          exact: false, element: 'fire', animated: true, label: 'Burning hands', spellId: null, createdAt: expect.any(String),
        },
      });
    }
    leave(table);
  });

  it('sends an area for the GM alone to the GM and to nobody else, and leaves it out of their lists', async () => {
    const table = await seat();
    const nothing = (['p1', 'p2', 'spectator'] as const).map((who) => expectNoEvent(table[who], 'area:added', 800));
    const gmHears = waitForEvent<{ area: { audience: string } }>(table.gm, 'area:added');
    expect((await ask(table.gm, 'area:add', { mapId: shownId, area: cone({ audience: 'GM' }) })).ok).toBe(true);
    expect((await gmHears).area.audience).toBe('GM');
    await Promise.all(nothing);
    await stored(ids.gm);
    const playerList = waitForEvent<{ areas: Array<{ audience: string }> }>(table.p1, 'areas:state');
    table.p1.emit('areas:request', { mapId: shownId });
    expect((await playerList).areas.map((a) => a.audience)).toEqual(['ALL']);
    const gmList = waitForEvent<{ areas: Array<{ audience: string }> }>(table.gm, 'areas:state');
    table.gm.emit('areas:request', { mapId: shownId });
    expect((await gmList).areas.map((a) => a.audience).sort()).toEqual(['ALL', 'GM']);
    leave(table);
  });

  it.each([
    ['PAUSED', true, DRAW_PAUSED_REFUSAL],
    ['ACTIVE', false, DRAW_SETTING_REFUSAL],
  ])('refuses a player while the campaign is %s with Players may draw %s', async (status, playersMayDraw, message) => {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: status as 'PAUSED', playersMayDraw } });
    const table = await seat();
    expect(await ask(table.p1, 'area:add', { mapId: shownId, area: cone() })).toEqual({ ok: false, error: message });
    expect(await ask(table.spectator, 'area:add', { mapId: shownId, area: cone() })).toEqual({ ok: false, error: DRAW_SPECTATOR_REFUSAL });
    expect((await ask(table.gm, 'area:add', { mapId: shownId, area: cone() })).ok).toBe(true);
    expect(await prisma.mapArea.count({ where: { mapId: shownId } })).toBe(1);
    leave(table);
  });

  it('refuses an area off the map, a width on a cone and an element it does not know', async () => {
    const gm = await server.connectAndAuth(cookies.gm, campaignId);
    expect(await ask(gm, 'area:add', { mapId: shownId, area: cone({ anchorX: 1e6 }) })).toEqual({ ok: false, error: AREA_OUTSIDE_MAP_MESSAGE });
    expect((await ask(gm, 'area:add', { mapId: shownId, area: cone({ widthFt: 5 }) })).ok).toBe(false);
    expect((await ask(gm, 'area:add', { mapId: shownId, area: cone({ element: 'plasma' }) })).ok).toBe(false);
    expect(await prisma.mapArea.count({ where: { mapId: shownId } })).toBe(0);
    gm.disconnect();
  });

  it("holds each share to its room: the players' full never stops the GM", async () => {
    await prisma.mapArea.createMany({
      data: Array.from({ length: AREA_LIMITS.perShare }, () => ({ mapId: shownId, authorId: ids.p2, shape: 'sphere', anchorX: 10, anchorY: 10, sizeFt: 5 })),
    });
    const table = await seat();
    expect(await ask(table.p1, 'area:add', { mapId: shownId, area: cone() })).toEqual({ ok: false, error: AREA_SHARE_FULL.PLAYERS });
    expect((await ask(table.gm, 'area:add', { mapId: shownId, area: cone() })).ok).toBe(true);
    leave(table);
  });

  it('takes 20 area:add a second from one user, and refuses the rest', async () => {
    const gm = await server.connectAndAuth(cookies.gm, campaignId);
    const answers = await Promise.all(Array.from({ length: 25 }, () => ask(gm, 'area:add', { mapId: shownId, area: cone() })));
    expect(answers.filter((a) => a.ok)).toHaveLength(20);
    expect(answers.find((a) => !a.ok)).toEqual({ ok: false, error: expect.stringContaining('Too many areas') });
    gm.disconnect();
  });
});

describe('area:remove and area:clear', () => {
  it("lets a player erase their own and not another's, and answers one for the GM alone as not there", async () => {
    const own = await stored(ids.p1);
    const others = await stored(ids.p2);
    const gmOnly = await stored(ids.gm, { audience: 'GM' });
    const table = await seat();
    const p2Hears = waitForEvent<{ areaId: string }>(table.p2, 'area:removed');
    expect((await ask(table.p1, 'area:remove', { mapId: shownId, areaId: own.id })).ok).toBe(true);
    expect((await p2Hears).areaId).toBe(own.id);
    expect(await ask(table.p1, 'area:remove', { mapId: shownId, areaId: others.id })).toEqual({ ok: false, error: ERASE_OTHERS_REFUSAL });
    expect(await ask(table.p1, 'area:remove', { mapId: shownId, areaId: gmOnly.id })).toEqual({ ok: false, error: 'Area not found' });
    expect(await ask(table.spectator, 'area:remove', { mapId: shownId, areaId: others.id })).toEqual({ ok: false, error: ERASE_SPECTATOR_REFUSAL });
    // The GM erases any; erasing one for the GM alone tells no player.
    const quiet = expectNoEvent(table.p1, 'area:removed', 600);
    expect((await ask(table.gm, 'area:remove', { mapId: shownId, areaId: gmOnly.id })).ok).toBe(true);
    await quiet;
    expect((await ask(table.gm, 'area:remove', { mapId: shownId, areaId: others.id })).ok).toBe(true);
    expect(await prisma.mapArea.count({ where: { mapId: shownId } })).toBe(0);
    leave(table);
  });

  it("clears a player's own alone, and the GM's clear every one", async () => {
    await stored(ids.p1);
    await stored(ids.p2);
    await stored(ids.gm, { audience: 'GM' });
    const table = await seat();
    const cleared = waitForEvent<{ authorId?: string }>(table.p2, 'areas:cleared');
    expect((await ask(table.p1, 'area:clear', { mapId: shownId })).ok).toBe(true);
    expect((await cleared).authorId).toBe(ids.p1);
    expect(await prisma.mapArea.count({ where: { mapId: shownId } })).toBe(2);
    expect(await ask(table.spectator, 'area:clear', { mapId: shownId })).toEqual({ ok: false, error: ERASE_SPECTATOR_REFUSAL });
    const all = waitForEvent<{ authorId?: string }>(table.p1, 'areas:cleared');
    expect((await ask(table.gm, 'area:clear', { mapId: shownId })).ok).toBe(true);
    expect((await all).authorId).toBeUndefined();
    expect(await prisma.mapArea.count({ where: { mapId: shownId } })).toBe(0);
    leave(table);
  });
});

describe('the REST read and a resize', () => {
  const app = createTestApp();
  const agent = async (who: keyof typeof ids) => {
    const a = request.agent(app);
    expect((await a.post('/api/auth/login').send({ email: emails[who], password: TEST_PASSWORD })).status).toBe(200);
    return a;
  };

  it('gives the GM every area and a player those for everyone', async () => {
    await stored(ids.gm, { audience: 'GM' });
    await stored(ids.p1);
    const gm = await agent('gm');
    const p1 = await agent('p1');
    const gmRead = await gm.get(`/api/campaigns/${campaignId}/maps/${shownId}/areas`);
    expect(gmRead.status).toBe(200);
    expect(gmRead.body.areas).toHaveLength(2);
    const playerRead = await p1.get(`/api/campaigns/${campaignId}/maps/${shownId}/areas`);
    expect(playerRead.body.areas.map((a: { audience: string }) => a.audience)).toEqual(['ALL']);
  });

  it('moves anchors with the map and keeps sizes in feet', async () => {
    const area = await stored(ids.gm, { anchorX: 100, anchorY: 50 });
    const gm = await agent('gm');
    const p1 = await server.connectAndAuth(cookies.p1, campaignId);
    const resent = waitForEvent<{ areas: Array<{ anchorX: number; anchorY: number; sizeFt: number }> }>(p1, 'areas:state');
    expect((await gm.put(`/api/campaigns/${campaignId}/maps/${shownId}`).send({ width: 20 })).status).toBe(200);
    expect((await resent).areas[0]).toMatchObject({ anchorX: 200, anchorY: 50, sizeFt: 20 });
    expect(await prisma.mapArea.findUniqueOrThrow({ where: { id: area.id } })).toMatchObject({ anchorX: 200, anchorY: 50, sizeFt: 20 });
    p1.disconnect();
  });
});
