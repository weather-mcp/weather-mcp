/**
 * Unit / localization configuration for weather output.
 *
 * The server defaults to imperial units (preserving historical behavior for
 * existing users). A server-wide default can be set via environment variables,
 * and individual tool calls may override it per request (see
 * `src/utils/unitPreferences.ts`).
 *
 * Environment variables:
 *   WEATHER_UNITS              imperial | metric            (default: imperial)
 *   WEATHER_TEMPERATURE_UNIT   F | C                        (override)
 *   WEATHER_WIND_SPEED_UNIT    mph | kmh | ms | kn          (override)
 *   WEATHER_PRECIPITATION_UNIT inch | mm                    (override)
 *   WEATHER_PRESSURE_UNIT      inHg | hPa                   (override)
 *   WEATHER_DISTANCE_UNIT      mi | km                      (override)
 *   WEATHER_TIME_FORMAT        12h | 24h                    (override)
 */

export type UnitSystem = 'imperial' | 'metric';
export type TemperatureUnit = 'F' | 'C';
export type WindSpeedUnit = 'mph' | 'kmh' | 'ms' | 'kn';
export type PrecipitationUnit = 'inch' | 'mm';
export type PressureUnit = 'inHg' | 'hPa';
export type DistanceUnit = 'mi' | 'km';
export type TimeFormat = '12h' | '24h';

/**
 * A fully-resolved set of unit preferences. Every weather output path formats
 * values according to one of these.
 */
export interface UnitPreferences {
  temperature: TemperatureUnit;
  windSpeed: WindSpeedUnit;
  precipitation: PrecipitationUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
  timeFormat: TimeFormat;
}

/** Imperial preset — the historical default. */
export const IMPERIAL_PREFERENCES: UnitPreferences = {
  temperature: 'F',
  windSpeed: 'mph',
  precipitation: 'inch',
  pressure: 'inHg',
  distance: 'mi',
  timeFormat: '12h',
};

/** Metric preset. */
export const METRIC_PREFERENCES: UnitPreferences = {
  temperature: 'C',
  windSpeed: 'kmh',
  precipitation: 'mm',
  pressure: 'hPa',
  distance: 'km',
  timeFormat: '24h',
};

/**
 * Return the base preset for a unit system.
 */
export function systemPreferences(system: UnitSystem): UnitPreferences {
  return system === 'metric' ? { ...METRIC_PREFERENCES } : { ...IMPERIAL_PREFERENCES };
}

/**
 * Accepted spellings for each unit, normalized to the canonical token.
 * Kept permissive so both the env layer and per-call params can share it.
 */
const NORMALIZERS = {
  system: new Map<string, UnitSystem>([
    ['imperial', 'imperial'], ['us', 'imperial'], ['metric', 'metric'], ['si', 'metric'],
  ]),
  temperature: new Map<string, TemperatureUnit>([
    ['f', 'F'], ['fahrenheit', 'F'], ['°f', 'F'],
    ['c', 'C'], ['celsius', 'C'], ['centigrade', 'C'], ['°c', 'C'],
  ]),
  windSpeed: new Map<string, WindSpeedUnit>([
    ['mph', 'mph'], ['mi/h', 'mph'],
    ['kmh', 'kmh'], ['km/h', 'kmh'], ['kph', 'kmh'],
    ['ms', 'ms'], ['m/s', 'ms'], ['mps', 'ms'],
    ['kn', 'kn'], ['kt', 'kn'], ['kts', 'kn'], ['knot', 'kn'], ['knots', 'kn'],
  ]),
  precipitation: new Map<string, PrecipitationUnit>([
    ['inch', 'inch'], ['inches', 'inch'], ['in', 'inch'],
    ['mm', 'mm'], ['millimeter', 'mm'], ['millimeters', 'mm'],
  ]),
  pressure: new Map<string, PressureUnit>([
    ['inhg', 'inHg'], ['in', 'inHg'],
    ['hpa', 'hPa'], ['mb', 'hPa'], ['mbar', 'hPa'], ['millibar', 'hPa'], ['millibars', 'hPa'],
  ]),
  distance: new Map<string, DistanceUnit>([
    ['mi', 'mi'], ['mile', 'mi'], ['miles', 'mi'],
    ['km', 'km'], ['kilometer', 'km'], ['kilometers', 'km'],
  ]),
  timeFormat: new Map<string, TimeFormat>([
    ['12h', '12h'], ['12', '12h'], ['12-hour', '12h'], ['ampm', '12h'],
    ['24h', '24h'], ['24', '24h'], ['24-hour', '24h'], ['military', '24h'],
  ]),
} as const;

/**
 * Normalize a raw string to a canonical unit token, or return undefined if the
 * value is unrecognized. Exported for reuse by the per-call resolver.
 */
export function normalizeUnit<K extends keyof typeof NORMALIZERS>(
  kind: K,
  raw: string | undefined
): (typeof NORMALIZERS)[K] extends Map<string, infer V> ? V | undefined : never {
  const map = NORMALIZERS[kind] as Map<string, unknown>;
  if (raw === undefined || raw === null) return undefined as never;
  return map.get(String(raw).trim().toLowerCase()) as never;
}

/**
 * Resolve an environment override for one unit field, warning on invalid input.
 */
function envOverride<K extends keyof typeof NORMALIZERS>(
  kind: K,
  key: string
): ((typeof NORMALIZERS)[K] extends Map<string, infer V> ? V : never) | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const normalized = normalizeUnit(kind, raw);
  if (normalized === undefined) {
    console.warn(`Invalid ${key}: "${raw}". Ignoring and using default.`);
    return undefined;
  }
  return normalized as never;
}

/**
 * Build the server-wide default preferences from the environment.
 */
function loadUnitPreferences(): UnitPreferences {
  const system = envOverride('system', 'WEATHER_UNITS') ?? 'imperial';
  const base = systemPreferences(system);

  return {
    temperature: envOverride('temperature', 'WEATHER_TEMPERATURE_UNIT') ?? base.temperature,
    windSpeed: envOverride('windSpeed', 'WEATHER_WIND_SPEED_UNIT') ?? base.windSpeed,
    precipitation: envOverride('precipitation', 'WEATHER_PRECIPITATION_UNIT') ?? base.precipitation,
    pressure: envOverride('pressure', 'WEATHER_PRESSURE_UNIT') ?? base.pressure,
    distance: envOverride('distance', 'WEATHER_DISTANCE_UNIT') ?? base.distance,
    timeFormat: envOverride('timeFormat', 'WEATHER_TIME_FORMAT') ?? base.timeFormat,
  };
}

/**
 * The server-wide default unit preferences, resolved once at startup from the
 * environment. Per-call tool parameters layer on top of this.
 */
export const defaultUnitPreferences: UnitPreferences = loadUnitPreferences();
