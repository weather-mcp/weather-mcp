import { describe, it, expect } from 'vitest';
import { parseEnvBoolean } from '../../src/utils/envBoolean.js';

describe('parseEnvBoolean', () => {
  it.each(['true', 'TRUE', 'True', ' true ', '1'])('reads %j as true', (raw) => {
    expect(parseEnvBoolean(raw)).toBe(true);
  });

  it.each(['false', 'FALSE', ' False ', '0'])('reads %j as false', (raw) => {
    expect(parseEnvBoolean(raw)).toBe(false);
  });

  it('leaves an unset variable undefined', () => {
    expect(parseEnvBoolean(undefined)).toBeUndefined();
  });

  it.each(['', ' ', 'yes', 'no', 'on', 'off', '2', '-1', 'true!', 'banana'])(
    'reads %j as invalid',
    (raw) => {
      expect(parseEnvBoolean(raw)).toBe('invalid');
    }
  );
});
