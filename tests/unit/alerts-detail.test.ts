/**
 * Unit tests for the get_alerts `detail` output control and location resolution.
 *
 * A minimal NOAAService stub returns one alert with a long description and
 * instruction so we can assert what each verbosity level includes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAlerts } from '../../src/handlers/alertsHandler.js';
import type { NOAAService } from '../../src/services/noaa.js';
import type { LocationStore } from '../../src/services/locationStore.js';
import type { GeocodingService } from '../../src/services/geocoding.js';

const DESCRIPTION = 'A very long National Weather Service description that is expensive to include.';
const INSTRUCTION = 'Move to higher ground immediately.';

function makeNoaaStub(): NOAAService {
  return {
    getStations: vi.fn(async () => ({ features: [] })),
    getAlerts: vi.fn(async () => ({
      updated: '2026-07-13T12:00:00Z',
      features: [
        {
          properties: {
            event: 'Flood Warning',
            severity: 'Severe',
            urgency: 'Immediate',
            certainty: 'Likely',
            headline: 'Flood Warning in effect',
            description: DESCRIPTION,
            areaDesc: 'Test County',
            effective: '2026-07-13T12:00:00Z',
            expires: '2026-07-13T18:00:00Z',
            response: 'Avoid',
            senderName: 'NWS',
            instruction: INSTRUCTION,
          },
        },
      ],
    })),
  } as unknown as NOAAService;
}

const store = {} as unknown as LocationStore;
const geocoding = {} as unknown as GeocodingService;

async function getAlertsText(args: Record<string, unknown>): Promise<string> {
  const result = await handleGetAlerts(args, makeNoaaStub(), store, geocoding);
  return result.content[0].text;
}

describe('get_alerts detail control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('standard (default) includes instructions but omits the full description', async () => {
    const text = await getAlertsText({ latitude: 40, longitude: -100 });
    expect(text).toContain('Flood Warning');
    expect(text).toContain(INSTRUCTION);
    expect(text).not.toContain(DESCRIPTION);
    expect(text).toContain('detail="full"');
  });

  it('summary omits both description and instructions', async () => {
    const text = await getAlertsText({ latitude: 40, longitude: -100, detail: 'summary' });
    expect(text).toContain('Flood Warning');
    expect(text).not.toContain(DESCRIPTION);
    expect(text).not.toContain(INSTRUCTION);
  });

  it('full includes the complete description and instructions', async () => {
    const text = await getAlertsText({ latitude: 40, longitude: -100, detail: 'full' });
    expect(text).toContain(DESCRIPTION);
    expect(text).toContain(INSTRUCTION);
    expect(text).not.toContain('detail="full"');
  });

  it('rejects an invalid detail level', async () => {
    await expect(
      getAlertsText({ latitude: 40, longitude: -100, detail: 'loud' })
    ).rejects.toThrow(/detail/i);
  });
});
