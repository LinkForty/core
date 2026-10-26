import { describe, it, expect, vi } from 'vitest';
import { LOCK_NOT_AVAILABLE, alreadyApplied, guardSchemaClient, isLockTimeout } from './schema-guard.js';

function fakeClient(catalog: { columns?: Array<[string, string, 'YES' | 'NO']>; indexes?: string[]; constraints?: Array<[string, string]> }) {
  const query = vi.fn(async (text: string, params?: any[]) => {
    if (text.includes('information_schema.columns')) {
      const hit = (catalog.columns ?? []).find(([t, c]) => t === params![0] && c === params![1]);
      return { rows: hit ? [{ is_nullable: hit[2] }] : [], rowCount: hit ? 1 : 0 } as any;
    }
    if (text.includes('pg_class c JOIN pg_namespace')) {
      return { rows: (catalog.indexes ?? []).includes(params![0]) ? [{}] : [], rowCount: 0 } as any;
    }
    if (text.includes('pg_constraint')) {
      const hit = (catalog.constraints ?? []).some(([n, t]) => n === params![0] && t === params![1]);
      return { rows: hit ? [{}] : [], rowCount: 0 } as any;
    }
    return { rows: [], rowCount: 0, command: 'SENT' } as any;
  });
  return { query, release: vi.fn() };
}

describe('alreadyApplied', () => {
  it('answers an existing column, index, absent constraint and settled NOT NULL from the catalog', async () => {
    const c = fakeClient({
      columns: [['links', 'append_click_id', 'YES'], ['links', 'warn_at', 'YES'], ['users', 'password_hash', 'YES']],
      indexes: ['idx_clicks_link_id'],
      constraints: [['present_key', 'events']],
    });
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN IF NOT EXISTS append_click_id BOOLEAN DEFAULT false')).toMatch(/exists/);
    expect(await alreadyApplied(c, '  ALTER TABLE "links" ADD COLUMN IF NOT EXISTS "append_click_id" BOOLEAN;\n')).toMatch(/exists/);
    expect(await alreadyApplied(c, 'ALTER TABLE public.links ADD COLUMN IF NOT EXISTS warn_at TIMESTAMPTZ')).toMatch(/exists/);
    expect(await alreadyApplied(c, 'ALTER TABLE links\n  ADD COLUMN IF NOT EXISTS append_click_id BOOLEAN,\n  ADD COLUMN IF NOT EXISTS warn_at TIMESTAMPTZ')).toBe('columns links.append_click_id, warn_at exist');
    expect(await alreadyApplied(c, 'CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON click_events(link_id)')).toMatch(/exists/);
    expect(await alreadyApplied(c, 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_clicks_link_id ON click_events(link_id)')).toMatch(/exists/);
    expect(await alreadyApplied(c, 'ALTER TABLE events DROP CONSTRAINT IF EXISTS gone_key')).toMatch(/absent/);
    expect(await alreadyApplied(c, 'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL')).toMatch(/already nullable/);
  });

  it('sends statements whose effect is missing, and anything it does not understand', async () => {
    const c = fakeClient({ columns: [['users', 'password_hash', 'NO'], ['links', 'warn_at', 'YES']], constraints: [['present_key', 'events']] });
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN IF NOT EXISTS brand_new TEXT')).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN IF NOT EXISTS warn_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS brand_new INTEGER NOT NULL DEFAULT 0')).toBeNull();
    expect(await alreadyApplied(c, 'CREATE INDEX IF NOT EXISTS idx_missing ON links(id)')).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE events DROP CONSTRAINT IF EXISTS present_key')).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL')).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL')).toMatch(/already NOT NULL/);
    // A comma inside a type or default does not split the action.
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN IF NOT EXISTS warn_at NUMERIC(18,4) DEFAULT 0')).toMatch(/exist/);
    // Shapes that are not idempotent are never guessed at.
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN brand_new TEXT')).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN IF NOT EXISTS warn_at TIMESTAMPTZ, ALTER COLUMN warn_at SET DEFAULT NULL')).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE links ALTER COLUMN x SET DEFAULT 1')).toBeNull();
    expect(await alreadyApplied(c, 'CREATE TABLE IF NOT EXISTS t (id int)')).toBeNull();
    expect(await alreadyApplied(c, "DO $$ BEGIN ALTER TABLE links ADD COLUMN IF NOT EXISTS warn_at TEXT; END $$")).toBeNull();
    expect(await alreadyApplied(c, 'ALTER TABLE links ADD COLUMN IF NOT EXISTS a TEXT; ALTER TABLE links ADD COLUMN IF NOT EXISTS b TEXT')).toBeNull();
  });
});

describe('guardSchemaClient', () => {
  it('skips what exists, passes the rest through, records why, and releases the real client', async () => {
    const raw = fakeClient({ columns: [['links', 'warn_at', 'YES']] });
    const client = guardSchemaClient(raw);
    expect((await client.query('ALTER TABLE links ADD COLUMN IF NOT EXISTS warn_at TIMESTAMPTZ')).command).toBe('SKIP');
    expect((await client.query('ALTER TABLE links ADD COLUMN IF NOT EXISTS brand_new TEXT')).command).toBe('SENT');
    await client.query('SELECT pg_advisory_lock($1)', [1]);
    expect(client.skipped).toEqual(['column links.warn_at exists']);
    expect(raw.query.mock.calls.map((c) => String(c[0]).slice(0, 30))).toEqual([
      'SELECT is_nullable FROM inform',
      'SELECT is_nullable FROM inform',
      'ALTER TABLE links ADD COLUMN I',
      'SELECT pg_advisory_lock($1)',
    ]);
    client.release();
    expect(raw.release).toHaveBeenCalledTimes(1);
  });

  it('never inspects parameterised statements', async () => {
    const raw = fakeClient({ columns: [['links', 'x', 'YES']] });
    await guardSchemaClient(raw).query('ALTER TABLE links ADD COLUMN IF NOT EXISTS x TEXT', [1]);
    expect(raw.query).toHaveBeenCalledTimes(1);
  });

  it('recognises a lock timeout by SQLSTATE', () => {
    expect(isLockTimeout(Object.assign(new Error('x'), { code: LOCK_NOT_AVAILABLE }))).toBe(true);
    expect(isLockTimeout(new Error('x'))).toBe(false);
    expect(isLockTimeout(null)).toBe(false);
  });
});
