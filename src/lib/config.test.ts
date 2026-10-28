import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigError, loadConfig, parseConfig } from './config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linkforty-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

function errorFrom(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
  it('uses the defaults when there is no file', () => {
    expect(loadConfig({ cwd: dir, env: {} })).toEqual({ config: {}, path: null });
  });

  it('reads linkforty.config.json from the working directory', () => {
    const path = write('linkforty.config.json', { notFound: { title: 'Gone' } });
    expect(loadConfig({ cwd: dir, env: {} })).toEqual({ config: { notFound: { title: 'Gone' } }, path });
  });

  it('reads the file named by LINKFORTY_CONFIG', () => {
    const path = write('custom.json', { notFound: { redirectUrl: 'https://example.com/' } });
    expect(loadConfig({ cwd: '/', env: { LINKFORTY_CONFIG: path } }).config).toEqual({
      notFound: { redirectUrl: 'https://example.com/' },
    });
  });

  it('fails when a named file is missing', () => {
    const error = errorFrom(() => loadConfig({ cwd: dir, env: { LINKFORTY_CONFIG: 'missing.json' } }));
    expect(error.message).toContain('missing.json: file not found');
  });

  it('fails on invalid JSON', () => {
    write('linkforty.config.json', '{ "notFound": { title: "x" } }');
    expect(errorFrom(() => loadConfig({ cwd: dir, env: {} })).message).toContain('not valid JSON');
  });

  it('trims values', () => {
    write('linkforty.config.json', { notFound: { title: '  Gone  ' } });
    expect(loadConfig({ cwd: dir, env: {} }).config.notFound?.title).toBe('Gone');
  });
});

describe('parseConfig', () => {
  it('accepts every notFound setting', () => {
    const notFound = {
      redirectUrl: 'https://example.com/',
      title: 'Gone',
      message: 'Try the homepage.',
      logoUrl: 'https://cdn.example.com/logo.png',
      accentColor: '#0f766e',
      backgroundColor: '#f6f7f8',
      buttonLabel: 'Home',
      buttonUrl: 'https://example.com/',
    };
    expect(parseConfig({ notFound })).toEqual({ notFound });
  });

  it.each([
    [{ notFound: { redirectUrl: 'javascript:alert(1)' } }, 'notFound.redirectUrl: must be an http(s) URL'],
    [{ notFound: { accentColor: 'teal' } }, 'notFound.accentColor: must be a hex color'],
    [{ notFound: { buttonLabel: 'Home' } }, 'buttonLabel and buttonUrl must be set together'],
    [{ notFound: { titel: 'Gone' } }, 'notFound: unknown setting "titel"'],
    [{ notfound: {} }, 'unknown setting "notfound"'],
    [{ notFound: { title: 42 } }, 'notFound.title'],
    [{ notFound: { title: 'x'.repeat(121) } }, 'notFound.title'],
  ])('names the bad setting: %j', (raw, expected) => {
    const error = errorFrom(() => parseConfig(raw, 'linkforty.config.json'));
    expect(error.message).toContain('linkforty.config.json: ');
    expect(error.message).toContain(expected);
  });

  it('rejects a file that is not an object', () => {
    expect(() => parseConfig([])).toThrow(ConfigError);
  });
});
