import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { wellKnownRoutes } from './well-known.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: {
    query: (...args: unknown[]) => query(...args),
  },
}));

const savedEnv = { ...process.env };
let app: FastifyInstance;

beforeEach(async () => {
  process.env.IOS_TEAM_ID = 'TEAM123456';
  process.env.IOS_BUNDLE_ID = 'com.acme.app';
  process.env.ANDROID_PACKAGE_NAME = 'com.acme.app';
  process.env.ANDROID_SHA256_FINGERPRINTS = 'AA:BB';
  query.mockReset();
  app = Fastify();
  await app.register(wellKnownRoutes);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
afterAll(() => {
  process.env = savedEnv;
});

const aasa = () => app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' });
const assetlinks = () => app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' });

describe('well-known with web-only templates', () => {
  it('excludes web-only template paths from both files', async () => {
    query.mockResolvedValue({ rows: [{ slug: 'news2024' }] });

    const apple = (await aasa()).json().applinks.details[0];
    expect(apple.paths).toEqual(['NOT /news2024/*', '*']);
    expect(query.mock.calls[0][0]).toContain(`settings->>'webOnly' = 'true'`);

    const [android] = (await assetlinks()).json();
    expect(android.relation_extensions['delegate_permission/common.handle_all_urls'].dynamic_app_link_components[0])
      .toEqual({ '/': '/news2024/*', exclude: true });
  });

  it('serves the claim-everything files when there are none, or when the lookup fails', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await aasa()).json().applinks.details[0]).toEqual({ appID: 'TEAM123456.com.acme.app', paths: ['*'] });

    query.mockRejectedValueOnce(new Error('db down'));
    const res = await assetlinks();
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].relation_extensions).toBeUndefined();
  });
});
