/**
 * Version utility - Single source of truth for application version
 *
 * Reads version from package.json to ensure consistency across all services
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Read version from package.json once at module load time
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);

/**
 * Application version from package.json
 */
export const VERSION = packageJson.version as string;

/**
 * Get User-Agent string for HTTP requests
 * @returns User-Agent string in format "weather-mcp/VERSION"
 */
export function getUserAgent(): string {
  return `weather-mcp/${VERSION}`;
}
