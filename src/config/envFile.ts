/**
 * Opt-in `.env` loading for the two entries. Imported first, for its side effect.
 *
 * A `.env` is read only from the path `DOTENV_CONFIG_PATH` names. The working directory is never
 * searched: an MCP client starts the server in whatever project is open, so an implicit `./.env`
 * lets that project set `HTTPS_PROXY`, `NODE_TLS_REJECT_UNAUTHORIZED` or `BLITZORTUNG_MQTT_URL`
 * for this process. Variables already set are never overridden (dotenv's default).
 */

import dotenv from 'dotenv';

const envFilePath = process.env.DOTENV_CONFIG_PATH;
if (envFilePath) {
  // quiet: dotenv's own notice would name the path on stderr.
  dotenv.config({ path: envFilePath, quiet: true });
}
