/**
 * Unit tests for RainViewer nowcast (forecast) frame handling
 * Drives the real RainViewerService with getRadarData stubbed.
 *
 * Live checks (2026-07-16) found `nowcast` empty and it may be absent
 * entirely — missing/empty nowcast must be treated as the normal case,
 * yielding exactly today's past-frames-only behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RainViewerService } from '../../src/services/rainviewer.js';
import { RainViewerFrame, RainViewerResponse } from '../../src/types/imagery.js';

const LATITUDE = 40.7128;
const LONGITUDE = -74.006;

const pastFrames: RainViewerFrame[] = [
  { time: 1699999000, path: '/v2/radar/1699999000' },
  { time: 1699999300, path: '/v2/radar/1699999300' },
  { time: 1699999600, path: '/v2/radar/1699999600' } // latest past frame
];

function buildResponse(
  radar: { past: RainViewerFrame[]; nowcast?: RainViewerFrame[] }
): RainViewerResponse {
  return {
    version: '2.0',
    generated: 1699999600,
    host: 'https://tilecache.rainviewer.com',
    radar
  };
}

describe('RainViewer nowcast handling', () => {
  let service: RainViewerService;

  beforeEach(() => {
    service = new RainViewerService();
  });

  it('animated + empty nowcast array returns only past frames (today\'s behavior)', async () => {
    vi.spyOn(service, 'getRadarData').mockResolvedValue(
      buildResponse({ past: pastFrames, nowcast: [] })
    );

    const frames = await service.getPrecipitationRadar(LATITUDE, LONGITUDE, true);

    expect(frames.length).toBe(pastFrames.length);
    frames.forEach((frame, i) => {
      expect(frame.timestamp.getTime()).toBe(pastFrames[i].time * 1000);
      expect(frame.description).toContain('Precipitation radar');
      expect(frame.description).not.toContain('forecast');
    });
  });

  it('animated + nowcast property absent returns only past frames', async () => {
    // Cast fixture: real-world responses have been observed missing the
    // `nowcast` key entirely, not just empty.
    const response = buildResponse({ past: pastFrames }) as RainViewerResponse;
    delete (response.radar as { nowcast?: RainViewerFrame[] }).nowcast;

    vi.spyOn(service, 'getRadarData').mockResolvedValue(response);

    const frames = await service.getPrecipitationRadar(LATITUDE, LONGITUDE, true);

    expect(frames.length).toBe(pastFrames.length);
    frames.forEach((frame, i) => {
      expect(frame.timestamp.getTime()).toBe(pastFrames[i].time * 1000);
      expect(frame.description).not.toContain('forecast');
    });
  });

  it('animated + 3 nowcast frames appends them after past frames, labeled as forecast, in order', async () => {
    const latestPastTime = pastFrames[pastFrames.length - 1].time;
    const nowcastFrames: RainViewerFrame[] = [
      { time: latestPastTime + 600, path: '/v2/radar/nowcast/1' }, // +10 min
      { time: latestPastTime + 1200, path: '/v2/radar/nowcast/2' }, // +20 min
      { time: latestPastTime + 1800, path: '/v2/radar/nowcast/3' } // +30 min
    ];

    vi.spyOn(service, 'getRadarData').mockResolvedValue(
      buildResponse({ past: pastFrames, nowcast: nowcastFrames })
    );

    const frames = await service.getPrecipitationRadar(LATITUDE, LONGITUDE, true);

    expect(frames.length).toBe(pastFrames.length + nowcastFrames.length);

    // Past frames first, in order, unlabeled as forecast
    for (let i = 0; i < pastFrames.length; i++) {
      expect(frames[i].timestamp.getTime()).toBe(pastFrames[i].time * 1000);
      expect(frames[i].description).not.toContain('forecast');
    }

    // Forecast frames follow, in order, labeled and after the last past frame
    const forecastOffsetMinutes = [10, 20, 30];
    for (let i = 0; i < nowcastFrames.length; i++) {
      const frame = frames[pastFrames.length + i];
      expect(frame.timestamp.getTime()).toBe(nowcastFrames[i].time * 1000);
      expect(frame.timestamp.getTime()).toBeGreaterThan(latestPastTime * 1000);
      expect(frame.description).toContain('forecast');
      expect(frame.description).toContain(`+${forecastOffsetMinutes[i]}`);
    }
  });

  it('non-animated + non-empty nowcast returns only the single latest PAST frame', async () => {
    const nowcastFrames: RainViewerFrame[] = [
      { time: pastFrames[pastFrames.length - 1].time + 600, path: '/v2/radar/nowcast/1' }
    ];

    vi.spyOn(service, 'getRadarData').mockResolvedValue(
      buildResponse({ past: pastFrames, nowcast: nowcastFrames })
    );

    const frames = await service.getPrecipitationRadar(LATITUDE, LONGITUDE, false);

    expect(frames.length).toBe(1);
    expect(frames[0].timestamp.getTime()).toBe(
      pastFrames[pastFrames.length - 1].time * 1000
    );
    expect(frames[0].description).not.toContain('forecast');
  });
});
