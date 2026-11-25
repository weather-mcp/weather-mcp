/**
 * NIFC feed envelope: a 200 whose body is not a fire-perimeter feature list is an
 * error, never an empty list, and is never cached (G4).
 *
 * The stub sits on the instance `client.get`, the seam the service really calls
 * (G70). A fresh service per test, so the cache cannot serve a hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NIFCService } from '../../src/services/nifc.js';
import { logger } from '../../src/utils/logger.js';

const MESSAGE = 'NIFC service returned an unexpected response.';

const BAD_BODIES: Array<[string, unknown]> = [
  ['ArcGIS error (live shape)', { error: { code: 400, message: 'Cannot perform query. Invalid query parameters.', details: [] } }],
  ['empty object', {}],
  ['JSON null', null],
  ['empty string', ''],
  ['HTML string', '<html>Maintenance</html>'],
  ['bare array', []],
  ['features null', { features: null }],
  ['features object', { features: {} }],
  ['features string', { features: 'x' }],
  ['null element', { features: [null] }],
  ['string element', { features: ['x'] }],
  ['one good, one bad element', { features: [{ attributes: {} }, null] }],
  ['list plus error', { features: [], error: { code: 500 } }],
];

function stubGet(service: NIFCService, body: unknown) {
  return vi
    .spyOn((service as unknown as { client: { get: (...a: unknown[]) => unknown } }).client, 'get')
    .mockResolvedValue({ data: body, status: 200 });
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;
let debug: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  info = vi.spyOn(logger, 'info').mockImplementation(() => {});
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  error = vi.spyOn(logger, 'error').mockImplementation(() => {});
  debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NIFC feed envelope', () => {
  it.each(BAD_BODIES)('%s → refused, logged without the body, never cached', async (_label, body) => {
    const service = new NIFCService();
    const get = stubGet(service, body);

    await expect(service.queryFirePerimeters(-117, 43, -116, 44)).rejects.toThrow(
      new RegExp(`^${MESSAGE.replace(/\./g, '\\.')}$`)
    );
    expect(get).toHaveBeenCalledTimes(1);

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = warn.mock.calls[0].find(
      (a: unknown) => typeof a === 'object' && a !== null
    ) as Record<string, unknown> | undefined;
    expect(meta).toMatchObject({ securityEvent: true, status: 200 });

    for (const spy of [info, warn, error, debug]) {
      for (const call of spy.mock.calls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain('Invalid query parameters');
        expect(text).not.toContain('Maintenance');
      }
    }

    // Not cached: the next good answer is fetched, not the refusal replayed.
    get.mockResolvedValue({ data: { features: [] }, status: 200 });
    await expect(service.queryFirePerimeters(-117, 43, -116, 44)).resolves.toEqual({ features: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('{ features: [] } resolves and the second call is a cache hit', async () => {
    const service = new NIFCService();
    const get = stubGet(service, { features: [] });
    await expect(service.queryFirePerimeters(-117, 43, -116, 44)).resolves.toEqual({ features: [] });
    await expect(service.queryFirePerimeters(-117, 43, -116, 44)).resolves.toEqual({ features: [] });
    expect(get).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the live empty shape resolves', async () => {
    const service = new NIFCService();
    const body = { objectIdFieldName: 'OBJECTID', features: [] };
    stubGet(service, body);
    await expect(service.queryFirePerimeters(-117, 43, -116, 44)).resolves.toEqual(body);
  });

  it('one feature with attributes resolves with that feature', async () => {
    const service = new NIFCService();
    const feature = { attributes: { IncidentName: 'Test Fire' } };
    stubGet(service, { features: [feature] });
    const result = await service.queryFirePerimeters(-117, 43, -116, 44);
    expect(result.features).toEqual([feature]);
  });
});
