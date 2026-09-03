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
  // What: a GET request is issued against `API + path` and the parsed JSON body is returned.
  // How: injects a fake fetch that records its calls and returns fixed JSON, then checks
  // both the returned value and the exact URL the fake fetch was called with.
  it('returns parsed JSON and requests API + path', async () => {
    const { fn, calls } = fakeFetch(true, { hello: 'world' });
    const out = await apiGet('/api/state', fn);
    expect(out).toEqual({ hello: 'world' });
    expect(calls[0]![0]).toBe(API + '/api/state');
  });
  // What: a non-ok HTTP response is surfaced as a thrown error naming the status code.
  // How: injects a fake fetch resolving with ok:false, status:503 and checks the rejection message.
  it('throws "Server <status>" on a non-ok response', async () => {
    const fn: FetchLike = () =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(null) } as Response);
    await expect(apiGet('/api/state', fn)).rejects.toThrow('Server 503');
  });
});

describe('apiPost', () => {
  // What: a POST sends the body as JSON with a Content-Type header, hitting `API + path`,
  // and returns the parsed response body.
  // How: injects a fake fetch, posts a body, and checks the URL, method, Content-Type header,
  // and that the request body is the JSON-stringified input.
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

  // What: a well-formed payload is accepted and returned as the same object (validated and
  // normalized in place, not copied).
  // How: builds a valid payload and checks the return value is that exact reference.
  it('accepts a well-formed payload and returns it', () => {
    const d = good();
    expect(validateData(d)).toBe(d); // same object (mutated in place)
  });
  // What: a payload that isn't even an object (null, a number) is rejected outright.
  // How: checks both null and a bare number throw the "kein JSON-Objekt" error.
  it('throws on a non-object', () => {
    expect(() => validateData(null)).toThrow('kein JSON-Objekt');
    expect(() => validateData(42)).toThrow('kein JSON-Objekt');
  });
  // What: a missing or non-array `machines` field fails validation.
  // How: passes a payload with `bookings` but no `machines` field.
  it('throws when machines is not an array', () => {
    expect(() => validateData({ bookings: {} })).toThrow('machines fehlt/ungültig');
  });
  // What: a missing or non-object `bookings` field fails validation.
  // How: passes a payload with `machines` but no `bookings` field.
  it('throws when bookings is missing or not an object', () => {
    expect(() => validateData({ machines: [] })).toThrow('bookings fehlt/ungültig');
  });
  // What: an invalid (non-array) `log` is tolerantly coerced to an empty array rather than
  // rejecting the whole payload; a valid log array is kept as-is.
  // How: checks a string `log` value comes back as [], and a real log array is preserved by reference.
  it('coerces a non-array log to [] and keeps a valid one', () => {
    expect(validateData({ machines: [], bookings: {}, log: 'nope' }).log).toEqual([]);
    const l = [{ ts: 't', user: 'u', action: 'a' }];
    expect(validateData({ machines: [], bookings: {}, log: l }).log).toBe(l);
  });
  // What: a missing or non-numeric `revision` defaults to 0 rather than rejecting the payload;
  // a real numeric revision is kept.
  // How: checks an absent revision defaults to 0, and an explicit numeric one is preserved.
  it('defaults a non-number revision to 0 and keeps a numeric one', () => {
    expect(validateData({ machines: [], bookings: {} }).revision).toBe(0);
    expect(validateData({ machines: [], bookings: {}, revision: 5 }).revision).toBe(5);
  });
});

describe('normalizeState', () => {
  // What: the server's wire field `rev` becomes the client's `revision`, and a missing log
  // defaults to empty — normalizeState bridges the wire shape into the client's own shape.
  // How: passes a payload with `rev` but no `log` and checks both derived fields.
  it('carries server rev into revision and defaults log', () => {
    const out = normalizeState({ machines: [], bookings: {}, groups: [], rev: 23 });
    expect(out.revision).toBe(23);
    expect(out.log).toEqual([]);
  });
  // What: a payload with no `rev` at all still normalizes, defaulting revision to 0.
  // How: passes a payload with no `rev` field and checks the resulting revision.
  it('defaults revision to 0 when rev is absent', () => {
    expect(normalizeState({ machines: [], bookings: {} }).revision).toBe(0);
  });
  // What: an existing `log` array survives normalization by reference, not just by value.
  // How: passes a payload with a real log array and checks the output's log is that same reference.
  it('preserves an existing log array', () => {
    const log = [{ ts: 't', user: 'u', action: 'a' }];
    expect(normalizeState({ machines: [], bookings: {}, rev: 1, log }).log).toBe(log);
  });
  // What: normalizeState still rejects a null payload outright, matching the pre-port legacy
  // behavior rather than silently producing a half-built state.
  // How: calls normalizeState(null) and checks it throws.
  it('throws (like legacy) when the payload is null', () => {
    expect(() => normalizeState(null)).toThrow();
  });
  // What: normalizeState runs the same shape validation validateData does, after normalizing
  // — a payload missing `machines` still fails, just after the rev/log defaulting step.
  // How: passes a payload with no `machines` field and checks the same validation error surfaces.
  it('validates the shape after normalizing', () => {
    expect(() => normalizeState({ bookings: {} })).toThrow('machines fehlt/ungültig');
  });
});

describe('readFile', () => {
  afterEach(() => vi.unstubAllGlobals());

  // What: readFile fetches /api/state (via the real global fetch) and returns the
  // normalized result — the actual data-loading entry point the app boots from.
  // How: stubs the global fetch to resolve with a server-shaped payload, calls readFile(),
  // and checks both the normalized revision and that fetch was called with the expected URL.
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

  // What: a failed /api/state fetch surfaces as a thrown error naming the status code,
  // the same way apiGet's own error handling works.
  // How: stubs fetch to resolve with ok:false, status:500 and checks the rejection message.
  it('propagates a non-ok response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve(null) }),
    );
    await expect(readFile()).rejects.toThrow('Server 500');
  });
});
