/**
 * The Spell Library's routes: who may import the SRD spells and write the
 * instance's own (an administrator), who may write a campaign's own (its
 * GM), and what a campaign's members read: the SRD's, the instance's and
 * their campaign's spells, never another campaign's.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';

const app = createTestApp();
const run = randomUUID().slice(0, 8);
const users: string[] = [];
const campaigns: string[] = [];

async function signIn(role: 'ADMIN' | 'USER' = 'USER'): Promise<{ id: string; agent: request.Agent }> {
  const user = await createTestUser({ role, displayName: `Spell ${role}` });
  users.push(user.id);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
  return { id: user.id, agent };
}

async function campaignOf(gmId: string): Promise<string> {
  const campaign = await createTestCampaign(gmId);
  campaigns.push(campaign.id);
  await prisma.campaignMembership.create({ data: { userId: gmId, campaignId: campaign.id, role: 'GM', characterIds: [] } });
  return campaign.id;
}

async function join(userId: string, campaignId: string, role: 'PLAYER' | 'SPECTATOR' = 'PLAYER') {
  await prisma.campaignMembership.create({ data: { userId, campaignId, role, characterIds: [] } });
}

/** One page of Open5e's v1 spells, each named for this run. */
const page = (spells: Array<{ name: string; desc: string; range?: string }>) =>
  new Response(JSON.stringify({
    count: spells.length,
    next: null,
    results: spells.map((s) => ({
      name: `${s.name} ${run}`, desc: s.desc, higher_level: '', range: s.range ?? '150 feet', components: 'V, S, M',
      material: 'A tiny ball of bat guano and sulfur.', ritual: 'no', can_be_cast_as_ritual: false, duration: 'Instantaneous',
      concentration: 'no', requires_concentration: false, casting_time: '1 action', level_int: 3, school: 'Evocation',
    })),
  }), { status: 200 });

const SRD_PAGE = () => page([
  { name: 'Fireball', desc: 'Each creature in a 20-foot-radius sphere centered on that point must make a dexterity saving throw. A target takes 8d6 fire damage on a failed save.' },
  { name: 'Cone of Cold', range: 'Self', desc: 'Each creature in a 60-foot cone must make a constitution saving throw. A creature takes 8d8 cold damage on a failed save.' },
  { name: 'Magic Missile', desc: 'A dart deals 1d4 + 1 force damage to its target.' },
]);

let admin: { id: string; agent: request.Agent };
let gm: { id: string; agent: request.Agent };
let player: { id: string; agent: request.Agent };
let otherGm: { id: string; agent: request.Agent };
let campaignId: string;
let otherCampaignId: string;

beforeAll(async () => {
  admin = await signIn('ADMIN');
  gm = await signIn();
  player = await signIn();
  otherGm = await signIn();
  campaignId = await campaignOf(gm.id);
  otherCampaignId = await campaignOf(otherGm.id);
  await join(player.id, campaignId);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await prisma.spellTemplate.deleteMany({ where: { name: { endsWith: run } } });
  await cleanupCampaigns(campaigns);
  await cleanupUsers(users);
  await prisma.$disconnect();
});

describe('POST /api/spells/seed', () => {
  it('refuses a user who is not an administrator, and fetches nothing', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const res = await gm.agent.post('/api/spells/seed');
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect((await request(app).post('/api/spells/seed')).status).toBe(401);
  });

  it('imports the SRD spells with their areas, and a second import adds none', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(SRD_PAGE()).mockResolvedValueOnce(SRD_PAGE());
    const mine = { source: 'srd', name: { endsWith: run } };

    const first = await admin.agent.post('/api/spells/seed');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ fetched: 3, created: 3, updated: 0, rejected: 0 });
    const fireball = await prisma.spellTemplate.findFirstOrThrow({ where: { ...mine, name: `Fireball ${run}` } });
    expect(fireball).toMatchObject({
      level: 3, school: 'Evocation', area: { shape: 'sphere', sizeFt: 20 }, element: 'fire', campaignId: null, createdById: null,
      components: 'V, S, M (A tiny ball of bat guano and sulfur)',
    });
    expect(await prisma.spellTemplate.findFirstOrThrow({ where: { ...mine, name: `Cone of Cold ${run}` } }))
      .toMatchObject({ area: { shape: 'cone', sizeFt: 60 }, element: 'cold' });
    // No area, so no look either.
    expect(await prisma.spellTemplate.findFirstOrThrow({ where: { ...mine, name: `Magic Missile ${run}` } }))
      .toMatchObject({ area: null, element: 'none' });

    const second = await admin.agent.post('/api/spells/seed');
    expect(second.body).toMatchObject({ fetched: 3, created: 0, updated: 3 });
    expect(await prisma.spellTemplate.count({ where: mine })).toBe(3);
  });

  it('answers 502, having written nothing, when Open5e cannot be read', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 503, statusText: 'Service Unavailable' }));
    const res = await admin.agent.post('/api/spells/seed');
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/api\.open5e\.com answered 503/);
  });

  it('says how many SRD spells there are, and whether the caller may import them', async () => {
    const asGm = await gm.agent.get('/api/spells/seed/status');
    expect(asGm.status).toBe(200);
    expect(asGm.body).toMatchObject({ seedInProgress: false, canSeed: false });
    expect(asGm.body.srdCount).toBeGreaterThanOrEqual(3);
    expect((await admin.agent.get('/api/spells/seed/status')).body.canSeed).toBe(true);
    expect((await request(app).get('/api/spells/seed/status')).status).toBe(401);
  });
});

describe('the instance\'s own spells, /api/spells', () => {
  it('are an administrator\'s to add, change and delete', async () => {
    const made = await admin.agent.post('/api/spells').send({
      name: `Ember Rain ${run}`, level: 2, area: { shape: 'cylinder', sizeFt: 10 }, element: 'fire', description: 'Embers fall.',
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ source: 'custom', campaignId: null, createdById: admin.id });

    for (const agent of [gm.agent, player.agent]) {
      expect((await agent.post('/api/spells').send({ name: `Nope ${run}`, level: 1 })).status).toBe(403);
      expect((await agent.put(`/api/spells/${made.body.id}`).send({ level: 3 })).status).toBe(403);
      expect((await agent.delete(`/api/spells/${made.body.id}`)).status).toBe(403);
    }

    const changed = await admin.agent.put(`/api/spells/${made.body.id}`).send({ area: null, element: 'none' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ area: null, element: 'none', level: 2 });
    expect((await admin.agent.delete(`/api/spells/${made.body.id}`)).status).toBe(200);
    expect(await prisma.spellTemplate.findUnique({ where: { id: made.body.id } })).toBeNull();
  });

  it('never reach an SRD spell or a campaign\'s', async () => {
    const srd = await prisma.spellTemplate.findFirstOrThrow({ where: { source: 'srd', name: `Fireball ${run}` } });
    const theirs = await gm.agent.post(`/api/campaigns/${campaignId}/spells`).send({ name: `Hex Bolt ${run}`, level: 1 });
    for (const id of [srd.id, theirs.body.id]) {
      expect((await admin.agent.put(`/api/spells/${id}`).send({ level: 9 })).status).toBe(404);
      expect((await admin.agent.delete(`/api/spells/${id}`)).status).toBe(404);
    }
    expect((await prisma.spellTemplate.findUniqueOrThrow({ where: { id: srd.id } })).level).toBe(3);
  });

  it('refuses an area the map could not draw, and a second spell of the same name', async () => {
    const bad = await admin.agent.post('/api/spells').send({ name: `Too Wide ${run}`, level: 1, area: { shape: 'cone', sizeFt: 15, widthFt: 5 } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/Only a line has a width/);
    expect((await admin.agent.post('/api/spells').send({ name: `Twin ${run}`, level: 1 })).status).toBe(201);
    expect((await admin.agent.post('/api/spells').send({ name: `TWIN ${run}`, level: 1 })).status).toBe(409);
  });
});

describe('a campaign\'s spells, /api/campaigns/:campaignId/spells', () => {
  let spellId: string;

  it('are its GM\'s to add, change and delete; a player only reads', async () => {
    const made = await gm.agent.post(`/api/campaigns/${campaignId}/spells`).send({
      name: `Fireball ${run}`, level: 3, area: { shape: 'sphere', sizeFt: 30 }, element: 'water', description: 'Our table\'s bigger one.',
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ campaignId, source: 'custom', createdById: gm.id });
    spellId = made.body.id;

    expect((await player.agent.post(`/api/campaigns/${campaignId}/spells`).send({ name: `Mine ${run}`, level: 1 })).status).toBe(403);
    expect((await player.agent.put(`/api/campaigns/${campaignId}/spells/${spellId}`).send({ level: 1 })).status).toBe(403);
    expect((await player.agent.delete(`/api/campaigns/${campaignId}/spells/${spellId}`)).status).toBe(403);

    expect((await gm.agent.put(`/api/campaigns/${campaignId}/spells/${spellId}`).send({ element: 'fire' })).body.element).toBe('fire');
  });

  it('list the SRD\'s, the instance\'s and the campaign\'s spells to a player, without descriptions, and one in full', async () => {
    const instance = await admin.agent.post('/api/spells').send({ name: `Fireball ${run}`, level: 3, area: { shape: 'sphere', sizeFt: 25 } });
    const list = await player.agent.get(`/api/campaigns/${campaignId}/spells`);
    expect(list.status).toBe(200);
    const fireballs = list.body.spells.filter((s: { name: string }) => s.name === `Fireball ${run}`);
    // The SRD's, the instance's and the campaign's: all three, each with its source.
    expect(fireballs.map((s: { source: string; campaignId: string | null }) => [s.source, s.campaignId]).sort()).toEqual(
      [['custom', campaignId], ['custom', null], ['srd', null]].sort()
    );
    expect(list.body.spells.every((s: Record<string, unknown>) => !('description' in s))).toBe(true);

    const one = await player.agent.get(`/api/campaigns/${campaignId}/spells/${spellId}`);
    expect(one.status).toBe(200);
    expect(one.body.description).toBe('Our table\'s bigger one.');
    await admin.agent.delete(`/api/spells/${instance.body.id}`);
  });

  it('never reach another campaign: its GM cannot read, change or delete them, nor see them listed', async () => {
    const list = await otherGm.agent.get(`/api/campaigns/${otherCampaignId}/spells`);
    expect(list.body.spells.some((s: { id: string }) => s.id === spellId)).toBe(false);
    expect(list.body.spells.some((s: { campaignId: string | null }) => s.campaignId === campaignId)).toBe(false);
    expect((await otherGm.agent.get(`/api/campaigns/${otherCampaignId}/spells/${spellId}`)).status).toBe(404);
    expect((await otherGm.agent.put(`/api/campaigns/${otherCampaignId}/spells/${spellId}`).send({ level: 9 })).status).toBe(404);
    expect((await otherGm.agent.delete(`/api/campaigns/${otherCampaignId}/spells/${spellId}`)).status).toBe(404);
    // Nor through the campaign's own address, of which they are no member.
    expect((await otherGm.agent.get(`/api/campaigns/${campaignId}/spells`)).status).toBe(403);
    expect(await prisma.spellTemplate.findUnique({ where: { id: spellId } })).not.toBeNull();
  });

  it('never let the GM change an SRD spell through the campaign', async () => {
    const srd = await prisma.spellTemplate.findFirstOrThrow({ where: { source: 'srd', name: `Fireball ${run}` } });
    expect((await gm.agent.put(`/api/campaigns/${campaignId}/spells/${srd.id}`).send({ level: 9 })).status).toBe(404);
    expect((await gm.agent.delete(`/api/campaigns/${campaignId}/spells/${srd.id}`)).status).toBe(404);
    expect((await gm.agent.get(`/api/campaigns/${campaignId}/spells/${srd.id}`)).status).toBe(200);
  });
});
