// Added for Mistwarden on 2026-11-27.
// Where the server keeps its files, and the switches it reads from the environment.

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Settings {
  sessionFile: string;
  /** Folder of the session file; the manifests sit beside it. */
  stateDir: string;
  backupDir: string;
  fileRoot: string | null;
  allowAnyEdit: boolean;
  playerVisible: boolean;
  /** Co-GM mode: game state (hit points, positions, doors, fog, initiative...) of anything, and the table actions. */
  coGm: boolean;
  /** How recent a create_backup must be before a delete. */
  backupMaxAgeHours: number;
}

export function readSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const sessionFile = env.MISTWARDEN_SESSION_FILE || path.join(os.homedir(), '.config', 'mistwarden-mcp', 'session.json');
  const stateDir = path.dirname(sessionFile);
  return {
    sessionFile,
    stateDir,
    backupDir: env.MISTWARDEN_MCP_BACKUP_DIR || path.join(stateDir, 'backups'),
    fileRoot: env.MISTWARDEN_MCP_FILE_ROOT || null,
    allowAnyEdit: env.MISTWARDEN_MCP_ALLOW_ANY_EDIT === '1',
    playerVisible: env.MISTWARDEN_MCP_PLAYER_VISIBLE === '1',
    coGm: env.MISTWARDEN_MCP_COGM === '1',
    backupMaxAgeHours: positive(env.MISTWARDEN_MCP_BACKUP_MAX_AGE_HOURS) ?? 6,
  };
}

function positive(value: string | undefined): number | null {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : null;
}

export interface Session {
  baseUrl: string;
  /** "name=value" of the session cookie, as sent back in a Cookie header. */
  cookie: string;
  savedAt: string;
}

export class NotLoggedIn extends Error {}

export const LOGIN_HINT = 'Run `npm run login` in the mcp/ folder of the Mistwarden repository, then try again.';

export async function readSession(file: string): Promise<Session> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new NotLoggedIn(`No Mistwarden session found at ${file}. ${LOGIN_HINT}`);
  }
  const data = JSON.parse(raw) as Partial<Session>;
  if (typeof data.baseUrl !== 'string' || typeof data.cookie !== 'string') {
    throw new NotLoggedIn(`The session file ${file} is incomplete. ${LOGIN_HINT}`);
  }
  return { baseUrl: data.baseUrl.replace(/\/+$/, ''), cookie: data.cookie, savedAt: data.savedAt ?? '' };
}

/** Writes JSON readable by the owner only, atomically (temp file, then rename). */
export async function writePrivateJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created; make sure either way.
  await chmod(temp, 0o600);
  await rename(temp, file);
}
