// api-router.ts — Phase 9a: the REST API's routing plumbing. Pure, no HTTP, no DB — a route
// table is a plain array the caller owns; matching a request against it is a pure function of
// (routes, method, pathname). No endpoints are registered here; that starts in 9b. Zero-dependency
// by design (no router package) — the route table stays small enough that a linear scan with a
// `:param` segment matcher is simpler and more transparent than pulling in a dependency for it.
//
// This sits alongside the existing `/api/state`/`/api/mutate`/`/api/stream` trio in server.ts,
// not in place of it — see PROGRESS.md's Phase 9 plan for why the two don't merge.

/** One path segment matched against a `:param` pattern; params are keyed by name, values are
 *  percent-decoded. */
export interface RouteMatch {
  params: Record<string, string>;
}

/**
 * Match `pathname` against a `:param`-style route `pattern` (e.g. `/machines/:id`). A pattern
 * segment starting with `:` captures that path segment under its own name (decoded); any other
 * pattern segment must equal the path segment literally. Returns `null` when the segment counts
 * differ or a literal segment doesn't match — never partial credit.
 */
export function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index++) {
    const patternSegment = patternSegments[index]!;
    const pathSegment = pathSegments[index]!;
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return { params };
}

/** The subset of Node's `IncomingMessage.headers` shape a handler might need (e.g. `If-Match`
 *  for a conditional write, Phase 9f) — declared structurally so this module still doesn't
 *  import `node:http` just for a type. */
export type ApiRequestHeaders = Record<string, string | string[] | undefined>;

/** One registered endpoint: an HTTP method, a `:param` pattern, and the handler that serves it.
 *  `url` is the full parsed request URL (so a handler can read `url.searchParams` for filter/
 *  sort/pagination query params) — deliberately the standard web `URL`, not a Node-specific or
 *  DB-specific type, so this module stays usable without pulling in either. `body` is the
 *  already-JSON-parsed request body (undefined for a GET); `headers` the request headers — a
 *  GET/DELETE handler with no use for either simply omits them from its own signature (fewer
 *  parameters than the type still satisfies it). */
export interface ApiRoute {
  method: string;
  pattern: string;
  handler: (
    params: Record<string, string>,
    url: URL,
    body: unknown,
    headers: ApiRequestHeaders,
  ) => ApiResponse | Promise<ApiResponse>;
}

/** What a route handler returns — mirrors `server.ts`'s own `send(res, status, body)` shape, so
 *  the HTTP layer can forward it verbatim. `headers` (Phase 9f: `ETag` on a booking resource) are
 *  extra response headers, included only when a handler actually sets them. */
export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * The first route in `routes` whose method matches `method` and whose pattern matches
 * `pathname`, with its extracted params — or `null` if none does. Routes are checked in
 * array order, so a more specific pattern must be registered before a more general one that
 * could also match the same path (not a concern yet with the small route tables this app has).
 */
export function findRoute(
  routes: readonly ApiRoute[],
  method: string,
  pathname: string,
): { route: ApiRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = matchRoute(route.pattern, pathname);
    if (match) return { route, params: match.params };
  }
  return null;
}
