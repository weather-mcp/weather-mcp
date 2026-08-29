/**
 * Shape lock for the three NWPS gauge-detail captures under tests/fixtures/.
 *
 * G48 (root cause of issue #84): every prior test for `### Flood Stages` and
 * `### Recent Historic Crests` fed the renderer a domain value NWPS has never
 * produced — flat-number categories, `{ value, date, description }` crests.
 * The suite was green and the mutation checks went red, but nothing in it
 * ever compared against a real response body, so it proved nothing about
 * production. This file closes that gap: it reads three gauges captured
 * verbatim (one request each, unmodified) and drives them straight through
 * `handleGetRiverConditions`, offline, with no live call of any kind — the
 * captures are the only contact this file ever has with NWPS.
 *
 * The three captures cover the observed classes:
 *   - PRTO3 (Willamette River at Portland): all four thresholds real, ~26
 *     recent crests.
 *   - DURO3 (Fanno Creek at Durham): action + minor real; moderate and major
 *     are the -9999 "not published" sentinel.
 *   - KCMO3 (Kellogg Creek near Milwaukie): all four thresholds sentinel —
 *     NOAA publishes no flood-stage thresholds for this gauge at all.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { handleGetRiverConditions } from '../../src/handlers/riverConditionsHandler.js';
import type { NWPSGauge, FloodCategories, HistoricCrest } from '../../src/types/noaa.js';

function loadGauge(lid: string): NWPSGauge {
  const text = readFileSync(new URL(`../fixtures/nwps-gauge-${lid}.json`, import.meta.url), 'utf8');
  const parsed = JSON.parse(text) as NWPSGauge;
  expect(parsed.lid).toBe(lid);
  return parsed;
}

const PRTO3 = loadGauge('PRTO3');
const DURO3 = loadGauge('DURO3');
const KCMO3 = loadGauge('KCMO3');

/**
 * Run the captured gauge straight through the public handler. The gauge's own
 * coordinates are used as the query point (distance 0), so the default 50 km
 * radius never filters it out and no `radius` override is needed.
 *
 * This reproduces the production split exactly: the bounding-box response is
 * served WITHOUT a `flood` object — which is the defect issue #84 is about, the
 * list endpoint has never carried one — and the capture's `flood` arrives only
 * from `getNWPSGauge`, the per-gauge detail endpoint. So these assertions cover
 * the fetch and the render together, over real bytes.
 */
async function renderCapture(gauge: NWPSGauge): Promise<string> {
  const { flood: _flood, ...bboxGauge } = gauge;
  const noaaService = {
    getNWPSGaugesInBoundingBox: vi.fn().mockResolvedValue([bboxGauge]),
    getNWPSGauge: vi.fn().mockResolvedValue(gauge)
  } as never;

  const result = await handleGetRiverConditions(
    { latitude: gauge.latitude, longitude: gauge.longitude },
    noaaService,
    {} as never,
    {} as never,
    {} as never
  );
  return (result.content[0] as { text: string }).text;
}

/** Count of rendered "**<Level>:**" threshold rows under `### Flood Stages`. */
function countThresholdRows(text: string): number {
  const levels = ['Action Stage', 'Minor Flood', 'Moderate Flood', 'Major Flood'];
  return levels.filter(label => text.includes(`**${label}:**`)).length;
}

describe('NWPS gauge capture shape lock — real bytes through the renderer', () => {
  it('PRTO3 (all four thresholds real) renders four threshold rows', async () => {
    const text = await renderCapture(PRTO3);

    expect(text).toContain('### Flood Stages');
    expect(text).toContain('**Action Stage:**');
    expect(text).toContain('**Minor Flood:**');
    expect(text).toContain('**Moderate Flood:**');
    expect(text).toContain('**Major Flood:**');
    expect(countThresholdRows(text)).toBe(4);
    expect(text).not.toContain('NOAA publishes no flood-stage thresholds');
  });

  it('DURO3 (action + minor real, moderate/major sentinel) renders exactly two threshold rows', async () => {
    const text = await renderCapture(DURO3);

    expect(text).toContain('### Flood Stages');
    expect(text).toContain('**Action Stage:**');
    expect(text).toContain('**Minor Flood:**');
    expect(text).not.toContain('**Moderate Flood:**');
    expect(text).not.toContain('**Major Flood:**');
    expect(countThresholdRows(text)).toBe(2);
    expect(text).not.toContain('NOAA publishes no flood-stage thresholds');
  });

  it('KCMO3 (all four thresholds sentinel) renders the no-thresholds line and zero threshold rows', async () => {
    const text = await renderCapture(KCMO3);

    expect(text).toContain('### Flood Stages');
    expect(text).toContain(
      '*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published ' +
        'thresholds, not an absence of flood risk — the **Flood Category:** line above comes from ' +
        "NOAA's own status.*"
    );
    expect(countThresholdRows(text)).toBe(0);
  });
});

describe('NWPS gauge capture shape lock — builder keys are a subset of the live shape', () => {
  const CAPTURED_GAUGES: ReadonlyArray<[string, NWPSGauge]> = [
    ['PRTO3', PRTO3],
    ['DURO3', DURO3],
    ['KCMO3', KCMO3]
  ];

  it.each(CAPTURED_GAUGES)(
    '%s: every flood-category level carries the "stage" key the builders emit',
    (_lid, gauge) => {
      const categories = gauge.flood?.categories as FloodCategories;
      expect(categories).toBeTruthy();
      for (const level of ['action', 'minor', 'moderate', 'major'] as const) {
        const entry = categories[level];
        expect(entry, `${_lid}.flood.categories.${level} missing entirely`).toBeTruthy();
        expect(
          Object.prototype.hasOwnProperty.call(entry, 'stage'),
          `${_lid}.flood.categories.${level} has no "stage" key`
        ).toBe(true);
      }
    }
  );

  it('PRTO3 recent crests carry the "stage" and "occurredTime" keys the builders emit', () => {
    const recent = PRTO3.flood?.crests?.recent as HistoricCrest[];
    expect(recent.length).toBeGreaterThan(0);
    for (const crest of recent) {
      expect(Object.prototype.hasOwnProperty.call(crest, 'stage'), 'crest missing "stage"').toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(crest, 'occurredTime'),
        'crest missing "occurredTime"'
      ).toBe(true);
    }
  });

  it('DURO3 recent crests carry the "stage" and "occurredTime" keys the builders emit', () => {
    const recent = DURO3.flood?.crests?.recent as HistoricCrest[];
    expect(recent.length).toBeGreaterThan(0);
    for (const crest of recent) {
      expect(Object.prototype.hasOwnProperty.call(crest, 'stage'), 'crest missing "stage"').toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(crest, 'occurredTime'),
        'crest missing "occurredTime"'
      ).toBe(true);
    }
  });
});

describe('NWPS gauge capture shape lock — the two shapes the old type asserted, and the wire never produces', () => {
  const CAPTURED_GAUGES: ReadonlyArray<[string, NWPSGauge]> = [
    ['PRTO3', PRTO3],
    ['DURO3', DURO3],
    ['KCMO3', KCMO3]
  ];

  it.each(CAPTURED_GAUGES)('%s: no crest (recent or historic) carries a "description" key', (_lid, gauge) => {
    const crests = gauge.flood?.crests;
    const all = [...(crests?.recent ?? []), ...(crests?.historic ?? [])];
    expect(all.length).toBeGreaterThan(0);
    for (const crest of all) {
      expect(Object.prototype.hasOwnProperty.call(crest, 'description')).toBe(false);
    }
  });

  it.each(CAPTURED_GAUGES)('%s: no flood-category level is a bare number', (_lid, gauge) => {
    const categories = gauge.flood?.categories as FloodCategories;
    for (const level of ['action', 'minor', 'moderate', 'major'] as const) {
      const entry = categories[level];
      expect(typeof entry).toBe('object');
      expect(entry).not.toBeNull();
    }
  });
});
