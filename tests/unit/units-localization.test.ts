/**
 * Unit tests for the units / localization layer:
 * config presets + normalization, per-call resolver precedence, and the
 * units-aware formatters.
 */

import { describe, it, expect } from 'vitest';
import {
  IMPERIAL_PREFERENCES,
  METRIC_PREFERENCES,
  systemPreferences,
  normalizeUnit,
  defaultUnitPreferences,
  UnitPreferences,
} from '../../src/config/units.js';
import { resolveUnitPreferences } from '../../src/utils/unitPreferences.js';
import {
  temperatureLabel,
  windSpeedLabel,
  pressureLabel,
  precipitationLabel,
  distanceLabel,
  openMeteoUnitParams,
  noaaUnitsParam,
  formatTemperatureFromC,
  formatWindFromMps,
  formatPressureFromPa,
  formatPrecipFromMm,
  formatVisibilityFromM,
  formatDistanceFromKm,
  formatTemperatureQV,
  formatWindSpeedQV,
  formatPressureQV,
  formatVisibilityQV,
  formatClockTime,
} from '../../src/utils/unitFormat.js';

describe('units config', () => {
  it('defaults to imperial', () => {
    expect(defaultUnitPreferences.temperature).toBe('F');
    expect(defaultUnitPreferences.windSpeed).toBe('mph');
  });

  it('exposes distinct imperial and metric presets', () => {
    expect(systemPreferences('imperial')).toEqual(IMPERIAL_PREFERENCES);
    expect(systemPreferences('metric')).toEqual(METRIC_PREFERENCES);
    expect(METRIC_PREFERENCES.temperature).toBe('C');
    expect(METRIC_PREFERENCES.pressure).toBe('hPa');
  });

  it('returns fresh copies (no shared mutable state)', () => {
    const a = systemPreferences('metric');
    a.temperature = 'F';
    expect(systemPreferences('metric').temperature).toBe('C');
  });

  it('normalizes unit spellings', () => {
    expect(normalizeUnit('temperature', 'Celsius')).toBe('C');
    expect(normalizeUnit('temperature', '°F')).toBe('F');
    expect(normalizeUnit('windSpeed', 'km/h')).toBe('kmh');
    expect(normalizeUnit('windSpeed', 'knots')).toBe('kn');
    expect(normalizeUnit('pressure', 'mb')).toBe('hPa');
    expect(normalizeUnit('system', 'SI')).toBe('metric');
    expect(normalizeUnit('timeFormat', '24')).toBe('24h');
  });

  it('returns undefined for unknown values', () => {
    expect(normalizeUnit('temperature', 'kelvin')).toBeUndefined();
    expect(normalizeUnit('windSpeed', 'furlongs/fortnight')).toBeUndefined();
  });
});

describe('resolveUnitPreferences', () => {
  const base = IMPERIAL_PREFERENCES;

  it('returns the base when no args are given', () => {
    expect(resolveUnitPreferences(undefined, base)).toEqual(base);
    expect(resolveUnitPreferences({}, base)).toEqual(base);
  });

  it('applies a system preset', () => {
    expect(resolveUnitPreferences({ units: 'metric' }, base)).toEqual(METRIC_PREFERENCES);
  });

  it('lets an individual override win over the preset', () => {
    const prefs = resolveUnitPreferences({ units: 'imperial', temperature_unit: 'C' }, base);
    expect(prefs.temperature).toBe('C');
    expect(prefs.windSpeed).toBe('mph'); // untouched by the override
  });

  it('supports per-unit overrides on top of the env base (knots, hPa)', () => {
    const prefs = resolveUnitPreferences({ wind_speed_unit: 'kn', pressure_unit: 'hPa' }, base);
    expect(prefs.windSpeed).toBe('kn');
    expect(prefs.pressure).toBe('hPa');
    expect(prefs.temperature).toBe('F'); // still imperial base
  });

  it('applies time_format independently', () => {
    expect(resolveUnitPreferences({ time_format: '24h' }, base).timeFormat).toBe('24h');
  });

  it('throws a helpful error on an invalid value', () => {
    expect(() => resolveUnitPreferences({ units: 'freedom' }, base)).toThrow(/Invalid units/);
    expect(() => resolveUnitPreferences({ temperature_unit: 'kelvin' }, base)).toThrow(/temperature_unit/);
  });
});

describe('unit labels and API params', () => {
  it('produces correct labels per system', () => {
    expect(temperatureLabel(METRIC_PREFERENCES)).toBe('°C');
    expect(temperatureLabel(IMPERIAL_PREFERENCES)).toBe('°F');
    expect(windSpeedLabel(METRIC_PREFERENCES)).toBe('km/h');
    expect(windSpeedLabel({ ...IMPERIAL_PREFERENCES, windSpeed: 'kn' })).toBe('kn');
    expect(pressureLabel(METRIC_PREFERENCES)).toBe('hPa');
    expect(precipitationLabel(METRIC_PREFERENCES)).toBe('mm');
    expect(distanceLabel(METRIC_PREFERENCES)).toBe('km');
  });

  it('maps preferences to Open-Meteo request tokens', () => {
    expect(openMeteoUnitParams(IMPERIAL_PREFERENCES)).toEqual({
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
    });
    expect(openMeteoUnitParams(METRIC_PREFERENCES)).toEqual({
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm',
    });
  });

  it('maps preferences to NOAA units token', () => {
    expect(noaaUnitsParam(IMPERIAL_PREFERENCES)).toBe('us');
    expect(noaaUnitsParam(METRIC_PREFERENCES)).toBe('si');
  });
});

describe('formatters from SI/canonical', () => {
  it('formats temperature', () => {
    expect(formatTemperatureFromC(0, IMPERIAL_PREFERENCES)).toBe('32°F');
    expect(formatTemperatureFromC(0, METRIC_PREFERENCES)).toBe('0°C');
    expect(formatTemperatureFromC(100, METRIC_PREFERENCES)).toBe('100°C');
  });

  it('formats wind across all four units', () => {
    expect(formatWindFromMps(10, IMPERIAL_PREFERENCES)).toBe('22 mph');
    expect(formatWindFromMps(10, METRIC_PREFERENCES)).toBe('36 km/h');
    expect(formatWindFromMps(10, { ...METRIC_PREFERENCES, windSpeed: 'ms' })).toBe('10.0 m/s');
    expect(formatWindFromMps(10, { ...IMPERIAL_PREFERENCES, windSpeed: 'kn' })).toBe('19 kn');
  });

  it('formats pressure', () => {
    expect(formatPressureFromPa(101325, IMPERIAL_PREFERENCES)).toBe('29.92 inHg');
    expect(formatPressureFromPa(101325, METRIC_PREFERENCES)).toBe('1013 hPa');
  });

  it('formats precipitation', () => {
    expect(formatPrecipFromMm(25.4, IMPERIAL_PREFERENCES)).toBe('1.00 in');
    expect(formatPrecipFromMm(25.4, METRIC_PREFERENCES)).toBe('25.4 mm');
  });

  it('formats visibility and distance', () => {
    expect(formatVisibilityFromM(1609.34, IMPERIAL_PREFERENCES)).toBe('1.0 miles');
    expect(formatVisibilityFromM(1000, METRIC_PREFERENCES)).toBe('1.0 km');
    expect(formatDistanceFromKm(1, IMPERIAL_PREFERENCES)).toBe('0.6 mi');
    expect(formatDistanceFromKm(1, METRIC_PREFERENCES)).toBe('1.0 km');
  });
});

describe('NOAA QuantitativeValue formatters', () => {
  it('converts degC observations to the target unit', () => {
    const qv = { value: 20, unitCode: 'wmoUnit:degC' };
    expect(formatTemperatureQV(qv, IMPERIAL_PREFERENCES)).toBe('68°F');
    expect(formatTemperatureQV(qv, METRIC_PREFERENCES)).toBe('20°C');
  });

  it('handles null and returns sensible placeholders', () => {
    expect(formatTemperatureQV({ value: null, unitCode: 'wmoUnit:degC' }, METRIC_PREFERENCES)).toBe('N/A');
    expect(formatWindSpeedQV({ value: null, unitCode: 'wmoUnit:km_h-1' }, METRIC_PREFERENCES)).toBe('Calm');
    expect(formatPressureQV(undefined, IMPERIAL_PREFERENCES)).toBe('N/A');
    expect(formatVisibilityQV(undefined, METRIC_PREFERENCES)).toBe('N/A');
  });

  it('converts wind observations from m/s and km/h sources', () => {
    expect(formatWindSpeedQV({ value: 10, unitCode: 'wmoUnit:m_s-1' }, IMPERIAL_PREFERENCES)).toBe('22 mph');
    expect(formatWindSpeedQV({ value: 36, unitCode: 'wmoUnit:km_h-1' }, METRIC_PREFERENCES)).toBe('36 km/h');
  });

  it('converts pressure observations from pascals', () => {
    expect(formatPressureQV({ value: 101325, unitCode: 'wmoUnit:Pa' }, METRIC_PREFERENCES)).toBe('1013 hPa');
  });
});

describe('clock time formatting', () => {
  // A fixed UTC instant: 14:05 UTC.
  const d = new Date('2026-07-13T14:05:00Z');

  it('respects 12h vs 24h in UTC', () => {
    const prefs12: UnitPreferences = { ...IMPERIAL_PREFERENCES, timeFormat: '12h' };
    const prefs24: UnitPreferences = { ...METRIC_PREFERENCES, timeFormat: '24h' };
    expect(formatClockTime(d, prefs12, 'UTC')).toBe('2:05 PM');
    expect(formatClockTime(d, prefs24, 'UTC')).toBe('14:05');
  });
});
