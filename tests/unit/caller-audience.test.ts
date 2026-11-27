import { describe, it, expect } from 'vitest';
import { isRemoteCaller, runWithCallerAudience } from '../../src/utils/callerAudience.js';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('callerAudience', () => {
  it('is local outside any scope', () => {
    expect(isRemoteCaller()).toBe(false);
  });

  it('reports the audience the scope was opened with', () => {
    expect(runWithCallerAudience(true, () => isRemoteCaller())).toBe(true);
    expect(runWithCallerAudience(false, () => isRemoteCaller())).toBe(false);
    expect(isRemoteCaller()).toBe(false);
  });

  it('passes the value through and propagates a throw unchanged', () => {
    expect(runWithCallerAudience(true, () => 42)).toBe(42);
    const thrown = new Error('boom');
    expect(() => runWithCallerAudience(true, () => { throw thrown; })).toThrow(thrown);
  });

  it('covers everything the function awaits', async () => {
    const seen = await runWithCallerAudience(true, async () => {
      await tick();
      await Promise.resolve();
      return isRemoteCaller();
    });
    expect(seen).toBe(true);
  });

  it('keeps two interleaved runs apart', async () => {
    const order: string[] = [];
    const run = (remote: boolean, label: string): Promise<boolean> =>
      runWithCallerAudience(remote, async () => {
        order.push(`${label}:start`);
        await tick();
        order.push(`${label}:mid`);
        await tick();
        return isRemoteCaller();
      });

    const [remote, local] = await Promise.all([run(true, 'remote'), run(false, 'local')]);

    expect(remote).toBe(true);
    expect(local).toBe(false);
    // Both were in flight at once: the second started before the first resumed.
    expect(order.indexOf('local:start')).toBeLessThan(order.indexOf('remote:mid'));
  });

  it('lets a nested scope replace the audience for its own extent only', () => {
    runWithCallerAudience(true, () => {
      expect(runWithCallerAudience(false, () => isRemoteCaller())).toBe(false);
      expect(isRemoteCaller()).toBe(true);
    });
  });
});
