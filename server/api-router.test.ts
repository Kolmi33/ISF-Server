import { describe, it, expect } from 'vitest';
import { matchRoute, findRoute, type ApiRoute } from './api-router.ts';

describe('matchRoute', () => {
  // What: a pattern with no `:param` segments matches only that exact literal path.
  // How: checks an identical literal pattern/path pair matches with no extracted params.
  it('matches a literal path with no params', () => {
    expect(matchRoute('/machines', '/machines')).toEqual({ params: {} });
  });

  // What: a single `:param` segment captures that path segment's value.
  // How: matches a pattern with one param segment and checks the captured value.
  it('extracts a single :param', () => {
    expect(matchRoute('/machines/:id', '/machines/dmu-50')).toEqual({
      params: { id: 'dmu-50' },
    });
  });

  // What: multiple `:param` segments each capture their own value, in order.
  // How: matches a pattern with two param segments and checks both captured values.
  it('extracts multiple :params in order', () => {
    expect(
      matchRoute('/machines/:id/bookings/:date', '/machines/dmu-50/bookings/2026-09-03'),
    ).toEqual({ params: { id: 'dmu-50', date: '2026-09-03' } });
  });

  // What: a captured param value is percent-decoded (e.g. a URL-encoded space).
  // How: matches a path segment containing %20 and checks the decoded value.
  it('decodes a URL-encoded param value', () => {
    expect(matchRoute('/groups/:name', '/groups/Alte%20Halle')).toEqual({
      params: { name: 'Alte Halle' },
    });
  });

  // What: a pattern and path with different segment counts never match — no partial credit.
  // How: checks both a path with too few segments and one with too many both return null.
  it('is null when the segment count differs', () => {
    expect(matchRoute('/machines/:id', '/machines')).toBeNull();
    expect(matchRoute('/machines/:id', '/machines/a/bookings')).toBeNull();
  });

  // What: a literal (non-`:param`) segment must match exactly — a mismatch anywhere fails
  // the whole route, even elsewhere in a longer pattern.
  // How: checks a completely different first segment, and a mismatch on a later literal
  // segment, both return null.
  it('is null when a literal segment differs', () => {
    expect(matchRoute('/machines/:id', '/bookings/a')).toBeNull();
    expect(matchRoute('/machines/:id/bookings', '/machines/a/groups')).toBeNull();
  });

  // What: a trailing slash is deliberately not special-cased — it's simply absorbed by the
  // segment-splitting logic, not an intentional "ignore trailing slashes" feature (callers
  // are expected to have already normalized the pathname upstream).
  // How: checks a path with a trailing slash still matches the same pattern without it,
  // documenting this as the natural consequence of split('/').filter(Boolean), not a bug.
  it('treats a trailing slash as an empty segment, not ignorable', () => {
    // Faithful to a plain split('/').filter(Boolean): '/machines/' has the same segments as
    // '/machines' (the filter drops the empty trailing piece) — deliberate, simple behavior,
    // not a bug: callers normalize the pathname once via `new URL(...).pathname` upstream.
    expect(matchRoute('/machines', '/machines/')).toEqual({ params: {} });
  });

  // What: the bare root path matches itself.
  // How: checks matchRoute('/', '/') returns an empty-params match.
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

  // What: findRoute picks the route whose method AND pattern both match, returning it
  // alongside its (here, empty) extracted params.
  // How: looks up a GET to a literal path and checks the exact route object and empty params.
  it('finds the first route whose method and pattern both match', () => {
    const found = findRoute(routes, 'GET', '/machines');
    expect(found?.route).toBe(machinesList);
    expect(found?.params).toEqual({});
  });

  // What: a route with a `:param` pattern is found and its captured params are returned too.
  // How: looks up a GET to a param path and checks both the route and the captured id.
  it('matches a param route and returns its extracted params', () => {
    const found = findRoute(routes, 'GET', '/machines/dmu-50');
    expect(found?.route).toBe(machineById);
    expect(found?.params).toEqual({ id: 'dmu-50' });
  });

  // What: two routes sharing the same path pattern but different methods are correctly
  // distinguished by method.
  // How: looks up a POST to the same path a GET route also matches, and checks the POST
  // route is what's found.
  it('distinguishes routes with the same pattern by method', () => {
    const found = findRoute(routes, 'POST', '/machines');
    expect(found?.route).toBe(createMachine);
  });

  // What: no match is returned as null, whether the path or the method is what's wrong.
  // How: checks an unknown path and a known path with an unregistered method both return null.
  it('is null when no route matches the path or the method', () => {
    expect(findRoute(routes, 'GET', '/nope')).toBeNull();
    expect(findRoute(routes, 'DELETE', '/machines')).toBeNull();
  });

  // What: an empty route table never matches anything, rather than erroring.
  // How: calls findRoute with an empty array and checks the result is null.
  it('is null for an empty route list', () => {
    expect(findRoute([], 'GET', '/machines')).toBeNull();
  });
});
