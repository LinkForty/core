/**
 * A link whose template is web-only opens the website on every device: a plain
 * 302 to the same destination desktop gets, never the Launchpad page, the
 * scheme interstitial or a store. Follows redirect.launchpad.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
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
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const FB_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0.0]';

const WEB_ONLY = { webOnly: true };
/** Launchpad page mode: without the flag, a mobile visitor to an app-less link gets the page. */
const PAGE_MODE = { launchpad: { mobile: 'page' } };

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    title: null,
    description: null,
    og_title: null,
    og_description: null,
    og_image_url: null,
    original_url: 'https://example.com/podcast',
    web_fallback_url: null,
    ios_app_store_url: null,
    android_app_store_url: null,
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
    template_settings: WEB_ONLY,
    org_settings: PAGE_MODE,
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

const get = (app: FastifyInstance, ua: string) =>
  app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': ua, host: 'go.example' } });

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  await app.register(redirectRoutes);
  await app.ready();
});

afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('web-only template', () => {
  it('302s every device to the web destination, even with the workspace in Launchpad page mode', async () => {
    mockDb(linkRow());
    for (const ua of [IPHONE_UA, ANDROID_UA, FB_IOS_UA, DESKTOP_UA]) {
      const res = await get(app, ua);
      expect(res.statusCode, ua).toBe(302);
      expect(res.headers.location, ua).toBe('https://example.com/podcast');
    }
  });

  it('ignores app destinations the link or workspace carries: no store, scheme or Universal Link', async () => {
    mockDb(
      linkRow({
        ios_app_store_url: 'https://apps.apple.com/app/id1',
        android_app_store_url: 'https://play.google.com/store/apps/details?id=demo',
        ios_universal_link: 'https://go.example/app/1',
        android_app_link: 'https://go.example/app/1',
        app_scheme: 'demo',
        deep_link_path: '/p/1',
      })
    );
    for (const ua of [IPHONE_UA, ANDROID_UA]) {
      const res = await get(app, ua);
      expect(res.statusCode, ua).toBe(302);
      expect(res.headers.location, ua).toBe('https://example.com/podcast');
    }
  });

  it('uses the same destination desktop does: web fallback first, with UTM parameters', async () => {
    mockDb(
      linkRow({
        web_fallback_url: 'https://example.com/landing',
        utm_parameters: { source: 'email', campaign: 'oct' },
      })
    );
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://example.com/landing');
    expect(location.searchParams.get('utm_source')).toBe('email');
    expect(location.searchParams.get('utm_campaign')).toBe('oct');
  });

  it('leaves app links alone: an unflagged template still gets the Launchpad page on mobile', async () => {
    mockDb(
      linkRow({
        template_settings: { webOnly: false },
        ios_app_store_url: 'https://apps.apple.com/app/id1',
      })
    );
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });
});
