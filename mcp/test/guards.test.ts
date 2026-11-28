// Added for Mistwarden on 2026-11-27.
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertBackedUp, assertEditable, assertNewName, assertNotLive, assertPlayable, assertTableAction, GuardError, inMap, Manifest, resolveInRoot,
} from '../src/guards.ts';

const CAMPAIGN = '11111111-2222-4333-8444-555555555555';
const MAP = '66666666-7777-4888-9999-000000000000';
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mistwarden-mcp-'));
});

describe('manifest guard', () => {
  it('lets through only what the server created', async () => {
    const manifest = await Manifest.load(dir, CAMPAIGN);
    await manifest.add('token', [inMap(MAP, 'tok-1')]);
    expect(() => assertEditable(manifest, 'token', inMap(MAP, 'tok-1'), false)).not.toThrow();
    expect(() => assertEditable(manifest, 'token', inMap(MAP, 'tok-2'), false)).toThrow(GuardError);
    // The same id on another map is another token.
    expect(() => assertEditable(manifest, 'token', inMap(CAMPAIGN, 'tok-1'), false)).toThrow(/not created by this MCP server/);
  });

  it('is lifted by the override', async () => {
    const manifest = await Manifest.load(dir, CAMPAIGN);
    expect(() => assertEditable(manifest, 'map', MAP, true)).not.toThrow();
  });

  it('survives a restart, owner-only, and forgets what was deleted', async () => {
    const first = await Manifest.load(dir, CAMPAIGN);
    await first.add('map', [MAP]);
    const again = await Manifest.load(dir, CAMPAIGN);
    expect(again.has('map', MAP)).toBe(true);
    expect((await stat(again.file)).mode & 0o777).toBe(0o600);
    await again.remove('map', [MAP]);
    expect((await Manifest.load(dir, CAMPAIGN)).has('map', MAP)).toBe(false);
    const onDisk = JSON.parse(await readFile(again.file, 'utf8'));
    expect(onDisk.campaignId).toBe(CAMPAIGN);
    expect(onDisk.items.map).toEqual([]);
  });

  it('keeps every id when creates run side by side', async () => {
    const [a, b] = await Promise.all([Manifest.load(dir, CAMPAIGN), Manifest.load(dir, CAMPAIGN)]);
    await Promise.all([a.add('wall', ['w1']), b.add('wall', ['w2']), a.add('light', ['l1'])]);
    const onDisk = JSON.parse(await readFile(a.file, 'utf8')).items;
    expect(onDisk.wall).toEqual(['w1', 'w2']);
    expect(onDisk.light).toEqual(['l1']);
  });

  it('refuses a campaign id that is not a UUID, so no path can be built from it', async () => {
    await expect(Manifest.load(dir, '../../etc')).rejects.toThrow(GuardError);
  });
});

describe('file root guard', () => {
  it('reads below the root, relative or absolute', async () => {
    const root = path.join(dir, 'root');
    await mkdir(path.join(root, 'maps'), { recursive: true });
    await writeFile(path.join(root, 'maps', 'cave.png'), 'x');
    const real = await resolveInRoot(root, 'maps/cave.png');
    expect(real.endsWith(path.join('maps', 'cave.png'))).toBe(true);
    expect(await resolveInRoot(root, real)).toBe(real);
  });

  it('refuses paths outside, by .. or by a symbolic link', async () => {
    const root = path.join(dir, 'root');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(dir, 'secret.txt'), 'x');
    await symlink(path.join(dir, 'secret.txt'), path.join(root, 'link.txt'));
    await expect(resolveInRoot(root, '../secret.txt')).rejects.toThrow(/outside/);
    await expect(resolveInRoot(root, path.join(dir, 'secret.txt'))).rejects.toThrow(/outside/);
    await expect(resolveInRoot(root, 'link.txt')).rejects.toThrow(/outside/);
  });

  it('refuses the root itself, folders, missing files, and an unset root', async () => {
    const root = path.join(dir, 'root');
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await expect(resolveInRoot(root, '.')).rejects.toThrow(/outside/);
    await expect(resolveInRoot(root, 'sub')).rejects.toThrow(/Not a file/);
    await expect(resolveInRoot(root, 'nope.png')).rejects.toThrow(/No such file/);
    await expect(resolveInRoot(null, 'a.png')).rejects.toThrow(/MISTWARDEN_MCP_FILE_ROOT/);
  });
});

describe('duplicate guard', () => {
  it('refuses a name in use, whatever its case and spacing', () => {
    expect(() => assertNewName('map', ' mistvale crypt ', ['Mistvale Crypt'])).toThrow(/already exists/);
    expect(() => assertNewName('map', 'Mistvale Crypt', ['Mistvale Crypt'], true)).not.toThrow();
    expect(() => assertNewName('map', 'Oswin\'s Tower', ['Mistvale Crypt'])).not.toThrow();
  });
});

// Mistwarden, 2026-11-28: co-GM mode, the table switch and the backup age.
const OFF = { allowAnyEdit: false, playerVisible: false, coGm: false };

describe('co-GM mode', () => {
  it('lets game state through on what the server did not create, but not edits or deletes', async () => {
    const manifest = await Manifest.load(dir, CAMPAIGN);
    const foreign = inMap(MAP, 'placed-by-hand');
    expect(() => assertPlayable(manifest, 'token', foreign, OFF)).toThrow(/MISTWARDEN_MCP_COGM=1/);
    expect(() => assertPlayable(manifest, 'token', foreign, { ...OFF, coGm: true })).not.toThrow();
    // Deleting, renaming, replacing stay bound to the manifest.
    expect(() => assertEditable(manifest, 'token', foreign, false)).toThrow(/not created by this MCP server/);
    await manifest.add('token', [inMap(MAP, 'own')]);
    expect(() => assertPlayable(manifest, 'token', inMap(MAP, 'own'), OFF)).not.toThrow();
  });

  it('allows game state on the map players see, other changes only with the player-visible switch', () => {
    expect(() => assertNotLive(OFF, MAP, MAP, true)).toThrow(/players currently see/);
    expect(() => assertNotLive({ ...OFF, coGm: true }, MAP, MAP, true)).not.toThrow();
    expect(() => assertNotLive({ ...OFF, coGm: true }, MAP, MAP, false)).toThrow(/PLAYER_VISIBLE/);
    expect(() => assertNotLive({ ...OFF, playerVisible: true }, MAP, MAP, false)).not.toThrow();
    expect(() => assertNotLive(OFF, null, MAP, false)).not.toThrow();
  });

  it('gates the table actions behind co-GM or player-visible', () => {
    expect(() => assertTableAction(OFF, 'chat')).toThrow(/whole table/);
    expect(() => assertTableAction({ ...OFF, coGm: true }, 'chat')).not.toThrow();
    expect(() => assertTableAction({ ...OFF, playerVisible: true }, 'chat')).not.toThrow();
    // The edit override is not a table switch.
    expect(() => assertTableAction({ ...OFF, allowAnyEdit: true }, 'chat')).toThrow(GuardError);
  });
});

describe('backup before deleting', () => {
  it('refuses without a backup, or with one too old, and remembers it across a restart', async () => {
    const manifest = await Manifest.load(dir, CAMPAIGN);
    expect(() => assertBackedUp(manifest, 6)).toThrow(/none made from here yet/);
    const now = Date.parse('2026-11-28T12:00:00Z');
    await manifest.recordBackup(new Date(now - 5 * 3_600_000));
    expect(() => assertBackedUp(manifest, 6, now)).not.toThrow();
    expect(() => assertBackedUp(manifest, 4, now)).toThrow(/last 4 h/);
    // A time from the future (a clock that went wrong) does not count.
    await manifest.recordBackup(new Date(now + 3_600_000));
    expect(() => assertBackedUp(manifest, 6, now)).toThrow(GuardError);
    await manifest.recordBackup(new Date(now));
    await manifest.add('map', [MAP]);
    const onDisk = JSON.parse(await readFile(manifest.file, 'utf8'));
    expect(onDisk.lastBackupAt).toBe('2026-11-28T12:00:00.000Z');
    expect(onDisk.items.map).toEqual([MAP]);
  });
});
