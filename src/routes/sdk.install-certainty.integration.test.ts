import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../lib/database.js';
import { linkRoutes } from './links.js';
import { sdkRoutes } from './sdk.js';

/**
 * The install response says how the install was matched and how many other
 * links were in contention, and the install row records the same.
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

describe.skipIf(!ADMIN_URL)('install match certainty (integration)', () => {
  const dbName = `lf_core_certainty_${Date.now()}`;
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

  async function storedCompetingLinks(installId: string) {
    const row = await db.query('SELECT attribution_method, competing_links FROM install_events WHERE id = $1', [installId]);
    return row.rows[0];
  }

  it('reports no competing links when one link was clicked', async () => {
    const link = await createLink({});
    await click(link.id, '81.2.90', 5);

    const body = await installFrom('81.2.90');
    expect(body).toMatchObject({ attributed: true, attributionMethod: 'fingerprint', competingLinks: 0 });
    expect(body.deepLinkData).toMatchObject({ attributionMethod: 'fingerprint', competingLinks: 0 });
    expect(await storedCompetingLinks(body.installId)).toEqual({ attribution_method: 'fingerprint', competing_links: 0 });
  });

  it('counts another link clicked from the same network by a matching device', async () => {
    const mine = await createLink({});
    const theirs = await createLink({});
    await click(mine.id, '81.2.91', 6);
    await click(theirs.id, '81.2.91', 4);
    await click(theirs.id, '81.2.91', 3);

    const body = await installFrom('81.2.91');
    expect(body).toMatchObject({ attributed: true, competingLinks: 1 });
    expect(body.deepLinkData.competingLinks).toBe(1);
    expect((await storedCompetingLinks(body.installId)).competing_links).toBe(1);
  });

  it('reports an organic install as none', async () => {
    const body = await installFrom('81.2.92');
    expect(body).toMatchObject({ attributed: false, attributionMethod: 'none', competingLinks: 0, deepLinkData: null });
    expect(await storedCompetingLinks(body.installId)).toEqual({ attribution_method: 'none', competing_links: null });
  });
});
