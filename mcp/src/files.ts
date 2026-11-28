// Added for Mistwarden on 2026-11-28.
// Listing, searching and reading the files under MISTWARDEN_MCP_FILE_ROOT:
// each entry by its real path, hidden files and folders skipped, text read
// from text files only, every answer bounded.

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { GuardError, resolveInRoot } from './guards.ts';

export const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.csv'];
/** The files the other tools take (pictures, map files): listed and found by name, never read as text here. */
export const PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
export const MAP_FILE_EXTENSIONS = ['.uvtt', '.dd2vtt', '.df2vtt'];

export const FILE_LIMITS = {
  listEntries: 500,
  depth: 8,
  searchHits: 50,
  searchFiles: 2000,
  matchesPerFile: 3,
  grepBytes: 2_000_000,
  readChars: 100_000,
  readBytes: 10_000_000,
  snippet: 160,
};

export type FileKind = 'text' | 'picture' | 'map file';
export interface FileEntry { path: string; bytes: number; kind: FileKind }

const kindOf = (file: string): FileKind | null => {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (PICTURE_EXTENSIONS.includes(ext)) return 'picture';
  if (MAP_FILE_EXTENSIONS.includes(ext)) return 'map file';
  return null;
};

async function rootOf(fileRoot: string | null): Promise<string> {
  if (!fileRoot) {
    throw new GuardError('Reading local files is off: set MISTWARDEN_MCP_FILE_ROOT to the folder holding the notes, maps and pictures.');
  }
  return realpath(fileRoot);
}

/** `real` relative to the root; null when it lies outside or under a hidden name. */
function inside(root: string, real: string): string | null {
  const relative = path.relative(root, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (relative.split(path.sep).some((part) => part.startsWith('.'))) return null;
  return relative;
}

/** The files below a folder of the root, breadth first, up to `maxEntries`. */
export async function walkFiles(fileRoot: string | null, folder = '.', maxEntries = FILE_LIMITS.listEntries): Promise<{ files: FileEntry[]; truncated: boolean }> {
  const root = await rootOf(fileRoot);
  let start: string;
  try {
    start = await realpath(path.resolve(root, folder));
  } catch {
    throw new GuardError(`No such folder: ${folder}`);
  }
  if (inside(root, start) === null) throw new GuardError(`Refused: ${folder} is outside MISTWARDEN_MCP_FILE_ROOT (${root}) or hidden.`);
  if (!(await stat(start)).isDirectory()) throw new GuardError(`Not a folder: ${folder}`);

  const files: FileEntry[] = [];
  const seen = new Set([start]);
  let level = [start];
  for (let depth = 0; depth <= FILE_LIMITS.depth && level.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const name of (await readdir(dir)).sort()) {
        if (name.startsWith('.')) continue;
        // Each entry by its real path: a link leading out of the root, or into a hidden folder, is skipped.
        const real = await realpath(path.join(dir, name)).catch(() => null);
        const relative = real && inside(root, real);
        if (!real || !relative) continue;
        const info = await stat(real).catch(() => null);
        if (info?.isDirectory()) {
          if (!seen.has(real)) next.push(real);
          seen.add(real);
          continue;
        }
        const kind = info?.isFile() ? kindOf(real) : null;
        if (!info || !kind) continue;
        if (files.length >= maxEntries) return { files, truncated: true };
        files.push({ path: relative, bytes: info.size, kind });
      }
    }
    level = next;
  }
  return { files, truncated: false };
}

export interface SearchHit { path: string; kind: FileKind; nameMatches: boolean; lines: Array<{ line: number; text: string }> }

/** Files whose path contains `query`, and text files with lines that do (any letter case). */
export async function searchFiles(fileRoot: string | null, query: string, folder = '.'): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  const needle = query.toLocaleLowerCase();
  if (needle.trim().length < 2) throw new GuardError('Search for at least 2 characters.');
  const root = await rootOf(fileRoot);
  const { files, truncated: tooMany } = await walkFiles(fileRoot, folder, FILE_LIMITS.searchFiles);
  const hits: SearchHit[] = [];
  for (const file of files) {
    const nameMatches = file.path.toLocaleLowerCase().includes(needle);
    const lines: SearchHit['lines'] = [];
    if (file.kind === 'text' && file.bytes <= FILE_LIMITS.grepBytes) {
      const content = await readFile(path.join(root, file.path), 'utf8');
      const all = content.split(/\r?\n/);
      for (let i = 0; i < all.length && lines.length < FILE_LIMITS.matchesPerFile; i++) {
        const at = all[i].toLocaleLowerCase().indexOf(needle);
        if (at < 0) continue;
        const from = Math.max(0, at - 60);
        lines.push({ line: i + 1, text: all[i].slice(from, from + FILE_LIMITS.snippet).trim() });
      }
    }
    if (!nameMatches && lines.length === 0) continue;
    if (hits.length >= FILE_LIMITS.searchHits) return { hits, truncated: true };
    hits.push({ path: file.path, kind: file.kind, nameMatches, lines });
  }
  return { hits, truncated: tooMany };
}

/** Part of a text file under the root: `maxChars` characters from `offset`. */
export async function readTextFile(fileRoot: string | null, requested: string, offset = 0, maxChars = FILE_LIMITS.readChars) {
  const root = await rootOf(fileRoot);
  const real = await resolveInRoot(fileRoot, requested);
  const relative = inside(root, real);
  if (relative === null) throw new GuardError(`Refused: ${requested} is hidden (a name starting with a dot).`);
  if (kindOf(real) !== 'text') throw new GuardError(`Refused: only text files are read (${TEXT_EXTENSIONS.join(', ')}).`);
  const { size } = await stat(real);
  if (size > FILE_LIMITS.readBytes) throw new GuardError(`Refused: ${requested} is ${size} bytes, over the ${FILE_LIMITS.readBytes} read here.`);
  const content = await readFile(real, 'utf8');
  const text = content.slice(offset, offset + maxChars);
  const end = offset + text.length;
  return { path: relative, totalChars: content.length, offset, text, truncated: end < content.length, nextOffset: end < content.length ? end : null };
}
