/**
 * Unit tests for T1 (plan-stdio-eof-shutdown-impl.md): the module-lifetime
 * housekeeping intervals in src/utils/cache.ts and src/services/blitzortung.ts
 * are now `.unref()`'d, so they no longer hold the Node event loop open once
 * nothing else is live (the stdio transport's stdin is what keeps the loop
 * alive while the server is serving).
 *
 * Real timers throughout — this is observable runtime behaviour
 * (`Timeout#hasRef()`), not a source read, per the design's verification
 * requirement. No `vi.useFakeTimers()` in this file.
 */
import { describe, it, expect, vi } from 'vitest';
import { Cache } from '../../src/utils/cache.js';

describe('Housekeeping timers do not hold the process open', () => {
  describe('Cache', () => {
    it('unrefs its cleanup interval', () => {
      const c = new Cache(10);
      const handle = (c as unknown as { cleanupInterval: NodeJS.Timeout }).cleanupInterval;
      expect(handle.hasRef()).toBe(false);
      c.destroy();
    });

    it('positive control: hasRef() is true for an ordinary ref\'d interval', () => {
      // Proves a `false` above is a property of the code under test, not of
      // this environment or of Timeout objects in general.
      const handle = setInterval(() => {}, 1e6);
      expect(handle.hasRef()).toBe(true);
      clearInterval(handle);
    });
  });

  describe('Blitzortung', () => {
    it('arms exactly two intervals at import, both unref\'d', async () => {
      vi.resetModules();
      // Pass-through spy: calls the real setInterval, just observes the
      // returned handle, so this stays real-timer.
      const spy = vi.spyOn(globalThis, 'setInterval');
      let handles: NodeJS.Timeout[] = [];
      try {
        await import('../../src/services/blitzortung.js');

        handles = spy.mock.results.map((r) => r.value as NodeJS.Timeout);
        // Exactly two — so a third import-time interval cannot slip in
        // un-audited (the constructor starts buffer cleanup and subscription
        // pruning only; the connect poll and connect timeout are setInterval-
        // /setTimeout-based short-lived timers started on connect, not here).
        expect(handles).toHaveLength(2);
        for (const handle of handles) {
          expect(handle.hasRef()).toBe(false);
        }
      } finally {
        for (const handle of handles) {
          clearInterval(handle);
        }
        spy.mockRestore();
      }
    });
  });
});
