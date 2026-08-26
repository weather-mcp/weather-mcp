import { describe, it, expect } from 'vitest';
import { displayValue } from '../../src/utils/displayBanding.js';

describe('displayValue', () => {
  describe('the measured asymmetry that makes this a helper rather than a shifted threshold', () => {
    it('rounds 8.05 up to 8.1 at one decimal', () => {
      expect(displayValue(8.05, 1)).toBe(8.1);
    });

    it('rounds 50.05 down to 50 at one decimal (floating-point storage of .05 differs by value)', () => {
      expect(displayValue(50.05, 1)).toBe(50);
    });

    it('rounds 16.05 up to 16.1 at one decimal', () => {
      expect(displayValue(16.05, 1)).toBe(16.1);
    });
  });

  describe('window edges', () => {
    it('rounds 8.04995 down to 8 at one decimal', () => {
      expect(displayValue(8.04995, 1)).toBe(8);
    });

    it('rounds 50.0499 down to 50 at one decimal', () => {
      expect(displayValue(50.0499, 1)).toBe(50);
    });
  });

  describe('decimals parameter', () => {
    it('rounds to the nearest whole number when decimals is 0', () => {
      expect(displayValue(3.7, 0)).toBe(4);
      expect(displayValue(3.2, 0)).toBe(3);
    });

    it('rounds to two decimal places when decimals is 2', () => {
      expect(displayValue(3.14159, 2)).toBe(3.14);
    });
  });

  describe('exact integers', () => {
    it('passes an exact integer through unchanged', () => {
      expect(displayValue(50, 0)).toBe(50);
      expect(displayValue(50, 1)).toBe(50);
    });
  });

  describe('toFixed semantics on negative halves', () => {
    it('rounds -2.5 to -3 at zero decimals, matching toFixed rather than Math.round', () => {
      // (-2.5).toFixed(0) === '-3'; Math.round(-2.5) === -2 — these disagree,
      // and this helper must mirror toFixed since that is what the render
      // sites use.
      expect(displayValue(-2.5, 0)).toBe(-3);
      expect(Math.round(-2.5)).not.toBe(-3);
    });
  });

  describe('non-finite passthrough', () => {
    it('returns NaN unchanged rather than converting it into a number the caller would band', () => {
      expect(Number.isNaN(displayValue(NaN, 1))).toBe(true);
    });

    it('returns +Infinity unchanged', () => {
      expect(displayValue(Infinity, 1)).toBe(Infinity);
    });

    it('returns -Infinity unchanged', () => {
      expect(displayValue(-Infinity, 1)).toBe(-Infinity);
    });
  });
});
