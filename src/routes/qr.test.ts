/**
 * The QR route's `url` parameter: the code may encode the link on any host and
 * under any template path, but never a URL that is not this link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { qrRoutes, urlPointsAtLink } from './qr.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: { query: (...args: unknown[]) => query(...args) },
}));

describe('urlPointsAtLink', () => {
  it('accepts the link on any host, with or without a template path or query string', () => {
    expect(urlPointsAtLink('https://go.example/abc123', 'abc123')).toBe(true);
    expect(urlPointsAtLink('https://links.brand.com/spring/abc123', 'abc123')).toBe(true);
    expect(urlPointsAtLink('http://go.example/abc123?utm_source=qr', 'abc123')).toBe(true);
  });

  it('rejects other destinations, other schemes and unparseable input', () => {
    expect(urlPointsAtLink('https://evil.example/login', 'abc123')).toBe(false);
    expect(urlPointsAtLink('https://go.example/abc1234', 'abc123')).toBe(false);
    expect(urlPointsAtLink('https://go.example/abc123/extra', 'abc123')).toBe(false);
    expect(urlPointsAtLink('javascript:alert(1)//abc123', 'abc123')).toBe(false);
    expect(urlPointsAtLink('not a url', 'abc123')).toBe(false);
    expect(urlPointsAtLink('https://go.example/', null)).toBe(false);
  });
});

describe('GET /api/links/:id/qr?url=', () => {
  let app: FastifyInstance;
  const env = process.env.SHORTLINK_DOMAIN;

  beforeEach(async () => {
    process.env.SHORTLINK_DOMAIN = 'https://go.example';
    query.mockReset();
    query.mockResolvedValue({ rows: [{ short_code: 'abc123', original_url: null }], rowCount: 1 });
    app = Fastify();
    await app.register(qrRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (env === undefined) delete process.env.SHORTLINK_DOMAIN;
    else process.env.SHORTLINK_DOMAIN = env;
  });

  it('encodes the given URL when it points at the link', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/links/1/qr?format=svg&url=' + encodeURIComponent('https://links.brand.com/spring/abc123'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(res.body).toContain('<svg');
  });

  it('refuses a URL that is not this link', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/links/1/qr?format=svg&url=' + encodeURIComponent('https://evil.example/login'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('still falls back to SHORTLINK_DOMAIN without a url', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/links/1/qr?format=svg' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<svg');
  });
});
