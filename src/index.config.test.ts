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
import { createServer, parseConfig } from './index.js';

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
