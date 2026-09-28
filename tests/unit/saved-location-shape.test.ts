import { describe, it, expect } from 'vitest';
import {
  validateSavedLocationInput,
  describeSavedLocationDefect,
} from '../../src/utils/savedLocationShape.js';

/** A fresh minimal valid record — every test spreads one bad field over this. */
function valid(): Record<string, unknown> {
  return {
    name: 'Seattle',
    latitude: 47.6062,
    longitude: -122.3321,
  };
}

describe('validateSavedLocationInput', () => {
  describe('non-object input', () => {
    it('rejects null', () => {
      expect(() => validateSavedLocationInput(null)).toThrow('Saved location must be an object');
    });

    it('rejects an array', () => {
      expect(() => validateSavedLocationInput(['not', 'an', 'object'])).toThrow(
        'Saved location must be an object'
      );
    });

    it('rejects a string', () => {
      expect(() => validateSavedLocationInput('Seattle')).toThrow(
        'Saved location must be an object'
      );
    });

    it('rejects a number', () => {
      expect(() => validateSavedLocationInput(42)).toThrow('Saved location must be an object');
    });
  });

  describe('name', () => {
    it('rejects a number', () => {
      expect(() => validateSavedLocationInput({ ...valid(), name: 42 })).toThrow(
        'name must be a string'
      );
    });

    it('rejects null', () => {
      expect(() => validateSavedLocationInput({ ...valid(), name: null })).toThrow(
        'name must be a string'
      );
    });

    it('rejects an object', () => {
      expect(() => validateSavedLocationInput({ ...valid(), name: {} })).toThrow(
        'name must be a string'
      );
    });

    it('rejects a whitespace-only name', () => {
      expect(() => validateSavedLocationInput({ ...valid(), name: '   ' })).toThrow(
        'name cannot be empty'
      );
    });

    it('rejects an empty name', () => {
      expect(() => validateSavedLocationInput({ ...valid(), name: '' })).toThrow(
        'name cannot be empty'
      );
    });

    it('trims a padded name and does not mutate the input object', () => {
      const input = { ...valid(), name: '  Seattle  ' };
      const frozen = { ...input };
      const result = validateSavedLocationInput(input);
      expect(result.name).toBe('Seattle');
      expect(input).toEqual(frozen);
    });
  });

  describe('latitude', () => {
    it('rejects a numeric string', () => {
      expect(() => validateSavedLocationInput({ ...valid(), latitude: '47.6' })).toThrow(
        'Invalid latitude: must be a finite number, received string'
      );
    });

    it('rejects NaN', () => {
      expect(() => validateSavedLocationInput({ ...valid(), latitude: NaN })).toThrow(
        'Invalid latitude: must be a finite number, received number'
      );
    });

    it('rejects out-of-range 91', () => {
      expect(() => validateSavedLocationInput({ ...valid(), latitude: 91 })).toThrow(
        'Invalid latitude: 91. Must be between -90 and 90.'
      );
    });

    it('rejects a missing latitude', () => {
      const input = valid();
      delete input.latitude;
      expect(() => validateSavedLocationInput(input)).toThrow(
        'Invalid latitude: must be a finite number, received undefined'
      );
    });
  });

  describe('longitude', () => {
    it('rejects a numeric string', () => {
      expect(() => validateSavedLocationInput({ ...valid(), longitude: '-122.3' })).toThrow(
        'Invalid longitude: must be a finite number, received string'
      );
    });

    it('rejects NaN', () => {
      expect(() => validateSavedLocationInput({ ...valid(), longitude: NaN })).toThrow(
        'Invalid longitude: must be a finite number, received number'
      );
    });

    it('rejects out-of-range 181', () => {
      expect(() => validateSavedLocationInput({ ...valid(), longitude: 181 })).toThrow(
        'Invalid longitude: 181. Must be between -180 and 180.'
      );
    });

    it('rejects a missing longitude', () => {
      const input = valid();
      delete input.longitude;
      expect(() => validateSavedLocationInput(input)).toThrow(
        'Invalid longitude: must be a finite number, received undefined'
      );
    });
  });

  describe.each(['timezone', 'country_code', 'admin1', 'admin2', 'description', 'notes'])(
    'string field %s',
    (field) => {
      it('rejects a number', () => {
        expect(() => validateSavedLocationInput({ ...valid(), [field]: 42 })).toThrow(
          `${field} must be a string`
        );
      });

      it('rejects null', () => {
        expect(() => validateSavedLocationInput({ ...valid(), [field]: null })).toThrow(
          `${field} must be a string`
        );
      });
    }
  );

  describe.each(['alternateNames', 'activities'])('array field %s', (field) => {
    it('rejects a bare string', () => {
      expect(() => validateSavedLocationInput({ ...valid(), [field]: 'not-an-array' })).toThrow(
        `${field} must be an array of strings`
      );
    });

    it('rejects an array with a non-string element', () => {
      expect(() => validateSavedLocationInput({ ...valid(), [field]: [1] })).toThrow(
        `${field} must be an array of strings`
      );
    });

    it('rejects null', () => {
      expect(() => validateSavedLocationInput({ ...valid(), [field]: null })).toThrow(
        `${field} must be an array of strings`
      );
    });
  });

  describe('field-order precedence', () => {
    it('reports name before latitude when both are bad', () => {
      expect(() =>
        validateSavedLocationInput({ ...valid(), name: 42, latitude: 999 })
      ).toThrow('name must be a string');
    });
  });

  describe('acceptance', () => {
    it('accepts a minimal record', () => {
      const result = validateSavedLocationInput(valid());
      expect(result).toEqual({
        name: 'Seattle',
        latitude: 47.6062,
        longitude: -122.3321,
      });
    });

    it('accepts a full record with every optional field valid', () => {
      const input = {
        ...valid(),
        timezone: 'America/Los_Angeles',
        country_code: 'US',
        admin1: 'Washington',
        admin2: 'King County',
        description: "My sister's house",
        notes: 'Great view of the sound',
        alternateNames: ['sisters place'],
        activities: ['boating', 'fishing'],
      };
      const result = validateSavedLocationInput(input);
      expect(result).toEqual(input);
    });

    it('passes unknown extra fields through untouched', () => {
      const input = { ...valid(), somethingUnexpected: 'keep-me' };
      const result = validateSavedLocationInput(input) as Record<string, unknown>;
      expect(result.somethingUnexpected).toBe('keep-me');
    });

    it('passes saved_at/updated_at through untouched when present', () => {
      const input = { ...valid(), saved_at: '2025-01-15T10:30:00.000Z', updated_at: 42 };
      const result = validateSavedLocationInput(input) as Record<string, unknown>;
      expect(result.saved_at).toBe('2025-01-15T10:30:00.000Z');
      expect(result.updated_at).toBe(42);
    });
  });
});

describe('describeSavedLocationDefect', () => {
  describe('non-object entry', () => {
    it('reports null', () => {
      expect(describeSavedLocationDefect(null)).toEqual({
        field: 'entry',
        problem: 'is not an object',
      });
    });

    it('reports an array', () => {
      expect(describeSavedLocationDefect(['not', 'an', 'object'])).toEqual({
        field: 'entry',
        problem: 'is not an object',
      });
    });

    it('reports a string', () => {
      expect(describeSavedLocationDefect('Seattle')).toEqual({
        field: 'entry',
        problem: 'is not an object',
      });
    });

    it('reports a number', () => {
      expect(describeSavedLocationDefect(42)).toEqual({
        field: 'entry',
        problem: 'is not an object',
      });
    });
  });

  describe('name', () => {
    it('reports a number', () => {
      expect(describeSavedLocationDefect({ ...valid(), name: 42 })).toEqual({
        field: 'name',
        problem: 'is not text',
      });
    });

    it('reports null', () => {
      expect(describeSavedLocationDefect({ ...valid(), name: null })).toEqual({
        field: 'name',
        problem: 'is not text',
      });
    });

    it('reports an object', () => {
      expect(describeSavedLocationDefect({ ...valid(), name: {} })).toEqual({
        field: 'name',
        problem: 'is not text',
      });
    });

    it('reports a whitespace-only name as empty', () => {
      expect(describeSavedLocationDefect({ ...valid(), name: '   ' })).toEqual({
        field: 'name',
        problem: 'is empty',
      });
    });

    it('reports an empty name as empty', () => {
      expect(describeSavedLocationDefect({ ...valid(), name: '' })).toEqual({
        field: 'name',
        problem: 'is empty',
      });
    });
  });

  describe('latitude', () => {
    it('reports a numeric string', () => {
      expect(describeSavedLocationDefect({ ...valid(), latitude: '47.6' })).toEqual({
        field: 'latitude',
        problem: 'is not a finite number in range',
      });
    });

    it('reports NaN', () => {
      expect(describeSavedLocationDefect({ ...valid(), latitude: NaN })).toEqual({
        field: 'latitude',
        problem: 'is not a finite number in range',
      });
    });

    it('reports out-of-range 91', () => {
      expect(describeSavedLocationDefect({ ...valid(), latitude: 91 })).toEqual({
        field: 'latitude',
        problem: 'is not a finite number in range',
      });
    });

    it('reports a missing latitude', () => {
      const input = valid();
      delete input.latitude;
      expect(describeSavedLocationDefect(input)).toEqual({
        field: 'latitude',
        problem: 'is not a finite number in range',
      });
    });
  });

  describe('longitude', () => {
    it('reports a numeric string', () => {
      expect(describeSavedLocationDefect({ ...valid(), longitude: '-122.3' })).toEqual({
        field: 'longitude',
        problem: 'is not a finite number in range',
      });
    });

    it('reports NaN', () => {
      expect(describeSavedLocationDefect({ ...valid(), longitude: NaN })).toEqual({
        field: 'longitude',
        problem: 'is not a finite number in range',
      });
    });

    it('reports out-of-range 181', () => {
      expect(describeSavedLocationDefect({ ...valid(), longitude: 181 })).toEqual({
        field: 'longitude',
        problem: 'is not a finite number in range',
      });
    });

    it('reports a missing longitude', () => {
      const input = valid();
      delete input.longitude;
      expect(describeSavedLocationDefect(input)).toEqual({
        field: 'longitude',
        problem: 'is not a finite number in range',
      });
    });
  });

  describe.each(['timezone', 'country_code', 'admin1', 'admin2', 'description', 'notes'])(
    'string field %s',
    (field) => {
      it('reports a number', () => {
        expect(describeSavedLocationDefect({ ...valid(), [field]: 42 })).toEqual({
          field,
          problem: 'is not text',
        });
      });

      it('reports null', () => {
        expect(describeSavedLocationDefect({ ...valid(), [field]: null })).toEqual({
          field,
          problem: 'is not text',
        });
      });
    }
  );

  describe.each(['alternateNames', 'activities'])('array field %s', (field) => {
    it('reports a bare string', () => {
      expect(describeSavedLocationDefect({ ...valid(), [field]: 'not-an-array' })).toEqual({
        field,
        problem: 'is not a list of text',
      });
    });

    it('reports an array with a non-string element', () => {
      expect(describeSavedLocationDefect({ ...valid(), [field]: [1] })).toEqual({
        field,
        problem: 'is not a list of text',
      });
    });

    it('reports null', () => {
      expect(describeSavedLocationDefect({ ...valid(), [field]: null })).toEqual({
        field,
        problem: 'is not a list of text',
      });
    });
  });

  describe('field-order precedence', () => {
    it('reports name before latitude when both are bad', () => {
      expect(describeSavedLocationDefect({ ...valid(), name: 42, latitude: 999 })).toEqual({
        field: 'name',
        problem: 'is not text',
      });
    });
  });

  describe('acceptance', () => {
    it('reports undefined for a minimal valid record', () => {
      expect(describeSavedLocationDefect(valid())).toBeUndefined();
    });

    it('reports undefined for a full valid record', () => {
      const input = {
        ...valid(),
        timezone: 'America/Los_Angeles',
        country_code: 'US',
        admin1: 'Washington',
        admin2: 'King County',
        description: "My sister's house",
        notes: 'Great view of the sound',
        alternateNames: ['sisters place'],
        activities: ['boating', 'fishing'],
      };
      expect(describeSavedLocationDefect(input)).toBeUndefined();
    });

    it('does not check timestamps — an odd saved_at still reports undefined', () => {
      const input = { ...valid(), saved_at: 42, updated_at: 'not-a-date' };
      expect(describeSavedLocationDefect(input)).toBeUndefined();
    });

    it('reports undefined for a record with unknown extra fields', () => {
      const input = { ...valid(), somethingUnexpected: 'keep-me' };
      expect(describeSavedLocationDefect(input)).toBeUndefined();
    });
  });
});
