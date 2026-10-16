import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../database.js';
import { BUNDLE_TABLES, exportedColumns } from './registry.js';
import { exportBundleToFile, importBundleFile } from './files.js';
import { BundleError } from './import.js';

/**
 * A bundle restores exactly what it exported: every carried column, value for
 * value, with excluded columns left behind. Import refuses conflicts and
 * tampered files, and can target a different organization.
 *
 * Needs a real database; skipped without DATABASE_URL, like database.test.ts.
 */

const ADMIN_URL = process.env.DATABASE_URL;

const ORG_A = '0a0a0a0a-0000-4000-8000-00000000000a';
const ORG_B = '0b0b0b0b-0000-4000-8000-00000000000b';
const ORG_X = '0c0c0c0c-0000-4000-8000-00000000000c';
const TEMPLATE = '1a1a1a1a-0000-4000-8000-00000000001a';
const LINK_A = '2a2a2a2a-0000-4000-8000-00000000002a';
const LINK_B = '2b2b2b2b-0000-4000-8000-00000000002b';
const CLICK = '3a3a3a3a-0000-4000-8000-00000000003a';
const INSTALL = '4a4a4a4a-0000-4000-8000-00000000004a';
const WEBHOOK = '5a5a5a5a-0000-4000-8000-00000000005a';

describe.skipIf(!ADMIN_URL)('LinkForty bundles (integration)', () => {
  const stamp = Date.now();
  const names = { source: `lf_core_bundle_src_${stamp}`, target: `lf_core_bundle_dst_${stamp}`, other: `lf_core_bundle_org_${stamp}` };
  const pools: Record<keyof typeof names, pg.Pool> = {} as any;
  let admin: pg.Client;
  let dir: string;

  const urlFor = (name: string) => {
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${name}`;
    return url.toString();
  };

  /** Every carried column of every row, as Postgres renders it. */
  async function snapshot(pool: pg.Pool) {
    const out: Record<string, unknown[]> = {};
    for (const [table, rule] of Object.entries(BUNDLE_TABLES)) {
      const cols = exportedColumns(table).map(([c]) => c).join(', ');
      const result = await pool.query(`SELECT row_to_json(r) AS row FROM (SELECT ${cols} FROM ${table} ORDER BY ${rule.key}) r`);
      out[table] = result.rows.map((r) => r.row);
    }
    return out;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    for (const key of ['other', 'target', 'source'] as const) {
      await admin.query(`CREATE DATABASE ${names[key]}`);
      await initializeDatabase({ url: urlFor(names[key]), pool: { min: 1, max: 3 } });
      pools[key] = db;
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-bundle-'));

    const q = (sql: string, params: unknown[] = []) => pools.source.query(sql, params);
    await q(
      `INSERT INTO organizations (id, name, settings, suspended_at) VALUES
         ($1, 'A', '{"appConfig":{"webFallbackUrl":"https://a.example"},"launchpad":{"mobile":"page"},"brandKit":{"accent":"#000"}}', NOW()),
         ($2, 'B', '{}', NULL)`,
      [ORG_A, ORG_B]
    );
    await q(`INSERT INTO link_templates (id, name, slug, settings, is_default) VALUES ($1, 'T', 'tpl-a', '{"defaultWebFallbackUrl":"https://t.example"}', true)`, [TEMPLATE]);
    await q(
      `INSERT INTO links (id, organization_id, template_id, short_code, original_url, web_fallback_url, deep_link_parameters,
                          utm_parameters, expires_at, warn_at, disabled_reason, created_at)
       VALUES ($1, $2, $3, 'promo', 'https://a.example/p', 'https://a.example/p', '{"token":"x"}', '{"source":"ig"}',
               '2030-01-02 03:04:05.678', '2026-10-01 12:00:00+00', 'flagged', '2026-01-01 00:00:00.123456')`,
      [LINK_A, ORG_A, TEMPLATE]
    );
    await q(`INSERT INTO links (id, organization_id, short_code, original_url) VALUES ($1, $2, 'promo', 'https://b.example')`, [LINK_B, ORG_B]);
    await q(
      `INSERT INTO click_events (id, link_id, clicked_at, ip_address, latitude, longitude, link_params, is_bot)
       VALUES ($1, $2, '2026-10-15 10:00:00.5', '203.0.113.7', 37.7749, -122.4194, '{"fbclid":"abc"}', false)`,
      [CLICK, LINK_A]
    );
    await q(
      `INSERT INTO device_fingerprints (click_id, fingerprint_hash, ip_address, user_agent, screen_width) VALUES ($1, 'h', '2001:db8::1', 'UA', 1170)`,
      [CLICK]
    );
    await q(
      `INSERT INTO install_events (id, link_id, click_id, fingerprint_hash, confidence_score, matched_factors, deep_link_data, ip_address)
       VALUES ($1, $2, $3, 'h', 90.5, ARRAY['ip','platform'], '{"shortCode":"promo"}', '203.0.113.7')`,
      [INSTALL, LINK_A, CLICK]
    );
    await q(`INSERT INTO in_app_events (install_id, event_name, event_data, event_timestamp) VALUES ($1, 'purchase', '{"revenue":29.99}', NOW())`, [INSTALL]);
    await q(
      `INSERT INTO webhooks (id, organization_id, name, url, secret, events, headers) VALUES ($1, $2, 'W', 'https://hooks.example', 'old-secret', '{click_event,install_event}', '{"X-Key":"1"}')`,
      [WEBHOOK, ORG_A]
    );
  }, 120_000);

  afterAll(async () => {
    for (const pool of Object.values(pools)) await pool?.end().catch(() => undefined);
    for (const name of Object.values(names)) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('restores every carried column exactly, and nothing it excludes', async () => {
    const file = path.join(dir, 'all.lfbundle');
    const exported = await exportBundleToFile(pools.source, file);
    expect(exported.counts).toMatchObject({ organization: 2, link: 2, click: 1, fingerprint: 1, install: 1, event: 1, webhook: 1 });

    const report = await importBundleFile(pools.target, file);
    expect(report.conflicts).toEqual([]);
    expect(report.imported).toBe(true);

    const [source, target] = [await snapshot(pools.source), await snapshot(pools.target)];
    // Settings carry only the listed keys.
    const orgA = (source.organizations as any[]).find((o) => o.id === ORG_A);
    delete orgA.settings.brandKit;
    expect(target).toEqual(source);

    const link = await pools.target.query('SELECT warn_at, disabled_reason FROM links WHERE id = $1', [LINK_A]);
    expect(link.rows[0]).toEqual({ warn_at: null, disabled_reason: null });
    const org = await pools.target.query('SELECT suspended_at FROM organizations WHERE id = $1', [ORG_A]);
    expect(org.rows[0].suspended_at).toBeNull();

    const webhook = await pools.target.query('SELECT secret FROM webhooks WHERE id = $1', [WEBHOOK]);
    expect(webhook.rows[0].secret).not.toBe('old-secret');
    expect(report.webhooks).toEqual([{ id: WEBHOOK, url: 'https://hooks.example', secret: webhook.rows[0].secret }]);
  }, 60_000);

  it('reports conflicts and writes nothing when the data is already there', async () => {
    const file = path.join(dir, 'all.lfbundle');
    const before = await snapshot(pools.target);
    const report = await importBundleFile(pools.target, file);
    expect(report.imported).toBe(false);
    expect(report.conflicts).toEqual(
      expect.arrayContaining([
        { record: 'link', kind: 'id_exists', value: LINK_A },
        { record: 'link', kind: 'short_code_taken', value: 'promo' },
        { record: 'template', kind: 'template_slug_taken', value: 'tpl-a' },
      ])
    );
    expect(await snapshot(pools.target)).toEqual(before);
  }, 60_000);

  it('refuses a bundle that was changed after export', async () => {
    const file = path.join(dir, 'all.lfbundle');
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString().replace('https://a.example/p', 'https://evil.example/p');
    const tampered = path.join(dir, 'tampered.lfbundle');
    fs.writeFileSync(tampered, zlib.gzipSync(text));
    await expect(importBundleFile(pools.other, tampered)).rejects.toThrow(BundleError);
  });

  it("exports one organization's data and imports it into another organization", async () => {
    const file = path.join(dir, 'org-a.lfbundle');
    const exported = await exportBundleToFile(pools.source, file, { organizationId: ORG_A });
    expect(exported.counts).toMatchObject({ organization: 1, link: 1, click: 1, install: 1, event: 1, webhook: 1, template: 1 });

    await pools.other.query(`INSERT INTO organizations (id, name) VALUES ($1, 'X')`, [ORG_X]);
    const dry = await importBundleFile(pools.other, file, { organizationId: ORG_X, dryRun: true });
    expect(dry).toMatchObject({ imported: false, conflicts: [] });
    expect((await pools.other.query('SELECT COUNT(*)::int AS n FROM links')).rows[0].n).toBe(0);

    const report = await importBundleFile(pools.other, file, { organizationId: ORG_X });
    expect(report.imported).toBe(true);
    const links = await pools.other.query('SELECT id, organization_id FROM links');
    expect(links.rows).toEqual([{ id: LINK_A, organization_id: ORG_X }]);
    const orgs = await pools.other.query('SELECT id FROM organizations');
    expect(orgs.rows).toEqual([{ id: ORG_X }]);
  }, 60_000);
});
