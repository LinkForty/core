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
  sdkName: 'react-native',
  sdkVersion: '1.4.0',
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
      'react-native',
      '1.4.0',
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
    // first INSERT rejects with the attributed_link_id FK violation
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('FK violation'), { code: '23503', constraint: 'in_app_events_attributed_link_id_fkey' }));
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
      'react-native',
      '1.4.0',
    ]);

    await app.close();
  });

  it('rethrows a non-link FK violation (e.g. install deleted mid-request) instead of mislabeling it as a link problem', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] });
    // install_id's FK lost to a concurrent install delete — a 23503 that is NOT the link FK
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('FK violation'), { code: '23503', constraint: 'in_app_events_install_id_fkey' }));

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: stampedEvent });

    // Surfaces as a real error; no misleading no-link fallback insert is attempted.
    expect(res.statusCode).toBe(500);
    expect(mockQuery.mock.calls.length).toBe(2); // install lookup + the failed insert only
    await app.close();
  });

});

/**
 * An event whose install is gone.
 *
 * The install id lives in the app's storage for the life of the install, so a
 * missing row is permanent from the device's point of view: refusing the event
 * silences that app forever. A deployment that prunes analytics on a retention
 * window reaches this the moment an install outlives the window.
 */
describe('POST /api/sdk/v1/event — an install the server no longer has', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const orphanEvent = {
    installId: INSTALL_ID,
    eventName: 'purchase',
    eventData: { value: 12 },
    sdkName: 'android',
    sdkVersion: '1.3.2',
  };

  it('records the install again and stores the event against it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });                               // 1) install lookup: gone
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] }); // 2) recovery insert
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });               // 3) the event insert

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: orphanEvent });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventId: EVENT_ID, acknowledged: true });

    const recovery = mockQuery.mock.calls[1];
    expect(recovery[0]).toMatch(/INSERT INTO install_events/);
    // The id the client sent, so the device's next event resolves normally.
    expect(recovery[1][0]).toBe(INSTALL_ID);
    // A marker, never a real hash: it cannot collide with a fingerprint match.
    expect(recovery[1][1]).toBe(`recovered:${INSTALL_ID}`);
    expect(recovery[1].slice(2)).toEqual(['android', '1.3.2']);
    // Concurrent events for the same install must not collide.
    expect(recovery[0]).toMatch(/ON CONFLICT \(id\) DO NOTHING/);

    // The event is stored against that install, unattributed.
    const insert = mockQuery.mock.calls[2];
    expect(insert[0]).toMatch(/INSERT INTO in_app_events/);
    expect(insert[1][0]).toBe(INSTALL_ID);

    await app.close();
  });

  it('claims no attribution for a recovered install', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });

    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: orphanEvent });

    const sql = mockQuery.mock.calls[1][0] as string;
    expect(sql).toMatch(/'recovered'/);
    // No link, click or confidence among the columns written: a device we have
    // met before is not a new attributed install, and nothing downstream may
    // read it as one. (The RETURNING clause reads link_id back; that is not a
    // write.)
    const columns = sql.slice(sql.indexOf('('), sql.indexOf('VALUES'));
    expect(columns).not.toMatch(/link_id|click_id|confidence_score/);

    await app.close();
  });

  it('uses the row a concurrent request created rather than failing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });                                  // lookup: gone
    mockQuery.mockResolvedValueOnce({ rows: [] });                                  // insert: lost the race
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: LINK_ID }] }); // re-read
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });                  // event insert
    mockQuery.mockResolvedValueOnce({ rows: [] });                                  // webhook lookup (link_id set)

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: orphanEvent });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ eventId: EVENT_ID, acknowledged: true });

    await app.close();
  });

  it('tells a client what to do when recovery cannot complete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // lookup: gone
    mockQuery.mockResolvedValueOnce({ rows: [] }); // insert: no row
    mockQuery.mockResolvedValueOnce({ rows: [] }); // re-read: still nothing

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: orphanEvent });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'Install event not found',
      code: 'INSTALL_NOT_FOUND',
      action: 'reregister',
    });

    await app.close();
  });

  it('leaves a known install untouched', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: INSTALL_ID, link_id: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: EVENT_ID }] });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/sdk/v1/event', payload: orphanEvent });

    expect(res.statusCode).toBe(200);
    // Two queries only: the lookup and the event. No recovery insert.
    expect(mockQuery.mock.calls).toHaveLength(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO in_app_events/);

    await app.close();
  });
});
