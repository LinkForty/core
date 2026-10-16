/**
 * The `linkforty` command: export and import LinkForty bundles.
 *
 *   linkforty export <file> [--organization <id>]
 *   linkforty import <file> [--dry-run] [--organization <id>] [--user <id>]
 *
 * Connects to DATABASE_URL. src/cli.ts is the executable entry point.
 */

import { initializeDatabase, db } from '../database.js';
import { exportBundleToFile, importBundleFile } from './files.js';
import { BundleError } from './import.js';

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

/**
 * Run the `linkforty` command with `argv` (the arguments after the command
 * name). Returns the exit code: 0 success, 1 failure or conflicts, 2 usage.
 */
export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
  logError: (line: string) => void = console.error
): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    logError(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { command, file, flags } = parsed;
  if ((command !== 'export' && command !== 'import') || !file) {
    logError(USAGE);
    return 2;
  }
  if (!env.DATABASE_URL) {
    logError('Set DATABASE_URL to the database to read from or write to.');
    return 2;
  }

  await initializeDatabase({ url: env.DATABASE_URL });
  try {
    const organizationId = typeof flags.organization === 'string' ? flags.organization : undefined;

    if (command === 'export') {
      const result = await exportBundleToFile(db, file, { organizationId });
      log(`Exported ${result.rows} rows to ${file}`);
      for (const [record, n] of Object.entries(result.counts)) log(`  ${record}: ${n}`);
      return 0;
    }

    const report = await importBundleFile(db, file, {
      dryRun: flags['dry-run'] === true,
      organizationId,
      userId: typeof flags.user === 'string' ? flags.user : undefined,
    });
    for (const [record, n] of Object.entries(report.counts)) log(`  ${record}: ${n}`);
    if (report.conflicts.length > 0) {
      log(`\n${report.conflicts.length} conflict(s); nothing was imported:`);
      for (const c of report.conflicts) log(`  ${c.record} ${c.kind}: ${c.value}`);
      return 1;
    }
    if (!report.imported) {
      log('\nDry run: no conflicts. Run without --dry-run to import.');
      return 0;
    }
    log('\nImported.');
    if (report.webhooks.length > 0) {
      log('Webhooks were issued new signing secrets. Update your receivers:');
      for (const w of report.webhooks) log(`  ${w.url}  ${w.secret}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof BundleError) {
      logError(error.message);
      return 1;
    }
    throw error;
  } finally {
    await db.end();
  }
}
