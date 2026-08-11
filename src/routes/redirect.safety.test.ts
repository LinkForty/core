/**
 * Route-level tests for the link safety gate.
 *
 * These drive the real `redirectRoutes` plugin through fastify.inject(), with only
 * the data layer mocked. The unit tests in lib/link-safety.test.ts already cover
 * the decision table; what matters here is the behaviour a visitor actually gets:
 * status codes, headers, whether a 302 happens, and whether a click is recorded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
// vi.mock is hoisted above these imports, so redirect.js still receives the mock.
import { redirectRoutes } from './redirect.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: {
    query: (...args: unknown[]) => query(...args),
  },
}));

/** A resolved link row as the redirect query would return it. */
function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    original_url: 'https://example.com/landing',
    web_fallback_url: null,
    deep_link_path: null,
    is_active: true,
    warn_at: null,
    owner_suspended_at: null,
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
 * @param row              the link the lookup resolves to, or null for "not found"
 * @param suspensionColumn whether organizations.suspended_at exists in this database
 */
function mockDb(row: Record<string, unknown> | null, suspensionColumn = true) {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) {
      return { rows: suspensionColumn ? [{ '?column?': 1 }] : [], rowCount: suspensionColumn ? 1 : 0 };
    }
    if (/^\s*SELECT\s+l\.\*/i.test(sql) || /FROM links l/i.test(sql)) {
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    // click inserts, anything else
    return { rows: [], rowCount: 0 };
  });
}

/** Did any click get written? Flushes the setImmediate the redirect uses. */
async function clickWasRecorded(): Promise<boolean> {
  await new Promise((r) => setImmediate(r));
  return query.mock.calls.some(([sql]) => /INSERT INTO click_events/i.test(String(sql)));
}

let app: FastifyInstance;

beforeEach(async () => {
  // No probe reset needed: the probe is scoped to each registration, so a fresh
  // Fastify instance per test gets a fresh probe. That the reset export is gone is
  // the point — it existed only to work around module-global state.
  app = Fastify();
  await app.register(redirectRoutes, { abuseReportUrl: 'https://example.org/abuse' });
  await app.ready();
});

afterEach(async () => {
  // Click recording is fire-and-forget (setImmediate). Let any pending insert from
  // this test finish BEFORE the next test resets the mock, otherwise a stray click
  // from a previous redirect lands in the next test's call log and looks like a bug.
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('redirect safety gate', () => {
  it('redirects a healthy link', async () => {
    mockDb(linkRow());
    const res = await app.inject({ method: 'GET', url: '/abc123' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/landing');
  });

  it('404s an inactive link', async () => {
    mockDb(linkRow({ is_active: false }));
    const res = await app.inject({ method: 'GET', url: '/abc123' });
    expect(res.statusCode).toBe(404);
  });

  it('404s when the owner is restricted, even though the link itself is fine', async () => {
    mockDb(linkRow({ owner_suspended_at: '2026-08-10T00:00:00Z' }));
    const res = await app.inject({ method: 'GET', url: '/abc123' });
    expect(res.statusCode).toBe(404);
  });

  it('gives a restricted owner the SAME response as an unknown code, leaking nothing', async () => {
    mockDb(linkRow({ owner_suspended_at: '2026-08-10T00:00:00Z' }));
    const restricted = await app.inject({ method: 'GET', url: '/abc123' });
    mockDb(null);
    const unknown = await app.inject({ method: 'GET', url: '/nosuchcode' });
    expect(restricted.statusCode).toBe(unknown.statusCode);
    expect(restricted.body).toBe(unknown.body);
  });

  describe('a link flagged to warn', () => {
    it('serves an interstitial instead of redirecting', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).toBe(200);
      expect(res.statusCode).not.toBe(302);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('Check this link before continuing');
    });

    it('shows the destination the short link was hiding', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.body).toContain('https://example.com/landing');
    });

    it('asks not to be indexed or cached', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    it('links to the configured reporting page', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.body).toContain('https://example.org/abuse');
    });

    it('records NO click — a warning view is not a click on the link', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z' }));
      await app.inject({ method: 'GET', url: '/abc123' });
      expect(await clickWasRecorded()).toBe(false);
    });

    it('falls back to the web fallback url when there is no original url', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z', original_url: '', web_fallback_url: 'https://example.net/x' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.body).toContain('https://example.net/x');
    });

    it('is outranked by owner restriction', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z', owner_suspended_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('a database without organizations.suspended_at', () => {
    it('still resolves links normally rather than erroring', async () => {
      mockDb(linkRow(), /* suspensionColumn */ false);
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).toBe(302);
    });

    it('never asks for the column it just proved absent', async () => {
      mockDb(linkRow(), false);
      await app.inject({ method: 'GET', url: '/abc123' });
      const lookups = query.mock.calls
        .map(([sql]) => String(sql))
        .filter((sql) => /FROM links l/i.test(sql));
      expect(lookups.length).toBeGreaterThan(0);
      for (const sql of lookups) expect(sql).not.toMatch(/owner_suspended_at/);
    });

    it('probes once even under CONCURRENT cold requests', async () => {
      // The sequential test below passes trivially because inject() awaits. This one
      // fires them together, which is what the memoised promise actually buys.
      mockDb(linkRow(), false);
      await Promise.all([
        app.inject({ method: 'GET', url: '/abc123' }),
        app.inject({ method: 'GET', url: '/abc123' }),
        app.inject({ method: 'GET', url: '/abc123' }),
        app.inject({ method: 'GET', url: '/abc123' }),
      ]);
      const probes = query.mock.calls.filter(([sql]) =>
        /information_schema\.columns/i.test(String(sql))
      );
      expect(probes).toHaveLength(1);
    });

    it('probes only once across sequential requests', async () => {
      mockDb(linkRow(), false);
      await app.inject({ method: 'GET', url: '/abc123' });
      await app.inject({ method: 'GET', url: '/abc123' });
      const probes = query.mock.calls.filter(([sql]) =>
        /information_schema\.columns/i.test(String(sql))
      );
      expect(probes).toHaveLength(1);
    });
  });
});
