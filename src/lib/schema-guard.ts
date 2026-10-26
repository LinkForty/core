import type pg from 'pg';

/**
 * Schema statements that never ask Postgres for a lock they do not need.
 *
 * Postgres acquires a table's lock *before* it evaluates `IF NOT EXISTS`. An
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for a column that has existed for a
 * year still requests ACCESS EXCLUSIVE on the table; `CREATE INDEX IF NOT
 * EXISTS` for an index that exists still requests SHARE. If anything long is
 * reading or writing the table at that moment — a retention job, a large
 * export, an analytics rebuild — the request waits, and Postgres then queues
 * every later request on the table behind the waiting one. A routine start of
 * a second instance becomes a stall of the whole table for as long as the long
 * statement runs; redirects included, since they read `links`.
 *
 * `guardSchemaClient` wraps the initialisation client and answers the
 * idempotent statement shapes from the catalog first: a column that exists, an
 * index that exists, a constraint that is already gone, a NOT NULL that is
 * already set or dropped. Those statements never reach Postgres, so they never
 * ask for a lock. Anything else — a new column, a `CREATE TABLE`, a `DO`
 * block, a parameterised query, a string holding several statements — passes
 * through untouched.
 */

/** SQLSTATE for "canceling statement due to lock timeout". */
export const LOCK_NOT_AVAILABLE = '55P03';

export interface Queryable {
  query: (text: string, params?: any[]) => Promise<pg.QueryResult<any>>;
}

export interface SchemaClient extends Queryable {
  release: () => void;
  /** Statements answered from the catalog instead of being sent to Postgres. */
  readonly skipped: string[];
}

export function isLockTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE;
}

// One statement only: a trailing semicolon is fine, a second statement is not
// ours to interpret, so it passes through.
function single(text: string): string | null {
  const t = text.trim().replace(/;\s*$/, '');
  return t.includes(';') ? null : t;
}

const ident = (raw: string) => raw.replace(/^"|"$/g, '');
/** `schema.table` → the table part; the catalog lookups scope to the search path. */
const tableOf = (raw: string) => ident(raw.split('.').pop() ?? raw);

const ALTER_TABLE = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+([\s\S]+)$/i;
const ADD_COLUMN_ACTION = /^\s*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+("?\w+"?)\b/i;
// Actions of one ALTER TABLE are split only at a comma that starts another
// ADD COLUMN IF NOT EXISTS, so commas inside a type (NUMERIC(18,4)), a default
// or a REFERENCES list stay put.
const ACTION_SEPARATOR = /,(?=\s*ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b)/i;
const CREATE_INDEX = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+("?\w+"?)\s+ON\b/i;
const DROP_CONSTRAINT = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+("?\w+"?)\s*$/i;
const SET_NOT_NULL = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+ALTER\s+COLUMN\s+("?\w+"?)\s+SET\s+NOT\s+NULL\s*$/i;
const DROP_NOT_NULL = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+ALTER\s+COLUMN\s+("?\w+"?)\s+DROP\s+NOT\s+NULL\s*$/i;

/** True when a comma remains once quoted strings and parenthesised groups are removed: a second action hides in there. */
function hasTopLevelComma(action: string): boolean {
  let s = action.replace(/'[^']*'/g, '');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/\([^()]*\)/g, '');
  }
  return s.includes(',');
}

/** The column names when every action of the ALTER is ADD COLUMN IF NOT EXISTS; null otherwise. */
function addColumnNames(t: string): { table: string; columns: string[] } | null {
  const m = t.match(ALTER_TABLE);
  if (!m) return null;
  const columns: string[] = [];
  for (const action of m[2].split(ACTION_SEPARATOR)) {
    const a = action.match(ADD_COLUMN_ACTION);
    if (!a || hasTopLevelComma(action)) return null;
    columns.push(ident(a[1]));
  }
  return columns.length > 0 ? { table: tableOf(m[1]), columns } : null;
}

async function columnNullable(client: Queryable, table: string, column: string): Promise<'YES' | 'NO' | null> {
  const r = await client.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = ANY(current_schemas(false)) AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return (r.rows[0]?.is_nullable as 'YES' | 'NO' | undefined) ?? null;
}

/**
 * Decide whether a statement's effect already exists. Returns the reason to
 * skip it, or null to send it to Postgres.
 */
export async function alreadyApplied(client: Queryable, text: string): Promise<string | null> {
  const t = single(text);
  if (!t) return null;

  const add = addColumnNames(t);
  if (add) {
    // Skip only when every column exists; Postgres handles a mix itself.
    for (const column of add.columns) {
      if ((await columnNullable(client, add.table, column)) === null) return null;
    }
    return `column${add.columns.length > 1 ? 's' : ''} ${add.table}.${add.columns.join(', ')} exist${add.columns.length > 1 ? '' : 's'}`;
  }
  let m = t.match(CREATE_INDEX);
  if (m) {
    const r = await client.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'i' AND c.relname = $1 AND n.nspname = ANY(current_schemas(false))`,
      [ident(m[1])]
    );
    return r.rows.length > 0 ? `index ${ident(m[1])} exists` : null;
  }
  m = t.match(DROP_CONSTRAINT);
  if (m) {
    const r = await client.query(
      `SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
       WHERE con.conname = $1 AND c.relname = $2`,
      [ident(m[2]), tableOf(m[1])]
    );
    return r.rows.length === 0 ? `constraint ${ident(m[2])} already absent` : null;
  }
  m = t.match(SET_NOT_NULL);
  if (m) {
    return (await columnNullable(client, tableOf(m[1]), ident(m[2]))) === 'NO' ? `${tableOf(m[1])}.${ident(m[2])} already NOT NULL` : null;
  }
  m = t.match(DROP_NOT_NULL);
  if (m) {
    return (await columnNullable(client, tableOf(m[1]), ident(m[2]))) === 'YES' ? `${tableOf(m[1])}.${ident(m[2])} already nullable` : null;
  }
  return null;
}

const SKIPPED: pg.QueryResult<any> = { rows: [], rowCount: 0, command: 'SKIP', oid: 0, fields: [] };

/**
 * A client whose idempotent schema statements are answered from the catalog
 * when their effect already exists, so they never ask Postgres for a lock.
 */
export function guardSchemaClient(client: Queryable & { release: () => void }): SchemaClient {
  const skipped: string[] = [];
  return {
    skipped,
    release: () => client.release(),
    async query(text: string, params?: any[]) {
      if (!params || params.length === 0) {
        const why = await alreadyApplied(client, text);
        if (why) {
          skipped.push(why);
          return SKIPPED;
        }
      }
      return client.query(text, params);
    },
  };
}
