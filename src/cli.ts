#!/usr/bin/env node
/**
 * Entry point for the `linkforty` command (lib/portable/cli.ts).
 */

import { runCli } from './lib/portable/cli.js';

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
