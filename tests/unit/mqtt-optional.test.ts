/**
 * Unit tests for the optional `mqtt` dependency resolution in
 * src/services/blitzortung.ts (see T1, commit 7101a5f).
 *
 * `mqtt` lives in `optionalDependencies` so an installer can drop it with
 * `--omit=optional`. These tests prove the module-level resolution memo
 * (`mqttModule` / `mqttLoadPromise`) behaves correctly whether the package is
 * absent, present, or fails to load for an unrelated reason — without ever
 * reaching a real MQTT broker or the real `mqtt` package.
 *
 * Mechanism: `vi.mock('mqtt', ...)` cannot express "absent". Each case uses
 * `vi.doMock('mqtt', factory)` + `vi.resetModules()` + a fresh dynamic
 * `import('../../src/services/blitzortung.js')`, so the module-level memo
 * starts undefined every time (precedent: tests/unit/tool-config.test.ts:31-34,
 * the repo's only other resetModules + dynamic re-import pattern).
 *
 * TWO non-obvious wrinkles found empirically while writing this file (see the
 * "Surprises" note handed back with this change — not reproduced in full
 * here, just the mechanics needed to read the helpers below):
 *
 * 1. `vi.resetModules()` + re-import gives every class a FRESH identity per
 *    epoch (blitzortung.ts's own `import { MqttUnavailableError } from
 *    '../errors/ApiError.js'` resolves to a different class object each
 *    time). A `MqttUnavailableError` imported once at the top of this file
 *    will never satisfy `instanceof` against an error thrown by a freshly
 *    re-imported service. `importFreshBlitzortung()` below re-imports
 *    ApiError.js in the SAME epoch and returns that class instead.
 *
 * 2. When a `vi.doMock` factory throws or rejects, Vitest's own mocker
 *    (`ManualMockedModule.resolve` in @vitest/mocker) wraps whatever we threw
 *    in a brand-new `Error` (message: "[vitest] There was an error when
 *    mocking a module...", the well-known "you referenced a top-level
 *    variable" warning — which fires here even though nothing is hoisted)
 *    and sets `.cause` to our original error, WITHOUT copying `.code`. Since
 *    `loadMqtt()`'s classification reads `error?.code` on the top-level
 *    object, a thrown `ERR_MODULE_NOT_FOUND` error is silently reclassified
 *    as a generic failure by the time it reaches source — the "absent
 *    module" branch is unreachable through a throwing/rejecting `vi.doMock`
 *    factory in this Vitest version. `installErrorCodeCauseBridge()` below
 *    is a narrowly-scoped `Error.prototype.code` getter that falls back to
 *    `this.cause?.code`, restoring the classification `loadMqtt()` needs
 *    without touching source. It is a getter only (no setter): every
 *    "absent" error object below is fully constructed — including its
 *    `.code` assignment — BEFORE the bridge installs, so nothing ever
 *    assigns `.code` while the accessor is in effect.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

/** An import failure shaped like Node's real "package not found" error. */
function notFoundError(message = "Cannot find package 'mqtt'"): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = 'ERR_MODULE_NOT_FOUND';
  return error;
}

/**
 * See wrinkle 2 in the file header. Bridges `Error.prototype.code` to
 * `this.cause?.code` for the duration of one test, so a `vi.doMock`-wrapped
 * rejection still classifies correctly in `loadMqtt()`. Getter-only —
 * callers must build their error (and set its own `.code`) before installing
 * this, never after.
 */
function installErrorCodeCauseBridge(): () => void {
  const original = Object.getOwnPropertyDescriptor(Error.prototype, 'code');
  Object.defineProperty(Error.prototype, 'code', {
    configurable: true,
    get(this: Error & { cause?: unknown }) {
      const cause = this.cause as { code?: unknown } | undefined;
      return cause?.code;
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(Error.prototype, 'code', original);
    } else {
      delete (Error.prototype as unknown as Record<string, unknown>).code;
    }
  };
}

/** A minimal fake `MqttClient` — enough for ensureConnected's `connect`/subscribe wiring. */
function createFakeMqttClient() {
  const client = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'connect') {
        // Resolve asynchronously (mirrors a real broker handshake) but without
        // any timer, so it works identically under fake or real clocks.
        queueMicrotask(() => cb());
      }
      return client;
    }),
    subscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    unsubscribe: vi.fn((_topics: string[], cb: (error: Error | null) => void) => cb(null)),
    end: vi.fn((_force: boolean, _opts: unknown, cb: () => void) => cb()),
  };
  return client;
}

/** A present `mqtt` module stub whose `connect()` returns the fake client above. */
function createPresentMqttModule() {
  const client = createFakeMqttClient();
  const connect = vi.fn(() => client);
  return { esModule: { default: { connect } }, client, connect };
}

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Re-import blitzortung.js (and the logger / ApiError singletons it uses)
 * from a clean module registry so the module-level mqtt memo starts
 * `undefined`, and so `MqttUnavailableError` is the SAME-epoch class (see
 * wrinkle 1 above).
 *
 * Timer trap: `vi.resetModules()` + re-import re-executes the module body,
 * whose last line is `export const blitzortungService = new
 * BlitzortungService()`. That constructor starts TWO `setInterval`s with no
 * `.unref()` (5-min buffer cleanup, 15-min subscription pruning). This file
 * is the first in the repo to construct the real `BlitzortungService` more
 * than once, so every fresh import leaves a live real timer behind unless
 * handled. Wrapping the import in `vi.useFakeTimers()` routes both
 * `setInterval` calls onto the fake clock — inert, and abandoned (not
 * converted to real timers) the moment `vi.useRealTimers()` runs immediately
 * afterward. Tests then run under real timers, so contract 6 can race a
 * genuine `setTimeout`.
 */
async function importFreshBlitzortung() {
  vi.useFakeTimers();
  vi.resetModules();
  try {
    const blitzortungModule = await import('../../src/services/blitzortung.js');
    // Imported *after* blitzortung.js within the same reset epoch, so these
    // resolve to the exact same cached module instances blitzortung.js's own
    // imports already loaded — required for vi.spyOn(logger, ...) and
    // instanceof checks below to observe/match correctly.
    const loggerModule = await import('../../src/utils/logger.js');
    const errorsModule = await import('../../src/errors/ApiError.js');
    return {
      ...blitzortungModule,
      logger: loggerModule.logger,
      MqttUnavailableError: errorsModule.MqttUnavailableError,
      MqttLoadFailedError: errorsModule.MqttLoadFailedError,
      MQTT_UNAVAILABLE_MESSAGE: errorsModule.MQTT_UNAVAILABLE_MESSAGE,
      MQTT_LOAD_FAILED_MESSAGE: errorsModule.MQTT_LOAD_FAILED_MESSAGE,
    };
  } finally {
    vi.useRealTimers();
  }
}

describe('optional mqtt dependency resolution (blitzortung.ts)', () => {
  afterEach(() => {
    vi.doUnmock('mqtt');
    vi.restoreAllMocks();
  });

  it('contract 1: getLightningStrikes throws MqttUnavailableError when mqtt is absent, and never resolves to []', async () => {
    const missing = notFoundError();
    const uninstall = installErrorCodeCauseBridge();
    try {
      vi.doMock('mqtt', () => {
        throw missing;
      });
      const { blitzortungService, MqttUnavailableError } = await importFreshBlitzortung();

      await expect(
        blitzortungService.getLightningStrikes(40.0, -74.0, 100, 60)
      ).rejects.toBeInstanceOf(MqttUnavailableError);
    } finally {
      uninstall();
    }
  });

  it("contract 2: prewarmLocation resolves without throwing when mqtt is absent, logging nothing beyond the loader's single warn", async () => {
    const missing = notFoundError();
    const uninstall = installErrorCodeCauseBridge();
    try {
      vi.doMock('mqtt', () => {
        throw missing;
      });
      const { blitzortungService, logger } = await importFreshBlitzortung();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      await expect(blitzortungService.prewarmLocation(40.0, -74.0, 100)).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toMatchObject({ package: 'mqtt', tool: 'get_lightning_activity' });
    } finally {
      uninstall();
    }
  });

  it('contract 3a: resolves the absent module at most once across several sequential calls', async () => {
    const missing = notFoundError();
    const uninstall = installErrorCodeCauseBridge();
    try {
      const factory = vi.fn(() => {
        throw missing;
      });
      vi.doMock('mqtt', factory);
      const { blitzortungService, logger, MqttUnavailableError } = await importFreshBlitzortung();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      await expect(blitzortungService.getLightningStrikes(10, 10)).rejects.toBeInstanceOf(MqttUnavailableError);
      await expect(blitzortungService.prewarmLocation(20, 20)).resolves.toBeUndefined();
      await expect(blitzortungService.getLightningStrikes(30, 30)).rejects.toBeInstanceOf(MqttUnavailableError);
      await expect(blitzortungService.prewarmLocation(40, 40)).resolves.toBeUndefined();

      expect(factory).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
    }
  });

  it('contract 3b: exactly one import and one warn across prewarmLocation calls started concurrently, racing the same absent-module resolution', async () => {
    // Sequential (fully-awaited) calls are not sufficient to exercise the
    // single-flight guard: by the second call the memo is already `null` and
    // every caller short-circuits before ever touching mqttLoadPromise. This
    // starts several calls without awaiting between them — the shape
    // src/index.ts:967-969 actually ships (a non-awaiting `void
    // prewarmLocation(...)` loop over saved locations) — and holds the
    // mocked import open behind a deferred rejection so all of them are
    // guaranteed to observe the in-flight import before it settles.
    const missing = notFoundError();
    const gate = createDeferred<void>();
    const uninstall = installErrorCodeCauseBridge();
    try {
      const factory = vi.fn(async () => {
        await gate.promise;
        throw missing;
      });
      vi.doMock('mqtt', factory);
      const { blitzortungService, logger } = await importFreshBlitzortung();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const call1 = blitzortungService.prewarmLocation(10, 10, 100);
      const call2 = blitzortungService.prewarmLocation(20, 20, 100);
      const call3 = blitzortungService.prewarmLocation(30, 30, 100);

      // Give every caller a chance to reach loadMqtt() and observe the
      // in-flight promise before we release the gate.
      await Promise.resolve();
      await Promise.resolve();

      gate.resolve();
      await Promise.all([call1, call2, call3]);

      expect(factory).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
    }
  });

  it('contract 4: a non-ERR_MODULE_NOT_FOUND import failure is not reported as "not installed" and is not memoised (retried on the next call)', async () => {
    // Deliberately NO error-code bridge here: this case wants the opposite
    // classification outcome from contracts 1-3/6, and a plain Error with no
    // `.code` already produces that (bridged or not — the bridge only ever
    // ADDS a `.code` by reading `.cause`, so its absence here is inert, not
    // load-bearing to this test).
    const genericError = new Error('unexpected parse failure while loading mqtt');
    const { esModule: presentModule, connect } = createPresentMqttModule();
    let attempts = 0;
    const factory = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        throw genericError;
      }
      return presentModule;
    });
    vi.doMock('mqtt', factory);
    const { blitzortungService, logger } = await importFreshBlitzortung();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    // First call: a generic failure is a load failure, not an "absence".
    // prewarmLocation swallows it exactly as it swallows an absence, so startup
    // is never blocked and nothing is said per saved location — the loader's
    // single line is the whole of it. Note: Vitest wraps whatever the mock
    // factory throws (see file header, wrinkle 2), which is why nothing here
    // asserts on genericError.message verbatim.
    await expect(blitzortungService.prewarmLocation(1, 1, 100)).resolves.toBeUndefined();
    expect(attempts).toBe(1);

    // The distinguishing assertion: the loader's fixed "not installed"
    // classification line never fired, because this failure is not an absence.
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes('is not installed'))
    ).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('failed to load');

    // Second call: because a non-ERR_MODULE_NOT_FOUND failure leaves the memo
    // `undefined` (never set to `null`), this retries the import rather than
    // replaying a cached failure — and this time it succeeds, reaching connect().
    await expect(blitzortungService.prewarmLocation(2, 2, 100)).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('contract 5: with a present module, prewarmLocation reaches connect() on the stub and never throws MqttUnavailableError', async () => {
    const { esModule: presentModule, connect } = createPresentMqttModule();
    vi.doMock('mqtt', () => presentModule);
    const { blitzortungService } = await importFreshBlitzortung();

    await expect(blitzortungService.prewarmLocation(51.5, -0.12, 100)).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('contract 6: a failed resolution does not strand isConnecting, and a second call rejects rather than hanging', async () => {
    const missing = notFoundError();
    const uninstall = installErrorCodeCauseBridge();
    try {
      vi.doMock('mqtt', () => {
        throw missing;
      });
      const { blitzortungService, MqttUnavailableError } = await importFreshBlitzortung();

      await expect(
        blitzortungService.getLightningStrikes(5, 5, 100, 60)
      ).rejects.toBeInstanceOf(MqttUnavailableError);

      // Invariant from the source comment on ensureConnected: `isConnecting`
      // is false on every path out of the method that did not connect.
      // Reading the private field directly is deliberate here — this is the
      // exact flag whose stranding causes the endless setInterval poll
      // described in the GOTCHA.
      expect((blitzortungService as unknown as { isConnecting: boolean }).isConnecting).toBe(false);

      // Real timeout, not a fake one: a regression that strands isConnecting
      // would make this second call hang forever in ensureConnected's
      // "someone else is connecting" poll, and this assertion — not an
      // unfinished process — is what must catch it.
      const HANG_TIMEOUT_MS = 500;
      const timeout = new Promise<'timed-out'>((resolve) => {
        setTimeout(() => resolve('timed-out'), HANG_TIMEOUT_MS);
      });
      const secondAttempt = blitzortungService
        .getLightningStrikes(5, 5, 100, 60)
        .then(() => 'resolved' as const)
        .catch((error: unknown) => (error instanceof MqttUnavailableError ? 'rejected' : 'other-error'));

      const outcome = await Promise.race([secondAttempt, timeout]);
      expect(outcome).toBe('rejected');
    } finally {
      uninstall();
    }
  });

  it('contract 8: concurrent callers open exactly ONE broker connection when mqtt is present', async () => {
    // REGRESSION LOCK, not a feature test.
    //
    // `ensureConnected` guards against concurrent connection attempts with a
    // plain `isConnecting` boolean, and that guard is only sound because the
    // flag is assigned in the same synchronous run as the check that reads it.
    // Any `await` introduced between those two statements lets every concurrent
    // caller past the guard: each sets the flag, each calls `connect()`, and
    // every client but the last is orphaned while still connected and still
    // holding a `message` handler.
    //
    // This shipped briefly. Resolving the optional module with
    // `await loadMqtt()` inside `ensureConnected` put an await in exactly that
    // window, and startup — which fires `void prewarmLocation(...)` per saved
    // location without awaiting (src/index.ts) — opened three connections for
    // three saved locations. The whole suite stayed green throughout; nothing
    // existing could see it. The module is now resolved in
    // `subscribeToLocation` and passed in, so `ensureConnected` awaits nothing
    // before setting the flag.
    const { esModule: presentModule, connect } = createPresentMqttModule();
    vi.doMock('mqtt', () => presentModule);
    const { blitzortungService } = await importFreshBlitzortung();

    // Started without awaiting the first, mirroring the startup prewarm loop.
    const first = blitzortungService.prewarmLocation(40.0, -74.0, 100);
    const second = blitzortungService.prewarmLocation(41.0, -75.0, 100);
    await Promise.all([first, second]);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('contract 9: a load failure reaching getLightningStrikes rejects and never resolves to []', async () => {
    // THE GAP CONTRACT 4 LEAVES OPEN, and the one that shipped a green safety
    // verdict.
    //
    // Contract 4 drives a generic (non-ERR_MODULE_NOT_FOUND) failure through
    // `prewarmLocation`, whose catch swallows everything — so it can prove the
    // classification and the retry, but it can never observe what a *query*
    // does with the same failure. Through `getLightningStrikes` the answer used
    // to be `return []`, which `lightningHandler` renders as
    // "## 🟢 Safety Status: SAFE (LIMITED DATA)" with "Total Strikes: 0" —
    // an all-clear on safety data assembled from a module that never loaded.
    // Reproduced against the built dist twice: with mqtt's entry point
    // corrupted, and with mqtt intact but its `mqtt-packet` dependency removed.
    //
    // Note the second case reports `MODULE_NOT_FOUND`, not
    // `ERR_MODULE_NOT_FOUND` — mqtt resolves through the CommonJS loader, so a
    // failure *inside* it never reaches the absence branch. No error-code
    // bridge here, deliberately: a plain Error with no `.code` already lands in
    // exactly the branch under test.
    const genericError = new Error('unexpected parse failure while loading mqtt');
    const factory = vi.fn(() => {
      throw genericError;
    });
    vi.doMock('mqtt', factory);
    const { blitzortungService, MqttLoadFailedError, MQTT_LOAD_FAILED_MESSAGE, logger } =
      await importFreshBlitzortung();
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const outcome = await blitzortungService
      .getLightningStrikes(40.0, -74.0, 100, 60)
      .then((strikes) => ({ kind: 'resolved' as const, strikes }))
      .catch((error: unknown) => ({ kind: 'rejected' as const, error }));

    // Stated as an explicit resolve/reject discrimination rather than
    // `.rejects`, so a regression reports "it resolved to []" instead of a bare
    // assertion failure.
    expect(outcome.kind).toBe('rejected');
    expect(outcome.kind === 'rejected' && outcome.error).toBeInstanceOf(MqttLoadFailedError);

    // The remedy must not be the absent one: this user did not use
    // --omit=optional, and sending them to reinstall without it is the wrong fix.
    const message = (outcome.kind === 'rejected' ? (outcome.error as Error).message : '');
    expect(message).toBe(MQTT_LOAD_FAILED_MESSAGE);
    expect(message).not.toContain('--omit=optional');
    expect(message).toContain('mqtt');

    // The underlying failure can carry a `Require stack:` of absolute paths.
    // Only its name and code are logged, and the Error slot is left empty.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toBeUndefined();
    expect(errorSpy.mock.calls[0][2]).toMatchObject({ package: 'mqtt' });
    expect(JSON.stringify(errorSpy.mock.calls[0])).not.toContain('unexpected parse failure');
  });

  // Contract 7 (the composite summary degrades and never fabricates calm) is
  // exercised in tests/unit/weather-summary-handler.test.ts, which already
  // mocks the lightning handler and is the right place to assert on the
  // rendered "## lightning (unavailable)" section.
});
