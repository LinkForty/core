/**
 * Route-level tests for the health endpoints.
 *
 * The regression these lock down (issue #35): /health used to have no route at
 * all, so it fell through to the catch-all redirect `/:shortCode` and was
 * answered as a short-code lookup. The last test registers the real redirect
 * plugin alongside health to prove the static path wins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { redirectRoutes } from './redirect.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: {
    query: (...args: unknown[]) => query(...args),
  },
}));

let app: FastifyInstance;

beforeEach(async () => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 });
  app = Fastify();
  await app.register(healthRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('reports the process is up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('never touches the database, so a database outage cannot fail liveness', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('GET /health/ready', () => {
  it('is ready when the database answers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('is 503 when the database is unreachable', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { database: 'error' } });
  });

  it('reports a failing Redis as degraded, not unready', async () => {
    const withRedis = Fastify();
    withRedis.decorate('redis', { ping: async () => { throw new Error('down'); } } as never);
    await withRedis.register(healthRoutes);
    await withRedis.ready();

    const res = await withRedis.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'error' } });
    await withRedis.close();
  });
});

describe('regression: /health is not swallowed by the redirect route', () => {
  it('answers health, not a short-code lookup, when both plugins are registered', async () => {
    const combined = Fastify();
    // Redirect first — the static route must win on specificity, not order.
    await combined.register(redirectRoutes);
    await combined.register(healthRoutes);
    await combined.ready();

    const res = await combined.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    // The redirect handler would have run a links lookup; health must not.
    const linkLookups = query.mock.calls.filter(([sql]) => /FROM links/i.test(String(sql)));
    expect(linkLookups).toHaveLength(0);

    await combined.close();
  });
});
