import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../lib/database.js';
import { setLinkScopeResolver } from '../lib/link-lookup.js';
import { redirectRoutes } from './redirect.js';
import { sdkRoutes } from './sdk.js';
import { previewRoutes } from './preview.js';

/**
 * A host that belongs to an organization serves only that organization's
 * links, by bare code or by template URL; a shared host resolves as before.
 *
 * Needs a real database; skipped without DATABASE_URL, like database.test.ts.
 */

const ADMIN_URL = process.env.DATABASE_URL;

const OWN_HOST = 'links.org-a.example';
const SHARED_HOST = 'shared.example';

describe.skipIf(!ADMIN_URL)('bare codes on an organization host (integration)', () => {
  const dbName = `lf_core_host_scope_${Date.now()}`;
  let admin: pg.Client;
  let app: FastifyInstance;
  let orgA: string;
  let orgB: string;
  const logged: unknown[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${dbName}`;
    await initializeDatabase({ url: url.toString(), pool: { min: 1, max: 3 } });

    orgA = (await db.query(`INSERT INTO organizations (name) VALUES ('Host scope A') RETURNING id`)).rows[0].id;
    orgB = (await db.query(`INSERT INTO organizations (name) VALUES ('Host scope B') RETURNING id`)).rows[0].id;
    const templateA = (await db.query(
      `INSERT INTO link_templates (name, slug) VALUES ('A', 'tmpl-a') RETURNING id`
    )).rows[0].id;
    const templateB = (await db.query(
      `INSERT INTO link_templates (name, slug) VALUES ('B', 'tmpl-b') RETURNING id`
    )).rows[0].id;

    const link = (code: string, org: string, template: string | null, destination: string) =>
      db.query(
        `INSERT INTO links (short_code, original_url, organization_id, template_id) VALUES ($1, $2, $3, $4)`,
        [code, destination, org, template]
      );
    // A has a templated link and an untemplated one; B has a code A lacks, and
    // a code both organizations use.
    await link('a-tmpl', orgA, templateA, 'https://a.example/templated');
    await link('a-bare', orgA, null, 'https://a.example/bare');
    await link('b-only', orgB, templateB, 'https://b.example/only');
    await link('both', orgB, templateB, 'https://b.example/both');
    await link('both', orgA, templateA, 'https://a.example/both');

    setLinkScopeResolver((request) => (request.headers.host === OWN_HOST ? orgA : null));

    app = Fastify({ logger: { level: 'info', stream: { write: (line: string) => logged.push(JSON.parse(line)) } } });
    await app.register(sdkRoutes);
    await app.register(previewRoutes);
    await app.register(redirectRoutes);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    setLinkScopeResolver(undefined);
    await app?.close();
    await db.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }, 60_000);

  const get = (host: string, url: string) => app.inject({ method: 'GET', url, headers: { host } });

  it("resolves the host organization's own codes, templated or not", async () => {
    expect((await get(OWN_HOST, '/a-tmpl')).headers.location).toBe('https://a.example/templated');
    expect((await get(OWN_HOST, '/a-bare')).headers.location).toBe('https://a.example/bare');
    expect((await get(OWN_HOST, '/both')).headers.location).toBe('https://a.example/both');
  });

  it("answers 404 for another organization's code, and logs it", async () => {
    logged.length = 0;
    const res = await get(OWN_HOST, '/b-only');
    expect(res.statusCode).toBe(404);
    expect(logged).toContainEqual(
      expect.objectContaining({ shortCode: 'b-only', scope: orgA, reason: 'other_organization_link' })
    );
  });

  it('logs nothing for a code no organization has', async () => {
    logged.length = 0;
    expect((await get(OWN_HOST, '/nobody')).statusCode).toBe(404);
    expect(logged).not.toContainEqual(expect.objectContaining({ reason: 'other_organization_link' }));
  });

  it('resolves every code on a shared host, as before', async () => {
    expect((await get(SHARED_HOST, '/b-only')).headers.location).toBe('https://b.example/only');
    expect((await get(SHARED_HOST, '/a-bare')).headers.location).toBe('https://a.example/bare');
  });

  it("answers 404 for another organization's template URL, and logs it", async () => {
    logged.length = 0;
    expect((await get(OWN_HOST, '/tmpl-b/b-only')).statusCode).toBe(404);
    expect(logged).toContainEqual(
      expect.objectContaining({ shortCode: 'b-only', scope: orgA, reason: 'other_organization_link' })
    );
    expect((await get(OWN_HOST, '/tmpl-a/a-tmpl')).headers.location).toBe('https://a.example/templated');
    expect((await get(SHARED_HOST, '/tmpl-b/b-only')).headers.location).toBe('https://b.example/only');
  });

  it("refuses another organization's template URL after the shared host has cached it", async () => {
    await get(SHARED_HOST, '/tmpl-b/both');
    expect((await get(OWN_HOST, '/tmpl-b/both')).statusCode).toBe(404);
  });

  it('applies the same rule to SDK resolve and the preview page', async () => {
    expect((await get(OWN_HOST, '/api/sdk/v1/resolve/a-tmpl')).statusCode).toBe(200);
    expect((await get(OWN_HOST, '/api/sdk/v1/resolve/b-only')).statusCode).toBe(404);
    expect((await get(SHARED_HOST, '/api/sdk/v1/resolve/b-only')).statusCode).toBe(200);
    expect((await get(OWN_HOST, '/api/sdk/v1/resolve/tmpl-b/b-only')).statusCode).toBe(404);
    expect((await get(SHARED_HOST, '/api/sdk/v1/resolve/tmpl-b/b-only')).statusCode).toBe(200);

    expect((await get(OWN_HOST, '/a-tmpl/preview')).statusCode).toBe(200);
    expect((await get(OWN_HOST, '/b-only/preview')).statusCode).toBe(404);
    expect((await get(SHARED_HOST, '/b-only/preview')).statusCode).toBe(200);

    // A social scraper on a template URL is served only on a host that may serve the link.
    const scrape = (host: string, url: string) =>
      app.inject({ method: 'GET', url, headers: { host, 'user-agent': 'facebookexternalhit/1.1' } });
    expect((await scrape(OWN_HOST, '/tmpl-b/b-only')).statusCode).toBe(404);
    expect((await scrape(SHARED_HOST, '/tmpl-b/b-only')).statusCode).not.toBe(404);
  });
});
