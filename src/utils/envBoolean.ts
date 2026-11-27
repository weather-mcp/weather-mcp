/**
 * Shared vocabulary for boolean environment variables.
 *
 * Accepted values: `true`, `false`, `1`, `0`, trimmed, in any case.
 * Anything else, including the empty string and whitespace, is 'invalid'.
 * An unset variable (undefined) stays undefined, so the caller applies its default.
 *
 * This module returns a result and never warns. Its two callers warn through
 * different channels: `src/config/cache.ts` runs before the logger exists and
 * uses console.warn, and `src/server/lightningPrewarm.ts` uses the logger.
 *
 * Privacy fail-closed flags such as LOG_PII deliberately do not use it.
 *
 * Pure and I/O-free: callers pass the raw value; this module reads no env.
 */
export function parseEnvBoolean(raw: string | undefined): boolean | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') {
    return true;
  }
  if (v === 'false' || v === '0') {
    return false;
  }
  return 'invalid';
}
