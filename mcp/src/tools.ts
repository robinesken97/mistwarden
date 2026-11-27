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
import type { Settings } from './config.ts';
import { assertPlaceable, cellFromTop, fogCellsInRect, gridForPicture, isHexMap, topRowOf } from './coords.ts';
import { assertEditable, assertNewName, assertUuid, GuardError, inMap, Manifest, resolveInRoot } from './guards.ts';
import { type Api, ApiError } from './http.ts';
import { pictureInfo } from './image.ts';

// ---- Shapes the server answers with (only the fields used here) -----------

interface Member { userId: string; role: string; user?: { displayName?: string } }
interface MapRow {
  id: string; name: string; width: number; height: number; gridSize: number; feetPerSquare?: number;
  gridType?: string; gridOffsetX?: number; gridOffsetY?: number; snapTokens?: boolean;
  lightingEnabled?: boolean; fogEnabled?: boolean; globalIllumination?: boolean; explorationEnabled?: boolean;
  tokens?: TokenRow[]; wallSegments?: WallRow[]; lights?: LightRow[];
}
interface Campaign { id: string; name: string; userRole: string; currentMapId: string | null; memberships: Member[]; maps: MapRow[] }
interface TokenRow {
  id: string; name: string; position: { x: number; y: number }; size: { width: number; height: number };
  visible: boolean; controlledBy: string | null; sightRadius?: number; type?: string; disposition?: string | null; layer?: string;
  mountedOn?: string | null;
}
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
      return text(await fn(args));
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

async function campaignAsGm(ctx: Context, campaignId: string): Promise<{ campaign: Campaign; manifest: Manifest }> {
  assertUuid(campaignId, 'campaignId');
  const { campaign } = await ctx.api.json<{ campaign: Campaign }>('GET', `/api/campaigns/${campaignId}`);
  if (campaign.userRole !== 'GM') throw new GuardError(`Refused: this account is not the GM of "${campaign.name}".`);
  return { campaign, manifest: await Manifest.load(ctx.settings.stateDir, campaignId) };
}

/** A change on the map the players are looking at reaches them at once; that needs the player-visible switch. */
function assertNotLive(ctx: Context, campaign: Campaign, mapId: string): void {
  if (!ctx.settings.playerVisible && campaign.currentMapId === mapId) {
    throw new GuardError(
      'Refused: this is the map the players currently see, so the change would reach them immediately. ' +
        'Work on another map, or start the server with MISTWARDEN_MCP_PLAYER_VISIBLE=1.',
    );
  }
}

async function getMap(ctx: Context, campaignId: string, mapId: string): Promise<MapRow> {
  assertUuid(mapId, 'mapId');
  return (await ctx.api.json<{ map: MapRow }>('GET', `/api/campaigns/${campaignId}/maps/${mapId}`)).map;
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

  tool('create_backup', `Download an export of the campaign (maps with their pictures, tokens, notes) to a local folder. The gallery is not in it: a picture shown only in the gallery is lost with its file, and a map picture keeps its file but not its gallery name, folder or sharing. ${BACKUP_FIRST} The server allows only a few exports per hour.`, { campaignId: campaignIdArg }, async ({ campaignId }) => {
    const { campaign } = await campaignAsGm(ctx, campaignId);
    const started = Date.now();
    const res = await ctx.api.request('GET', `/api/campaigns/${campaignId}/export`);
    if (!res.ok || !res.body) throw new ApiError(res.status, `Export failed (${res.status}): ${await res.text()}`, null);
    await mkdir(ctx.settings.backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(ctx.settings.backupDir, `campaign-${campaignId}-${stamp}.zip`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(file, { mode: 0o600 }));
    const { size } = await stat(file);
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

  tool('update_map_settings', `Change a map's name or settings. Only maps this server created (unless MISTWARDEN_MCP_ALLOW_ANY_EDIT=1), and not the map the players currently see (unless MISTWARDEN_MCP_PLAYER_VISIBLE=1). Turning fog on starts with everything hidden.`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
    name: z.string().min(1).max(200).optional(),
    feetPerSquare: z.number().int().min(1).max(100).optional(),
    diagonalRule: z.enum(['flat', 'alternating']).optional(),
    lightingEnabled: z.boolean().optional().describe('Dynamic lighting with walls blocking sight.'),
    fogEnabled: z.boolean().optional().describe('Fog of war; needed before the fog tools work.'),
    globalIllumination: z.boolean().optional().describe('Everything lit, as by daylight.'),
    explorationEnabled: z.boolean().optional().describe('Remember what player tokens have seen.'),
    snapTokens: z.boolean().optional().describe('Tokens stand on whole squares (default). Off lets tokens stop between squares; turning it on moves every token to its nearest square. A hex map always snaps.'),
  }, async ({ campaignId, mapId, ...changes }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'map', mapId, ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
    const { map } = await ctx.api.json<{ map: MapRow }>('PUT', `/api/campaigns/${campaignId}/maps/${mapId}`, { json: changes });
    return { id: map.id, name: map.name, lightingEnabled: map.lightingEnabled, fogEnabled: map.fogEnabled, globalIllumination: map.globalIllumination, explorationEnabled: map.explorationEnabled, snapTokens: map.snapTokens ?? true };
  });

  tool('delete_map', `Delete a map with its tokens, walls and lights. Only maps this server created (unless MISTWARDEN_MCP_ALLOW_ANY_EDIT=1); never the map players currently see without MISTWARDEN_MCP_PLAYER_VISIBLE=1. Cannot be undone. ${BACKUP_FIRST}`, {
    campaignId: campaignIdArg, mapId: mapIdArg,
  }, async ({ campaignId, mapId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'map', mapId, ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
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

  tool('add_token', `Add a token to a map. Hidden from players by default (visible: false). ${COORDS} Size is in squares (1 = medium, 2 = large, 3 = huge). Not on the map players currently see unless MISTWARDEN_MCP_PLAYER_VISIBLE=1.`, {
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
    assertNotLive(ctx, campaign, a.mapId);
    const map = await getMap(ctx, a.campaignId, a.mapId);
    const size = a.size ?? 1;
    const position = toCell(map, a.x, a.y, a.origin, size);
    let imageUrl: string | undefined;
    if (a.imagePath) {
      const { file, bytes } = await readLocal(ctx, a.imagePath);
      const asset = await uploadPicture(ctx, a.campaignId, 'TOKEN', a.name, file, bytes, pictureInfo(bytes).mime);
      await manifest.add('asset', [asset.id]);
      imageUrl = asset.id;
    }
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

  tool('update_token', `Move or change a token this server created. ${COORDS} Give x and y together to move it.`, {
    campaignId: campaignIdArg, mapId: mapIdArg, tokenId: id('Token id (from get_map).'),
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
  }, async (a) => {
    const { campaign, manifest } = await campaignAsGm(ctx, a.campaignId);
    assertEditable(manifest, 'token', inMap(a.mapId, a.tokenId), ctx.settings.allowAnyEdit);
    // A rider moves its mount, so the mount must be this server's to change too.
    if (a.mountedOn) assertEditable(manifest, 'token', inMap(a.mapId, a.mountedOn), ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, a.mapId);
    const map = await getMap(ctx, a.campaignId, a.mapId);
    const current = (map.tokens ?? []).find((t) => t.id === a.tokenId);
    if (!current) throw new GuardError('No such token on this map.');
    if ((a.x === undefined) !== (a.y === undefined)) throw new GuardError('Give x and y together.');
    const size = a.size ?? current.size.width;
    const body: Record<string, unknown> = {
      name: a.name, visible: a.visible, sightRadius: a.darkvision, type: a.type, disposition: a.disposition, controlledBy: a.controlledBy, notes: a.notes, mountedOn: a.mountedOn,
      icon: a.icon, nameHidden: a.nameHidden,
      size: a.size !== undefined ? { width: size, height: size } : undefined,
      position: a.x !== undefined && a.y !== undefined ? toCell(map, a.x, a.y, a.origin, size) : undefined,
    };
    const { token } = await ctx.api.json<{ token: TokenRow }>('PUT', `/api/campaigns/${a.campaignId}/maps/${a.mapId}/tokens/${a.tokenId}`, { json: body });
    return tokenSummary(token, map);
  });

  tool('delete_token', 'Remove a token this server created from a map. Cannot be undone.', {
    campaignId: campaignIdArg, mapId: mapIdArg, tokenId: id('Token id.'),
  }, async ({ campaignId, mapId, tokenId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'token', inMap(mapId, tokenId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
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
    assertNotLive(ctx, campaign, mapId);
    const segments = walls.map((w) => ({ id: randomUUID(), ...w, type: w.type ?? 'wall' }));
    const answer = await ctx.api.json<{ added: WallRow[]; skipped: Array<{ index: number; reason: string }>; total: number }>(
      'POST', `/api/campaigns/${campaignId}/maps/${mapId}/walls/batch`, { json: { segments } });
    await manifest.add('wall', answer.added.map((w) => inMap(mapId, w.id)));
    return { added: answer.added.map((w) => ({ id: w.id, type: w.type })), skipped: answer.skipped, totalOnMap: answer.total };
  });

  tool('update_wall', 'Change the type of a wall segment this server created (for example open, close or lock a door). Its position cannot be changed: delete it and add a new one.', {
    campaignId: campaignIdArg, mapId: mapIdArg, wallId: id('Wall segment id.'), type: wallType,
  }, async ({ campaignId, mapId, wallId, type }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'wall', inMap(mapId, wallId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
    return (await ctx.api.json<{ segment: WallRow }>('PATCH', `/api/campaigns/${campaignId}/maps/${mapId}/walls/${wallId}`, { json: { type } })).segment;
  });

  tool('delete_walls', 'Delete wall segments this server created, by id. Each is checked before any is deleted. Cannot be undone.', {
    campaignId: campaignIdArg, mapId: mapIdArg, wallIds: z.array(z.string().uuid()).min(1).max(5000),
  }, async ({ campaignId, mapId, wallIds }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    for (const w of wallIds) assertEditable(manifest, 'wall', inMap(mapId, w), ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
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
    assertNotLive(ctx, campaign, mapId);
    const { light } = await ctx.api.json<{ light: LightRow }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/lights`, {
      json: { id: randomUUID(), x: l.x, y: l.y, brightRadius: l.brightRadius, dimRadius: l.dimRadius, color: l.color ?? '#ffd9a0', enabled: l.enabled ?? true },
    });
    await manifest.add('light', [inMap(mapId, light.id)]);
    return light;
  });

  tool('update_light', 'Change a light this server created. Position in MAP PIXELS (origin top-left), radii in SQUARES.', {
    campaignId: campaignIdArg, mapId: mapIdArg, lightId: id('Light id.'),
    x: lightShape.x.optional(), y: lightShape.y.optional(), brightRadius: lightShape.brightRadius.optional(), dimRadius: lightShape.dimRadius.optional(),
    color: lightShape.color, enabled: lightShape.enabled,
  }, async ({ campaignId, mapId, lightId, ...changes }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'light', inMap(mapId, lightId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
    return (await ctx.api.json<{ light: LightRow }>('PATCH', `/api/campaigns/${campaignId}/maps/${mapId}/lights/${lightId}`, { json: changes })).light;
  });

  tool('delete_light', 'Delete a light this server created. Cannot be undone.', {
    campaignId: campaignIdArg, mapId: mapIdArg, lightId: id('Light id.'),
  }, async ({ campaignId, mapId, lightId }) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'light', inMap(mapId, lightId), ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
    await ctx.api.json('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}/lights/${lightId}`);
    await manifest.remove('light', [inMap(mapId, lightId)]);
    return { deleted: lightId };
  });

  // ---- Fog ----

  const fogGuard = async (campaignId: string, mapId: string) => {
    const { campaign, manifest } = await campaignAsGm(ctx, campaignId);
    assertEditable(manifest, 'map', mapId, ctx.settings.allowAnyEdit);
    assertNotLive(ctx, campaign, mapId);
  };
  const fogOp = async (campaignId: string, mapId: string, body: unknown) =>
    fogSummary((await ctx.api.json<{ fogState: FogState }>('POST', `/api/campaigns/${campaignId}/maps/${mapId}/fog/operation`, { json: body })).fogState);
  const rect = {
    x: pixel('Left edge'), y: pixel('Top edge'),
    width: z.number().positive().describe('Width in map pixels.'), height: z.number().positive().describe('Height in map pixels.'),
  };
  const FOG = 'Needs fogEnabled on the map (update_map_settings). Only maps this server created, not the map players currently see.';

  for (const [name, op, verb] of [['fog_reveal_rect', 'reveal', 'Reveal'], ['fog_hide_rect', 'hide', 'Hide']] as const) {
    tool(name, `${verb} the fog over every square a rectangle touches. Rectangle in MAP PIXELS, origin top-left. ${FOG}`, {
      campaignId: campaignIdArg, mapId: mapIdArg, ...rect,
    }, async ({ campaignId, mapId, ...r }) => {
      await fogGuard(campaignId, mapId);
      const map = await getMap(ctx, campaignId, mapId);
      const cells = fogCellsInRect(map, r);
      if (cells.length === 0) throw new GuardError('The rectangle does not touch the map.');
      return { cellsChanged: cells.length, ...(await fogOp(campaignId, mapId, { op, cells })) };
    });
  }
  for (const [name, op, verb] of [['fog_reveal_all', 'reveal_all', 'Reveal'], ['fog_hide_all', 'hide_all', 'Hide']] as const) {
    tool(name, `${verb} the whole map under fog. ${FOG}`, { campaignId: campaignIdArg, mapId: mapIdArg }, async ({ campaignId, mapId }) => {
      await fogGuard(campaignId, mapId);
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

