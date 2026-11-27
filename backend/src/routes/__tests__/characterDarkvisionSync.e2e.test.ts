/**
 * The 5E sheet's darkvision on the character's tokens — End-to-End Tests
 *
 * A token's `sightRadius` decides what the server sends its player, so the
 * token route keeps it GM-only. The character route is open to the owner,
 * a player, which makes it the one path round that rule: these pin that a
 * player's sheet save never writes a token's sight, and that a GM's save
 * applies a changed value, in each map's own squares, only in campaigns that
 * GM runs, and only when the value changed.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import request from 'supertest';

// The map re-send is captured rather than delivered: these route tests run
// with no Socket.io server attached. Named `mock*` for Jest's hoisting.
const mockMapResends: Array<{ campaignId: string; mapId: string }> = [];

jest.mock('../../websocket/utils', () => ({
  ...jest.requireActual('../../websocket/utils'),
  getSocketInstance: jest.fn(() => ({})),
  broadcastToCampaign: jest.fn(),
  emitCharacterUpdated: jest.fn(async () => undefined),
}));
jest.mock('../../websocket/shared', () => ({
  ...jest.requireActual('../../websocket/shared'),
  broadcastMapData: jest.fn(async (_io: unknown, campaignId: string, map: { id: string }) => {
    mockMapResends.push({ campaignId, mapId: map.id });
  }),
}));

import { createTestApp } from '../../__tests__/helpers/test-app';
import {
  prisma,
  createTestUser,
  createTestCampaign,
  cleanupUsers,
  cleanupCampaigns,
  TEST_PASSWORD,
} from '../../__tests__/helpers/db';

const app = createTestApp();

/** A minimal but schema-valid 5E sheet. */
const sheet = (extra: Record<string, unknown> = {}) => ({
  characterName: 'Wren Ashdown',
  class: 'Rogue',
  level: 3,
  race: 'Elf',
  proficiencyBonus: 2,
  stats: {
    strength: { score: 10, modifier: 0 },
    dexterity: { score: 16, modifier: 3 },
    constitution: { score: 12, modifier: 1 },
    intelligence: { score: 12, modifier: 1 },
    wisdom: { score: 10, modifier: 0 },
    charisma: { score: 8, modifier: -1 },
  },
  ...extra,
});

const OLD_IMAGE = '/api/assets/tokens/00000000-0000-4000-8000-00000000e01d';
const NEW_IMAGE = '/api/assets/tokens/00000000-0000-4000-8000-00000000f3e7';
// Not what any darkvision converts to, so an untouched token is told apart.
const MANUAL_SIGHT = 3;

describe('the 5E sheet\'s darkvision on the character\'s tokens', () => {
  const userIds: string[] = [];
  const campaignIds: string[] = [];
  let characterId: string;
  let playerId: string;
  let fivePerSquare: string;
  let tenPerSquare: string;
  let otherCampaignMap: string;
  let gm: ReturnType<typeof request.agent>;
  let player: ReturnType<typeof request.agent>;

  const boundToken = () => ({
    id: `bound-${characterId}`, characterId, name: 'Wren', imageUrl: OLD_IMAGE,
    position: { x: 1, y: 1 }, size: { width: 1, height: 1 }, layer: 'token', visible: true,
    controlledBy: playerId, rotation: 0, conditions: [], metadata: {}, type: 'player', disposition: null,
    hp: null, showHpBar: false, notes: '', sightRadius: MANUAL_SIGHT,
  });
  const tokenOn = async (mapId: string) => {
    const map = await prisma.map.findUniqueOrThrow({ where: { id: mapId }, select: { tokens: true } });
    return (map.tokens as unknown as Array<{ characterId: string; imageUrl: string; sightRadius?: number }>)
      .find((t) => t.characterId === characterId)!;
  };
  const storedDarkvision = async () =>
    ((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).data as { darkvisionFeet?: number }).darkvisionFeet;

  beforeAll(async () => {
    const stamp = Date.now();
    const [gmA, gmB, owner] = await Promise.all([
      createTestUser({ email: `dv_dma_${stamp}@test.invalid` }),
      createTestUser({ email: `dv_dmb_${stamp}@test.invalid` }),
      createTestUser({ email: `dv_pl_${stamp}@test.invalid` }),
    ]);
    userIds.push(gmA.id, gmB.id, owner.id);
    playerId = owner.id;
    const a = await createTestCampaign(gmA.id, { name: `Darkvision A ${stamp}` });
    const b = await createTestCampaign(gmB.id, { name: `Darkvision B ${stamp}` });
    campaignIds.push(a.id, b.id);
    await prisma.campaignMembership.createMany({
      data: [
        { campaignId: a.id, userId: gmA.id, role: 'GM', characterIds: [] },
        { campaignId: a.id, userId: owner.id, role: 'PLAYER', characterIds: [] },
        { campaignId: b.id, userId: gmB.id, role: 'GM', characterIds: [] },
        { campaignId: b.id, userId: owner.id, role: 'PLAYER', characterIds: [] },
      ],
    });
    characterId = (await prisma.character.create({
      data: { userId: owner.id, campaignId: a.id, name: 'Wren', gameSystem: 'FIFTH_EDITION', tokenImageUrl: OLD_IMAGE, data: sheet() },
    })).id;
    const mapIn = async (campaignId: string, name: string, feetPerSquare: number) => (await prisma.map.create({
      data: {
        campaignId, name, imageUrl: '/uploads/maps/m.png', baseLayerUrl: '/uploads/maps/m.png',
        width: 20, height: 20, feetPerSquare, tokens: [], annotations: [],
      },
    })).id;
    fivePerSquare = await mapIn(a.id, 'Five feet', 5);
    tenPerSquare = await mapIn(a.id, 'Ten feet', 10);
    otherCampaignMap = await mapIn(b.id, 'Elsewhere', 5);

    gm = request.agent(app);
    expect((await gm.post('/api/auth/login').send({ email: `dv_dma_${stamp}@test.invalid`, password: TEST_PASSWORD })).status).toBe(200);
    player = request.agent(app);
    expect((await player.post('/api/auth/login').send({ email: `dv_pl_${stamp}@test.invalid`, password: TEST_PASSWORD })).status).toBe(200);
  });

  beforeEach(async () => {
    mockMapResends.length = 0;
    await prisma.character.update({ where: { id: characterId }, data: { data: sheet(), tokenImageUrl: OLD_IMAGE } });
    for (const mapId of [fivePerSquare, tenPerSquare, otherCampaignMap]) {
      await prisma.map.update({ where: { id: mapId }, data: { tokens: [boundToken()] } });
    }
  });

  afterAll(async () => {
    await prisma.character.deleteMany({ where: { id: characterId } });
    await prisma.map.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await cleanupCampaigns(campaignIds);
    await cleanupUsers(userIds);
  });

  it('a player\'s change is stored on the sheet and leaves every token\'s sight alone', async () => {
    const res = await player.put(`/api/characters/${characterId}`).send({ data: sheet({ darkvisionFeet: 60 }) });
    expect(res.status).toBe(200);

    expect(await storedDarkvision()).toBe(60);
    for (const mapId of [fivePerSquare, tenPerSquare, otherCampaignMap]) {
      expect((await tokenOn(mapId)).sightRadius).toBe(MANUAL_SIGHT);
    }
    expect(mockMapResends).toEqual([]);
  });

  it('a GM\'s change sets the sight in each map\'s own squares and re-sends those maps', async () => {
    const res = await gm.put(`/api/characters/${characterId}`).send({ data: sheet({ darkvisionFeet: 60 }) });
    expect(res.status).toBe(200);

    expect((await tokenOn(fivePerSquare)).sightRadius).toBe(12);
    expect((await tokenOn(tenPerSquare)).sightRadius).toBe(6);
    expect(mockMapResends.map((r) => r.mapId).sort()).toEqual([fivePerSquare, tenPerSquare].sort());
  });

  it('a GM\'s change leaves a token in a campaign that GM does not run alone', async () => {
    await gm.put(`/api/characters/${characterId}`).send({ data: sheet({ darkvisionFeet: 60 }) });

    expect((await tokenOn(otherCampaignMap)).sightRadius).toBe(MANUAL_SIGHT);
    expect(mockMapResends.map((r) => r.mapId)).not.toContain(otherCampaignMap);
  });

  it('a GM\'s save that does not change the value leaves a token\'s own sight alone', async () => {
    await prisma.character.update({ where: { id: characterId }, data: { data: sheet({ darkvisionFeet: 60 }) } });

    const res = await gm.put(`/api/characters/${characterId}`).send({ data: sheet({ darkvisionFeet: 60, speed: 35 }) });
    expect(res.status).toBe(200);

    expect((await tokenOn(fivePerSquare)).sightRadius).toBe(MANUAL_SIGHT);
    expect(mockMapResends).toEqual([]);
  });

  it('a player\'s new picture still repaints the token when the same save changes darkvision', async () => {
    const res = await player.put(`/api/characters/${characterId}`)
      .send({ data: sheet({ darkvisionFeet: 120 }), tokenImageUrl: NEW_IMAGE });
    expect(res.status).toBe(200);

    const token = await tokenOn(fivePerSquare);
    expect(token.imageUrl).toBe(NEW_IMAGE);
    expect(token.sightRadius).toBe(MANUAL_SIGHT);
  });
});
