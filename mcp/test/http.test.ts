// Added for Mistwarden on 2026-11-27.
import { describe, expect, it } from 'vitest';
import { Api, ApiError, SessionExpired } from '../src/http.ts';

const session = { baseUrl: 'http://mistwarden.test/', cookie: 'sid=abc' };

/** A fetch that answers from a list, recording each call. */
function scripted(answers: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error('no answer left');
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function clock() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe('Api', () => {
  it('sends the session cookie and JSON', async () => {
    const { calls, fetchImpl } = scripted([json(200, { ok: true })]);
    const api = new Api(session, { fetch: fetchImpl });
    expect(await api.json('POST', '/api/x', { json: { a: 1 } })).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://mistwarden.test/api/x');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.cookie).toBe('sid=abc');
    expect(calls[0].init?.body).toBe('{"a":1}');
  });

  it('waits Retry-After on a 429, then retries', async () => {
    const { calls, fetchImpl } = scripted([json(429, { message: 'slow down' }, { 'retry-after': '3' }), json(200, { done: 1 })]);
    const { waits, sleep } = clock();
    const api = new Api(session, { fetch: fetchImpl, sleep });
    expect(await api.json('GET', '/api/x')).toEqual({ done: 1 });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  it('backs off exponentially when a 429 names no wait', async () => {
    const { fetchImpl } = scripted([json(429, {}), json(429, {}), json(429, {}), json(200, {})]);
    const { waits, sleep } = clock();
    await new Api(session, { fetch: fetchImpl, sleep }).json('GET', '/api/x');
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  it('gives up with the server message when the wait is too long or retries run out', async () => {
    const long = scripted([json(429, { message: 'You have exported 5 campaigns' }, { 'retry-after': '3000' })]);
    await expect(new Api(session, { fetch: long.fetchImpl, sleep: clock().sleep }).json('GET', '/x')).rejects.toThrow(/exported 5 campaigns.*3000 s/);

    const many = scripted(Array.from({ length: 3 }, () => json(429, {}, { 'retry-after': '1' })));
    const err = await new Api(session, { fetch: many.fetchImpl, sleep: clock().sleep, retries: 2 }).json('GET', '/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(many.calls).toHaveLength(3);
  });

  it('pauses before the next request when the window is nearly spent', async () => {
    const { fetchImpl } = scripted([json(200, {}, { 'ratelimit-remaining': '2', 'ratelimit-reset': '7' }), json(200, {})]);
    const { waits, sleep } = clock();
    const api = new Api(session, { fetch: fetchImpl, sleep, reserve: 5 });
    await api.json('GET', '/a');
    expect(waits).toEqual([]);
    await api.json('GET', '/b');
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(6000);
    expect(waits[0]).toBeLessThanOrEqual(7000);
  });

  it('does not pause while the window has room', async () => {
    const { fetchImpl } = scripted([json(200, {}, { 'ratelimit-remaining': '250', 'ratelimit-reset': '40' }), json(200, {})]);
    const { waits, sleep } = clock();
    const api = new Api(session, { fetch: fetchImpl, sleep });
    await api.json('GET', '/a');
    await api.json('GET', '/b');
    expect(waits).toEqual([]);
  });

  it('turns a 401 into the login hint', async () => {
    const { fetchImpl } = scripted([json(401, { message: 'Unauthorized' })]);
    await expect(new Api(session, { fetch: fetchImpl }).json('GET', '/x')).rejects.toThrow(SessionExpired);
  });

  it('carries the server message on other errors', async () => {
    const { fetchImpl } = scripted([json(400, { error: 'Validation Error', message: 'Map name is required' })]);
    await expect(new Api(session, { fetch: fetchImpl }).json('POST', '/x')).rejects.toThrow(/400.*Map name is required/);
  });
});
