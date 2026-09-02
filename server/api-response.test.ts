import { describe, it, expect } from 'vitest';
import { apiSuccess, apiError } from './api-response.ts';

describe('apiSuccess', () => {
  it('wraps the payload under data, defaulting to 200', () => {
    expect(apiSuccess({ id: 'm1' })).toEqual({ status: 200, body: { data: { id: 'm1' } } });
  });

  it('accepts an explicit status (e.g. 201 Created)', () => {
    expect(apiSuccess({ id: 'm1' }, 201)).toEqual({ status: 201, body: { data: { id: 'm1' } } });
  });

  it('wraps an array payload (a collection response) the same way', () => {
    expect(apiSuccess([1, 2, 3])).toEqual({ status: 200, body: { data: [1, 2, 3] } });
  });

  it('wraps null (e.g. a successful DELETE with no body)', () => {
    expect(apiSuccess(null, 204)).toEqual({ status: 204, body: { data: null } });
  });

  it('omits meta entirely when not given, rather than setting it to undefined', () => {
    const { body } = apiSuccess([1, 2, 3]);
    expect('meta' in (body as Record<string, unknown>)).toBe(false);
  });

  it('includes meta when given (e.g. a pagination cursor)', () => {
    expect(apiSuccess([1, 2, 3], 200, { nextCursor: 42 })).toEqual({
      status: 200,
      body: { data: [1, 2, 3], meta: { nextCursor: 42 } },
    });
  });
});

describe('apiError', () => {
  it('builds the error envelope with a machine-readable code', () => {
    expect(apiError(404, 'NOT_FOUND', 'Maschine nicht gefunden')).toEqual({
      status: 404,
      body: { error: 'Maschine nicht gefunden', code: 'NOT_FOUND' },
    });
  });

  it('omits details entirely when not given, rather than setting it to undefined', () => {
    const { body } = apiError(400, 'VALIDATION', 'Ungültige Eingabe');
    expect('details' in (body as Record<string, unknown>)).toBe(false);
  });

  it('includes details when given', () => {
    expect(apiError(400, 'VALIDATION', 'Ungültige Eingabe', { field: 'name' })).toEqual({
      status: 400,
      body: { error: 'Ungültige Eingabe', code: 'VALIDATION', details: { field: 'name' } },
    });
  });

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
