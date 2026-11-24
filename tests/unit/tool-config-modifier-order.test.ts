import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ToolName } from '../../src/config/tools.js';

/**
 * ENABLED_TOOLS modifier order (RF-33, plan-enabled-tools-modifier-order).
 *
 * The parser runs two passes: the base set is the union of every bare token (preset, tool or
 * alias) in token order, or the `basic` preset when there is no bare token at all; then every
 * `+tool` / `-tool` applies to that base in token order. So the position of a modifier relative
 * to a bare token never changes the result.
 *
 * Assertions use `toEqual` on the array, so they pin order as well as membership: `tools/list`
 * emits tools in this order (src/server/weatherServer.ts). The preset arrays below are literals
 * copied from src/config/tools.ts on purpose — the test pins today's order, not whatever the
 * module happens to export.
 *
 * tests/unit/tool-config.test.ts and tests/unit/tool-config-reserved-names.test.ts are the lock
 * files (F12) and stay unedited; this file copies the helper's shape rather than importing it.
 *
 * G21/G34: the ToolConfig singleton is built while the module body runs, and it warns through
 * `console`. The spies are installed before the dynamic import, inside the same
 * `vi.resetModules()` epoch, or they see nothing.
 */

interface FreshToolConfig {
  enabled: ToolName[];
  warnSpy: ReturnType<typeof vi.spyOn>;
}

async function load(envValue: string | undefined): Promise<FreshToolConfig> {
  const oldValue = process.env.ENABLED_TOOLS;
  if (envValue !== undefined) {
    process.env.ENABLED_TOOLS = envValue;
  } else {
    delete process.env.ENABLED_TOOLS;
  }

  vi.resetModules();
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const { toolConfig } = await import('../../src/config/tools.js');

  if (oldValue !== undefined) {
    process.env.ENABLED_TOOLS = oldValue;
  } else {
    delete process.env.ENABLED_TOOLS;
  }

  return { enabled: toolConfig.getEnabledTools(), warnSpy };
}

const BASIC: ToolName[] = [
  'get_weather_summary',
  'get_forecast',
  'get_current_conditions',
  'get_alerts',
  'search_location',
  'check_service_status',
];

const STANDARD: ToolName[] = [
  'get_weather_summary',
  'get_forecast',
  'get_current_conditions',
  'get_alerts',
  'get_historical_weather',
  'get_air_quality',
  'search_location',
  'check_service_status',
  'save_location',
  'list_saved_locations',
  'get_saved_location',
  'remove_saved_location',
];

const FULL: ToolName[] = [
  'get_weather_summary',
  'get_forecast',
  'get_current_conditions',
  'get_alerts',
  'get_historical_weather',
  'get_air_quality',
  'get_marine_conditions',
  'get_weather_imagery',
  'get_lightning_activity',
  'get_river_conditions',
  'get_wildfire_info',
  'search_location',
  'check_service_status',
  'save_location',
  'list_saved_locations',
  'get_saved_location',
  'remove_saved_location',
];

const ALL: ToolName[] = [
  'get_weather_summary',
  'get_forecast',
  'get_current_conditions',
  'get_alerts',
  'get_historical_weather',
  'check_service_status',
  'search_location',
  'get_air_quality',
  'get_marine_conditions',
  'get_weather_imagery',
  'get_lightning_activity',
  'get_river_conditions',
  'get_wildfire_info',
  'save_location',
  'list_saved_locations',
  'get_saved_location',
  'remove_saved_location',
];

const without = (list: ToolName[], tool: ToolName): ToolName[] => list.filter(t => t !== tool);

describe('ENABLED_TOOLS modifier order', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('a modifier before a bare token still applies', () => {
    it('"-alerts,standard" removes get_alerts, the same as "standard,-alerts"', async () => {
      const before = await load('-alerts,standard');
      const after = await load('standard,-alerts');
      expect(before.enabled).toEqual(without(STANDARD, 'get_alerts'));
      expect(before.enabled).toEqual(after.enabled);
    });

    it('"-marine,all" removes get_marine_conditions, the same as "all,-marine"', async () => {
      const before = await load('-marine,all');
      const after = await load('all,-marine');
      expect(before.enabled).toEqual(without(ALL, 'get_marine_conditions'));
      expect(before.enabled).toEqual(after.enabled);
    });

    it('"+marine,basic" adds get_marine_conditions, the same as "basic,+marine"', async () => {
      const before = await load('+marine,basic');
      const after = await load('basic,+marine');
      expect(before.enabled).toEqual([...BASIC, 'get_marine_conditions']);
      expect(before.enabled).toEqual(after.enabled);
    });

    it('"+marine,forecast" keeps both tools, the same as "forecast,+marine"', async () => {
      const before = await load('+marine,forecast');
      const after = await load('forecast,+marine');
      expect(before.enabled).toEqual(['get_forecast', 'get_marine_conditions']);
      expect(before.enabled).toEqual(after.enabled);
    });

    it('"basic,-alerts,standard": a modifier between two bare tokens survives the later one', async () => {
      const { enabled } = await load('basic,-alerts,standard');
      // Base = basic ∪ standard, in token order; then -alerts.
      expect(enabled).toEqual([
        'get_weather_summary',
        'get_forecast',
        'get_current_conditions',
        'search_location',
        'check_service_status',
        'get_historical_weather',
        'get_air_quality',
        'save_location',
        'list_saved_locations',
        'get_saved_location',
        'remove_saved_location',
      ]);
      expect(enabled).not.toContain('get_alerts');
    });
  });

  describe('a value with no bare token starts from basic', () => {
    it('"-alerts" is basic without get_alerts', async () => {
      const { enabled } = await load('-alerts');
      expect(enabled).toEqual(without(BASIC, 'get_alerts'));
    });

    it('"+marine" is basic plus get_marine_conditions', async () => {
      const { enabled } = await load('+marine');
      expect(enabled).toEqual([...BASIC, 'get_marine_conditions']);
    });

    it('"+bogus" is basic, and the add warning is unchanged', async () => {
      const { enabled, warnSpy } = await load('+bogus');
      expect(enabled).toEqual(BASIC);
      expect(warnSpy).toHaveBeenCalledWith('Unknown tool to add: "bogus"');
    });

    for (const value of [' ', ',']) {
      it(`${JSON.stringify(value)} is basic, the same as unset, with no warning`, async () => {
        const { enabled, warnSpy } = await load(value);
        expect(enabled).toEqual(BASIC);
        expect(warnSpy).not.toHaveBeenCalled();
      });
    }
  });

  describe('values with every bare token first are unchanged, in order', () => {
    const cases: Array<[string, ToolName[]]> = [
      ['standard,-alerts', without(STANDARD, 'get_alerts')],
      ['basic,-alerts,+alerts', [...without(BASIC, 'get_alerts'), 'get_alerts']],
      ['marine,basic', ['get_marine_conditions', ...BASIC]],
      ['basic,marine', [...BASIC, 'get_marine_conditions']],
      ['bogus', []],
      ['bogus,+marine', ['get_marine_conditions']],
      ['+marine,bogus', ['get_marine_conditions']],
      // Every form the README, .env.example and the tools.ts header document.
      ['all', ALL],
      ['full', FULL],
      ['forecast,current,alerts', ['get_forecast', 'get_current_conditions', 'get_alerts']],
      [
        'forecast,current,alerts,aqi',
        ['get_forecast', 'get_current_conditions', 'get_alerts', 'get_air_quality'],
      ],
      ['basic,+historical,+air_quality', [...BASIC, 'get_historical_weather', 'get_air_quality']],
      ['basic,+air_quality', [...BASIC, 'get_air_quality']],
      ['all,-marine', without(ALL, 'get_marine_conditions')],
      [
        'standard,+imagery,+lightning',
        [...STANDARD, 'get_weather_imagery', 'get_lightning_activity'],
      ],
      ['standard,+air_quality,-alerts', without(STANDARD, 'get_alerts')],
    ];

    for (const [value, expected] of cases) {
      it(`${JSON.stringify(value)}`, async () => {
        const { enabled } = await load(value);
        expect(enabled).toEqual(expected);
      });
    }
  });

  describe('modifiers keep their order among themselves', () => {
    it('"basic,-alerts,+alerts" ends with get_alerts enabled', async () => {
      const { enabled } = await load('basic,-alerts,+alerts');
      expect(enabled).toContain('get_alerts');
    });

    it('"basic,+alerts,-alerts" ends with get_alerts disabled', async () => {
      const { enabled } = await load('basic,+alerts,-alerts');
      expect(enabled).toEqual(without(BASIC, 'get_alerts'));
    });
  });
});
