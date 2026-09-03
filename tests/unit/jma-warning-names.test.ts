/**
 * Unit tests for the JMA warning-name gloss table and tier classifier
 * (`src/utils/jmaWarningNames.ts`). Pure module, no fixtures needed — every
 * expected answer below is hand-derived from the suffix/phenomenon rules
 * documented in the module, not from running the implementation first.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyJmaTier,
  glossJmaWarningName,
  glossJmaCondition,
  JMA_PHENOMENON_GLOSSES
} from '../../src/utils/jmaWarningNames.js';

const PHENOMENA = Object.keys(JMA_PHENOMENON_GLOSSES);

describe('classifyJmaTier', () => {
  it('classifies every 特別警報 form the table can produce as emergency (per-form loop, not a sample)', () => {
    for (const phenomenon of PHENOMENA) {
      const name = `${phenomenon}特別警報`;
      expect(classifyJmaTier(name), `expected ${name} to classify as emergency`).toBe('emergency');
    }
  });

  it('classifies every 警報 (non-特別) form as warning', () => {
    for (const phenomenon of PHENOMENA) {
      const name = `${phenomenon}警報`;
      expect(classifyJmaTier(name), `expected ${name} to classify as warning`).toBe('warning');
    }
  });

  it('classifies every 注意報 form as advisory', () => {
    for (const phenomenon of PHENOMENA) {
      const name = `${phenomenon}注意報`;
      expect(classifyJmaTier(name), `expected ${name} to classify as advisory`).toBe('advisory');
    }
  });

  it('classifies 大雨特別警報 as emergency, and specifically NOT as warning or advisory (the ordering trap)', () => {
    const tier = classifyJmaTier('大雨特別警報');
    expect(tier).toBe('emergency');
    expect(tier).not.toBe('warning');
    expect(tier).not.toBe('advisory');
  });

  it('returns undefined for an unknown/garbage name', () => {
    expect(classifyJmaTier('ぜんぜん違う言葉')).toBeUndefined();
    expect(classifyJmaTier('Heavy Rain Warning')).toBeUndefined();
  });

  it('handles undefined, null and empty string without throwing', () => {
    expect(() => classifyJmaTier(undefined)).not.toThrow();
    expect(() => classifyJmaTier(null)).not.toThrow();
    expect(() => classifyJmaTier('')).not.toThrow();
    expect(classifyJmaTier(undefined)).toBeUndefined();
    expect(classifyJmaTier(null)).toBeUndefined();
    expect(classifyJmaTier('')).toBeUndefined();
  });

  it('handles a non-Japanese string without throwing', () => {
    expect(() => classifyJmaTier('random english text')).not.toThrow();
    expect(classifyJmaTier('random english text')).toBeUndefined();
  });
});

describe('glossJmaWarningName', () => {
  it('glosses the 11 name/code pairs observed live in the T4 sample', () => {
    expect(glossJmaWarningName('大雨注意報')).toBe('Advisory for Heavy Rain');
    expect(glossJmaWarningName('雷注意報')).toBe('Advisory for Thunderstorm');
    expect(glossJmaWarningName('大雨警報')).toBe('Warning for Heavy Rain');
    expect(glossJmaWarningName('洪水注意報')).toBe('Advisory for Flood');
    expect(glossJmaWarningName('強風注意報')).toBe('Advisory for Gale');
    expect(glossJmaWarningName('波浪注意報')).toBe('Advisory for High Waves');
    expect(glossJmaWarningName('濃霧注意報')).toBe('Advisory for Dense Fog');
    expect(glossJmaWarningName('乾燥注意報')).toBe('Advisory for Dry Air');
    expect(glossJmaWarningName('洪水警報')).toBe('Warning for Flood');
    expect(glossJmaWarningName('暴風警報')).toBe('Warning for Storm');
    expect(glossJmaWarningName('波浪警報')).toBe('Warning for High Waves');
  });

  it('glosses 大雨特別警報 as an Emergency Warning, never downgraded', () => {
    expect(glossJmaWarningName('大雨特別警報')).toBe('Emergency Warning for Heavy Rain');
  });

  it('glosses a known phenomenon in a tier combination not explicitly listed (compositional lookup)', () => {
    // 乾燥 (Dry Air) has only ever been observed as 乾燥注意報 (advisory) live,
    // and 特別警報/警報 forms are not real JMA phenomena for dry air — but the
    // compositional lookup does not know or care about real-world validity,
    // which is exactly the point: an unseen combination of a known
    // phenomenon and a known tier still glosses correctly.
    expect(glossJmaWarningName('乾燥警報')).toBe('Warning for Dry Air');
    expect(glossJmaWarningName('乾燥特別警報')).toBe('Emergency Warning for Dry Air');
  });

  it('returns undefined for a known tier suffix with an unrecognised phenomenon', () => {
    expect(glossJmaWarningName('未知警報')).toBeUndefined();
  });

  it('returns undefined for an unknown/garbage name', () => {
    expect(glossJmaWarningName('ぜんぜん違う言葉')).toBeUndefined();
    expect(glossJmaWarningName('Heavy Rain Warning')).toBeUndefined();
  });

  it('handles undefined, null and empty string without throwing', () => {
    expect(() => glossJmaWarningName(undefined)).not.toThrow();
    expect(() => glossJmaWarningName(null)).not.toThrow();
    expect(() => glossJmaWarningName('')).not.toThrow();
    expect(glossJmaWarningName(undefined)).toBeUndefined();
    expect(glossJmaWarningName(null)).toBeUndefined();
    expect(glossJmaWarningName('')).toBeUndefined();
  });

  it('handles a non-Japanese string without throwing', () => {
    expect(() => glossJmaWarningName('random english text')).not.toThrow();
    expect(glossJmaWarningName('random english text')).toBeUndefined();
  });
});

describe('glossJmaCondition', () => {
  it('glosses a single known condition', () => {
    expect(glossJmaCondition('浸水害')).toBe('flood damage (inundation)');
    expect(glossJmaCondition('土砂災害')).toBe('landslide (sediment disaster)');
  });

  it('glosses the compound 土砂災害、浸水害 as both parts joined, in order', () => {
    expect(glossJmaCondition('土砂災害、浸水害')).toBe(
      'landslide (sediment disaster); flood damage (inundation)'
    );
  });

  it('returns undefined for a compound with one unrecognised part, rather than a partial gloss', () => {
    expect(glossJmaCondition('土砂災害、未知の条件')).toBeUndefined();
  });

  it('returns undefined for an unknown/garbage condition', () => {
    expect(glossJmaCondition('ぜんぜん違う言葉')).toBeUndefined();
  });

  it('handles undefined, null and empty string without throwing', () => {
    expect(() => glossJmaCondition(undefined)).not.toThrow();
    expect(() => glossJmaCondition(null)).not.toThrow();
    expect(() => glossJmaCondition('')).not.toThrow();
    expect(glossJmaCondition(undefined)).toBeUndefined();
    expect(glossJmaCondition(null)).toBeUndefined();
    expect(glossJmaCondition('')).toBeUndefined();
  });

  it('handles a non-Japanese string without throwing', () => {
    expect(() => glossJmaCondition('random english text')).not.toThrow();
    expect(glossJmaCondition('random english text')).toBeUndefined();
  });
});
