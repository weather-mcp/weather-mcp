/**
 * Transport-failure classifiers for the live alert smoke tests (GOTCHAS G9).
 *
 * A live smoke test may skip (log and pass) only when the upstream could not be reached or
 * answered with a server-side fault. Anything else — a 4xx, an unexpected body shape, an
 * unclassified failure, an assertion error — must be rethrown, or a real contract regression
 * reads as a network flake.
 *
 * Each classifier matches the service's own fixed, pre-written transport messages by exact
 * equality (a `Set` lookup, plus one anchored pattern for the 5xx status). It never uses
 * `includes`: the GeoMet regression text `GeoMet API returned status 404` contains
 * `returned status`, and so would a looser match on the transport text. It also never trims or
 * folds case.
 *
 * There is one function per service, not one shared union: each service's vocabulary differs,
 * and a union would accept each service's text for the other.
 *
 * The strings are copied here on purpose and this module imports nothing from `src/`.
 * `tests/unit/live-alert-transport.test.ts` is the lock: it drives the real services and pins
 * every message, so a reworded service message turns a named row red.
 */

const METEOALARM_TRANSPORT_MESSAGES: ReadonlySet<string> = new Set([
  'MeteoAlarm request timed out',
  'Unable to connect to the MeteoAlarm feed service',
  'MeteoAlarm API rate limit exceeded',
]);

const METEOALARM_SERVER_ERROR = /^MeteoAlarm API server error \(status 5\d\d\)$/;

const GEOMET_TRANSPORT_MESSAGES: ReadonlySet<string> = new Set([
  'GeoMet request timed out',
  'Unable to connect to GeoMet API',
  'GeoMet API returned status 429 (rate limit)',
]);

const GEOMET_SERVER_ERROR = /^GeoMet API returned status 5\d\d \(server error\)$/;

/** True only for an `Error` carrying one of MeteoAlarm's own fixed transport messages. */
export function isMeteoAlarmTransportFailure(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return METEOALARM_TRANSPORT_MESSAGES.has(err.message) || METEOALARM_SERVER_ERROR.test(err.message);
}

/** True only for an `Error` carrying one of GeoMet's own fixed transport messages. */
export function isGeoMetTransportFailure(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return GEOMET_TRANSPORT_MESSAGES.has(err.message) || GEOMET_SERVER_ERROR.test(err.message);
}
