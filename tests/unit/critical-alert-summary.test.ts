/**
 * The critical-alert banner in `get_weather_summary` — and above all, that it
 * renders **exactly once**.
 *
 * This is the task G19 exists for. The summary renders its `current` and
 * `forecast` sections through the same two handlers that now carry the
 * `criticalAlertBanner` flag, so threading the flag down to either of them would
 * put the banner in the response three times. Two facts already prevent that —
 * both sub-handler calls pass 6 arguments, and `subArgs` is spread from the
 * caller's `args` while the flag is a function parameter — but neither survives
 * a future edit unnoticed. Hence the occurrence **count** below rather than a
 * `toContain`, which cannot see a triple.
 *
 * Sub-handlers are mocked at the module seam, following
 * `tests/unit/weather-summary-handler.test.ts`. The banner module itself is
 * **not** mocked: it runs for real against a fake NOAA service, so the wiring
 * under test is the real wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const currentMock = vi.fn();
const forecastMock = vi.fn();
const alertsMock = vi.fn();

vi.mock('../../src/handlers/currentConditionsHandler.js', () => ({
  handleGetCurrentConditions: (...args: unknown[]) => currentMock(...args),
}));
vi.mock('../../src/handlers/forecastHandler.js', () => ({
  handleGetForecast: (...args: unknown[]) => forecastMock(...args),
}));
vi.mock('../../src/handlers/alertsHandler.js', () => ({
  handleGetAlerts: (...args: unknown[]) => alertsMock(...args),
}));

import { handleGetWeatherSummary } from '../../src/handlers/weatherSummaryHandler.js';
import { formatCriticalAlertBanner } from '../../src/utils/criticalAlert.js';

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

/** Grand Rapids, MI — inside the CONUS box, so the banner's US pre-filter passes. */
const US_ARGS = { latitude: 42.9634, longitude: -85.6681 };

/** Tokyo — outside every US box. */
const NON_US_ARGS = { latitude: 35.6762, longitude: 139.6503 };

const TORNADO_WARNING = {
  event: 'Tornado Warning',
  severity: 'Extreme',
  urgency: 'Immediate',
  certainty: 'Observed',
  response: 'Shelter',
  senderName: 'NWS Grand Rapids MI',
  expires: '2026-09-03T16:15:00-04:00',
};

const SEVERE_THUNDERSTORM_WARNING = {
  event: 'Severe Thunderstorm Warning',
  severity: 'Severe',
  urgency: 'Immediate',
  certainty: 'Observed',
  response: 'Shelter',
  senderName: 'NWS Grand Rapids MI',
  expires: '2026-09-03T15:45:00-04:00',
};

/** The banner's own first line — the construct to count, not the emoji (G62). */
const BANNER_FIRST_LINE = '🚨 **LIFE-THREATENING WEATHER ALERT IN EFFECT: Tornado Warning**';

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function noaaWithAlerts(...properties: Array<Record<string, unknown>>) {
  return {
    getAlerts: vi.fn().mockResolvedValue({
      type: 'FeatureCollection',
      features: properties.map((p) => ({ properties: p })),
    }),
  };
}

function callSummary(
  args: Record<string, unknown>,
  noaa: unknown,
  criticalAlertBanner?: boolean
) {
  return handleGetWeatherSummary(
    args,
    noaa as never,
    {} as never, // openMeteo — every section is mocked
    {} as never, // ncei
    {} as never, // locationStore — coordinate input never touches it
    {} as never, // geocoding
    undefined, // meteoAlarmService
    undefined, // geoMetService
    undefined, // nominatimService
    undefined, // googleWeatherService
    undefined, // nationalCapService
    undefined, // jmaService
    criticalAlertBanner
  );
}

describe('the critical-alert banner in get_weather_summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // The sub-handler mocks **honour the flag**, exactly as the real handlers
    // do: `handleGetCurrentConditions` takes it 9th and `handleGetForecast`
    // takes it 8th, and each prepends the banner when it is truthy. Without
    // this, threading the flag down would change nothing observable and the
    // occurrence count below would be unable to go red — the mock would be
    // hiding the very defect the count exists to catch (G70's shape: a seam
    // that cannot fail is not a lock).
    currentMock.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        textResult(`${args[8] ? `${BANNER_FIRST_LINE}\n\n` : ''}# Current Weather Conditions\nSunny`)
      )
    );
    forecastMock.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        textResult(`${args[7] ? `${BANNER_FIRST_LINE}\n\n` : ''}# Weather Forecast (Daily)\nWarm`)
      )
    );
    alertsMock.mockResolvedValue(textResult('# Weather Alerts\nNone'));
  });

  describe('exactly once — the whole point of this task', () => {
    it('renders the banner exactly once across current, forecast and alerts', async () => {
      // Counting, not `toContain`: a `toContain` passes on one occurrence and on
      // three alike, and three is the failure this test exists to catch.
      const result = await callSummary(
        { ...US_ARGS, include: ['current', 'forecast', 'alerts'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );
      const text = result.content[0].text;

      expect(occurrences(text, BANNER_FIRST_LINE)).toBe(1);
      expect(occurrences(text, 'Surface this to the user before answering anything else')).toBe(1);
    });

    it('does not thread the flag into handleGetCurrentConditions', async () => {
      // The direct pin on the mechanism, beside the count that pins the effect.
      // `handleGetCurrentConditions` takes the flag as its 9th parameter; the
      // summary must call it with 6 arguments and nothing more.
      await callSummary(
        { ...US_ARGS, include: ['current'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );

      expect(currentMock).toHaveBeenCalledTimes(1);
      const args = currentMock.mock.calls[0];
      expect(args).toHaveLength(6);
      expect(args[8]).toBeUndefined();
    });

    it('does not thread the flag into handleGetForecast', async () => {
      // `handleGetForecast` takes the flag as its 8th parameter.
      await callSummary(
        { ...US_ARGS, include: ['forecast'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );

      expect(forecastMock).toHaveBeenCalledTimes(1);
      const args = forecastMock.mock.calls[0];
      expect(args).toHaveLength(6);
      expect(args[7]).toBeUndefined();
    });

    it('does not leak the flag through the subArgs spread', async () => {
      // The second of the two facts that protect this: `subArgs` is spread from
      // the caller's `args`, and the flag is a function parameter rather than a
      // member of `args`. A future refactor moving it into `args` would break
      // this without breaking the two argument-count tests above.
      await callSummary(
        { ...US_ARGS, include: ['current'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );

      const subArgs = currentMock.mock.calls[0][0] as Record<string, unknown>;
      expect(subArgs).not.toHaveProperty('criticalAlertBanner');
    });

    it('counts a duplicate when one is genuinely present', async () => {
      // A counter that cannot count to two is not a lock. This drives the same
      // mock the leak would drive — a forecast section carrying its own banner —
      // and confirms the count reports 2, so the assertion of 1 above is a real
      // constraint rather than a tautology.
      forecastMock.mockResolvedValue(
        textResult(`${BANNER_FIRST_LINE}\n\n# Weather Forecast (Daily)\nWarm`)
      );

      const result = await callSummary(
        { ...US_ARGS, include: ['forecast'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );

      expect(occurrences(result.content[0].text, BANNER_FIRST_LINE)).toBe(2);
    });
  });

  describe('position', () => {
    it('puts the banner before the heading, which is before the location line', async () => {
      const result = await callSummary(
        { ...US_ARGS, include: ['current'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );
      const text = result.content[0].text;

      const banner = text.indexOf(BANNER_FIRST_LINE);
      const heading = text.indexOf('# Weather Summary');
      const location = text.indexOf('**Location:**');

      expect(banner).toBeGreaterThanOrEqual(0);
      expect(banner).toBeLessThan(heading);
      expect(heading).toBeLessThan(location);
    });

    it('starts the response with the banner', async () => {
      const result = await callSummary(
        { ...US_ARGS, include: ['current'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );
      expect(result.content[0].text.startsWith(BANNER_FIRST_LINE)).toBe(true);
    });
  });

  describe('the flag absent — byte-identity', () => {
    it('renders identically with the flag absent and with the flag false', async () => {
      const withoutFlag = await callSummary(
        { ...US_ARGS, include: ['current', 'forecast', 'alerts'] },
        noaaWithAlerts(TORNADO_WARNING)
      );
      const withFalse = await callSummary(
        { ...US_ARGS, include: ['current', 'forecast', 'alerts'] },
        noaaWithAlerts(TORNADO_WARNING),
        false
      );

      expect(withFalse.content[0].text).toBe(withoutFlag.content[0].text);
      expect(withoutFlag.content[0].text.startsWith('# Weather Summary')).toBe(true);
    });

    it('never calls getAlerts when the flag is absent', async () => {
      // The short-circuit is before the `await`, so the no-flag path gains no
      // latency at all.
      const noaa = noaaWithAlerts(TORNADO_WARNING);
      await callSummary({ ...US_ARGS, include: ['current'] }, noaa);
      expect(noaa.getAlerts).toHaveBeenCalledTimes(0);
    });
  });

  describe('G19 — drive it at an explicit detail level as well as at its default', () => {
    it('renders the same banner at the default detail and at detail "standard"', async () => {
      // `validateDetail(typedArgs.detail, 'summary')` makes the summary's
      // default `summary`, not `standard`, so a change gated on a detail branch
      // can be live on one path and invisible on the other. The banner must not
      // be gated on either.
      const atDefault = await callSummary(
        { ...US_ARGS, include: ['current'] },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );
      const atStandard = await callSummary(
        { ...US_ARGS, include: ['current'], detail: 'standard' },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );

      const bannerOf = (text: string) => text.slice(0, text.indexOf('# Weather Summary'));

      expect(bannerOf(atDefault.content[0].text)).toBe(
        formatCriticalAlertBanner(TORNADO_WARNING, 1, 'America/Detroit')
      );
      expect(bannerOf(atStandard.content[0].text)).toBe(
        bannerOf(atDefault.content[0].text)
      );
    });

    it('renders the banner at detail "summary" explicitly', async () => {
      const result = await callSummary(
        { ...US_ARGS, include: ['current'], detail: 'summary' },
        noaaWithAlerts(TORNADO_WARNING),
        true
      );
      expect(occurrences(result.content[0].text, BANNER_FIRST_LINE)).toBe(1);
    });
  });

  describe('the silent paths', () => {
    it('renders no banner when only a non-critical alert is active', async () => {
      const result = await callSummary(
        { ...US_ARGS, include: ['current'] },
        noaaWithAlerts(SEVERE_THUNDERSTORM_WARNING),
        true
      );
      const text = result.content[0].text;

      // G62: the construct, not the emoji.
      expect(text).not.toContain('LIFE-THREATENING WEATHER ALERT IN EFFECT');
      expect(text.startsWith('# Weather Summary')).toBe(true);
    });

    it('renders no banner for a non-US point and never calls getAlerts', async () => {
      const noaa = noaaWithAlerts(TORNADO_WARNING);
      const result = await callSummary(
        { ...NON_US_ARGS, include: ['current'] },
        noaa,
        true
      );

      expect(result.content[0].text).not.toContain('LIFE-THREATENING WEATHER ALERT IN EFFECT');
      expect(noaa.getAlerts).toHaveBeenCalledTimes(0);
    });

    it('renders a complete summary when the alerts lookup rejects', async () => {
      // The failure posture, seen from the summary: the sections the caller
      // actually asked for must all still be there.
      const noaa = { getAlerts: vi.fn().mockRejectedValue(new Error('NOAA API unavailable')) };

      const result = await callSummary(
        { ...US_ARGS, include: ['current', 'forecast'] },
        noaa,
        true
      );
      const text = result.content[0].text;

      expect(text).not.toContain('LIFE-THREATENING WEATHER ALERT IN EFFECT');
      expect(text.startsWith('# Weather Summary')).toBe(true);
      expect(text).toContain('# Current Weather Conditions');
      expect(text).toContain('# Weather Forecast (Daily)');
      expect(text).not.toContain('Could not');
    });
  });
});
