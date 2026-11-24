/**
 * Tool configuration for Weather MCP Server
 *
 * Supports both presets and individual tool control for flexible configuration.
 *
 * Usage examples:
 * - ENABLED_TOOLS=basic                    # Only basic weather tools
 * - ENABLED_TOOLS=full                     # All tools except experimental
 * - ENABLED_TOOLS=basic,+air_quality       # Basic tools + air quality
 * - ENABLED_TOOLS=all,-marine              # All tools except marine
 * - ENABLED_TOOLS=forecast,current,alerts  # Specific tools only
 * - ENABLED_TOOLS=-alerts,standard         # Same as standard,-alerts: order between a preset
 *                                          #   and its +/- modifiers does not matter
 * - ENABLED_TOOLS=-alerts                  # Modifiers alone adjust the default basic preset
 */

/**
 * Available tool names in the Weather MCP Server
 */
// The single source of truth for the tool-name set. TOOL_DEFINITIONS and the
// CallToolRequestSchema dispatch in src/server/weatherServer.ts are pinned to this list by
// tests/unit/tool-name-parity.test.ts — add a tool here and that test names
// every other place you still have to edit.
export const TOOL_NAMES = [
  'get_forecast',
  'get_current_conditions',
  'get_alerts',
  'get_historical_weather',
  'get_weather_summary',
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
  'remove_saved_location'
] as const;

export type ToolName = typeof TOOL_NAMES[number];

/**
 * Tool presets for easy configuration
 */
const TOOL_PRESETS: Record<string, ToolName[]> = {
  // The DEFAULT preset (used when ENABLED_TOOLS is unset), so this is what most
  // users actually see. Led by get_weather_summary (one call answers the common
  // "what's the weather?" question), with the atomic follow-up tools and
  // geocoding/health-check helpers. Every tool accepts city_name/location_name,
  // so this 6-tool set covers the bulk of real usage on its own.
  basic: [
    'get_weather_summary',
    'get_forecast',
    'get_current_conditions',
    'get_alerts',
    'search_location',
    'check_service_status'
  ],

  // Basic + history, air quality, and saved-location personalization
  standard: [
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
    'remove_saved_location'
  ],

  // Standard + the specialized environmental & safety tools (everything)
  full: [
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
    'remove_saved_location'
  ],

  // All available tools (identical set to `full`)
  all: [
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
    'remove_saved_location'
  ]
};

/**
 * Tool aliases for convenience (short names)
 */
const TOOL_ALIASES: Record<string, ToolName> = {
  'forecast': 'get_forecast',
  'current': 'get_current_conditions',
  'conditions': 'get_current_conditions',
  'alerts': 'get_alerts',
  'warnings': 'get_alerts',
  'historical': 'get_historical_weather',
  'history': 'get_historical_weather',
  'summary': 'get_weather_summary',
  'weather_summary': 'get_weather_summary',
  'overview': 'get_weather_summary',
  'status': 'check_service_status',
  'location': 'search_location',
  'search': 'search_location',
  'air_quality': 'get_air_quality',
  'aqi': 'get_air_quality',
  'marine': 'get_marine_conditions',
  'ocean': 'get_marine_conditions',
  'waves': 'get_marine_conditions',
  'imagery': 'get_weather_imagery',
  'radar': 'get_weather_imagery',
  'satellite': 'get_weather_imagery',
  'lightning': 'get_lightning_activity',
  'strikes': 'get_lightning_activity',
  'thunderstorm': 'get_lightning_activity',
  'river': 'get_river_conditions',
  'rivers': 'get_river_conditions',
  'flood': 'get_river_conditions',
  'streamflow': 'get_river_conditions',
  'wildfire': 'get_wildfire_info',
  'wildfires': 'get_wildfire_info',
  'fire': 'get_wildfire_info',
  'fires': 'get_wildfire_info',
  'smoke': 'get_wildfire_info'
};

/**
 * Parse the ENABLED_TOOLS environment variable
 *
 * Supports:
 * - Presets: "basic", "standard", "full", "all"
 * - Individual tools: "forecast,current,alerts"
 * - Adding to presets: "basic,+air_quality"
 * - Removing from presets: "all,-marine"
 * - Combinations: "standard,+air_quality,-alerts"
 *
 * Two passes over one token list. The base set is the union of every bare token (preset, tool
 * or alias) in token order, or the `basic` preset when the value has no bare token at all. Every
 * `+tool` / `-tool` then applies to that base, in token order. So a modifier's position relative
 * to a bare token never changes the result; a value that lists every bare token before its
 * modifiers gives the same tools, in the same order, as the old single-pass parser did.
 *
 * @param envValue The ENABLED_TOOLS environment variable value
 * @returns Set of enabled tool names
 */
function parseEnabledTools(envValue: string | undefined): Set<ToolName> {
  const parts = (envValue ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const isModifier = (part: string): boolean => part.startsWith('+') || part.startsWith('-');
  const bareParts = parts.filter(part => !isModifier(part));

  // Pass 1 — the base. No bare token at all (unset, empty, or modifiers only) → the default
  // preset. Bare tokens that are all unknown still give an empty base, not the default.
  const enabledTools = new Set<ToolName>(bareParts.length === 0 ? TOOL_PRESETS.basic : []);

  for (const part of bareParts) {
    if (Object.prototype.hasOwnProperty.call(TOOL_PRESETS, part)) {
      for (const tool of TOOL_PRESETS[part]) {
        enabledTools.add(tool);
      }
      continue;
    }

    const resolvedTool = resolveToolName(part);
    if (resolvedTool) {
      enabledTools.add(resolvedTool);
    } else {
      console.warn(`Unknown tool or preset: "${part}"`);
    }
  }

  // Pass 2 — modifiers, in token order, against the base.
  for (const part of parts) {
    // Handle additions (+tool)
    if (part.startsWith('+')) {
      const toolName = part.slice(1);
      const resolvedTool = resolveToolName(toolName);
      if (resolvedTool) {
        enabledTools.add(resolvedTool);
      } else {
        console.warn(`Unknown tool to add: "${toolName}"`);
      }
      continue;
    }

    // Handle removals (-tool)
    if (part.startsWith('-')) {
      const toolName = part.slice(1);
      const resolvedTool = resolveToolName(toolName);
      if (resolvedTool) {
        enabledTools.delete(resolvedTool);
      } else {
        console.warn(`Unknown tool to remove: "${toolName}"`);
      }
    }
    // Bare tokens were applied in pass 1.
  }

  return enabledTools;
}

/**
 * Resolve a tool name or alias to the canonical tool name
 * @param name Tool name or alias
 * @returns Canonical tool name or undefined if not found
 */
function resolveToolName(name: string): ToolName | undefined {
  const normalized = name.toLowerCase();

  // Check if it's already a canonical name
  if (isToolName(normalized)) {
    return normalized as ToolName;
  }

  // Check aliases
  if (Object.prototype.hasOwnProperty.call(TOOL_ALIASES, normalized)) {
    return TOOL_ALIASES[normalized];
  }

  return undefined;
}

/**
 * Type guard to check if a string is a valid ToolName
 */
function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Tool configuration singleton
 */
class ToolConfig {
  private enabledTools: Set<ToolName>;

  constructor() {
    this.enabledTools = parseEnabledTools(process.env.ENABLED_TOOLS);

    // Log enabled tools for debugging
    if (this.enabledTools.size > 0) {
      console.error(`[ToolConfig] Enabled tools (${this.enabledTools.size}): ${Array.from(this.enabledTools).join(', ')}`);
    } else {
      console.error('[ToolConfig] Warning: No tools enabled!');
    }
  }

  /**
   * Check if a specific tool is enabled
   */
  isEnabled(tool: ToolName): boolean {
    return this.enabledTools.has(tool);
  }

  /**
   * Get all enabled tools
   */
  getEnabledTools(): ToolName[] {
    return Array.from(this.enabledTools);
  }
}

// Export singleton instance
export const toolConfig = new ToolConfig();

// Export preset definitions for documentation
export const PRESETS = TOOL_PRESETS;

/**
 * Ceiling on the JSON size of the `tools/list` result, per preset, in bytes.
 * Every MCP client puts this payload into model context on every turn, so it is
 * a standing context cost. Each value is the measured payload rounded up to the
 * next 1,000 bytes, so growth past it is a deliberate edit of this file rather
 * than a description that quietly grew. Measured 2026-09-23 in UTF-8 bytes
 * (Buffer.byteLength, not String.length — the descriptions carry em-dashes, and
 * a code-unit count under-reports): basic 13,212, full 31,055. Raised from
 * 13,000 / 31,000 on purpose, for get_weather_summary's declared `source`.
 */
export const TOOLS_LIST_BYTE_BUDGET: Record<'basic' | 'full', number> = {
  basic: 14000,
  full: 32000,
};
