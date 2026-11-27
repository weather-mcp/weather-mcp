/**
 * Locks the transport classifiers in `tests/helpers/liveAlertTransport.ts` against the *real*
 * `MeteoAlarmService` and `GeoMetService`. Each row drives the service through `stubAdapter` on
 * its private axios client, so the message under test is the one the service actually throws
 * (not a hand-typed copy), and the classifier's verdict is read against it.
 *
 * The private-client casts are not typechecked (GOTCHAS G103: `tsconfig.json` excludes
 * `tests/`). The per-row exact-message assertion and the one-request assertion are the
 * positive control that the stub reached the real interceptor (G70).
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { MeteoAlarmService } from '../../src/services/meteoalarm.js';
import { GeoMetService } from '../../src/services/geomet.js';
import { stubAdapter, type Answer } from '../helpers/stubAdapter.js';
import {
  isMeteoAlarmTransportFailure,
  isGeoMetTransportFailure,
} from '../helpers/liveAlertTransport.js';

function clientOf(svc: unknown): AxiosInstance {
  return (svc as { client: AxiosInstance }).client;
}

function meteoAlarm(): MeteoAlarmService {
  const svc = new MeteoAlarmService();
  (svc as unknown as { maxRetries: number }).maxRetries = 0;
  return svc;
}

function geoMet(): GeoMetService {
  return new GeoMetService({ maxRetries: 0 });
}

/** How a row answers: a stub answer, or a rejection with a non-`Error` value. */
type Reply = Answer | { rejectWith: string };

interface Captured {
  error: unknown;
  requests: number;
}

async function drive(
  client: AxiosInstance,
  reply: Reply,
  call: () => Promise<unknown>,
): Promise<Captured> {
  let count = (): number => 0;
  if ('rejectWith' in reply) {
    const value = reply.rejectWith;
    let calls = 0;
    client.defaults.adapter = () => {
      calls += 1;
      return Promise.reject(value);
    };
    count = () => calls;
  } else {
    const recorded = stubAdapter(client, reply);
    count = () => recorded.length;
  }
  const result = await call().then(
    () => ({ error: undefined, resolved: true }),
    (error: unknown) => ({ error, resolved: false }),
  );
  expect(result.resolved, 'the call must reject').toBe(false);
  return { error: result.error, requests: count() };
}

interface Row {
  label: string;
  reply: Reply;
  message: string;
  transport: boolean;
}

const MA = {
  timeout: 'MeteoAlarm request timed out',
  connect: 'Unable to connect to the MeteoAlarm feed service',
  rate: 'MeteoAlarm API rate limit exceeded',
  shape: 'MeteoAlarm feed returned an unexpected shape',
};
const GM = {
  timeout: 'GeoMet request timed out',
  connect: 'Unable to connect to GeoMet API',
  rate: 'GeoMet API returned status 429 (rate limit)',
  shape: 'GeoMet API returned an unexpected shape',
};

const METEOALARM_ROWS: Row[] = [
  { label: 'ECONNABORTED', reply: { code: 'ECONNABORTED' }, message: MA.timeout, transport: true },
  { label: 'ETIMEDOUT', reply: { code: 'ETIMEDOUT' }, message: MA.timeout, transport: true },
  { label: 'ECONNREFUSED', reply: { code: 'ECONNREFUSED' }, message: MA.connect, transport: true },
  { label: '429', reply: { status: 429, data: {} }, message: MA.rate, transport: true },
  { label: '500', reply: { status: 500, data: {} }, message: 'MeteoAlarm API server error (status 500)', transport: true },
  { label: '503', reply: { status: 503, data: {} }, message: 'MeteoAlarm API server error (status 503)', transport: true },
  { label: '404 (regression)', reply: { status: 404, data: {} }, message: 'MeteoAlarm API returned status 404', transport: false },
  { label: '403 (regression)', reply: { status: 403, data: {} }, message: 'MeteoAlarm API returned status 403', transport: false },
  { label: '200 empty body', reply: { status: 200, data: '' }, message: MA.shape, transport: false },
  { label: '200 wrong envelope', reply: { status: 200, data: {} }, message: MA.shape, transport: false },
  { label: 'unmapped code (request failed)', reply: { code: 'CERT_HAS_EXPIRED' }, message: 'MeteoAlarm request failed', transport: false },
  { label: 'non-Error rejection', reply: { rejectWith: 'not an error' }, message: 'Unknown error occurred while contacting MeteoAlarm', transport: false },
];

const GEOMET_ROWS: Row[] = [
  { label: 'ECONNABORTED', reply: { code: 'ECONNABORTED' }, message: GM.timeout, transport: true },
  { label: 'ETIMEDOUT', reply: { code: 'ETIMEDOUT' }, message: GM.timeout, transport: true },
  { label: 'ECONNREFUSED', reply: { code: 'ECONNREFUSED' }, message: GM.connect, transport: true },
  { label: '429', reply: { status: 429, data: {} }, message: GM.rate, transport: true },
  { label: '500', reply: { status: 500, data: {} }, message: 'GeoMet API returned status 500 (server error)', transport: true },
  { label: '503', reply: { status: 503, data: {} }, message: 'GeoMet API returned status 503 (server error)', transport: true },
  { label: '404 (regression)', reply: { status: 404, data: {} }, message: 'GeoMet API returned status 404', transport: false },
  { label: '403 (regression)', reply: { status: 403, data: {} }, message: 'GeoMet API returned status 403', transport: false },
  { label: '200 empty body', reply: { status: 200, data: '' }, message: GM.shape, transport: false },
  { label: '200 wrong envelope', reply: { status: 200, data: {} }, message: GM.shape, transport: false },
  { label: 'unmapped code (request failed)', reply: { code: 'CERT_HAS_EXPIRED' }, message: 'GeoMet request failed', transport: false },
  { label: 'non-Error rejection', reply: { rejectWith: 'not an error' }, message: 'Unknown error occurred while contacting GeoMet API', transport: false },
];

async function captureMeteoAlarm(reply: Reply): Promise<Captured> {
  const svc = meteoAlarm();
  return drive(clientOf(svc), reply, () => svc.getWarnings('gb'));
}

async function captureGeoMet(reply: Reply): Promise<Captured> {
  const svc = geoMet();
  return drive(clientOf(svc), reply, () => svc.getAlerts(43.6532, -79.3832));
}

describe('MeteoAlarm transport classifier (real service, stubbed adapter)', () => {
  it.each(METEOALARM_ROWS)('$label', async ({ reply, message, transport }) => {
    const { error, requests } = await captureMeteoAlarm(reply);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(message);
    expect(requests).toBe(1);
    expect(isMeteoAlarmTransportFailure(error)).toBe(transport);
  });
});

describe('GeoMet transport classifier (real service, stubbed adapter)', () => {
  it.each(GEOMET_ROWS)('$label', async ({ reply, message, transport }) => {
    const { error, requests } = await captureGeoMet(reply);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(message);
    expect(requests).toBe(1);
    expect(isGeoMetTransportFailure(error)).toBe(transport);
  });
});

describe('every 5xx status is a transport failure (the range, not a sample)', () => {
  // The classifiers' server-error patterns are a range contract (5\d\d). Two sampled rows
  // would stay green under a pattern narrowed to (500|503), so sweep the whole range through
  // the real services, then check that 499 and 600 fall outside it.
  const statuses = Array.from({ length: 100 }, (_, i) => 500 + i);

  it('MeteoAlarm: 500-599 each classify true with the exact message', async () => {
    for (const status of statuses) {
      const { error, requests } = await captureMeteoAlarm({ status, data: {} });
      expect((error as Error).message, `status ${status}`).toBe(`MeteoAlarm API server error (status ${status})`);
      expect(requests, `status ${status}`).toBe(1);
      expect(isMeteoAlarmTransportFailure(error), `status ${status}`).toBe(true);
    }
  });

  it('GeoMet: 500-599 each classify true with the exact message', async () => {
    for (const status of statuses) {
      const { error, requests } = await captureGeoMet({ status, data: {} });
      expect((error as Error).message, `status ${status}`).toBe(`GeoMet API returned status ${status} (server error)`);
      expect(requests, `status ${status}`).toBe(1);
      expect(isGeoMetTransportFailure(error), `status ${status}`).toBe(true);
    }
  });

  it('499 and 600 sit outside the range for both services', async () => {
    for (const status of [499, 600]) {
      const meteo = await captureMeteoAlarm({ status, data: {} });
      expect(isMeteoAlarmTransportFailure(meteo.error), `MeteoAlarm status ${status}`).toBe(false);
      const geo = await captureGeoMet({ status, data: {} });
      expect(isGeoMetTransportFailure(geo.error), `GeoMet status ${status}`).toBe(false);
    }
  });
});

describe('classifiers refuse what is not a service transport error', () => {
  it('a real Vitest assertion failure is not a transport failure', () => {
    let caught: unknown;
    try {
      expect(1).toBe(2);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isMeteoAlarmTransportFailure(caught)).toBe(false);
    expect(isGeoMetTransportFailure(caught)).toBe(false);
  });

  it.each([
    ['a bare string', 'MeteoAlarm request timed out'],
    ['undefined', undefined],
    ['a plain object with a matching message', { message: 'GeoMet request timed out' }],
  ])('a non-Error value is refused: %s', (_label, value) => {
    expect(isMeteoAlarmTransportFailure(value)).toBe(false);
    expect(isGeoMetTransportFailure(value)).toBe(false);
    expect(isMeteoAlarmTransportFailure({ message: 'MeteoAlarm request timed out' })).toBe(false);
    expect(isGeoMetTransportFailure('GeoMet request timed out')).toBe(false);
  });

  it('refuses each service\'s real transport errors in the other classifier', async () => {
    const meteoErrors: unknown[] = [];
    for (const row of METEOALARM_ROWS.filter((r) => r.transport)) {
      meteoErrors.push((await captureMeteoAlarm(row.reply)).error);
    }
    const geoErrors: unknown[] = [];
    for (const row of GEOMET_ROWS.filter((r) => r.transport)) {
      geoErrors.push((await captureGeoMet(row.reply)).error);
    }
    expect(meteoErrors).toHaveLength(6);
    expect(geoErrors).toHaveLength(6);
    for (const e of meteoErrors) {
      expect(isMeteoAlarmTransportFailure(e)).toBe(true);
      expect(isGeoMetTransportFailure(e)).toBe(false);
    }
    for (const e of geoErrors) {
      expect(isGeoMetTransportFailure(e)).toBe(true);
      expect(isMeteoAlarmTransportFailure(e)).toBe(false);
    }
  });

  it.each([
    ['GeoMet: transport text plus a suffix', 'GeoMet request timed out (retry 2)', 'geomet'],
    ['GeoMet: status 600 is not a server error', 'GeoMet API returned status 600 (server error)', 'geomet'],
    ['MeteoAlarm: transport text plus a suffix', 'MeteoAlarm request timed out (retry 2)', 'meteoalarm'],
    ['MeteoAlarm: status 600 is not a server error', 'MeteoAlarm API server error (status 600)', 'meteoalarm'],
    ['MeteoAlarm: case folded', 'meteoalarm request timed out', 'meteoalarm'],
    ['GeoMet: padded', ' GeoMet request timed out', 'geomet'],
  ])('exact match only: %s', (_label, message, which) => {
    const err = new Error(message);
    if (which === 'geomet') {
      expect(isGeoMetTransportFailure(err)).toBe(false);
    } else {
      expect(isMeteoAlarmTransportFailure(err)).toBe(false);
    }
  });
});
