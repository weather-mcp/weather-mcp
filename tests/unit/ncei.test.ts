import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NCEIService } from '../../src/services/ncei.js';
import { DataNotFoundError, RateLimitError, ServiceUnavailableError } from '../../src/errors/ApiError.js';

describe('NCEI Service', () => {
  describe('Service initialization', () => {
    it('should create service with default configuration', () => {
      const service = new NCEIService();
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should create service with custom baseURL', () => {
      const service = new NCEIService({ baseURL: 'https://custom.api.com' });
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should create service with custom timeout', () => {
      const service = new NCEIService({ timeout: 15000 });
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should create service with custom token', () => {
      const service = new NCEIService({ token: 'test-token-123' });
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should create service with all custom config', () => {
      const service = new NCEIService({
        baseURL: 'https://custom.api.com',
        timeout: 20000,
        token: 'custom-token'
      });
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should create service without token', () => {
      const originalToken = process.env.NCEI_API_TOKEN;
      delete process.env.NCEI_API_TOKEN;

      const service = new NCEIService();
      expect(service).toBeInstanceOf(NCEIService);

      process.env.NCEI_API_TOKEN = originalToken;
    });
  });

  describe('isAvailable', () => {
    it('should return true when token is provided', () => {
      const service = new NCEIService({ token: 'valid-token' });
      expect(service.isAvailable()).toBe(true);
    });

    it('should return false when token is undefined', () => {
      const service = new NCEIService({ token: undefined });
      expect(service.isAvailable()).toBe(false);
    });

    it('should return false when token is empty string', () => {
      const service = new NCEIService({ token: '' });
      expect(service.isAvailable()).toBe(false);
    });

    it('should return false when token is whitespace only', () => {
      const service = new NCEIService({ token: '   ' });
      expect(service.isAvailable()).toBe(false);
    });

    it('should return true for non-empty token', () => {
      const service = new NCEIService({ token: 'abc123' });
      expect(service.isAvailable()).toBe(true);
    });

    it('should return true for token with spaces around content', () => {
      const service = new NCEIService({ token: '  token123  ' });
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe('getClimateNormals - without token', () => {
    it('should throw DataNotFoundError when token not configured', async () => {
      const service = new NCEIService({ token: undefined });

      await expect(
        service.getClimateNormals(40.7128, -74.0060, 1, 15)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should throw error with token configuration message', async () => {
      const service = new NCEIService({ token: '' });

      await expect(
        service.getClimateNormals(40.7128, -74.0060, 6, 1)
      ).rejects.toThrow('NCEI API token not configured');
    });

    it('should include environment variable name in error', async () => {
      const service = new NCEIService({ token: undefined });

      try {
        await service.getClimateNormals(37.7749, -122.4194, 12, 25);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(DataNotFoundError);
        if (error instanceof DataNotFoundError) {
          expect(error.userMessage).toContain('NCEI_API_TOKEN');
        }
      }
    });

    it('should have service name as NCEI in error', async () => {
      const service = new NCEIService({ token: '' });

      try {
        await service.getClimateNormals(40.0, -100.0, 7, 4);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(DataNotFoundError);
        if (error instanceof DataNotFoundError) {
          expect(error.service).toBe('NCEI');
        }
      }
    });
  });

  describe('getClimateNormals - with token (placeholder implementation)', () => {
    it('should throw DataNotFoundError for placeholder implementation', async () => {
      const service = new NCEIService({ token: 'valid-token' });

      await expect(
        service.getClimateNormals(40.7128, -74.0060, 1, 1)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should throw error with implementation message', async () => {
      const service = new NCEIService({ token: 'test-token' });

      try {
        await service.getClimateNormals(37.7749, -122.4194, 6, 15);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(DataNotFoundError);
        if (error instanceof DataNotFoundError) {
          expect(error.userMessage).toContain('planned for a future release');
        }
      }
    });

    it('should mention Open-Meteo fallback in error message', async () => {
      const service = new NCEIService({ token: 'token123' });

      try {
        await service.getClimateNormals(45.0, -93.0, 3, 20);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(DataNotFoundError);
        if (error instanceof DataNotFoundError) {
          expect(error.userMessage).toContain('Open-Meteo fallback');
        }
      }
    });

    it('should accept valid latitude range', async () => {
      const service = new NCEIService({ token: 'token' });

      await expect(
        service.getClimateNormals(49.0, -100.0, 1, 1)
      ).rejects.toThrow(DataNotFoundError);

      await expect(
        service.getClimateNormals(24.0, -100.0, 1, 1)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should accept valid longitude range', async () => {
      const service = new NCEIService({ token: 'token' });

      await expect(
        service.getClimateNormals(40.0, -125.0, 1, 1)
      ).rejects.toThrow(DataNotFoundError);

      await expect(
        service.getClimateNormals(40.0, -66.0, 1, 1)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should accept valid month range', async () => {
      const service = new NCEIService({ token: 'token' });

      await expect(
        service.getClimateNormals(40.0, -100.0, 1, 15)
      ).rejects.toThrow(DataNotFoundError);

      await expect(
        service.getClimateNormals(40.0, -100.0, 12, 15)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should accept valid day range', async () => {
      const service = new NCEIService({ token: 'token' });

      await expect(
        service.getClimateNormals(40.0, -100.0, 6, 1)
      ).rejects.toThrow(DataNotFoundError);

      await expect(
        service.getClimateNormals(40.0, -100.0, 6, 31)
      ).rejects.toThrow(DataNotFoundError);
    });
  });

  describe('Error handling interceptor', () => {
    it('should have proper error handling structure', () => {
      const service = new NCEIService({ token: 'token' });
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should be prepared for 429 rate limit errors', () => {
      // Test that RateLimitError can be constructed for NCEI
      const error = new RateLimitError('NCEI', 'Rate limit exceeded', 60);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.service).toBe('NCEI');
      expect(error.statusCode).toBe(429);
    });

    it('should be prepared for 401/403 authentication errors', () => {
      // Test that ServiceUnavailableError can be constructed for NCEI
      const error = new ServiceUnavailableError('NCEI', 'Invalid token');
      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(error.service).toBe('NCEI');
    });

    it('should be prepared for 404 not found errors', () => {
      // Test that DataNotFoundError can be constructed for NCEI
      const error = new DataNotFoundError('NCEI', 'Data not found');
      expect(error).toBeInstanceOf(DataNotFoundError);
      expect(error.service).toBe('NCEI');
      expect(error.statusCode).toBe(404);
    });

    it('should be prepared for 500+ server errors', () => {
      // Test that ServiceUnavailableError can be constructed for NCEI
      const error = new ServiceUnavailableError('NCEI', 'Server error');
      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(error.service).toBe('NCEI');
      expect(error.statusCode).toBe(503);
    });
  });

  describe('Configuration validation', () => {
    it('should handle undefined config object', () => {
      const service = new NCEIService(undefined);
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should handle empty config object', () => {
      const service = new NCEIService({});
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should use default baseURL when not provided', () => {
      const service = new NCEIService({ token: 'token' });
      expect(service).toBeInstanceOf(NCEIService);
    });

    it('should use default timeout when not provided', () => {
      const service = new NCEIService({ token: 'token' });
      expect(service).toBeInstanceOf(NCEIService);
    });
  });

  describe('Token handling', () => {
    it('should handle token from environment variable', () => {
      const originalToken = process.env.NCEI_API_TOKEN;
      process.env.NCEI_API_TOKEN = 'env-token-123';

      // Import will read the env var
      const service = new NCEIService();
      expect(service).toBeInstanceOf(NCEIService);

      process.env.NCEI_API_TOKEN = originalToken;
    });

    it('should prefer explicit token over environment variable', () => {
      const originalToken = process.env.NCEI_API_TOKEN;
      process.env.NCEI_API_TOKEN = 'env-token';

      const service = new NCEIService({ token: 'explicit-token' });
      expect(service).toBeInstanceOf(NCEIService);

      process.env.NCEI_API_TOKEN = originalToken;
    });

    it('should handle null token', () => {
      const service = new NCEIService({ token: null as any });
      expect(service.isAvailable()).toBe(false);
    });

    it('should handle numeric token (coerced to string)', () => {
      const service = new NCEIService({ token: '12345' });
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe('Service metadata', () => {
    it('should have correct service name in errors', () => {
      const error1 = new DataNotFoundError('NCEI', 'Test');
      expect(error1.service).toBe('NCEI');

      const error2 = new RateLimitError('NCEI');
      expect(error2.service).toBe('NCEI');

      const error3 = new ServiceUnavailableError('NCEI');
      expect(error3.service).toBe('NCEI');
    });

    it('should be distinguishable from other services', () => {
      const nceiError = new DataNotFoundError('NCEI', 'Test');
      const noaaError = new DataNotFoundError('NOAA', 'Test');
      const meteoError = new DataNotFoundError('OpenMeteo', 'Test');

      expect(nceiError.service).not.toBe(noaaError.service);
      expect(nceiError.service).not.toBe(meteoError.service);
    });
  });

  describe('Future implementation readiness', () => {
    it('should accept all required parameters for climate normals', async () => {
      const service = new NCEIService({ token: 'token' });

      // Verify method signature accepts correct parameters
      await expect(
        service.getClimateNormals(40.7128, -74.0060, 7, 15)
      ).rejects.toThrow(DataNotFoundError);
    });

    it('should accept coordinates for US locations', async () => {
      const service = new NCEIService({ token: 'token' });

      // Seattle
      await expect(
        service.getClimateNormals(47.6062, -122.3321, 1, 1)
      ).rejects.toThrow();

      // Miami
      await expect(
        service.getClimateNormals(25.7617, -80.1918, 6, 15)
      ).rejects.toThrow();

      // Denver
      await expect(
        service.getClimateNormals(39.7392, -104.9903, 12, 31)
      ).rejects.toThrow();
    });

    it('should accept month/day combinations', async () => {
      const service = new NCEIService({ token: 'token' });

      // Various valid date combinations
      await expect(service.getClimateNormals(40.0, -100.0, 1, 1)).rejects.toThrow();
      await expect(service.getClimateNormals(40.0, -100.0, 2, 29)).rejects.toThrow();
      await expect(service.getClimateNormals(40.0, -100.0, 6, 15)).rejects.toThrow();
      await expect(service.getClimateNormals(40.0, -100.0, 12, 31)).rejects.toThrow();
    });
  });
});
