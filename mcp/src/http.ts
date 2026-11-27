// Added for Mistwarden on 2026-11-27.
// The REST client: session cookie, rate-limit pacing, and retries on 429.

import { LOGIN_HINT, type Session } from './config.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class SessionExpired extends Error {}

export interface ApiOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Longest wait the client accepts for a rate limit before it gives up. */
  maxWaitMs?: number;
  /** Requests left in a window at which the client pauses until the window resets. */
  reserve?: number;
  retries?: number;
}

export interface RequestBody {
  json?: unknown;
  form?: FormData;
}

const seconds = (value: string | null): number | null => {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export class Api {
  readonly baseUrl: string;
  private readonly cookie: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxWaitMs: number;
  private readonly reserve: number;
  private readonly retries: number;
  private pauseUntil = 0;

  constructor(session: Pick<Session, 'baseUrl' | 'cookie'>, options: ApiOptions = {}) {
    this.baseUrl = session.baseUrl.replace(/\/+$/, '');
    this.cookie = session.cookie;
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxWaitMs = options.maxWaitMs ?? 65_000;
    // The per-address budget is shared with the GM's own browser: leave it room.
    this.reserve = options.reserve ?? 10;
    this.retries = options.retries ?? 4;
  }

  /** One request, paced by the RateLimit-* headers, retried after a 429. Throws on 401. */
  async request(method: string, path: string, body: RequestBody = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.pauseUntil - Date.now();
      if (wait > 0) await this.sleep(wait);

      const headers: Record<string, string> = { cookie: this.cookie, accept: 'application/json' };
      let payload: string | FormData | undefined;
      if (body.json !== undefined) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body.json);
      } else if (body.form) {
        payload = body.form;
      }
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: payload });

      const remaining = seconds(res.headers.get('ratelimit-remaining'));
      const reset = seconds(res.headers.get('ratelimit-reset'));
      if (remaining !== null && remaining <= this.reserve && reset !== null) {
        this.pauseUntil = Date.now() + Math.min(reset * 1000, this.maxWaitMs);
      }

      if (res.status === 401) {
        throw new SessionExpired(`Mistwarden answered 401: the saved session has ended or was signed out. ${LOGIN_HINT}`);
      }
      if (res.status !== 429) return res;

      const retryAfter = seconds(res.headers.get('retry-after')) ?? reset ?? 2 ** attempt;
      const message = await errorMessage(res);
      if (attempt >= this.retries || retryAfter * 1000 > this.maxWaitMs) {
        throw new ApiError(429, `Rate limited by the server (${message}). Try again in about ${Math.ceil(retryAfter)} s.`, null);
      }
      await this.sleep(Math.max(retryAfter * 1000, 500 * 2 ** attempt));
    }
  }

  /** A request whose answer is JSON; a non-2xx answer becomes an ApiError with the server's message. */
  async json<T>(method: string, path: string, body?: RequestBody): Promise<T> {
    const res = await this.request(method, path, body);
    if (!res.ok) throw new ApiError(res.status, `${method} ${path} failed (${res.status}): ${await errorMessage(res)}`, null);
    return (await res.json()) as T;
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? text;
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}
