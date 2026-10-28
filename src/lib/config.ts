/**
 * The instance's configuration file, `linkforty.config.json`.
 *
 * Configuration is split the way most self-hosted platforms split it:
 *
 *   - environment variables hold infrastructure and secrets: where the
 *     database is, which port to listen on, and the path to this file;
 *   - this file holds the instance's defaults and behavior, including text a
 *     visitor reads;
 *   - `organizations.settings` holds per-organization values, which take
 *     precedence over this file where both apply.
 *
 * The file is optional: without one every built-in default applies. A file that
 * exists but is wrong stops the server at startup with a message naming the bad
 * key. The operator wrote it on purpose, so a mistake should show immediately
 * rather than as a page that quietly ignores them.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';
import type { NotFoundSettings } from './not-found-page.js';

/** File looked for in the working directory when LINKFORTY_CONFIG is unset. */
export const DEFAULT_CONFIG_FILE = 'linkforty.config.json';

export interface LinkFortyConfig {
  /** What a browser sees when a link can't be served (lib/not-found-page.ts). */
  notFound?: NotFoundSettings;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'ConfigError';
  }
}

const httpUrl = z
  .string()
  .trim()
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'must be a hex color such as #0f766e');

const notFoundSchema = z
  .object({
    redirectUrl: httpUrl.optional(),
    title: z.string().trim().min(1).max(120).optional(),
    message: z.string().trim().min(1).max(500).optional(),
    logoUrl: httpUrl.optional(),
    accentColor: hexColor.optional(),
    backgroundColor: hexColor.optional(),
    buttonLabel: z.string().trim().min(1).max(60).optional(),
    buttonUrl: httpUrl.optional(),
  })
  .strict()
  .refine((value) => !value.buttonLabel === !value.buttonUrl, {
    message: 'buttonLabel and buttonUrl must be set together',
  });

const configSchema = z
  .object({
    notFound: notFoundSchema.optional(),
  })
  .strict();

function describeIssue(issue: z.ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${where}unknown setting ${issue.keys.map((k) => `"${k}"`).join(', ')}`;
  }
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/** Validate an already-parsed configuration object. `path` names it in errors. */
export function parseConfig(raw: unknown, path = DEFAULT_CONFIG_FILE): LinkFortyConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map(describeIssue).join('; '), path);
  }
  return result.data;
}

/**
 * Load the configuration file.
 *
 * Reads the file named by `options.path`, else by LINKFORTY_CONFIG, else
 * `linkforty.config.json` in the working directory. A file named explicitly
 * must exist; the default one is optional. Returns the file's path, or null
 * when none was read.
 *
 * @throws ConfigError when the file can't be read, isn't JSON, or has an
 *   invalid or unknown setting.
 */
export function loadConfig(
  options: { path?: string; env?: Record<string, string | undefined>; cwd?: string } = {}
): { config: LinkFortyConfig; path: string | null } {
  const env = options.env ?? process.env;
  const named = options.path || env.LINKFORTY_CONFIG || '';
  const path = resolve(options.cwd ?? process.cwd(), named || DEFAULT_CONFIG_FILE);

  if (!existsSync(path)) {
    if (named) throw new ConfigError('file not found', path);
    return { config: {}, path: null };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? `not valid JSON (${error.message})` : 'could not be read';
    throw new ConfigError(reason, path);
  }
  return { config: parseConfig(raw, path), path };
}
