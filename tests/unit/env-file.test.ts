import { describe, it, expect, vi } from 'vitest';

// Importing the module runs its loader against process.env. With no DOTENV_CONFIG_PATH that is
// `none` and reads no file, whatever the developer's shell exports. One static import (G21).
vi.hoisted(() => {
  delete process.env.DOTENV_CONFIG_PATH;
});

import {
  loadEnvFile,
  formatUnreadable,
  ENV_FILE_VARIABLE,
  ENV_FILE_UNREADABLE_PREFIX,
  type EnvFileLoader,
} from '../../src/config/envFile.js';

function fakeLoader(result: ReturnType<EnvFileLoader>) {
  return vi.fn<EnvFileLoader>(() => result);
}

const PATH = '/srv/zqenv7731/weather.env';

describe('loadEnvFile', () => {
  it('reads DOTENV_CONFIG_PATH and nothing else', () => {
    expect(ENV_FILE_VARIABLE).toBe('DOTENV_CONFIG_PATH');
  });

  it('is none and reads no file when the variable is unset', () => {
    const load = fakeLoader({ parsed: {} });
    expect(loadEnvFile({}, load)).toEqual({ kind: 'none' });
    expect(load).not.toHaveBeenCalled();
  });

  it('is none and reads no file when the variable is empty', () => {
    const load = fakeLoader({ parsed: {} });
    expect(loadEnvFile({ DOTENV_CONFIG_PATH: '' }, load)).toEqual({ kind: 'none' });
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores the other dotenv path and option variables', () => {
    const load = fakeLoader({ parsed: {} });
    const env = { DOTENV_PATH: PATH, DOTENV_CONFIG_DEBUG: 'true' };
    expect(loadEnvFile(env, load)).toEqual({ kind: 'none' });
    expect(load).not.toHaveBeenCalled();
  });

  it('passes every option explicitly, populating the env it was given', () => {
    const load = fakeLoader({ parsed: {} });
    const env = { DOTENV_CONFIG_PATH: PATH };
    loadEnvFile(env, load);
    expect(load).toHaveBeenCalledTimes(1);
    const options = load.mock.calls[0]?.[0];
    expect(options).toEqual({
      path: PATH,
      encoding: 'utf8',
      quiet: true,
      debug: false,
      override: false,
      fast: false,
      processEnv: env,
    });
    expect(options?.processEnv).toBe(env);
  });

  it('is loaded when the file parses to nothing', () => {
    expect(loadEnvFile({ DOTENV_CONFIG_PATH: PATH }, fakeLoader({ parsed: {} }))).toEqual({ kind: 'loaded' });
  });

  it('is loaded when the file sets variables', () => {
    expect(loadEnvFile({ DOTENV_CONFIG_PATH: PATH }, fakeLoader({ parsed: { A: '1' } }))).toEqual({
      kind: 'loaded',
    });
  });

  it('is unreadable with the fs code, never the message', () => {
    const error = Object.assign(new Error(`ENOENT: no such file or directory, open '${PATH}'`), {
      code: 'ENOENT',
    });
    const outcome = loadEnvFile({ DOTENV_CONFIG_PATH: PATH }, fakeLoader({ error }));
    expect(outcome).toEqual({ kind: 'unreadable', code: 'ENOENT' });
    expect(JSON.stringify(outcome)).not.toContain('zqenv7731');
  });

  it('is unreadable with UNKNOWN when the error has no code', () => {
    const error = new Error('boom') as Error & { code: string };
    expect(loadEnvFile({ DOTENV_CONFIG_PATH: PATH }, fakeLoader({ error }))).toEqual({
      kind: 'unreadable',
      code: 'UNKNOWN',
    });
  });
});

describe('formatUnreadable', () => {
  it('names the variable and the code on one line, with no path', () => {
    const line = formatUnreadable('ENOENT');
    expect(line.startsWith(ENV_FILE_UNREADABLE_PREFIX)).toBe(true);
    expect(line).toContain('ENOENT');
    expect(line).toContain('DOTENV_CONFIG_PATH');
    expect(line).not.toContain('\n');
    expect(line).not.toContain('zqenv7731');
  });

  it('cannot be made to span two lines or carry free text', () => {
    const line = formatUnreadable('A\nB /srv/zqenv7731');
    expect(line).not.toContain('\n');
    expect(line).not.toContain('zqenv7731');
    expect(line).toContain('(AB7731)');
  });

  it('caps the code length and falls back when nothing survives', () => {
    expect(formatUnreadable('X'.repeat(100))).toContain(`(${'X'.repeat(32)})`);
    expect(formatUnreadable('\n')).toContain('(UNKNOWN)');
  });
});
