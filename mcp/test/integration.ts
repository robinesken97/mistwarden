// Added for Mistwarden on 2026-11-27.
// Builds a small synthetic scene on a running Mistwarden through the MCP
// server, driven by a real MCP client over stdio, and checks the result over
// REST. Signs in with two-factor authentication through the login CLI first.
//
//   MCP_IT_BASE_URL      the instance (default http://localhost:4100)
//   MCP_IT_SETUP_TOKEN   a fresh instance: run the setup wizard with a generated admin
//   MCP_IT_EMAIL, MCP_IT_PASSWORD
//                        or an existing admin without two-factor authentication
//
// It turns two-factor authentication on for that account. Run it against a
// throwaway instance only.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { gridPng } from './png.ts';
import { totp } from './totp.ts';

const MCP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = (process.env.MCP_IT_BASE_URL ?? 'http://localhost:4100').replace(/\/+$/, '');
const step = (what: string) => process.stdout.write(`- ${what}\n`);

// ---- Plain REST, as a browser-less client ----------------------------------

let cookie = '';
async function rest<T = Record<string, unknown>>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie()[0];
  if (set) cookie = set.split(';')[0];
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// ---- The account ------------------------------------------------------------

const email = process.env.MCP_IT_EMAIL ?? `mcp-${randomBytes(4).toString('hex')}@example.com`;
const password = process.env.MCP_IT_PASSWORD ?? `Mcp-${randomBytes(12).toString('hex')}-Aa1!`;

if (process.env.MCP_IT_SETUP_TOKEN) {
  step('setup wizard with a generated admin');
  await rest('POST', '/api/setup/init', { setupToken: process.env.MCP_IT_SETUP_TOKEN, email, password, displayName: 'Oswin Test GM' });
} else {
  step(`signing in as ${email}`);
  await rest('POST', '/api/auth/login', { email, password });
}

step('turning on two-factor authentication');
const { secret } = await rest<{ secret: string }>('POST', '/api/auth/mfa/setup', { password });
const enrolStep = Math.floor(Date.now() / 30_000);
await rest('POST', '/api/auth/mfa/verify', { token: totp(secret, enrolStep * 30_000) });

const { campaign } = await rest<{ campaign: { id: string } }>('POST', '/api/campaigns', { name: `Mistvale ${randomBytes(3).toString('hex')}` });
const campaignId = campaign.id;

// ---- Login CLI, non-interactive ----------------------------------------------

const state = await mkdtemp(path.join(os.tmpdir(), 'mistwarden-mcp-it-'));
const sessionFile = path.join(state, 'session.json');
step('login CLI with a TOTP code');
// A code from a later step than the one enrolment used: each step is accepted once.
const code = totp(secret, (enrolStep + 1) * 30_000);
const login = spawn(process.execPath, [path.join(MCP_DIR, 'bin', 'login')], {
  env: { ...process.env, MISTWARDEN_SESSION_FILE: sessionFile },
  stdio: ['pipe', 'inherit', 'pipe'],
});
let loginOutput = '';
login.stderr.on('data', (d: Buffer) => (loginOutput += d.toString()));
login.stdin.end(`${BASE}\n${email}\n${password}\n${code}\n`);
const loginExit = await new Promise<number | null>((resolve) => login.on('close', resolve));
assert.equal(loginExit, 0, `login failed: ${loginOutput}`);
assert.ok(!loginOutput.includes(password), 'the password was echoed');
assert.equal((await stat(sessionFile)).mode & 0o777, 0o600);
const saved = JSON.parse(await readFile(sessionFile, 'utf8')) as Record<string, string>;
assert.deepEqual(Object.keys(saved).sort(), ['baseUrl', 'cookie', 'savedAt']);
assert.equal(saved.baseUrl, BASE);

// ---- Pictures --------------------------------------------------------------

const root = path.join(state, 'files');
await mkdir(root);
// Wider than 4096 px: the server shrinks the stored copy; the grid must not change.
await writeFile(path.join(root, 'mistvale-crypt.png'), gridPng(4200, 1400, 100));
await writeFile(path.join(root, 'oswin.png'), gridPng(120, 120, 40));
await writeFile(path.join(root, 'handout.png'), gridPng(300, 200, 50));
await writeFile(path.join(state, 'outside.png'), gridPng(100, 100));
// A Universal VTT file, 6 by 4 squares of 50 px: one wall, one door, one light (grid units).
await writeFile(path.join(root, 'oswin-cellar.dd2vtt'), JSON.stringify({
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 6, y: 4 }, pixels_per_grid: 50 },
  line_of_sight: [[{ x: 0, y: 0 }, { x: 6, y: 0 }]],
  portals: [{ position: { x: 3, y: 2 }, bounds: [{ x: 3, y: 1.5 }, { x: 3, y: 2.5 }], closed: true, freestanding: false }],
  lights: [{ position: { x: 1, y: 1 }, range: 3, intensity: 1, color: 'ffcc88' }],
  image: gridPng(300, 200, 50).toString('base64'),
}));

// ---- MCP client ----------------------------------------------------------------

async function connect(extraEnv: Record<string, string> = {}) {
  const client = new Client({ name: 'mistwarden-integration', version: '1.0.0' });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    MISTWARDEN_SESSION_FILE: sessionFile,
    MISTWARDEN_MCP_FILE_ROOT: root,
    ...extraEnv,
  };
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(MCP_DIR, 'src', 'server.ts')], env, stderr: 'inherit' }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    const textOut = result.content[0]?.text ?? '';
    return { isError: !!result.isError, text: textOut, data: (() => { try { return JSON.parse(textOut); } catch { return textOut; } })() };
  };
  const ok = async (name: string, args: Record<string, unknown>) => {
    const r = await call(name, args);
    assert.equal(r.isError, false, `${name} failed: ${r.text}`);
    return r.data;
  };
  return { client, call, ok };
}

const PLAYER_TOOLS = ['set_current_map', 'show_gallery_picture', 'share_document'];
const gm = await connect();
const names = (await gm.client.listTools()).tools.map((t) => t.name);
step(`MCP server lists ${names.length} tools`);
for (const t of PLAYER_TOOLS) assert.ok(!names.includes(t), `${t} is registered without the switch`);

step('backup');
const backup = await gm.ok('create_backup', { campaignId });
process.stdout.write(`  export: ${backup.bytes} bytes in ${backup.seconds} s\n`);

step('scene: map, walls with a door, light, token, note, gallery picture, fog');
const map = await gm.ok('create_map_from_image', { campaignId, path: 'mistvale-crypt.png', name: 'Mistvale Crypt', gridPx: 100 });
assert.deepEqual([map.width, map.height, map.gridSize, map.storedPictureShrunk], [42, 14, 100, true]);
const mapId: string = map.mapId;

const dup = await gm.call('create_map_from_image', { campaignId, path: 'mistvale-crypt.png', name: 'mistvale crypt', gridPx: 100 });
assert.ok(dup.isError && /already exists/.test(dup.text), 'a duplicate map name was accepted');

const outside = await gm.call('create_map_from_image', { campaignId, path: '../outside.png', name: 'Outside', gridPx: 100 });
assert.ok(outside.isError && /outside MISTWARDEN_MCP_FILE_ROOT/.test(outside.text), 'a file outside the root was read');

// A room 4 by 3 squares at the top-left corner, its door in the right wall.
const walls = await gm.ok('add_walls', {
  campaignId, mapId, walls: [
    { x1: 0, y1: 0, x2: 400, y2: 0 },
    { x1: 0, y1: 300, x2: 400, y2: 300 },
    { x1: 0, y1: 0, x2: 0, y2: 300 },
    { x1: 400, y1: 0, x2: 400, y2: 100 },
    { x1: 400, y1: 100, x2: 400, y2: 200, type: 'door-closed' },
    { x1: 400, y1: 200, x2: 400, y2: 300 },
  ],
});
assert.equal(walls.added.length, 6);
const doorId = walls.added.find((w: { type: string }) => w.type === 'door-closed').id;
await gm.ok('update_wall', { campaignId, mapId, wallId: doorId, type: 'door-locked' });
const light = await gm.ok('add_light', { campaignId, mapId, x: 200, y: 150, brightRadius: 2, dimRadius: 4 });
// Top-left square (1, 1) counted from the top: bottom-left cell y = 14 - 1 - 1 = 12.
const token = await gm.ok('add_token', { campaignId, mapId, name: 'Oswin', x: 1, y: 1, origin: 'top-left', imagePath: 'oswin.png', darkvision: 12 });
assert.deepEqual([token.x, token.y, token.topRow, token.visible], [1, 12, 1, false]);
const note = await gm.ok('create_note', { campaignId, title: 'Mistvale Crypt: read aloud', markdown: '> Cold air drifts from the stairs.' });
const dupNote = await gm.call('create_note', { campaignId, title: 'Mistvale Crypt: READ ALOUD', markdown: 'again' });
assert.ok(dupNote.isError, 'a duplicate note title was accepted');
await gm.ok('update_note', { campaignId, noteId: note.noteId, markdown: '> Cold air drifts from the stairs.\n\nThe door is locked.' });
const picture = await gm.ok('add_gallery_picture', { campaignId, path: 'handout.png', name: 'Crypt mural', folder: 'Mistvale' });
await gm.ok('update_map_settings', { campaignId, mapId, fogEnabled: true, lightingEnabled: true });
const fog = await gm.ok('fog_reveal_rect', { campaignId, mapId, x: 0, y: 0, width: 400, height: 300 });
assert.equal(fog.revealedCells, 12);

const cellar = await gm.ok('import_uvtt', { campaignId, path: 'oswin-cellar.dd2vtt', gridSize: 50 });
assert.deepEqual([cellar.name, cellar.width, cellar.height, cellar.walls, cellar.doors, cellar.lights], ['oswin-cellar', 6, 4, 1, 1, 1]);
const cellarMap = await gm.ok('get_map', { campaignId, mapId: cellar.mapId, includeWalls: true });
assert.equal(cellarMap.walls.length, 2);
// Imported geometry is on record, so it may be changed from here.
await gm.ok('update_wall', { campaignId, mapId: cellar.mapId, wallId: cellarMap.walls.find((w: { type: string }) => w.type !== 'wall').id, type: 'door-open' });
await gm.ok('delete_light', { campaignId, mapId: cellar.mapId, lightId: cellarMap.lights[0].id });

step('checking the scene over REST');
const { map: stored } = await rest<{ map: Record<string, unknown> & { wallSegments: Array<{ id: string; type: string }>; lights: Array<{ id: string }>; tokens: Array<{ id: string; position: { x: number; y: number }; visible: boolean; sightRadius: number }>; fogData: { revealed: boolean[] } } }>(
  'GET', `/api/campaigns/${campaignId}/maps/${mapId}`);
assert.deepEqual([stored.name, stored.width, stored.height, stored.gridSize, stored.fogEnabled, stored.lightingEnabled], ['Mistvale Crypt', 42, 14, 100, true, true]);
assert.equal(stored.wallSegments.length, 6);
assert.equal(stored.wallSegments.find((w) => w.id === doorId)?.type, 'door-locked');
assert.deepEqual(stored.lights.map((l) => l.id), [light.id]);
assert.deepEqual(stored.tokens.map((t) => [t.id, t.position.x, t.position.y, t.visible, t.sightRadius]), [[token.id, 1, 12, false, 12]]);
assert.equal(stored.fogData.revealed.filter(Boolean).length, 12);
const { note: storedNote } = await rest<{ note: { content: string } }>('GET', `/api/campaigns/${campaignId}/notes/${note.noteId}`);
assert.match(storedNote.content, /The door is locked/);
const { pictures } = await rest<{ pictures: Array<{ id: string; shownToAll: boolean; shownTo: string[]; folder: string }> }>('GET', `/api/campaigns/${campaignId}/gallery`);
assert.deepEqual(pictures.map((p) => [p.id, p.shownToAll, p.shownTo.length, p.folder]), [[picture.pictureId, false, 0, 'Mistvale']]);

step('the read tools, and changing and removing what was built');
const listed = await gm.ok('list_campaigns', {});
assert.ok(listed.some((c: { id: string; role: string }) => c.id === campaignId && c.role === 'GM'));
const info = await gm.ok('get_campaign', { campaignId });
assert.ok(info.members.length >= 1);
const maps = await gm.ok('list_maps', { campaignId });
assert.ok(maps.some((m: { id: string; createdByThisServer: boolean }) => m.id === mapId && m.createdByThisServer));
assert.ok((await gm.ok('list_notes', { campaignId })).some((n: { id: string }) => n.id === note.noteId));
assert.match((await gm.ok('get_note', { campaignId, noteId: note.noteId })).content, /locked/);
assert.equal((await gm.ok('list_gallery', { campaignId })).length, 1);
const moved = await gm.ok('update_token', { campaignId, mapId, tokenId: token.id, x: 3, y: 2, size: 2, visible: true });
assert.deepEqual([moved.x, moved.y, moved.size, moved.visible], [3, 2, 2, true]);
assert.equal((await gm.ok('update_light', { campaignId, mapId, lightId: light.id, dimRadius: 6, enabled: false })).dimRadius, 6);
const extra = await gm.ok('add_token', { campaignId, mapId, name: 'Mistvale rat', x: 10, y: 10 });
// A rider on a mount: put on its square, then off again.
const rider = await gm.ok('update_token', { campaignId, mapId, tokenId: extra.id, mountedOn: token.id });
assert.deepEqual([rider.mountedOn, rider.x, rider.y], [token.id, moved.x, moved.y]);
assert.equal((await gm.ok('update_token', { campaignId, mapId, tokenId: extra.id, mountedOn: null })).mountedOn, null);
await gm.ok('delete_token', { campaignId, mapId, tokenId: extra.id });
const spare = await gm.ok('add_light', { campaignId, mapId, x: 900, y: 900, brightRadius: 1, dimRadius: 2 });
await gm.ok('delete_light', { campaignId, mapId, lightId: spare.id });
const twoWalls = walls.added.slice(0, 2).map((w: { id: string }) => w.id);
assert.deepEqual((await gm.ok('delete_walls', { campaignId, mapId, wallIds: twoWalls })).deleted, twoWalls);
assert.equal((await gm.ok('fog_hide_rect', { campaignId, mapId, x: 0, y: 0, width: 100, height: 100 })).revealedCells, 11);
assert.equal((await gm.ok('fog_reveal_all', { campaignId, mapId })).revealedCells, 42 * 14);
assert.equal((await gm.ok('fog_hide_all', { campaignId, mapId })).revealedCells, 0);
await gm.ok('fog_reveal_rect', { campaignId, mapId, x: 0, y: 0, width: 400, height: 300 });
assert.deepEqual(await gm.ok('delete_map', { campaignId, mapId: cellar.mapId }), { deleted: cellar.mapId });

step('manifest guard refuses an object it did not create');
const { token: foreign } = await rest<{ token: { id: string } }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/tokens`, { name: 'Placed by hand', position: { x: 5, y: 5 } });
const refused = await gm.call('delete_token', { campaignId, mapId, tokenId: foreign.id });
assert.ok(refused.isError && /not created by this MCP server/.test(refused.text), 'deleted a token it did not create');
const after = await rest<{ map: { tokens: Array<{ id: string }> } }>('GET', `/api/campaigns/${campaignId}/maps/${mapId}`);
assert.ok(after.map.tokens.some((t) => t.id === foreign.id), 'the foreign token is gone');

step('the map players see is refused without the switch');
await rest('PUT', `/api/campaigns/${campaignId}/maps/${mapId}/set-current`);
const live = await gm.call('add_token', { campaignId, mapId, name: 'Late arrival', x: 2, y: 2 });
assert.ok(live.isError && /players currently see/.test(live.text), 'changed the live map');

const full = await gm.ok('create_backup', { campaignId });
process.stdout.write(`  export after the scene: ${full.bytes} bytes in ${full.seconds} s\n`);
assert.equal((await readFile(full.file)).toString('latin1', 0, 2), 'PK', 'the backup is not a zip archive');
assert.equal((await stat(full.file)).mode & 0o777, 0o600);
await gm.client.close();

step('player-visible tools appear only with the switch');
const open = await connect({ MISTWARDEN_MCP_PLAYER_VISIBLE: '1' });
const openNames = (await open.client.listTools()).tools.map((t) => t.name);
for (const t of PLAYER_TOOLS) assert.ok(openNames.includes(t), `${t} missing with the switch on`);
assert.equal((await open.ok('set_current_map', { campaignId, mapId })).currentMapId, mapId);
await open.ok('add_token', { campaignId, mapId, name: 'Late arrival', x: 2, y: 2 });
await open.ok('show_gallery_picture', { campaignId, pictureId: picture.pictureId, toAll: true });
const shownPics = await rest<{ pictures: Array<{ id: string; shownToAll: boolean }> }>('GET', `/api/campaigns/${campaignId}/gallery`);
assert.equal(shownPics.pictures.find((p) => p.id === picture.pictureId)?.shownToAll, true);
const shared = await open.ok('share_document', { campaignId, name: 'Mistvale handout', markdown: '# Mistvale\n\nA village in the fog.' });
const { documents } = await rest<{ documents: Array<{ id: string }> }>('GET', `/api/campaigns/${campaignId}/documents`);
assert.ok(documents.some((d) => d.id === shared.documentId), 'the document was not shared');
await open.client.close();

process.stdout.write(`OK: scene built and checked in campaign ${campaignId} (${names.length} tools without the switch, ${openNames.length} with it)\n`);
