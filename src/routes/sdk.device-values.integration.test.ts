import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../lib/database.js';
import { sdkRoutes } from './sdk.js';

/**
 * Whatever a device reports about itself, the SDK endpoints store it.
 *
 * The values below are what real devices and browsers send: locales with
 * Unicode extensions and ICU keywords, long time zone names, metadata from
 * unusual builds. Each is sent through the real routes into a real schema, so
 * a column that cannot hold a reported value fails here rather than on a
 * device. Unit tests with a mocked database cannot see column sizes.
 *
 * Needs a real database; skipped without DATABASE_URL, like database.test.ts.
 */

const ADMIN_URL = process.env.DATABASE_URL;

/** Device languages as platforms report them, and what is stored. */
const DEVICE_LANGUAGES: Array<[reported: string, stored: string | null]> = [
  ['en-US', 'en-US'],
  // Android Locale.toLanguageTag() with regional preferences set
  ['en-ES-u-fw-mon-mu-celsius', 'en-ES'],
  ['de-DE-u-ca-gregory-fw-mon-mu-celsius-nu-latn', 'de-DE'],
  // Android Locale.toString()
  ['en_ES_#u-fw-mon-mu-celsius', 'en-ES'],
  ['zh_CN_#Hans', 'zh-CN'],
  // iOS Locale.identifier
  ['en_GB@rg=eszzzz', 'en-GB'],
  ['en_US@calendar=japanese', 'en-US'],
  ['th_TH@numbers=thai;calendar=buddhist', 'th-TH'],
  // Script subtags and long tags
  ['zh-Hans-CN', 'zh-CN'],
  ['yue-Hant-HK', 'yue-HK'],
  ['sr-Latn-RS', 'sr-RS'],
  ['es-419', 'es-419'],
  ['fil-PH', 'fil-PH'],
  ['ca-ES-valencia', 'ca-ES'],
  // POSIX
  ['en_US.UTF-8', 'en-US'],
  // Not a language
  ['*', null],
  ['x'.repeat(300), null],
];

const baseInstall = {
  userAgent: 'App/1.0 android/15',
  timezone: 'Europe/Madrid',
  screenWidth: 1080,
  screenHeight: 2400,
  platform: 'android',
  platformVersion: '15',
  sdkName: 'android',
  sdkVersion: '1.0.0',
};

describe.skipIf(!ADMIN_URL)('SDK endpoints store any device-reported value (integration)', () => {
  const dbName = `lf_core_device_values_${Date.now()}`;
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

  async function install(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/sdk/v1/install', payload: { ...baseInstall, ...body } });
  }

  it.each(DEVICE_LANGUAGES)('records an install reporting language %j', async (reported, stored) => {
    const deviceId = `lang-${Buffer.from(reported.slice(0, 40)).toString('hex')}`;
    const res = await install({ language: reported, deviceId });

    expect(res.statusCode).toBe(200);
    const row = await db.query('SELECT language FROM install_events WHERE id = $1', [res.json().installId]);
    expect(row.rows[0].language).toBe(stored);
  });

  it('records an install whose every text field is longer than its column', async () => {
    const res = await install({
      language: 'en-ES-u-fw-mon-mu-celsius',
      timezone: 'T'.repeat(500),
      platform: 'P'.repeat(500),
      platformVersion: 'V'.repeat(500),
      userAgent: 'U'.repeat(5000),
      deviceId: 'D'.repeat(1000),
      sdkName: 'N'.repeat(500),
      sdkVersion: 'S'.repeat(500),
      screenWidth: 1e12,
      screenHeight: 2400.5,
      attributionWindowHours: 1e12,
    });

    expect(res.statusCode).toBe(200);
    const row = await db.query(
      `SELECT length(timezone) AS tz, length(platform) AS p, length(platform_version) AS pv,
              length(device_id) AS d, length(sdk_name) AS n, length(sdk_version) AS v,
              screen_width, screen_height, attribution_window_hours
       FROM install_events WHERE id = $1`,
      [res.json().installId]
    );
    expect(row.rows[0]).toMatchObject({ tz: 100, p: 50, pv: 50, d: 255, n: 50, v: 50, screen_width: null, screen_height: 2401 });
    expect(row.rows[0].attribution_window_hours).toBe(168);
  });

  it.each(DEVICE_LANGUAGES.map(([reported, stored], i) => [reported, stored, i] as const))(
    'stores the click fingerprint of a resolve reporting language %j',
    async (reported, stored, i) => {
      // A link per case, so the fingerprint is found by its link rather than by time.
      const code = `devvals${i}`;
      await db.query(`INSERT INTO links (short_code, original_url) VALUES ($1, 'https://example.com/landing')`, [code]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sdk/v1/resolve/${code}?fp_lang=${encodeURIComponent(reported)}&fp_tz=${'Z'.repeat(300)}&fp_sw=99999999999&fp_sh=2400`,
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 8)' },
      });
      expect(res.statusCode).toBe(200);

      // The click and its fingerprint are written after the response.
      let rows: { language: string | null; tz: number; screen_width: number | null }[] = [];
      for (let attempt = 0; attempt < 100 && rows.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const result = await db.query(
          `SELECT f.language, length(f.timezone) AS tz, f.screen_width
           FROM device_fingerprints f
           JOIN click_events c ON c.id = f.click_id
           JOIN links l ON l.id = c.link_id
           WHERE l.short_code = $1`,
          [code]
        );
        rows = result.rows;
      }
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ language: stored, tz: 100, screen_width: null });
    }
  );
});
