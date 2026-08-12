/**
 * Unit tests for the coarse US longitude fallback in guessTimezoneFromCoords.
 *
 * In normal operation tz-lookup resolves coordinates accurately and the
 * fallback never runs (see timezone.test.ts for that path). Here tz-lookup is
 * mocked to throw so the fallback bands themselves are exercised. Band tuning
 * adapted from the dapcook/weather-mcp fork's timezone fix.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('tz-lookup', () => ({
  default: () => {
    throw new Error('tz-lookup unavailable (mocked)');
  },
}));

import { guessTimezoneFromCoords } from '../../src/utils/timezone.js';

describe('guessTimezoneFromCoords fallback bands (tz-lookup failing)', () => {
  it('places Eastern-time cities in America/New_York', () => {
    expect(guessTimezoneFromCoords(40.7128, -74.006)).toBe('America/New_York'); // New York, NY
    expect(guessTimezoneFromCoords(33.749, -84.388)).toBe('America/New_York'); // Atlanta, GA
    expect(guessTimezoneFromCoords(40.4406, -79.9959)).toBe('America/New_York'); // Pittsburgh, PA
  });

  it('places the wide Central-time landmass in America/Chicago', () => {
    // Central time reaches from the Great Lakes out to roughly the
    // Kansas/Colorado border — these are all genuinely Central despite
    // longitudes well past -100.
    expect(guessTimezoneFromCoords(41.8781, -87.6298)).toBe('America/Chicago'); // Chicago, IL
    expect(guessTimezoneFromCoords(39.0997, -94.5786)).toBe('America/Chicago'); // Kansas City, MO
    expect(guessTimezoneFromCoords(41.2565, -95.9345)).toBe('America/Chicago'); // Omaha, NE
    expect(guessTimezoneFromCoords(35.4676, -97.5164)).toBe('America/Chicago'); // Oklahoma City, OK
    expect(guessTimezoneFromCoords(32.7767, -96.797)).toBe('America/Chicago'); // Dallas, TX
  });

  it('places Mountain-time cities in America/Denver', () => {
    expect(guessTimezoneFromCoords(39.7392, -104.9903)).toBe('America/Denver'); // Denver, CO
    expect(guessTimezoneFromCoords(40.7608, -111.891)).toBe('America/Denver'); // Salt Lake City, UT
  });

  it('places Pacific-time cities in America/Los_Angeles', () => {
    expect(guessTimezoneFromCoords(34.0522, -118.2437)).toBe('America/Los_Angeles'); // Los Angeles, CA
    expect(guessTimezoneFromCoords(47.6062, -122.3321)).toBe('America/Los_Angeles'); // Seattle, WA
  });

  it('splits bands at -85 / -101 / -115', () => {
    expect(guessTimezoneFromCoords(40.0, -84.9)).toBe('America/New_York');
    expect(guessTimezoneFromCoords(40.0, -85.1)).toBe('America/Chicago');
    expect(guessTimezoneFromCoords(40.0, -100.9)).toBe('America/Chicago');
    expect(guessTimezoneFromCoords(40.0, -101.1)).toBe('America/Denver');
    expect(guessTimezoneFromCoords(40.0, -114.9)).toBe('America/Denver');
    expect(guessTimezoneFromCoords(40.0, -115.1)).toBe('America/Los_Angeles');
  });

  it('returns UTC outside the continental US bands', () => {
    expect(guessTimezoneFromCoords(51.5074, -0.1278)).toBe('UTC'); // London
    expect(guessTimezoneFromCoords(-33.8688, 151.2093)).toBe('UTC'); // Sydney
    expect(guessTimezoneFromCoords(64.2008, -149.4937)).toBe('UTC'); // Alaska (outside lat band)
  });
});
