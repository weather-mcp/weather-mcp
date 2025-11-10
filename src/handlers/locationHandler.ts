/**
 * Handler for search_location tool
 */

import { OpenMeteoService } from '../services/openmeteo.js';
import { DataNotFoundError } from '../errors/ApiError.js';

interface LocationArgs {
  query?: string;
  limit?: number;
}

/**
 * Escape user input for safe embedding in Markdown
 * Prevents Markdown injection attacks (e.g., embedded links, images, code blocks)
 * @param text - User-provided text to escape
 * @returns Escaped text safe for Markdown rendering
 */
function escapeMarkdown(text: string): string {
  // Escape Markdown special characters and normalize whitespace
  return text
    .replace(/\\/g, '\\\\')    // Backslash (must be first)
    .replace(/\*/g, '\\*')      // Asterisk (bold/italic)
    .replace(/_/g, '\\_')       // Underscore (bold/italic)
    .replace(/\[/g, '\\[')      // Left bracket (links)
    .replace(/\]/g, '\\]')      // Right bracket (links)
    .replace(/\(/g, '\\(')      // Left paren (links)
    .replace(/\)/g, '\\)')      // Right paren (links)
    .replace(/</g, '&lt;')      // Less than (HTML/autolinks)
    .replace(/>/g, '&gt;')      // Greater than (HTML/autolinks)
    .replace(/`/g, '\\`')       // Backtick (code)
    .replace(/~/g, '\\~')       // Tilde (strikethrough)
    .replace(/#/g, '\\#')       // Hash (headers)
    .replace(/!/g, '\\!')       // Exclamation (images)
    .replace(/\n/g, ' ')        // Newlines -> spaces (prevent structure injection)
    .replace(/\r/g, '');        // Remove carriage returns
}

export async function handleSearchLocation(
  args: unknown,
  openMeteoService: OpenMeteoService
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Validate input parameters
  const locationArgs = args as LocationArgs;

  if (!locationArgs.query || typeof locationArgs.query !== 'string') {
    throw new Error('query parameter is required and must be a string');
  }

  const query = locationArgs.query.trim();
  const limit = typeof locationArgs.limit === 'number' ?
    Math.min(Math.max(1, locationArgs.limit), 100) : 5;

  // Search for locations
  const response = await openMeteoService.searchLocation(query, limit);

  if (!response.results || response.results.length === 0) {
    throw new DataNotFoundError(
      'OpenMeteo',
      `No locations found matching "${query}". Try:\n` +
      `- Using a different spelling\n` +
      `- Being more specific (e.g., "Paris, France" instead of "Paris")\n` +
      `- Using a nearby city or landmark`
    );
  }

  // Format the results for display
  let output = `# Location Search Results\n\n`;
  // Escape user query to prevent Markdown injection
  output += `**Query:** "${escapeMarkdown(query)}"\n`;
  output += `**Found:** ${response.results.length} location${response.results.length > 1 ? 's' : ''}\n\n`;
  output += `---\n\n`;

  for (let i = 0; i < response.results.length; i++) {
    const location = response.results[i];
    output += `## ${i + 1}. ${location.name}\n\n`;

    // Build location description
    const parts: string[] = [location.name];
    if (location.admin1) parts.push(location.admin1);
    if (location.admin2 && location.admin2 !== location.admin1) parts.push(location.admin2);
    if (location.country) parts.push(location.country);

    output += `**Full Name:** ${parts.join(', ')}\n`;
    output += `**Coordinates:** ${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°\n`;

    if (location.country_code) {
      output += `**Country Code:** ${location.country_code.toUpperCase()}\n`;
    }

    if (location.timezone) {
      output += `**Timezone:** ${location.timezone}\n`;
    }

    if (location.elevation !== undefined) {
      const elevationFt = Math.round(location.elevation * 3.28084);
      output += `**Elevation:** ${location.elevation}m (${elevationFt}ft)\n`;
    }

    if (location.population !== undefined && location.population > 0) {
      output += `**Population:** ${location.population.toLocaleString()}\n`;
    }

    if (location.feature_code) {
      const featureDescription = getFeatureDescription(location.feature_code);
      if (featureDescription) {
        output += `**Type:** ${featureDescription}\n`;
      }
    }

    output += `\n`;

    // Add usage example
    output += `*To get weather for this location, use these coordinates:*\n`;
    output += `*Latitude: ${location.latitude}, Longitude: ${location.longitude}*\n\n`;

    if (i < response.results.length - 1) {
      output += `---\n\n`;
    }
  }

  output += `---\n`;
  output += `*Data source: Open-Meteo Geocoding API*\n`;

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
 * Get human-readable description for feature code
 * Based on GeoNames feature codes: https://www.geonames.org/export/codes.html
 */
function getFeatureDescription(code: string): string | null {
  const featureCodes: { [key: string]: string } = {
    'PPL': 'Populated place',
    'PPLA': 'Administrative capital',
    'PPLA2': 'Second-order administrative capital',
    'PPLA3': 'Third-order administrative capital',
    'PPLA4': 'Fourth-order administrative capital',
    'PPLC': 'National capital',
    'PPLG': 'Seat of government',
    'PPLS': 'Populated places',
    'PPLX': 'Section of populated place',
    'ADM1': 'First-order administrative division',
    'ADM2': 'Second-order administrative division',
    'ADM3': 'Third-order administrative division',
    'ADM4': 'Fourth-order administrative division',
    'PCLI': 'Independent political entity',
    'PCLD': 'Dependent political entity',
    'ISL': 'Island',
    'MT': 'Mountain',
    'MTS': 'Mountains',
    'LAKE': 'Lake',
    'RSTN': 'Railroad station',
    'AIRP': 'Airport',
    'AIRF': 'Airfield',
    'PRK': 'Park',
    'RES': 'Reserve',
    'RESN': 'Nature reserve',
    'RESW': 'Wildlife reserve'
  };

  return featureCodes[code] || null;
}
