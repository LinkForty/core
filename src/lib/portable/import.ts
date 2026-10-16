/**
 * Restoring a LinkForty bundle (bundle.ts).
 *
 * Import reads the bundle twice. The first pass checks it: the format, the
 * checksum, and every row against the target database — ids already present,
 * short codes already used in the target organization, template slugs already
 * taken. If anything conflicts, or on a dry run, it stops there and reports.
 * The second pass writes every row in one transaction, so an import either
 * lands whole or not at all. Ids are kept, so links, clicks and installs stay
 * connected, and apps keep the install ids they already hold.
 */

import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION, ZERO_UUID, type BundleManifest } from './bundle.js';
import { BUNDLE_TABLES, exportedColumns, type ColumnRule } from './registry.js';
import { generateWebhookSecret } from '../webhook.js';

export interface ImportOptions {
  /** Check the bundle against the database and report, without writing. */
  dryRun?: boolean;
  /**
   * Import into this organization: links and webhooks are assigned to it, and
   * the bundle's own organization record is not created.
   */
  organizationId?: string;
  /** Assign imported links, templates and webhooks to this user (null clears it). */
  userId?: string | null;
}

export interface ImportConflict {
  record: string;
  kind: 'id_exists' | 'short_code_taken' | 'template_slug_taken';
  value: string;
}

export interface ImportReport {
  manifest: BundleManifest;
  /** Rows per record type found in the bundle. */
  counts: Record<string, number>;
  /** Conflicts with the target database, at most 100 per kind and record. */
  conflicts: ImportConflict[];
  imported: boolean;
  /** Imported webhooks with the signing secrets issued to them. */
  webhooks: Array<{ id: string; url: string; secret: string }>;
}

export class BundleError extends Error {}

/** Rows written or checked per statement. */
const BATCH_SIZE = 1000;
const CONFLICT_CAP = 100;

const TABLE_BY_RECORD = new Map(Object.entries(BUNDLE_TABLES).map(([table, rule]) => [rule.record, table]));

interface Row {
  record: string;
  table: string;
  data: Record<string, unknown>;
}

/**
 * Parse and verify a bundle's lines: manifest first, rows, then a trailer
 * whose checksum and count match. Yields rows; throws BundleError on anything
 * malformed.
 */
async function* readBundle(
  lines: AsyncIterable<string>,
  onManifest: (manifest: BundleManifest) => void
): AsyncGenerator<Row> {
  const hash = crypto.createHash('sha256');
  let manifest: BundleManifest | null = null;
  let rows = 0;
  let ended = false;

  for await (const raw of lines) {
    if (raw === '') continue;
    if (ended) throw new BundleError('Data after the end of the bundle');
    let line: any;
    try {
      line = JSON.parse(raw);
    } catch {
      throw new BundleError('Bundle contains a line that is not JSON');
    }

    if (!manifest) {
      if (line?.type !== 'manifest' || line.format !== BUNDLE_FORMAT) {
        throw new BundleError('Not a LinkForty bundle');
      }
      if (typeof line.formatVersion !== 'number' || line.formatVersion > BUNDLE_FORMAT_VERSION) {
        throw new BundleError(
          `Bundle format version ${line.formatVersion} is newer than this server reads (${BUNDLE_FORMAT_VERSION}); upgrade first`
        );
      }
      manifest = line as BundleManifest;
      onManifest(manifest);
      continue;
    }

    if (line?.type === 'end') {
      if (line.rows !== rows || line.sha256 !== hash.digest('hex')) {
        throw new BundleError('Bundle checksum does not match; the file is incomplete or was changed');
      }
      ended = true;
      continue;
    }

    const table = TABLE_BY_RECORD.get(line?.type);
    if (!table || !line.data || typeof line.data !== 'object') {
      throw new BundleError(`Unknown record type in bundle: ${String(line?.type)}`);
    }
    hash.update(raw + '\n');
    rows++;
    yield { record: line.type, table, data: line.data };
  }

  if (!manifest) throw new BundleError('Bundle is empty');
  if (!ended) throw new BundleError('Bundle has no end record; the file is incomplete');
}

/** A bundle row as a row of its table, with the import's assignments applied. */
function toColumns(row: Row, options: ImportOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, rule] of exportedColumns(row.table)) {
    let value = row.data[rule.field];
    if (rule.class === 'portable' && rule.keys && value && typeof value === 'object' && !Array.isArray(value)) {
      value = Object.fromEntries(rule.keys.filter((k) => k in (value as object)).map((k) => [k, (value as any)[k]]));
    }
    if (rule.class === 'remap') {
      if (rule.owner === 'organization' && options.organizationId) value = options.organizationId;
      if (rule.owner === 'user' && options.userId !== undefined) value = options.userId;
    }
    out[column] = value ?? null;
  }
  return out;
}

/** Rows grouped into batches, each batch from a single table. */
async function* batches(rows: AsyncIterable<Row>): AsyncGenerator<Row[]> {
  let batch: Row[] = [];
  for await (const row of rows) {
    if (batch.length > 0 && (batch[0].table !== row.table || batch.length >= BATCH_SIZE)) {
      yield batch;
      batch = [];
    }
    batch.push(row);
  }
  if (batch.length > 0) yield batch;
}

function skipped(row: Row, options: ImportOptions): boolean {
  // Importing into an existing organization: the bundle's organization record
  // describes the source, not the target.
  return row.table === 'organizations' && Boolean(options.organizationId);
}

async function findConflicts(client: PoolClient, batch: Row[], options: ImportOptions): Promise<ImportConflict[]> {
  const { table, record } = batch[0];
  const key = BUNDLE_TABLES[table].key;
  const keyField = (BUNDLE_TABLES[table].columns[key] as Exclude<ColumnRule, { class: 'excluded' }>).field;
  const conflicts: ImportConflict[] = [];

  const ids = batch.map((r) => r.data[keyField]).filter((v): v is string => typeof v === 'string');
  const existing = await client.query(`SELECT ${key}::text AS id FROM ${table} WHERE ${key} = ANY($1::uuid[])`, [ids]);
  for (const { id } of existing.rows) conflicts.push({ record, kind: 'id_exists', value: id });

  if (table === 'links') {
    const codes = batch.map((r) => ({
      code: String(r.data.shortCode),
      org: options.organizationId ?? (r.data.organizationId as string | null) ?? ZERO_UUID,
    }));
    const taken = await client.query(
      `SELECT l.short_code
         FROM links l
         INNER JOIN unnest($1::text[], $2::uuid[]) AS c(code, org)
           ON l.short_code = c.code AND COALESCE(l.organization_id, '${ZERO_UUID}'::uuid) = c.org`,
      [codes.map((c) => c.code), codes.map((c) => c.org)]
    );
    for (const { short_code } of taken.rows) conflicts.push({ record, kind: 'short_code_taken', value: short_code });
  }

  if (table === 'link_templates') {
    const slugs = batch.map((r) => String(r.data.slug));
    const taken = await client.query('SELECT slug FROM link_templates WHERE slug = ANY($1::text[])', [slugs]);
    for (const { slug } of taken.rows) conflicts.push({ record, kind: 'template_slug_taken', value: slug });
  }

  return conflicts;
}

async function insertBatch(
  client: PoolClient,
  batch: Row[],
  options: ImportOptions,
  webhooks: ImportReport['webhooks']
): Promise<void> {
  const { table } = batch[0];
  const rows = batch.map((row) => toColumns(row, options));
  const columns = exportedColumns(table).map(([column]) => column);

  if (table === 'webhooks') {
    columns.push('secret');
    for (const row of rows) {
      row.secret = generateWebhookSecret();
      webhooks.push({ id: String(row.id), url: String(row.url), secret: String(row.secret) });
    }
  }

  // json_populate_recordset converts every value back to its column type
  // exactly as row_to_json rendered it on export.
  const list = columns.join(', ');
  await client.query(
    `INSERT INTO ${table} (${list}) SELECT ${list} FROM json_populate_recordset(null::${table}, $1::json)`,
    [JSON.stringify(rows)]
  );
}

/**
 * Check a bundle against the database and, unless it's a dry run or anything
 * conflicts, import it in one transaction. `openLines` is called once per pass
 * and must yield the bundle's lines from the start each time.
 */
export async function importBundle(
  pool: Pool,
  openLines: () => AsyncIterable<string>,
  options: ImportOptions = {}
): Promise<ImportReport> {
  let manifest: BundleManifest | null = null;
  const counts: Record<string, number> = {};
  const conflicts: ImportConflict[] = [];
  const webhooks: ImportReport['webhooks'] = [];

  const client = await pool.connect();
  try {
    // Pass 1: verify and check.
    for await (const batch of batches(readBundle(openLines(), (m) => (manifest = m)))) {
      const { record } = batch[0];
      counts[record] = (counts[record] ?? 0) + batch.length;
      const kept = batch.filter((row) => !skipped(row, options));
      if (kept.length === 0) continue;
      for (const conflict of await findConflicts(client, kept, options)) {
        const sameKind = conflicts.filter((c) => c.record === conflict.record && c.kind === conflict.kind).length;
        if (sameKind < CONFLICT_CAP) conflicts.push(conflict);
      }
    }

    const report = (imported: boolean): ImportReport => ({
      manifest: manifest!,
      counts,
      conflicts,
      imported,
      webhooks,
    });
    if (options.dryRun || conflicts.length > 0) return report(false);

    // Pass 2: write everything or nothing.
    await client.query('BEGIN');
    try {
      for await (const batch of batches(readBundle(openLines(), () => undefined))) {
        const kept = batch.filter((row) => !skipped(row, options));
        if (kept.length > 0) await insertBatch(client, kept, options, webhooks);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      webhooks.length = 0;
      throw error;
    }
    return report(true);
  } finally {
    client.release();
  }
}
