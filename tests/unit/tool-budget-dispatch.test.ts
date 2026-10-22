/**
 * The tool budget through the real dispatch (design plan `plan-tool-time-budget`, §1 and §3; G19).
 *
 * The whole chain, offline: a real in-process MCP `Client` over `InMemoryTransport`, the real
 * factory, every service's real `withRequestDeadline` wrapper. Only axios's default adapter is
 * replaced — by `hang`, which records when each request reached the network and never settles —
 * so every request times out on the deadline the wrapper computes. `withRequestDeadline()` with no
 * inner resolves `axios.defaults.adapter` on its first request and memoises it, so every client
 * built by the factory memoises the stub.
 *
 * The clock: the budget and the request spacer read `performance.now`, spied to the faked `Date`
 * clock, so it moves exactly with the faked timers — a request started mid-advance reads the time
 * its timer fired at, not the end of the tick. `tick` advances in small steps and drains the real
 * `setImmediate` queue between them, so work the transport defers there runs at the right time.
 *
 * What it proves: `get_weather_summary` and `get_alerts` — the two public paths that reach the
 * alerts contract — answer at the 55 000 ms budget instead of one deadline per request; no request
 * starts after the budget is spent; the summary names every section it could not fetch and never
 * renders an alerts all-clear; the client's own 60 s timer never fires; a single-request tool keeps
 * its own 30 000 ms timeout; a lightning section reached with the budget spent starts no broker
 * work; and an Indonesian alerts call whose refresh starts 29 s in, held open only by BMKG's 1 s
 * limiter, answers at the budget, not at its own 40 s refresh deadline (diff review codex-D1).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Pinned before the static imports below evaluate (GOTCHAS G61, G26), as in
// weather-server-factory.test.ts. API_TIMEOUT_MS fixes the arithmetic: a 30 000 ms request
// timeout and a 55 000 ms budget. 'all' enables get_lightning_activity for the summary section.
vi.hoisted(() => {
  process.env.ENABLED_TOOLS = 'all';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'tool-budget-dispatch-test';
  process.env.WEATHER_DEFAULT_LOCATION = '';
  process.env.API_TIMEOUT_MS = '30000';
});

import axios from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { createWeatherServer, clearServiceCaches } from '../../src/server/weatherServer.js';
import { LocationStore } from '../../src/services/locationStore.js';
import { toolBudgetMs } from '../../src/utils/toolBudget.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const US = { latitude: 42.9634, longitude: -85.6681 };
const TOKYO = { latitude: 35.6762, longitude: 139.6503 };
// Two Indonesian points: the Nominatim singleton's reverse-country cache outlives a test.
const JAKARTA = { latitude: -6.2088, longitude: 106.8456 };
const SURABAYA = { latitude: -7.2575, longitude: 112.7521 };
const ALL_CLEAR = '✅ **No active weather alerts';
const BUDGET = toolBudgetMs(30_000);

// The spied clock stays monotonic across tests: the Nominatim request spacer is per process and
// remembers its last start, so a clock that restarted at 0 would make it wait out the previous
// test's timeline. Each test measures from its own `start`. The faked `Date` is carried forward
// the same way, because the BMKG limiter reads `Date.now` and also remembers its last start.
let perfBase = 0;
let dateCarry = 0;
let dateBase = 0;
let start = 0;
let entries: number[] = [];
let originalAdapter: typeof axios.defaults.adapter;

/**
 * Answers a request a test chooses to answer, or `undefined` to leave it hanging. A variable
 * rather than a second adapter: each client memoises the adapter it saw first.
 */
let responder: ((config: InternalAxiosRequestConfig) => Promise<AxiosResponse> | undefined) | undefined;

/**
 * Records when a request reached the network. Unless `responder` answers it, it never settles and
 * never reads its signal.
 */
const hang: AxiosAdapter = (config) => {
  entries.push(performance.now() - start);
  return responder?.(config) ?? new Promise<AxiosResponse>(() => {});
};

/** A 200 answer `delayMs` after the request reached the network. */
function answer(config: InternalAxiosRequestConfig, data: unknown, delayMs = 0): Promise<AxiosResponse> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ data, status: 200, statusText: 'OK', headers: {}, config }), delayMs);
  });
}

const BMKG_DOCS = 50;
const bmkgDocUrl = (feed: string, i: number) => `https://www.bmkg.go.id/alerts/nowcast/doc/${feed}-${i}.xml`;

/**
 * The index for one test's feed. The National CAP singleton's document cache outlives a test, so
 * each test names its own documents; a shared set would let a later test read them from cache.
 */
function bmkgIndex(feed: string): string {
  const items = Array.from(
    { length: BMKG_DOCS },
    (_, i) => `<item><guid isPermaLink="false">${feed}-${i}</guid><link>${bmkgDocUrl(feed, i)}</link></item>`
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
    <expires>2099-01-01T00:00:00+00:00</expires>
    <headline>Test BMKG headline ${i}</headline>
    <area>
      <areaDesc>Test Area</areaDesc>
      <polygon>10,10 10,20 20,20 10,10</polygon>
    </area>
  </info>
</alert>`;
}

/**
 * codex-D1's sequence: the reverse-country lookup answers `id` after 29 s (inside its own 30 s
 * timeout), then BMKG serves a 50-document feed whose every request succeeds at once, so only the
 * feed's 1 s limiter holds the refresh open. Unclamped, the refresh's own 40 s deadline ends it at
 * 69 s.
 */
const indonesianFeed =
  (feed: string) =>
  (config: InternalAxiosRequestConfig): Promise<AxiosResponse> | undefined => {
    const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
    if (url.includes('nominatim') && url.includes('/reverse')) {
      return answer(config, { address: { country_code: 'id' } }, 29_000);
    }
    if (url === 'https://www.bmkg.go.id/alerts/nowcast/en') return answer(config, bmkgIndex(feed));
    const doc = /^https:\/\/www\.bmkg\.go\.id\/alerts\/nowcast\/doc\/[a-z]+-(\d+)\.xml$/.exec(url);
    if (doc) return answer(config, bmkgDoc(Number(doc[1])));
    return undefined;
  };

async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function tick(ms: number): Promise<void> {
  const step = 250;
  for (let done = 0; done < ms; done += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - done));
    await drain();
  }
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

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function textOf(result: unknown): string {
  return (result as ToolResult).content.map((c) => c.text).join('\n');
}

/** The block from `heading` up to the next `---` separator. */
function blockAfter(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start, `missing heading ${heading}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n---', start);
  return text.slice(start, end === -1 ? undefined : end);
}

describe('the tool budget through the dispatch', () => {
  let tempDir: string;
  let client: Client;

  beforeEach(async () => {
    entries = [];
    responder = undefined;
    // setImmediate stays real: the in-memory transport and the SDK defer work there.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    if (dateCarry > 0) {
      vi.setSystemTime(dateCarry);
    }
    dateBase = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => perfBase + (Date.now() - dateBase));
    originalAdapter = axios.defaults.adapter;
    axios.defaults.adapter = hang;
    clearServiceCaches();

    tempDir = mkdtempSync(join(tmpdir(), 'weather-mcp-budget-'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createWeatherServer({ locationStore: new LocationStore(join(tempDir, 'locations.json')) });
    await server.connect(serverTransport);
    client = new Client({ name: 'tool-budget-dispatch-test', version: '0.0.0' });
    await client.connect(clientTransport);
    await drain();
    start = performance.now();
  });

  afterEach(async () => {
    if (responder) {
      // A refresh cut short by its deadline leaves BMKG limiter sleeps queued on the National CAP
      // singleton. `useRealTimers` would discard those fake timers and leave the limiter's chain
      // pending forever, so the next test's first BMKG request would never start. Let them run.
      await tick(10_000);
    }
    // Well past the spacer's 1 s interval, so the next test's first lookup never waits.
    perfBase = performance.now() + 10_000;
    dateCarry = Date.now() + 10_000;
    await client.close();
    axios.defaults.adapter = originalAdapter;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock('mqtt');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('(a) get_weather_summary answers at the budget, naming every section it could not fetch', async () => {
    const state = track(
      client.callTool({ name: 'get_weather_summary', arguments: { ...US, include: ['current', 'forecast', 'alerts'] } })
    );

    await tick(BUDGET - 1);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();
    expect((state.value as ToolResult).isError).not.toBe(true);

    const text = textOf(state.value);
    for (const section of ['current', 'forecast', 'alerts']) {
      expect(blockAfter(text, `## ${section} (unavailable)`)).toContain('Could not retrieve');
    }
    expect(text).not.toContain(ALL_CLEAR);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const at of entries) {
      expect(at).toBeLessThan(BUDGET);
    }
  });

  it('(b) get_alerts answers at the budget with NOAA\'s timed-out message, never an all-clear', async () => {
    const state = track(client.callTool({ name: 'get_alerts', arguments: { ...US } }));

    await tick(BUDGET - 1);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();

    const result = state.value as ToolResult;
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('The NOAA weather service is temporarily unavailable. Please try again in a few minutes.');
    expect(text).not.toContain(ALL_CLEAR);
    for (const at of entries) {
      expect(at).toBeLessThan(BUDGET);
    }
  });

  it('(c) control: a single-request tool keeps its own 30 000 ms timeout', async () => {
    const state = track(client.callTool({ name: 'get_current_conditions', arguments: { ...TOKYO } }));

    await tick(29_999);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();
    expect((state.value as ToolResult).isError).toBe(true);
    expect(entries).toEqual([0]);
  });

  it("(d) the client's own request timer never fires", async () => {
    const summary = track(
      client.callTool({ name: 'get_weather_summary', arguments: { ...US, include: ['current', 'forecast', 'alerts'] } })
    );
    await tick(BUDGET);
    expect(summary.settled).toBe(true);
    expect(summary.error).toBeUndefined();

    const alerts = track(client.callTool({ name: 'get_alerts', arguments: { ...US } }));
    await tick(BUDGET);
    expect(alerts.settled).toBe(true);
    expect(alerts.error).toBeUndefined();

    // Recorded, not pinned: the services' housekeeping intervals.
    console.info(`[tool-budget-dispatch (d)] pending timers at the budget: ${vi.getTimerCount()}`);
  });

  it('(e) a lightning section reached with the budget spent starts no broker work', async () => {
    const connect = vi.fn();
    vi.doMock('mqtt', () => ({ default: { connect } }));

    const state = track(
      client.callTool({
        name: 'get_weather_summary',
        arguments: { ...US, include: ['current', 'forecast', 'alerts', 'lightning'] },
      })
    );

    await tick(BUDGET - 1);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();
    expect((state.value as ToolResult).isError).not.toBe(true);
    expect(connect).toHaveBeenCalledTimes(0);

    const lightning = blockAfter(textOf(state.value), '# ⚡ Lightning Activity Report');
    expect(lightning).toContain('**Live feed unavailable:**');
    expect(lightning).toContain('this is not an all-clear');
    expect(lightning).not.toContain('🟢');
  });

  it('(f) get_alerts for Indonesia after 29 s of earlier work answers at the budget, not at 69 s', async () => {
    responder = indonesianFeed('direct');
    const state = track(client.callTool({ name: 'get_alerts', arguments: { ...JAKARTA } }));

    await tick(BUDGET - 1);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();

    const text = textOf(state.value);
    expect(text).toContain('Weather Alerts — Indonesia');
    expect(text).toMatch(/alerts? in the BMKG feed could not be loaded/);
    expect(text).toContain('this is not an all-clear');
    expect(text).not.toContain('✅');
    for (const at of entries) {
      expect(at).toBeLessThan(BUDGET);
    }
  });

  it("(g) the summary's alerts section for Indonesia answers at the budget, not at 69 s", async () => {
    responder = indonesianFeed('summary');
    const state = track(
      client.callTool({ name: 'get_weather_summary', arguments: { ...SURABAYA, include: ['alerts'] } })
    );

    await tick(BUDGET - 1);
    expect(state.settled).toBe(false);
    await tick(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();
    expect((state.value as ToolResult).isError).not.toBe(true);

    const text = textOf(state.value);
    expect(text).toMatch(/alerts? in the BMKG feed could not be loaded/);
    expect(text).not.toContain('✅');
    for (const at of entries) {
      expect(at).toBeLessThan(BUDGET);
    }
  });
});
