import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../lib/database.js';
import { sdkRoutes } from './sdk.js';

/**
 * An install is matched only to a click on a link that would still open: not
 * one that has expired, been deactivated or been disabled since the click.
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

describe.skipIf(!ADMIN_URL)('install matching skips links that no longer open (integration)', () => {
  const dbName = `lf_core_live_links_${Date.now()}`;
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
    await app.register(sdkRoutes);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  /**
   * A link with one click from `network`.1, ten minutes ago. `columns` are SQL
   * expressions, so times come from the database clock like the matcher's NOW().
   */
  async function clickedLink(code: string, network: string, columns: Record<string, string> = {}) {
    const link = await db.query(
      `INSERT INTO links (short_code, original_url${Object.keys(columns).map((c) => `, ${c}`).join('')})
       VALUES ($1, 'https://example.com/landing'${Object.values(columns).map((v) => `, ${v}`).join('')})
       RETURNING id`,
      [code]
    );
    const click = await db.query(
      `INSERT INTO click_events (link_id, clicked_at, ip_address, user_agent, platform)
       VALUES ($1, NOW() - INTERVAL '10 minutes', $2, $3, 'android') RETURNING id`,
      [link.rows[0].id, `${network}.1`, clickUserAgent]
    );
    await db.query(
      `INSERT INTO device_fingerprints
         (click_id, fingerprint_hash, ip_address, user_agent, timezone, language, screen_width, screen_height, platform, platform_version)
       VALUES ($1, 'h', $2, $3, 'Europe/Madrid', 'en-ES', 412, 915, 'android', '15')`,
      [click.rows[0].id, `${network}.1`, clickUserAgent]
    );
  }

  async function installFrom(network: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sdk/v1/install',
      payload: installBody,
      remoteAddress: `${network}.2`,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('matches a click on a link that still opens', async () => {
    await clickedLink('livelink', '81.2.69');
    const body = await installFrom('81.2.69');
    expect(body.attributed).toBe(true);
    expect(body.deepLinkData.shortCode).toBe('livelink');
  });

  it('does not match a link that expired after the click', async () => {
    await clickedLink('expired', '81.2.70', { expires_at: "NOW() - INTERVAL '1 minute'" });
    expect((await installFrom('81.2.70')).attributed).toBe(false);
  });

  it('matches a link that expires later', async () => {
    await clickedLink('notyet', '81.2.71', { expires_at: "NOW() + INTERVAL '1 hour'" });
    expect((await installFrom('81.2.71')).attributed).toBe(true);
  });

  it('does not match an inactive link', async () => {
    await clickedLink('inactive', '81.2.72', { is_active: 'false' });
    expect((await installFrom('81.2.72')).attributed).toBe(false);
  });

  it('does not match a disabled link', async () => {
    await clickedLink('disabled', '81.2.73', { disabled_at: 'NOW()' });
    expect((await installFrom('81.2.73')).attributed).toBe(false);
  });
});
