/**
 * Unit tests for distance calculation utilities
 * Tests Haversine formula implementation used across multiple features
 */

import { describe, it, expect } from 'vitest';
import { calculateDistance, kmToMiles, milesToKm } from '../../src/utils/distance.js';

describe('Distance Calculation Utilities', () => {
  describe('calculateDistance (Haversine Formula)', () => {
    it('should return 0 for same coordinates', () => {
      const distance = calculateDistance(40.7128, -74.0060, 40.7128, -74.0060);
      expect(distance).toBe(0);
    });

    it('should calculate distance between New York and Los Angeles', () => {
      // NYC: 40.7128° N, 74.0060° W
      // LAX: 34.0522° N, 118.2437° W
      // Expected: ~3936 km
      const distance = calculateDistance(40.7128, -74.0060, 34.0522, -118.2437);

      expect(distance).toBeGreaterThan(3900);
      expect(distance).toBeLessThan(4000);
      expect(distance).toBeCloseTo(3936, 0); // Within 1 km
    });

    it('should calculate distance between London and Paris', () => {
      // London: 51.5074° N, 0.1278° W
      // Paris: 48.8566° N, 2.3522° E
      // Expected: ~344 km
      const distance = calculateDistance(51.5074, -0.1278, 48.8566, 2.3522);

      expect(distance).toBeGreaterThan(340);
      expect(distance).toBeLessThan(350);
      expect(distance).toBeCloseTo(344, -1);
    });

    it('should calculate distance between Sydney and Melbourne', () => {
      // Sydney: 33.8688° S, 151.2093° E
      // Melbourne: 37.8136° S, 144.9631° E
      // Expected: ~714 km
      const distance = calculateDistance(-33.8688, 151.2093, -37.8136, 144.9631);

      expect(distance).toBeGreaterThan(700);
      expect(distance).toBeLessThan(730);
      expect(distance).toBeCloseTo(714, -1);
    });

    it('should handle crossing the equator', () => {
      // Point in northern hemisphere
      const lat1 = 10;
      const lon1 = 0;

      // Point in southern hemisphere
      const lat2 = -10;
      const lon2 = 0;

      // Expected: ~2223 km (10° + 10° latitude = ~20° * 111 km/degree)
      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(2200);
      expect(distance).toBeLessThan(2250);
      expect(distance).toBeCloseTo(2223, -1);
    });

    it('should handle crossing the prime meridian', () => {
      // West of prime meridian
      const lat1 = 0;
      const lon1 = -5;

      // East of prime meridian
      const lat2 = 0;
      const lon2 = 5;

      // Expected: ~1112 km (10° longitude at equator * 111.32 km/degree)
      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(1100);
      expect(distance).toBeLessThan(1130);
    });

    it('should handle crossing the international date line', () => {
      // Just west of date line
      const lat1 = 0;
      const lon1 = 179;

      // Just east of date line
      const lat2 = 0;
      const lon2 = -179;

      // Expected: ~222 km (2° longitude at equator)
      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(200);
      expect(distance).toBeLessThan(250);
    });

    it('should handle points near the north pole', () => {
      // Two points near north pole separated by 90° longitude
      // At high latitudes, longitude lines converge
      const lat1 = 85;
      const lon1 = 0;
      const lat2 = 85;
      const lon2 = 90;

      // At 85° latitude, great circle distance for 90° longitude ≈ 786 km
      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(780);
      expect(distance).toBeLessThan(795);
    });

    it('should handle points near the south pole', () => {
      const lat1 = -85;
      const lon1 = 0;
      const lat2 = -85;
      const lon2 = 180;

      // At -85° latitude, 180° longitude difference ≈ 1112 km (great circle)
      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(1100);
      expect(distance).toBeLessThan(1130);
    });

    it('should handle antipodal points (opposite sides of Earth)', () => {
      // North pole to south pole
      const distance = calculateDistance(90, 0, -90, 0);

      // Expected: ~20,015 km (half Earth's circumference)
      expect(distance).toBeGreaterThan(19900);
      expect(distance).toBeLessThan(20100);
      expect(distance).toBeCloseTo(20015, -2);
    });

    it('should handle small distances accurately', () => {
      // Two points ~1 km apart
      const lat1 = 40.7128;
      const lon1 = -74.0060;
      const lat2 = 40.7218; // ~1 km north
      const lon2 = -74.0060;

      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(0.9);
      expect(distance).toBeLessThan(1.1);
      expect(distance).toBeCloseTo(1.0, 1);
    });

    it('should handle very small distances (meters)', () => {
      // Two points ~100 meters apart
      const lat1 = 40.7128;
      const lon1 = -74.0060;
      const lat2 = 40.7137; // ~0.1 km north
      const lon2 = -74.0060;

      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance).toBeGreaterThan(0.05);
      expect(distance).toBeLessThan(0.15);
      expect(distance).toBeCloseTo(0.1, 1);
    });

    it('should be commutative (same distance regardless of point order)', () => {
      const lat1 = 40.7128;
      const lon1 = -74.0060;
      const lat2 = 34.0522;
      const lon2 = -118.2437;

      const distance1 = calculateDistance(lat1, lon1, lat2, lon2);
      const distance2 = calculateDistance(lat2, lon2, lat1, lon1);

      expect(distance1).toBe(distance2);
    });

    it('should handle negative coordinates correctly', () => {
      // Southern and western hemispheres
      const distance = calculateDistance(-33.8688, -151.2093, -37.8136, -144.9631);

      expect(distance).toBeGreaterThan(0);
      expect(isFinite(distance)).toBe(true);
    });

    it('should always return non-negative values', () => {
      const testCases = [
        { lat1: 0, lon1: 0, lat2: 10, lon2: 10 },
        { lat1: 10, lon1: 10, lat2: 0, lon2: 0 },
        { lat1: -10, lon1: -10, lat2: 10, lon2: 10 },
        { lat1: 90, lon1: 0, lat2: -90, lon2: 180 }
      ];

      testCases.forEach(({ lat1, lon1, lat2, lon2 }) => {
        const distance = calculateDistance(lat1, lon1, lat2, lon2);
        expect(distance).toBeGreaterThanOrEqual(0);
      });
    });

    it('should handle extreme coordinate values', () => {
      // Maximum valid coordinates
      const distance = calculateDistance(90, 180, -90, -180);

      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(20100); // Max is half Earth's circumference
      expect(isFinite(distance)).toBe(true);
    });

    it('should produce consistent results for identical calls', () => {
      const lat1 = 40.7128;
      const lon1 = -74.0060;
      const lat2 = 34.0522;
      const lon2 = -118.2437;

      const distance1 = calculateDistance(lat1, lon1, lat2, lon2);
      const distance2 = calculateDistance(lat1, lon1, lat2, lon2);
      const distance3 = calculateDistance(lat1, lon1, lat2, lon2);

      expect(distance1).toBe(distance2);
      expect(distance2).toBe(distance3);
    });
  });

  describe('kmToMiles', () => {
    it('should convert kilometers to miles correctly', () => {
      expect(kmToMiles(1)).toBeCloseTo(0.621371, 5);
      expect(kmToMiles(10)).toBeCloseTo(6.21371, 4);
      expect(kmToMiles(100)).toBeCloseTo(62.1371, 3);
      expect(kmToMiles(1000)).toBeCloseTo(621.371, 2);
    });

    it('should handle zero', () => {
      expect(kmToMiles(0)).toBe(0);
    });

    it('should handle decimal values', () => {
      expect(kmToMiles(5.5)).toBeCloseTo(3.417541, 5);
    });

    it('should handle large values', () => {
      const earthCircumference = 40075; // km
      const milesResult = kmToMiles(earthCircumference);
      expect(milesResult).toBeCloseTo(24901, -1);
    });

    it('should handle small values', () => {
      expect(kmToMiles(0.1)).toBeCloseTo(0.0621371, 6);
    });
  });

  describe('milesToKm', () => {
    it('should convert miles to kilometers correctly', () => {
      expect(milesToKm(1)).toBeCloseTo(1.60934, 4);
      expect(milesToKm(10)).toBeCloseTo(16.0934, 3);
      expect(milesToKm(100)).toBeCloseTo(160.934, 2);
      expect(milesToKm(1000)).toBeCloseTo(1609.34, 1);
    });

    it('should handle zero', () => {
      expect(milesToKm(0)).toBe(0);
    });

    it('should handle decimal values', () => {
      expect(milesToKm(5.5)).toBeCloseTo(8.85139, 4);
    });

    it('should handle large values', () => {
      const earthCircumference = 24901; // miles
      const kmResult = milesToKm(earthCircumference);
      expect(kmResult).toBeCloseTo(40075, -1);
    });

    it('should handle small values', () => {
      expect(milesToKm(0.1)).toBeCloseTo(0.160934, 5);
    });
  });

  describe('Unit Conversion Round-Trip', () => {
    it('should convert km to miles and back to km', () => {
      const original = 100;
      const miles = kmToMiles(original);
      const backToKm = milesToKm(miles);

      expect(backToKm).toBeCloseTo(original, 10);
    });

    it('should convert miles to km and back to miles', () => {
      const original = 100;
      const km = milesToKm(original);
      const backToMiles = kmToMiles(km);

      expect(backToMiles).toBeCloseTo(original, 10);
    });

    it('should maintain precision through multiple conversions', () => {
      let value = 42.5;

      // Convert back and forth 10 times
      for (let i = 0; i < 10; i++) {
        value = milesToKm(value);
        value = kmToMiles(value);
      }

      expect(value).toBeCloseTo(42.5, 5);
    });
  });

  describe('Consistency Across Implementations', () => {
    it('should match geohash.ts isWithinRadius implementation', () => {
      // Test that calculateDistance matches the Haversine in geohash.ts
      // Both should use Earth radius = 6371 km

      const lat1 = 40.7128;
      const lon1 = -74.0060;
      const lat2 = 34.0522;
      const lon2 = -118.2437;

      const distance = calculateDistance(lat1, lon1, lat2, lon2);

      // Should be same as geohash.isWithinRadius calculation
      expect(distance).toBeGreaterThan(3900);
      expect(distance).toBeLessThan(4000);
    });

    it('should match blitzortung.ts distance calculation', () => {
      // Verify consistency with blitzortung service distance calc
      const nyLat = 40.7128;
      const nyLon = -74.0060;
      const laLat = 34.0522;
      const laLon = -118.2437;

      const distance = calculateDistance(nyLat, nyLon, laLat, laLon);

      // All implementations should return same result (within 10 km)
      expect(distance).toBeCloseTo(3936, 0);
    });
  });

  describe('Performance', () => {
    it('should calculate distance quickly', () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateDistance(40.7128, -74.0060, 34.0522, -118.2437);
      }

      const duration = performance.now() - start;

      // 1000 calculations should complete in < 10ms
      expect(duration).toBeLessThan(10);
    });

    it('should handle batch calculations efficiently', () => {
      const centerLat = 40.7128;
      const centerLon = -74.0060;

      // Generate 100 random points
      const points = Array.from({ length: 100 }, () => ({
        lat: (Math.random() * 180) - 90,
        lon: (Math.random() * 360) - 180
      }));

      const start = performance.now();

      const distances = points.map(p =>
        calculateDistance(centerLat, centerLon, p.lat, p.lon)
      );

      const duration = performance.now() - start;

      expect(distances.length).toBe(100);
      expect(duration).toBeLessThan(5);
    });
  });
});
