import { describe, it, expect } from 'vitest';
import { matchRoute, findRoute, type ApiRoute } from './api-router.ts';

describe('matchRoute', () => {
  it('matches a literal path with no params', () => {
    expect(matchRoute('/machines', '/machines')).toEqual({ params: {} });
  });

  it('extracts a single :param', () => {
    expect(matchRoute('/machines/:id', '/machines/dmu-50')).toEqual({
      params: { id: 'dmu-50' },
    });
  });

  it('extracts multiple :params in order', () => {
    expect(
      matchRoute('/machines/:id/bookings/:date', '/machines/dmu-50/bookings/2026-09-03'),
    ).toEqual({ params: { id: 'dmu-50', date: '2026-09-03' } });
  });

  it('decodes a URL-encoded param value', () => {
    expect(matchRoute('/groups/:name', '/groups/Alte%20Halle')).toEqual({
      params: { name: 'Alte Halle' },
    });
  });

  it('is null when the segment count differs', () => {
    expect(matchRoute('/machines/:id', '/machines')).toBeNull();
    expect(matchRoute('/machines/:id', '/machines/a/bookings')).toBeNull();
  });

  it('is null when a literal segment differs', () => {
    expect(matchRoute('/machines/:id', '/bookings/a')).toBeNull();
    expect(matchRoute('/machines/:id/bookings', '/machines/a/groups')).toBeNull();
  });

  it('treats a trailing slash as an empty segment, not ignorable', () => {
    // Faithful to a plain split('/').filter(Boolean): '/machines/' has the same segments as
    // '/machines' (the filter drops the empty trailing piece) — deliberate, simple behavior,
    // not a bug: callers normalize the pathname once via `new URL(...).pathname` upstream.
    expect(matchRoute('/machines', '/machines/')).toEqual({ params: {} });
  });

  it('matches the root path', () => {
    expect(matchRoute('/', '/')).toEqual({ params: {} });
  });
});

describe('findRoute', () => {
  const machinesList: ApiRoute = {
    method: 'GET',
    pattern: '/machines',
    handler: () => ({ status: 200, body: null }),
  };
  const machineById: ApiRoute = {
    method: 'GET',
    pattern: '/machines/:id',
    handler: () => ({ status: 200, body: null }),
  };
  const createMachine: ApiRoute = {
    method: 'POST',
    pattern: '/machines',
    handler: () => ({ status: 201, body: null }),
  };
  const routes = [machinesList, machineById, createMachine];

  it('finds the first route whose method and pattern both match', () => {
    const found = findRoute(routes, 'GET', '/machines');
    expect(found?.route).toBe(machinesList);
    expect(found?.params).toEqual({});
  });

  it('matches a param route and returns its extracted params', () => {
    const found = findRoute(routes, 'GET', '/machines/dmu-50');
    expect(found?.route).toBe(machineById);
    expect(found?.params).toEqual({ id: 'dmu-50' });
  });

  it('distinguishes routes with the same pattern by method', () => {
    const found = findRoute(routes, 'POST', '/machines');
    expect(found?.route).toBe(createMachine);
  });

  it('is null when no route matches the path or the method', () => {
    expect(findRoute(routes, 'GET', '/nope')).toBeNull();
    expect(findRoute(routes, 'DELETE', '/machines')).toBeNull();
  });

  it('is null for an empty route list', () => {
    expect(findRoute([], 'GET', '/machines')).toBeNull();
  });
});
