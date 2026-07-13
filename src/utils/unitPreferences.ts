/**
 * Resolve per-request unit preferences from tool arguments.
 *
 * Precedence (highest first):
 *   1. per-call individual overrides (temperature_unit, wind_speed_unit, ...)
 *   2. per-call system preset (units: "imperial" | "metric")
 *   3. the server-wide default (from the environment)
 */

import {
  UnitPreferences,
  systemPreferences,
  normalizeUnit,
  defaultUnitPreferences,
} from '../config/units.js';

/**
 * Unit-related arguments accepted by weather tools. All optional; when a tool
 * omits a given knob from its schema, callers simply never set it.
 */
export interface UnitArgs {
  units?: string;
  temperature_unit?: string;
  wind_speed_unit?: string;
  precipitation_unit?: string;
  pressure_unit?: string;
  distance_unit?: string;
  time_format?: string;
}

/**
 * Normalize one field or throw a helpful error listing the accepted values.
 */
function coerce<K extends Parameters<typeof normalizeUnit>[0]>(
  kind: K,
  raw: string | undefined,
  paramName: string,
  accepted: string
): ReturnType<typeof normalizeUnit<K>> | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  const normalized = normalizeUnit(kind, raw);
  if (normalized === undefined) {
    throw new Error(`Invalid ${paramName}: "${raw}". Accepted values: ${accepted}.`);
  }
  return normalized;
}

/**
 * Resolve the effective unit preferences for a single tool invocation.
 *
 * @param args - The tool arguments (may contain units/*_unit/time_format)
 * @param base - Base preferences to build on (defaults to the env-configured default)
 * @returns Fully-resolved preferences
 * @throws Error if any provided unit value is unrecognized
 */
export function resolveUnitPreferences(
  args: UnitArgs | undefined | null,
  base: UnitPreferences = defaultUnitPreferences
): UnitPreferences {
  // Start from the system preset if one is given, else the base default.
  let prefs: UnitPreferences = { ...base };

  const system = coerce('system', args?.units, 'units', 'imperial, metric');
  if (system !== undefined) {
    prefs = systemPreferences(system);
  }

  // Individual overrides win over the preset.
  const temperature = coerce('temperature', args?.temperature_unit, 'temperature_unit', 'F, C');
  if (temperature !== undefined) prefs.temperature = temperature;

  const windSpeed = coerce('windSpeed', args?.wind_speed_unit, 'wind_speed_unit', 'mph, kmh, ms, kn');
  if (windSpeed !== undefined) prefs.windSpeed = windSpeed;

  const precipitation = coerce('precipitation', args?.precipitation_unit, 'precipitation_unit', 'inch, mm');
  if (precipitation !== undefined) prefs.precipitation = precipitation;

  const pressure = coerce('pressure', args?.pressure_unit, 'pressure_unit', 'inHg, hPa');
  if (pressure !== undefined) prefs.pressure = pressure;

  const distance = coerce('distance', args?.distance_unit, 'distance_unit', 'mi, km');
  if (distance !== undefined) prefs.distance = distance;

  const timeFormat = coerce('timeFormat', args?.time_format, 'time_format', '12h, 24h');
  if (timeFormat !== undefined) prefs.timeFormat = timeFormat;

  return prefs;
}
