// Added for Mistwarden on 2026-11-27.
// Signs in once (with the two-factor code if the account has one) and keeps
// only the session cookie and the address, in a file only its owner can read.
// Interactive on a terminal; with piped input it reads one answer per line
// (address, email, password, code), which is how the tests drive it.

import readline from 'node:readline';
import { readSession, readSettings, writePrivateJson } from './config.ts';

type Ask = (question: string, hidden?: boolean) => Promise<string>;

function asker(): { ask: Ask; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
  if (!process.stdin.isTTY) {
    // One iterator for every answer: lines that arrive before a question is asked stay buffered.
    const lines = rl[Symbol.asyncIterator]();
    return {
      ask: async (question) => {
        process.stderr.write(question);
        const next = await lines.next();
        process.stderr.write('\n');
        return next.done ? '' : String(next.value).trim();
      },
      close: () => rl.close(),
    };
  }
  let muted = false;
  const output = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = output._writeToOutput.bind(rl);
  output._writeToOutput = (s: string) => write(muted && !s.includes('\n') && !s.startsWith('\r') ? '' : s);
  return {
    ask: (question, hidden = false) =>
      new Promise((resolve) => {
        rl.question(question, (answer) => {
          muted = false;
          if (hidden) process.stderr.write('\n');
          resolve(answer.trim());
        });
        muted = hidden;
      }),
    close: () => rl.close(),
  };
}

/** "name=value" of the first cookie a response sets, or null. */
export function sessionCookie(res: Response): string | null {
  const first = res.headers.getSetCookie()[0];
  return first ? first.split(';')[0] : null;
}

async function post(url: string, body: unknown, cookie?: string): Promise<{ res: Response; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

async function main(): Promise<void> {
  const settings = readSettings();
  const previous = await readSession(settings.sessionFile).catch(() => null);
  const { ask, close } = asker();
  try {
    const defaultUrl = previous?.baseUrl ?? 'http://localhost:3000';
    const baseUrl = ((await ask(`Mistwarden address [${defaultUrl}]: `)) || defaultUrl).replace(/\/+$/, '');
    const email = await ask('Email: ');
    const password = await ask('Password: ', true);

    let { res, data } = await post(`${baseUrl}/api/auth/login`, { email, password, rememberMe: true });
    if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${String(data.message ?? data.error ?? '')}`);
    let cookie = sessionCookie(res);

    if (data.mfaRequired) {
      const token = await ask('Two-factor code: ');
      // The pending sign-in lives in the session the first answer set up.
      ({ res, data } = await post(`${baseUrl}/api/auth/mfa/verify-login`, /^\d{6}$/.test(token) ? { token } : { backupCode: token }, cookie ?? undefined));
      if (!res.ok) throw new Error(`Two-factor check failed (${res.status}): ${String(data.message ?? data.error ?? '')}`);
      // Signing in hands out a fresh session id.
      cookie = sessionCookie(res) ?? cookie;
    }
    if (!cookie) throw new Error('The server set no session cookie.');
    if (data.mustChangePassword) throw new Error('This account must change its password in Mistwarden first.');

    const check = await fetch(`${baseUrl}/api/auth/ping`, { headers: { cookie } });
    if (!check.ok) throw new Error(`The new session does not work (${check.status}).`);

    await writePrivateJson(settings.sessionFile, { baseUrl, cookie, savedAt: new Date().toISOString() });
    const user = data.user as { displayName?: string } | undefined;
    process.stderr.write(`Signed in as ${user?.displayName ?? email}. Session saved to ${settings.sessionFile} (owner-only); it lasts 30 days of disuse.\n`);
  } finally {
    close();
  }
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
