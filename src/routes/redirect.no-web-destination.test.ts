/**
 * Route-level tests for the plain page shown when a link has no web destination
 * and the launchpad page is switched off.
 *
 * A link belonging to an app-only product has nothing to put in a web fallback,
 * so a desktop visitor used to receive `{"error":"No destination URL configured
 * for this link"}` as a raw 404 body — rendered on the link owner's own branded
 * short-link domain. The launchpad page (redirect.launchpad.test.ts) is now the
 * default for that case; the plain page remains for workspaces that opt out, so
 * every test here pins `launchpad.desktop = 'off'`.
 *
 * The generator is module-private, so these drive the real `redirectRoutes`
 * plugin through `fastify.inject()` with only the data layer mocked, following
 * redirect.safety.test.ts. That also means the escaping assertions test what a
 * visitor's browser actually receives rather than a string a helper returned.
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

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** A link with no destination at any level of the chain — the case under test. */
function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    title: null,
    og_title: null,
    original_url: null,
    web_fallback_url: null,
    ios_app_store_url: null,
    android_app_store_url: null,
    ios_universal_link: null,
    android_app_link: null,
    app_scheme: null,
    deep_link_path: null,
    is_active: true,
    warn_at: null,
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

/** The same link, in a workspace that has switched the launchpad page off. */
function plainPageRow(overrides: Record<string, unknown> = {}) {
  return linkRow({ org_settings: { launchpad: { desktop: 'off' } }, ...overrides });
}

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

const get = (app: FastifyInstance, ua: string, url = '/abc123') =>
  app.inject({ method: 'GET', url, headers: { 'user-agent': ua } });

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  await app.register(redirectRoutes);
  await app.ready();
});

afterEach(async () => {
  // Click recording is fire-and-forget; let it land before the next reset.
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('no web destination', () => {
  it('serves an HTML page to a desktop visitor instead of a JSON 404', async () => {
    mockDb(plainPageRow());
    const res = await get(app, DESKTOP_UA);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('This link opens in an app');
  });

  it('uses the link title, preferring og_title', async () => {
    mockDb(plainPageRow({ title: 'Plain title', og_title: 'OG title' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.body).toContain('OG title');
    expect(res.body).not.toContain('Plain title');
  });

  it('falls back to title when og_title is unset', async () => {
    mockDb(plainPageRow({ title: 'Plain title' }));
    expect((await get(app, DESKTOP_UA)).body).toContain('Plain title');
  });

  /**
   * The title is customer-controlled free text reaching an HTML document. This is
   * the test that matters most in this file.
   */
  it('escapes a title containing HTML', async () => {
    mockDb(plainPageRow({ og_title: `<script>alert("xss")</script> & 'quotes'` }));
    const res = await get(app, DESKTOP_UA);

    expect(res.body).not.toContain('<script>');
    expect(res.body).toContain('&lt;script&gt;');
    expect(res.body).toContain('&amp;');
    expect(res.body).toContain('&quot;');
    expect(res.body).toContain('&#39;');
  });

  it('shows store buttons only for the platforms the link carries', async () => {
    mockDb(plainPageRow({ ios_app_store_url: 'https://apps.apple.com/app/id1' }));
    const onlyIos = await get(app, DESKTOP_UA);
    expect(onlyIos.body).toContain('Download for iOS');
    expect(onlyIos.body).not.toContain('Download for Android');

    mockDb(plainPageRow());
    const neither = await get(app, DESKTOP_UA);
    expect(neither.body).not.toContain('Download for');
  });

  it('escapes a store URL into the href', async () => {
    mockDb(plainPageRow({ ios_app_store_url: 'https://apps.apple.com/app?a=1&b=2' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.body).toContain('https://apps.apple.com/app?a=1&amp;b=2');
  });

  it('is the fallback when the link itself opts out of the launchpad page', async () => {
    mockDb(linkRow({ launchpad_mode: 'off' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('This link opens in an app');
    expect(res.body).not.toContain('class="lp"');
  });

  it('is not served by default — the launchpad page is', async () => {
    mockDb(linkRow());
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('class="lp"');
    expect(res.body).not.toContain('This link opens in an app');
  });

  it('resolves through the template and workspace chain before showing the page', async () => {
    mockDb(linkRow({ template_settings: { defaultWebFallbackUrl: 'https://from-template.example' } }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://from-template.example/');
  });

  /** Mobile already gets a store URL from the branches above; reaching here means nothing exists. */
  it('leaves mobile on the JSON 404', async () => {
    mockDb(linkRow());
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('still 404s an unknown short code on desktop', async () => {
    mockDb(null);
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('This link opens in an app');
  });

  /**
   * The warning page deliberately suppresses click recording; this page is the
   * opposite case — a genuine visit to a working link.
   */
  it('still records the click', async () => {
    mockDb(plainPageRow());
    await get(app, DESKTOP_UA);
    await new Promise((r) => setImmediate(r));
    expect(query.mock.calls.some(([sql]) => /INSERT INTO click_events/i.test(String(sql)))).toBe(true);
  });
});
