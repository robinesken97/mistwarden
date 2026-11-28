// Added for Mistwarden on 2026-11-27.
// The tools. Their descriptions are what the assistant reads, so they carry
// the units, origins and limits.

import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type Settings, writePrivateJson } from './config.ts';
import { assertPlaceable, cellFromTop, fogCellsInRect, gridForPicture, isHexMap, topRowOf } from './coords.ts';
import { readTextFile, searchFiles, walkFiles } from './files.ts';
import {
  assertBackedUp, assertEditable, assertNewName, assertNotLive, assertPlayable, assertTableAction, assertUuid, GuardError, inMap, Manifest, resolveInRoot,
} from './guards.ts';
import { type Api, ApiError, callScope, newCallScope } from './http.ts';
import { pictureInfo } from './image.ts';

// ---- Shapes the server answers with (only the fields used here) -----------

interface Member { userId: string; role: string; user?: { displayName?: string } }
interface MapRow {
  id: string; name: string; width: number; height: number; gridSize: number; feetPerSquare?: number;
  gridType?: string; gridOffsetX?: number; gridOffsetY?: number; snapTokens?: boolean;
  lightingEnabled?: boolean; fogEnabled?: boolean; globalIllumination?: boolean; explorationEnabled?: boolean;
  gridColor?: string; gridOpacity?: number; gridLineWidth?: number;
  tokens?: TokenRow[]; wallSegments?: WallRow[]; lights?: LightRow[];
}
interface Campaign { id: string; name: string; userRole: string; currentMapId: string | null; memberships: Member[]; maps: MapRow[] }
interface CarriedLight { brightRadius: number; dimRadius: number; color: string; enabled: boolean }
interface TokenRow {
  id: string; name: string; position: { x: number; y: number }; size: { width: number; height: number };
  visible: boolean; controlledBy: string | null; sightRadius?: number; type?: string; disposition?: string | null; layer?: string;
  mountedOn?: string | null;
  hp?: { current: number; max: number; temp: number } | null; conditions?: string[]; initiative?: number | null; rotation?: number;
  light?: CarriedLight | null; showHpBar?: boolean; displayMode?: string; creatureTemplateId?: string | null; characterId?: string | null;
}
interface Creature {
  id: string; name: string; source: string; challengeRating: string | null; creatureType: string | null; imageUrl: string | null;
  size: { width: number; height: number } | null; disposition: string | null; displayMode: string | null; statBlock: { hpMax?: number } | null;
}
interface SpellArea { shape: string; sizeFt: number; widthFt?: number | null }
interface Spell { id: string; name: string; source: string; campaignId: string | null; level: number; school: string | null; area: SpellArea | null; element: string; concentration: boolean }
interface WallRow { id: string; x1: number; y1: number; x2: number; y2: number; type: string }
interface LightRow { id: string; x: number; y: number; brightRadius: number; dimRadius: number; color: string; enabled: boolean }
interface FogState { fogCols: number; fogRows: number; revealed: boolean[] }

export interface Context {
  api: Api;
  settings: Settings;
}

// ---- Helpers ----------------------------------------------------------------

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

/** Runs a tool body; a refusal or a server error comes back as the tool's error text instead of a crash. */
function handler<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      // Each call gets its own request budget and its own cache of reads.
      return text(await callScope.run(newCallScope(), () => fn(args)));
    } catch (err) {
      const message = err instanceof GuardError || err instanceof ApiError || err instanceof RangeError ? err.message : String(err instanceof Error ? err.message : err);
      return { ...text(message), isError: true };
    }
  };
}

const id = (what: string) => z.string().uuid().describe(what);
const campaignIdArg = id('Campaign id (from list_campaigns).');
const mapIdArg = id('Map id (from list_maps).');
const pixel = (what: string) => z.number().finite().describe(`${what}, in MAP PIXELS (origin top-left, y grows downward).`);

const BACKUP_FIRST = 'Before a batch of changes to a campaign, call create_backup once: there is no undo.';
const BACKUP_NEEDED = 'Refused unless create_backup succeeded for this campaign within the last hours (MISTWARDEN_MCP_BACKUP_MAX_AGE_HOURS, default 6).';

/** A read made once per tool call: later uses in the same call get the same answer. */
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const memo = callScope.getStore()?.memo;
  if (!memo) return load();
  let hit = memo.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    memo.set(key, hit);
    hit.catch(() => memo.delete(key));
  }
  return hit;
}

async function campaignAsGm(ctx: Context, campaignId: string): Promise<{ campaign: Campaign; manifest: Manifest }> {
  assertUuid(campaignId, 'campaignId');
  const { campaign } = await once(`campaign:${campaignId}`, () => ctx.api.json<{ campaign: Campaign }>('GET', `/api/campaigns/${campaignId}`));
  if (campaign.userRole !== 'GM') throw new GuardError(`Refused: this account is not the GM of "${campaign.name}".`);
  return { campaign, manifest: await Manifest.load(ctx.settings.stateDir, campaignId) };
}

/** Read before any change in the call; a change made in the call is not in it. */
async function getMap(ctx: Context, campaignId: string, mapId: string): Promise<MapRow> {
  assertUuid(mapId, 'mapId');
  return (await once(`map:${campaignId}/${mapId}`, () => ctx.api.json<{ map: MapRow }>('GET', `/api/campaigns/${campaignId}/maps/${mapId}`))).map;
}

async function readLocal(ctx: Context, requested: string): Promise<{ file: string; bytes: Buffer }> {
  const file = await resolveInRoot(ctx.settings.fileRoot, requested);
  return { file, bytes: await readFile(file) };
}

async function uploadPicture(ctx: Context, campaignId: string, type: 'MAP' | 'TOKEN', name: string, file: string, bytes: Buffer, mime: string) {
  const form = new FormData();
  // Fields before the file, which multipart parsers read in order.
  form.append('type', type);
  form.append('scope', 'CAMPAIGN');
  form.append('campaignId', campaignId);
  form.append('name', name);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), path.basename(file));
  return (await ctx.api.json<{ asset: { id: string } }>('POST', '/api/assets/upload', { form })).asset;
}

function tokenSummary(t: TokenRow, map: MapRow) {
  return {
    id: t.id, name: t.name, x: t.position.x, y: t.position.y,
    // Rows from the top are squares; a hex map's rows are not the map's height.
    topRow: isHexMap(map) ? null : topRowOf(t.position.y, t.size.height, map.height),
    size: t.size.width, visible: t.visible, controlledBy: t.controlledBy, darkvision: t.sightRadius ?? 0, type: t.type, layer: t.layer,
    mountedOn: t.mountedOn ?? null,
  };
}

/** A token with its game state, for list_tokens and the token update tools. */
function tokenDetail(t: TokenRow, map: MapRow, manifest: Manifest) {
  return {
    ...tokenSummary(t, map), disposition: t.disposition ?? null, hp: t.hp ?? null, conditions: t.conditions ?? [], initiative: t.initiative ?? null,
    rotation: t.rotation ?? 0, light: t.light ?? null, showHpBar: t.showHpBar, displayMode: t.displayMode,
    creatureTemplateId: t.creatureTemplateId ?? null, characterId: t.characterId ?? null, createdByThisServer: manifest.has('token', inMap(map.id, t.id)),
  };
}

/** How the grid is drawn for everyone; older servers send none of it, which is the default look. */
const gridLookOf = (map: MapRow) => ({ gridColor: map.gridColor ?? '#000000', gridOpacity: map.gridOpacity ?? 0.4, gridLineWidth: map.gridLineWidth ?? 2 });

function fogSummary(fog: FogState) {
  const revealed = fog.revealed.filter(Boolean).length;
  return { revealedCells: revealed, totalCells: fog.revealed.length, columns: fog.fogCols, rows: fog.fogRows };
}

const COORDS =
  'Coordinates: walls, doors, lights and fog rectangles use MAP PIXELS with the origin at the TOP-LEFT corner (y grows downward); ' +
  'the map-pixel frame is width*gridSize by height*gridSize. Tokens use GRID CELLS with the origin at the BOTTOM-LEFT (y grows upward): ' +
  'whole cells, unless the map\'s snapTokens is false, where x and y may lie between squares (kept to hundredths). ' +
  'gridOffsetX/Y move the grid (and fog squares) from the frame\'s corner. On a hex map (gridType hexPointy or hexFlat) a cell is a hex: ' +
  'x counts from the first column and y from the bottom row of hexes whose centres lie in the frame; origin "top-left" is refused there.';

// ---- Registration -------------------------------------------------------------

export function registerTools(server: McpServer, ctx: Context): string[] {
  const names: string[] = [];
  const tool = <S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>, readOnly = false) => {
    names.push(name);
    server.registerTool(name, { description, inputSchema: shape, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly } }, handler(fn) as never);
  };

  // ---- Read ----

  tool('list_campaigns', 'List the campaigns this account belongs to, with its role in each (only GM campaigns can be changed).', {}, async () => {
    const { campaigns } = await ctx.api.json<{ campaigns: Array<Campaign & { userRole: string }> }>('GET', '/api/campaigns');
    return campaigns.map((c) => ({ id: c.id, name: c.name, role: c.userRole, currentMapId: c.currentMapId }));
  }, true);

  tool('get_campaign', 'One campaign: its members (user ids for controlledBy and show_gallery_picture), its maps, and which map the players currently see.', { campaignId: campaignIdArg }, async ({ campaignId }) => {
    assertUuid(campaignId, 'campaignId');
    const { campaign } = await ctx.api.json<{ campaign: Campaign }>('GET', `/api/campaigns/${campaignId}`);
    return {
      id: campaign.id, name: campaign.name, role: campaign.userRole, currentMapId: campaign.currentMapId,
      members: campaign.memberships.map((m) => ({ userId: m.userId, role: m.role, name: m.user?.displayName })),
      maps: campaign.maps.map((m) => ({ id: m.id, name: m.name })),
    };
  }, true);

  tool('list_maps', 'List the maps of a campaign with size (squares), grid size (map pixels per square), whether players see it now, and whether this server created it.', { campaignId: campaignIdArg }, async ({ campaignId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const { maps } = await ctx.api.json<{ maps: MapRow[] }>('GET', `/api/campaigns/${campaignId}/maps`);
    return maps.map((m) => ({
      id: m.id, name: m.name, width: m.width, height: m.height, gridSize: m.gridSize,
      gridType: m.gridType ?? 'square', gridOffsetX: m.gridOffsetX ?? 0, gridOffsetY: m.gridOffsetY ?? 0, snapTokens: m.snapTokens ?? true,
      pixelWidth: m.width * m.gridSize, pixelHeight: m.height * m.gridSize,
      current: m.id === campaign.currentMapId, createdByThisServer: manifest.has('map', m.id),
    }));
  }, true);

  tool('get_map', `One map: size, settings, tokens, walls/doors and lights. ${COORDS} Each token also gets topRow (its top row counted from the top, 0-based).`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    includeWalls: z.boolean().optional().describe('List every wall segment (default: counts only, plus the doors).'),
  }, async ({ campaignId, mapId, includeWalls }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const map = await getMap(ctx, campaignId, mapId);
    const walls = map.wallSegments ?? [];
    const byType: Record<string, number> = {};
    for (const w of walls) byType[w.type] = (byType[w.type] ?? 0) + 1;
    return {
      id: map.id, name: map.name, width: map.width, height: map.height, gridSize: map.gridSize, feetPerSquare: map.feetPerSquare,
      gridType: map.gridType ?? 'square', gridOffsetX: map.gridOffsetX ?? 0, gridOffsetY: map.gridOffsetY ?? 0, snapTokens: map.snapTokens ?? true,
      pixelWidth: map.width * map.gridSize, pixelHeight: map.height * map.gridSize,
      current: map.id === campaign.currentMapId, createdByThisServer: manifest.has('map', map.id),
      settings: { lightingEnabled: map.lightingEnabled, fogEnabled: map.fogEnabled, globalIllumination: map.globalIllumination, explorationEnabled: map.explorationEnabled },
      gridLook: gridLookOf(map),
      tokens: (map.tokens ?? []).map((t) => tokenSummary(t, map)),
      wallCounts: byType,
      walls: includeWalls ? walls : walls.filter((w) => w.type !== 'wall' && w.type !== 'window'),
      lights: map.lights ?? [],
    };
  }, true);

  tool('list_notes', "List this account's own notes in a campaign (titles only; notes are private to their author).", { campaignId: campaignIdArg }, async ({ campaignId }) => {
    const { manifest } = await campaignAsGm(ctx, campaignId);
    const { notes } = await ctx.api.json<{ notes: Array<{ id: string; title: string; updatedAt: string }> }>('GET', `/api/campaigns/${campaignId}/notes`);
    return notes.map((n) => ({ ...n, createdByThisServer: manifest.has('note', n.id) }));
  }, true);

  tool('get_note', 'Read one of your notes in full (title and Markdown content).', { campaignId: campaignIdArg, noteId: id('Note id (from list_notes).') }, async ({ campaignId, noteId }) => {
    assertUuid(campaignId, 'campaignId');
    assertUuid(noteId, 'noteId');
    return (await ctx.api.json<{ note: unknown }>('GET', `/api/campaigns/${campaignId}/notes/${noteId}`)).note;
  }, true);

  tool('list_gallery', 'List the pictures in the campaign gallery, with folder and whom each is shown to.', { campaignId: campaignIdArg }, async ({ campaignId }) => {
    await campaignAsGm(ctx, campaignId);
    return (await ctx.api.json<{ pictures: unknown[] }>('GET', `/api/campaigns/${campaignId}/gallery`)).pictures;
  }, true);

  // ---- Backup ----

  tool('create_backup', `Download an export of the campaign (maps with their pictures, tokens, notes) to a local folder. The gallery is not in it: a picture shown only in the gallery is lost with its file, and a map picture keeps its file but not its gallery name, folder or sharing. Nor are the instance's imported creatures and spells (undo an import with delete_imported_creatures / delete_imported_spells). ${BACKUP_FIRST} The delete tools refuse without a recent one. The server allows only a few exports per hour.`, { campaignId: campaignIdArg }, async ({ campaignId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const started = Date.now();
    const res = await ctx.api.request('GET', `/api/campaigns/${campaignId}/export`);
    if (!res.ok || !res.body) throw new ApiError(res.status, `Export failed (${res.status}): ${await res.text()}`, null);
    await mkdir(ctx.settings.backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(ctx.settings.backupDir, `campaign-${campaignId}-${stamp}.zip`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(file, { mode: 0o600 }));
    const { size } = await stat(file);
    await manifest.recordBackup();
    return { campaign: campaign.name, file, bytes: size, seconds: (Date.now() - started) / 1000 };
  });

  // ---- Maps ----

  tool('create_map_from_image', `Create a map (GM-only until shown) from a local picture under MISTWARDEN_MCP_FILE_ROOT (PNG, JPEG, WebP).
Give the grid as gridPx (pixels of the ORIGINAL picture per square) or squaresAcross (number of squares across the picture). The map size in squares is computed from the original picture, so the map-pixel frame equals the original picture's pixels when the picture divides evenly: wall and light coordinates can be read straight off the source file, even though the server shrinks pictures larger than 4096 px on a side for storage.
Limits: 1-500 squares per side, 10-500 pixels per square. Refuses a name already used by a map in this campaign unless allowDuplicate is true. ${BACKUP_FIRST}`, {
    campaignId: campaignIdArg,
    path: z.string().describe('Picture path, relative to MISTWARDEN_MCP_FILE_ROOT or absolute inside it.'),
    name: z.string().min(1).max(200),
    gridPx: z.number().positive().optional().describe('Source-picture pixels per square.'),
    squaresAcross: z.number().int().positive().optional().describe('Squares across the picture (used when gridPx is not given).'),
    feetPerSquare: z.number().int().min(1).max(100).optional().describe('Default 5.'),
    allowDuplicate: z.boolean().optional(),
  }, async (a) => {
    const { campaign, manifest } = await campaignAsGm(ctx, a.campaignId);
    assertNewName('map', a.name, campaign.maps.map((m) => m.name), a.allowDuplicate);
    const { file, bytes } = await readLocal(ctx, a.path);
    const info = pictureInfo(bytes);
    const grid = gridForPicture(info.width, info.height, { gridPx: a.gridPx, squaresAcross: a.squaresAcross });
    const asset = await uploadPicture(ctx, a.campaignId, 'MAP', a.name, file, bytes, info.mime);
    await manifest.add('asset', [asset.id]);
    const { map } = await ctx.api.json<{ map: MapRow }>('POST', `/api/campaigns/${a.campaignId}/maps`, {
      json: { name: a.name, imageUrl: asset.id, width: grid.width, height: grid.height, gridSize: grid.gridSize, feetPerSquare: a.feetPerSquare },
    });
    await manifest.add('map', [map.id]);
    return {
      mapId: map.id, name: map.name, width: map.width, height: map.height, gridSize: map.gridSize,
      pixelWidth: map.width * map.gridSize, pixelHeight: map.height * map.gridSize,
      originalPicture: { width: info.width, height: info.height },
      storedPictureShrunk: Math.max(info.width, info.height) > 4096,
      note: grid.exact ? 'Map pixels equal the original picture pixels.' : 'The picture does not divide evenly into squares: map pixels differ slightly from picture pixels (the picture is stretched to the map).',
    };
  });

  tool('import_uvtt', `Create a map from a local Universal VTT file (.uvtt, .dd2vtt, .df2vtt) under MISTWARDEN_MCP_FILE_ROOT, with its walls, doors and lights. If the server asks for a decision (geometry outside the map, or furniture walls on offer), the answer says so; call again with confirm: true (and includeObjectWalls if wanted). ${BACKUP_FIRST}`, {
    campaignId: campaignIdArg,
    path: z.string(),
    name: z.string().min(1).max(200).optional().describe('Default: the file name without extension.'),
    gridSize: z.number().int().min(10).max(500).optional().describe('Map pixels per square in Mistwarden (default 70); the file geometry is scaled to it.'),
    confirm: z.boolean().optional(),
    includeObjectWalls: z.boolean().optional(),
    allowDuplicate: z.boolean().optional(),
  }, async (a) => {
    const { campaign, manifest } = await campaignAsGm(ctx, a.campaignId);
    const { file, bytes } = await readLocal(ctx, a.path);
    const name = a.name ?? path.basename(file, path.extname(file)).slice(0, 200);
    assertNewName('map', name, campaign.maps.map((m) => m.name), a.allowDuplicate);
    const form = new FormData();
    form.append('name', name);
    if (a.gridSize !== undefined) form.append('gridSize', String(a.gridSize));
    if (a.confirm) form.append('confirm', 'true');
    if (a.includeObjectWalls) form.append('includeObjectWalls', 'true');
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/json' }), path.basename(file));
    const res = await ctx.api.request('POST', `/api/campaigns/${a.campaignId}/maps/import-uvtt`, { form });
    const body = (await res.json()) as { map?: MapRow; message?: string; code?: string; [k: string]: unknown };
    if (res.status === 409 && body.code === 'UVTT_IMPORT_NEEDS_CONFIRMATION') return { needsConfirmation: true, ...body };
    if (!res.ok || !body.map) throw new ApiError(res.status, `UVTT import failed (${res.status}): ${body.message ?? JSON.stringify(body)}`, body);
    const map = body.map;
    await manifest.add('map', [map.id]);
    const full = await getMap(ctx, a.campaignId, map.id);
    await manifest.add('wall', (full.wallSegments ?? []).map((w) => inMap(map.id, w.id)));
    await manifest.add('light', (full.lights ?? []).map((l) => inMap(map.id, l.id)));
    return { mapId: map.id, name: map.name, width: map.width, height: map.height, gridSize: map.gridSize, walls: body.wallCount, doors: body.portalCount, lights: body.lightCount };
  });

  tool('update_map_settings', `Change a map's name, size, grid or settings. Only maps this server created (unless MISTWARDEN_MCP_ALLOW_ANY_EDIT=1), and not the map the players currently see (unless MISTWARDEN_MCP_PLAYER_VISIBLE=1). Turning fog on starts with everything hidden. Changing width, height or gridSize changes the map-pixel frame that walls, lights and fog use.`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    name: z.string().min(1).max(200).optional(),
    feetPerSquare: z.number().int().min(1).max(100).optional(),
    diagonalRule: z.enum(['flat', 'alternating']).optional(),
    lightingEnabled: z.boolean().optional().describe('Dynamic lighting with walls blocking sight.'),
    fogEnabled: z.boolean().optional().describe('Fog of war; needed before the fog tools work.'),
    globalIllumination: z.boolean().optional().describe('Everything lit, as by daylight.'),
    explorationEnabled: z.boolean().optional().describe('Remember what player tokens have seen.'),
    snapTokens: z.boolean().optional().describe('Tokens stand on whole squares (default). Off lets tokens stop between squares; turning it on moves every token to its nearest square. A hex map always snaps.'),
    gridType: z.enum(['square', 'hexPointy', 'hexFlat']).optional(),
    gridOffsetX: z.number().finite().optional().describe('Moves the grid (and fog squares) right, in map pixels.'),
    gridOffsetY: z.number().finite().optional().describe('Moves the grid (and fog squares) down, in map pixels.'),
    width: z.number().int().min(1).max(500).optional().describe('Map width in squares.'),
    height: z.number().int().min(1).max(500).optional().describe('Map height in squares.'),
    gridSize: z.number().int().min(10).max(500).optional().describe('Map pixels per square.'),
    gridColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Grid colour for everyone, as #rrggbb (default #000000; #ffffff for white).'),
    gridOpacity: z.number().min(0.1).max(1).optional().describe('How opaque the grid is, 0.1 to 1 (default 0.4).'),
    gridLineWidth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('Grid line width on screen: 1 thin, 2 medium (default), 3 thick.'),
  }, async ({ campaignId, mapId, ...changes }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'map', mapId, ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    const { map } = await ctx.api.json<{ map: MapRow }>('PUT', `/api/campaigns/${campaignId}/maps/${mapId}`, { json: changes });
    return {
      id: map.id, name: map.name, width: map.width, height: map.height, gridSize: map.gridSize, gridType: map.gridType ?? 'square',
      gridOffsetX: map.gridOffsetX ?? 0, gridOffsetY: map.gridOffsetY ?? 0,
      lightingEnabled: map.lightingEnabled, fogEnabled: map.fogEnabled, globalIllumination: map.globalIllumination, explorationEnabled: map.explorationEnabled, snapTokens: map.snapTokens ?? true,
      gridLook: gridLookOf(map),
    };
  });

  // Mistwarden, 2026-11-28: a copy is new and seen by nobody, so it needs no backup and may be made from any map, the one players see too.
  tool('duplicate_scene', `Copy a map (a scene) within its campaign, GM-only until shown: the same picture, grid and grid look, settings, walls and doors, lights and spell areas, and unless set false its tokens (new ids, everything else kept, riders on their mounts), fog and drawings. Not copied: what players explored, initiative. The copy is not shown to players. Default name "<name> (copy)", or "(copy 2)" and on. Works on any map of the campaign, the one players see too, and changes nothing on it. The copy counts as created by this server; its tokens, walls and lights only where the original's were.`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    name: z.string().min(1).max(200).optional(),
    tokens: z.boolean().optional().describe('Copy the tokens (default true).'),
    fog: z.boolean().optional().describe('Copy the revealed fog squares (default true); without, the copy starts all hidden.'),
    drawings: z.boolean().optional().describe('Copy the drawings (default true).'),
    allowDuplicate: z.boolean().optional().describe('Allow a name already used by a map in this campaign.'),
  }, async ({ campaignId, mapId, allowDuplicate, ...options }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    if (options.name !== undefined) assertNewName('map', options.name, campaign.maps.map((m) => m.name), allowDuplicate);
    const source = await getMap(ctx, campaignId, mapId);
    const { map } = await ctx.api.json<{ map: MapRow }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/duplicate`, { json: options });
    await manifest.add('map', [map.id]);
    // What this server made on the original it may change on the copy; nothing else.
    const mine = (kind: 'wall' | 'light', ids: string[]) => ids.filter((i) => manifest.has(kind, inMap(mapId, i))).map((i) => inMap(map.id, i));
    await manifest.add('wall', mine('wall', (source.wallSegments ?? []).map((w) => w.id)));
    await manifest.add('light', mine('light', (source.lights ?? []).map((l) => l.id)));
    const before = source.tokens ?? [];
    const after = map.tokens ?? [];
    if (before.length === after.length) {
      await manifest.add('token', after.filter((_, i) => manifest.has('token', inMap(mapId, before[i].id))).map((t) => inMap(map.id, t.id)));
    }
    return { mapId: map.id, name: map.name, tokens: after.length, walls: (map.wallSegments ?? []).length, lights: (map.lights ?? []).length, current: false };
  });

  tool('delete_map', `Delete a map with its tokens, walls and lights. Only maps this server created (unless MISTWARDEN_MCP_ALLOW_ANY_EDIT=1); never the map players currently see without MISTWARDEN_MCP_PLAYER_VISIBLE=1. Cannot be undone. ${BACKUP_NEEDED}`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
  }, async ({ campaignId, mapId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'map', mapId, ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    assertBackedUp(manifest, ctx.settings.backupMaxAgeHours);
    await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}`);
    await manifest.remove('map', [mapId]);
    return { deleted: mapId };
  });

  // ---- Tokens ----

  const tokenPosition = {
    x: z.number().min(0).describe('Column of the token\'s left square, 0 = left edge. Whole squares unless the map\'s snapTokens is false.'),
    y: z.number().min(0).describe('Row of the token\'s BOTTOM square counted from the BOTTOM edge (0 = bottom row), unless origin is "top-left". Whole squares unless the map\'s snapTokens is false.'),
    origin: z.enum(['bottom-left', 'top-left']).optional().describe('"top-left": y is the row of the token\'s TOP square counted from the top (0 = top row), as when reading a picture. Default "bottom-left", Mistwarden\'s own frame.'),
  };
  const toCell = (map: MapRow, x: number, y: number, origin: string | undefined, size: number) => {
    const cell = origin === 'top-left' ? cellFromTop(x, y, size, map.height, map) : { x, y };
    assertPlaceable(map, cell);
    return cell;
  };

  // Mistwarden, 2026-11-27: the symbols the server allows (backend/src/utils/tokenIcons.ts), and a name kept from players.
  const tokenLook = {
    icon: z.enum([
      'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
      'barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard', 'person',
    ]).nullable().optional().describe('Symbol drawn while the token has no picture; null or absent works it out from the stat block, the character\'s class, else person.'),
    nameHidden: z.boolean().optional().describe('Keep the name from players: they see no name plate and an unknown creature.'),
  };

  const uploadTokenPicture = async (manifest: Manifest, campaignId: string, name: string, imagePath: string): Promise<string> => {
    const { file, bytes } = await readLocal(ctx, imagePath);
    const asset = await uploadPicture(ctx, campaignId, 'TOKEN', name, file, bytes, pictureInfo(bytes).mime);
    await manifest.add('asset', [asset.id]);
    return asset.id;
  };

  tool('add_token', `Add a token to a map. Hidden from players by default (visible: false). ${COORDS} Size is in squares (1 = medium, 2 = large, 3 = huge). Not on the map players currently see unless MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_PLAYER_VISIBLE=1.`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    name: z.string().min(1).max(200),
    ...tokenPosition,
    size: z.number().int().min(1).max(10).optional().describe('Squares per side, default 1.'),
    imagePath: z.string().optional().describe('Token picture under MISTWARDEN_MCP_FILE_ROOT (PNG, JPEG, WebP). Without it the token shows its symbol (see icon).'),
    visible: z.boolean().optional().describe('Seen by players. Default false (GM only).'),
    darkvision: z.number().min(0).max(200).optional().describe('Darkvision radius in squares.'),
    type: z.enum(['player', 'npc', 'object']).optional().describe('Default npc.'),
    disposition: z.enum(['friendly', 'neutral', 'hostile']).optional(),
    controlledBy: z.string().uuid().optional().describe('User id of a player who may move it (from get_campaign).'),
    notes: z.string().max(5000).optional().describe('GM notes kept on the token.'),
    ...tokenLook,
  }, async (a) => {
    const { campaign, manifest } = await campaignAsGm(ctx, a.campaignId);
    // Placing a token is part of running the game: co-GM mode may do it on the map the players see.
    assertNotLive(ctx.settings, campaign.currentMapId, a.mapId, true);
    const map = await getMap(ctx, a.campaignId, a.mapId);
    const size = a.size ?? 1;
    const position = toCell(map, a.x, a.y, a.origin, size);
    const imageUrl = a.imagePath ? await uploadTokenPicture(manifest, a.campaignId, a.name, a.imagePath) : undefined;
    const { token } = await ctx.api.json<{ token: TokenRow }>('POST', `/api/campaigns/${a.campaignId}/maps/${a.mapId}/tokens`, {
      json: {
        name: a.name, position, size: { width: size, height: size }, imageUrl, visible: a.visible ?? false,
        sightRadius: a.darkvision, type: a.type, disposition: a.disposition, controlledBy: a.controlledBy, notes: a.notes,
        icon: a.icon, nameHidden: a.nameHidden,
      },
    });
    await manifest.add('token', [inMap(a.mapId, token.id)]);
    return tokenSummary(token, map);
  });

  const tokenChange = {
    tokenId: z.string().min(1).max(100).describe('Token id (from get_map or list_tokens).'),
    name: z.string().min(1).max(200).optional(),
    x: tokenPosition.x.optional(), y: tokenPosition.y.optional(), origin: tokenPosition.origin,
    size: z.number().int().min(1).max(10).optional(),
    visible: z.boolean().optional(),
    darkvision: z.number().min(0).max(200).optional(),
    type: z.enum(['player', 'npc', 'object']).optional(),
    disposition: z.enum(['friendly', 'neutral', 'hostile']).nullable().optional(),
    controlledBy: z.string().uuid().nullable().optional(),
    notes: z.string().max(5000).optional(),
    mountedOn: z.string().min(1).max(100).nullable().optional()
      .describe('Id of a token on the same map and plane for this one to ride (they then move as one); null gets off.'),
    ...tokenLook,
    hp: z.object({ current: z.number().int().min(0).max(99999).optional(), max: z.number().int().min(1).max(99999).optional(), temp: z.number().int().min(0).optional() })
      .nullable().optional().describe('Hit points; fields left out keep their value (a token without hit points needs max). null removes them.'),
    conditions: z.array(z.string().min(1).max(100)).max(50).optional().describe('REPLACES the whole list of conditions.'),
    initiative: z.number().nullable().optional().describe('The initiative value kept on the token.'),
    rotation: z.number().min(0).max(360).optional().describe('Facing in degrees.'),
    light: z.object({
      brightRadius: z.number().min(0).max(100), dimRadius: z.number().min(0.5).max(100),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), enabled: z.boolean().optional(),
    }).nullable().optional().describe('A light the token carries (radii in squares, default colour #ffd9a0); null takes it away.'),
    lightEnabled: z.boolean().optional().describe('Light the carried light, or put it out (game state).'),
    showHpBar: z.boolean().optional(),
    layer: z.enum(['token', 'spirit']).optional(),
    displayMode: z.enum(['pog', 'top-down', 'full-art']).optional(),
    imagePath: z.string().optional().describe('A new picture under MISTWARDEN_MCP_FILE_ROOT.'),
    imageUrl: z.string().max(500).nullable().optional().describe('A token picture already on the server (for example a creature\'s imageUrl); null removes the picture.'),
    creatureTemplateId: z.string().uuid().nullable().optional(),
    characterId: z.string().uuid().nullable().optional().describe('Bind the token to a character of this campaign.'),
  };
  type TokenChange = z.infer<z.ZodObject<typeof tokenChange>>;
  // Running the game; every other field changes what the token is.
  const TOKEN_GAME_STATE = new Set(['tokenId', 'x', 'y', 'origin', 'visible', 'hp', 'conditions', 'initiative', 'rotation', 'lightEnabled']);
  const TOKEN_RULES = `Changing only game state (x/y, visible, hp, conditions, initiative, rotation, lightEnabled) needs a token this server created, or MISTWARDEN_MCP_COGM=1 (then also on the map the players see). Any other field needs a token this server created (or MISTWARDEN_MCP_ALLOW_ANY_EDIT=1), not on the map the players see (unless MISTWARDEN_MCP_PLAYER_VISIBLE=1).`;

  /** Refuses the change before anything is sent; answers the token as it is now. */
  const checkTokenChange = (campaign: Campaign, manifest: Manifest, map: MapRow, c: TokenChange): TokenRow => {
    const key = inMap(map.id, c.tokenId);
    const gameState = Object.entries(c).every(([k, v]) => v === undefined || TOKEN_GAME_STATE.has(k));
    if (gameState) assertPlayable(manifest, 'token', key, ctx.settings);
    else assertEditable(manifest, 'token', key, ctx.settings.allowAnyEdit);
    // A rider moves its mount, so the mount must be this server's to change too.
    if (c.mountedOn) assertEditable(manifest, 'token', inMap(map.id, c.mountedOn), ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, map.id, gameState);
    const current = (map.tokens ?? []).find((t) => t.id === c.tokenId);
    if (!current) throw new GuardError(`No token ${c.tokenId} on this map.`);
    if ((c.x === undefined) !== (c.y === undefined)) throw new GuardError('Give x and y together.');
    if (c.lightEnabled !== undefined && !c.light && !current.light) throw new GuardError(`Token ${c.tokenId} carries no light: give light to add one.`);
    if (c.imagePath && c.imageUrl !== undefined) throw new GuardError('Give imagePath or imageUrl, not both.');
    if (c.x !== undefined && c.y !== undefined) toCell(map, c.x, c.y, c.origin, c.size ?? current.size.width);
    return current;
  };

  const applyTokenChange = async (campaignId: string, manifest: Manifest, map: MapRow, current: TokenRow, c: TokenChange): Promise<TokenRow> => {
    const size = c.size ?? current.size.width;
    const imageUrl = c.imagePath ? await uploadTokenPicture(manifest, campaignId, c.name ?? current.name, c.imagePath) : c.imageUrl;
    const baseLight = c.light ? { color: '#ffd9a0', enabled: true, ...c.light } : c.light === null ? null : current.light;
    const body: Record<string, unknown> = {
      name: c.name, visible: c.visible, sightRadius: c.darkvision, type: c.type, disposition: c.disposition, controlledBy: c.controlledBy, notes: c.notes, mountedOn: c.mountedOn,
      icon: c.icon, nameHidden: c.nameHidden,
      size: c.size !== undefined ? { width: size, height: size } : undefined,
      position: c.x !== undefined && c.y !== undefined ? toCell(map, c.x, c.y, c.origin, size) : undefined,
      hp: c.hp === null ? null : c.hp ? { temp: 0, ...(current.hp ?? {}), ...c.hp } : undefined,
      conditions: c.conditions, initiative: c.initiative, rotation: c.rotation,
      light: c.lightEnabled !== undefined && baseLight ? { ...baseLight, enabled: c.lightEnabled } : c.light !== undefined ? baseLight : undefined,
      showHpBar: c.showHpBar, layer: c.layer, displayMode: c.displayMode, imageUrl, creatureTemplateId: c.creatureTemplateId, characterId: c.characterId,
    };
    const { token } = await ctx.api.json<{ token: TokenRow }>('PUT', `/api/campaigns/${campaignId}/maps/${map.id}/tokens/${encodeURIComponent(c.tokenId)}`, { json: body });
    return token;
  };

  tool('update_token', `Move or change a token. ${COORDS} Give x and y together to move it. ${TOKEN_RULES}`, {
    campaignId: campaignIdArg, mapId: mapIdArg, ...tokenChange,
  }, async ({ campaignId, mapId, ...change }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const map = await getMap(ctx, campaignId, mapId);
    const current = checkTokenChange(campaign, manifest, map, change);
    return tokenDetail(await applyTokenChange(campaignId, manifest, map, current, change), map, manifest);
  });

  tool('update_tokens', `Change several tokens of one map in one call (up to 90), each as update_token takes it. Every change is checked before any is sent; if the server refuses one part-way, the answer says which were changed. ${TOKEN_RULES}`, {
    campaignId: campaignIdArg, mapId: mapIdArg, changes: z.array(z.object(tokenChange)).min(1).max(90),
  }, async ({ campaignId, mapId, changes }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const map = await getMap(ctx, campaignId, mapId);
    const currents = changes.map((c) => checkTokenChange(campaign, manifest, map, c));
    const changed: unknown[] = [];
    for (const [i, c] of changes.entries()) {
      try {
        changed.push(tokenDetail(await applyTokenChange(campaignId, manifest, map, currents[i], c), map, manifest));
      } catch (err) {
        throw new GuardError(`Changed ${i} of ${changes.length} tokens, then token ${c.tokenId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { changed };
  });

  tool('delete_token', `Remove a token this server created from a map. Cannot be undone. ${BACKUP_NEEDED}`, {
    campaignId: campaignIdArg, mapId: mapIdArg, tokenId: id('Token id.'),
  }, async ({ campaignId, mapId, tokenId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'token', inMap(mapId, tokenId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    assertBackedUp(manifest, ctx.settings.backupMaxAgeHours);
    await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}/tokens/${tokenId}`);
    await manifest.remove('token', [inMap(mapId, tokenId)]);
    return { deleted: tokenId };
  });

  // ---- Walls, doors, lights ----

  const wallType = z.enum(['wall', 'door-closed', 'door-open', 'door-locked', 'window']);

  tool('add_walls', `Add wall segments, doors and windows to a map in one batch (up to 5000 per map). ${COORDS} Each segment runs from (x1,y1) to (x2,y2) in map pixels; a door is a segment of type door-closed/door-open/door-locked across the doorway. Segments may reach up to 500 squares past the map edge; ones further out are skipped and reported. ${BACKUP_FIRST}`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    walls: z.array(z.object({ x1: pixel('Start x'), y1: pixel('Start y'), x2: pixel('End x'), y2: pixel('End y'), type: wallType.optional().describe('Default wall.') })).min(1).max(5000),
  }, async ({ campaignId, mapId, walls }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    const segments = walls.map((w) => ({ id: randomUUID(), ...w, type: w.type ?? 'wall' }));
    const answer = await ctx.api.json<{ added: WallRow[]; skipped: Array<{ index: number; reason: string }>; total: number }>(
      'POST', `/api/campaigns/${campaignId}/maps/${mapId}/walls/batch`, { json: { segments } });
    await manifest.add('wall', answer.added.map((w) => inMap(mapId, w.id)));
    return { added: answer.added.map((w) => ({ id: w.id, type: w.type })), skipped: answer.skipped, totalOnMap: answer.total };
  });

  tool('update_wall', 'Change the type of a wall segment (for example open, close or lock a door). Its position cannot be changed: delete it and add a new one. Opening, closing or locking a door is game state: with MISTWARDEN_MCP_COGM=1 any door, also on the map the players see. Any other change needs a segment this server created (or MISTWARDEN_MCP_ALLOW_ANY_EDIT=1), not on the map the players see.', {
    campaignId: campaignIdArg, mapId: mapIdArg, wallId: id('Wall segment id.'), type: wallType,
  }, async ({ campaignId, mapId, wallId, type }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const wall = ((await getMap(ctx, campaignId, mapId)).wallSegments ?? []).find((w) => w.id === wallId);
    if (!wall) throw new GuardError('No such wall segment on this map.');
    const doorState = wall.type.startsWith('door-') && type.startsWith('door-');
    if (doorState) assertPlayable(manifest, 'wall', inMap(mapId, wallId), ctx.settings);
    else assertEditable(manifest, 'wall', inMap(mapId, wallId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId, doorState);
    return (await ctx.api.json<{ segment: WallRow }>('PATCH', `/api/campaigns/${campaignId}/maps/${mapId}/walls/${wallId}`, { json: { type } })).segment;
  });

  tool('delete_walls', `Delete wall segments this server created, by id, up to 95 per call (one request each). Each is checked before any is deleted. Cannot be undone. ${BACKUP_NEEDED}`, {
    campaignId: campaignIdArg, mapId: mapIdArg, wallIds: z.array(z.string().uuid()).min(1).max(95),
  }, async ({ campaignId, mapId, wallIds }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    for (const w of wallIds) assertEditable(manifest, 'wall', inMap(mapId, w), ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    assertBackedUp(manifest, ctx.settings.backupMaxAgeHours);
    const deleted: string[] = [];
    for (const w of wallIds) {
      await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}/walls/${w}`);
      deleted.push(w);
      await manifest.remove('wall', [inMap(mapId, w)]);
    }
    return { deleted };
  });

  const lightShape = {
    x: pixel('Light x'), y: pixel('Light y'),
    brightRadius: z.number().min(0).max(100).describe('Bright light radius in SQUARES.'),
    dimRadius: z.number().min(0.5).max(100).describe('Dim light radius in SQUARES, at least brightRadius.'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Hex colour, default #ffd9a0 (warm candle light).'),
    enabled: z.boolean().optional().describe('Default true.'),
  };

  tool('add_light', `Add a light source to a map (up to 200 per map). Position in MAP PIXELS (origin top-left); radii in SQUARES. Lighting only shows when the map has lightingEnabled.`, {
    campaignId: campaignIdArg, mapId: mapIdArg, ...lightShape,
  }, async ({ campaignId, mapId, ...l }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    const { light } = await ctx.api.json<{ light: LightRow }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/lights`, {
      json: { id: randomUUID(), x: l.x, y: l.y, brightRadius: l.brightRadius, dimRadius: l.dimRadius, color: l.color ?? '#ffd9a0', enabled: l.enabled ?? true },
    });
    await manifest.add('light', [inMap(mapId, light.id)]);
    return light;
  });

  tool('update_light', 'Change a light. Position in MAP PIXELS (origin top-left), radii in SQUARES. Turning it on or off (enabled alone) is game state: with MISTWARDEN_MCP_COGM=1 any light, also on the map the players see. Any other change needs a light this server created (or MISTWARDEN_MCP_ALLOW_ANY_EDIT=1), not on the map the players see.', {
    campaignId: campaignIdArg, mapId: mapIdArg, lightId: id('Light id.'),
    x: lightShape.x.optional(), y: lightShape.y.optional(), brightRadius: lightShape.brightRadius.optional(), dimRadius: lightShape.dimRadius.optional(),
    color: lightShape.color, enabled: lightShape.enabled,
  }, async ({ campaignId, mapId, lightId, ...changes }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const onOff = Object.entries(changes).every(([k, v]) => v === undefined || k === 'enabled');
    if (onOff) assertPlayable(manifest, 'light', inMap(mapId, lightId), ctx.settings);
    else assertEditable(manifest, 'light', inMap(mapId, lightId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId, onOff);
    return (await ctx.api.json<{ light: LightRow }>('PATCH', `/api/campaigns/${campaignId}/maps/${mapId}/lights/${lightId}`, { json: changes })).light;
  });

  tool('delete_light', `Delete a light this server created. Cannot be undone. ${BACKUP_NEEDED}`, {
    campaignId: campaignIdArg, mapId: mapIdArg, lightId: id('Light id.'),
  }, async ({ campaignId, mapId, lightId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'light', inMap(mapId, lightId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId);
    assertBackedUp(manifest, ctx.settings.backupMaxAgeHours);
    await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}/lights/${lightId}`);
    await manifest.remove('light', [inMap(mapId, lightId)]);
    return { deleted: lightId };
  });

  // ---- Fog ----

  // Fog, explored areas and spell areas are game state.
  const mapStateGuard = async (campaignId: string, mapId: string) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertPlayable(manifest, 'map', mapId, ctx.settings);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId, true);
    return { campaign, manifest };
  };
  const fogOp = async (campaignId: string, mapId: string, body: unknown) =>
    fogSummary((await ctx.api.json<{ fogState: FogState }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/fog/operation`, { json: body })).fogState);
  const rect = {
    x: pixel('Left edge'), y: pixel('Top edge'),
    width: z.number().positive().describe('Width in map pixels.'), height: z.number().positive().describe('Height in map pixels.'),
  };
  const FOG = 'Needs fogEnabled on the map (update_map_settings). Only maps this server created, not the map players currently see; with MISTWARDEN_MCP_COGM=1 any map, that one too.';

  for (const [name, op, verb] of [['fog_reveal_rect', 'reveal', 'Reveal'], ['fog_hide_rect', 'hide', 'Hide']] as const) {
    tool(name, `${verb} the fog over every square a rectangle touches. Rectangle in MAP PIXELS, origin top-left. ${FOG}`, {
      campaignId: campaignIdArg, mapId: mapIdArg, ...rect,
    }, async ({ campaignId, mapId, ...r }) => {
      await mapStateGuard(campaignId, mapId);
      const map = await getMap(ctx, campaignId, mapId);
      const cells = fogCellsInRect(map, r);
      if (cells.length === 0) throw new GuardError('The rectangle does not touch the map.');
      return { cellsChanged: cells.length, ...(await fogOp(campaignId, mapId, { op, cells })) };
    });
  }
  for (const [name, op, verb] of [['fog_reveal_all', 'reveal_all', 'Reveal'], ['fog_hide_all', 'hide_all', 'Hide']] as const) {
    tool(name, `${verb} the whole map under fog. ${FOG}`, { campaignId: campaignIdArg, mapId: mapIdArg }, async ({ campaignId, mapId }) => {
      await mapStateGuard(campaignId, mapId);
      return fogOp(campaignId, mapId, { op });
    });
  }

  // ---- Notes ----

  tool('create_note', 'Create a private note (only this account sees it) in Markdown: GM notes, NPC descriptions, read-aloud texts. Up to 120 characters of title, 100000 of content, 200 notes per campaign. Refuses a title already used by one of your notes unless allowDuplicate is true.', {
    campaignId: campaignIdArg, title: z.string().min(1).max(120), markdown: z.string().max(100_000), allowDuplicate: z.boolean().optional(),
  }, async ({ campaignId, title, markdown, allowDuplicate }) => {
    const { manifest } = await campaignAsGm(ctx, campaignId);
    const { notes } = await ctx.api.json<{ notes: Array<{ title: string }> }>('GET', `/api/campaigns/${campaignId}/notes`);
    assertNewName('note', title, notes.map((n) => n.title), allowDuplicate);
    const { note } = await ctx.api.json<{ note: { id: string; title: string } }>('POST', `/api/campaigns/${campaignId}/notes`, { json: { title, content: markdown } });
    await manifest.add('note', [note.id]);
    return { noteId: note.id, title: note.title };
  });

  tool('update_note', 'Change the title or content of a note this server created. markdown REPLACES the whole content (read it first with get_note to append).', {
    campaignId: campaignIdArg, noteId: id('Note id.'), title: z.string().min(1).max(120).optional(), markdown: z.string().max(100_000).optional(),
  }, async ({ campaignId, noteId, title, markdown }) => {
    const { manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'note', noteId, ctx.settings.allowAnyEdit);
    const { note } = await ctx.api.json<{ note: { id: string; title: string; updatedAt: string } }>('PUT', `/api/campaigns/${campaignId}/notes/${noteId}`, { json: { title, content: markdown } });
    return { noteId: note.id, title: note.title, updatedAt: note.updatedAt };
  });

  // ---- Gallery ----

  tool('add_gallery_picture', 'Add a local picture (under MISTWARDEN_MCP_FILE_ROOT) to the campaign gallery, NOT shown to players. Pictures over 4096 px on a side are shrunk by the server. Refuses a name already in the gallery unless allowDuplicate is true.', {
    campaignId: campaignIdArg, path: z.string(), name: z.string().min(1).max(120), folder: z.string().max(80).optional(), allowDuplicate: z.boolean().optional(),
  }, async (a) => {
    const { manifest } = await campaignAsGm(ctx, a.campaignId);
    const { pictures } = await ctx.api.json<{ pictures: Array<{ name: string }> }>('GET', `/api/campaigns/${a.campaignId}/gallery`);
    assertNewName('gallery picture', a.name, pictures.map((p) => p.name), a.allowDuplicate);
    const { file, bytes } = await readLocal(ctx, a.path);
    const asset = await uploadPicture(ctx, a.campaignId, 'MAP', a.name, file, bytes, pictureInfo(bytes).mime);
    await manifest.add('asset', [asset.id]);
    const { picture } = await ctx.api.json<{ picture: { id: string; name: string; folder: string } }>('POST', `/api/campaigns/${a.campaignId}/gallery`, {
      json: { assetId: asset.id, name: a.name, folder: a.folder },
    });
    await manifest.add('gallery', [picture.id]);
    return { pictureId: picture.id, name: picture.name, folder: picture.folder, shown: false };
  });

  // ---- Map at a glance ----

  tool('get_map_summary', 'One map in brief: size, grid, settings, whether players see it now, and counts of tokens (visible and hidden), walls by type, doors, lights and spell areas. Use get_map or list_tokens for the objects themselves.', {
    campaignId: campaignIdArg, mapId: mapIdArg,
  }, async ({ campaignId, mapId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    const map = await getMap(ctx, campaignId, mapId);
    const { areas } = await ctx.api.json<{ areas: unknown[] }>('GET', `/api/campaigns/${campaignId}/maps/${mapId}/areas`);
    const tokens = map.tokens ?? [];
    const walls: Record<string, number> = {};
    for (const w of map.wallSegments ?? []) walls[w.type] = (walls[w.type] ?? 0) + 1;
    return {
      id: map.id, name: map.name, width: map.width, height: map.height, gridSize: map.gridSize, gridType: map.gridType ?? 'square',
      current: map.id === campaign.currentMapId, createdByThisServer: manifest.has('map', map.id),
      settings: { lightingEnabled: map.lightingEnabled, fogEnabled: map.fogEnabled, globalIllumination: map.globalIllumination, explorationEnabled: map.explorationEnabled, snapTokens: map.snapTokens ?? true },
      tokens: { total: tokens.length, visible: tokens.filter((t) => t.visible).length, hidden: tokens.filter((t) => !t.visible).length },
      wallCounts: walls, lights: (map.lights ?? []).length, areas: areas.length,
    };
  }, true);

  tool('list_tokens', `The tokens of a map with their game state: hit points, conditions, initiative, light, layer, and whether this server created each. ${COORDS}`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    name: z.string().max(200).optional().describe('Only tokens whose name contains this (any letter case).'),
  }, async ({ campaignId, mapId, name }) => {
    const { manifest } = await campaignAsGm(ctx, campaignId);
    const map = await getMap(ctx, campaignId, mapId);
    const needle = name?.toLocaleLowerCase();
    return (map.tokens ?? []).filter((t) => !needle || t.name.toLocaleLowerCase().includes(needle)).map((t) => tokenDetail(t, map, manifest));
  }, true);

  // ---- Creatures and spells ----

  tool('search_creatures', 'Search the creatures this campaign may use (the SRD, the instance\'s imported ones, the campaign\'s own) by name, challenge rating or source. Answers the first page (limit, offset) and the total.', {
    campaignId: campaignIdArg,
    query: z.string().max(200).optional().describe('Part of the name.'),
    challengeRating: z.string().max(10).optional().describe('Exactly, for example "1/4" or "5".'),
    source: z.string().max(100).optional().describe('"srd", "custom", or "custom:<tag>" for an import.'),
    limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional(),
  }, async (a) => {
    await campaignAsGm(ctx, a.campaignId);
    const q = new URLSearchParams();
    if (a.query) q.set('search', a.query);
    if (a.challengeRating) q.set('cr', a.challengeRating);
    if (a.source) q.set('source', a.source);
    q.set('limit', String(a.limit ?? 25));
    q.set('offset', String(a.offset ?? 0));
    const page = await ctx.api.json<{ creatures: Creature[]; total: number }>('GET', `/api/campaigns/${a.campaignId}/creatures?${q}`);
    return {
      total: page.total,
      creatures: page.creatures.map((c) => ({
        id: c.id, name: c.name, source: c.source, challengeRating: c.challengeRating, creatureType: c.creatureType,
        size: c.size?.width ?? 1, hpMax: c.statBlock?.hpMax ?? null, hasPicture: !!c.imageUrl,
      })),
    };
  }, true);

  tool('get_creature', 'One creature in full, with its stat block.', { campaignId: campaignIdArg, creatureId: id('Creature id (from search_creatures).') }, async ({ campaignId, creatureId }) => {
    await campaignAsGm(ctx, campaignId);
    return ctx.api.json('GET', `/api/campaigns/${campaignId}/creatures/${creatureId}`);
  }, true);

  tool('place_creature', `Put a creature on a map as a token, as the creature library does: its picture, size, stat block, full hit points and hit point bar; the symbol comes from the stat block. Hidden from players by default. ${COORDS} Not on the map players currently see unless MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_PLAYER_VISIBLE=1.`, {
    campaignId: campaignIdArg, mapId: mapIdArg, creatureId: id('Creature id (from search_creatures).'),
    ...tokenPosition,
    name: z.string().min(1).max(200).optional().describe('Default: the creature\'s name.'),
    visible: z.boolean().optional().describe('Seen by players. Default false (GM only).'),
    disposition: z.enum(['friendly', 'neutral', 'hostile']).optional().describe('Default: the creature\'s.'),
    nameHidden: tokenLook.nameHidden,
  }, async (a) => {
    const { campaign, manifest } = await campaignAsGm(ctx, a.campaignId);
    assertNotLive(ctx.settings, campaign.currentMapId, a.mapId, true);
    const map = await getMap(ctx, a.campaignId, a.mapId);
    const c = await ctx.api.json<Creature>('GET', `/api/campaigns/${a.campaignId}/creatures/${a.creatureId}`);
    const size = c.size ?? { width: 1, height: 1 };
    const position = toCell(map, a.x, a.y, a.origin, size.width);
    const hpMax = c.statBlock?.hpMax ?? 10;
    const { token } = await ctx.api.json<{ token: TokenRow }>('POST', `/api/campaigns/${a.campaignId}/maps/${a.mapId}/tokens`, {
      json: {
        name: a.name ?? c.name, imageUrl: c.imageUrl || undefined, position, size, type: 'npc', displayMode: c.displayMode ?? 'pog',
        disposition: a.disposition ?? c.disposition, hp: { current: hpMax, max: hpMax, temp: 0 },
        // Players see the HP of friendly and neutral NPCs, not of enemies or monsters.
        showHpBar: ['friendly', 'neutral'].includes((a.disposition ?? c.disposition) ?? ''), visible: a.visible ?? false,
        conditions: [], statBlock: c.statBlock, creatureTemplateId: c.id, nameHidden: a.nameHidden,
      },
    });
    await manifest.add('token', [inMap(a.mapId, token.id)]);
    return tokenDetail(token, map, manifest);
  });

  const listSpells = async (campaignId: string) => (await ctx.api.json<{ spells: Spell[] }>('GET', `/api/campaigns/${campaignId}/spells`)).spells;
  const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

  tool('list_spells', 'The spells this campaign may use (the SRD, the instance\'s imported ones, the campaign\'s own), filtered here by name and level: id, name, source, level, school, area ({ shape, sizeFt, widthFt } or null) and element.', {
    campaignId: campaignIdArg,
    query: z.string().max(200).optional().describe('Part of the name.'),
    level: z.number().int().min(0).max(9).optional().describe('0 for cantrips.'),
    limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
  }, async ({ campaignId, query, level, limit }) => {
    await campaignAsGm(ctx, campaignId);
    const needle = query?.toLocaleLowerCase();
    const found = (await listSpells(campaignId)).filter((s) => (!needle || s.name.toLocaleLowerCase().includes(needle)) && (level === undefined || s.level === level));
    return {
      total: found.length,
      spells: found.slice(0, limit ?? 50).map((s) => ({ id: s.id, name: s.name, source: s.source, level: s.level, school: s.school, area: s.area, element: s.element, concentration: s.concentration })),
    };
  }, true);

  tool('get_spell', 'One spell in full, with its description.', { campaignId: campaignIdArg, spellId: id('Spell id (from list_spells).') }, async ({ campaignId, spellId }) => {
    await campaignAsGm(ctx, campaignId);
    return ctx.api.json('GET', `/api/campaigns/${campaignId}/spells/${spellId}`);
  }, true);

  // ---- Spell areas (game state) ----

  const areaLook = {
    anchorX: pixel('Anchor x: the centre of a sphere, cylinder or cube, the point a cone or line starts from'),
    anchorY: pixel('Anchor y'),
    towardX: pixel('Aim x: a cone or line points from the anchor toward this point').optional(),
    towardY: pixel('Aim y').optional(),
    angleDegrees: z.number().min(-360).max(360).optional().describe('Instead of toward: the direction in degrees, 0 = right, 90 = down (y grows downward).'),
    element: z.enum(['fire', 'cold', 'water', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'thunder', 'force', 'psychic', 'none']).optional().describe('How it looks.'),
    label: z.string().max(60).optional(),
    audience: z.enum(['ALL', 'GM']).optional().describe('ALL (default): every reader of the map sees it. GM: only the GM.'),
  };
  const areaShape = {
    shape: z.enum(['sphere', 'cylinder', 'cone', 'line', 'cube']),
    sizeFt: z.number().int().min(5).max(500).describe('Radius (sphere, cylinder), length (cone, line) or side (cube), in feet.'),
    widthFt: z.number().int().min(5).max(100).optional().describe('A line\'s width in feet.'),
  };
  const AREAS = `Areas are game state: on maps this server created, or with MISTWARDEN_MCP_COGM=1 on any map, the one players see too. Anchor in MAP PIXELS (origin top-left).`;
  type AreaLook = { anchorX: number; anchorY: number; towardX?: number; towardY?: number; angleDegrees?: number; element?: string; label?: string; audience?: string };

  const placeArea = async (campaignId: string, mapId: string, look: AreaLook, shape: SpellArea, spellId: string | null, element: string | undefined, label: string | undefined) => {
    const { manifest } = await mapStateGuard(campaignId, mapId);
    if ((look.towardX === undefined) !== (look.towardY === undefined)) throw new GuardError('Give towardX and towardY together.');
    const angle = look.towardX !== undefined && look.towardY !== undefined
      ? Math.atan2(look.towardY - look.anchorY, look.towardX - look.anchorX)
      : ((look.angleDegrees ?? 0) * Math.PI) / 180;
    const area = {
      shape: shape.shape, anchorX: look.anchorX, anchorY: look.anchorY, angle, sizeFt: shape.sizeFt,
      widthFt: shape.shape === 'line' ? (shape.widthFt ?? 5) : null, element: element ?? 'none', label: label ?? null, spellId, audience: look.audience ?? 'ALL',
    };
    const { id: areaId } = await ctx.api.json<{ id: string }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/areas`, { json: { area } });
    await manifest.add('area', [inMap(mapId, areaId)]);
    return { areaId, ...area };
  };

  tool('place_area', `Place a spell-area template on a map. ${AREAS}`, {
    campaignId: campaignIdArg, mapId: mapIdArg, ...areaShape, ...areaLook,
  }, async ({ campaignId, mapId, shape, sizeFt, widthFt, ...look }) =>
    placeArea(campaignId, mapId, look, { shape, sizeFt, widthFt }, null, look.element, look.label));

  tool('place_spell_area', `Place the area of a spell, by spellId or spellName, as the server stores it; shape and sizeFt override it, and are needed for a spell with no area. A name used by more than one spell is refused with the candidates. ${AREAS}`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    spellId: id('Spell id (from list_spells).').optional(), spellName: z.string().min(1).max(200).optional(),
    shape: areaShape.shape.optional(), sizeFt: areaShape.sizeFt.optional(), widthFt: areaShape.widthFt,
    ...areaLook,
  }, async ({ campaignId, mapId, spellId, spellName, shape, sizeFt, widthFt, ...look }) => {
    await campaignAsGm(ctx, campaignId);
    let spell: Spell;
    if (spellId) {
      spell = await ctx.api.json<Spell>('GET', `/api/campaigns/${campaignId}/spells/${spellId}`);
    } else if (spellName) {
      const matches = (await listSpells(campaignId)).filter((s) => sameName(s.name, spellName));
      if (matches.length === 0) throw new GuardError(`No spell named "${spellName}". Find it with list_spells.`);
      if (matches.length > 1) {
        throw new GuardError(`More than one spell is named "${spellName}"; call again with spellId: ${JSON.stringify(matches.map((s) => ({ id: s.id, source: s.source, area: s.area })))}`);
      }
      spell = matches[0];
    } else {
      throw new GuardError('Give spellId or spellName.');
    }
    const stored = spell.area;
    const areaOf: SpellArea | null = shape && sizeFt ? { shape, sizeFt, widthFt } : stored ? { ...stored, ...(shape ? { shape } : {}), ...(sizeFt ? { sizeFt } : {}), ...(widthFt ? { widthFt } : {}) } : null;
    if (!areaOf) throw new GuardError(`"${spell.name}" has no area stored: give shape and sizeFt (and widthFt for a line).`);
    return placeArea(campaignId, mapId, look, areaOf, spell.id, look.element ?? spell.element, look.label ?? spell.name.slice(0, 60));
  });

  tool('list_areas', 'The spell areas on a map, with their ids.', { campaignId: campaignIdArg, mapId: mapIdArg }, async ({ campaignId, mapId }) => {
    const { manifest } = await campaignAsGm(ctx, campaignId);
    const { areas } = await ctx.api.json<{ areas: Array<{ id: string }> }>('GET', `/api/campaigns/${campaignId}/maps/${mapId}/areas`);
    return areas.map((a) => ({ ...a, createdByThisServer: manifest.has('area', inMap(mapId, a.id)) }));
  }, true);

  tool('remove_area', 'Erase one spell area: one this server placed, or with MISTWARDEN_MCP_COGM=1 any.', {
    campaignId: campaignIdArg, mapId: mapIdArg, areaId: id('Area id (from list_areas).'),
  }, async ({ campaignId, mapId, areaId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertPlayable(manifest, 'area', inMap(mapId, areaId), ctx.settings);
    assertNotLive(ctx.settings, campaign.currentMapId, mapId, true);
    await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}/areas/${areaId}`);
    await manifest.remove('area', [inMap(mapId, areaId)]);
    return { removed: areaId };
  });

  tool('clear_areas', 'Erase every spell area on a map, the players\' too. Needs MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.', {
    campaignId: campaignIdArg, mapId: mapIdArg,
  }, async ({ campaignId, mapId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    if (!ctx.settings.coGm && !ctx.settings.allowAnyEdit) throw new GuardError('Refused: clearing removes areas this server did not place. Use remove_area, or start the server with MISTWARDEN_MCP_COGM=1.');
    assertNotLive(ctx.settings, campaign.currentMapId, mapId, true);
    await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}/areas`);
    await manifest.remove('area', manifest.ids('area').filter((k) => k.startsWith(`${mapId}/`)));
    return { cleared: mapId };
  });

  tool('reset_exploration', 'Forget what the players have explored on a map (their greyed-in memory). Game state: maps this server created, or with MISTWARDEN_MCP_COGM=1 any map, the one players see too.', {
    campaignId: campaignIdArg, mapId: mapIdArg,
  }, async ({ campaignId, mapId }) => {
    await mapStateGuard(campaignId, mapId);
    await ctx.api.json('POST', `/api/campaigns/${campaignId}/maps/${mapId}/exploration/reset`);
    return { reset: mapId };
  });

  // ---- Table: chat, dice, initiative, sessions, time of day ----

  const TABLE = 'Seen by the whole table: only with MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_PLAYER_VISIBLE=1.';
  const tableTools = ctx.settings.coGm || ctx.settings.playerVisible;

  tool('roll_dice', 'Roll dice as the GM, for example "1d20+5" or "4d6kh3". A secret roll (secret: true) goes to the GM alone and needs no switch; a public one is seen by the table and needs MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_PLAYER_VISIBLE=1.', {
    campaignId: campaignIdArg, expression: z.string().min(1).max(200),
    secret: z.boolean().optional().describe('Default false.'),
    purpose: z.string().max(200).optional().describe('What the roll is for, shown with it.'),
    characterName: z.string().max(200).optional().describe('Who rolls, shown with it.'),
  }, async ({ campaignId, ...roll }) => {
    await campaignAsGm(ctx, campaignId);
    if (!roll.secret) assertTableAction(ctx.settings, 'a public roll');
    return (await ctx.api.json<{ roll: unknown }>('POST', `/api/campaigns/${campaignId}/dice-rolls`, { json: roll })).roll;
  });

  tool('get_messages', 'The newest chat messages (whispers only where this account sent or received them), newest first; pass the answer\'s cursor for older ones.', {
    campaignId: campaignIdArg, limit: z.number().int().min(1).max(100).optional().describe('Default 30.'), cursor: z.string().max(500).optional(),
  }, async ({ campaignId, limit, cursor }) => {
    await campaignAsGm(ctx, campaignId);
    const q = new URLSearchParams({ limit: String(limit ?? 30) });
    if (cursor) q.set('cursor', cursor);
    return ctx.api.json('GET', `/api/campaigns/${campaignId}/messages?${q}`);
  }, true);

  tool('get_dice_rolls', 'The newest dice rolls, secret ones included (the GM sees all).', {
    campaignId: campaignIdArg, limit: z.number().int().min(1).max(100).optional().describe('Default 30.'), offset: z.number().int().min(0).optional(),
  }, async ({ campaignId, limit, offset }) => {
    await campaignAsGm(ctx, campaignId);
    return ctx.api.json('GET', `/api/campaigns/${campaignId}/dice-rolls?${new URLSearchParams({ limit: String(limit ?? 30), offset: String(offset ?? 0) })}`);
  }, true);

  tool('get_initiative', 'The initiative order as the GM sees it: round, whose turn, each combatant with its token.', { campaignId: campaignIdArg }, async ({ campaignId }) => {
    await campaignAsGm(ctx, campaignId);
    return (await ctx.api.json<{ state: unknown }>('GET', `/api/campaigns/${campaignId}/initiative`)).state;
  }, true);

  tool('list_sessions', 'The campaign\'s sessions, newest first (up to 50), with their recaps; one without endedAt is still open (running or paused, see the campaign status).', { campaignId: campaignIdArg }, async ({ campaignId }) => {
    await campaignAsGm(ctx, campaignId);
    return (await ctx.api.json<{ sessions: unknown[] }>('GET', `/api/campaigns/${campaignId}/sessions`)).sessions;
  }, true);

  if (tableTools) {
    type WithCampaign<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>> & { campaignId: string };
    const table = <S extends z.ZodRawShape>(name: string, description: string, shape: S, fn: (args: WithCampaign<S>) => Promise<unknown>) =>
      tool(name, `TABLE: ${description} ${TABLE}`, { campaignId: campaignIdArg, ...shape }, async (args) => {
        const a = args as unknown as WithCampaign<S>;
        await campaignAsGm(ctx, a.campaignId);
        return fn(a);
      });
    const post = async (route: string, json?: unknown) => ctx.api.json<Record<string, unknown>>('POST', route, { json });
    const put = async (route: string, json?: unknown) => ctx.api.json<Record<string, unknown>>('PUT', route, { json });
    const c = (args: { campaignId: string }) => `/api/campaigns/${args.campaignId}`;
    const openSession = async (campaignId: string) => {
      const { sessions } = await ctx.api.json<{ sessions: Array<{ id: string; endedAt: string | null }> }>('GET', `/api/campaigns/${campaignId}/sessions`);
      const open = sessions.find((s) => !s.endedAt);
      if (!open) throw new GuardError('No session is open: start one with start_session.');
      return open.id;
    };

    table('send_chat', 'Send a chat message as the GM to everyone in the campaign.', { content: z.string().min(1).max(2000) }, async (a) =>
      (await post(`${c(a)}/messages`, { content: a.content })).message);
    table('send_whisper', 'Whisper a chat message to one member (user id from get_campaign); only they and the GM see it.', {
      recipientId: z.string().uuid(), content: z.string().min(1).max(2000),
    }, async (a) => (await post(`${c(a)}/messages`, { content: a.content, recipientId: a.recipientId })).message);

    const tokenOnMap = { mapId: mapIdArg, tokenIds: z.array(z.string().min(1).max(100)).min(1).max(50).describe('Token ids (from list_tokens).') };
    table('start_combat', 'Begin combat with the combatants in the order: round 1, the first one acting.', {}, async (a) => (await post(`${c(a)}/initiative/start`)).state);
    table('next_turn', 'Pass the turn to the next combatant; after the last a new round begins.', {}, async (a) => (await post(`${c(a)}/initiative/next`)).state);
    table('end_combat', 'End combat and clear the order.', {}, async (a) => (await post(`${c(a)}/initiative/end`)).state);
    table('add_to_initiative', 'Add tokens of one map to the order, unrolled, at the bottom.', tokenOnMap, async (a) => {
      let state: unknown;
      for (const tokenId of a.tokenIds) state = (await post(`${c(a)}/initiative/combatants`, { tokenId, mapId: a.mapId })).state;
      return state;
    });
    table('roll_initiative', 'Roll initiative for tokens of one map, as the GM: the server works out the roll from the token\'s sheet or stat block (expression only where neither applies); a token not yet in the order joins it.', {
      ...tokenOnMap, expression: z.string().max(100).optional().describe('For example "1d20+2"; used only for a token without sheet or stat block.'),
    }, async (a) => {
      const rolled: unknown[] = [];
      let state: unknown;
      for (const tokenId of a.tokenIds) {
        const answer = await post(`${c(a)}/initiative/roll`, { tokenId, mapId: a.mapId, expression: a.expression });
        rolled.push({ tokenId, value: answer.value, rolled: answer.rolled });
        state = answer.state;
      }
      return { rolled, state };
    });
    table('remove_from_initiative', 'Take a combatant out of the order; the turn passes on if it was theirs.', { tokenId: z.string().min(1).max(100) }, async (a) =>
      (await ctx.api.json<{ state: unknown }>('DELETE', `${c(a)}/initiative/combatants/${encodeURIComponent(a.tokenId)}`)).state);
    table('set_initiative', 'Set a combatant\'s initiative by hand, or clear it with null.', { tokenId: z.string().min(1).max(100), value: z.number().nullable() }, async (a) =>
      (await put(`${c(a)}/initiative/combatants/${encodeURIComponent(a.tokenId)}`, { value: a.value })).state);
    table('set_initiative_order', 'Put the combatants in this order; those left out keep their places after the ones named.', {
      tokenIds: z.array(z.string().min(1).max(100)).min(1).max(200),
    }, async (a) => (await put(`${c(a)}/initiative/order`, { tokenIds: a.tokenIds })).state);

    table('set_vibe', 'Switch the time of day (vibe period) by name: its colour and track reach every member, and the chat gets a note.', { period: z.string().min(1).max(100) }, async (a) =>
      put(`${c(a)}/vibe/current`, { period: a.period }));
    table('set_atmosphere', 'Set the weather over the map (effect, null clears it) and/or the ambient track (audioAssetId of an audio asset, null stops it).', {
      effect: z.string().max(50).nullable().optional().describe('A weather effect name; the server lists the allowed ones when refusing.'),
      audioAssetId: z.string().uuid().nullable().optional(), volume: z.number().min(0).max(1).optional(), loop: z.boolean().optional(),
    }, async (a) => {
      if (a.effect === undefined && a.audioAssetId === undefined) throw new GuardError('Give effect and/or audioAssetId.');
      const out: Record<string, unknown> = {};
      if (a.effect !== undefined) Object.assign(out, await put(`${c(a)}/atmosphere/effect`, { effect: a.effect }));
      if (a.audioAssetId !== undefined) Object.assign(out, await put(`${c(a)}/atmosphere/audio`, { assetId: a.audioAssetId, volume: a.volume, loop: a.loop }));
      return out;
    });
    table('update_campaign', 'Change the campaign\'s name, description, status (PREPARATION, COMPLETED or ARCHIVED, between sessions only), whether players may draw, the chat cooldown, or the vibe settings (vibeSettings REPLACES the periods: read them first).', {
      name: z.string().min(1).max(200).optional(), description: z.string().max(5000).nullable().optional(),
      status: z.enum(['PREPARATION', 'COMPLETED', 'ARCHIVED']).optional(), playersMayDraw: z.boolean().optional(),
      chatCooldownEnabled: z.boolean().optional(), chatCooldownSeconds: z.number().int().min(1).max(300).optional(),
      vibeSettings: z.object({ enabled: z.boolean().optional(), periods: z.array(z.object({ name: z.string(), hue: z.string(), filter: z.string(), audio: z.string().nullable().optional() })).min(1) }).passthrough().optional(),
    }, async ({ campaignId, name, description, status, playersMayDraw, chatCooldownEnabled, chatCooldownSeconds, vibeSettings }) => {
      // Only these fields: no game system, no spirit layer, nothing about members.
      const { campaign } = await put(`/api/campaigns/${campaignId}`, { name, description, status, playersMayDraw, chatCooldownEnabled, chatCooldownSeconds, vibeSettings });
      return campaign;
    });

    table('start_session', 'Start a new session (none may be open).', {}, async (a) => (await post(`${c(a)}/sessions`)).session);
    table('pause_session', 'Pause the open session.', {}, async (a) => put(`${c(a)}/sessions/${await openSession(a.campaignId)}/pause`));
    table('resume_session', 'Resume the paused session.', {}, async (a) => (await put(`${c(a)}/resume`)).session);
    table('end_session', 'End the open session, with an optional recap every member can read.', {
      notes: z.string().max(10_000).optional(), saveState: z.boolean().optional().describe('Default true: token positions are saved with it.'),
    }, async (a) => put(`${c(a)}/sessions/${await openSession(a.campaignId)}/end`, { notes: a.notes, saveState: a.saveState }));
    table('set_session_notes', 'Rewrite the recap of an ended session (empty clears it); every member can read it.', {
      sessionId: id('Session id (from list_sessions).'), notes: z.string().max(10_000),
    }, async (a) => (await put(`${c(a)}/sessions/${a.sessionId}/notes`, { notes: a.notes })).session);
  }

  // ---- Characters ----

  tool('list_characters', 'The campaign\'s members with their characters (id, name, hit points, picture); no sheets.', { campaignId: campaignIdArg }, async ({ campaignId }) => {
    await campaignAsGm(ctx, campaignId);
    return (await ctx.api.json<{ roster: unknown[] }>('GET', `/api/campaigns/${campaignId}/characters`)).roster;
  }, true);

  interface CharacterRow { id: string; userId: string; campaignId: string | null; name: string; updatedAt: string; data: unknown }
  const characterIn = async (campaignId: string, characterId: string) => {
    assertUuid(characterId, 'characterId');
    const { character } = await ctx.api.json<{ character: CharacterRow }>('GET', `/api/characters/${characterId}`);
    if (character.campaignId !== campaignId) throw new GuardError('That character is not in this campaign.');
    return character;
  };

  tool('get_character', 'One character of the campaign with its whole sheet (data) and updatedAt, which update_character needs.', {
    campaignId: campaignIdArg, characterId: id('Character id (from list_characters).'),
  }, async ({ campaignId, characterId }) => {
    await campaignAsGm(ctx, campaignId);
    return characterIn(campaignId, characterId);
  }, true);

  tool('update_character', `Change named top-level fields of a character's sheet (fields: { field: new value }), and/or its name, as the GM. Only the fields named change; the rest of the sheet is kept. Pass the updatedAt that get_character gave: a character changed since is refused. Character sheets are NOT in create_backup, so the sheet as it was is first saved to a local file (named in the answer). Players see the change at once. A character of this account needs MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_ALLOW_ANY_EDIT=1; anyone else's (a player's) needs MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.`, {
    campaignId: campaignIdArg, characterId: id('Character id.'),
    updatedAt: z.string().max(40).describe('updatedAt from get_character.'),
    name: z.string().min(1).max(200).optional(),
    fields: z.record(z.string().min(1).max(100), z.unknown()).optional().describe('Top-level sheet fields to set, each replaced whole.'),
  }, async ({ campaignId, characterId, updatedAt, name, fields }) => {
    await campaignAsGm(ctx, campaignId);
    if (name === undefined && (!fields || Object.keys(fields).length === 0)) throw new GuardError('Give name and/or fields.');
    const character = await characterIn(campaignId, characterId);
    const { user } = await once('me', () => ctx.api.json<{ user: { id: string } }>('GET', '/api/auth/me'));
    const own = character.userId === user.id;
    if (!ctx.settings.allowAnyEdit && !(own && ctx.settings.coGm)) {
      throw new GuardError(own
        ? 'Refused: changing characters needs MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.'
        : "Refused: this is another member's character, and its sheet is not in create_backup. Change it in Mistwarden, or start the server with MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.");
    }
    if (character.updatedAt !== updatedAt) throw new GuardError(`Refused: the character changed at ${character.updatedAt}, after the updatedAt given. Read it again with get_character.`);
    // Saved before the write: the export does not hold player sheets.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const savedTo = path.join(ctx.settings.backupDir, 'characters', campaignId, `${characterId}-${stamp}.json`);
    await writePrivateJson(savedTo, character);
    const sheet = character.data && typeof character.data === 'object' && !Array.isArray(character.data) ? character.data as Record<string, unknown> : {};
    const data = fields ? { ...sheet, ...fields } : undefined;
    const { character: saved } = await ctx.api.json<{ character: unknown }>('PUT', `/api/characters/${characterId}`, { json: { name, data, updatedAt } });
    return { character: saved, changedFields: Object.keys(fields ?? {}), previousSheetSavedTo: savedTo };
  });

  // ---- Local files ----

  tool('list_files', 'List the text files (.md, .txt, .json, .csv) under MISTWARDEN_MCP_FILE_ROOT (or a folder in it), with sizes. Hidden files and folders are skipped; up to 500 entries.', {
    folder: z.string().max(500).optional().describe('A folder relative to the root; default the root.'),
  }, async ({ folder }) => walkFiles(ctx.settings.fileRoot, folder), true);

  tool('search_files', 'Find text files under MISTWARDEN_MCP_FILE_ROOT whose path or lines contain the query (any letter case): up to 50 files, 3 lines each.', {
    query: z.string().min(2).max(200), folder: z.string().max(500).optional(),
  }, async ({ query, folder }) => searchFiles(ctx.settings.fileRoot, query, folder), true);

  tool('read_file', 'Read a text file (.md, .txt, .json, .csv) under MISTWARDEN_MCP_FILE_ROOT, up to 100000 characters at a time; pass nextOffset for the rest.', {
    path: z.string().max(1000), offset: z.number().int().min(0).optional(), maxChars: z.number().int().min(1).max(100_000).optional(),
  }, async (a) => readTextFile(ctx.settings.fileRoot, a.path, a.offset, a.maxChars), true);

  // ---- Instance library (platform admins only) ----

  const sourceTag = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/).describe('1 to 32 lower-case letters, digits and dashes: the imports\' name, and the way to delete them again.');
  const INSTANCE = 'INSTANCE-WIDE (platform admins only): every campaign of the instance sees what is imported. create_backup does NOT cover it; the way back is the delete tool for the same sourceTag.';
  const importReport = (body: { rows?: unknown[] } & Record<string, unknown>) => ({ ...body, rows: body.rows?.slice(0, 100), rowsShown: Math.min(body.rows?.length ?? 0, 100) });
  const importBody = async (file: string) => {
    const read = await readTextFile(ctx.settings.fileRoot, file, 0, 900_000);
    if (read.truncated) throw new GuardError(`Refused: ${file} holds more than 900000 characters, the most one import takes. Split it.`);
    return read.text;
  };

  tool('import_creatures_markdown', `Import stat blocks from a Markdown file under MISTWARDEN_MCP_FILE_ROOT into the instance's creatures, under a sourceTag. DRY RUN by default (dryRun: true): answers what would be imported, updated and skipped; call again with dryRun: false to write. ${INSTANCE}`, {
    path: z.string().max(1000), sourceTag, onlyUnderHeading: z.string().max(200).optional().describe('Only the blocks under this heading.'),
    dryRun: z.boolean().optional().describe('Default true.'),
  }, async (a) => importReport(await ctx.api.json('POST', '/api/creatures/import-markdown', {
    json: { markdown: await importBody(a.path), sourceTag: a.sourceTag, onlyUnderHeading: a.onlyUnderHeading, dryRun: a.dryRun ?? true },
  })));

  tool('import_spells_markdown', `Import spells from a Markdown file under MISTWARDEN_MCP_FILE_ROOT into the instance's spells, under a sourceTag. DRY RUN by default (dryRun: true); call again with dryRun: false to write. ${INSTANCE}`, {
    path: z.string().max(1000), sourceTag, dryRun: z.boolean().optional().describe('Default true.'),
  }, async (a) => importReport(await ctx.api.json('POST', '/api/spells/import-markdown', {
    json: { markdown: await importBody(a.path), sourceTag: a.sourceTag, dryRun: a.dryRun ?? true },
  })));

  for (const [name, route, what] of [['delete_imported_creatures', '/api/creatures/imported/', 'creatures'], ['delete_imported_spells', '/api/spells/imported/', 'spells']] as const) {
    tool(name, `Delete every ${what} imported under a sourceTag. Cannot be undone; needs confirm: true. ${INSTANCE}`, {
      sourceTag, confirm: z.literal(true).describe('Must be true.'),
    }, async (a) => ctx.api.json('DELETE', `${route}${a.sourceTag}`));
  }

  tool('match_token_pictures', `Give imported creatures without a picture the server's token picture of their name (all imports, or one sourceTag). ${INSTANCE}`, {
    sourceTag: sourceTag.optional(),
  }, async ({ sourceTag: tag }) => ctx.api.json('POST', '/api/creatures/match-token-pictures', { json: { sourceTag: tag } }));

  // ---- Player-visible (behind MISTWARDEN_MCP_PLAYER_VISIBLE=1) ----

  if (ctx.settings.playerVisible) {
    tool('set_current_map', 'PLAYER-VISIBLE: switch the whole table to this map now.', { campaignId: campaignIdArg, mapId: mapIdArg }, async ({ campaignId, mapId }) => {
      await campaignAsGm(ctx, campaignId);
      assertUuid(mapId, 'mapId');
      await ctx.api.json('PUT', `/api/campaigns/${campaignId}/maps/${mapId}/set-current`);
      return { currentMapId: mapId };
    });

    tool('show_gallery_picture', 'PLAYER-VISIBLE: show a gallery picture to all players or to chosen players (user ids from get_campaign); an empty playerIds with toAll false hides it again. Only pictures this server added unless MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.', {
      campaignId: campaignIdArg, pictureId: id('Gallery picture id.'), toAll: z.boolean().optional(), playerIds: z.array(z.string().uuid()).max(100).optional(),
    }, async ({ campaignId, pictureId, toAll, playerIds }) => {
      const { manifest } = await campaignAsGm(ctx, campaignId);
      assertEditable(manifest, 'gallery', pictureId, ctx.settings.allowAnyEdit);
      const { picture } = await ctx.api.json<{ picture: unknown }>('PATCH', `/api/campaigns/${campaignId}/gallery/${pictureId}`, {
        json: { shownToAll: toAll ?? false, shownTo: playerIds ?? [] },
      });
      return picture;
    });

    tool('share_document', 'PLAYER-VISIBLE: create a Markdown document and share it with every member of the campaign (a handout). Give markdown text or a .md/.txt path under MISTWARDEN_MCP_FILE_ROOT.', {
      campaignId: campaignIdArg, name: z.string().min(1).max(200), markdown: z.string().optional(), path: z.string().optional(), description: z.string().max(1000).optional(),
    }, async (a) => {
      const { manifest } = await campaignAsGm(ctx, a.campaignId);
      const content = a.markdown ?? (a.path ? (await readLocal(ctx, a.path)).bytes.toString('utf8') : undefined);
      if (content === undefined) throw new GuardError('Give markdown or path.');
      // USER scope, then a link: a CAMPAIGN-scope document is listed to members as soon as it exists.
      const { asset } = await ctx.api.json<{ asset: { id: string } }>('POST', '/api/assets/documents', {
        json: { name: a.name, description: a.description, format: 'md', content, scope: 'USER' },
      });
      await manifest.add('document', [asset.id]);
      await ctx.api.json('POST', `/api/campaigns/${a.campaignId}/documents`, { json: { assetId: asset.id } });
      return { documentId: asset.id, shared: true };
    });
  }

  return names;
}

