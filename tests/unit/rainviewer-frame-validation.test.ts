/**
 * Frame-validation contracts for RainViewerService.getRadarData.
 *
 * Every frame `path` is joined to the tile host and every `time` becomes a Date,
 * so one bad frame refuses the whole response. The stub sits on the instance
 * `client.get`, the seam getRadarData really calls (G70).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { RainViewerService, rainViewerService } from '../../src/services/rainviewer.js';
import { ServiceUnavailableError, formatErrorForUser } from '../../src/errors/ApiError.js';
import { logger } from '../../src/utils/logger.js';
import { handleGetWeatherImagery } from '../../src/handlers/weatherImageryHandler.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const LAT = 40.7128;
const LON = -74.006;
const FIXED_MESSAGE = 'RainViewer returned radar frames in an unexpected format';
const GOOD_PAST = { time: 1699999000, path: '/v2/radar/1699999000' };
const GOOD_NOWCAST = { time: 1700000600, path: '/v2/radar/nowcast_1-a' };

function feed(radar: Record<string, unknown>): unknown {
  return { version: '2.0', generated: 1699999600, host: 'https://tilecache.rainviewer.com', radar };
}

function stubClient(target: RainViewerService, data: unknown) {
  return vi
    .spyOn((target as unknown as { client: { get: (...a: unknown[]) => unknown } }).client, 'get')
    .mockResolvedValue({ data, status: 200 } as never);
}

async function expectRefused(promise: Promise<unknown>): Promise<ServiceUnavailableError> {
  const err = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(ServiceUnavailableError);
  const sue = err as ServiceUnavailableError;
  expect(sue.service).toBe('RainViewer');
  expect(sue.userMessage).toBe(FIXED_MESSAGE);
  expect(formatErrorForUser(sue)).toContain(`RainViewer API Error: ${FIXED_MESSAGE}`);
  return sue;
}

describe('RainViewer frame validation', () => {
  let service: RainViewerService;

  beforeEach(() => {
    service = new RainViewerService();
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. refused paths', () => {
    const refused: Array<[string, unknown]> = [
      ['authority injection', '@127.0.0.1:9443/probe'],
      ['@ in a segment', '/v2@evil'],
      ['backslash', '/v2/radar\\x'],
      ['percent escape', '/v2/radar/%2e%2e'],
      ['dot-dot segment', '/v2/../x'],
      ['dot in a segment', '/v2/radar/abc.png'],
      ['query', '/v2/radar?x=1'],
      ['fragment', '/v2/radar#x'],
      ['colon', '/v2/radar/:x'],
      ['empty string', ''],
      ['bare slash', '/'],
      ['no leading slash', 'v2/radar/x'],
      ['empty first segment', '//evil.example/x'],
      ['number', 42],
      ['null', null],
      ['129 characters', '/' + 'a'.repeat(128)]
    ];

    it.each(refused)('refuses %s', async (_label, path) => {
      const bad = { time: 1699999600, path };
      stubClient(service, feed({ past: [bad] }));
      await expectRefused(service.getRadarData());

      stubClient(service, feed({ past: [bad] }));
      await expectRefused(service.getPrecipitationRadar(LAT, LON, true));
    });

    it('the 129-character row is exactly 129 characters', () => {
      expect(('/' + 'a'.repeat(128)).length).toBe(129);
    });
  });

  describe('2. accepted paths', () => {
    const p128 = '/' + 'a'.repeat(127);
    const accepted = [
      '/v2/radar/4765b0905c71',
      '/v2/radar/1699999999',
      '/v3/radar/nowcast_1-a',
      p128
    ];

    it('the 128-character row is exactly 128 characters', () => {
      expect(p128.length).toBe(128);
    });

    it.each(accepted)('accepts %s and passes the frame to convertFrames unchanged', async (path) => {
      const frame = { time: 1699999600, path };
      stubClient(service, feed({ past: [frame] }));
      const convert = vi.spyOn(service, 'convertFrames');

      const result = await service.getPrecipitationRadar(LAT, LON, true);

      expect(result).toHaveLength(1);
      expect(convert).toHaveBeenCalledTimes(1);
      expect(convert.mock.calls[0][0]).toEqual([frame]);
      expect(result[0].url).toContain(`https://tilecache.rainviewer.com${path}/512/`);
    });
  });

  describe('3. refused times', () => {
    const badTimes: Array<[string, unknown]> = [
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a numeric string', '1700000000'],
      ['null', null],
      ['1e20', 1e20],
      ['just below -8.64e12', -8.64e12 - 1]
    ];

    it.each(badTimes)('refuses %s with ServiceUnavailableError, never RangeError', async (_l, time) => {
      const bad = { time, path: '/v2/radar/1699999600' };
      stubClient(service, feed({ past: [bad] }));
      const promise = service.getPrecipitationRadar(LAT, LON, true);
      await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableError);
      await expect(promise).rejects.not.toBeInstanceOf(RangeError);
      stubClient(service, feed({ past: [bad] }));
      await expectRefused(service.getRadarData());
    });

    it('accepts 8.64e12 itself', async () => {
      stubClient(service, feed({ past: [{ time: 8.64e12, path: '/v2/radar/1' }] }));
      const frames = await service.getPrecipitationRadar(LAT, LON, true);
      expect(frames).toHaveLength(1);
      expect(frames[0].timestamp.getTime()).toBe(8.64e15);
    });

    it('accepts -8.64e12 itself', async () => {
      stubClient(service, feed({ past: [{ time: -8.64e12, path: '/v2/radar/1' }] }));
      await expect(service.getRadarData()).resolves.toBeDefined();
    });
  });

  describe('4. whole-response refusal', () => {
    it('refuses when the newest past frame is bad and older ones are good', async () => {
      stubClient(
        service,
        feed({ past: [GOOD_PAST, { time: 1699999300, path: '/v2/radar/1699999300' }, { time: NaN, path: '/v2/radar/x' }] })
      );
      await expectRefused(service.getPrecipitationRadar(LAT, LON, false));
    });

    it('refuses when a nowcast frame is bad and past is all good', async () => {
      stubClient(service, feed({ past: [GOOD_PAST], nowcast: [{ time: 1700000600, path: '@127.0.0.1:9443/x' }] }));
      await expectRefused(service.getRadarData());
    });

    it('accepts good past and good nowcast together', async () => {
      stubClient(service, feed({ past: [GOOD_PAST], nowcast: [GOOD_NOWCAST] }));
      const frames = await service.getPrecipitationRadar(LAT, LON, true);
      expect(frames).toHaveLength(2);
    });
  });

  describe('5. shape', () => {
    it('refuses past: {}', async () => {
      stubClient(service, feed({ past: {} }));
      await expectRefused(service.getRadarData());
    });

    it('refuses past: [null]', async () => {
      stubClient(service, feed({ past: [null] }));
      await expectRefused(service.getRadarData());
    });

    it('refuses a non-array nowcast', async () => {
      stubClient(service, feed({ past: [GOOD_PAST], nowcast: 'x' }));
      await expectRefused(service.getRadarData());
    });

    it('resolves to [] when past is absent', async () => {
      stubClient(service, feed({}));
      await expect(service.getPrecipitationRadar(LAT, LON, true)).resolves.toEqual([]);
    });
  });

  describe('6. no leak', () => {
    it('keeps the hostile path out of every log argument and the error text', async () => {
      stubClient(service, feed({ past: [{ time: 1699999600, path: '@127.0.0.1:9443/probe' }] }));

      const err = await expectRefused(service.getRadarData());

      for (const text of [err.message, err.userMessage, formatErrorForUser(err)]) {
        expect(text).not.toContain('127.0.0.1');
        expect(text).not.toContain('@');
      }
      const calls = [
        ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
        ...(logger.debug as ReturnType<typeof vi.fn>).mock.calls
      ];
      const serialised = JSON.stringify(calls);
      expect(serialised).not.toContain('127.0.0.1');
      expect(serialised).not.toContain('@');

      const secWarns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => (c[1] as { securityEvent?: boolean } | undefined)?.securityEvent === true
      );
      expect(secWarns).toHaveLength(1);
      expect(typeof (secWarns[0][1] as { invalidFrames: unknown }).invalidFrames).toBe('number');
      expect((secWarns[0][1] as { invalidFrames: number }).invalidFrames).toBe(1);
    });
  });

  describe('7. handler level', () => {
    it('refuses before any tile request and leaks no URL', async () => {
      stubClient(
        rainViewerService,
        feed({ past: [{ time: 1699999600, path: '@127.0.0.1:9443/probe' }] })
      );
      const axiosGet = vi.spyOn(axios, 'get');
      const locationStore = {} as unknown as LocationStore;
      const geocodingService = {} as unknown as GeocodingService;

      const err = await handleGetWeatherImagery(
        { latitude: LAT, longitude: LON, composite: true, detail: 'full' },
        locationStore,
        geocodingService
      ).then(
        () => {
          throw new Error('expected rejection');
        },
        (e: unknown) => e
      );

      expect(err).toBeInstanceOf(ServiceUnavailableError);
      expect((err as ServiceUnavailableError).userMessage).toBe(FIXED_MESSAGE);
      expect(formatErrorForUser(err as Error)).not.toContain('127.0.0.1');
      expect((err as Error).message).not.toContain('127.0.0.1');
      expect(axiosGet).toHaveBeenCalledTimes(0);
    });
  });

  describe('8. pinned-prefix control', () => {
    it.each(['/radar/x', '/v3/radar/x'])('accepts %s', async (path) => {
      stubClient(service, feed({ past: [{ time: 1699999600, path }] }));
      const frames = await service.getPrecipitationRadar(LAT, LON, true);
      expect(frames).toHaveLength(1);
    });
  });
});
