import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ToolName } from '../../src/config/tools.js';

/**
 * T4 (plan-own-key-lookups-impl.md) — pins ENABLED_TOOLS parsing against
 * Object.prototype member names (`constructor`, `__proto__`, and the
 * case-mismatched `hasownproperty`), guarding the own-key checks T3 put at
 * src/config/tools.ts:208 (TOOL_PRESETS) and :254 (TOOL_ALIASES).
 *
 * This is a NEW file — tests/unit/tool-config.test.ts is a lock file (F12)
 * and stays unedited. Only the `createToolConfig` helper's *shape* is
 * copied from tool-config.test.ts:17-44, not imported.
 *
 * G21/G34: the ToolConfig singleton is constructed synchronously when
 * src/config/tools.ts's module body runs (`export const toolConfig = new
 * ToolConfig()`), and its constructor calls console.error/console.warn
 * during that run. Vitest replaces globalThis.console with its own
 * instance, so a `console.warn`/`console.error` spy must be installed
 * BEFORE the dynamic `import()` and INSIDE the same `vi.resetModules()`
 * epoch to observe those calls — a spy installed after the import, or a
 * `process.stderr.write` spy, would see nothing (tool-config.test.ts:31-34
 * is the precedent that happens not to need the warning assertions this
 * file needs).
 */

interface FreshToolConfig {
  getEnabledTools: () => ToolName[];
  isEnabled: (tool: ToolName) => boolean;
  warnSpy: ReturnType<typeof vi.spyOn>;
  errorSpy: ReturnType<typeof vi.spyOn>;
  TOOL_NAMES: readonly string[];
}

/**
 * Re-imports src/config/tools.ts under a fresh `vi.resetModules()` epoch
 * with ENABLED_TOOLS set to `envValue`, and returns the fresh singleton's
 * public surface plus console spies installed before the import (G21, G34)
 * and TOOL_NAMES pulled from the SAME re-import (so "is a string in
 * TOOL_NAMES" is checked against the export the code under test actually
 * used, not a value frozen at file load).
 */
async function createFreshToolConfig(envValue: string | undefined): Promise<FreshToolConfig> {
  const oldValue = process.env.ENABLED_TOOLS;
  if (envValue !== undefined) {
    process.env.ENABLED_TOOLS = envValue;
  } else {
    delete process.env.ENABLED_TOOLS;
  }

  vi.resetModules();

  // Spies installed before the dynamic import, same reset epoch (G21, G34).
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const { toolConfig, TOOL_NAMES } = await import('../../src/config/tools.js');

  if (oldValue !== undefined) {
    process.env.ENABLED_TOOLS = oldValue;
  } else {
    delete process.env.ENABLED_TOOLS;
  }

  return {
    getEnabledTools: toolConfig.getEnabledTools.bind(toolConfig),
    isEnabled: toolConfig.isEnabled.bind(toolConfig),
    warnSpy,
    errorSpy,
    TOOL_NAMES,
  };
}

describe('ENABLED_TOOLS vs Object.prototype member names', () => {
  // Each createFreshToolConfig() call already saves/restores
  // process.env.ENABLED_TOOLS around its own resetModules+import (same
  // shape as tool-config.test.ts's helper), so only the console spies need
  // cleanup between tests.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reserved names as the whole value', () => {
    // `hasownproperty` is included deliberately: ENABLED_TOOLS is lowercased
    // before matching, and "hasOwnProperty" lowercases to "hasownproperty",
    // which does NOT match the real (differently-cased) Object.prototype
    // member "hasOwnProperty" under either `in` or `hasOwnProperty.call`.
    // It is expected to behave as an ordinary unknown name on both the base
    // and the branch — a same-casing control at the whole-value level.
    const names = ['constructor', '__proto__', 'hasownproperty'];

    for (const name of names) {
      it(`"${name}" resolves without throwing and matches the bogus-name result`, async () => {
        const bogus = await createFreshToolConfig('bogus-unknown-name');
        const bogusEnabled = bogus.getEnabledTools();
        expect(bogusEnabled).toEqual([]);

        const reserved = await createFreshToolConfig(name);

        expect(reserved.getEnabledTools()).toEqual(bogusEnabled);
        expect(reserved.getEnabledTools()).toEqual([]);
        expect(reserved.warnSpy).toHaveBeenCalledWith(`Unknown tool or preset: "${name}"`);
      });
    }
  });

  describe('addition syntax: "basic,+<reserved>"', () => {
    const names = ['constructor', '__proto__'];

    for (const name of names) {
      it(`"basic,+${name}" leaves the basic set unchanged and warns`, async () => {
        const base = await createFreshToolConfig('basic');
        const baseEnabled = [...base.getEnabledTools()].sort();

        const mixed = await createFreshToolConfig(`basic,+${name}`);
        const mixedEnabled = [...mixed.getEnabledTools()].sort();

        expect(mixedEnabled).toEqual(baseEnabled);
        for (const tool of mixedEnabled) {
          expect(typeof tool).toBe('string');
          expect(mixed.TOOL_NAMES).toContain(tool);
        }
        expect(mixed.warnSpy).toHaveBeenCalledWith(`Unknown tool to add: "${name}"`);
      });
    }
  });

  describe('removal syntax: "basic,-<reserved>"', () => {
    const names = ['__proto__', 'constructor'];

    for (const name of names) {
      it(`"basic,-${name}" leaves the basic set unchanged and warns`, async () => {
        const base = await createFreshToolConfig('basic');
        const baseEnabled = [...base.getEnabledTools()].sort();

        const mixed = await createFreshToolConfig(`basic,-${name}`);
        const mixedEnabled = [...mixed.getEnabledTools()].sort();

        expect(mixedEnabled).toEqual(baseEnabled);
        for (const tool of mixedEnabled) {
          expect(typeof tool).toBe('string');
          expect(mixed.TOOL_NAMES).toContain(tool);
        }
        expect(mixed.warnSpy).toHaveBeenCalledWith(`Unknown tool to remove: "${name}"`);
      });
    }
  });

  describe('control: "basic,+tostring" (not a reserved-name collision)', () => {
    it('warns "Unknown tool to add" and leaves the basic set unchanged', async () => {
      // "tostring" (lowercased) never matches TOOL_PRESETS or TOOL_ALIASES
      // (case-mismatched against the real "toString") and is not a
      // canonical tool name, on the base implementation or on either of
      // M6/M7's reverted-to-`in` mutants — this case's warning path does
      // not go through the own-key checks at :208/:254 at all. It stays
      // green under every mutation in this task by construction.
      const base = await createFreshToolConfig('basic');
      const baseEnabled = [...base.getEnabledTools()].sort();

      const mixed = await createFreshToolConfig('basic,+tostring');
      const mixedEnabled = [...mixed.getEnabledTools()].sort();

      expect(mixedEnabled).toEqual(baseEnabled);
      expect(mixed.warnSpy).toHaveBeenCalledWith('Unknown tool to add: "tostring"');
    });
  });
});
