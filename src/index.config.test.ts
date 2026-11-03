/**
 * createServer() hands linkforty.config.json to the redirect routes.
 *
 * The real server with only the data layer mocked: what matters is that a
 * config object from loadConfig() reaches the pages a visitor sees, and that
 * options passed in code still take precedence over it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
// vi.mock is hoisted above these imports, so index.js still receives the mock.
import { configureScannerDetection, createServer, isEmailScanner, isScannerDetectionEnabled, parseConfig } from './index.js';

const query = vi.fn();
vi.mock('./lib/database.js', () => ({
  SCHEMA_INIT_LOCK_KEY: 0,
  db: { query: (...args: unknown[]) => query(...args) },
  initializeDatabase: vi.fn(async () => undefined),
}));

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function mockLink(row: Record<string, unknown> | null) {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/FROM links l/i.test(sql)) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
}

const link = {
  id: '00000000-0000-0000-0000-0000000000aa',
  short_code: 'abc123',
  original_url: null,
  web_fallback_url: 'https://example.com/page',
  ios_app_store_url: 'https://apps.apple.com/app/id1',
  android_app_store_url: null,
  launchpad_mode: 'inherit',
  is_active: true,
  targeting_rules: null,
  org_settings: null,
};

let server: FastifyInstance | undefined;

afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  await server?.close();
  server = undefined;
});

const visit = (url: string) =>
  server!.inject({ method: 'GET', url, headers: { 'user-agent': DESKTOP_UA, accept: 'text/html' } });

describe('createServer config', () => {
  it('serves the not-found page and Launchpad from the config file', async () => {
    const config = parseConfig({
      notFound: { title: 'Nothing here' },
      launchpad: { desktop: 'always', appName: 'Instance App' },
    });
    server = await createServer({ logger: false, config });

    mockLink(null);
    expect((await visit('/nosuchcode')).body).toContain('<h1>Nothing here</h1>');

    mockLink(link);
    const page = await visit('/abc123');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<span>Instance App</span>');
  });

  it('keeps hooks passed in code alongside the config defaults', async () => {
    const resolveContent = vi.fn().mockReturnValue(null);
    server = await createServer({
      logger: false,
      config: parseConfig({ launchpad: { desktop: 'always' } }),
      redirect: { launchpad: { resolveContent } },
    });
    mockLink(link);
    expect((await visit('/abc123')).statusCode).toBe(200);
    expect(resolveContent).toHaveBeenCalledOnce();
  });

  it('lets options in code take precedence over the file', async () => {
    server = await createServer({
      logger: false,
      config: parseConfig({ notFound: { title: 'From file' }, launchpad: { desktop: 'always' } }),
      redirect: { notFoundDefaults: { title: 'From code' }, launchpad: { defaults: { desktop: 'off' } } },
    });
    mockLink(null);
    expect((await visit('/nosuchcode')).body).toContain('<h1>From code</h1>');
    mockLink(link);
    expect((await visit('/abc123')).statusCode).toBe(302);
  });

  it('behaves as before without a config', async () => {
    server = await createServer({ logger: false });
    mockLink(link);
    expect((await visit('/abc123')).statusCode).toBe(302);
  });
});

describe('createServer: email scanner detection is optional', () => {
  const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const IP = '192.0.2.10';

  afterEach(() => {
    configureScannerDetection({ lookup: null });
  });

  it('starts with the rule off when nothing is configured', async () => {
    server = await createServer({ logger: false });
    expect(isScannerDetectionEnabled()).toBe(false);
    expect(isEmailScanner(WINDOWS_UA, IP)).toBe(false);
  });

  it('starts with the rule off when the database file is missing', async () => {
    server = await createServer({ logger: false, botDetection: { asnDatabasePath: '/nonexistent/asn.mmdb' } });
    expect(isScannerDetectionEnabled()).toBe(false);
  });

  it('accepts a custom lookup, without any database file', async () => {
    server = await createServer({ logger: false, botDetection: { asnLookup: () => 8075 } });
    expect(isEmailScanner(WINDOWS_UA, IP)).toBe(true);
  });

  it('applies the configured network list to a custom lookup', async () => {
    server = await createServer({
      logger: false,
      botDetection: { asnLookup: () => 8075 },
      config: parseConfig({ botDetection: { emailScannerAsns: [64500] } }),
    });
    expect(isEmailScanner(WINDOWS_UA, IP)).toBe(false);
  });

  it('prefers a custom lookup over a database path', async () => {
    server = await createServer({
      logger: false,
      botDetection: { asnLookup: () => 8075, asnDatabasePath: '/nonexistent/asn.mmdb' },
    });
    expect(isEmailScanner(WINDOWS_UA, IP)).toBe(true);
  });

  it('leaves a lookup the host already set in place', async () => {
    configureScannerDetection({ lookup: () => 8075 });
    server = await createServer({ logger: false });
    expect(isEmailScanner(WINDOWS_UA, IP)).toBe(true);
  });
});
