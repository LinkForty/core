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

function mockDb() {
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
          utm_parameters: null,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

/** The is_bot and bot_reason the resolve stored, once its async insert has run. */
async function storedClick() {
  for (let i = 0; i < 20; i++) {
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO click_events/i.test(sql));
    if (insert) {
      const params = insert[1] as unknown[];
      return { isBot: params[16], botReason: params[17] };
    }
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('no click recorded');
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
