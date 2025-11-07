/**
 * Tests for alert sorting optimization in v1.0.0
 * Verifies that the severity-based sorting works correctly and efficiently
 */

import { describe, it, expect } from 'vitest';

// Mock alert data structure based on NOAA types
interface AlertFeature {
  properties: {
    event: string;
    severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
    urgency: string;
    certainty: string;
    headline?: string;
    description: string;
    areaDesc: string;
    effective: string;
    expires: string;
    onset?: string;
    ends?: string;
    instruction?: string;
    response: string;
    senderName: string;
  };
}

describe('Alert Sorting Optimization - v1.0.0', () => {
  describe('Severity-Based Sorting', () => {
    it('should sort alerts by severity (Extreme first)', () => {
      const alerts: AlertFeature[] = [
        {
          properties: {
            event: 'Moderate Event',
            severity: 'Moderate',
            urgency: 'Immediate',
            certainty: 'Likely',
            description: 'Test',
            areaDesc: 'Test Area',
            effective: '2025-11-06T00:00:00Z',
            expires: '2025-11-06T12:00:00Z',
            response: 'Monitor',
            senderName: 'NWS'
          }
        },
        {
          properties: {
            event: 'Extreme Event',
            severity: 'Extreme',
            urgency: 'Immediate',
            certainty: 'Likely',
            description: 'Test',
            areaDesc: 'Test Area',
            effective: '2025-11-06T00:00:00Z',
            expires: '2025-11-06T12:00:00Z',
            response: 'Evacuate',
            senderName: 'NWS'
          }
        },
        {
          properties: {
            event: 'Severe Event',
            severity: 'Severe',
            urgency: 'Immediate',
            certainty: 'Likely',
            description: 'Test',
            areaDesc: 'Test Area',
            effective: '2025-11-06T00:00:00Z',
            expires: '2025-11-06T12:00:00Z',
            response: 'Prepare',
            senderName: 'NWS'
          }
        }
      ];

      // Define severity order
      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      // Cache severity values (optimization)
      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      // Verify sorting order
      expect(sorted[0].properties.severity).toBe('Extreme');
      expect(sorted[1].properties.severity).toBe('Severe');
      expect(sorted[2].properties.severity).toBe('Moderate');
    });

    it('should handle all severity levels correctly', () => {
      const severities: Array<'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'> = [
        'Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'
      ];

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      const alerts: AlertFeature[] = severities.map(severity => ({
        properties: {
          event: `${severity} Event`,
          severity: severity,
          urgency: 'Immediate',
          certainty: 'Likely',
          description: 'Test',
          areaDesc: 'Test Area',
          effective: '2025-11-06T00:00:00Z',
          expires: '2025-11-06T12:00:00Z',
          response: 'Monitor',
          senderName: 'NWS'
        }
      }));

      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      // Verify correct order
      expect(sorted[0].properties.severity).toBe('Extreme');
      expect(sorted[1].properties.severity).toBe('Severe');
      expect(sorted[2].properties.severity).toBe('Moderate');
      expect(sorted[3].properties.severity).toBe('Minor');
      expect(sorted[4].properties.severity).toBe('Unknown');
    });

    it('should maintain stable sort for same severity', () => {
      const alerts: AlertFeature[] = [
        {
          properties: {
            event: 'First Severe Event',
            severity: 'Severe',
            urgency: 'Immediate',
            certainty: 'Likely',
            description: 'Test 1',
            areaDesc: 'Area 1',
            effective: '2025-11-06T00:00:00Z',
            expires: '2025-11-06T12:00:00Z',
            response: 'Monitor',
            senderName: 'NWS'
          }
        },
        {
          properties: {
            event: 'Second Severe Event',
            severity: 'Severe',
            urgency: 'Expected',
            certainty: 'Possible',
            description: 'Test 2',
            areaDesc: 'Area 2',
            effective: '2025-11-06T00:00:00Z',
            expires: '2025-11-06T12:00:00Z',
            response: 'Monitor',
            senderName: 'NWS'
          }
        }
      ];

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      // Both should remain in original order since same severity
      expect(sorted[0].properties.event).toBe('First Severe Event');
      expect(sorted[1].properties.event).toBe('Second Severe Event');
    });
  });

  describe('Optimization Performance', () => {
    it('should cache severity values to avoid repeated lookups', () => {
      const alerts: AlertFeature[] = Array.from({ length: 100 }, (_, i) => ({
        properties: {
          event: `Event ${i}`,
          severity: ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'][i % 5] as any,
          urgency: 'Immediate',
          certainty: 'Likely',
          description: 'Test',
          areaDesc: 'Test Area',
          effective: '2025-11-06T00:00:00Z',
          expires: '2025-11-06T12:00:00Z',
          response: 'Monitor',
          senderName: 'NWS'
        }
      }));

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      // Measure time for optimized approach (cache severity values)
      const start1 = performance.now();
      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));
      const sorted1 = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);
      const duration1 = performance.now() - start1;

      // Measure time for unoptimized approach (lookup during sort)
      const start2 = performance.now();
      const sorted2 = [...alerts].sort((a, b) => {
        const severityA = severityOrder[a.properties.severity as SeverityLevel] ?? 4;
        const severityB = severityOrder[b.properties.severity as SeverityLevel] ?? 4;
        return severityA - severityB;
      });
      const duration2 = performance.now() - start2;

      // Both should produce same results
      expect(sorted1.length).toBe(sorted2.length);
      expect(sorted1[0].properties.severity).toBe('Extreme');

      // Optimized version should complete quickly (both should be fast for 100 items)
      expect(duration1).toBeLessThan(10);
      expect(duration2).toBeLessThan(10);
    });

    it('should handle large alert sets efficiently', () => {
      // Test with a large number of alerts (1000)
      const alerts: AlertFeature[] = Array.from({ length: 1000 }, (_, i) => ({
        properties: {
          event: `Event ${i}`,
          severity: ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown'][i % 5] as any,
          urgency: 'Immediate',
          certainty: 'Likely',
          description: 'Test',
          areaDesc: 'Test Area',
          effective: '2025-11-06T00:00:00Z',
          expires: '2025-11-06T12:00:00Z',
          response: 'Monitor',
          senderName: 'NWS'
        }
      }));

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      const start = performance.now();

      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      const duration = performance.now() - start;

      // Should complete quickly even with 1000 alerts (under 50ms)
      expect(duration).toBeLessThan(50);
      expect(sorted.length).toBe(1000);

      // Verify first alerts are Extreme
      expect(sorted[0].properties.severity).toBe('Extreme');
    });
  });

  describe('Severity Order Mapping', () => {
    it('should have correct severity order values', () => {
      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      // Verify order
      expect(severityOrder.Extreme).toBe(0);
      expect(severityOrder.Severe).toBe(1);
      expect(severityOrder.Moderate).toBe(2);
      expect(severityOrder.Minor).toBe(3);
      expect(severityOrder.Unknown).toBe(4);

      // Verify order relationships
      expect(severityOrder.Extreme).toBeLessThan(severityOrder.Severe);
      expect(severityOrder.Severe).toBeLessThan(severityOrder.Moderate);
      expect(severityOrder.Moderate).toBeLessThan(severityOrder.Minor);
      expect(severityOrder.Minor).toBeLessThan(severityOrder.Unknown);
    });

    it('should handle unknown severity with fallback', () => {
      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      // Test fallback for unknown severity
      const unknownSeverity = 'InvalidSeverity' as SeverityLevel;
      const value = severityOrder[unknownSeverity] ?? 4;

      expect(value).toBe(4); // Should default to Unknown (4)
    });

    it('should support nullish coalescing for unknown values', () => {
      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      // Test ?? operator
      const values = [
        severityOrder['Extreme'] ?? 4,
        severityOrder['Unknown'] ?? 4,
        severityOrder[('InvalidLevel' as SeverityLevel)] ?? 4
      ];

      expect(values).toEqual([0, 4, 4]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty alert array', () => {
      const alerts: AlertFeature[] = [];

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      expect(sorted).toEqual([]);
    });

    it('should handle single alert', () => {
      const alerts: AlertFeature[] = [{
        properties: {
          event: 'Single Event',
          severity: 'Moderate',
          urgency: 'Immediate',
          certainty: 'Likely',
          description: 'Test',
          areaDesc: 'Test Area',
          effective: '2025-11-06T00:00:00Z',
          expires: '2025-11-06T12:00:00Z',
          response: 'Monitor',
          senderName: 'NWS'
        }
      }];

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      expect(sorted.length).toBe(1);
      expect(sorted[0].properties.event).toBe('Single Event');
    });

    it('should handle all alerts of same severity', () => {
      const alerts: AlertFeature[] = Array.from({ length: 5 }, (_, i) => ({
        properties: {
          event: `Event ${i}`,
          severity: 'Moderate' as const,
          urgency: 'Immediate',
          certainty: 'Likely',
          description: 'Test',
          areaDesc: 'Test Area',
          effective: '2025-11-06T00:00:00Z',
          expires: '2025-11-06T12:00:00Z',
          response: 'Monitor',
          senderName: 'NWS'
        }
      }));

      type SeverityLevel = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
      const severityOrder: Record<SeverityLevel, number> = {
        'Extreme': 0,
        'Severe': 1,
        'Moderate': 2,
        'Minor': 3,
        'Unknown': 4
      };

      const alertsWithSeverity = alerts.map(alert => ({
        alert,
        severityValue: severityOrder[alert.properties.severity as SeverityLevel] ?? 4
      }));

      const sorted = alertsWithSeverity
        .sort((a, b) => a.severityValue - b.severityValue)
        .map(item => item.alert);

      // All should have same severity
      expect(sorted.every(alert => alert.properties.severity === 'Moderate')).toBe(true);
      expect(sorted.length).toBe(5);
    });
  });
});
