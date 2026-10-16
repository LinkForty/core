/**
 * The LinkForty bundle: a server's links and analytics in one portable file.
 *
 * A bundle is newline-delimited JSON, gzipped by the file helpers:
 *
 *   {"type":"manifest","format":"linkforty-bundle","formatVersion":1,...,"counts":{...}}
 *   {"type":"link","data":{"id":"…","shortCode":"spring",...}}
 *   ...
 *   {"type":"end","rows":1234,"sha256":"…"}
 *
 * Rows follow the manifest table by table, each table after the ones it
 * references (BUNDLE_TABLES order). `sha256` covers every row line, so a
 * truncated or edited bundle is refused on import. Field names and what is
 * carried come from registry.ts.
 */

import crypto from 'crypto';
import { createRequire } from 'module';
import type { Pool, PoolClient } from 'pg';
import type { Writable } from 'stream';
import { BUNDLE_TABLES, exportedColumns } from './registry.js';

export const BUNDLE_FORMAT = 'linkforty-bundle';
export const BUNDLE_FORMAT_VERSION = 1;

/** Rows read per query while exporting. */
const PAGE_SIZE = 2000;

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export interface BundleManifest {
  type: 'manifest';
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  source: { product: string; version: string };
  scope: { organizationId: string | null };
  counts: Record<string, number>;
}

export interface ExportOptions {
  /** Export one organization's data rather than the whole server. */
  organizationId?: string;
  /**
   * Replace the row filter for some tables when exporting an organization: a
   * SQL condition on alias `t` where `$1` is the organization id. For
   * deployments that relate rows to organizations in ways Core doesn't model.
   */
  filters?: Partial<Record<string, string>>;
  /** Product named in the manifest. Defaults to this package. */
  product?: string;
}

/** Which rows of each table belong to an organization, by default. */
const ORGANIZATION_FILTERS: Record<string, string> = {
  organizations: 't.id = $1',
  link_templates: 't.id IN (SELECT template_id FROM links WHERE organization_id = $1)',
  links: 't.organization_id = $1',
  click_events: 't.link_id IN (SELECT id FROM links WHERE organization_id = $1)',
  device_fingerprints:
    't.click_id IN (SELECT ce.id FROM click_events ce INNER JOIN links l ON l.id = ce.link_id WHERE l.organization_id = $1)',
  install_events: 't.link_id IN (SELECT id FROM links WHERE organization_id = $1)',
  in_app_events:
    't.install_id IN (SELECT ie.id FROM install_events ie INNER JOIN links l ON l.id = ie.link_id WHERE l.organization_id = $1)',
  webhooks: 't.organization_id = $1',
};

function packageVersion(): string {
  try {
    return createRequire(import.meta.url)('../../../package.json').version;
  } catch {
    return 'unknown';
  }
}

async function write(out: Writable, line: string): Promise<void> {
  if (!out.write(line)) {
    await new Promise<void>((resolve) => out.once('drain', resolve));
  }
}

/** Keep only the listed keys of a JSONB object. */
function pickKeys(value: unknown, keys: readonly string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in (value as Record<string, unknown>)) picked[key] = (value as Record<string, unknown>)[key];
  }
  return picked;
}

/**
 * Write a bundle of the server's data, or one organization's, to `out` as
 * NDJSON. Reads a single consistent snapshot. Does not end `out`.
 */
export async function exportBundle(
  pool: Pool,
  out: Writable,
  options: ExportOptions = {}
): Promise<{ counts: Record<string, number>; rows: number; sha256: string }> {
  const client: PoolClient = await pool.connect();
  const organizationId = options.organizationId ?? null;
  const filterFor = (table: string): string | null =>
    organizationId ? options.filters?.[table] ?? ORGANIZATION_FILTERS[table] : null;

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const counts: Record<string, number> = {};
    for (const table of Object.keys(BUNDLE_TABLES)) {
      const filter = filterFor(table);
      const result = await client.query(
        `SELECT COUNT(*)::int AS n FROM ${table} t${filter ? ` WHERE ${filter}` : ''}`,
        filter ? [organizationId] : []
      );
      counts[BUNDLE_TABLES[table].record] = result.rows[0].n;
    }

    const manifest: BundleManifest = {
      type: 'manifest',
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      source: { product: options.product ?? '@linkforty/core', version: packageVersion() },
      scope: { organizationId },
      counts,
    };
    await write(out, JSON.stringify(manifest) + '\n');

    const hash = crypto.createHash('sha256');
    let rows = 0;

    for (const [table, rule] of Object.entries(BUNDLE_TABLES)) {
      const columns = exportedColumns(table);
      const select = columns.map(([column]) => `t.${column}`).join(', ');
      const filter = filterFor(table);
      let after: string | null = null;

      for (;;) {
        const params: unknown[] = filter ? [organizationId] : [];
        const conditions: string[] = filter ? [`(${filter})`] : [];
        if (after) {
          params.push(after);
          conditions.push(`t.${rule.key} > $${params.length}`);
        }
        params.push(PAGE_SIZE);
        // row_to_json renders every value as Postgres stores it — timestamps
        // with and without zones, inet, arrays, jsonb — so a bundle restores exactly.
        const page = await client.query(
          `SELECT row_to_json(r) AS row, r.${rule.key}::text AS key FROM (
             SELECT ${select} FROM ${table} t
             ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
             ORDER BY t.${rule.key}
             LIMIT $${params.length}
           ) r`,
          params
        );

        for (const { row } of page.rows) {
          const data: Record<string, unknown> = {};
          for (const [column, columnRule] of columns) {
            const value = row[column];
            data[columnRule.field] =
              columnRule.class === 'portable' && columnRule.keys ? pickKeys(value, columnRule.keys) : value;
          }
          const line = JSON.stringify({ type: rule.record, data }) + '\n';
          hash.update(line);
          await write(out, line);
          rows++;
        }

        if (page.rows.length < PAGE_SIZE) break;
        after = page.rows[page.rows.length - 1].key;
      }
    }

    const sha256 = hash.digest('hex');
    await write(out, JSON.stringify({ type: 'end', rows, sha256 }) + '\n');
    await client.query('COMMIT');
    return { counts, rows, sha256 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export { ZERO_UUID };
