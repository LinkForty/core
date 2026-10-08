/**
 * The visitor's own query parameters (`/abc123?slug=titanic`) are forwarded to
 * http(s) destinations, so an installed app opened through the Universal Link /
 * App Link gets the same values a deferred install reads from the click row.
 * Fill-only: the destination's and the link's own parameters always win.
 * Follows redirect.web-link.test.ts.
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

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    title: null,
    description: null,
    og_title: null,
    og_description: null,
    og_image_url: null,
    original_url: 'https://example.com/landing',
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

const get = (app: FastifyInstance, ua: string, search = '') =>
  app.inject({ method: 'GET', url: `/abc123${search}`, headers: { 'user-agent': ua } });

const location = (res: { headers: Record<string, unknown> }) => new URL(res.headers.location as string);

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

describe('inbound query parameter forwarding', () => {
  it('forwards them to the iOS Universal Link', async () => {
    mockDb(linkRow({ ios_universal_link: 'https://app.example/content' }));
    const res = await get(app, IPHONE_UA, '?slug=titanic-ep1');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://app.example/content?slug=titanic-ep1');
  });

  it('forwards them to the Android App Link', async () => {
    mockDb(linkRow({ android_app_link: 'https://app.example/content' }));
    const res = await get(app, ANDROID_UA, '?slug=titanic-ep1');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://app.example/content?slug=titanic-ep1');
  });

  it('forwards them to the web fallback an in-app browser is sent to', async () => {
    mockDb(
      linkRow({
        web_fallback_url: 'https://app.example/content',
        ios_app_store_url: 'https://apps.apple.com/app/id1',
      })
    );
    const res = await get(app, FB_IOS_UA, '?slug=titanic-ep1');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://app.example/content?slug=titanic-ep1');
  });

  it('forwards them to the desktop destination', async () => {
    mockDb(linkRow());
    const res = await get(app, DESKTOP_UA, '?slug=titanic-ep1');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com/landing?slug=titanic-ep1');
  });

  it('never overrides a parameter the link sets in deep_link_parameters', async () => {
    mockDb(
      linkRow({
        ios_universal_link: 'https://app.example/content',
        deep_link_parameters: { slug: 'configured' },
      })
    );
    const res = await get(app, IPHONE_UA, '?slug=from-visitor&extra=1');
    const url = location(res);
    expect(url.searchParams.get('slug')).toBe('configured');
    expect(url.searchParams.get('extra')).toBe('1');
  });

  it('never overrides a parameter already on the destination URL', async () => {
    mockDb(linkRow({ android_app_link: 'https://play.google.com/store/apps/details?id=demo' }));
    const res = await get(app, ANDROID_UA, '?id=evil&slug=titanic');
    const url = location(res);
    expect(url.searchParams.get('id')).toBe('demo');
    expect(url.searchParams.get('slug')).toBe('titanic');
  });

  it('does not forward reserved utm_*, fp_* or lf_click parameters', async () => {
    mockDb(
      linkRow({
        ios_universal_link: 'https://app.example/content',
        utm_parameters: { source: 'email' },
      })
    );
    const res = await get(app, IPHONE_UA, '?utm_source=visitor&fp_tz=UTC&lf_click=x&slug=titanic');
    const url = location(res);
    expect(url.searchParams.get('utm_source')).toBe('email');
    expect(url.searchParams.has('fp_tz')).toBe(false);
    expect(url.searchParams.has('lf_click')).toBe(false);
    expect(url.searchParams.get('slug')).toBe('titanic');
  });

  it('leaves the destination untouched when the visitor sends no parameters', async () => {
    mockDb(linkRow({ ios_universal_link: 'https://app.example/content' }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://app.example/content');
  });
});
