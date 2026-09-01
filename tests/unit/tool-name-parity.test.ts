/**
 * Parity lock for the four hand-maintained tool-name surfaces in this server.
 *
 * There are four places that must all agree on the same seventeen tool names:
 * `TOOL_DEFINITIONS` (feeds `ListTools`), the `switch (name)` dispatch in
 * `CallToolRequestSchema` (feeds `CallToolRequest`), the `ToolName` type, and
 * the runtime membership list. T1 collapsed the type and the runtime list into
 * one export, `TOOL_NAMES` (`src/config/tools.ts`). This file pins the
 * remaining two — `TOOL_DEFINITIONS` and the dispatch `switch` — to that same
 * tuple, so a tool added to one surface and forgotten on another fails a test
 * instead of shipping silently.
 *
 * The dispatch `switch` cannot be reflected on: a `switch` statement has no
 * runtime representation, so no amount of importing `src/index.ts` lets a
 * test enumerate its `case` arms structurally. This file instead reads
 * `src/index.ts` as a string and matches the dispatch region and its `case`
 * labels with regular expressions. That is weaker than a structural
 * assertion and will break if someone reformats a `case` label (e.g. adds a
 * blank line inside the label, or changes quote style) even though the
 * dispatch itself did not change. This trade-off is accepted deliberately:
 * the check is scoped to one narrow, stable, hand-verified pattern rather
 * than attempting to parse the file, and a reformatted `case` label is
 * itself worth a failing test rather than a silent pass — the alternative is
 * no coverage of the dispatch at all.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import type { ToolName } from '../../src/config/tools.js';

// src/index.ts calls main() unconditionally at module scope, which constructs a
// StdioServerTransport and calls server.connect(). Stub the transport so connect()
// has something to call start() on, rather than attaching to this worker's stdin.
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    async start() {}
    async close() {}
    async send() {}
  }
}));

// All three must be set before the static import below evaluates: WEATHER_LIGHTNING_PREWARM
// skips main()'s fire-and-forget MQTT subscribe (which would otherwise open a live
// connection during a unit test), ANALYTICS_ENABLED keeps the analytics client from
// doing anything beyond its in-memory no-op path, and ANALYTICS_SALT keeps the import off
// the filesystem: src/index.ts imports ./analytics/index.js, which builds the analytics
// singleton at module load, and loadAnalyticsConfig() calls getOrGenerateAnalyticsSalt()
// regardless of ANALYTICS_ENABLED — writing ~/.weather-mcp/analytics-salt when it is
// absent. A fixed salt returns at src/analytics/config.ts:94 before any filesystem
// access. The repo .env masks the write on a dev machine; CI and a fresh clone have no
// .env and did create the file (G26).
vi.hoisted(() => {
  process.env.WEATHER_LIGHTNING_PREWARM = 'false';
  process.env.ANALYTICS_ENABLED = 'false';
  process.env.ANALYTICS_SALT = 'tool-name-parity-test';
});

// Import src/index.js exactly once, statically. Never re-import it under
// vi.resetModules() — that re-runs main().
import { TOOL_DEFINITIONS } from '../../src/index.js';
import { TOOL_NAMES } from '../../src/config/tools.js';

const INDEX_TS_SOURCE = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');

describe('Tool name parity', () => {
  it('TOOL_NAMES has no duplicates', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
  });

  it('every TOOL_DEFINITIONS key is a member of TOOL_NAMES', () => {
    const toolNameSet = new Set<string>(TOOL_NAMES);
    const unknownKeys = Object.keys(TOOL_DEFINITIONS).filter((key) => !toolNameSet.has(key));
    expect(unknownKeys, `TOOL_DEFINITIONS key(s) not in TOOL_NAMES: ${unknownKeys.join(', ')}`).toEqual([]);
  });

  it('every TOOL_NAMES member is a key of TOOL_DEFINITIONS', () => {
    const definedKeys = new Set(Object.keys(TOOL_DEFINITIONS));
    const missing = TOOL_NAMES.filter((name) => !definedKeys.has(name));
    expect(missing, `TOOL_NAMES member(s) never registered in TOOL_DEFINITIONS: ${missing.join(', ')}`).toEqual([]);
  });

  it('every TOOL_DEFINITIONS entry\'s inner name field matches its key', () => {
    const mismatches = TOOL_NAMES.filter((name) => {
      const def = (TOOL_DEFINITIONS as Record<string, { name: string }>)[name];
      return def?.name !== name;
    });
    expect(mismatches, `key/name mismatch for: ${mismatches.join(', ')}`).toEqual([]);
  });

  describe('dispatch switch region (src/index.ts, read as text)', () => {
    const switchStart = /^\s*switch \(name\) \{$/m;
    const defaultLabel = /^\s*default:$/m;

    const switchMatches = INDEX_TS_SOURCE.match(new RegExp(switchStart, 'gm')) ?? [];
    const defaultMatches = INDEX_TS_SOURCE.match(new RegExp(defaultLabel, 'gm')) ?? [];

    it('the switch(name) and default: anchors are each found exactly once', () => {
      expect(switchMatches.length, 'switch (name) { anchor').toBe(1);
      // Unique, not merely present: the region slice ends at the first `default:`
      // after the switch, so a second one means the file grew another switch and
      // this anchoring assumption is worth re-reading rather than silently keeping.
      expect(defaultMatches.length, 'default: anchor').toBe(1);
    });

    const startIdx = INDEX_TS_SOURCE.search(switchStart);
    const sourceAfterStart = startIdx === -1 ? '' : INDEX_TS_SOURCE.slice(startIdx);
    const relativeDefaultIdx = sourceAfterStart.search(defaultLabel);
    const dispatchRegion = startIdx === -1 || relativeDefaultIdx === -1
      ? ''
      : sourceAfterStart.slice(0, relativeDefaultIdx);

    it('the dispatch region is non-empty', () => {
      expect(dispatchRegion.length).toBeGreaterThan(0);
    });

    const caseLabelRe = /^\s*case '([a-z_]+)':$/gm;
    const labels: string[] = [];
    for (const match of dispatchRegion.matchAll(caseLabelRe)) {
      labels.push(match[1]);
    }

    it('the case-label scan collected at least one label (regex is not matching nothing)', () => {
      expect(labels.length).toBeGreaterThan(0);
    });

    it('every TOOL_NAMES member appears exactly once as a case label', () => {
      const counts = new Map<string, number>();
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const missingOrDuplicated = TOOL_NAMES.filter((name) => counts.get(name) !== 1);
      expect(
        missingOrDuplicated,
        `TOOL_NAMES member(s) not present exactly once as a case label: ${missingOrDuplicated
          .map((name) => `${name} (x${counts.get(name) ?? 0})`)
          .join(', ')}`
      ).toEqual([]);
    });

    it('the set of case labels equals the set of TOOL_NAMES', () => {
      const toolNameSet = new Set<string>(TOOL_NAMES);
      const labelSet = new Set(labels);
      const extraLabels = [...labelSet].filter((label) => !toolNameSet.has(label));
      expect(extraLabels, `case label(s) with no matching TOOL_NAMES member: ${extraLabels.join(', ')}`).toEqual([]);
    });

    it.each(TOOL_NAMES)('the %s arm records analytics under its own name', (name) => {
      const labelPattern = new RegExp(`^\\s*case '${name}':\\s*$`, 'm');
      const labelMatch = labelPattern.exec(dispatchRegion);
      expect(labelMatch, `case label for ${name} not found in dispatch region`).not.toBeNull();

      const armStart = (labelMatch as RegExpExecArray).index + (labelMatch as RegExpExecArray)[0].length;
      const rest = dispatchRegion.slice(armStart);
      const nextLabelRe = /^\s*(case '[a-z_]+':|default:)$/m;
      const nextMatch = nextLabelRe.exec(rest);
      const armBody = nextMatch ? rest.slice(0, nextMatch.index) : rest;

      expect(armBody).toContain(`withAnalytics('${name}',`);
    });
  });

  describe('ENABLED_TOOLS round trip (the defect this plan fixes)', () => {
    // Mirrors tests/unit/tool-config.test.ts's createToolConfig helper exactly: set
    // env, reset modules, re-import src/config/tools.js only, restore env. This is
    // safe to re-import under vi.resetModules() because, unlike src/index.js, it has
    // no top-level side effects (no main(), no singleton MQTT/server construction).
    async function createToolConfig(envValue: string | undefined): Promise<{
      getEnabledTools: () => ToolName[];
      isEnabled: (tool: ToolName) => boolean;
    }> {
      const oldValue = process.env.ENABLED_TOOLS;
      if (envValue !== undefined) {
        process.env.ENABLED_TOOLS = envValue;
      } else {
        delete process.env.ENABLED_TOOLS;
      }

      vi.resetModules();

      const { toolConfig } = await import('../../src/config/tools.js');

      if (oldValue !== undefined) {
        process.env.ENABLED_TOOLS = oldValue;
      } else {
        delete process.env.ENABLED_TOOLS;
      }

      return toolConfig;
    }

    it.each(TOOL_NAMES)('ENABLED_TOOLS=%s enables exactly [%s]', async (name) => {
      const toolConfig = await createToolConfig(name);
      expect(toolConfig.getEnabledTools()).toEqual([name]);
    });
  });
});
