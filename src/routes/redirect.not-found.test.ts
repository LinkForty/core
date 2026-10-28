/**
 * Route-level tests for the not-found page (lib/not-found-page.ts).
 *
 * These drive the real `redirectRoutes` plugin through fastify.inject() with
 * only the data layer mocked, following redirect.safety.test.ts. What matters is
 * what a visitor gets: a browser sees one page whatever the reason, an API client
 * keeps the JSON it has always had, and a link withdrawn for abuse keeps its own
 * notice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
// vi.mock is hoisted above these imports, so redirect.js still receives the mock.
import { redirectRoutes, type RedirectRouteOptions } from './redirect.js';
import { setLinkScopeResolver } from '../lib/link-lookup.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: {
    query: (...args: unknown[]) => query(...args),
  },
}));

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    organization_id: ORG_A,
    title: null,
    og_title: null,
    original_url: 'https://example.com/landing',
    web_fallback_url: null,
    ios_app_store_url: null,
    android_app_store_url: null,
    ios_universal_link: null,
    android_app_link: null,
    app_scheme: null,
    deep_link_path: null,
    is_active: true,
    warn_at: null,
    disabled_at: null,
    owner_suspended_at: null,
    expires_at: null,
    targeting_rules: null,
    template_settings: null,
    org_settings: null,
    utm_parameters: null,
    deep_link_parameters: null,
    append_click_id: false,
    ...overrides,
  };
}

/** Each case's row, plus the user agent that reaches the not-found branch. */
const CASES = {
  unknown: { row: null, ua: DESKTOP_UA },
  inactive: { row: linkRow({ is_active: false }), ua: DESKTOP_UA },
  notTargeted: { row: linkRow({ targeting_rules: { devices: ['ios'] } }), ua: DESKTOP_UA },
  noDestination: { row: linkRow({ original_url: null }), ua: IPHONE_UA },
} as const;

function mockDb(row: Record<string, unknown> | null) {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    if (/^\s*SELECT\s+l\.\*/i.test(sql) || /FROM links l/i.test(sql)) {
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

async function clickWasRecorded(): Promise<boolean> {
  await new Promise((r) => setImmediate(r));
  return query.mock.calls.some(([sql]) => /INSERT INTO click_events/i.test(String(sql)));
}

let app: FastifyInstance;

async function start(options: RedirectRouteOptions = {}) {
  app = Fastify();
  await app.register(redirectRoutes, options);
  await app.ready();
}

function visit(kase: { row: Record<string, unknown> | null; ua: string }, accept = BROWSER_ACCEPT) {
  mockDb(kase.row);
  return app.inject({
    method: 'GET',
    url: kase.row ? '/abc123' : '/nosuchcode',
    headers: { 'user-agent': kase.ua, accept },
  });
}

beforeEach(() => {
  setLinkScopeResolver(undefined);
});

afterEach(async () => {
  // Click recording is fire-and-forget; let it land before the next reset.
  await new Promise((r) => setImmediate(r));
  setLinkScopeResolver(undefined);
  await app?.close();
});

describe('not-found page, no hook', () => {
  beforeEach(() => start());

  it.each(Object.entries(CASES))('serves the HTML page to a browser: %s', async (_name, kase) => {
    const res = await visit(kase);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('<h1>Link not found</h1>');
  });

  /**
   * The opacity guarantee: an expired or switched-off link, a targeting miss and
   * a link with nowhere to go must look exactly like a code that never existed.
   */
  it('serves byte-identical pages for every reason', async () => {
    const bodies = [];
    for (const kase of Object.values(CASES)) bodies.push((await visit(kase)).body);
    expect(new Set(bodies).size).toBe(1);
  });

  it('keeps the JSON body for clients that do not accept HTML', async () => {
    for (const accept of ['application/json', '*/*']) {
      const unknown = await visit(CASES.unknown, accept);
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json()).toEqual({ error: 'Link not found' });

      const targeted = await visit(CASES.notTargeted, accept);
      expect(targeted.json()).toEqual({ error: 'Link not found' });

      const nowhere = await visit(CASES.noDestination, accept);
      expect(nowhere.json()).toEqual({ error: 'No destination URL configured for this link' });
    }
  });

  it('records no click for a targeting miss', async () => {
    await visit(CASES.notTargeted);
    expect(await clickWasRecorded()).toBe(false);
  });

  it('leaves the abuse notice alone', async () => {
    const res = await visit({
      row: linkRow({ is_active: false, disabled_at: '2026-08-10T00:00:00Z' }),
      ua: DESKTOP_UA,
    });
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('This link is no longer available');
  });
});

describe('not-found page, with a hook', () => {
  it('passes the reason, the row and the host scope', async () => {
    const notFound = vi.fn().mockReturnValue(null);
    await start({ notFound });
    setLinkScopeResolver(() => ORG_A);

    await visit(CASES.unknown);
    expect(notFound.mock.calls[0][1]).toEqual({ reason: 'unknown', link: null, scope: ORG_A });

    await visit(CASES.notTargeted);
    expect(notFound.mock.calls[1][1]).toMatchObject({ reason: 'not_targeted', scope: ORG_A });
    expect(notFound.mock.calls[1][1].link.id).toBe(CASES.notTargeted.row.id);

    await visit(CASES.noDestination);
    expect(notFound.mock.calls[2][1].reason).toBe('no_destination');
  });

  it("does not hand another organization's row to the hook", async () => {
    const notFound = vi.fn().mockReturnValue(null);
    await start({ notFound });
    setLinkScopeResolver(() => ORG_B);
    // The cached-row path: the lookup returns a row the host does not own.
    const res = await visit({ row: linkRow(), ua: DESKTOP_UA });
    expect(res.statusCode).toBe(404);
    expect(notFound.mock.calls[0][1]).toEqual({ reason: 'unknown', link: null, scope: ORG_B });
  });

  it('is not called for JSON clients or the abuse notice', async () => {
    const notFound = vi.fn().mockReturnValue(null);
    await start({ notFound });
    await visit(CASES.unknown, 'application/json');
    await visit({ row: linkRow({ is_active: false, disabled_at: '2026-08-10T00:00:00Z' }), ua: DESKTOP_UA });
    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders the content the hook returns', async () => {
    await start({
      notFound: async () => ({
        kind: 'page',
        content: { title: 'Nothing here', ctaLabel: 'Go home', ctaUrl: 'https://example.com/' },
      }),
    });
    const res = await visit(CASES.notTargeted);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('<h1>Nothing here</h1>');
    expect(res.body).toContain('href="https://example.com/"');
  });

  it('redirects where the hook says', async () => {
    await start({ notFound: () => ({ kind: 'redirect', url: 'https://example.com/home' }) });
    const res = await visit(CASES.unknown);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/home');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('serves the default page instead of a non-http redirect', async () => {
    await start({ notFound: () => ({ kind: 'redirect', url: 'javascript:alert(1)' }) });
    const res = await visit(CASES.unknown);
    expect(res.statusCode).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('<h1>Link not found</h1>');
  });

  it('serves the default page when the hook throws', async () => {
    await start({
      notFound: () => {
        throw new Error('boom');
      },
    });
    const res = await visit(CASES.unknown);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('<h1>Link not found</h1>');
  });
});
