import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../lib/database.js';
import { linkRoutes } from './links.js';
import { sdkRoutes } from './sdk.js';

/**
 * A link's install window can be set in minutes, and a link can hand each
 * click to one install only.
 *
 * Each case clicks from its own /24, so it can only match its own link.
 * Needs a real database; skipped without DATABASE_URL, like database.test.ts.
 */

const ADMIN_URL = process.env.DATABASE_URL;

const clickUserAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';

const installBody = {
  userAgent: 'App/1.0 Android/15',
  timezone: 'Europe/Madrid',
  language: 'en-ES',
  screenWidth: 1080,
  screenHeight: 2400,
  platform: 'android',
  platformVersion: '15',
};

describe.skipIf(!ADMIN_URL)('install window in minutes and one install per click (integration)', () => {
  const dbName = `lf_core_window_once_${Date.now()}`;
  let admin: pg.Client;
  let app: FastifyInstance;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${dbName}`;
    await initializeDatabase({ url: url.toString(), pool: { min: 1, max: 3 } });

    app = Fastify();
    await app.register(linkRoutes);
    await app.register(sdkRoutes);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  async function createLink(body: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/links',
      payload: { originalUrl: 'https://example.com/landing', ...body },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string; short_code: string };
  }

  /** A click on the link from `network`.1, `minutesAgo` minutes ago by the database clock. */
  async function click(linkId: string, network: string, minutesAgo: number) {
    const ce = await db.query(
      `INSERT INTO click_events (link_id, clicked_at, ip_address, user_agent, platform)
       VALUES ($1, NOW() - make_interval(mins => $2), $3, $4, 'android') RETURNING id`,
      [linkId, minutesAgo, `${network}.1`, clickUserAgent]
    );
    await db.query(
      `INSERT INTO device_fingerprints
         (click_id, fingerprint_hash, ip_address, user_agent, timezone, language, screen_width, screen_height, platform, platform_version)
       VALUES ($1, 'h', $2, $3, 'Europe/Madrid', 'en-ES', 412, 915, 'android', '15')`,
      [ce.rows[0].id, `${network}.1`, clickUserAgent]
    );
    return ce.rows[0].id as string;
  }

  async function installFrom(network: string, host = 2) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sdk/v1/install',
      payload: installBody,
      remoteAddress: `${network}.${host}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('matches a click inside a window set in minutes', async () => {
    const link = await createLink({ attributionWindowMinutes: 15 });
    await click(link.id, '81.2.80', 10);
    expect((await installFrom('81.2.80')).attributed).toBe(true);
  });

  it('does not match a click older than a window set in minutes', async () => {
    const link = await createLink({ attributionWindowMinutes: 15 });
    await click(link.id, '81.2.81', 20);
    expect((await installFrom('81.2.81')).attributed).toBe(false);
  });

  it('still applies a window set in hours', async () => {
    const link = await createLink({ attributionWindowHours: 1 });
    await click(link.id, '81.2.82', 50);
    expect((await installFrom('81.2.82')).attributed).toBe(true);

    const old = await createLink({ attributionWindowHours: 1 });
    await click(old.id, '81.2.83', 70);
    expect((await installFrom('81.2.83')).attributed).toBe(false);
  });

  it('replaces a window in minutes when the link is updated with hours', async () => {
    const link = await createLink({ attributionWindowMinutes: 5 });
    const res = await app.inject({ method: 'PUT', url: `/api/links/${link.id}`, payload: { attributionWindowHours: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ attribution_window_hours: 2, attribution_window_minutes: null });
  });

  it('refuses a window in both hours and minutes, and one under five minutes', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ attributionWindowHours: 1, attributionWindowMinutes: 30 }, 'not both'],
      [{ attributionWindowMinutes: 4 }, 'at least 5 minutes'],
    ];
    for (const [body, message] of cases) {
      const res = await app.inject({ method: 'POST', url: '/api/links', payload: { originalUrl: 'https://example.com', ...body } });
      expect(res.statusCode).not.toBe(200);
      expect(res.body).toContain(message);
    }
    const links = await db.query('SELECT COUNT(*)::int AS n FROM links WHERE original_url = $1', ['https://example.com']);
    expect(links.rows[0].n).toBe(0);
  });

  it('hands a click to one install only when the link says so', async () => {
    const link = await createLink({ oneInstallPerClick: true });
    expect(link).toMatchObject({ one_install_per_click: true });
    const clickId = await click(link.id, '81.2.84', 5);

    const first = await installFrom('81.2.84', 2);
    expect(first.attributed).toBe(true);
    const second = await installFrom('81.2.84', 3);
    expect(second.attributed).toBe(false);

    const matched = await db.query('SELECT install_matched_at FROM click_events WHERE id = $1', [clickId]);
    expect(matched.rows[0].install_matched_at).not.toBeNull();
  });

  it('gives a second install the next click when the newest is taken', async () => {
    const link = await createLink({ oneInstallPerClick: true });
    const older = await click(link.id, '81.2.85', 8);
    const newer = await click(link.id, '81.2.85', 4);

    expect((await installFrom('81.2.85', 2)).attributed).toBe(true);
    expect((await installFrom('81.2.85', 3)).attributed).toBe(true);
    expect((await installFrom('81.2.85', 4)).attributed).toBe(false);

    const credited = await db.query(
      'SELECT click_id FROM install_events WHERE click_id = ANY($1) ORDER BY installed_at',
      [[older, newer]]
    );
    expect(credited.rows.map((r) => r.click_id)).toEqual([newer, older]);
  });

  it('lets one click match every install by default', async () => {
    const link = await createLink({});
    expect(link).toMatchObject({ one_install_per_click: false, attribution_window_minutes: null });
    await click(link.id, '81.2.86', 5);

    expect((await installFrom('81.2.86', 2)).attributed).toBe(true);
    expect((await installFrom('81.2.86', 3)).attributed).toBe(true);
  });

  it('keeps the setting on a duplicated link', async () => {
    const link = await createLink({ oneInstallPerClick: true, attributionWindowMinutes: 30 });
    const res = await app.inject({ method: 'POST', url: `/api/links/${link.id}/duplicate` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ one_install_per_click: true, attribution_window_minutes: 30 });
  });
});
