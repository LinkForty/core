/**
 * The click an SDK resolve records: an app opening a link through the SDK is a
 * person's tap, whatever HTTP library the app sends it with.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({ db: { query: (...a: unknown[]) => query(...a) } }));
import { sdkRoutes } from './sdk.js';

const LINK_ID = '00000000-0000-0000-0000-0000000000aa';

function mockDb(utmParameters: Record<string, string> | null = null) {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ x: 1 }], rowCount: 1 };
    if (/INSERT INTO click_events/i.test(sql)) return { rows: [{ id: 'click-1' }], rowCount: 1 };
    if (/FROM links/i.test(sql)) {
      return {
        rows: [{
          id: LINK_ID,
          short_code: 'abc123',
          organization_id: '00000000-0000-0000-0000-0000000000bb',
          original_url: 'https://example.com/landing',
          is_active: true,
          warn_at: null,
          owner_suspended_at: null,
          expires_at: null,
          utm_parameters: utmParameters,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

/** The parameters of the click the resolve inserted, once its async insert has run. */
async function insertedClickParams(): Promise<unknown[]> {
  for (let i = 0; i < 20; i++) {
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO click_events/i.test(sql));
    if (insert) return insert[1] as unknown[];
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('no click recorded');
}

/** The is_bot and bot_reason the resolve stored. */
async function storedClick() {
  const params = await insertedClickParams();
  return { isBot: params[16], botReason: params[17] };
}

/** The utm_source, utm_medium and utm_campaign the resolve stored. */
async function storedUtms() {
  const params = await insertedClickParams();
  return { source: params[12], medium: params[13], campaign: params[14] };
}

let app: FastifyInstance;

beforeEach(async () => {
  mockDb();
  app = Fastify();
  await app.register(sdkRoutes);
  await app.ready();
});

afterEach(async () => {
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('SDK resolve click classification', () => {
  it('records an Android SDK resolve (okhttp user agent) as a human click', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sdk/v1/resolve/abc123',
      headers: { 'user-agent': 'okhttp/4.12.0', 'x-linkforty-sdk': 'android/1.4.0' },
    });

    expect(res.statusCode).toBe(200);
    expect(await storedClick()).toEqual({ isBot: false, botReason: null });
  });

  it('still records an okhttp request without the SDK header as a bot', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/sdk/v1/resolve/abc123',
      headers: { 'user-agent': 'okhttp/4.12.0' },
    });

    expect(await storedClick()).toEqual({ isBot: true, botReason: 'ua' });
  });
});

describe('SDK resolve click UTMs', () => {
  const SDK_HEADERS = { 'user-agent': 'okhttp/4.12.0', 'x-linkforty-sdk': 'android/1.9.0' };

  it("records the link's stored UTMs when the tapped URL carries none", async () => {
    mockDb({ source: 'newsletter', medium: 'email', campaign: 'spring' });

    await app.inject({ method: 'GET', url: '/api/sdk/v1/resolve/utm001', headers: SDK_HEADERS });

    expect(await storedUtms()).toEqual({ source: 'newsletter', medium: 'email', campaign: 'spring' });
  });

  it('lets UTMs on the tapped URL override the stored ones per key', async () => {
    mockDb({ source: 'newsletter', medium: 'email', campaign: 'spring' });

    await app.inject({ method: 'GET', url: '/api/sdk/v1/resolve/utm002?utm_source=braze', headers: SDK_HEADERS });

    expect(await storedUtms()).toEqual({ source: 'braze', medium: 'email', campaign: 'spring' });
  });

  it('records no UTMs for a link without any', async () => {
    await app.inject({ method: 'GET', url: '/api/sdk/v1/resolve/utm003', headers: SDK_HEADERS });

    expect(await storedUtms()).toEqual({ source: null, medium: null, campaign: null });
  });
});
