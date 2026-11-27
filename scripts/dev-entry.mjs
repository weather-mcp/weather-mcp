// Dev-only launcher for `npm run dev` / `npm run dev:http`.
//
// Why not `dotenv run`: the dotenv CLI reads inherited DOTENV_* variables itself, so an exported
// DOTENV_CONFIG_PATH naming a missing file makes it exit 1, and DOTENV_DEBUG makes it write to
// stdout, which is the stdio transport. This wrapper only points DOTENV_CONFIG_PATH at ./.env and
// then runs the entry, so dev goes through the same loader as the package (src/config/envFile.ts).
// An exported DOTENV_CONFIG_PATH deliberately wins over ./.env.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Unset or empty means "no file named", the loader's own absence rule (src/config/envFile.ts).
const configuredPath = process.env.DOTENV_CONFIG_PATH;
if ((configuredPath === undefined || configuredPath === '') && existsSync('.env')) {
  process.env.DOTENV_CONFIG_PATH = resolve('.env');
}
await import(pathToFileURL(resolve(process.argv[2])).href);
