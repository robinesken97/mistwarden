// Added for Mistwarden on 2026-11-28.
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readTextFile, searchFiles, walkFiles } from '../src/files.ts';

let dir: string;
let root: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mistwarden-files-'));
  root = path.join(dir, 'root');
  await mkdir(path.join(root, 'notes', 'chapter-1'), { recursive: true });
  await mkdir(path.join(root, '.git'), { recursive: true });
  await mkdir(path.join(root, 'maps'), { recursive: true });
  await writeFile(path.join(root, 'notes', 'chapter-1', 'crypt.md'), '# The crypt\n\nThe iron door is locked.\nA second line.\n');
  await writeFile(path.join(root, 'notes', 'npcs.txt'), 'Oswin, the gravekeeper\n');
  await writeFile(path.join(root, 'notes', '.secret.md'), 'iron key under the mat\n');
  await writeFile(path.join(root, '.git', 'config.txt'), 'iron token=abc\n');
  await writeFile(path.join(root, 'maps', 'crypt.png'), 'not really a png');
  await writeFile(path.join(root, 'maps', 'tool.sh'), 'echo iron');
  await writeFile(path.join(dir, 'outside.md'), 'iron outside\n');
  await symlink(path.join(dir, 'outside.md'), path.join(root, 'notes', 'link.md'));
  await symlink(path.join(root, '.git'), path.join(root, 'notes', 'git-link'));
});

describe('list_files', () => {
  it('lists text files, pictures and map files, skipping hidden ones and links leading out or into hidden folders', async () => {
    const { files, truncated } = await walkFiles(root);
    expect(truncated).toBe(false);
    expect(files.map((f) => [f.path, f.kind])).toEqual([
      [path.join('maps', 'crypt.png'), 'picture'],
      [path.join('notes', 'npcs.txt'), 'text'],
      [path.join('notes', 'chapter-1', 'crypt.md'), 'text'],
    ]);
  });

  it('caps the entries, and refuses folders outside, hidden or missing', async () => {
    expect(await walkFiles(root, '.', 1)).toMatchObject({ truncated: true, files: [{ path: path.join('maps', 'crypt.png') }] });
    await expect(walkFiles(root, '..')).rejects.toThrow(/outside/);
    await expect(walkFiles(root, '.git')).rejects.toThrow(/hidden/);
    await expect(walkFiles(root, 'nope')).rejects.toThrow(/No such folder/);
    await expect(walkFiles(null)).rejects.toThrow(/MISTWARDEN_MCP_FILE_ROOT/);
  });
});

describe('search_files', () => {
  it('finds names and lines, never in hidden files or outside the root', async () => {
    const { hits } = await searchFiles(root, 'IRON');
    expect(hits).toEqual([{ path: path.join('notes', 'chapter-1', 'crypt.md'), kind: 'text', nameMatches: false, lines: [{ line: 3, text: 'The iron door is locked.' }] }]);
    expect((await searchFiles(root, 'crypt')).hits.map((h) => [h.path, h.nameMatches])).toEqual([
      [path.join('maps', 'crypt.png'), true],
      [path.join('notes', 'chapter-1', 'crypt.md'), true],
    ]);
    await expect(searchFiles(root, 'i')).rejects.toThrow(/at least 2/);
  });
});

describe('read_file', () => {
  it('reads text in parts', async () => {
    const first = await readTextFile(root, 'notes/chapter-1/crypt.md', 0, 11);
    expect(first).toMatchObject({ text: '# The crypt', truncated: true, nextOffset: 11 });
    const rest = await readTextFile(root, 'notes/chapter-1/crypt.md', first.nextOffset ?? 0);
    expect(rest.truncated).toBe(false);
    expect(rest.text).toMatch(/^\n\nThe iron door/);
  });

  it('refuses paths outside, hidden files, links leading out, and anything but text', async () => {
    await expect(readTextFile(root, '../outside.md')).rejects.toThrow(/outside/);
    await expect(readTextFile(root, 'notes/link.md')).rejects.toThrow(/outside/);
    await expect(readTextFile(root, 'notes/.secret.md')).rejects.toThrow(/hidden/);
    await expect(readTextFile(root, '.git/config.txt')).rejects.toThrow(/hidden/);
    await expect(readTextFile(root, 'notes/git-link/config.txt')).rejects.toThrow(/hidden/);
    await expect(readTextFile(root, 'maps/tool.sh')).rejects.toThrow(/only text files/);
    await expect(readTextFile(root, 'maps/crypt.png')).rejects.toThrow(/only text files/);
  });
});
