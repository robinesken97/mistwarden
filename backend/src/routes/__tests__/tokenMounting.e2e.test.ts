/**
 * A rider on a mount, through the token routes — End-to-End Tests
 *
 * The rights rule: a coupling never lets a player move a token they do not
 * control unless the GM made it. The GM couples any two tokens; a player
 * only two they control, and may always get their own rider off. The pair
 * moves as one whichever is moved, the move judged on the moved token alone.
 * A player is told a rider's mount only if they are sent the mount. Every
 * write that splits a pair lets go of the coupling in the same write.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { readTokens } from '../../utils/prisma-json';
import type { Token } from '../../websocket/shared';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';

const app = createTestApp();

function token(id: string, extra: Partial<Token> = {}): Token {
  return {
    id, name: id, imageUrl: '', position: { x: 1, y: 1 }, size: { width: 1, height: 1 }, layer: 'token',
    visible: true, controlledBy: null, rotation: 0, conditions: [], metadata: {}, ...extra,
  };
}

describe('mounting a token on another', () => {
  let gmId: string;
  let playerId: string;
  let campaignId: string;
  let mapId: string;
  let otherMapId: string;
  let gm: ReturnType<typeof request.agent>;
  let player: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const gmUser = await createTestUser({ displayName: 'Mounting GM' });
    gmId = gmUser.id;
    const campaign = await createTestCampaign(gmId, { name: 'Mounting' });
    campaignId = campaign.id;
    const playerUser = await createTestUser({ displayName: 'Mounting Player' });
    playerId = playerUser.id;
    await prisma.campaignMembership.createMany({
      data: [
        { userId: gmId, campaignId, role: 'GM', characterIds: [] },
        { userId: playerId, campaignId, role: 'PLAYER', characterIds: [] },
      ],
    });
    gm = request.agent(app);
    await gm.post('/api/auth/login').send({ email: gmUser.email, password: TEST_PASSWORD });
    player = request.agent(app);
    await player.post('/api/auth/login').send({ email: playerUser.email, password: TEST_PASSWORD });

    const make = (name: string) => prisma.map.create({
      data: {
        campaignId, name, imageUrl: '/api/assets/maps/placeholder', baseLayerUrl: '/api/assets/maps/placeholder',
        width: 10, height: 10, gridSize: 50, tokens: [], annotations: [],
      },
    });
    mapId = (await make('Mounting Map')).id;
    otherMapId = (await make('Mounting Other Map')).id;
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: mapId, status: 'ACTIVE' } });
  });

  afterAll(async () => {
    await prisma.campaign.update({ where: { id: campaignId }, data: { currentMapId: null } });
    await prisma.map.deleteMany({ where: { campaignId } });
    await cleanupCampaigns([campaignId]);
    await cleanupUsers([gmId, playerId]);
    await prisma.$disconnect();
  });

  /** The horse is the GM's, the rider and the pony the player's, the wolf nobody's. */
  beforeEach(async () => {
    await prisma.map.update({
      where: { id: mapId },
      data: {
        tokens: [
          token('rider', { controlledBy: playerId, position: { x: 5, y: 5 } }),
          token('horse', { position: { x: 2, y: 2 }, size: { width: 2, height: 2 } }),
          token('pony', { controlledBy: playerId, position: { x: 7, y: 7 } }),
          token('wolf', { position: { x: 0, y: 0 } }),
        ] as never,
      },
    });
    await prisma.map.update({ where: { id: otherMapId }, data: { tokens: [] } });
  });

  const put = (agent: ReturnType<typeof request.agent>, tokenId: string, body: Record<string, unknown>) =>
    agent.put(`/api/campaigns/${campaignId}/maps/${mapId}/tokens/${tokenId}`).send(body);
  const stored = async (id = mapId) => {
    const map = await prisma.map.findUniqueOrThrow({ where: { id } });
    return readTokens(map.tokens);
  };
  const byId = async (tokenId: string, id = mapId) => (await stored(id)).find((t) => t.id === tokenId);

  describe('who may couple', () => {
    it('refuses a player putting their token on one they do not control', async () => {
      const res = await put(player, 'rider', { mountedOn: 'horse' });
      expect(res.status).toBe(403);
      expect((await byId('rider'))?.mountedOn ?? null).toBeNull();
    });

    it('answers a player naming a token that is not there exactly as one that is not theirs', async () => {
      const missing = await put(player, 'rider', { mountedOn: 'no-such-token' });
      const foreign = await put(player, 'rider', { mountedOn: 'horse' });
      expect([missing.status, missing.body.message]).toEqual([foreign.status, foreign.body.message]);
    });

    it('refuses a player coupling a token they do not control onto their own', async () => {
      expect((await put(player, 'wolf', { mountedOn: 'pony' })).status).toBe(403);
    });

    it('lets a player couple two tokens they control: the rider is put on the mount and drawn after it', async () => {
      const res = await put(player, 'rider', { mountedOn: 'pony' });
      expect(res.status).toBe(200);
      expect(res.body.token).toMatchObject({ mountedOn: 'pony', position: { x: 7, y: 7 } });
      expect((await stored()).map((t) => t.id)).toEqual(['horse', 'pony', 'rider', 'wolf']);
    });

    it('lets the GM couple any two tokens', async () => {
      const res = await put(gm, 'rider', { mountedOn: 'horse' });
      expect(res.status).toBe(200);
      expect(await byId('rider')).toMatchObject({ mountedOn: 'horse', position: { x: 2, y: 2 } });
    });

    it('lets a player take their rider off a mount the GM chose', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      const res = await put(player, 'rider', { mountedOn: null });
      expect(res.status).toBe(200);
      expect((await byId('rider'))?.mountedOn).toBeNull();
    });

    it('refuses a second level: a rider as a mount, or a mount as a rider', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      expect((await put(gm, 'wolf', { mountedOn: 'rider' })).status).toBe(400);
      expect((await put(gm, 'horse', { mountedOn: 'wolf' })).status).toBe(400);
    });
  });

  describe('moving the pair', () => {
    it('moves a GM-coupled horse when the player drags their own rider', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      const res = await put(player, 'rider', { position: { x: 4, y: 3 } });
      expect(res.status).toBe(200);
      expect((await byId('horse'))?.position).toEqual({ x: 4, y: 3 });
      expect((await byId('rider'))?.position).toEqual({ x: 4, y: 3 });
    });

    it('still refuses the player dragging the horse itself', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      expect((await put(player, 'horse', { position: { x: 4, y: 3 } })).status).toBe(403);
    });

    it('stops the pair as one at the map edge', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      await put(player, 'rider', { position: { x: 9, y: 9 } });
      expect((await byId('horse'))?.position).toEqual({ x: 8, y: 8 });
      expect((await byId('rider'))?.position).toEqual({ x: 8, y: 8 });
    });
  });

  describe('what a player is sent', () => {
    it('names a hidden mount to nobody but the GM, and still sends its rider', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      await put(gm, 'horse', { visible: false });
      const res = await player.get(`/api/campaigns/${campaignId}/maps/${mapId}`);
      const tokens = res.body.map.tokens as Token[];
      expect(tokens.find((t) => t.id === 'horse')).toBeUndefined();
      const sentRider = tokens.find((t) => t.id === 'rider');
      expect(sentRider).toBeDefined();
      expect(sentRider).not.toHaveProperty('mountedOn');
      expect((await put(player, 'rider', { rotation: 90 })).body.token).not.toHaveProperty('mountedOn');
    });

    it('names a visible mount', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      const res = await player.get(`/api/campaigns/${campaignId}/maps/${mapId}`);
      expect((res.body.map.tokens as Token[]).find((t) => t.id === 'rider')?.mountedOn).toBe('horse');
    });
  });

  describe('letting go', () => {
    it('lets the riders off when their mount is deleted', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      expect((await gm.delete(`/api/campaigns/${campaignId}/maps/${mapId}/tokens/horse`)).status).toBe(200);
      expect((await byId('rider'))?.mountedOn).toBeNull();
    });

    it('lets go when only one of the pair moves to another map, on both maps', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      await put(gm, 'wolf', { mountedOn: 'pony' });
      await gm.post(`/api/campaigns/${campaignId}/maps/${mapId}/tokens/move`).send({ tokenIds: ['horse', 'wolf'], targetMapId: otherMapId });
      expect((await byId('rider'))?.mountedOn).toBeNull();
      expect((await byId('wolf', otherMapId))?.mountedOn).toBeNull();
    });

    it('keeps the pair when both move to another map', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      await gm.post(`/api/campaigns/${campaignId}/maps/${mapId}/tokens/move`).send({ tokenIds: ['horse', 'rider'], targetMapId: otherMapId });
      expect((await byId('rider', otherMapId))?.mountedOn).toBe('horse');
    });

    it('lets go when either crosses to the other plane', async () => {
      await put(gm, 'rider', { mountedOn: 'horse' });
      await put(gm, 'horse', { layer: 'spirit' });
      expect((await byId('rider'))?.mountedOn).toBeNull();
    });

    it('lets go when either gets a new controller, so a player-made pair cannot hand over a token', async () => {
      await put(player, 'rider', { mountedOn: 'pony' });
      await put(gm, 'pony', { controlledBy: null });
      expect((await byId('rider'))?.mountedOn).toBeNull();
      await put(player, 'rider', { position: { x: 0, y: 9 } });
      expect((await byId('pony'))?.position).toEqual({ x: 7, y: 7 });
    });

    it('never stores a rider on a duplicate placed through the create route', async () => {
      const res = await gm.post(`/api/campaigns/${campaignId}/maps/${mapId}/tokens`).send({ name: 'Copy', position: { x: 1, y: 1 }, mountedOn: 'horse' });
      expect(res.status).toBe(201);
      expect(res.body.token.mountedOn).toBeUndefined();
    });
  });
});
