/**
 * Unit tests for the reconnect explanation in lightning reports
 * (plan-lightning-reconnect-coverage, T4): a window shortened by a feed reconnect is named as
 * such by get_lightning_activity and by get_weather_summary, a cold start and an outage keep
 * their own text, and the two limited-coverage explanations differ in exactly one line.
 *
 * Two describe blocks:
 *
 *   A. REAL BlitzortungService + REAL lightningHandler + REAL weatherSummaryHandler, all
 *      imported fresh under one `vi.resetModules()` so the handlers hold the fresh service
 *      singleton (G21), with `mqtt` replaced by a local fake client. Driven end to end so a
 *      mutation in the service or in the handler's wiring reaches a render contract (G45).
 *      The constructors' intervals land on a clock that is abandoned (G21 rule 3), so no prune
 *      tick ever fires; each test body turns fake timers on again and pins the system clock.
 *
 *   B. The pure formatter with hand-built fixtures: reconnectBounded true vs absent.
 *
 * The limited-coverage block is parsed out of the report before it is asserted (G96), and the
 * reconnect Why line is pinned whole (G65). Nothing here opens a socket.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatLightningActivityResponse } from '../../src/handlers/lightningHandler.js';
import type { LightningActivityResponse } from '../../src/types/lightning.js';

const T0 = Date.parse('2026-03-01T12:00:00.000Z');
const MINUTE = 60_000;
const POINT = { latitude: 40.7128, longitude: -74.006 };
const PARAMS = { ...POINT, radius: 100, timeWindow: 60 };

/** A fake `MqttClient` that connects on a microtask and replays events through `emit`. */
function createFakeMqttClient() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      if (event === 'connect') {
        queueMicrotask(() => cb());
      }
      return client;
    }),
    subscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    unsubscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    end: vi.fn((_force: boolean, _opts: unknown, cb: () => void) => cb()),
    emit(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach(h => h(...args));
    }
  };
  return client;
}

/**
 * Fresh service and handlers from one clean registry (G21). Importing blitzortung.js first, in
 * the same epoch, means the handler modules resolve the same fresh singleton.
 */
async function arrange() {
  const client = createFakeMqttClient();
  vi.doMock('mqtt', () => ({ default: { connect: vi.fn(() => client) } }));
  vi.useFakeTimers();
  vi.resetModules();
  try {
    await import('../../src/services/blitzortung.js');
    const lightning = await import('../../src/handlers/lightningHandler.js');
    const summary = await import('../../src/handlers/weatherSummaryHandler.js');
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    return { client, lightning, summary };
  } catch (error) {
    vi.useRealTimers();
    throw error;
  }
}

type Arranged = Awaited<ReturnType<typeof arrange>>;

/** Let a query's 10 s collection window finish and return what it resolved to. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(10_000);
  return promise;
}

/** Warm the area, then run a 2 min outage after 30 min. Returns the reconnect instant. */
async function healedOutage(a: Arranged): Promise<Date> {
  await settle(a.lightning.getLightningActivity(PARAMS));
  await vi.advanceTimersByTimeAsync(30 * MINUTE);
  a.client.emit('close');
  await vi.advanceTimersByTimeAsync(2 * MINUTE);
  const reconnectAt = new Date(Date.now());
  a.client.emit('connect');
  return reconnectAt;
}

async function toolText(promise: ReturnType<Arranged['lightning']['handleGetLightningActivity']>) {
  return (await settle(promise)).content[0].text;
}

function callTool(a: Arranged): ReturnType<Arranged['lightning']['handleGetLightningActivity']> {
  return a.lightning.handleGetLightningActivity(PARAMS, {} as never, {} as never);
}

function callSummary(a: Arranged): ReturnType<Arranged['summary']['handleGetWeatherSummary']> {
  return a.summary.handleGetWeatherSummary(
    { ...POINT, include: ['lightning'] },
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

async function summaryText(a: Arranged): Promise<string> {
  return (await settle(callSummary(a))).content[0].text;
}

function reconnectWhy(reconnectAt: Date): string {
  return (
    '*Why: the connection to the live Blitzortung.org lightning feed dropped and was ' +
    `re-established at ${reconnectAt.toISOString()}. Strikes during the gap were not received ` +
    'and cannot be backfilled, so coverage of this area restarts at the reconnect and builds ' +
    'over the following minutes.*'
  );
}

/** Parse the limited-coverage block (caveat line, blank, Why line) out of a report; throws if absent (G96). */
function limitedBlock(text: string): { caveat: string; why: string } {
  const match = /^(⚠️ \*\*Limited monitoring coverage:\*\*[^\n]*)\n\n(\*Why: [^\n]*\*)$/m.exec(text);
  if (match === null) {
    throw new Error('no limited-coverage block in the report');
  }
  return { caveat: match[1], why: match[2] };
}

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('mqtt');
  vi.restoreAllMocks();
});

describe('lightning reconnect render — real service through the handler and the summary', () => {
  it('C2: a reconnect inside the window renders the reconnect Why line, whole, with the reconnect time', async () => {
    const a = await arrange();
    const reconnectAt = await healedOutage(a);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);

    const result = await settle(a.lightning.getLightningActivity(PARAMS));
    expect(result.coverage.isComplete).toBe(false);
    expect(result.coverage.reconnectBounded).toBe(true);
    expect(result.coverage.monitoringSince?.getTime()).toBe(reconnectAt.getTime());
  });

  it('C2: get_lightning_activity text names the reconnect and nothing about a first lookup', async () => {
    const a = await arrange();
    const reconnectAt = await healedOutage(a);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);

    const text = await toolText(callTool(a));

    expect(text).toContain('## 🟢 Safety Status: SAFE (LIMITED DATA)');
    expect(text).toContain('**Monitoring Coverage:** 5.2 of 60 minutes ⚠️');
    const block = limitedBlock(text);
    expect(block.why).toBe(reconnectWhy(reconnectAt));
    expect(block.caveat).toContain(`(since ${reconnectAt.toISOString()})`);
    expect(block.caveat).toContain('Re-check in a few minutes');
    expect(text).not.toContain('only begins buffering');
    expect(text).not.toContain('first lookup');
    expect(text).not.toContain('Live feed unavailable');
  });

  it('C2: get_weather_summary renders the same reconnect block', async () => {
    const a = await arrange();
    const reconnectAt = await healedOutage(a);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);

    const text = await summaryText(a);

    expect(text).toContain('## 🟢 Safety Status: SAFE (LIMITED DATA)');
    expect(text).toContain('**Monitoring Coverage:** 5.2 of 60 minutes ⚠️');
    expect(limitedBlock(text).why).toBe(reconnectWhy(reconnectAt));
    expect(text).not.toContain('only begins buffering');
    expect(text).not.toContain('first lookup');
    expect(text).not.toContain('(unavailable)');
  });

  it('C3: an outage that ended before the window leaves a full-coverage report with no reconnect line', async () => {
    const a = await arrange();
    await healedOutage(a);
    await vi.advanceTimersByTimeAsync(61 * MINUTE);

    const text = await toolText(callTool(a));

    expect(text).not.toContain('LIMITED DATA');
    expect(text).not.toContain('Limited monitoring coverage');
    expect(text).not.toContain('re-established at');
    expect(text).not.toContain('only begins buffering');
    expect(text).toContain('**Monitoring Coverage:** 60.0 of 60 minutes');
  });

  it('C3: the same holds through get_weather_summary', async () => {
    const a = await arrange();
    await healedOutage(a);
    await vi.advanceTimersByTimeAsync(61 * MINUTE);

    const text = await summaryText(a);

    expect(text).not.toContain('LIMITED DATA');
    expect(text).not.toContain('Limited monitoring coverage');
    expect(text).not.toContain('re-established at');
  });

  it('C4: a first query with no loss renders the cold-start block and carries no reconnectBounded key', async () => {
    const a = await arrange();

    const result = await settle(a.lightning.getLightningActivity(PARAMS));
    expect('reconnectBounded' in result.coverage).toBe(false);

    const b = await arrange();
    const text = await toolText(callTool(b));
    const block = limitedBlock(text);
    expect(block.why.startsWith('*Why: lightning is monitored via a live feed that only begins buffering')).toBe(true);
    expect(block.why).toContain('first lookup starts near zero coverage');
    expect(block.caveat).toContain('Re-check in a few minutes');
    expect(text).not.toContain('re-established at');
    expect(text).not.toContain('dropped');
  });

  it('outage priority: a drop and reconnect inside the query keep the UNKNOWN block, with no reconnect line', async () => {
    const a = await arrange();
    await settle(a.lightning.getLightningActivity(PARAMS));
    await vi.advanceTimersByTimeAsync(30 * MINUTE);

    const query = a.lightning.getLightningActivity(PARAMS);
    await vi.advanceTimersByTimeAsync(1);
    a.client.emit('close');
    await vi.advanceTimersByTimeAsync(3_000);
    a.client.emit('connect');
    const result = await settle(query);
    // The reconnect bound is present and the feed still failed: the outage must win the render.
    expect(result.coverage.feedUnavailable).toBe(true);
    expect(result.coverage.reconnectBounded).toBe(true);

    const b = await arrange();
    await settle(b.lightning.getLightningActivity(PARAMS));
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    const toolQuery = callTool(b);
    await vi.advanceTimersByTimeAsync(1);
    b.client.emit('close');
    await vi.advanceTimersByTimeAsync(3_000);
    b.client.emit('connect');
    const text = await toolText(toolQuery);

    expect(text).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
    expect(text).toContain('Live feed unavailable');
    expect(text).not.toContain('re-established at');
    expect(text).not.toContain('Limited monitoring coverage');
  });
});

/** A formatter fixture: a limited, no-strike, non-outage window. */
function fixture(extra: { reconnectBounded?: boolean; monitoringSince?: Date | null }): LightningActivityResponse {
  const monitoringSince = extra.monitoringSince === undefined ? new Date('2026-03-01T12:32:00.000Z') : extra.monitoringSince;
  return {
    location: { latitude: 40.7128, longitude: -74.006 },
    searchRadius: 100,
    timeWindow: 60,
    searchPeriod: {
      start: new Date('2026-03-01T11:40:00.000Z'),
      end: new Date('2026-03-01T12:40:00.000Z')
    },
    strikes: [],
    statistics: {
      totalStrikes: 0,
      cloudToGroundStrikes: 0,
      intraCloudStrikes: 0,
      averageDistance: null,
      nearestDistance: null,
      strikesPerMinute: 0,
      densityPerSqKm: 0
    },
    safety: {
      level: 'safe',
      message: 'No lightning detected in the area',
      recommendations: ['Continue to monitor conditions.'],
      nearestStrikeDistance: null,
      nearestStrikeTime: null,
      isActiveThunderstorm: false
    },
    coverage: {
      monitoringSince,
      coverageMinutes: 8,
      isComplete: false,
      feedUnavailable: false,
      ...(extra.reconnectBounded === undefined ? {} : { reconnectBounded: extra.reconnectBounded })
    },
    source: 'Blitzortung.org',
    generatedAt: new Date('2026-03-01T12:40:00.000Z')
  };
}

describe('lightning reconnect render — formatter only', () => {
  const COLD_WHY =
    '*Why: lightning is monitored via a live feed that only begins buffering strikes once ' +
    'an area is first queried, so a location’s first lookup starts near zero coverage and ' +
    'builds over the following minutes. Saved locations are pre-warmed at startup. Historical ' +
    'strikes cannot be backfilled.*';

  it('the reconnect and cold-start texts differ in exactly one line, the Why line', () => {
    const reconnectAt = new Date('2026-03-01T12:32:00.000Z');
    const reconnectText = formatLightningActivityResponse(fixture({ reconnectBounded: true, monitoringSince: reconnectAt }));
    const coldText = formatLightningActivityResponse(fixture({ monitoringSince: reconnectAt }));

    // Parse the block out first so a neighbouring line cannot satisfy the assertion (G96).
    expect(limitedBlock(reconnectText).why).toBe(reconnectWhy(reconnectAt));
    expect(limitedBlock(coldText).why).toBe(COLD_WHY);

    const reconnectLines = reconnectText.split('\n');
    const coldLines = coldText.split('\n');
    expect(reconnectLines).toHaveLength(coldLines.length);
    const differing = reconnectLines
      .map((line, i) => (line === coldLines[i] ? -1 : i))
      .filter(i => i >= 0);
    expect(differing).toHaveLength(1);
    expect(reconnectLines[differing[0]]).toBe(reconnectWhy(reconnectAt));
    expect(coldLines[differing[0]]).toBe(COLD_WHY);
  });

  it('reconnectBounded false or true with no monitoring start reads as a cold start', () => {
    const coldText = formatLightningActivityResponse(fixture({}));
    expect(formatLightningActivityResponse(fixture({ reconnectBounded: false }))).toBe(coldText);
    expect(formatLightningActivityResponse(fixture({ reconnectBounded: true, monitoringSince: null }))).not.toContain(
      're-established at'
    );
  });

  it('an outage keeps its own Why line whatever reconnectBounded says', () => {
    const outage = fixture({ reconnectBounded: true });
    outage.coverage.feedUnavailable = true;
    const text = formatLightningActivityResponse(outage);
    expect(text).toContain('## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)');
    expect(text).not.toContain('re-established at');
  });
});
