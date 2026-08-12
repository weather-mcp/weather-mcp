/**
 * Default location configuration.
 *
 * WEATHER_DEFAULT_LOCATION — optional server-wide fallback location, used when
 * a location-based tool is called with no location at all. Accepts any of:
 *
 *   - A saved location alias:      WEATHER_DEFAULT_LOCATION=home
 *   - A "lat,lon" coordinate pair: WEATHER_DEFAULT_LOCATION=-43.5321,172.6362
 *   - A free-text place name:      WEATHER_DEFAULT_LOCATION=Christchurch, New Zealand
 *
 * An explicit location in the tool call always takes precedence — the default
 * only applies when latitude/longitude, location_name, and city_name are all
 * absent. See resolveLocationAsync in src/utils/locationResolver.ts.
 */

/**
 * Return the configured default location string, or undefined when unset or
 * blank. Read from the environment on each call (a hash lookup) rather than
 * cached at module load, so tests and hosts that adjust the environment
 * observe the change without re-importing the module.
 */
export function getDefaultLocation(): string | undefined {
  const raw = process.env.WEATHER_DEFAULT_LOCATION;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
