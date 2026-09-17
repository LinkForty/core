/**
 * Route-level tests for the launchpad page: when the redirect serves it, what it
 * carries, and — most importantly — when it does not.
 *
 * Follows redirect.no-web-destination.test.ts: the real `redirectRoutes` plugin
 * through `fastify.inject()`, only the data layer mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { redirectRoutes, type RedirectRouteOptions } from './redirect.js';

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
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
/** Facebook's iOS in-app browser: Universal Links do not fire here. */
const FB_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0.0]';

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    title: null,
    description: null,
    og_title: null,
    og_description: null,
    og_image_url: null,
    original_url: null,
    web_fallback_url: null,
    ios_app_store_url: 'https://apps.apple.com/app/id1',
    android_app_store_url: 'https://play.google.com/store/apps/details?id=demo',
    ios_universal_link: null,
    android_app_link: null,
    app_scheme: null,
    deep_link_path: null,
    launchpad_mode: 'inherit',
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
  app.inject({ method: 'GET', url, headers: { 'user-agent': ua, host: 'go.example' } });

async function build(options: RedirectRouteOptions = {}) {
  const app = Fastify();
  await app.register(redirectRoutes, options);
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  app = await build();
});

afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('launchpad page — when it is served', () => {
  it('replaces the plain page for a desktop visitor to a link with no web destination', async () => {
    mockDb(linkRow({ og_title: 'Ride Alert', og_description: 'Live updates for your route' }));
    const res = await get(app, DESKTOP_UA);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toMatch(/^default-src 'none'; .*script-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(res.body).toContain('<h1>Ride Alert</h1>');
    expect(res.body).toContain('Live updates for your route');
    expect(res.body).toContain('Download on the App Store');
    expect(res.body).toContain('Get it on Google Play');
    expect(res.body).toContain('/api/links/00000000-0000-0000-0000-0000000000aa/qr?format=svg');
    expect(res.body).toContain('<meta property="og:url" content="http://go.example/abc123">');
    expect(res.body).not.toContain('This link opens in an app');
  });

  it('never attempts a scheme open on desktop, and ships no script when nothing needs one', async () => {
    mockDb(linkRow({ app_scheme: 'demo', deep_link_path: '/p/1' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Open in app');
    expect(res.body).not.toContain('<script');
  });

  it('keeps the 302 for a link with a destination when nobody opted in', async () => {
    mockDb(linkRow({ web_fallback_url: 'https://example.com/page' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/page');
  });

  it("serves the page in front of a destination when the workspace chose 'always'", async () => {
    mockDb(linkRow({ web_fallback_url: 'https://example.com/page', org_settings: { launchpad: { desktop: 'always' } } }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('class="lp"');
  });

  it("under 'always' the page links to the destination the 302 would have used", async () => {
    mockDb(linkRow({ web_fallback_url: 'https://example.com/page', org_settings: { launchpad: { desktop: 'always' } } }));
    const res = await get(app, DESKTOP_UA);
    expect(res.body).toContain('href="https://example.com/page">Continue on the web</a>');

    mockDb(linkRow({ original_url: 'https://example.com/original', org_settings: { launchpad: { desktop: 'always' } } }));
    const original = await get(app, DESKTOP_UA);
    expect(original.body).toContain('href="https://example.com/original">Continue on the web</a>');
  });

  it('the web link carries the same UTMs, deep-link params and click id the 302 would have', async () => {
    mockDb(
      linkRow({
        web_fallback_url: 'https://example.com/page',
        utm_parameters: { source: 'newsletter', medium: 'email' },
        deep_link_parameters: { ref: 'abc' },
        append_click_id: true,
        org_settings: { launchpad: { desktop: 'always' } },
      })
    );
    const res = await get(app, DESKTOP_UA);
    const href = /data-lp-cta="cta_web" href="([^"]+)"/.exec(res.body)?.[1]?.replace(/&amp;/g, '&');
    expect(href).toBeDefined();
    const url = new URL(href!);
    expect(url.origin + url.pathname).toBe('https://example.com/page');
    expect(url.searchParams.get('utm_source')).toBe('newsletter');
    expect(url.searchParams.get('utm_medium')).toBe('email');
    expect(url.searchParams.get('ref')).toBe('abc');
    expect(url.searchParams.get('lf_click')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('has no web link when the link has no web destination', async () => {
    mockDb(linkRow());
    expect((await get(app, DESKTOP_UA)).body).not.toContain('Continue on the web');
  });

  it("a link set to 'off' wins over a workspace set to 'always'", async () => {
    mockDb(
      linkRow({
        web_fallback_url: 'https://example.com/page',
        launchpad_mode: 'off',
        org_settings: { launchpad: { desktop: 'always' } },
      })
    );
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(302);
  });

  it("a link set to 'on' wins over the workspace default", async () => {
    mockDb(linkRow({ web_fallback_url: 'https://example.com/page', launchpad_mode: 'on' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('class="lp"');
  });

  it("a workspace set to 'off' gets the plain page for a link with no destination", async () => {
    mockDb(linkRow({ org_settings: { launchpad: { desktop: 'off' } } }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('This link opens in an app');
    expect(res.body).not.toContain('class="lp"');
  });

  it('treats a cached row from before the column existed as inherit', async () => {
    const row = linkRow();
    delete (row as Record<string, unknown>).launchpad_mode;
    mockDb(row);
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('class="lp"');
  });

  it('uses the template slug in og:url for a templated short link', async () => {
    mockDb(linkRow());
    const res = await get(app, DESKTOP_UA, '/promo/abc123');
    expect(res.body).toContain('<meta property="og:url" content="http://go.example/promo/abc123">');
  });
});

describe('launchpad page — what does not change', () => {
  it('leaves an iPhone visitor on the store redirect', async () => {
    mockDb(linkRow());
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://apps.apple.com/app/id1');
  });

  it("leaves an iPhone visitor on the store redirect even under 'always'", async () => {
    mockDb(linkRow({ org_settings: { launchpad: { desktop: 'always' } } }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
  });

  it('leaves an iPhone visitor on the scheme interstitial when the link has a scheme', async () => {
    mockDb(linkRow({ app_scheme: 'demo', deep_link_path: '/p/1' }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Opening');
    expect(res.body).not.toContain('class="lp"');
  });

  it('still 404s an unknown short code', async () => {
    mockDb(null);
    expect((await get(app, DESKTOP_UA)).statusCode).toBe(404);
  });

  it('still records the click', async () => {
    mockDb(linkRow());
    await get(app, DESKTOP_UA);
    await new Promise((r) => setImmediate(r));
    expect(query.mock.calls.some(([sql]) => /INSERT INTO click_events/i.test(String(sql)))).toBe(true);
  });
});

describe('launchpad page — content and escaping', () => {
  it('escapes a title and an image URL carrying HTML', async () => {
    mockDb(linkRow({ og_title: `<script>alert("xss")</script>`, og_image_url: 'https://cdn.example/a.png?x="y"' }));
    const res = await get(app, DESKTOP_UA);
    expect(res.body).not.toContain('<script>alert');
    expect(res.body).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(res.body).toContain('content="https://cdn.example/a.png?x=&quot;y&quot;"');
    expect(res.body).toContain('src="https://cdn.example/a.png?x=&quot;y&quot;"');
  });

  it('applies the workspace theme', async () => {
    mockDb(
      linkRow({
        org_settings: { launchpad: { appName: 'Demo App', appIconUrl: 'https://cdn.example/icon.png', accentColor: '#0f766e' } },
      })
    );
    const res = await get(app, DESKTOP_UA);
    expect(res.body).toContain('<span>Demo App</span>');
    expect(res.body).toContain('<img src="https://cdn.example/icon.png" alt="" width="48" height="48">');
    expect(res.body).toContain('--lp-accent: #0f766e;');
  });
});

describe('launchpad page — host hooks', () => {
  it('inserts heroHtml from resolveContent and keeps the rest of the frame', async () => {
    await app.close();
    app = await build({
      launchpad: {
        resolveContent: async (link, settings) => ({
          title: `Resolved ${link.short_code}`,
          description: 'from the host',
          imageUrl: null,
          heroHtml: `<div class="host-hero">${settings.templateId ?? 'default'}</div>`,
          theme: {},
        }),
      },
    });
    mockDb(linkRow({ org_settings: { launchpad: { templateId: 'hero' } } }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div class="host-hero">hero</div>');
    expect(res.body).toContain('<title>Resolved abc123</title>');
    expect(res.body).toContain('Download on the App Store');
  });

  it('falls back to the default content when resolveContent throws or returns null', async () => {
    await app.close();
    let calls = 0;
    app = await build({
      launchpad: {
        resolveContent: async () => {
          calls++;
          if (calls === 1) throw new Error('boom');
          return null;
        },
      },
    });
    mockDb(linkRow({ og_title: 'Default title' }));

    const thrown = await get(app, DESKTOP_UA);
    expect(thrown.statusCode).toBe(200);
    expect(thrown.body).toContain('<h1>Default title</h1>');

    const nulled = await get(app, DESKTOP_UA);
    expect(nulled.statusCode).toBe(200);
    expect(nulled.body).toContain('<h1>Default title</h1>');
    expect(calls).toBe(2);
  });

  it('emits beacons only when a beacon URL is configured, and admits its origin in the CSP', async () => {
    mockDb(linkRow());
    const silent = await get(app, DESKTOP_UA);
    expect(silent.body).not.toContain('sendBeacon');

    await app.close();
    app = await build({ launchpad: { beaconUrl: 'https://events.example/v1/launchpad' } });
    mockDb(linkRow());
    const res = await get(app, DESKTOP_UA);
    expect(res.body.match(/navigator\.sendBeacon\(/g)).toHaveLength(1);
    expect(res.body).toContain('data-lp-cta="cta_ios"');
    expect(res.body).toContain('data-lp-cta="cta_android"');
    expect(res.headers['content-security-policy']).toContain("connect-src 'self' https://events.example");
  });
});

describe('launchpad page — mobile mode', () => {
  const pageMode = { launchpad: { mobile: 'page' } };

  it("serves the page to an iPhone with a scheme: 'Open in app' is a button, nothing navigates", async () => {
    mockDb(linkRow({ app_scheme: 'demo', deep_link_path: '/p/1', deep_link_parameters: { x: '1' }, org_settings: pageMode }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    expect(res.body).toContain('class="lp"');
    expect(res.body).toContain('id="lp-open"');
    expect(res.body).toContain('data-scheme="demo://p/1?x=1"');
    expect(res.body).toContain('href="demo://p/1?x=1"');
    expect(res.body).toContain('window.location.hash');
    expect(res.body).not.toContain('setTimeout');
    expect(res.body).not.toContain('location.replace');
    expect(res.body).not.toContain('Opening');
  });

  it('shows only the visitor\'s own store, and no QR block', async () => {
    mockDb(linkRow({ org_settings: pageMode }));
    const iphone = await get(app, IPHONE_UA);
    expect(iphone.body).toContain('Download on the App Store');
    expect(iphone.body).not.toContain('Get it on Google Play');
    expect(iphone.body).not.toContain('class="lp-qr"');

    mockDb(linkRow({ org_settings: pageMode }));
    const android = await get(app, ANDROID_UA);
    expect(android.body).toContain('Get it on Google Play');
    expect(android.body).not.toContain('Download on the App Store');
  });

  it('serves the page without an Open button when the link has no scheme', async () => {
    mockDb(linkRow({ org_settings: pageMode }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('class="lp"');
    expect(res.body).not.toContain('id="lp-open"');
    expect(res.body).not.toContain('<script');
  });

  it('keeps the 302 to a Universal Link / App Link — the OS owns the installed case', async () => {
    mockDb(linkRow({ ios_universal_link: 'https://app.example/p/1', org_settings: pageMode }));
    const ios = await get(app, IPHONE_UA);
    expect(ios.statusCode).toBe(302);
    expect(ios.headers.location).toBe('https://app.example/p/1');

    mockDb(linkRow({ android_app_link: 'https://app.example/p/1', org_settings: pageMode }));
    const android = await get(app, ANDROID_UA);
    expect(android.statusCode).toBe(302);
  });

  it('a Universal Link for iOS does not stop the page on Android', async () => {
    mockDb(linkRow({ ios_universal_link: 'https://app.example/p/1', org_settings: pageMode }));
    const android = await get(app, ANDROID_UA);
    expect(android.statusCode).toBe(200);
    expect(android.body).toContain('class="lp"');
  });

  it('serves the page inside an in-app browser, where a bare scheme redirect fails silently', async () => {
    mockDb(linkRow({ app_scheme: 'demo', deep_link_path: '/p/1', web_fallback_url: 'https://example.com/p/1', org_settings: pageMode }));
    const res = await get(app, FB_IOS_UA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="lp-open"');
  });

  /**
   * In-app browsers bypass Universal Links, so the store redirect that a regular
   * browser gets would send someone who has the app to the store. The redirect
   * path handles that by preferring the web fallback there (pickMobileFallbackUrl),
   * which gives the OS a second chance to open the app on the next hop. In page
   * mode that hop must still exist — as a link.
   */
  it('keeps the web fallback reachable from the page, so the Universal Link second chance survives', async () => {
    mockDb(linkRow({ web_fallback_url: 'https://app.example/p/1', org_settings: pageMode }));
    const inApp = await get(app, FB_IOS_UA);
    expect(inApp.statusCode).toBe(200);
    expect(inApp.body).toContain('href="https://app.example/p/1">Continue on the web</a>');
    expect(inApp.body).toContain('Download on the App Store');

    // Store mode is untouched either way: regular browser → store, in-app browser → web fallback.
    mockDb(linkRow({ web_fallback_url: 'https://app.example/p/1' }));
    const safari = await get(app, IPHONE_UA);
    expect(safari.statusCode).toBe(302);
    expect(safari.headers.location).toBe('https://apps.apple.com/app/id1');

    mockDb(linkRow({ web_fallback_url: 'https://app.example/p/1' }));
    const fb = await get(app, FB_IOS_UA);
    expect(fb.statusCode).toBe(302);
    expect(fb.headers.location).toBe('https://app.example/p/1');
  });

  it("a link set to 'off' keeps the store behaviour under 'page'", async () => {
    mockDb(linkRow({ launchpad_mode: 'off', org_settings: pageMode }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://apps.apple.com/app/id1');
  });

  it("a link set to 'on' does not force the page onto a workspace that chose 'store'", async () => {
    mockDb(linkRow({ launchpad_mode: 'on' }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
  });

  it("'store' and an absent setting produce the same interstitial, byte for byte", async () => {
    const row = { app_scheme: 'demo', deep_link_path: '/p/1', deep_link_parameters: { x: '1', y: 'two words' } };
    mockDb(linkRow(row));
    const absent = await get(app, IPHONE_UA);
    mockDb(linkRow({ ...row, org_settings: { launchpad: { mobile: 'store' } } }));
    const explicit = await get(app, IPHONE_UA);

    expect(absent.statusCode).toBe(200);
    expect(absent.body).toContain('Opening');
    expect(absent.body).toContain('setTimeout');
    expect(absent.body).toContain('id="open-btn" href="demo://p/1?x=1&amp;y=two+words"');
    expect(absent.body).not.toContain('class="lp"');
    expect(explicit.body).toBe(absent.body);
    expect(explicit.headers['content-type']).toBe(absent.headers['content-type']);
  });

  it('page mode changes nothing on desktop', async () => {
    mockDb(linkRow({ web_fallback_url: 'https://example.com/page', org_settings: pageMode }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(302);
  });
});
