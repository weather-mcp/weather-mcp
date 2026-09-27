/**
 * Unit tests for redactUrlForLogging (mqtt-broker-url-log-hygiene T1).
 *
 * A pure, static-import function — no fresh-module epoch needed. Pins the
 * design plan's §1 input/output table (plan-mqtt-broker-url-log-hygiene.md)
 * row for row, plus the two extra rows the implementation plan recorded from
 * a live re-run on Node v22.23.2 (unescaped `@` in a password; a
 * password-only userinfo).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { redactUrlForLogging } from '../../src/utils/logger.js';

describe('redactUrlForLogging', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('the design/impl-plan table, row for row', () => {
    it.each([
      ['mqtt://blitzortung.ha.sed.pl:1883', 'mqtt://blitzortung.ha.sed.pl:1883'],
      ['mqtts://user:s3cret@broker.example:8883', 'mqtts://broker.example:8883'],
      ['wss://user:p%40ss@broker.example:443/mqtt?token=abc#frag', 'wss://broker.example'],
      ['wss://broker.example/mqtt?token=abc', 'wss://broker.example'],
      ['mqtt://[::1]:1883', 'mqtt://[::1]:1883'],
      ['mqtt://user@host', 'mqtt://host'],
      ['ws://user:pw@10.0.0.5:9001/path', 'ws://10.0.0.5:9001'],
      ['tcp://u:p@h:1883', 'tcp://h:1883'],
      ['not a url', '<unparseable>'],
      ['', '<unparseable>'],
      ['mqtt://', 'mqtt://'],
      // Two extra rows from the implementation plan's re-run:
      ['mqtt://user:pa@ss@host:1883', 'mqtt://host:1883'],
      ['mqtt://:tok@host', 'mqtt://host']
    ])('%s -> %s', (input, expected) => {
      expect(redactUrlForLogging(input)).toBe(expected);
    });
  });

  describe('totality', () => {
    it.each([
      ['empty string', ''],
      ['plain words', 'not a url'],
      ['scheme-only separator', '://'],
      ['unterminated IPv6 literal', 'mqtt://[::1'],
      ['a NUL byte', '\u0000'],
      ['a 10,000-character string', 'x'.repeat(10000)]
    ])('never throws on %s and returns a string', (_label, input) => {
      let result: string | undefined;
      expect(() => {
        result = redactUrlForLogging(input);
      }).not.toThrow();
      expect(typeof result).toBe('string');
    });
  });

  describe('LOG_PII has no effect', () => {
    it('still redacts a credentialed URL when LOG_PII=true', () => {
      vi.stubEnv('LOG_PII', 'true');

      expect(redactUrlForLogging('mqtts://u5er-hyg:pw-hunter2-hyg@broker.example:8883')).toBe(
        'mqtts://broker.example:8883'
      );
      expect(
        redactUrlForLogging('wss://u5er-hyg:pw-hunter2-hyg@broker.example/mqtt?token=qt0ken-hyg')
      ).toBe('wss://broker.example');
    });
  });

  describe('no credential byte survives', () => {
    // Tokens are unique enough that they cannot collide with a host, scheme
    // or fixed word in the output (G62: assert the construct, not a common
    // word like "user").
    it.each([
      ['userinfo username', 'mqtts://u5er-hyg:pw-hunter2-hyg@broker.example:8883'],
      ['userinfo password', 'mqtt://u5er-hyg:pw-hunter2-hyg@127.0.0.1:1883'],
      ['query token', 'wss://broker.example/mqtt?token=qt0ken-hyg'],
      [
        'userinfo and query token together',
        'wss://u5er-hyg:pw-hunter2-hyg@broker.example/mqtt?token=qt0ken-hyg'
      ]
    ])('%s does not appear in the output', (_label, input) => {
      const output = redactUrlForLogging(input);
      expect(output).not.toContain('u5er-hyg');
      expect(output).not.toContain('pw-hunter2-hyg');
      expect(output).not.toContain('qt0ken-hyg');
    });
  });
});
