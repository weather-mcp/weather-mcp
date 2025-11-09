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
 */

/**
 * Available tool names in the Weather MCP Server
 */
export type ToolName =
  | 'get_forecast'
  | 'get_current_conditions'
  | 'get_alerts'
  | 'get_historical_weather'
  | 'check_service_status'
  | 'search_location'
  | 'get_air_quality'
  | 'get_marine_conditions';

/**
 * Tool presets for easy configuration
 */
const TOOL_PRESETS: Record<string, ToolName[]> = {
  // Essential weather tools - minimal overhead
  basic: [
    'get_forecast',
    'get_current_conditions',
    'get_alerts',
    'search_location',
    'check_service_status'
  ],

  // Basic + historical data
  standard: [
    'get_forecast',
    'get_current_conditions',
    'get_alerts',
    'get_historical_weather',
    'search_location',
    'check_service_status'
  ],

  // Standard + environmental data
  full: [
    'get_forecast',
    'get_current_conditions',
    'get_alerts',
    'get_historical_weather',
    'search_location',
    'check_service_status',
    'get_air_quality'
  ],

  // All available tools
  all: [
    'get_forecast',
    'get_current_conditions',
    'get_alerts',
    'get_historical_weather',
    'check_service_status',
    'search_location',
    'get_air_quality',
    'get_marine_conditions'
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
  'status': 'check_service_status',
  'location': 'search_location',
  'search': 'search_location',
  'air_quality': 'get_air_quality',
  'aqi': 'get_air_quality',
  'marine': 'get_marine_conditions',
  'ocean': 'get_marine_conditions',
  'waves': 'get_marine_conditions'
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
 * @param envValue The ENABLED_TOOLS environment variable value
 * @returns Set of enabled tool names
 */
function parseEnabledTools(envValue: string | undefined): Set<ToolName> {
  // Default to "basic" preset if not specified
  if (!envValue) {
    return new Set(TOOL_PRESETS.basic);
  }

  const parts = envValue.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  let enabledTools = new Set<ToolName>();
  let hasBaseSet = false;

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
      continue;
    }

    // Handle presets
    if (part in TOOL_PRESETS) {
      if (!hasBaseSet) {
        // First preset replaces the default
        enabledTools = new Set(TOOL_PRESETS[part]);
        hasBaseSet = true;
      } else {
        // Additional presets merge with existing
        for (const tool of TOOL_PRESETS[part]) {
          enabledTools.add(tool);
        }
      }
      continue;
    }

    // Handle individual tools
    const resolvedTool = resolveToolName(part);
    if (resolvedTool) {
      if (!hasBaseSet) {
        // First individual tool creates a new set
        enabledTools = new Set([resolvedTool]);
        hasBaseSet = true;
      } else {
        enabledTools.add(resolvedTool);
      }
    } else {
      console.warn(`Unknown tool or preset: "${part}"`);
    }
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
  if (normalized in TOOL_ALIASES) {
    return TOOL_ALIASES[normalized];
  }

  return undefined;
}

/**
 * Type guard to check if a string is a valid ToolName
 */
function isToolName(name: string): name is ToolName {
  const validTools: ToolName[] = [
    'get_forecast',
    'get_current_conditions',
    'get_alerts',
    'get_historical_weather',
    'check_service_status',
    'search_location',
    'get_air_quality',
    'get_marine_conditions'
  ];
  return validTools.includes(name as ToolName);
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

  /**
   * Get available presets
   */
  static getPresets(): Record<string, ToolName[]> {
    return { ...TOOL_PRESETS };
  }

  /**
   * Get available tool aliases
   */
  static getAliases(): Record<string, ToolName> {
    return { ...TOOL_ALIASES };
  }
}

// Export singleton instance
export const toolConfig = new ToolConfig();

// Export preset definitions for documentation
export const PRESETS = TOOL_PRESETS;
export const ALIASES = TOOL_ALIASES;
