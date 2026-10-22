/**
 * Store URLs are not decorated like websites.
 *
 * The destination decorator adds UTM tags, deep-link parameters and the
 * opt-in click id — right for a website, wrong for a store listing. Google
 * Play identifies the app by `?id=`, so a deep-link parameter named `id`
 * replaced it and Play answered 404 to every Android visitor sent to install.
 * The one thing a Play listing gains, for an Android visitor, is the click id
 * in its `referrer`, which Play hands to the installed app.
 *
 * The app-open guard cases matter as much as the fix: an in-app browser must
 * still be sent to the web fallback (where a Universal Link / App Link gets a
 * second chance to open an installed app), decorated as before.
 *
 * Follows redirect.launchpad.test.ts: the real `redirectRoutes` plugin through
 * `fastify.inject()`, only the data layer mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { redirectRoutes, isAppStoreUrl, withPlayInstallReferrer } from './redirect.js';

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
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const ANDROID_INSTAGRAM_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Instagram 320.0.0.0';

const PLAY = 'https://play.google.com/store/apps/details?id=com.example.app';
const APP_STORE = 'https://apps.apple.com/app/id1234567890';
const WEB = 'https://example.com/event';

/** A link carrying everything the decorator would add, including an `id` parameter. */
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
    ios_app_store_url: APP_STORE,
    android_app_store_url: PLAY,
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
    utm_parameters: { source: 'newsletter', medium: 'email' },
    deep_link_parameters: { id: 'evt_42', route: 'EVENT_VIEW' },
    append_click_id: true,
    ...overrides,
  };
}

function mockDb(row: Record<string, unknown>) {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (/^\s*SELECT\s+l\.\*/i.test(sql) || /FROM links l/i.test(sql)) return { rows: [row], rowCount: 1 };
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

/** The click id the redirect wrote to click_events. */
function insertedClickId(): string | undefined {
  const insert = query.mock.calls.find(([sql]) => /INSERT INTO click_events/i.test(String(sql)));
  return (insert?.[1] as unknown[] | undefined)?.[0] as string | undefined;
}

/** `location` as a Play URL: its app id, and its referrer's keys. */
function playParts(location: unknown) {
  const url = new URL(String(location));
  return {
    base: `${url.origin}${url.pathname}`,
    keys: [...url.searchParams.keys()].sort(),
    id: url.searchParams.get('id'),
    referrer: new URLSearchParams(url.searchParams.get('referrer') ?? ''),
  };
}

describe('store URLs are sent exactly as configured', () => {
  it('Android Chrome → the Play URL with only the click id added, so a deep-link `id` cannot replace the app id', async () => {
    mockDb(linkRow({ web_fallback_url: WEB }));
    const res = await get(app, ANDROID_CHROME_UA);
    expect(res.statusCode).toBe(302);
    const play = playParts(res.headers.location);
    expect(play.base).toBe('https://play.google.com/store/apps/details');
    expect(play.keys).toEqual(['id', 'referrer']);
    expect(play.id).toBe('com.example.app');
    expect([...play.referrer.keys()]).toEqual(['lf_click']);
  });

  it('iOS Safari → the App Store URL untouched', async () => {
    mockDb(linkRow({ web_fallback_url: WEB }));
    const res = await get(app, IPHONE_UA);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(APP_STORE);
  });

  it('a store URL configured as the web fallback is not decorated either', async () => {
    mockDb(linkRow({ ios_app_store_url: null, android_app_store_url: null, web_fallback_url: PLAY }));
    const res = await get(app, IPHONE_UA);
    expect(res.headers.location).toBe(PLAY);
  });
});

describe('the Play install referrer carries the click id', () => {
  it('is the id of the click the redirect records', async () => {
    mockDb(linkRow());
    const res = await get(app, ANDROID_CHROME_UA);
    await new Promise((r) => setImmediate(r));
    const clickId = playParts(res.headers.location).referrer.get('lf_click');
    expect(clickId).toMatch(/^[0-9a-f-]{36}$/);
    expect(insertedClickId()).toBe(clickId);
  });

  it('is added to a Play URL configured as the web fallback', async () => {
    mockDb(linkRow({ android_app_store_url: null, web_fallback_url: PLAY }));
    const res = await get(app, ANDROID_CHROME_UA);
    const play = playParts(res.headers.location);
    expect(play.id).toBe('com.example.app');
    expect(play.referrer.get('lf_click')).toBeTruthy();
  });

  it('keeps the keys of a referrer the Play URL already carries', async () => {
    mockDb(linkRow({ android_app_store_url: `${PLAY}&referrer=utm_source%3Dposter` }));
    const res = await get(app, ANDROID_CHROME_UA);
    const { referrer } = playParts(res.headers.location);
    expect(referrer.get('utm_source')).toBe('poster');
    expect(referrer.get('lf_click')).toBeTruthy();
  });

  it('is the scheme interstitial\'s store fallback on Android', async () => {
    mockDb(linkRow({ app_scheme: 'example', deep_link_path: '/e/42' }));
    const res = await get(app, ANDROID_CHROME_UA);
    expect(res.statusCode).toBe(200);
    const fallback = /id="store-btn" href="([^"]+)"/.exec(res.body)?.[1].replace(/&amp;/g, '&');
    expect(playParts(fallback).referrer.get('lf_click')).toBeTruthy();
  });

  it('is the launchpad page\'s Google Play button on Android', async () => {
    mockDb(linkRow({ org_settings: { launchpad: { mobile: 'page' } } }));
    const res = await get(app, ANDROID_CHROME_UA);
    expect(res.statusCode).toBe(200);
    const button = /data-lp-cta="cta_android" href="([^"]+)"/.exec(res.body)?.[1].replace(/&amp;/g, '&');
    expect(playParts(button).referrer.get('lf_click')).toBeTruthy();
  });

  it('is not added for an iPhone or a desktop visitor', async () => {
    mockDb(linkRow({ ios_app_store_url: null, android_app_store_url: null, web_fallback_url: PLAY }));
    expect((await get(app, IPHONE_UA)).headers.location).toBe(PLAY);
    expect((await get(app, DESKTOP_UA)).headers.location).toBe(PLAY);
  });

  it('app-open guard: an Android in-app browser still goes to the web fallback, with no referrer', async () => {
    mockDb(linkRow({ web_fallback_url: WEB }));
    const res = await get(app, ANDROID_INSTAGRAM_UA);
    const url = new URL(String(res.headers.location));
    expect(url.hostname).toBe('example.com');
    expect(url.searchParams.has('referrer')).toBe(false);
  });
});

describe('withPlayInstallReferrer', () => {
  const CLICK = '11111111-2222-4333-8444-555555555555';

  it('adds the click id to a Play listing, https or market://', () => {
    expect(withPlayInstallReferrer(PLAY, CLICK)).toBe(`${PLAY}&referrer=lf_click%3D${CLICK}`);
    expect(withPlayInstallReferrer('market://details?id=com.example.app', CLICK)).toBe(
      `market://details?id=com.example.app&referrer=lf_click%3D${CLICK}`
    );
  });

  it('replaces a click id the referrer already names', () => {
    const url = withPlayInstallReferrer(`${PLAY}&referrer=lf_click%3Dold%26utm_source%3Dx`, CLICK);
    const referrer = new URLSearchParams(new URL(url).searchParams.get('referrer') ?? '');
    expect(referrer.getAll('lf_click')).toEqual([CLICK]);
    expect(referrer.get('utm_source')).toBe('x');
  });

  it('leaves every other URL alone', () => {
    for (const url of [
      APP_STORE,
      WEB,
      'https://play.google.com/store/apps/dev?id=123',
      'https://play.google.com.evil.example/store/apps/details?id=x',
      'not a url',
    ]) {
      expect(withPlayInstallReferrer(url, CLICK)).toBe(url);
    }
  });
});

describe('websites are decorated exactly as before', () => {
  it('desktop → web fallback with UTM, deep-link parameters and the click id', async () => {
    mockDb(linkRow({ web_fallback_url: WEB }));
    const res = await get(app, DESKTOP_UA);
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(url.origin + url.pathname).toBe(WEB);
    expect(url.searchParams.get('id')).toBe('evt_42');
    expect(url.searchParams.get('route')).toBe('EVENT_VIEW');
    expect(url.searchParams.get('utm_source')).toBe('newsletter');
    expect(url.searchParams.get('lf_click')).toBeTruthy();
  });

  it('app-open guard: an Android in-app browser still goes to the web fallback, not the store', async () => {
    mockDb(linkRow({ web_fallback_url: WEB }));
    const res = await get(app, ANDROID_INSTAGRAM_UA);
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(url.hostname).toBe('example.com');
    expect(url.searchParams.get('id')).toBe('evt_42');
  });

  it('app-open guard: an App Link still wins over every fallback', async () => {
    mockDb(linkRow({ web_fallback_url: WEB, android_app_link: 'https://app.example.com/e/42' }));
    const res = await get(app, ANDROID_CHROME_UA);
    expect(new URL(String(res.headers.location)).hostname).toBe('app.example.com');
  });
});

describe('isAppStoreUrl', () => {
  it('recognises Google Play and the App Store, whatever the case', () => {
    expect(isAppStoreUrl(PLAY)).toBe(true);
    expect(isAppStoreUrl(APP_STORE)).toBe(true);
    expect(isAppStoreUrl('https://itunes.apple.com/us/app/id1')).toBe(true);
    expect(isAppStoreUrl('https://PLAY.google.com/store/apps/details?id=x')).toBe(true);
  });

  it('does not treat websites, look-alikes or garbage as stores', () => {
    expect(isAppStoreUrl(WEB)).toBe(false);
    expect(isAppStoreUrl('https://play.google.com.evil.example/x')).toBe(false);
    expect(isAppStoreUrl('https://example.com/?u=https://play.google.com')).toBe(false);
    expect(isAppStoreUrl('not a url')).toBe(false);
  });
});
