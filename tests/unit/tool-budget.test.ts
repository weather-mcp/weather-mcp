import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TOOL_BUDGET_FLOOR_MS,
  toolBudgetMs,
  runWithToolBudget,
  remainingToolBudgetMs,
} from '../../src/utils/toolBudget.js';

describe('toolBudget', () => {
  it('(a) toolBudgetMs takes the larger of the input and the floor', () => {
    expect(TOOL_BUDGET_FLOOR_MS).toBe(55_000);
    expect(toolBudgetMs(5000)).toBe(55_000);
    expect(toolBudgetMs(30_000)).toBe(55_000);
    expect(toolBudgetMs(55_000)).toBe(55_000);
    expect(toolBudgetMs(55_001)).toBe(55_001);
    expect(toolBudgetMs(120_000)).toBe(120_000);
  });

  it('(a) toolBudgetMs gives the floor for a non-finite or non-positive input', () => {
    expect(toolBudgetMs(NaN)).toBe(55_000);
    expect(toolBudgetMs(Infinity)).toBe(55_000);
    expect(toolBudgetMs(0)).toBe(55_000);
    expect(toolBudgetMs(-1)).toBe(55_000);
  });

  it('(b) remainingToolBudgetMs is undefined before, outside and after a run', async () => {
    expect(remainingToolBudgetMs()).toBeUndefined();
    await runWithToolBudget(55_000, () => Promise.resolve(remainingToolBudgetMs()), { now: () => 0 });
    expect(remainingToolBudgetMs()).toBeUndefined();
  });

  it('(c) the remainder counts down and never goes negative', async () => {
    let t = 0;
    const seen: (number | undefined)[] = [];
    await runWithToolBudget(
      55_000,
      () => {
        seen.push(remainingToolBudgetMs());
        t = 20_000;
        seen.push(remainingToolBudgetMs());
        t = 55_000;
        seen.push(remainingToolBudgetMs());
        t = 70_000;
        seen.push(remainingToolBudgetMs());
        return Promise.resolve();
      },
      { now: () => t }
    );
    expect(seen).toEqual([55_000, 35_000, 0, 0]);
  });

  describe('(d) async hops', () => {
    beforeEach(() => {
      // Real timers on purpose: a faked timer's callback runs from the
      // advancer's frame and drops the AsyncLocalStorage store (correction 3).
      vi.useRealTimers();
    });

    it('(d) the budget survives a promise hop and a real setTimeout hop', async () => {
      let t = 0;
      const seen: (number | undefined)[] = [];
      await runWithToolBudget(
        55_000,
        async () => {
          await Promise.resolve();
          seen.push(remainingToolBudgetMs());
          t = 20_000;
          await new Promise<void>((r) => setTimeout(r, 1));
          seen.push(remainingToolBudgetMs());
        },
        { now: () => t }
      );
      expect(seen).toEqual([55_000, 35_000]);
    });
  });

  it('(e) two concurrent runs are independent', async () => {
    const t = 0;
    const deps = { now: () => t };
    const seenA: (number | undefined)[] = [];
    const seenB: (number | undefined)[] = [];
    const body = (sink: (number | undefined)[]) => async () => {
      sink.push(remainingToolBudgetMs());
      await Promise.resolve();
      sink.push(remainingToolBudgetMs());
      await Promise.resolve();
      sink.push(remainingToolBudgetMs());
    };
    await Promise.all([
      runWithToolBudget(55_000, body(seenA), deps),
      runWithToolBudget(120_000, body(seenB), deps),
    ]);
    expect(seenA).toEqual([55_000, 55_000, 55_000]);
    expect(seenB).toEqual([120_000, 120_000, 120_000]);
  });

  describe('(f) default clock', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('(f) the default clock is read at call time', async () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValueOnce(1_000).mockReturnValueOnce(21_000);
      const remaining = await runWithToolBudget(55_000, () =>
        Promise.resolve(remainingToolBudgetMs())
      );
      expect(remaining).toBe(35_000);
    });
  });

  it('(g) a rejection propagates as the same object and a value resolves through', async () => {
    const err = new Error('boom');
    await expect(
      runWithToolBudget(55_000, () => Promise.reject(err), { now: () => 0 })
    ).rejects.toBe(err);
    await expect(
      runWithToolBudget(55_000, () => Promise.resolve('ok'), { now: () => 0 })
    ).resolves.toBe('ok');
  });
});
