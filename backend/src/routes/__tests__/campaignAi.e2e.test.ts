// Added for Mistwarden on 2026-11-27.
/**
 * A GM's writing help: only the GM asks, only the server talks to the
 * provider, and what it sends is the GM's request and the campaign's name.
 * A local stand-in answers as Anthropic's Messages API or as an
 * OpenAI-compatible chat endpoint; nothing leaves the machine.
 *
 * Requires PostgreSQL at DATABASE_URL.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { createTestApp } from '../../__tests__/helpers/test-app';
import { prisma, createTestUser, createTestCampaign, cleanupUsers, cleanupCampaigns, TEST_PASSWORD } from '../../__tests__/helpers/db';

const app = createTestApp();
const KEY = 'sk-test-not-a-real-key-0123456789';

interface Seen { path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }
let seen: Seen[] = [];
let answer: (path: string) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
let provider: http.Server;
let base: string;

let campaignId: string;
const ids: string[] = [];
let gm: ReturnType<typeof request.agent>;
let player: ReturnType<typeof request.agent>;

beforeAll(async () => {
  provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : {} });
      const { status, body } = answer(req.url ?? '');
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  const stamp = Date.now();
  const gmUser = await createTestUser({ email: `ai-gm-${stamp}@test.cozyvtt.local`, displayName: 'Secret GM Name' });
  const playerUser = await createTestUser({ email: `ai-player-${stamp}@test.cozyvtt.local`, displayName: 'Secret Player Name' });
  ids.push(gmUser.id, playerUser.id);
  campaignId = (await createTestCampaign(gmUser.id, { name: `Mistvale ${stamp}` })).id;
  await prisma.campaignMembership.createMany({
    data: [
      { userId: gmUser.id, campaignId, role: 'GM', characterIds: [] },
      { userId: playerUser.id, campaignId, role: 'PLAYER', characterIds: [] },
    ],
  });
  gm = request.agent(app);
  player = request.agent(app);
  expect((await gm.post('/api/auth/login').send({ email: gmUser.email, password: TEST_PASSWORD })).status).toBe(200);
  expect((await player.post('/api/auth/login').send({ email: playerUser.email, password: TEST_PASSWORD })).status).toBe(200);
});

afterAll(async () => {
  await cleanupCampaigns([campaignId]);
  await cleanupUsers(ids);
  await prisma.$disconnect();
  await new Promise((resolve) => provider.close(resolve));
});

beforeEach(() => {
  seen = [];
  for (const name of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL']) delete process.env[name];
});

const write = (agent: ReturnType<typeof request.agent>, body: object) => agent.post(`/api/campaigns/${campaignId}/ai/write`).send(body);

describe('writing help without a provider', () => {
  it('is off in the public config and refused with 503', async () => {
    expect((await request(app).get('/api/config')).body.ai).toEqual({ enabled: false });
    const res = await write(gm, { kind: 'npc', prompt: 'A nervous innkeeper' });
    expect(res.status).toBe(503);
    expect(seen).toEqual([]);
  });
});

describe('writing help through Anthropic', () => {
  beforeEach(() => {
    Object.assign(process.env, { AI_PROVIDER: 'anthropic', AI_API_KEY: KEY, AI_BASE_URL: base });
    answer = () => ({
      status: 200,
      body: {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'Oswin looks tired.' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
  });

  it('answers the GM with the text, sending only the request and the campaign', async () => {
    expect((await request(app).get('/api/config')).body.ai).toEqual({ enabled: true });
    const res = await write(gm, { kind: 'npc', prompt: 'A tired nobleman' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'Oswin looks tired.' });
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toContain('/v1/messages');
    expect(seen[0].headers.authorization ?? seen[0].headers['x-api-key']).toMatch(KEY);
    expect(seen[0].body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', messages: [{ role: 'user', content: 'A tired nobleman' }] });
    const sent = JSON.stringify(seen[0].body);
    expect(sent).toContain('Mistvale');
    expect(sent).not.toMatch(/Secret (GM|Player) Name/);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  // Mistwarden, 2026-11-28: the answer is a preview. Nothing is kept until
  // the GM saves the text, edited or not, as a note of their own.
  it('keeps nothing, and the text the GM saves becomes their private note', async () => {
    const notes = () => prisma.personalNote.count({ where: { campaignId } });
    const before = await notes();
    const res = await write(gm, { kind: 'npc', prompt: 'A tired nobleman' });
    expect(res.status).toBe(200);
    expect(await notes()).toBe(before);

    const saved = await gm.post(`/api/campaigns/${campaignId}/notes`).send({ title: 'NPC: A tired nobleman', content: `${res.body.text} He hides a letter.` });
    expect(saved.status).toBe(201);
    expect(saved.body.note).toMatchObject({ title: 'NPC: A tired nobleman', content: 'Oswin looks tired. He hides a letter.' });
    expect(await notes()).toBe(before + 1);
    // The GM's alone: the player's list does not hold it.
    const listed = await player.get(`/api/campaigns/${campaignId}/notes`);
    expect(listed.status).toBe(200);
    expect(listed.body.notes.map((n: { id: string }) => n.id)).not.toContain(saved.body.note.id);
  });

  it('refuses a player', async () => {
    expect((await write(player, { kind: 'npc', prompt: 'Spoil it' })).status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('refuses an empty or unknown request', async () => {
    expect((await write(gm, { kind: 'npc', prompt: '   ' })).status).toBe(400);
    expect((await write(gm, { kind: 'poem', prompt: 'x' })).status).toBe(400);
    expect((await write(gm, { kind: 'npc', prompt: 'x', model: 'other' })).status).toBe(400);
  });

  it('says so when the model declines, and when the provider fails, without the key', async () => {
    answer = () => ({ status: 200, body: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    const declined = await write(gm, { kind: 'note', prompt: 'x' });
    expect(declined.status).toBe(502);
    expect(declined.body.message).toMatch(/declined/);

    answer = () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `bad key ${KEY}` } } });
    const failed = await write(gm, { kind: 'note', prompt: 'x' });
    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).not.toContain(KEY);
  });
});

describe('writing help through an OpenAI-compatible server', () => {
  beforeEach(() => {
    Object.assign(process.env, { AI_PROVIDER: 'openai', AI_MODEL: 'qwen-local', AI_BASE_URL: `${base}/v1/` });
    answer = () => ({ status: 200, body: { choices: [{ message: { content: '<think>plan</think>\nThe mist parts.' } }] } });
  });

  it('answers with the text, its reasoning removed, and sends no key when none is set', async () => {
    const res = await write(gm, { kind: 'read-aloud', prompt: 'The gates of Mistvale' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'The mist parts.' });
    expect(seen[0].path).toBe('/v1/chat/completions');
    expect(seen[0].headers.authorization).toBeUndefined();
    expect(seen[0].body).toMatchObject({ model: 'qwen-local', messages: [{ role: 'system' }, { role: 'user', content: 'The gates of Mistvale' }] });
  });

  it('is off without a model to name', async () => {
    delete process.env.AI_MODEL;
    expect((await write(gm, { kind: 'note', prompt: 'x' })).status).toBe(503);
  });
});
