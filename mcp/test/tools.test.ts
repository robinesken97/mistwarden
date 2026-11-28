// Added for Mistwarden on 2026-11-28.
// The tools against a stub of the REST API: which are registered under which
// switch, and what the guards let through to the server.
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Settings } from '../src/config.ts';
import { inMap, Manifest } from '../src/guards.ts';
import { Api } from '../src/http.ts';
import { registerTools } from '../src/tools.ts';

const C = '11111111-2222-4333-8444-555555555555';
const MAP = '66666666-7777-4888-9999-000000000000';
const TOKEN = 'aaaaaaaa-0000-4000-8000-000000000001';
const DOOR = 'bbbbbbbb-0000-4000-8000-000000000001';
const WALL = 'bbbbbbbb-0000-4000-8000-000000000002';
const token = { id: TOKEN, name: 'Rat', position: { x: 1, y: 1 }, size: { width: 1, height: 1 }, visible: false, controlledBy: null, hp: { current: 10, max: 10, temp: 0 } };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mistwarden-tools-'));
});

type Route = (body: Record<string, unknown> | undefined) => unknown;

function harness(switches: Partial<Settings> = {}, extra: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    ...extra,
    [`GET /api/campaigns/${C}`]: () => ({ campaign: { id: C, name: 'Mistvale', userRole: 'GM', currentMapId: MAP, memberships: [], maps: [] } }),
    [`GET /api/campaigns/${C}/maps/${MAP}`]: () => ({
      map: {
        id: MAP, name: 'Crypt', width: 10, height: 10, gridSize: 50, tokens: [token],
        wallSegments: [{ id: DOOR, x1: 0, y1: 0, x2: 50, y2: 0, type: 'door-closed' }, { id: WALL, x1: 0, y1: 0, x2: 0, y2: 50, type: 'wall' }],
      },
    }),
    [`PUT /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`]: (b) => ({ token: { ...token, ...b } }),
    [`DELETE /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`]: () => ({}),
    [`PATCH /api/campaigns/${C}/maps/${MAP}/walls/${DOOR}`]: (b) => ({ segment: { id: DOOR, ...b } }),
    [`POST /api/campaigns/${C}/dice-rolls`]: (b) => ({ roll: { total: 7, secret: b?.secret ?? false } }),
    'POST /api/creatures/import-markdown': (b) => ({ dryRun: b?.dryRun, rows: [] }),
  };
  const calls: Array<{ route: string; body?: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const route = `${init?.method} ${new URL(url).pathname}`;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ route, body });
    const answer = routes[route] as Route | undefined;
    return new Response(JSON.stringify(answer !== undefined ? answer(body) : { message: `no route ${route}` }), { status: answer !== undefined ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const handlers = new Map<string, (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>>();
  const server = { registerTool: (name: string, _meta: unknown, fn: never) => handlers.set(name, fn) } as unknown as McpServer;
  const settings: Settings = {
    sessionFile: path.join(dir, 'session.json'), stateDir: dir, backupDir: path.join(dir, 'backups'), fileRoot: path.join(dir, 'files'),
    allowAnyEdit: false, playerVisible: false, coGm: false, backupMaxAgeHours: 6, ...switches,
  };
  const names = registerTools(server, { api: new Api({ baseUrl: 'http://mistwarden.test', cookie: 'sid=x' }, { fetch: fetchImpl }), settings });
  const call = async (name: string, args: Record<string, unknown>) => {
    const fn = handlers.get(name);
    if (!fn) throw new Error(`${name} is not registered`);
    const r = await fn(args);
    return { isError: !!r.isError, text: r.content[0].text };
  };
  const sent = (route: string) => calls.filter((c) => c.route === route);
  return { names, call, sent };
}

const TABLE_TOOLS = ['send_chat', 'send_whisper', 'start_combat', 'next_turn', 'roll_initiative', 'set_vibe', 'start_session', 'end_session', 'update_campaign'];

describe('switches', () => {
  it('registers no table tool without co-GM or player-visible; reading and secret rolls are always there', () => {
    const { names } = harness();
    for (const t of TABLE_TOOLS) expect(names).not.toContain(t);
    for (const t of ['roll_dice', 'get_initiative', 'get_messages', 'list_sessions', 'read_file', 'import_creatures_markdown']) expect(names).toContain(t);
    expect(new Set(names).size).toBe(names.length);
    for (const switches of [{ coGm: true }, { playerVisible: true }]) {
      const on = harness(switches).names;
      for (const t of TABLE_TOOLS) expect(on).toContain(t);
    }
  });

  it('rolls in secret without a switch, refuses a public roll', async () => {
    const h = harness();
    const pub = await h.call('roll_dice', { campaignId: C, expression: '1d20' });
    expect(pub.isError).toBe(true);
    expect(pub.text).toMatch(/whole table/);
    expect((await h.call('roll_dice', { campaignId: C, expression: '1d20', secret: true })).isError).toBe(false);
    expect(h.sent(`POST /api/campaigns/${C}/dice-rolls`).map((c) => c.body?.secret)).toEqual([true]);
  });
});

describe('co-GM mode on a token this server did not create, on the map players see', () => {
  it('without it, refuses even hit points', async () => {
    const h = harness();
    const r = await h.call('update_token', { campaignId: C, mapId: MAP, tokenId: TOKEN, hp: { current: 3 } });
    expect(r.isError).toBe(true);
    expect(h.sent(`PUT /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`)).toEqual([]);
  });

  it('changes game state, keeping the hit points it was not given', async () => {
    const h = harness({ coGm: true });
    const r = await h.call('update_token', { campaignId: C, mapId: MAP, tokenId: TOKEN, hp: { current: 3 }, conditions: ['prone'], x: 2, y: 3 });
    expect(r.isError).toBe(false);
    const [put] = h.sent(`PUT /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`);
    expect(put.body).toEqual({ hp: { current: 3, max: 10, temp: 0 }, conditions: ['prone'], position: { x: 2, y: 3 } });
  });

  it('refuses a rename, a mixed change, and a delete', async () => {
    const h = harness({ coGm: true });
    expect((await h.call('update_token', { campaignId: C, mapId: MAP, tokenId: TOKEN, name: 'Big rat' })).text).toMatch(/not created by this MCP server/);
    expect((await h.call('update_token', { campaignId: C, mapId: MAP, tokenId: TOKEN, hp: { current: 3 }, size: 2 })).isError).toBe(true);
    expect((await h.call('delete_token', { campaignId: C, mapId: MAP, tokenId: TOKEN })).text).toMatch(/not created by this MCP server/);
    expect(h.sent(`PUT /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`)).toEqual([]);
    expect(h.sent(`DELETE /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`)).toEqual([]);
  });

  it('opens a door, but does not turn a wall into one', async () => {
    const h = harness({ coGm: true });
    expect((await h.call('update_wall', { campaignId: C, mapId: MAP, wallId: DOOR, type: 'door-open' })).isError).toBe(false);
    expect((await h.call('update_wall', { campaignId: C, mapId: MAP, wallId: WALL, type: 'door-open' })).isError).toBe(true);
    expect(h.sent(`PATCH /api/campaigns/${C}/maps/${MAP}/walls/${DOOR}`)).toHaveLength(1);
  });
});

describe('backup before deleting', () => {
  it('refuses to delete its own token until create_backup has succeeded recently', async () => {
    const h = harness({ playerVisible: true });
    const manifest = await Manifest.load(dir, C);
    await manifest.add('token', [inMap(MAP, TOKEN)]);
    expect((await h.call('delete_token', { campaignId: C, mapId: MAP, tokenId: TOKEN })).text).toMatch(/Call create_backup first/);
    await manifest.recordBackup();
    expect((await h.call('delete_token', { campaignId: C, mapId: MAP, tokenId: TOKEN })).isError).toBe(false);
    expect(h.sent(`DELETE /api/campaigns/${C}/maps/${MAP}/tokens/${TOKEN}`)).toHaveLength(1);
  });
});

describe('instance imports', () => {
  it('is a dry run unless asked otherwise', async () => {
    await mkdir(path.join(dir, 'files'));
    await writeFile(path.join(dir, 'files', 'beasts.md'), '### Thrumwing Drake\n');
    const h = harness();
    await h.call('import_creatures_markdown', { path: 'beasts.md', sourceTag: 'mcp-test' });
    await h.call('import_creatures_markdown', { path: 'beasts.md', sourceTag: 'mcp-test', dryRun: false });
    expect(h.sent('POST /api/creatures/import-markdown').map((c) => [c.body?.dryRun, c.body?.markdown])).toEqual([
      [true, '### Thrumwing Drake\n'],
      [false, '### Thrumwing Drake\n'],
    ]);
  });
});

describe('update_character', () => {
  const CHAR = 'cccccccc-0000-4000-8000-000000000001';
  const ME = 'dddddddd-0000-4000-8000-000000000001';
  const PLAYER = 'dddddddd-0000-4000-8000-000000000002';
  const at = '2026-11-28T10:00:00.000Z';
  const routesFor = (owner: string): Record<string, Route> => ({
    'GET /api/auth/me': () => ({ user: { id: ME } }),
    [`GET /api/characters/${CHAR}`]: () => ({ character: { id: CHAR, userId: owner, campaignId: C, name: 'Wren', updatedAt: at, data: { hp: 9, notes: 'old', level: 3 } } }),
    [`PUT /api/characters/${CHAR}`]: (b) => ({ character: { id: CHAR, ...b } }),
  });

  it('merges only the named fields, after saving the sheet as it was to a private file', async () => {
    const h = harness({ coGm: true }, routesFor(ME));
    const r = await h.call('update_character', { campaignId: C, characterId: CHAR, updatedAt: at, fields: { hp: 4 } });
    expect(r.isError).toBe(false);
    expect(h.sent(`PUT /api/characters/${CHAR}`)[0].body).toEqual({ data: { hp: 4, notes: 'old', level: 3 }, updatedAt: at });
    const folder = path.join(dir, 'backups', 'characters', C);
    const [file] = await readdir(folder);
    expect(JSON.parse(r.text).previousSheetSavedTo).toBe(path.join(folder, file));
    expect(JSON.parse(await readFile(path.join(folder, file), 'utf8')).data).toEqual({ hp: 9, notes: 'old', level: 3 });
    expect((await stat(path.join(folder, file))).mode & 0o777).toBe(0o600);
  });

  it("needs the edit override for another member's character, and a current updatedAt", async () => {
    const cogm = harness({ coGm: true }, routesFor(PLAYER));
    expect((await cogm.call('update_character', { campaignId: C, characterId: CHAR, updatedAt: at, fields: { hp: 4 } })).text).toMatch(/ALLOW_ANY_EDIT/);
    expect(cogm.sent(`PUT /api/characters/${CHAR}`)).toEqual([]);
    expect((await harness({}, routesFor(ME)).call('update_character', { campaignId: C, characterId: CHAR, updatedAt: at, fields: { hp: 4 } })).isError).toBe(true);
    const any = harness({ allowAnyEdit: true }, routesFor(PLAYER));
    expect((await any.call('update_character', { campaignId: C, characterId: CHAR, updatedAt: '2026-11-27T00:00:00.000Z', fields: { hp: 4 } })).text).toMatch(/changed at/);
    expect((await any.call('update_character', { campaignId: C, characterId: CHAR, updatedAt: at, fields: { hp: 4 } })).isError).toBe(false);
  });
});
