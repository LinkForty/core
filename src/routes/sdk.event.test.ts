import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock the database singleton so the route runs without a real Postgres.
vi.mock('../lib/database.js', () => ({
  db: { query: vi.fn() },
}));

import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { sdkRoutes } from './sdk.js';

const mockQuery = db.query as unknown as Mock;

const INSTALL_ID = '11111111-1111-4111-8111-111111111111';
const LINK_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const CLICK_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(sdkRoutes);
  await app.ready();
  return app;
}

const EVENT_TS = '2026-06-05T10:05:00.000Z';
const LINK_OPENED_AT = '2026-06-05T10:00:00.000Z';

const stampedEvent = {
  installId: INSTALL_ID,
  eventName: 'add_to_cart',
  eventData: { sku: 'abc' },
  timestamp: EVENT_TS,
  attributedLinkId: LINK_ID,
  attributedClickId: CLICK_ID,
  linkOpenedAt: LINK_OPENED_AT,
  sessionId: SESSION_ID,
};

describe('POST /api/sdk/v1/event — last-click attribution stamp', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('persists the attribution stamp on the in_app_events row', async () => {
    // 1) install lookup (link_id null so the webhook block is skipped)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] });
    // 2) the event INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: stampedEvent });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventId: EVENT_ID, acknowledged: true });

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO in_app_events/);
    expect(insertCall[0]).toMatch(/attributed_link_id/);
    // params: install, name, dataJson, ts, link, click, openedAt, session
    expect(insertCall[1]).toEqual([
      INSTALL_ID,
      'add_to_cart',
      JSON.stringify({ sku: 'abc' }),
      EVENT_TS,
      LINK_ID,
      CLICK_ID,
      LINK_OPENED_AT,
      SESSION_ID,
    ]);

    await app.close();
  });

  it('stays backward compatible: an event with no stamp stores null attribution + a sessionId-less row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sdk/v1/event',
      payload: { installId: INSTALL_ID, eventName: 'signup' },
    });

    expect(res.statusCode).toBe(200);
    const params = mockQuery.mock.calls[1][1];
    expect(params[4]).toBeNull(); // attributed_link_id
    expect(params[5]).toBeNull(); // attributed_click_id
    expect(params[6]).toBeNull(); // attributed_at
    expect(params[7]).toBeNull(); // session_id
    await app.close();
  });

  it('never loses an event when the attributed link is stale: falls back to no-link insert on FK violation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] });
    // first INSERT rejects with a Postgres FK violation
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('FK violation'), { code: '23503' }));
    // fallback INSERT (without attributed_link_id) succeeds
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: stampedEvent });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventId: EVENT_ID, acknowledged: true });

    // the fallback INSERT omits attributed_link_id but keeps click/session
    const fallbackCall = mockQuery.mock.calls[2];
    expect(fallbackCall[0]).not.toMatch(/attributed_link_id/);
    expect(fallbackCall[1]).toEqual([
      INSTALL_ID,
      'add_to_cart',
      JSON.stringify({ sku: 'abc' }),
      EVENT_TS,
      CLICK_ID,
      LINK_OPENED_AT,
      SESSION_ID,
    ]);

    await app.close();
  });

  it('returns 404 when the install does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: stampedEvent });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
