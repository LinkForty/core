/**
 * Regression test for the owner-restriction bypass via the SDK resolve endpoint.
 *
 * The redirect and `/api/sdk/v1/resolve/:shortCode` write the SAME Redis key. The SDK
 * query used to omit the `organizations` join, so the row it cached carried no
 * `owner_suspended_at`. The redirect then read `undefined`, its gate treated that as
 * "not restricted", and a restricted owner's link redirected for the rest of the TTL.
 *
 * Both plugins share one fake Redis here, because sharing the cache is the mechanism —
 * testing them in isolation cannot reproduce it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
import { redirectRoutes } from './redirect.js';
import { sdkRoutes } from './sdk.js';

/** Minimal shared Redis stand-in — get/set/setex/del over one Map. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    setex: async (k: string, _ttl: number, v: string) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  };
}

const RESTRICTED = '2026-08-10T00:00:00Z';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    organization_id: '00000000-0000-0000-0000-0000000000bb',
    original_url: 'https://example.com/landing',
    web_fallback_url: null,
    deep_link_path: null,
    is_active: true,
    warn_at: null,
    owner_suspended_at: RESTRICTED,
    expires_at: null,
    targeting_rules: null,
    template_settings: null,
    org_settings: null,
    utm_parameters: null,
    append_click_id: false,
    ...overrides,
  };
}

/**
 * Mock the database so the row's shape follows the SELECT, exactly as Postgres would:
 * `owner_suspended_at` is only present when the query asked for it. That is what makes
 * this a real reproduction rather than a restatement of the fix.
 */
function mockDb() {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
    if (/FROM links/i.test(sql)) {
      // The row's shape follows the SELECT, exactly as Postgres would: a column is
      // present only if the query asked for it. That is what makes these real
      // reproductions rather than restatements of the fix.
      const r: Record<string, unknown> = row();
      if (!/owner_suspended_at/i.test(sql)) delete r.owner_suspended_at;
      if (!/template_settings/i.test(sql)) delete r.template_settings;
      if (!/org_settings/i.test(sql)) delete r.org_settings;
      return { rows: [r], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

let redirectApp: FastifyInstance;
let sdkApp: FastifyInstance;
let redis: ReturnType<typeof fakeRedis>;

beforeEach(async () => {
  mockDb();
  redis = fakeRedis();
  redirectApp = Fastify();
  redirectApp.decorate('redis', redis as any);
  await redirectApp.register(redirectRoutes);
  await redirectApp.ready();

  sdkApp = Fastify();
  sdkApp.decorate('redis', redis as any);
  await sdkApp.register(sdkRoutes);
  await sdkApp.ready();
});

afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  await redirectApp.close();
  await sdkApp.close();
});

describe('owner restriction cannot be bypassed through the SDK cache', () => {
  it('blocks a restricted owner when the redirect populates the cache itself', async () => {
    const res = await redirectApp.inject({ method: 'GET', url: '/abc123' });
    expect(res.statusCode).toBe(404);
  });

  it('still blocks after an SDK resolve has primed the same cache key', async () => {
    // This is the bypass: prime via the public SDK endpoint, then hit the redirect.
    await sdkApp.inject({ method: 'GET', url: '/api/sdk/v1/resolve/abc123' });
    expect(redis.store.has('link:abc123')).toBe(true);

    const res = await redirectApp.inject({ method: 'GET', url: '/abc123' });
    expect(res.statusCode, 'a restricted owner must stay blocked on a cache hit').toBe(404);
    expect(res.headers.location).toBeUndefined();
  });

  it('the cached row carries owner_suspended_at whichever path wrote it', async () => {
    await sdkApp.inject({ method: 'GET', url: '/api/sdk/v1/resolve/abc123' });
    const cached = JSON.parse(redis.store.get('link:abc123')!);
    // Absent (not merely null) is what made the redirect's gate pass.
    expect(Object.prototype.hasOwnProperty.call(cached, 'owner_suspended_at')).toBe(true);
  });

  it('the SDK endpoint itself refuses to resolve a restricted link', async () => {
    // It returns the destination directly, so it must enforce the same policy — that
    // is the information the redirect is refusing to disclose.
    const res = await sdkApp.inject({ method: 'GET', url: '/api/sdk/v1/resolve/abc123' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('example.com/landing');
  });
});


/**
 * The same cache-shape divergence, one field over.
 *
 * The redirect reads `template_settings` and `org_settings` from this shared key for
 * its URL fallback chain (link, then template, then workspace). While the SDK query
 * omitted them, an SDK resolve left the next redirect unable to see a template-level
 * fallback, so a link relying on one silently fell through to `original_url`.
 */
describe('the URL fallback chain survives an SDK resolve', () => {
  /** No link-level web fallback; the destination lives on the template. */
  function templateFallbackRow() {
    return {
      ...row({ owner_suspended_at: null }),
      original_url: 'https://example.com/ORIGINAL',
      web_fallback_url: null,
      template_settings: { defaultWebFallbackUrl: 'https://cdn.example.com/template-default' },
      org_settings: null,
    };
  }

  beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql: string) => {
      if (/information_schema\.columns/i.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
      if (/FROM links/i.test(sql)) {
        const r: Record<string, unknown> = templateFallbackRow();
        if (!/owner_suspended_at/i.test(sql)) delete r.owner_suspended_at;
        if (!/template_settings/i.test(sql)) delete r.template_settings;
        if (!/org_settings/i.test(sql)) delete r.org_settings;
        return { rows: [r], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('caches template_settings whichever path writes the key', async () => {
    await sdkApp.inject({ method: 'GET', url: '/api/sdk/v1/resolve/abc123' });
    const cached = JSON.parse(redis.store.get('link:abc123')!);
    expect(Object.prototype.hasOwnProperty.call(cached, 'template_settings')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(cached, 'org_settings')).toBe(true);
  });
});
