/**
 * Units-aware formatting.
 *
 * Every weather output path funnels through these helpers so that a single
 * `UnitPreferences` object controls how temperature, wind, pressure,
 * precipitation, distance/visibility, and clock times are rendered.
 *
 * Two families of helpers exist:
 *   - `format*From*` take a value in a known canonical/SI source unit and
 *     convert + label it (used for the NOAA path, where values arrive in SI).
 *   - `*Label` + `withLabel` just attach the correct label to a value that is
 *     already in the target unit (used for the Open-Meteo path, where the API
 *     is asked to return values in the requested unit — no re-conversion).
 */

import { UnitPreferences } from '../config/units.js';
import { QuantitativeValue } from '../types/noaa.js';
import { DateTime } from 'luxon';
import {
  celsiusToFahrenheit,
  mpsToMph,
  metersToMiles,
  metersToFeet,
  pascalsToInHg,
  extractValue,
} from './units.js';
import { kmToMiles } from './distance.js';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function temperatureLabel(prefs: UnitPreferences): string {
  return `°${prefs.temperature}`;
}

export function windSpeedLabel(prefs: UnitPreferences): string {
  switch (prefs.windSpeed) {
    case 'kmh': return 'km/h';
    case 'ms': return 'm/s';
    case 'kn': return 'kn';
    default: return 'mph';
  }
}

export function precipitationLabel(prefs: UnitPreferences): string {
  return prefs.precipitation === 'mm' ? 'mm' : 'in';
}

export function pressureLabel(prefs: UnitPreferences): string {
  return prefs.pressure === 'hPa' ? 'hPa' : 'inHg';
}

export function distanceLabel(prefs: UnitPreferences): string {
  return prefs.distance === 'km' ? 'km' : 'mi';
}

/** The Open-Meteo request tokens matching the current preferences. */
export function openMeteoUnitParams(prefs: UnitPreferences): {
  temperature_unit: 'celsius' | 'fahrenheit';
  wind_speed_unit: 'mph' | 'kmh' | 'ms' | 'kn';
  precipitation_unit: 'inch' | 'mm';
} {
  return {
    temperature_unit: prefs.temperature === 'C' ? 'celsius' : 'fahrenheit',
    wind_speed_unit: prefs.windSpeed,
    precipitation_unit: prefs.precipitation === 'mm' ? 'mm' : 'inch',
  };
}

/** NOAA forecast endpoint units token (`us` = imperial, `si` = metric). */
export function noaaUnitsParam(prefs: UnitPreferences): 'us' | 'si' {
  return prefs.temperature === 'C' ? 'si' : 'us';
}

// ---------------------------------------------------------------------------
// Decimal-place conventions per unit
// ---------------------------------------------------------------------------

function windDecimals(prefs: UnitPreferences): number {
  // Sub-unit resolution matters most for m/s; whole numbers elsewhere read cleaner.
  return prefs.windSpeed === 'ms' ? 1 : 0;
}

function pressureDecimals(prefs: UnitPreferences): number {
  return prefs.pressure === 'hPa' ? 0 : 2;
}

function precipDecimals(prefs: UnitPreferences): number {
  return prefs.precipitation === 'mm' ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Conversions from canonical/SI source units
// ---------------------------------------------------------------------------

export function convertTemperatureFromC(celsius: number, prefs: UnitPreferences): number {
  return prefs.temperature === 'F' ? celsiusToFahrenheit(celsius) : celsius;
}

export function convertWindFromMps(mps: number, prefs: UnitPreferences): number {
  switch (prefs.windSpeed) {
    case 'kmh': return mps * 3.6;
    case 'ms': return mps;
    case 'kn': return mps * 1.943844;
    default: return mpsToMph(mps);
  }
}

export function convertPressureFromPa(pa: number, prefs: UnitPreferences): number {
  return prefs.pressure === 'hPa' ? pa / 100 : pascalsToInHg(pa);
}

export function convertPrecipFromMm(mm: number, prefs: UnitPreferences): number {
  return prefs.precipitation === 'mm' ? mm : mm * 0.0393701;
}

export function convertDistanceFromKm(km: number, prefs: UnitPreferences): number {
  return prefs.distance === 'km' ? km : kmToMiles(km);
}

// ---------------------------------------------------------------------------
// Value formatters (raw numeric source → labeled string)
// ---------------------------------------------------------------------------

/** Format a value that is ALREADY in the target unit, attaching the label. */
export function withLabel(value: number, label: string, decimals = 0): string {
  return `${value.toFixed(decimals)} ${label}`;
}

export function formatTemperatureFromC(celsius: number, prefs: UnitPreferences): string {
  return `${Math.round(convertTemperatureFromC(celsius, prefs))}${temperatureLabel(prefs)}`;
}

export function formatWindFromMps(mps: number, prefs: UnitPreferences): string {
  const value = convertWindFromMps(mps, prefs);
  return withLabel(value, windSpeedLabel(prefs), windDecimals(prefs));
}

export function formatPressureFromPa(pa: number, prefs: UnitPreferences): string {
  const value = convertPressureFromPa(pa, prefs);
  return withLabel(value, pressureLabel(prefs), pressureDecimals(prefs));
}

export function formatPrecipFromMm(mm: number, prefs: UnitPreferences): string {
  const value = convertPrecipFromMm(mm, prefs);
  return withLabel(value, precipitationLabel(prefs), precipDecimals(prefs));
}

export function formatVisibilityFromM(meters: number, prefs: UnitPreferences): string {
  const value = prefs.distance === 'km' ? meters / 1000 : metersToMiles(meters);
  return withLabel(value, prefs.distance === 'km' ? 'km' : 'miles', 1);
}

export function formatDistanceFromKm(km: number, prefs: UnitPreferences): string {
  const value = convertDistanceFromKm(km, prefs);
  return withLabel(value, distanceLabel(prefs), 1);
}

/** Elevation/height from a metres source: feet for imperial, metres for metric. */
export function formatElevationFromM(meters: number, prefs: UnitPreferences): string {
  if (prefs.distance === 'km') {
    return `${Math.round(meters)}m`;
  }
  return `${Math.round(metersToFeet(meters))}ft`;
}

/** Height from a feet source (e.g. cloud base, mixing height). */
export function formatHeightFromFt(feet: number, prefs: UnitPreferences): string {
  if (prefs.distance === 'km') {
    return `${Math.round(feet / 3.28084)}m`;
  }
  return `${Math.round(feet)}ft`;
}

// ---------------------------------------------------------------------------
// NOAA QuantitativeValue formatters (unitCode-aware SI → target)
// ---------------------------------------------------------------------------

/** Normalize a NOAA temperature QuantitativeValue to Celsius. */
function qvToCelsius(qv: QuantitativeValue | undefined): number | null {
  const value = extractValue(qv);
  if (value === null) return null;
  return qv?.unitCode?.includes('degF') ? ((value - 32) * 5) / 9 : value;
}

/** Normalize a NOAA wind QuantitativeValue to metres per second. */
function qvToMps(qv: QuantitativeValue | undefined): number | null {
  const value = extractValue(qv);
  if (value === null) return null;
  if (qv?.unitCode?.includes('km_h')) return value / 3.6;
  if (qv?.unitCode?.includes('mi_h') || qv?.unitCode?.includes('mph')) return value / 2.23694;
  // Default and explicit m_s
  return value;
}

export function formatTemperatureQV(
  qv: QuantitativeValue | undefined,
  prefs: UnitPreferences
): string {
  const celsius = qvToCelsius(qv);
  if (celsius === null) return 'N/A';
  return formatTemperatureFromC(celsius, prefs);
}

export function formatWindSpeedQV(
  qv: QuantitativeValue | undefined,
  prefs: UnitPreferences
): string {
  const mps = qvToMps(qv);
  if (mps === null) return 'Calm';
  return formatWindFromMps(mps, prefs);
}

export function formatVisibilityQV(
  qv: QuantitativeValue | undefined,
  prefs: UnitPreferences
): string {
  const meters = extractValue(qv);
  if (meters === null) return 'N/A';
  return formatVisibilityFromM(meters, prefs);
}

export function formatPressureQV(
  qv: QuantitativeValue | undefined,
  prefs: UnitPreferences
): string {
  const pa = extractValue(qv);
  if (pa === null) return 'N/A';
  return formatPressureFromPa(pa, prefs);
}

// ---------------------------------------------------------------------------
// Clock time
// ---------------------------------------------------------------------------

/**
 * Format the time-of-day portion of a Date according to the preferred clock
 * format (12h vs 24h), optionally in a specific IANA timezone.
 */
export function formatClockTime(
  date: Date,
  prefs: UnitPreferences,
  timeZone?: string
): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: prefs.timeFormat === '12h',
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * Format a Luxon DateTime's time-of-day honoring the 12h/24h preference.
 * Used for sunrise/sunset lines that are parsed with an explicit zone.
 */
export function formatLuxonTime(dt: DateTime, prefs: UnitPreferences): string {
  const hourOpt = prefs.timeFormat === '24h' ? { hour12: false } : {};
  return dt.toLocaleString({ ...DateTime.TIME_SIMPLE, ...hourOpt });
}
