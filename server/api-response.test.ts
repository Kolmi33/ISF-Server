import { describe, it, expect } from 'vitest';
import { apiSuccess, apiError } from './api-response.ts';

describe('apiSuccess', () => {
  // What: a payload wraps under `data`, defaulting to HTTP 200 when no status is given.
  // How: calls with just a payload and checks the exact envelope shape.
  it('wraps the payload under data, defaulting to 200', () => {
    expect(apiSuccess({ id: 'm1' })).toEqual({ status: 200, body: { data: { id: 'm1' } } });
  });

  // What: an explicit status code (e.g. 201 for a create) overrides the 200 default.
  // How: calls with status 201 and checks the envelope's status matches.
  it('accepts an explicit status (e.g. 201 Created)', () => {
    expect(apiSuccess({ id: 'm1' }, 201)).toEqual({ status: 201, body: { data: { id: 'm1' } } });
  });

  // What: an array payload (a collection endpoint's response) wraps the same way a single
  // object does.
  // How: calls with an array and checks it lands under `data` unchanged.
  it('wraps an array payload (a collection response) the same way', () => {
    expect(apiSuccess([1, 2, 3])).toEqual({ status: 200, body: { data: [1, 2, 3] } });
  });

  // What: a null payload (e.g. a successful DELETE with nothing to return) is a valid `data`
  // value, not treated as "no payload given".
  // How: calls with null and status 204 and checks the envelope carries `data: null`.
  it('wraps null (e.g. a successful DELETE with no body)', () => {
    expect(apiSuccess(null, 204)).toEqual({ status: 204, body: { data: null } });
  });

  // What: when no `meta` is given, the response body has no `meta` key at all — never an
  // explicit `meta: undefined` — so a plain `'meta' in body` check and a JSON round-trip agree.
  // How: calls without meta and checks the key is genuinely absent from the body object.
  it('omits meta entirely when not given, rather than setting it to undefined', () => {
    const { body } = apiSuccess([1, 2, 3]);
    expect('meta' in (body as Record<string, unknown>)).toBe(false);
  });

  // What: when `meta` IS given (e.g. a pagination cursor), it's included alongside `data`.
  // How: calls with a meta object and checks both `data` and `meta` appear in the body.
  it('includes meta when given (e.g. a pagination cursor)', () => {
    expect(apiSuccess([1, 2, 3], 200, { nextCursor: 42 })).toEqual({
      status: 200,
      body: { data: [1, 2, 3], meta: { nextCursor: 42 } },
    });
  });
});

describe('apiError', () => {
  // What: an error response carries the human message alongside a machine-readable code.
  // How: builds a 404/NOT_FOUND error and checks the exact envelope shape.
  it('builds the error envelope with a machine-readable code', () => {
    expect(apiError(404, 'NOT_FOUND', 'Maschine nicht gefunden')).toEqual({
      status: 404,
      body: { error: 'Maschine nicht gefunden', code: 'NOT_FOUND' },
    });
  });

  // What: when no `details` is given, the response body has no `details` key at all — the
  // same "never an explicit undefined" contract apiSuccess's `meta` follows.
  // How: builds an error without details and checks the key is genuinely absent.
  it('omits details entirely when not given, rather than setting it to undefined', () => {
    const { body } = apiError(400, 'VALIDATION', 'Ungültige Eingabe');
    expect('details' in (body as Record<string, unknown>)).toBe(false);
  });

  // What: when `details` IS given, it's included in the error body.
  // How: builds an error with a details object and checks it appears in the body.
  it('includes details when given', () => {
    expect(apiError(400, 'VALIDATION', 'Ungültige Eingabe', { field: 'name' })).toEqual({
      status: 400,
      body: { error: 'Ungültige Eingabe', code: 'VALIDATION', details: { field: 'name' } },
    });
  });

  // What: every code in the closed ApiErrorCode set round-trips through the error envelope unchanged.
  // How: builds an error with each of the five known codes and checks each one comes back
  // exactly as given.
  it('carries every declared error code through unchanged', () => {
    for (const code of [
      'VALIDATION',
      'NOT_FOUND',
      'CONFLICT',
      'PRECONDITION_FAILED',
      'INTERNAL',
    ] as const) {
      expect(apiError(500, code, 'x').body).toMatchObject({ code });
    }
  });
});
