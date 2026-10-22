/**
 * The tool budget at the National CAP refresh (diff review codex-D1).
 *
 * The refresh races its own 40 s deadline, and BMKG's limiter spaces request starts 1 s apart.
 * Both are plain timers that never pass the axios seam, so the refresh must clamp its deadline to
 * the tool call's remainder at entry. These rows drive the real service over a 50-document BMKG
 * feed whose every request succeeds at once, so only the limiter's spacing holds the refresh open.
 *
 * axios is mocked down to `default.create`, as in national-cap-service.test.ts, so the budget acts
 * here only through the refresh clamp, never through the request seam. The budget reads the same
 * faked `Date` clock as the limiter (`runWithToolBudget`'s injected `now`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: (...args: unknown[]) => mockGet(...args),
      interceptors: { response: { use: vi.fn() } }
    }))
  }
}));

import { NationalCapService, NATIONAL_CAP_FEEDS } from '../../src/services/nationalCap.js';
import { runWithToolBudget } from '../../src/utils/toolBudget.js';
import { logger } from '../../src/utils/logger.js';
import type { NationalCapResult } from '../../src/types/cap.js';

const FEED = NATIONAL_CAP_FEEDS.id;
const DOC_COUNT = 50;
const FUTURE = '2099-01-01T00:00:00+00:00';

function docUrl(i: number): string {
  return `https://www.bmkg.go.id/alerts/nowcast/doc/${i}.xml`;
}

function indexXml(): string {
  const items = Array.from(
    { length: DOC_COUNT },
    (_, i) => `<item><guid isPermaLink="false">doc-${i}</guid><link>${docUrl(i)}</link></item>`
  ).join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>BMKG</title>${items}</channel></rss>`;
}

function bmkgDoc(i: number): string {
  return `<?xml version="1.0" ?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>BMKG-${i}</identifier>
  <sender>cuaca.ekstrem@bmkg.go.id</sender>
  <sent>2026-08-23T00:00:00+07:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en</language>
    <event>Thunderstorm</event>
    <urgency>Immediate</urgency>
    <severity>Moderate</severity>
    <certainty>Observed</certainty>
    <expires>${FUTURE}</expires>
    <headline>Test BMKG headline ${i}</headline>
    <area>
      <areaDesc>Test Area</areaDesc>
      <polygon>10,10 10,20 20,20 10,10</polygon>
    </area>
  </info>
</alert>`;
}

/** Observe a promise's state without awaiting it. */
function track<T>(p: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  p.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    }
  );
  return state;
}

function indexCalls(): number {
  return mockGet.mock.calls.filter((c) => c[0] === FEED.indexUrl).length;
}

describe('the tool budget at the National CAP refresh', () => {
  let service: NationalCapService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'));
    mockGet.mockReset();
    mockGet.mockImplementation((url: string) => {
      if (url === FEED.indexUrl) return Promise.resolve({ data: indexXml(), status: 200 });
      const match = /\/doc\/(\d+)\.xml$/.exec(url);
      if (match) return Promise.resolve({ data: bmkgDoc(Number(match[1])), status: 200 });
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    service = new NationalCapService({ now: () => new Date(Date.now()), backoffJitter: () => 0.5 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Start a 55 s budget, spend `spentMs` of it on earlier work, then enter the refresh. */
  function refreshAfter(spentMs: number) {
    return track(
      runWithToolBudget(
        55_000,
        async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, spentMs));
          return service.getWarnings('id');
        },
        { now: () => Date.now() }
      )
    );
  }

  it('(a) a refresh entered at 30 s settles at the 55 s budget, not at 70 s, with the rest counted unavailable', async () => {
    const state = refreshAfter(30_000);

    await vi.advanceTimersByTimeAsync(54_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();

    const result = state.value as NationalCapResult;
    expect(result.unavailableCount).toBeGreaterThan(0);
    expect(result.warnings.length + result.unavailableCount).toBe(DOC_COUNT);
    // No request starts after the budget is spent.
    expect(mockGet.mock.calls.length).toBeLessThanOrEqual(26);
  });

  it('(b) a refresh cut short by the budget is not cached: the next call refreshes again', async () => {
    const first = refreshAfter(30_000);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(first.settled).toBe(true);
    expect(indexCalls()).toBe(1);

    const second = track(service.getWarnings('id'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(second.settled).toBe(true);
    expect(indexCalls()).toBe(2);
    // The documents the first refresh loaded came from the document cache, so the second
    // refresh, outside any budget, loads every one.
    const result = second.value as NationalCapResult;
    expect(result.unavailableCount).toBe(0);
    expect(result.warnings).toHaveLength(DOC_COUNT);
  });

  it('(c) control: with more than 40 s left, the refresh keeps its own 40 s deadline and caches the partial', async () => {
    const state = refreshAfter(5_000);

    await vi.advanceTimersByTimeAsync(44_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect((state.value as NationalCapResult).unavailableCount).toBeGreaterThan(0);

    const callsAfterFirst = mockGet.mock.calls.length;
    await service.getWarnings('id');
    expect(mockGet.mock.calls.length).toBe(callsAfterFirst);
  });

  it('(d) control: outside a tool call the refresh keeps its own 40 s deadline', async () => {
    const state = track(service.getWarnings('id'));

    await vi.advanceTimersByTimeAsync(39_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
  });
});
