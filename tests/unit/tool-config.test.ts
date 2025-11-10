import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ToolName } from '../../src/config/tools.js';

/**
 * Tests for tool configuration system
 *
 * Validates:
 * - Preset parsing (basic, standard, full, all)
 * - Individual tool selection
 * - Addition syntax (+tool)
 * - Removal syntax (-tool)
 * - Combination of presets and individual tools
 * - Alias resolution
 * - Default behavior
 */

// Helper to create a fresh toolConfig instance with a specific env value
async function createToolConfig(envValue: string | undefined): Promise<{
  getEnabledTools: () => ToolName[];
  isEnabled: (tool: ToolName) => boolean;
}> {
  // Temporarily set the env var
  const oldValue = process.env.ENABLED_TOOLS;
  if (envValue !== undefined) {
    process.env.ENABLED_TOOLS = envValue;
  } else {
    delete process.env.ENABLED_TOOLS;
  }

  // Clear the module from cache
  vi.resetModules();

  // Import fresh
  const { toolConfig } = await import('../../src/config/tools.js');

  // Restore old value
  if (oldValue !== undefined) {
    process.env.ENABLED_TOOLS = oldValue;
  } else {
    delete process.env.ENABLED_TOOLS;
  }

  return toolConfig;
}

describe('Tool Configuration', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original environment variable
    originalEnv = process.env.ENABLED_TOOLS;
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.ENABLED_TOOLS = originalEnv;
    } else {
      delete process.env.ENABLED_TOOLS;
    }
  });

  describe('Presets', () => {
    it('should use "basic" preset by default', async () => {
      const toolConfig = await createToolConfig(undefined);

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
      expect(enabled).toContain('search_location');
      expect(enabled).toContain('check_service_status');
      expect(enabled).not.toContain('get_historical_weather');
      expect(enabled).not.toContain('get_air_quality');
      expect(enabled).not.toContain('get_marine_conditions');
    });

    it('should load "basic" preset', async () => {
      const toolConfig = await createToolConfig('basic');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(5);
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
      expect(enabled).toContain('search_location');
      expect(enabled).toContain('check_service_status');
    });

    it('should load "standard" preset', async () => {
      const toolConfig = await createToolConfig('standard');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(6);
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
      expect(enabled).toContain('get_historical_weather');
      expect(enabled).toContain('search_location');
      expect(enabled).toContain('check_service_status');
    });

    it('should load "full" preset', async () => {
      const toolConfig = await createToolConfig('full');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(7);
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
      expect(enabled).toContain('get_historical_weather');
      expect(enabled).toContain('search_location');
      expect(enabled).toContain('check_service_status');
      expect(enabled).toContain('get_air_quality');
    });

    it('should load "all" preset', async () => {
      const toolConfig = await createToolConfig('all');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(12); // Updated for v1.6.0: added get_river_conditions and get_wildfire_info
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
      expect(enabled).toContain('get_historical_weather');
      expect(enabled).toContain('check_service_status');
      expect(enabled).toContain('search_location');
      expect(enabled).toContain('get_air_quality');
      expect(enabled).toContain('get_marine_conditions');
      expect(enabled).toContain('get_weather_imagery');
      expect(enabled).toContain('get_lightning_activity');
      expect(enabled).toContain('get_river_conditions');
      expect(enabled).toContain('get_wildfire_info');
    });
  });

  describe('Individual Tool Selection', () => {
    it('should enable a single tool', async () => {
      const toolConfig = await createToolConfig('get_forecast');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(1);
      expect(enabled).toContain('get_forecast');
    });

    it('should enable multiple specific tools', async () => {
      const toolConfig = await createToolConfig('get_forecast,get_current_conditions,get_alerts');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(3);
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
    });

    it('should handle tool aliases', async () => {
      const toolConfig = await createToolConfig('forecast,current,alerts');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
    });

    it('should mix full names and aliases', async () => {
      const toolConfig = await createToolConfig('get_forecast,current,search');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('search_location');
    });
  });

  describe('Addition Syntax', () => {
    it('should add tool to preset', async () => {
      const toolConfig = await createToolConfig('basic,+get_air_quality');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
      expect(enabled).toContain('search_location');
      expect(enabled).toContain('check_service_status');
      expect(enabled).toContain('get_air_quality');
    });

    it('should add multiple tools to preset', async () => {
      const toolConfig = await createToolConfig('basic,+get_air_quality,+get_marine_conditions');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_air_quality');
      expect(enabled).toContain('get_marine_conditions');
    });

    it('should support aliases in addition syntax', async () => {
      const toolConfig = await createToolConfig('basic,+air_quality,+marine');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_air_quality');
      expect(enabled).toContain('get_marine_conditions');
    });
  });

  describe('Removal Syntax', () => {
    it('should remove tool from preset', async () => {
      const toolConfig = await createToolConfig('all,-get_marine_conditions');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toHaveLength(11); // Updated for v1.6.0: 12 total tools - 1 removed = 11
      expect(enabled).not.toContain('get_marine_conditions');
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_air_quality');
    });

    it('should remove multiple tools from preset', async () => {
      const toolConfig = await createToolConfig('all,-get_marine_conditions,-get_air_quality');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).not.toContain('get_marine_conditions');
      expect(enabled).not.toContain('get_air_quality');
    });

    it('should support aliases in removal syntax', async () => {
      const toolConfig = await createToolConfig('all,-marine,-air_quality');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).not.toContain('get_marine_conditions');
      expect(enabled).not.toContain('get_air_quality');
    });
  });

  describe('Combination Syntax', () => {
    it('should combine preset with additions and removals', async () => {
      const toolConfig = await createToolConfig('standard,+air_quality,-alerts');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_air_quality');
      expect(enabled).not.toContain('get_alerts');
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
    });

    it('should handle complex combinations', async () => {
      const toolConfig = await createToolConfig('basic,+historical,+air_quality,-alerts');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_historical_weather');
      expect(enabled).toContain('get_air_quality');
      expect(enabled).not.toContain('get_alerts');
      expect(enabled).toContain('get_forecast');
    });

    it('should handle individual tools with additions', async () => {
      const toolConfig = await createToolConfig('forecast,+current,+alerts');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
      expect(enabled).toContain('get_current_conditions');
      expect(enabled).toContain('get_alerts');
    });
  });

  describe('isEnabled Method', () => {
    it('should return true for enabled tools', async () => {
      const toolConfig = await createToolConfig('basic');

      expect(toolConfig.isEnabled('get_forecast')).toBe(true);
      expect(toolConfig.isEnabled('get_current_conditions')).toBe(true);
    });

    it('should return false for disabled tools', async () => {
      const toolConfig = await createToolConfig('basic');

      expect(toolConfig.isEnabled('get_marine_conditions')).toBe(false);
      expect(toolConfig.isEnabled('get_air_quality')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', async () => {
      const toolConfig = await createToolConfig('');

      // Should default to basic
      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
    });

    it('should handle whitespace', async () => {
      const toolConfig = await createToolConfig('  basic  ,  +air_quality  ');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_air_quality');
    });

    it('should handle invalid tool names gracefully', async () => {
      const toolConfig = await createToolConfig('basic,+invalid_tool');

      // Should still load basic preset
      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_forecast');
    });

    it('should handle case insensitivity', async () => {
      const toolConfig = await createToolConfig('BASIC,+AIR_QUALITY');

      const enabled = toolConfig.getEnabledTools();
      expect(enabled).toContain('get_air_quality');
    });

    it('should handle duplicate tools', async () => {
      const toolConfig = await createToolConfig('forecast,forecast,current');

      const enabled = toolConfig.getEnabledTools();
      // Should deduplicate
      expect(enabled.filter(t => t === 'get_forecast')).toHaveLength(1);
    });
  });

  describe('Static Methods', () => {
    it('should provide preset definitions', async () => {
      const { PRESETS } = await import('../../src/config/tools.js');

      expect(PRESETS).toHaveProperty('basic');
      expect(PRESETS).toHaveProperty('standard');
      expect(PRESETS).toHaveProperty('full');
      expect(PRESETS).toHaveProperty('all');
    });

    it('should provide alias definitions', async () => {
      const { ALIASES } = await import('../../src/config/tools.js');

      expect(ALIASES).toHaveProperty('forecast');
      expect(ALIASES).toHaveProperty('current');
      expect(ALIASES).toHaveProperty('marine');
      expect(ALIASES.forecast).toBe('get_forecast');
    });
  });
});
