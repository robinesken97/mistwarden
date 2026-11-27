// Added for Mistwarden on 2026-11-27.
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { assertEditable, assertNewName, GuardError, inMap, Manifest, resolveInRoot } from '../src/guards.ts';

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
    expect(JSON.parse(await readFile(again.file, 'utf8')).campaignId).toBe(CAMPAIGN);
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
