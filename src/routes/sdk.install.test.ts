import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock the database singleton so the route runs without a real Postgres.
vi.mock('../lib/database.js', () => ({
  db: { query: vi.fn() },
}));

import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { sdkRoutes } from './sdk.js';

const mockQuery = db.query as unknown as Mock;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(sdkRoutes);
  await app.ready();
  return app;
}

const installBody = {
  userAgent: 'Dalvik/2.1.0 (Linux; U; Android 15; Pixel 8)',
  timezone: 'Europe/Madrid',
  screenWidth: 1080,
  screenHeight: 2400,
  platform: 'Android',
  platformVersion: '15',
  deviceId: 'device-1',
};

describe('POST /api/sdk/v1/install — device values', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // From a loopback address there is no click to match, so the only query is
    // the install INSERT.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'install-1', deep_link_data: {} }] });
  });

  it.each([
    ['Android locale with regional preferences', 'en-ES-u-fw-mon-mu-celsius', 'en-ES'],
    ['iOS locale identifier with a region keyword', 'en_GB@rg=eszzzz', 'en-GB'],
    ['iOS locale identifier with a calendar keyword', 'en_US@calendar=japanese', 'en-US'],
  ])('records an install from an %s', async (_label, language, stored) => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/install', payload: { ...installBody, language } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ installId: 'install-1', attributed: false });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO install_events/);
    expect(params[8]).toBe(stored);
  });

  it('accepts SDK metadata longer than the stored 50 characters', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sdk/v1/install',
      payload: { ...installBody, language: 'en-US', sdkName: 'x'.repeat(80), sdkVersion: '1.0.0' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockQuery.mock.calls[0][1][15]).toHaveLength(50);
  });
});

describe('POST /api/sdk/v1/install — install scope', () => {
  // A public address, so the route looks for candidate clicks unless the scope
  // rules it out.
  const remoteAddress = '24.5.10.7';

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) =>
      /INSERT INTO install_events/.test(sql) ? { rows: [{ id: 'install-1', deep_link_data: {} }] } : { rows: [] }
    );
  });

  async function installWith(resolveInstallScope: () => unknown) {
    const app = Fastify();
    await app.register(sdkRoutes, { resolveInstallScope: resolveInstallScope as any });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sdk/v1/install',
      payload: { ...installBody, appToken: 'token-1' },
      remoteAddress,
    });
    expect(res.statusCode).toBe(200);
    return { body: res.json(), sql: mockQuery.mock.calls.map(([q]) => String(q)) };
  }

  const searchesClicks = (sql: string[]) => sql.some((q) => /FROM device_fingerprints/.test(q));

  it('searches the scoped organization when the hook names one', async () => {
    const { sql } = await installWith(() => ({ organizationId: 'org-1' }));
    expect(searchesClicks(sql)).toBe(true);
  });

  it('searches every click when the hook returns null', async () => {
    const { sql } = await installWith(() => null);
    expect(searchesClicks(sql)).toBe(true);
  });

  it('records an organic install without searching when the hook says match nothing', async () => {
    const { body, sql } = await installWith(() => ({ matchNothing: true }));
    expect(body).toMatchObject({ installId: 'install-1', attributed: false, deepLinkData: null });
    expect(searchesClicks(sql)).toBe(false);
  });

  it('records an organic install without searching when the hook throws', async () => {
    const { body, sql } = await installWith(() => {
      throw new Error('scope lookup failed');
    });
    expect(body).toMatchObject({ installId: 'install-1', attributed: false, deepLinkData: null });
    expect(searchesClicks(sql)).toBe(false);
  });
});
