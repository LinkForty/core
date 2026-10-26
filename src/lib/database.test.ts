import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

describe.skipIf(!ADMIN_URL)('initialisation against a table someone is reading', () => {
  // Postgres takes a table's lock before it evaluates IF NOT EXISTS, so a
  // second start used to park an ACCESS EXCLUSIVE request on `links` behind
  // any long reader — and every redirect behind that. With the catalog guard
  // nothing is sent for a column that exists, and with a lock timeout a
  // statement that does need the table gives up instead of queueing it.
  const scratchName = `lf_core_schema_guard_${Date.now()}`;
  let admin: pg.Client;
  let scratchUrl: string;
  const pools: pg.Pool[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${scratchName}`);
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${scratchName}`;
    scratchUrl = url.toString();
    // First start: every table, column and index exists afterwards.
    await initializeDatabase({ url: scratchUrl, pool: { min: 1, max: 2 } });
    pools.push(db);
  }, 60_000);

  afterAll(async () => {
    for (const p of pools) await p.end().catch(() => undefined);
    await db?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('a second start completes while a transaction holds ACCESS SHARE on links, and the setting does not leak', async () => {
    const reader = new pg.Client({ connectionString: scratchUrl });
    await reader.connect();
    try {
      await reader.query('BEGIN');
      await reader.query('SELECT 1 FROM links LIMIT 1');

      const started = Date.now();
      await initializeDatabase({ url: scratchUrl, pool: { min: 1, max: 2 }, lockTimeoutMs: 2000 });
      pools.push(db);
      // Nothing waited: well under a single lock timeout.
      expect(Date.now() - started).toBeLessThan(10_000);

      // The reader was never blocked either.
      const t = Date.now();
      await reader.query('SELECT 1 FROM links LIMIT 1');
      expect(Date.now() - t).toBeLessThan(1_000);

      // The timeout was session-level on the initialisation client and was
      // reset before that client went back to the pool.
      const { rows } = await db.query('SHOW lock_timeout');
      expect(rows[0].lock_timeout).toBe('0');
    } finally {
      await reader.query('ROLLBACK').catch(() => undefined);
      await reader.end();
    }
  }, 60_000);

  it('a statement that does need the table fails with 55P03 after the timeout instead of queueing it', async () => {
    const reader = new pg.Client({ connectionString: scratchUrl });
    const other = new pg.Client({ connectionString: scratchUrl });
    await reader.connect();
    await other.connect();
    try {
      await reader.query('BEGIN');
      await reader.query('SELECT 1 FROM links LIMIT 1');
      await other.query('SET lock_timeout = 1000');
      const t = Date.now();
      await expect(other.query('ALTER TABLE links ADD COLUMN probe_column_not_guarded INTEGER')).rejects.toMatchObject({ code: '55P03' });
      expect(Date.now() - t).toBeLessThan(5_000);
    } finally {
      await reader.query('ROLLBACK').catch(() => undefined);
      await reader.end();
      await other.end();
    }
  }, 30_000);
});

describe.skipIf(!ADMIN_URL)('idle connection errors', () => {
  const scratchName = `lf_core_idle_error_${Date.now()}`;
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${scratchName}`);
  }, 30_000);

  afterAll(async () => {
    await db?.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  }, 30_000);

  it('keeps the process alive when the server closes an idle connection, and serves the next query', async () => {
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${scratchName}`;
    await initializeDatabase({ url: url.toString(), pool: { min: 1, max: 2 } });
    await db.query('SELECT 1');
    expect(db.idleCount).toBeGreaterThan(0);

    // No listener of the test's own: an unhandled pool error here would fail
    // the run (and exit a server).
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [scratchName]
    );
    // The pool drops each closed connection once it has reported the error.
    await vi.waitFor(() => expect(db.totalCount).toBe(0), { timeout: 10_000 });

    expect((await db.query('SELECT 1 AS ok')).rows[0].ok).toBe(1);
  }, 60_000);
});
