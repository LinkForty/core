import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCHEMA_INIT_LOCK_KEY, db, initializeDatabase } from './database.js';

/**
 * Schema initialisation must serialise across processes.
 *
 * `CREATE TABLE IF NOT EXISTS` is not atomic — the existence check and the
 * creation are separate steps — so two connections initialising an empty
 * database at once can both find a table absent and both try to create it. The
 * loser fails with a `pg_type_typname_nsp_index` unique violation. An advisory
 * lock makes the second caller wait instead.
 *
 * This needs a real database: the behaviour under test is a property of
 * Postgres locking, and a mocked client would accept any sequence of queries.
 * The suite skips itself when DATABASE_URL is absent so `npm test` stays green
 * without one.
 */

const ADMIN_URL = process.env.DATABASE_URL;

if (!ADMIN_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  database.test.ts skipped: set DATABASE_URL to run it.' +
      '\n  It creates and drops a scratch database, so the user needs CREATEDB.\n',
  );
}

describe.skipIf(!ADMIN_URL)('initializeDatabase schema lock', () => {
  // A scratch database per run: the race only exists against an EMPTY schema,
  // and initialising a shared database would also mutate whatever is in it.
  const scratchName = `lf_core_schema_init_${Date.now()}`;
  let admin: pg.Client;
  let scratchUrl: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${scratchName}`);

    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${scratchName}`;
    scratchUrl = url.toString();
  }, 30_000);

  afterAll(async () => {
    // The pool `initializeDatabase` created still holds connections, and
    // Postgres refuses to drop a database that has any.
    await db?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('waits for a concurrent initialisation rather than racing it', async () => {
    // Stand in for a second instance that got there first.
    const holder = new pg.Client({ connectionString: scratchUrl });
    await holder.connect();
    await holder.query('SELECT pg_advisory_lock($1)', [SCHEMA_INIT_LOCK_KEY]);

    let settled = false;
    const init = initializeDatabase({ url: scratchUrl, pool: { min: 1, max: 2 } }).then(() => {
      settled = true;
    });

    // Long enough that an unsynchronised initialisation would have finished
    // creating tables and resolved.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false);

    await holder.query('SELECT pg_advisory_unlock($1)', [SCHEMA_INIT_LOCK_KEY]);
    await holder.end();

    await init;
    expect(settled).toBe(true);
  }, 60_000);

  it('releases the lock once initialisation completes', async () => {
    // Runs after the case above, which left a fully initialised database. A
    // leaked lock would block every subsequent boot, so assert it is gone.
    const probe = new pg.Client({ connectionString: scratchUrl });
    await probe.connect();
    try {
      const { rows } = await probe.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        SCHEMA_INIT_LOCK_KEY,
      ]);
      expect(rows[0].acquired).toBe(true);
      await probe.query('SELECT pg_advisory_unlock($1)', [SCHEMA_INIT_LOCK_KEY]);
    } finally {
      await probe.end();
    }
  }, 30_000);
});
