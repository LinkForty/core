import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initializeDatabase } from '../database.js';
import { BUNDLE_TABLES } from './registry.js';

/**
 * Every column Core creates is classified in registry.ts.
 *
 * Fails when a migration adds a column (or table) the registry doesn't
 * classify, or the registry names a column that no longer exists. The fix is
 * to decide, in the same change, whether a bundle carries it: add it to
 * BUNDLE_TABLES as portable, remap or excluded with a reason.
 *
 * Needs a real database; skipped without DATABASE_URL, like database.test.ts.
 */

const ADMIN_URL = process.env.DATABASE_URL;

describe.skipIf(!ADMIN_URL)('bundle registry covers the schema', () => {
  const scratchName = `lf_core_registry_${Date.now()}`;
  let admin: pg.Client;
  let columns: Map<string, string[]>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${scratchName}`);
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${scratchName}`;
    await initializeDatabase({ url: url.toString(), pool: { min: 1, max: 2 } });

    const result = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`
    );
    columns = new Map();
    for (const { table_name, column_name } of result.rows) {
      columns.set(table_name, [...(columns.get(table_name) ?? []), column_name]);
    }
  }, 60_000);

  afterAll(async () => {
    await db?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('classifies every table', () => {
    const unclassified = [...columns.keys()].filter((table) => !(table in BUNDLE_TABLES));
    expect(unclassified, 'add these tables to BUNDLE_TABLES in registry.ts').toEqual([]);
  });

  it('classifies every column of every table, and only columns that exist', () => {
    for (const [table, rule] of Object.entries(BUNDLE_TABLES)) {
      const actual = columns.get(table) ?? [];
      const classified = Object.keys(rule.columns);
      expect(
        actual.filter((c) => !classified.includes(c)),
        `classify these ${table} columns in registry.ts`
      ).toEqual([]);
      expect(
        classified.filter((c) => !actual.includes(c)),
        `these ${table} columns in registry.ts no longer exist`
      ).toEqual([]);
    }
  });

  it('gives every exported column a unique field name per table', () => {
    for (const [table, rule] of Object.entries(BUNDLE_TABLES)) {
      const fields = Object.values(rule.columns).flatMap((c) => (c.class === 'excluded' ? [] : [c.field]));
      expect(new Set(fields).size, table).toBe(fields.length);
    }
  });
});
