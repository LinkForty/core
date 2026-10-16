/**
 * Bundles as files: gzipped NDJSON, conventionally named `*.lfbundle`.
 */

import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import { finished } from 'stream/promises';
import type { Pool } from 'pg';
import { exportBundle, type ExportOptions } from './bundle.js';
import { importBundle, type ImportOptions, type ImportReport } from './import.js';

/** Export to a gzipped bundle file at `path`. */
export async function exportBundleToFile(pool: Pool, path: string, options: ExportOptions = {}) {
  const gzip = zlib.createGzip();
  const file = fs.createWriteStream(path);
  gzip.pipe(file);
  try {
    const result = await exportBundle(pool, gzip, options);
    gzip.end();
    await finished(file);
    return result;
  } catch (error) {
    gzip.destroy();
    file.destroy();
    await fs.promises.rm(path, { force: true });
    throw error;
  }
}

/** The lines of a gzipped bundle file. */
export function bundleFileLines(path: string): AsyncIterable<string> {
  const input = fs.createReadStream(path).pipe(zlib.createGunzip());
  return readline.createInterface({ input, crlfDelay: Infinity });
}

/** Check, and unless it's a dry run, import a gzipped bundle file. */
export function importBundleFile(pool: Pool, path: string, options: ImportOptions = {}): Promise<ImportReport> {
  return importBundle(pool, () => bundleFileLines(path), options);
}
