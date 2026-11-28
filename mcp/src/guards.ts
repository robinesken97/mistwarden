// Added for Mistwarden on 2026-11-27.
// The safety checks: the manifest of what this server created, the file root,
// and the duplicate-name refusal.

import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { type Settings, writePrivateJson } from './config.ts';

export const KINDS = ['map', 'token', 'wall', 'light', 'note', 'gallery', 'document', 'asset', 'area'] as const;
export type Kind = (typeof KINDS)[number];

export class GuardError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, what: string): void {
  if (!UUID.test(value)) throw new GuardError(`${what} must be an id (a UUID), got "${value}".`);
}

/** Tokens, walls and lights live inside a map; their manifest key carries the map id. */
export const inMap = (mapId: string, id: string) => `${mapId}/${id}`;

interface ManifestData {
  campaignId: string;
  items: Record<Kind, string[]>;
  /** When create_backup last succeeded for this campaign (ISO time). */
  lastBackupAt?: string;
}

/** The ids of everything this server created in one campaign, in a JSON file beside the session file. */
// One instance per file, so tool calls running side by side share the ids.
const loaded = new Map<string, Promise<Manifest>>();

export class Manifest {
  readonly file: string;
  private data: ManifestData;
  private saving: Promise<void> = Promise.resolve();

  private constructor(file: string, data: ManifestData) {
    this.file = file;
    this.data = data;
  }

  static async load(stateDir: string, campaignId: string): Promise<Manifest> {
    assertUuid(campaignId, 'campaignId');
    const file = path.join(stateDir, `manifest-${campaignId.toLowerCase()}.json`);
    let manifest = loaded.get(file);
    if (!manifest) {
      manifest = Manifest.read(file, campaignId);
      loaded.set(file, manifest);
      manifest.catch(() => loaded.delete(file));
    }
    return manifest;
  }

  private static async read(file: string, campaignId: string): Promise<Manifest> {
    const empty = Object.fromEntries(KINDS.map((k) => [k, [] as string[]])) as Record<Kind, string[]>;
    let items = empty;
    let lastBackupAt: string | undefined;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<ManifestData>;
      items = { ...empty, ...(parsed.items ?? {}) };
      lastBackupAt = typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return new Manifest(file, { campaignId, items, lastBackupAt });
  }

  has(kind: Kind, id: string): boolean {
    return this.data.items[kind].includes(id);
  }

  ids(kind: Kind): readonly string[] {
    return this.data.items[kind];
  }

  /** Saved straight away, so a crash after a create still leaves the id on record. */
  async add(kind: Kind, ids: string[]): Promise<void> {
    const list = this.data.items[kind];
    for (const id of ids) if (!list.includes(id)) list.push(id);
    await this.save();
  }

  async remove(kind: Kind, ids: string[]): Promise<void> {
    this.data.items[kind] = this.data.items[kind].filter((id) => !ids.includes(id));
    await this.save();
  }

  get lastBackupAt(): string | null {
    return this.data.lastBackupAt ?? null;
  }

  async recordBackup(at: Date = new Date()): Promise<void> {
    this.data.lastBackupAt = at.toISOString();
    await this.save();
  }

  /** Writes one at a time, each with the latest ids. */
  private save(): Promise<void> {
    this.saving = this.saving.catch(() => undefined).then(() => writePrivateJson(this.file, this.data));
    return this.saving;
  }
}

/** Refuses a change to something this server did not create, unless the override is on. */
export function assertEditable(manifest: Manifest, kind: Kind, id: string, allowAnyEdit: boolean): void {
  if (allowAnyEdit || manifest.has(kind, id)) return;
  throw new GuardError(
    `Refused: this ${kind} (${id}) was not created by this MCP server, so it may not be changed or deleted from here. ` +
      'Change it in Mistwarden itself, or start the server with MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.',
  );
}

type Switches = Pick<Settings, 'allowAnyEdit' | 'playerVisible' | 'coGm'>;

/**
 * Refuses a change of GAME STATE (hit points, conditions, position, a door opened, fog, areas) to
 * something this server did not create, unless co-GM mode or the edit override is on.
 */
export function assertPlayable(manifest: Manifest, kind: Kind, id: string, s: Switches): void {
  if (s.coGm || s.allowAnyEdit || manifest.has(kind, id)) return;
  throw new GuardError(
    `Refused: this ${kind} (${id}) was not created by this MCP server. ` +
      'Start the server with MISTWARDEN_MCP_COGM=1 to run the game on everything (hit points, positions, doors, fog), ' +
      'or with MISTWARDEN_MCP_ALLOW_ANY_EDIT=1.',
  );
}

/**
 * A change on the map the players are looking at reaches them at once: it needs the player-visible
 * switch, or co-GM mode for a game-state change.
 */
export function assertNotLive(s: Switches, currentMapId: string | null, mapId: string, gameState = false): void {
  if (s.playerVisible || (gameState && s.coGm) || currentMapId !== mapId) return;
  throw new GuardError(
    'Refused: this is the map the players currently see, so the change would reach them immediately. ' +
      (gameState
        ? 'Work on another map, or start the server with MISTWARDEN_MCP_COGM=1 (game state) or MISTWARDEN_MCP_PLAYER_VISIBLE=1.'
        : 'Work on another map, or start the server with MISTWARDEN_MCP_PLAYER_VISIBLE=1.'),
  );
}

/** Chat, public rolls, initiative, the session, time of day: everyone at the table sees them. */
export function assertTableAction(s: Switches, what: string): void {
  if (s.playerVisible || s.coGm) return;
  throw new GuardError(`Refused: ${what} is seen by the whole table. Start the server with MISTWARDEN_MCP_COGM=1 or MISTWARDEN_MCP_PLAYER_VISIBLE=1.`);
}

/** Deleting needs a create_backup of the campaign from the last `maxAgeHours`. */
export function assertBackedUp(manifest: Manifest, maxAgeHours: number, now = Date.now()): void {
  const at = manifest.lastBackupAt ? Date.parse(manifest.lastBackupAt) : NaN;
  if (Number.isFinite(at) && now - at <= maxAgeHours * 3_600_000 && at <= now + 60_000) return;
  throw new GuardError(
    `Refused: deleting needs a backup of this campaign from the last ${maxAgeHours} h ` +
      `(${manifest.lastBackupAt ? `the last was at ${manifest.lastBackupAt}` : 'none made from here yet'}). Call create_backup first.`,
  );
}

/**
 * The real path of `requested` (absolute, or relative to the root), refused
 * unless it is a file below the root once symbolic links are followed.
 */
export async function resolveInRoot(fileRoot: string | null, requested: string): Promise<string> {
  if (!fileRoot) {
    throw new GuardError('Reading local files is off: set MISTWARDEN_MCP_FILE_ROOT to the folder holding the maps and pictures.');
  }
  const root = await realpath(fileRoot);
  let real: string;
  try {
    real = await realpath(path.resolve(root, requested));
  } catch {
    throw new GuardError(`No such file: ${requested}`);
  }
  const relative = path.relative(root, real);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new GuardError(`Refused: ${requested} is outside MISTWARDEN_MCP_FILE_ROOT (${root}).`);
  }
  if (!(await stat(real)).isFile()) throw new GuardError(`Not a file: ${requested}`);
  return real;
}

const normalName = (name: string) => name.trim().toLocaleLowerCase();

/** Refuses a name already in use, so re-running a build does not pile up copies. */
export function assertNewName(what: string, name: string, existing: Iterable<string>, allowDuplicate = false): void {
  if (allowDuplicate) return;
  for (const other of existing) {
    if (normalName(other) === normalName(name)) {
      throw new GuardError(
        `Refused: a ${what} named "${other}" already exists in this campaign. Reuse it, pick another name, or pass allowDuplicate: true.`,
      );
    }
  }
}
