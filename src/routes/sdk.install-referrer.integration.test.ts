import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../lib/database.js';
import { linkRoutes } from './links.js';
import { redirectRoutes } from './redirect.js';
import { sdkRoutes, type SdkRouteOptions } from './sdk.js';

/**
 * An install that sends the Google Play install referrer is matched to the
 * click the referrer names, under the same rules as a fingerprint match, and
 * a referrer without a click id leaves the install to its fingerprint.
 *
 * Each case uses its own /24, so a fingerprint can only match that case's
 * clicks. Needs a real database; skipped without DATABASE_URL, like
 * database.test.ts.
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

const UNKNOWN_CLICK = '00000000-0000-4000-8000-000000000000';

describe.skipIf(!ADMIN_URL)('install referrer matching (integration)', () => {
  const dbName = `lf_core_referrer_${Date.now()}`;
  let admin: pg.Client;
  let app: FastifyInstance;
  let scopedApp: FastifyInstance;

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
    await app.register(redirectRoutes);
    await app.ready();

    // A deployment serving several apps: the app token names the organization.
    scopedApp = Fastify();
    const scoped: SdkRouteOptions = {
      resolveInstallScope: (_request, { appToken }) => (appToken ? { organizationId: appToken } : { matchNothing: true }),
    };
    await scopedApp.register(sdkRoutes, scoped);
    await scopedApp.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await scopedApp?.close();
    await db.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  async function createLink(body: Record<string, unknown> = {}) {
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

  async function install(network: string, extra: Record<string, unknown> = {}, target = app) {
    const res = await target.inject({
      method: 'POST',
      url: '/api/sdk/v1/install',
      payload: { ...installBody, ...extra },
      remoteAddress: `${network}.2`,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function stored(installId: string) {
    const row = await db.query(
      'SELECT link_id, click_id, attribution_method, confidence_score, matched_factors, competing_links FROM install_events WHERE id = $1',
      [installId]
    );
    return row.rows[0];
  }

  it('matches the click the Play redirect named, end to end', async () => {
    const link = await createLink({ androidAppStoreUrl: 'https://play.google.com/store/apps/details?id=com.example.app' });
    const redirect = await app.inject({
      method: 'GET',
      url: `/${link.short_code}`,
      headers: { 'user-agent': clickUserAgent },
      remoteAddress: '81.3.10.1',
    });
    expect(redirect.statusCode).toBe(302);
    const referrer = new URL(String(redirect.headers.location)).searchParams.get('referrer');
    expect(referrer).toMatch(/^lf_click=[0-9a-f-]{36}$/);
    const clickId = new URLSearchParams(referrer ?? '').get('lf_click');

    // The click is written after the response.
    for (let i = 0; i < 50; i++) {
      const found = await db.query('SELECT 1 FROM click_events WHERE id = $1', [clickId]);
      if (found.rowCount) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // Installed on another network (mobile data, say): no fingerprint could match.
    const body = await install('81.3.11', { installReferrer: `${referrer}&utm_source=google-play` });
    expect(body).toMatchObject({
      attributed: true,
      confidenceScore: 100,
      matchedFactors: ['install_referrer'],
      attributionMethod: 'install_referrer',
      competingLinks: 0,
    });
    expect(body.deepLinkData).toMatchObject({ shortCode: link.short_code, attributionMethod: 'install_referrer', competingLinks: 0 });
    expect(await stored(body.installId)).toMatchObject({
      link_id: link.id,
      click_id: clickId,
      attribution_method: 'install_referrer',
      matched_factors: ['install_referrer'],
      competing_links: 0,
    });
  });

  it('prefers the named click over a fingerprint match on the install network', async () => {
    const named = await createLink();
    const nearby = await createLink();
    const clickId = await click(named.id, '81.3.20', 30);
    await click(nearby.id, '81.3.21', 1);

    const body = await install('81.3.21', { installReferrer: `lf_click=${clickId}` });
    expect(body.attributionMethod).toBe('install_referrer');
    expect((await stored(body.installId)).link_id).toBe(named.id);
  });

  it('gives no match, not a fingerprint guess, when the named click is outside its window', async () => {
    const named = await createLink({ attributionWindowMinutes: 10 });
    const nearby = await createLink();
    const clickId = await click(named.id, '81.3.30', 20);
    await click(nearby.id, '81.3.31', 1);

    const body = await install('81.3.31', { installReferrer: `lf_click=${clickId}` });
    expect(body).toMatchObject({ attributed: false, attributionMethod: 'none', deepLinkData: null });
  });

  it('gives no match when the named click is on a link that no longer opens', async () => {
    const named = await createLink();
    const clickId = await click(named.id, '81.3.40', 5);
    await db.query('UPDATE links SET is_active = false WHERE id = $1', [named.id]);

    const body = await install('81.3.40', { installReferrer: `lf_click=${clickId}` });
    expect(body).toMatchObject({ attributed: false, attributionMethod: 'none' });
  });

  it('hands a one-install click to the first install only', async () => {
    const named = await createLink({ oneInstallPerClick: true });
    const clickId = await click(named.id, '81.3.50', 5);

    const first = await install('81.3.51', { installReferrer: `lf_click=${clickId}` });
    expect(first.attributionMethod).toBe('install_referrer');
    const second = await install('81.3.52', { installReferrer: `lf_click=${clickId}` });
    expect(second).toMatchObject({ attributed: false, attributionMethod: 'none' });
  });

  it('falls back to the fingerprint for a referrer with no click id, an unknown one, or a non-string', async () => {
    const link = await createLink();
    await click(link.id, '81.3.60', 5);

    for (const installReferrer of ['utm_source=google-play&utm_medium=organic', `lf_click=${UNKNOWN_CLICK}`, 42]) {
      const body = await install('81.3.60', { installReferrer });
      expect(body).toMatchObject({ attributed: true, attributionMethod: 'fingerprint' });
    }
  });

  it('matches only clicks in the installing app\'s scope', async () => {
    const org = await db.query(`INSERT INTO organizations (name) VALUES ('Referrer test') RETURNING id`);
    const otherOrg = await db.query(`INSERT INTO organizations (name) VALUES ('Referrer test, other') RETURNING id`);
    const mine = await createLink();
    const theirs = await createLink();
    await db.query('UPDATE links SET organization_id = $1 WHERE id = $2', [org.rows[0].id, mine.id]);
    await db.query('UPDATE links SET organization_id = $1 WHERE id = $2', [otherOrg.rows[0].id, theirs.id]);
    const myClick = await click(mine.id, '81.3.70', 5);
    const theirClick = await click(theirs.id, '81.3.71', 5);

    const matched = await install('81.3.72', { installReferrer: `lf_click=${myClick}`, appToken: org.rows[0].id }, scopedApp);
    expect(matched.attributionMethod).toBe('install_referrer');

    const refused = await install('81.3.73', { installReferrer: `lf_click=${theirClick}`, appToken: org.rows[0].id }, scopedApp);
    expect(refused).toMatchObject({ attributed: false, attributionMethod: 'none' });

    const tokenless = await install('81.3.74', { installReferrer: `lf_click=${myClick}` }, scopedApp);
    expect(tokenless).toMatchObject({ attributed: false, attributionMethod: 'none' });
  });
});
