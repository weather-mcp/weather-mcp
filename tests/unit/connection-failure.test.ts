import { describe, it, expect } from 'vitest';
import {
  CONNECTION_FAILURE_CODES,
  isConnectionFailureCode
} from '../../src/utils/connectionFailure.js';

const SEVEN = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH'
];

describe('connectionFailure', () => {
  it('holds exactly the seven connection-failure codes', () => {
    expect([...CONNECTION_FAILURE_CODES].sort()).toEqual([...SEVEN].sort());
  });

  it.each(SEVEN)('treats %s as a connection failure', (code) => {
    expect(isConnectionFailureCode(code)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'ECONNABORTED',
    'ETIMEDOUT',
    'ERR_CANCELED',
    'ERR_SOMETHING',
    'econnreset'
  ])('does not treat %j as a connection failure', (code) => {
    expect(isConnectionFailureCode(code)).toBe(false);
  });
});
