import { describe, it, expect } from 'vitest';
import { OpenMeteoService } from '../../src/services/openmeteo.js';
import { NOAAService } from '../../src/services/noaa.js';

/**
 * Retry Logic Tests
 *
 * These tests verify service retry and timeout configuration.
 * The backoff ladder and jitter are pinned through the real services in
 * tests/unit/retry-backoff-ladder.test.ts; retry by error class is in
 * tests/unit/retry-by-class.test.ts.
 */

describe('Retry Logic with Jitter', () => {
  describe('Service Configuration', () => {
    it('should configure OpenMeteo service with custom maxRetries', () => {
      const service = new OpenMeteoService({ maxRetries: 5 });
      expect((service as any).maxRetries).toBe(5);
    });

    it('should configure NOAA service with custom maxRetries', () => {
      const service = new NOAAService({ maxRetries: 2 });
      expect((service as any).maxRetries).toBe(2);
    });

    it('should use default maxRetries of 3', () => {
      const openmeteo = new OpenMeteoService();
      const noaa = new NOAAService();

      expect((openmeteo as any).maxRetries).toBe(3);
      expect((noaa as any).maxRetries).toBe(3);
    });

    it('should handle maxRetries of 0', () => {
      const service = new OpenMeteoService({ maxRetries: 0 });
      expect((service as any).maxRetries).toBe(0);
    });
  });

  describe('Service Timeout Configuration', () => {
    it('should accept custom timeout for OpenMeteo', () => {
      const service = new OpenMeteoService({ timeout: 60000 });
      expect((service as any).client.defaults.timeout).toBe(60000);
    });

    it('should accept custom timeout for NOAA', () => {
      const service = new NOAAService({ timeout: 45000 });
      expect((service as any).client.defaults.timeout).toBe(45000);
    });

    it('should use default timeout of 30 seconds', () => {
      const openmeteo = new OpenMeteoService();
      const noaa = new NOAAService();

      expect((openmeteo as any).client.defaults.timeout).toBe(30000);
      expect((noaa as any).client.defaults.timeout).toBe(30000);
    });
  });
});
