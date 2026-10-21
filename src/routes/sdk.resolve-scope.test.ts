/**
 * An SDK that names its app in X-LinkForty-App-Token only resolves that app's
 * organization's links.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
import { sdkRoutes } from './sdk.js';

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const TOKEN_A = 'at_app_a';

function link(organizationId: string) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    short_code: 'abc123',
    organization_id: organizationId,
    original_url: 'https://example.com/landing',
    is_active: true,
    warn_at: null,
    owner_suspended_at: null,
    expires_at: null,
    utm_parameters: null,
  };
}

/** The database holds one link with the code, owned by `owner`. */
function mockDb(owner: string) {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
    if (/INSERT INTO click_events/i.test(sql)) return { rows: [{ id: 'click-1' }], rowCount: 1 };
    if (/FROM links/i.test(sql)) return { rows: [link(owner)], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

const resolveInstallScope = vi.fn(async (_request: unknown, body: { appToken?: string }) =>
  body.appToken === TOKEN_A ? { organizationId: ORG_A } : null
);

let app: FastifyInstance;

async function build(redis?: unknown) {
  app = Fastify();
  if (redis) app.decorate('redis', redis as any);
  await app.register(sdkRoutes, { resolveInstallScope });
  await app.ready();
}

const resolve = (headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/api/sdk/v1/resolve/abc123', headers: { 'user-agent': 'okhttp/4.12.0', ...headers } });

const clickRecorded = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return query.mock.calls.some(([sql]) => /INSERT INTO click_events/i.test(String(sql)));
};

beforeEach(() => {
  resolveInstallScope.mockClear();
});

afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('SDK resolve scoped to the app named in X-LinkForty-App-Token', () => {
  it("resolves the app's own organization's link", async () => {
    mockDb(ORG_A);
    await build();

    const res = await resolve({ 'x-linkforty-app-token': TOKEN_A });

    expect(res.statusCode).toBe(200);
    expect(await clickRecorded()).toBe(true);
  });

  it("answers another organization's code as unknown and records no click", async () => {
    mockDb(ORG_B);
    await build();

    const res = await resolve({ 'x-linkforty-app-token': TOKEN_A });

    expect(res.statusCode).toBe(404);
    expect(await clickRecorded()).toBe(false);
  });

  it("prefers the app's organization when looking a bare code up", async () => {
    mockDb(ORG_A);
    await build();

    await resolve({ 'x-linkforty-app-token': TOKEN_A });

    const lookup = query.mock.calls.find(([sql]) => /FROM links/i.test(String(sql)));
    expect(lookup?.[1]).toEqual(['abc123', ORG_A]);
  });

  it('resolves as before without the header', async () => {
    mockDb(ORG_B);
    await build();

    const res = await resolve();

    expect(res.statusCode).toBe(200);
    expect(resolveInstallScope).not.toHaveBeenCalled();
  });

  it('resolves as before for a token no organization has', async () => {
    mockDb(ORG_B);
    await build();

    const res = await resolve({ 'x-linkforty-app-token': 'at_unknown' });

    expect(res.statusCode).toBe(200);
  });

  it("refuses another organization's link read from the cache", async () => {
    mockDb(ORG_A);
    const cached = JSON.stringify(link(ORG_B));
    await build({ get: async () => cached, setex: async () => undefined });

    const res = await resolve({ 'x-linkforty-app-token': TOKEN_A });

    expect(res.statusCode).toBe(404);
    expect(await clickRecorded()).toBe(false);
  });
});
