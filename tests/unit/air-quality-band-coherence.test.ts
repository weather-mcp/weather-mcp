/**
 * Contract tests for T1 (src/handlers/airQualityHandler.ts): the AQI/UV
 * category printed beside a number must be keyed on the number *as
 * displayed* (`bandAqi`/`bandUv`), never on the raw upstream value, so the
 * two can never disagree. `bandAqi`/`bandUv` are module-private, so the
 * contract is proved at the rendered level by driving `handleGetAirQuality`
 * end to end against a stubbed `openMeteoService.getAirQuality` — offline
 * only, no network.
 *
 * Contract 1 (seam-window coherence, one `it` per scale, a loop rather than
 * `it.each` so the sweep does not inflate the published test count) and
 * Contract 3 (direction, measured) share the same sweep per scale to avoid
 * doubling the render count.
 *
 * Contract 2 pins ~12 verified seam/control rows across all six render
 * sites (primary AQI, secondary AQI reference, primary UV, per-day peak
 * AQI, six-hour period AQI). Every expected value below was derived by
 * running the band functions directly (see the report accompanying this
 * file) — never placed on an exact decimal half (G36).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAirQuality } from '../../src/handlers/airQualityHandler.js';
import { getUSAQICategory, getEuropeanAQICategory, getUVIndexCategory } from '../../src/utils/airQuality.js';
import type { OpenMeteoAirQualityResponse } from '../../src/types/openmeteo.js';

const getAirQualityMock = vi.fn();

const openMeteoService = { getAirQuality: getAirQualityMock } as never;
const locationStore = {} as never;
const geocodingService = {} as never;

// A point inside the contiguous US (shouldUseUSAQI -> true) and a point in
// Europe (shouldUseUSAQI -> false), matching src/utils/airQuality.ts.
const US_POINT = { latitude: 40, longitude: -100 };
const EU_POINT = { latitude: 50, longitude: 10 };

function callHandler(args: Record<string, unknown>) {
  return handleGetAirQuality(args, openMeteoService, locationStore, geocodingService);
}

/** Minimal current-only fixture (no forecast) with the given current fields. */
function currentOnlyResponse(current: Partial<OpenMeteoAirQualityResponse['current']>): OpenMeteoAirQualityResponse {
  return {
    latitude: 0,
    longitude: 0,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    elevation: 0,
    current_units: { time: 'iso8601', interval: 'seconds' },
    current: { time: '2026-07-16T11:00', interval: 3600, ...current },
    hourly_units: { time: 'iso8601' },
    hourly: { time: [] }
  } as unknown as OpenMeteoAirQualityResponse;
}

async function renderCurrent(point: { latitude: number; longitude: number }, current: Partial<OpenMeteoAirQualityResponse['current']>): Promise<string> {
  getAirQualityMock.mockResolvedValue(currentOnlyResponse(current));
  const result = await callHandler({ ...point, forecast: false });
  return result.content[0].text;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rank orders for the "direction" measurement (Contract 3)
// ---------------------------------------------------------------------------

const US_RANK = ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'];
const EU_RANK = ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor', 'Extremely Poor'];
const UV_RANK = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'];

const PRIMARY_AQI_RE = /## .*?Air Quality Index: (\d+)/;
const CATEGORY_RE = /\*\*Category:\*\* (.+)/;
const UV_INDEX_RE = /## .*?UV Index: (\d+\.\d)/;
const LEVEL_RE = /\*\*Level:\*\* (.+)/;

// ---------------------------------------------------------------------------
// Contracts 1 + 3: seam-window coherence and measured direction, per scale
// ---------------------------------------------------------------------------

describe('AQI/UV seam-window coherence (Contract 1) and direction (Contract 3)', () => {
  it('US AQI: the printed value determines the category at every ladder seam, and rounding never adds caution', async () => {
    const thresholds = [50, 100, 150, 200, 300];
    const printedToCategories = new Map<number, Set<string>>();
    let renders = 0;
    let parsed = 0;
    let moreCautious = 0;
    let lessCautious = 0;

    for (const t of thresholds) {
      for (let i = 0; i <= 400; i++) {
        const v = t - 1 + i / 200;
        renders++;
        const text = await renderCurrent(US_POINT, { us_aqi: v });

        const numMatch = text.match(PRIMARY_AQI_RE);
        const catMatch = text.match(CATEGORY_RE);
        expect(numMatch, `expected a primary AQI line for us_aqi=${v}`).not.toBeNull();
        expect(catMatch, `expected a Category line for us_aqi=${v}`).not.toBeNull();
        parsed++;

        const shown = Number(numMatch![1]);
        const truncatedCategory = catMatch![1];
        if (!printedToCategories.has(shown)) {
          printedToCategories.set(shown, new Set());
        }
        printedToCategories.get(shown)!.add(truncatedCategory);

        // Direction: compare the full (untruncated) new category — keyed on
        // the actually-rendered shown value — against the old rule applied
        // to the raw value.
        const newRank = US_RANK.indexOf(getUSAQICategory(shown).level);
        const oldRank = US_RANK.indexOf(getUSAQICategory(v).level);
        if (newRank > oldRank) moreCautious++;
        if (newRank < oldRank) lessCautious++;
      }
    }

    expect(parsed).toBe(renders);
    for (const [shown, categories] of printedToCategories) {
      expect(categories.size, `us_aqi printed ${shown} rendered more than one category: ${[...categories].join(', ')}`).toBe(1);
    }
    // The fix only ever rounds a raw value down onto a <= threshold — it
    // never manufactures extra caution.
    expect(moreCautious, 'US AQI: rounding must never add caution vs. the raw-banding rule').toBe(0);

    console.log(
      `[direction] US AQI over ${renders} samples (window t-1..t+1, step 1/200, t in ${JSON.stringify(thresholds)}): ` +
      `more_cautious=${moreCautious} less_cautious=${lessCautious}`
    );
  });

  it('European AQI: the printed value determines the category at every ladder seam, and rounding never adds caution', async () => {
    const thresholds = [20, 40, 60, 80, 100];
    const printedToCategories = new Map<number, Set<string>>();
    let renders = 0;
    let parsed = 0;
    let moreCautious = 0;
    let lessCautious = 0;

    for (const t of thresholds) {
      for (let i = 0; i <= 400; i++) {
        const v = t - 1 + i / 200;
        renders++;
        const text = await renderCurrent(EU_POINT, { european_aqi: v });

        const numMatch = text.match(PRIMARY_AQI_RE);
        const catMatch = text.match(CATEGORY_RE);
        expect(numMatch, `expected a primary AQI line for european_aqi=${v}`).not.toBeNull();
        expect(catMatch, `expected a Category line for european_aqi=${v}`).not.toBeNull();
        parsed++;

        const shown = Number(numMatch![1]);
        const truncatedCategory = catMatch![1];
        if (!printedToCategories.has(shown)) {
          printedToCategories.set(shown, new Set());
        }
        printedToCategories.get(shown)!.add(truncatedCategory);

        const newRank = EU_RANK.indexOf(getEuropeanAQICategory(shown).level);
        const oldRank = EU_RANK.indexOf(getEuropeanAQICategory(v).level);
        if (newRank > oldRank) moreCautious++;
        if (newRank < oldRank) lessCautious++;
      }
    }

    expect(parsed).toBe(renders);
    for (const [shown, categories] of printedToCategories) {
      expect(categories.size, `european_aqi printed ${shown} rendered more than one category: ${[...categories].join(', ')}`).toBe(1);
    }
    expect(moreCautious, 'European AQI: rounding must never add caution vs. the raw-banding rule').toBe(0);

    console.log(
      `[direction] European AQI over ${renders} samples (window t-1..t+1, step 1/200, t in ${JSON.stringify(thresholds)}): ` +
      `more_cautious=${moreCautious} less_cautious=${lessCautious}`
    );
  });

  it('UV Index: the printed value determines the level at every ladder seam, and rounding never removes caution', async () => {
    const thresholds = [3, 6, 8, 11];
    const printedToCategories = new Map<string, Set<string>>();
    let renders = 0;
    let parsed = 0;
    let moreCautious = 0;
    let lessCautious = 0;

    for (const t of thresholds) {
      for (let i = 0; i <= 4000; i++) {
        const v = t - 1 + i / 2000;
        renders++;
        const text = await renderCurrent(US_POINT, { uv_index: v });

        const numMatch = text.match(UV_INDEX_RE);
        const levelMatch = text.match(LEVEL_RE);
        expect(numMatch, `expected a UV Index line for uv_index=${v}`).not.toBeNull();
        expect(levelMatch, `expected a Level line for uv_index=${v}`).not.toBeNull();
        parsed++;

        const shownText = numMatch![1];
        const truncatedLevel = levelMatch![1];
        if (!printedToCategories.has(shownText)) {
          printedToCategories.set(shownText, new Set());
        }
        printedToCategories.get(shownText)!.add(truncatedLevel);

        const shown = Number(shownText);
        const newRank = UV_RANK.indexOf(getUVIndexCategory(shown).level);
        const oldRank = UV_RANK.indexOf(getUVIndexCategory(v).level);
        if (newRank > oldRank) moreCautious++;
        if (newRank < oldRank) lessCautious++;
      }
    }

    expect(parsed).toBe(renders);
    for (const [shown, categories] of printedToCategories) {
      expect(categories.size, `uv_index printed ${shown} rendered more than one level: ${[...categories].join(', ')}`).toBe(1);
    }
    // Rounding to the displayed tenth can only push a value up onto or past
    // a "<" threshold — it never quietly rounds away caution.
    expect(lessCautious, 'UV: rounding must never remove caution vs. the raw-banding rule').toBe(0);

    console.log(
      `[direction] UV over ${renders} samples (window t-1..t+1, step 1/2000, t in ${JSON.stringify(thresholds)}): ` +
      `more_cautious=${moreCautious} less_cautious=${lessCautious}`
    );
  });
});

// ---------------------------------------------------------------------------
// Contract 2: seam rows across all six render sites
// ---------------------------------------------------------------------------

interface SeamRow {
  label: string;
  render: () => Promise<string>;
  expectedText: string;
}

/** One day, one 6-hour period at a fixed peak value; the rest of the day at a low baseline. */
function forecastPeakResponse(peakValue: number): OpenMeteoAirQualityResponse {
  const time: string[] = [];
  const us_aqi: number[] = [];
  for (let h = 0; h < 24; h++) {
    time.push(`2026-07-16T${String(h).padStart(2, '0')}:00`);
    // Hours 12-17 ("12 PM - 5 PM") all carry the peak value so the period's
    // min and max coincide — the range renders as a single figure, not a
    // "min-max" span, keeping the assertion about one seam value only.
    us_aqi.push(h >= 12 && h <= 17 ? peakValue : 40);
  }
  return {
    latitude: 40,
    longitude: -100,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    elevation: 0,
    current_units: { time: 'iso8601', interval: 'seconds' },
    current: { time: '2026-07-16T00:00', interval: 3600, us_aqi: 40 },
    hourly_units: { time: 'iso8601' },
    hourly: { time, us_aqi }
  } as unknown as OpenMeteoAirQualityResponse;
}

/**
 * European-scale sibling of `forecastPeakResponse` — CDR-2 (diff-review codex).
 * `formatHourlyForecast` reads `hourly.european_aqi` when the point is outside
 * the US, so a US-only fixture can never exercise the EU forecast branch.
 */
function euForecastPeakResponse(peakValue: number): OpenMeteoAirQualityResponse {
  const time: string[] = [];
  const european_aqi: number[] = [];
  for (let h = 0; h < 24; h++) {
    time.push(`2026-07-16T${String(h).padStart(2, '0')}:00`);
    european_aqi.push(h >= 12 && h <= 17 ? peakValue : 20);
  }
  return {
    latitude: 50,
    longitude: 10,
    generationtime_ms: 0.1,
    utc_offset_seconds: 0,
    timezone: 'UTC',
    timezone_abbreviation: 'UTC',
    elevation: 0,
    current_units: { time: 'iso8601', interval: 'seconds' },
    current: { time: '2026-07-16T00:00', interval: 3600, european_aqi: 20 },
    hourly_units: { time: 'iso8601' },
    hourly: { time, european_aqi }
  } as unknown as OpenMeteoAirQualityResponse;
}

const seamRows: SeamRow[] = [
  {
    label: 'us_aqi 50.49 -> prints 50, Good (seam, was Moderate)',
    render: () => renderCurrent(US_POINT, { us_aqi: 50.49 }),
    expectedText: '## \u{1F7E2} US Air Quality Index: 50\n\n**Category:** Good'
  },
  {
    label: 'us_aqi 50.51 -> prints 51, Moderate (non-moving control)',
    render: () => renderCurrent(US_POINT, { us_aqi: 50.51 }),
    expectedText: '## \u{1F7E1} US Air Quality Index: 51\n\n**Category:** Moderate'
  },
  {
    label: 'us_aqi 150.4 -> prints 150, Unhealthy for Sensitive Groups (seam, was Unhealthy)',
    render: () => renderCurrent(US_POINT, { us_aqi: 150.4 }),
    expectedText: '## \u{1F7E0} US Air Quality Index: 150\n\n**Category:** Unhealthy for Sensitive Groups'
  },
  {
    label: 'european_aqi 20.51 -> prints 21, Fair (non-moving control)',
    render: () => renderCurrent(EU_POINT, { european_aqi: 20.51 }),
    expectedText: '## \u{1F7E2} European Air Quality Index: 21\n\n**Category:** Fair'
  },
  {
    label: 'european_aqi 60.4 -> prints 60, Moderate (seam, was Poor)',
    render: () => renderCurrent(EU_POINT, { european_aqi: 60.4 }),
    expectedText: '## \u{1F7E1} European Air Quality Index: 60\n\n**Category:** Moderate'
  },
  {
    label: 'uv_index 2.96 -> prints 3.0, Moderate',
    render: () => renderCurrent(US_POINT, { uv_index: 2.96 }),
    expectedText: '## \u{1F7E1} UV Index: 3.0\n\n**Level:** Moderate'
  },
  {
    label: 'uv_index 2.94 -> prints 2.9, Low',
    render: () => renderCurrent(US_POINT, { uv_index: 2.94 }),
    expectedText: '## \u{1F7E2} UV Index: 2.9\n\n**Level:** Low'
  },
  {
    label: 'uv_index 10.96 -> prints 11.0, Extreme',
    render: () => renderCurrent(US_POINT, { uv_index: 10.96 }),
    expectedText: '## \u{1F7E3} UV Index: 11.0\n\n**Level:** Extreme'
  },
  {
    label: 'secondary reference line: european_aqi 60.4 under a US primary -> *European AQI: 60 (Moderate)*',
    render: () => renderCurrent(US_POINT, { us_aqi: 10, european_aqi: 60.4 }),
    expectedText: '*European AQI: 60 (Moderate)*'
  },
  {
    label: 'per-day forecast header: peak US AQI 150.4 -> peak US AQI 150 (Unhealthy for Sensitive Groups)',
    render: async () => {
      getAirQualityMock.mockResolvedValue(forecastPeakResponse(150.4));
      const result = await callHandler({ ...US_POINT, forecast: true });
      return result.content[0].text;
    },
    expectedText: 'peak US AQI 150 (Unhealthy for Sensitive Groups)'
  },
  {
    label: 'six-hour period line: 12 PM - 5 PM at 150.4 -> US AQI 150 (Unhealthy for Sensitive Groups)',
    render: async () => {
      getAirQualityMock.mockResolvedValue(forecastPeakResponse(150.4));
      const result = await callHandler({ ...US_POINT, forecast: true });
      return result.content[0].text;
    },
    expectedText: '**12 PM – 5 PM:** US AQI 150 (Unhealthy for Sensitive Groups)'
  },
  // CDR-2 (diff-review codex): every row above drives the US-primary
  // direction, so the inverse secondary branch (airQualityHandler.ts:303-305,
  // European primary -> `*US AQI: N (...)*`) and the European-scale forecast
  // sites had no seam row at all — a raw-category mutant confined to either
  // stayed green. Expected strings produced by running the handler first (G36).
  {
    label: 'secondary reference line (inverse): us_aqi 150.4 under a European primary -> *US AQI: 150 (Unhealthy for Sensitive Groups)*',
    render: () => renderCurrent(EU_POINT, { european_aqi: 10, us_aqi: 150.4 }),
    expectedText: '*US AQI: 150 (Unhealthy for Sensitive Groups)*'
  },
  {
    label: 'secondary reference line (inverse): us_aqi 50.49 under a European primary -> *US AQI: 50 (Good)*',
    render: () => renderCurrent(EU_POINT, { european_aqi: 10, us_aqi: 50.49 }),
    expectedText: '*US AQI: 50 (Good)*'
  },
  {
    label: 'per-day forecast header, European scale: peak european_aqi 60.4 -> peak EU AQI 60 (Moderate)',
    render: async () => {
      getAirQualityMock.mockResolvedValue(euForecastPeakResponse(60.4));
      const result = await callHandler({ ...EU_POINT, forecast: true });
      return result.content[0].text;
    },
    expectedText: 'peak EU AQI 60 (Moderate)'
  },
  {
    label: 'six-hour period line, European scale: 12 PM - 5 PM at 60.4 -> EU AQI 60 (Moderate)',
    render: async () => {
      getAirQualityMock.mockResolvedValue(euForecastPeakResponse(60.4));
      const result = await callHandler({ ...EU_POINT, forecast: true });
      return result.content[0].text;
    },
    expectedText: '**12 PM – 5 PM:** EU AQI 60 (Moderate)'
  }
];

describe('AQI/UV seam rows across every render site (Contract 2)', () => {
  it.each(seamRows)('$label', async ({ render, expectedText }) => {
    const text = await render();
    expect(text).toContain(expectedText);
  });
});
