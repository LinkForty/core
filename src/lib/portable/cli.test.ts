import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './cli.js';

/**
 * The `linkforty` command: arguments, exit codes and what it prints. The
 * export and import runs need a real database and skip without DATABASE_URL.
 */

function capture() {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, log: (l: string) => lines.push(l), logError: (l: string) => errors.push(l) };
}

describe('linkforty usage', () => {
  it('prints usage and exits 2 for an unknown command or a missing file', async () => {
    for (const argv of [[], ['backup'], ['export']]) {
      const out = capture();
      expect(await runCli(argv, {}, out.log, out.logError)).toBe(2);
      expect(out.errors.join('\n')).toContain('Usage:');
    }
  });

  it('exits 2 for a malformed flag', async () => {
    const out = capture();
    expect(await runCli(['import', 'x.lfbundle', '--organization'], {}, out.log, out.logError)).toBe(2);
    expect(out.errors[0]).toContain('--organization needs a value');
  });

  it('exits 2 without DATABASE_URL', async () => {
    const out = capture();
    expect(await runCli(['export', 'x.lfbundle'], {}, out.log, out.logError)).toBe(2);
    expect(out.errors[0]).toContain('DATABASE_URL');
  });
});

const ADMIN_URL = process.env.DATABASE_URL;

describe.skipIf(!ADMIN_URL)('linkforty export and import (integration)', () => {
  const stamp = Date.now();
  const names = { source: `lf_core_cli_src_${stamp}`, target: `lf_core_cli_dst_${stamp}` };
  let admin: pg.Client;
  let dir: string;
  let file: string;

  const urlFor = (name: string) => {
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const run = async (argv: string[], database: keyof typeof names) => {
    const out = capture();
    const code = await runCli(argv, { DATABASE_URL: urlFor(names[database]) }, out.log, out.logError);
    return { code, text: out.lines.join('\n'), errors: out.errors.join('\n') };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    for (const name of Object.values(names)) await admin.query(`CREATE DATABASE ${name}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-cli-'));
    file = path.join(dir, 'server.lfbundle');

    // An export creates the schema; then seed one link and one webhook.
    await run(['export', path.join(dir, 'empty.lfbundle')], 'source');
    const source = new pg.Client({ connectionString: urlFor(names.source) });
    await source.connect();
    await source.query(`INSERT INTO links (short_code, original_url) VALUES ('hello', 'https://example.com')`);
    await source.query(`INSERT INTO webhooks (name, url, secret, events) VALUES ('w', 'https://hooks.example', 's', '{click_event}')`);
    await source.end();
  }, 60_000);

  afterAll(async () => {
    for (const name of Object.values(names)) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);

  it('exports, dry-runs, imports and then reports conflicts', async () => {
    const exported = await run(['export', file], 'source');
    expect(exported.code).toBe(0);
    expect(exported.text).toContain('Exported 2 rows');

    const dry = await run(['import', file, '--dry-run'], 'target');
    expect(dry).toMatchObject({ code: 0 });
    expect(dry.text).toContain('Dry run: no conflicts');

    const imported = await run(['import', file], 'target');
    expect(imported.code).toBe(0);
    expect(imported.text).toContain('Imported.');
    expect(imported.text).toMatch(/https:\/\/hooks\.example {2}[0-9a-f]{64}/);

    const again = await run(['import', file], 'target');
    expect(again.code).toBe(1);
    expect(again.text).toContain('conflict(s); nothing was imported');
    expect(again.text).toContain('short_code_taken: hello');
  }, 60_000);

  it('exits 1 with the reason for a file that is not a bundle', async () => {
    const bogus = path.join(dir, 'bogus.lfbundle');
    fs.writeFileSync(bogus, zlib.gzipSync('{"hello":"world"}\n'));
    const result = await run(['import', bogus], 'target');
    expect(result.code).toBe(1);
    expect(result.errors).toContain('Not a LinkForty bundle');
  }, 60_000);
});
