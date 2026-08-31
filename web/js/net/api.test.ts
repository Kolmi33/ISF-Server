import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FetchLike } from './api.ts';
import { API, apiGet, apiPost, validateData, normalizeState, readFile } from './api.ts';

// A fake fetch: records its call and returns a Response-like with the given ok/json.
function fakeFetch(ok: boolean, json: unknown): { fn: FetchLike; calls: [string, RequestInit?][] } {
  const calls: [string, RequestInit?][] = [];
  const fn: FetchLike = (input, init) => {
    calls.push([input, init]);
    return Promise.resolve({ ok, json: () => Promise.resolve(json) } as unknown as Response);
  };
  return { fn, calls };
}

describe('apiGet', () => {
  it('returns parsed JSON and requests API + path', async () => {
    const { fn, calls } = fakeFetch(true, { hello: 'world' });
    const out = await apiGet('/api/state', fn);
    expect(out).toEqual({ hello: 'world' });
    expect(calls[0]![0]).toBe(API + '/api/state');
  });
  it('throws "Server <status>" on a non-ok response', async () => {
    const fn: FetchLike = () =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) } as Response);
    await expect(apiGet('/api/state', fn)).rejects.toThrow('Server 503');
  });
});

describe('apiPost', () => {
  it('POSTs a JSON body with the right headers and returns the parsed response', async () => {
    const { fn, calls } = fakeFetch(true, { rev: 24 });
    const body = { cells: [], user: 'anna' };
    const out = await apiPost('/api/mutate', body, fn);
    expect(out).toEqual({ rev: 24 });
    const [url, init] = calls[0]!;
    expect(url).toBe(API + '/api/mutate');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify(body));
  });
});

describe('validateData', () => {
  const good = () => ({ machines: [], bookings: {}, groups: [], revision: 7, log: [] });

  it('accepts a well-formed payload and returns it', () => {
    const d = good();
    expect(validateData(d)).toBe(d); // same object (mutated in place)
  });
  it('throws on a non-object', () => {
    expect(() => validateData(null)).toThrow('kein JSON-Objekt');
    expect(() => validateData(42)).toThrow('kein JSON-Objekt');
  });
  it('throws when machines is not an array', () => {
    expect(() => validateData({ bookings: {} })).toThrow('machines fehlt/ungültig');
  });
  it('throws when bookings is missing or not an object', () => {
    expect(() => validateData({ machines: [] })).toThrow('bookings fehlt/ungültig');
  });
  it('coerces a non-array log to [] and keeps a valid one', () => {
    expect(validateData({ machines: [], bookings: {}, log: 'nope' }).log).toEqual([]);
    const l = [{ ts: 't', user: 'u', action: 'a' }];
    expect(validateData({ machines: [], bookings: {}, log: l }).log).toBe(l);
  });
  it('defaults a non-number revision to 0 and keeps a numeric one', () => {
    expect(validateData({ machines: [], bookings: {} }).revision).toBe(0);
    expect(validateData({ machines: [], bookings: {}, revision: 5 }).revision).toBe(5);
  });
});

describe('normalizeState', () => {
  it('carries server rev into revision and defaults log', () => {
    const out = normalizeState({ machines: [], bookings: {}, groups: [], rev: 23 });
    expect(out.revision).toBe(23);
    expect(out.log).toEqual([]);
  });
  it('defaults revision to 0 when rev is absent', () => {
    expect(normalizeState({ machines: [], bookings: {} }).revision).toBe(0);
  });
  it('preserves an existing log array', () => {
    const log = [{ ts: 't', user: 'u', action: 'a' }];
    expect(normalizeState({ machines: [], bookings: {}, rev: 1, log }).log).toBe(log);
  });
  it('throws (like legacy) when the payload is null', () => {
    expect(() => normalizeState(null)).toThrow();
  });
  it('validates the shape after normalizing', () => {
    expect(() => normalizeState({ bookings: {} })).toThrow('machines fehlt/ungültig');
  });
});

describe('readFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches /api/state and returns the normalized result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ machines: [], bookings: {}, rev: 3 }),
      }),
    );
    const data = await readFile();
    expect(data.revision).toBe(3);
    expect(fetch).toHaveBeenCalledWith(API + '/api/state');
  });

  it('propagates a non-ok response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) }),
    );
    await expect(readFile()).rejects.toThrow('Server 500');
  });
});
