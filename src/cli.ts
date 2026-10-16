#!/usr/bin/env node
/**
 * linkforty — export and import LinkForty bundles.
 *
 *   linkforty export <file> [--organization <id>]
 *   linkforty import <file> [--dry-run] [--organization <id>] [--user <id>]
 *
 * Connects to DATABASE_URL.
 */

import { initializeDatabase, db } from './lib/database.js';
import { exportBundleToFile, importBundleFile } from './lib/portable/files.js';
import { BundleError } from './lib/portable/import.js';

const USAGE = `Usage:
  linkforty export <file> [--organization <id>]
  linkforty import <file> [--dry-run] [--organization <id>] [--user <id>]

Reads DATABASE_URL. Bundles are gzipped; name them *.lfbundle.`;

function parse(argv: string[]) {
  const [command, file, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'dry-run') flags[name] = true;
    else if (rest[i + 1] && !rest[i + 1].startsWith('--')) flags[name] = rest[++i];
    else throw new Error(`--${name} needs a value`);
  }
  return { command, file, flags };
}

async function main(): Promise<number> {
  const { command, file, flags } = parse(process.argv.slice(2));
  if ((command !== 'export' && command !== 'import') || !file) {
    console.error(USAGE);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL to the database to read from or write to.');
    return 2;
  }

  await initializeDatabase({ url: process.env.DATABASE_URL });
  try {
    const organizationId = typeof flags.organization === 'string' ? flags.organization : undefined;

    if (command === 'export') {
      const result = await exportBundleToFile(db, file, { organizationId });
      console.log(`Exported ${result.rows} rows to ${file}`);
      for (const [record, n] of Object.entries(result.counts)) console.log(`  ${record}: ${n}`);
      return 0;
    }

    const report = await importBundleFile(db, file, {
      dryRun: flags['dry-run'] === true,
      organizationId,
      userId: typeof flags.user === 'string' ? flags.user : undefined,
    });
    for (const [record, n] of Object.entries(report.counts)) console.log(`  ${record}: ${n}`);
    if (report.conflicts.length > 0) {
      console.log(`\n${report.conflicts.length} conflict(s); nothing was imported:`);
      for (const c of report.conflicts) console.log(`  ${c.record} ${c.kind}: ${c.value}`);
      return 1;
    }
    if (!report.imported) {
      console.log('\nDry run: no conflicts. Run without --dry-run to import.');
      return 0;
    }
    console.log('\nImported.');
    if (report.webhooks.length > 0) {
      console.log('Webhooks were issued new signing secrets. Update your receivers:');
      for (const w of report.webhooks) console.log(`  ${w.url}  ${w.secret}`);
    }
    return 0;
  } finally {
    await db.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof BundleError ? error.message : error);
    process.exit(1);
  }
);
