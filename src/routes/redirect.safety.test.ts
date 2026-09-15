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
    disabled_at: null,
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

  /**
   * An inactive link with no `disabled_at` is expired or was switched off by whoever
   * made it. Nobody decided anything about abuse, so nothing is explained.
   *
   * In practice the WHERE clause excludes these before they reach the gate; this
   * covers the row arriving from cache, where it can still be seen.
   */
  it('404s an inactive link that was not disabled by a decision', async () => {
    mockDb(linkRow({ is_active: false }));
    const res = await app.inject({ method: 'GET', url: '/abc123' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('This link has been removed');
  });

  /**
   * The narrowed form of the old "leaks nothing" test.
   *
   * That test asserted every blocked link was byte-identical to an unknown code.
   * Deliberately no longer true — an abuse decision now earns an explanation, see
   * link-safety.ts. What must still hold is that a link which is merely *off* gives
   * nothing away, because its owner did nothing wrong and its visitor was not
   * targeted. This is the assertion that fails if the notice is ever widened to
   * plain `is_active`.
   */
  it('gives a merely inactive link the SAME response as an unknown code', async () => {
    mockDb(linkRow({ is_active: false }));
    const inactive = await app.inject({ method: 'GET', url: '/abc123' });
    mockDb(null);
    const unknown = await app.inject({ method: 'GET', url: '/nosuchcode' });
    expect(inactive.statusCode).toBe(unknown.statusCode);
    expect(inactive.body).toBe(unknown.body);
  });

  describe('a link blocked by an abuse decision', () => {
    const SUSPENDED = { owner_suspended_at: '2026-08-10T00:00:00Z' };
    const DISABLED = { is_active: false, disabled_at: '2026-08-10T00:00:00Z' };

    it.each([
      ['the owner is restricted', SUSPENDED],
      ['the link itself was disabled', DISABLED],
    ])('serves the notice with 410 Gone when %s', async (_label, row) => {
      mockDb(linkRow(row));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).toBe(410);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.body).toContain('This link has been removed');
    });

    it('never redirects — there is nowhere safe to send anyone', async () => {
      mockDb(linkRow(SUSPENDED));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).not.toBe(302);
      expect(res.headers.location).toBeUndefined();
    });

    /** The warning page offers a way through because it is only a suspicion. This is not. */
    it('offers no way to continue', async () => {
      mockDb(linkRow(SUSPENDED));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.body).not.toContain('Continue anyway');
      expect(res.body).not.toMatch(/<a[^>]+href="https?:/i);
    });

    /**
     * The assertion that matters most. Naming the destination puts the hostile URL
     * back in front of the one person already proven to click it, and the workspace
     * and owner are somebody else's details.
     */
    it('names no destination, workspace, or account holder', async () => {
      mockDb(
        linkRow({
          ...SUSPENDED,
          original_url: 'https://phish.example/steal',
          web_fallback_url: 'https://phish.example/fallback',
          deep_link_path: '/secret-path',
        })
      );
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.body).not.toContain('phish.example');
      expect(res.body).not.toContain('secret-path');
    });

    it('tells the visitor what to do if they already entered something', async () => {
      mockDb(linkRow(SUSPENDED));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.body).toMatch(/change that password/i);
      expect(res.body).toMatch(/contact your bank/i);
      expect(res.body).toMatch(/do not use any contact details/i);
    });

    it('asks not to be indexed or cached', async () => {
      mockDb(linkRow(SUSPENDED));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.headers['x-robots-tag']).toMatch(/noindex/);
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });

    it('records NO click — nobody reached the destination', async () => {
      mockDb(linkRow(SUSPENDED));
      await app.inject({ method: 'GET', url: '/abc123' });
      expect(await clickWasRecorded()).toBe(false);
    });

    /** An unknown code must stay a plain 404; only a real, withdrawn code is 410. */
    it('still 404s an unknown short code', async () => {
      mockDb(null);
      const res = await app.inject({ method: 'GET', url: '/nosuchcode' });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('This link has been removed');
    });
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

    /**
     * Precedence is unchanged — a block still outranks a warn. What changed is the
     * response it produces. The property under test is that the visitor never gets
     * the interstitial's way through, since a restricted owner's link must be
     * unreachable even when it was only flagged to warn.
     */
    it('is outranked by owner restriction, and offers no way through', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z', owner_suspended_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).toBe(410);
      expect(res.body).toContain('This link has been removed');
      expect(res.body).not.toContain('Check this link before continuing');
      expect(res.body).not.toContain('Continue anyway');
    });

    /** Same precedence, for a link disabled directly rather than via its owner. */
    it('is outranked by an explicit disable', async () => {
      mockDb(linkRow({ warn_at: '2026-08-10T00:00:00Z', is_active: false, disabled_at: '2026-08-10T00:00:00Z' }));
      const res = await app.inject({ method: 'GET', url: '/abc123' });
      expect(res.statusCode).toBe(410);
      expect(res.body).not.toContain('Continue anyway');
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
