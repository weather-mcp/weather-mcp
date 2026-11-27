/**
 * The server's only `.env` loader. Imported first, for its side effect, by both entries.
 *
 * Invariant: the server's configuration comes from its process environment and an explicitly
 * named file, never from the directory it was started in. An MCP client starts the server inside
 * whatever project is open, so an implicit `./.env` let that project set `HTTPS_PROXY`,
 * `NODE_TLS_REJECT_UNAUTHORIZED`, `ANALYTICS_ENDPOINT`, `BLITZORTUNG_MQTT_URL` or an API key for
 * this process. A `.env` is read only from the path in `DOTENV_CONFIG_PATH`. The explicit-path
 * rule comes from PR #131 (MagicCactus42).
 *
 * Every dotenv option is passed with a defined value. dotenv merges `DOTENV_*` / `DOTENV_CONFIG_*`
 * options from the environment first and lets only defined explicit options win, so an option left
 * out could be switched by the environment. `DOTENV_DEBUG` alone would write to stdout, which is
 * the stdio transport. Variables the client already set are never overridden.
 *
 * Imports nothing from `src/`: the logger and the config parsers read the environment at import,
 * which is before this module has populated it. So the one warning goes to stderr directly.
 */

import dotenv, { type DotenvConfigOptions, type DotenvConfigOutput } from 'dotenv';

/** The one variable that names the file. `DOTENV_PATH` (dotenv's newer alias) is not read. */
export const ENV_FILE_VARIABLE = 'DOTENV_CONFIG_PATH';

export type EnvFileOutcome =
  | { kind: 'none' }
  | { kind: 'loaded' }
  | { kind: 'unreadable'; code: string };

export type EnvFileLoader = (options: DotenvConfigOptions) => DotenvConfigOutput;

/**
 * Load the file `env.DOTENV_CONFIG_PATH` names into `env`, if one is named. Unset or empty: no
 * file is read. The value is not trimmed: whitespace is a path the user typed, and `fs` reports
 * it as unreadable.
 */
export function loadEnvFile(env: NodeJS.ProcessEnv, load: EnvFileLoader): EnvFileOutcome {
  const path = env[ENV_FILE_VARIABLE];
  if (path === undefined || path === '') {
    return { kind: 'none' };
  }
  const result = load({
    path,
    encoding: 'utf8',
    quiet: true,
    debug: false,
    override: false,
    fast: false,
    processEnv: env,
  });
  if (result.error !== undefined) {
    // Never the error's message: fs puts the path in it.
    const code: unknown = (result.error as { code?: unknown }).code;
    return { kind: 'unreadable', code: typeof code === 'string' && code !== '' ? code : 'UNKNOWN' };
  }
  return { kind: 'loaded' };
}

export const ENV_FILE_UNREADABLE_PREFIX = 'weather-mcp: the file named by DOTENV_CONFIG_PATH could not be read';

/** One stderr line: the error code only, sanitised so a code cannot forge a second line. */
export function formatUnreadable(code: string): string {
  const safe = code.replace(/[^A-Z0-9_]/g, '').slice(0, 32) || 'UNKNOWN';
  return `${ENV_FILE_UNREADABLE_PREFIX} (${safe}); continuing without it`;
}

const outcome = loadEnvFile(process.env, dotenv.config);
if (outcome.kind === 'unreadable') {
  console.error(formatUnreadable(outcome.code));
}
