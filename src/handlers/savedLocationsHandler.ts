/**
 * Handlers for saved location management tools
 */

import { LocationStore } from '../services/locationStore.js';
import { NominatimService } from '../services/nominatim.js';
import { validateLatitude, validateLongitude } from '../utils/validation.js';

interface SaveLocationArgs {
  alias?: string;
  location_query?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
}

interface GetLocationArgs {
  alias?: string;
}

interface RemoveLocationArgs {
  alias?: string;
}

/**
 * Escape user input for safe embedding in Markdown
 */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '\\`')
    .replace(/~/g, '\\~')
    .replace(/#/g, '\\#')
    .replace(/!/g, '\\!')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
}

/**
 * Save a location for future use
 */
export async function handleSaveLocation(
  args: unknown,
  locationStore: LocationStore,
  nominatimService: NominatimService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const saveArgs = args as SaveLocationArgs;

  // Validate alias
  if (!saveArgs.alias || typeof saveArgs.alias !== 'string') {
    throw new Error('alias parameter is required and must be a string');
  }

  const alias = saveArgs.alias.toLowerCase().trim();
  if (alias.length === 0) {
    throw new Error('alias cannot be empty');
  }

  if (alias.length > 50) {
    throw new Error('alias must be 50 characters or less');
  }

  let latitude: number;
  let longitude: number;
  let name: string;
  let timezone: string | undefined;
  let country_code: string | undefined;
  let admin1: string | undefined;
  let admin2: string | undefined;

  // Determine how to get coordinates
  if (saveArgs.location_query && typeof saveArgs.location_query === 'string') {
    // Geocode the query
    const query = saveArgs.location_query.trim();
    const results = await nominatimService.searchLocation(query, 1);

    if (!results.results || results.results.length === 0) {
      throw new Error(
        `Could not find location "${query}". Please try:\n` +
        `- Being more specific (e.g., "Seattle, WA, USA" instead of "Seattle")\n` +
        `- Using a different spelling\n` +
        `- Providing coordinates directly with latitude and longitude parameters`
      );
    }

    const location = results.results[0];
    latitude = location.latitude;
    longitude = location.longitude;
    name = saveArgs.name || location.name;
    timezone = location.timezone;
    country_code = location.country_code;
    admin1 = location.admin1;
    admin2 = location.admin2;
  } else if (
    typeof saveArgs.latitude === 'number' &&
    typeof saveArgs.longitude === 'number'
  ) {
    // Use provided coordinates
    latitude = saveArgs.latitude;
    longitude = saveArgs.longitude;
    validateLatitude(latitude);
    validateLongitude(longitude);

    if (!saveArgs.name || typeof saveArgs.name !== 'string') {
      throw new Error(
        'name parameter is required when providing coordinates directly'
      );
    }
    name = saveArgs.name;
  } else {
    throw new Error(
      'Either location_query OR (latitude + longitude + name) must be provided'
    );
  }

  // Check if this is an update or new location
  const isUpdate = locationStore.has(alias);

  // Save the location
  locationStore.set(alias, {
    name,
    latitude,
    longitude,
    timezone,
    country_code,
    admin1,
    admin2
  });

  let output = `# ${isUpdate ? 'Updated' : 'Saved'} Location\n\n`;
  output += `**Alias:** \`${escapeMarkdown(alias)}\`\n`;
  output += `**Name:** ${escapeMarkdown(name)}\n`;
  output += `**Coordinates:** ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°\n`;

  if (timezone) {
    output += `**Timezone:** ${timezone}\n`;
  }

  if (country_code) {
    output += `**Country:** ${country_code.toUpperCase()}\n`;
  }

  if (admin1) {
    output += `**Region:** ${escapeMarkdown(admin1)}\n`;
  }

  output += `\n`;
  output += `---\n\n`;
  output += `This location is now saved and can be used with any weather tool:\n\n`;
  output += `- \`get_forecast(location_name="${alias}")\`\n`;
  output += `- \`get_current_conditions(location_name="${alias}")\`\n`;
  output += `- \`get_alerts(location_name="${alias}")\`\n`;
  output += `- And all other weather tools\n\n`;
  output += `*Storage location: ${locationStore.getStorePath()}*\n`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}

/**
 * List all saved locations
 */
export async function handleListSavedLocations(
  locationStore: LocationStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const locations = locationStore.getAll();
  const aliases = Object.keys(locations).sort();

  if (aliases.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `# Saved Locations\n\n` +
            `No saved locations yet.\n\n` +
            `Use \`save_location\` to save your favorite locations:\n\n` +
            `\`\`\`\n` +
            `save_location(alias="home", location_query="Seattle, WA")\n` +
            `save_location(alias="cabin", location_query="Lake Tahoe, CA")\n` +
            `\`\`\`\n\n` +
            `*Storage location: ${locationStore.getStorePath()}*\n`
        }
      ]
    };
  }

  let output = `# Saved Locations\n\n`;
  output += `**Total:** ${aliases.length} location${aliases.length > 1 ? 's' : ''}\n\n`;
  output += `---\n\n`;

  for (const alias of aliases) {
    const location = locations[alias];
    output += `## \`${escapeMarkdown(alias)}\`\n\n`;
    output += `**Name:** ${escapeMarkdown(location.name)}\n`;
    output += `**Coordinates:** ${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°\n`;

    if (location.timezone) {
      output += `**Timezone:** ${location.timezone}\n`;
    }

    if (location.country_code) {
      output += `**Country:** ${location.country_code.toUpperCase()}\n`;
    }

    if (location.admin1) {
      output += `**Region:** ${escapeMarkdown(location.admin1)}\n`;
    }

    output += `**Saved:** ${new Date(location.saved_at).toLocaleDateString()}\n`;

    if (location.saved_at !== location.updated_at) {
      output += `**Updated:** ${new Date(location.updated_at).toLocaleDateString()}\n`;
    }

    output += `\n`;
  }

  output += `---\n\n`;
  output += `**Usage Examples:**\n\n`;
  output += `\`\`\`\n`;
  for (const alias of aliases.slice(0, 3)) {
    output += `get_forecast(location_name="${alias}")\n`;
  }
  output += `\`\`\`\n\n`;
  output += `*Storage location: ${locationStore.getStorePath()}*\n`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}

/**
 * Get details for a specific saved location
 */
export async function handleGetSavedLocation(
  args: unknown,
  locationStore: LocationStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const getArgs = args as GetLocationArgs;

  if (!getArgs.alias || typeof getArgs.alias !== 'string') {
    throw new Error('alias parameter is required and must be a string');
  }

  const alias = getArgs.alias.toLowerCase().trim();
  const location = locationStore.get(alias);

  if (!location) {
    const available = Object.keys(locationStore.getAll());
    throw new Error(
      `Location "${alias}" not found.\n\n` +
      (available.length > 0
        ? `Available locations: ${available.join(', ')}\n\n`
        : 'No saved locations yet. Use save_location to create one.\n\n') +
      `Use list_saved_locations to see all saved locations.`
    );
  }

  let output = `# Saved Location: \`${escapeMarkdown(alias)}\`\n\n`;
  output += `**Name:** ${escapeMarkdown(location.name)}\n`;
  output += `**Coordinates:** ${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°\n`;

  if (location.timezone) {
    output += `**Timezone:** ${location.timezone}\n`;
  }

  if (location.country_code) {
    output += `**Country:** ${location.country_code.toUpperCase()}\n`;
  }

  if (location.admin1) {
    output += `**Region:** ${escapeMarkdown(location.admin1)}\n`;
  }

  if (location.admin2) {
    output += `**County:** ${escapeMarkdown(location.admin2)}\n`;
  }

  output += `**Saved:** ${new Date(location.saved_at).toLocaleString()}\n`;

  if (location.saved_at !== location.updated_at) {
    output += `**Last Updated:** ${new Date(location.updated_at).toLocaleString()}\n`;
  }

  output += `\n`;
  output += `---\n\n`;
  output += `**Usage Examples:**\n\n`;
  output += `\`\`\`\n`;
  output += `get_forecast(location_name="${alias}")\n`;
  output += `get_current_conditions(location_name="${alias}")\n`;
  output += `get_alerts(location_name="${alias}")\n`;
  output += `get_air_quality(location_name="${alias}")\n`;
  output += `\`\`\`\n`;

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}

/**
 * Remove a saved location
 */
export async function handleRemoveSavedLocation(
  args: unknown,
  locationStore: LocationStore
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const removeArgs = args as RemoveLocationArgs;

  if (!removeArgs.alias || typeof removeArgs.alias !== 'string') {
    throw new Error('alias parameter is required and must be a string');
  }

  const alias = removeArgs.alias.toLowerCase().trim();
  const existed = locationStore.remove(alias);

  if (!existed) {
    const available = Object.keys(locationStore.getAll());
    throw new Error(
      `Location "${alias}" not found.\n\n` +
      (available.length > 0
        ? `Available locations: ${available.join(', ')}`
        : 'No saved locations.')
    );
  }

  const remaining = locationStore.count();

  let output = `# Location Removed\n\n`;
  output += `Successfully removed location: \`${escapeMarkdown(alias)}\`\n\n`;
  output += `**Remaining locations:** ${remaining}\n\n`;

  if (remaining > 0) {
    output += `Use \`list_saved_locations\` to see remaining locations.\n`;
  } else {
    output += `No saved locations remaining.\n\n`;
    output += `Use \`save_location\` to save new locations.`;
  }

  return {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };
}

/**
 * Resolve a location_name to coordinates
 * This is a helper function used by weather tools
 */
export function resolveLocationName(
  locationName: string,
  locationStore: LocationStore
): { latitude: number; longitude: number } {
  const location = locationStore.get(locationName);

  if (!location) {
    const available = Object.keys(locationStore.getAll());
    throw new Error(
      `Saved location "${locationName}" not found.\n\n` +
      (available.length > 0
        ? `Available locations: ${available.join(', ')}\n\n`
        : 'No saved locations yet. Use save_location to create one.\n\n') +
      `Use list_saved_locations to see all saved locations.`
    );
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude
  };
}
