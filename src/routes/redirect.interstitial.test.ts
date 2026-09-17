/**
 * The mobile scheme interstitial: the page a phone gets when a link has a URI
 * scheme, which tries the app and falls back to the store.
 *
 * Its two URLs used to be interpolated into JavaScript source with `"` and `<`
 * replaced — enough to keep a value inside its string literal only until the
 * value contained a backslash or a line terminator. They now reach the document
 * as attributes and the script reads them back, so the JavaScript contains no
 * configured value at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { redirectRoutes } from './redirect.js';
import { safeSchemeHref } from '../lib/link-safety.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: {
    query: (...args: unknown[]) => query(...args),
  },
}));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    title: null,
    og_title: null,
    original_url: null,
    web_fallback_url: null,
    ios_app_store_url: 'https://apps.apple.com/app/id1',
    android_app_store_url: null,
    ios_universal_link: null,
    android_app_link: null,
    app_scheme: 'demo',
    deep_link_path: '/p/1',
    custom_scheme_url: null,
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
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (/FROM links l/i.test(sql)) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
}

const get = (app: FastifyInstance) =>
  app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': IPHONE_UA } });

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

describe('scheme interstitial', () => {
  it('serves the interstitial with the scheme and store URLs as attributes, and no configured value inside the script', async () => {
    mockDb(linkRow({ deep_link_parameters: { x: '1', y: 'two words' } }));
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('id="open-btn" href="demo://p/1?x=1&amp;y=two+words"');
    expect(res.body).toContain('id="store-btn" href="https://apps.apple.com/app/id1"');

    const script = res.body.slice(res.body.indexOf('<script>'), res.body.indexOf('</script>'));
    expect(script).not.toContain('demo://');
    expect(script).not.toContain('apps.apple.com');
    expect(script).toContain("openBtn.getAttribute('href') + hash");
    expect(script).toContain("window.location.replace(storeBtn.getAttribute('href'))");
  });

  /**
   * A custom scheme URL is operator-configured free text. A backslash before the
   * closing quote, or a line terminator, used to end the JavaScript string
   * literal early and take the whole script — auto-open and fallback timer —
   * with it. Now it is an attribute value, escaped like any other.
   */
  it('keeps a scheme URL with a quote, a backslash and a line separator out of the script', async () => {
    mockDb(linkRow({ custom_scheme_url: 'demo://open?q="x"\\ </script><img src=x onerror=alert(1)>' }));
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.body.match(/<\/script>/g)).toHaveLength(1);
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('href="demo://open?q=&quot;x&quot;\\ &lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;"');
  });

  it('escapes an ampersand in the title, which the old generator left raw', async () => {
    mockDb(linkRow({ title: 'Cats & Dogs <3' }));
    const res = await get(app);
    expect(res.body).toContain('<h1>Opening Cats &amp; Dogs &lt;3...</h1>');
  });

  it('treats an executable "scheme" as no scheme: store redirect, no interstitial, no scheme in Location', async () => {
    mockDb(linkRow({ app_scheme: 'javascript', deep_link_path: '/%0aalert(1)' }));
    const res = await get(app);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://apps.apple.com/app/id1');
    expect(res.body).not.toContain('open-btn');
  });

  it('refuses an executable custom scheme URL even when app_scheme itself is fine', async () => {
    mockDb(linkRow({ custom_scheme_url: 'javascript:alert(1)' }));
    const res = await get(app);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('demo://p/1');
  });
});

describe('safeSchemeHref', () => {
  it('accepts app schemes and rejects the ones a browser executes', () => {
    expect(safeSchemeHref('demo://p/1')).toBe('demo://p/1');
    expect(safeSchemeHref('com.example.app://p/1')).toBe('com.example.app://p/1');
    expect(safeSchemeHref('https://example.com/p')).toBe('https://example.com/p');
    for (const bad of ['javascript:alert(1)', 'JavaScript://%0aalert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'blob:x', 'about:blank', 'no-scheme', '']) {
      expect(safeSchemeHref(bad)).toBeNull();
    }
  });
});
