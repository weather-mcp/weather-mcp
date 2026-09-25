/**
 * Weather MCP Server — server factory.
 *
 * Owns everything needed to answer MCP requests: the sixteen upstream service
 * singletons, the shared schema fragments, TOOL_DEFINITIONS, and the two
 * request handlers (tools/list and tools/call). createWeatherServer() builds a
 * Server with both handlers registered and returns it **unconnected** — the
 * caller chooses the transport.
 *
 * What this module deliberately does NOT do: it does not load `.env` (a library
 * module that reads a .env from the caller's cwd is a trap — see GOTCHAS G26),
 * it constructs no transport, and it registers no process signal handler and
 * calls no process.exit. Importing it is therefore inert, with one exception:
 * `withAnalytics` pulls in the analytics singleton built at module load in
 * src/analytics/config.ts:193, which reads ANALYTICS_SALT. A test that imports
 * this module pins ANALYTICS_ENABLED and ANALYTICS_SALT for that reason and no
 * other.
 *
 * The services are module-scope singletons on purpose: two createWeatherServer()
 * calls in one process share one set of upstream caches, which is what a
 * per-session transport wants. src/index.ts — the stdio entry — is the only
 * consumer today; the factory is not a published API.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { NOAAService } from '../services/noaa.js';
import { OpenMeteoService } from '../services/openmeteo.js';
import { NominatimService } from '../services/nominatim.js';
import { NCEIService } from '../services/ncei.js';
import { AcisService } from '../services/acis.js';
import { AviationWeatherService } from '../services/aviationWeather.js';
import { MeteoAlarmService } from '../services/meteoalarm.js';
import { GeoMetService } from '../services/geomet.js';
import { NIFCService } from '../services/nifc.js';
import { FIRMSService } from '../services/firms.js';
import { GooglePollenService } from '../services/googlePollen.js';
import { GoogleWeatherService } from '../services/googleWeather.js';
import { NationalCapService } from '../services/nationalCap.js';
import { JmaService } from '../services/jma.js';
import { MetnoService } from '../services/metno.js';
import { EnvironmentAgencyService } from '../services/environmentAgency.js';
import { GeocodingService } from '../services/geocoding.js';
import type { LocationStore } from '../services/locationStore.js';
import { toolConfig } from '../config/tools.js';
import { getDefaultLocation } from '../config/defaultLocation.js';
import { logger } from '../utils/logger.js';
import { formatErrorForUser } from '../errors/ApiError.js';
import { criticalAlertBannerFromError } from '../handlers/criticalAlertBanner.js';
import { handleGetForecast } from '../handlers/forecastHandler.js';
import { handleGetCurrentConditions } from '../handlers/currentConditionsHandler.js';
import { handleGetAlerts } from '../handlers/alertsHandler.js';
import { handleGetHistoricalWeather } from '../handlers/historicalWeatherHandler.js';
import { handleCheckServiceStatus } from '../handlers/statusHandler.js';
import { handleSearchLocation } from '../handlers/locationHandler.js';
import { handleGetAirQuality } from '../handlers/airQualityHandler.js';
import { handleGetMarineConditions } from '../handlers/marineConditionsHandler.js';
import { handleGetWeatherImagery } from '../handlers/weatherImageryHandler.js';
import { handleGetLightningActivity } from '../handlers/lightningHandler.js';
import { handleGetRiverConditions } from '../handlers/riverConditionsHandler.js';
import { handleGetWildfireInfo } from '../handlers/wildfireHandler.js';
import { handleGetWeatherSummary } from '../handlers/weatherSummaryHandler.js';
import {
  handleSaveLocation,
  handleListSavedLocations,
  handleGetSavedLocation,
  handleRemoveSavedLocation
} from '../handlers/savedLocationsHandler.js';
import { withAnalytics } from '../analytics/index.js';
import { VERSION } from '../utils/version.js';

/**
 * Server information
 *
 * SERVER_VERSION comes from src/utils/version.ts, which reads package.json by
 * the one relative path that resolves from every build output. A private read
 * of `../package.json` from this directory would resolve to dist/package.json,
 * which does not exist.
 */
export const SERVER_NAME = 'weather-mcp';
export const SERVER_VERSION = VERSION;

/**
 * Redact sensitive fields from tool arguments before logging
 * Removes PII like coordinates, location names, addresses
 */
function redactSensitiveFields(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) {
    return args;
  }

  const redacted: Record<string, unknown> = {};
  const sensitiveFields = [
    'latitude', 'longitude', 'lat', 'lon',
    'location', 'city', 'city_name', 'state', 'address', 'query',
    'zipcode', 'postalCode', 'place', 'coordinates'
  ];

  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (sensitiveFields.includes(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveFields(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Initialize the NOAA service
 */
const noaaService = new NOAAService({
  userAgent: `weather-mcp/${SERVER_VERSION} (https://github.com/weather-mcp/weather-mcp)`
});

/**
 * Initialize the Open-Meteo service for historical data
 * No API key required - free for non-commercial use
 */
const openMeteoService = new OpenMeteoService();

/**
 * Initialize the Nominatim service for geocoding
 * No API key required - uses OpenStreetMap data
 * Better coverage for small towns and villages than GeoNames
 * Rate limited to 1 request/second as per OSM usage policy
 */
const nominatimService = new NominatimService();

/**
 * Initialize the Environment Agency service for Great Britain river gauges
 * No API key required - Open Government Licence v3, keyless
 */
const environmentAgencyService = new EnvironmentAgencyService();

/**
 * Initialize the NCEI service for climate normals (optional)
 * Requires free API token from https://www.ncdc.noaa.gov/cdo-web/token
 * Falls back to Open-Meteo computed normals if not configured
 */
const nceiService = new NCEIService();

/**
 * Initialize the ACIS service for US daily temperature records (optional)
 * Keyless (no signup) — appends a record high/low line to the include_normals
 * output of get_forecast and get_current_conditions for US locations.
 */
const acisService = new AcisService();

/**
 * Initialize the Aviation Weather service for worldwide METAR observations
 * Keyless (no signup) — backs source="metar" on get_current_conditions, the
 * only source that returns real station instrument readings outside the US.
 */
const aviationWeatherService = new AviationWeatherService();

/**
 * Initialize the MeteoAlarm service for European weather warnings
 * Keyless — per-country CAP JSON feeds aggregating the official warnings of
 * the European national meteorological services (EUMETNET MeteoAlarm).
 */
const meteoAlarmService = new MeteoAlarmService();

/**
 * Initialize the MSC GeoMet service for Canadian weather alerts
 * Keyless — Environment and Climate Change Canada's OGC API Features
 * weather-alerts collection.
 */
const geoMetService = new GeoMetService();

/**
 * Initialize the NIFC service for wildfire data
 * No API key required - uses public ArcGIS REST API
 */
const nifcService = new NIFCService();

/**
 * Initialize the NASA FIRMS service for global satellite fire detections.
 * No API key required — keyless regional flat files serve 24 h data
 * globally; an optional FIRMS_MAP_KEY upgrades to targeted Area-API bbox
 * queries with day_range up to 5.
 */
const firmsService = new FIRMSService();

/**
 * Initialize the Google Pollen API service for global pollen data fallback.
 * Optional keyed global pollen fallback; without GOOGLE_POLLEN_API_KEY the
 * service is never called and European pollen via CAMS continues to work unchanged.
 */
const googlePollenService = new GooglePollenService();

/**
 * Initialize the national CAP alert services for India (NDMA SACHET), the
 * Philippines (PAGASA), and Indonesia (BMKG). Keyless jurisdictional
 * authorities, so they sit ahead of the Google branch in get_alerts routing
 * exactly as NOAA/ECCC/MeteoAlarm do; no API key required.
 */
const nationalCapService = new NationalCapService();

/**
 * Initialize the JMA (Japan Meteorological Agency) warning service.
 *
 * Japan is a keyless jurisdictional authority like NOAA, ECCC, MeteoAlarm and
 * the national CAP feeds, so it sits ahead of the Google branch in get_alerts
 * routing; no API key required. Warnings are matched to the requested point
 * through a committed class10 area geometry artifact (src/data/jmaAreas.ts).
 */
const jmaService = new JmaService();

/**
 * Initialize the MET Norway Locationforecast service.
 *
 * Not a source any caller can ask for: it answers only when Open-Meteo fails
 * transiently on an `auto`-routed non-US `get_forecast`, so the tool schema is
 * unchanged and no `source` value names it. Keyless, and passed to **both**
 * public paths through the forecast handler — `get_forecast` and
 * `get_weather_summary`. Passing it to only the first would leave the fallback
 * dead on the path a default install actually exercises.
 */
const metnoService = new MetnoService();

/**
 * Initialize the Google Weather API service for global alerts fallback.
 * Optional keyed alerts fallback for the "elsewhere" branch of get_alerts; without
 * GOOGLE_WEATHER_API_KEY the keyless authorities are entirely unaffected — NOAA,
 * ECCC, MeteoAlarm, the national CAP feeds of India, the Philippines and
 * Indonesia, and JMA in Japan — and the elsewhere branch returns the
 * not-covered message unchanged.
 */
const googleWeatherService = new GoogleWeatherService();

/**
 * Initialize the Geocoding service with multi-provider support
 * No API key required - uses Census.gov, Nominatim, and Open-Meteo
 * Automatic fallback strategy for maximum reliability
 */
const geocodingService = new GeocodingService();

/**
 * Shared unit / localization parameters. Spread into weather tools so the AI can
 * request output units per call. Omitting them falls back to the server default
 * (WEATHER_UNITS env, default imperial).
 */
const UNIT_SCHEMA_PROPERTIES = {
  units: {
    type: 'string' as const,
    description: 'Unit system for output. Defaults to the server setting; individual *_unit overrides take precedence.',
    enum: ['imperial', 'metric']
  },
  temperature_unit: {
    type: 'string' as const,
    description: 'Override the temperature unit.',
    enum: ['F', 'C']
  },
  wind_speed_unit: {
    type: 'string' as const,
    description: 'Override the wind speed unit ("kn" is knots).',
    enum: ['mph', 'kmh', 'ms', 'kn']
  },
  precipitation_unit: {
    type: 'string' as const,
    description: 'Override the precipitation unit.',
    enum: ['inch', 'mm']
  },
  pressure_unit: {
    type: 'string' as const,
    description: 'Override the pressure unit.',
    enum: ['inHg', 'hPa']
  },
  distance_unit: {
    type: 'string' as const,
    description: 'Override the distance, visibility and elevation unit.',
    enum: ['mi', 'km']
  },
  time_format: {
    type: 'string' as const,
    description: 'Clock format for times.',
    enum: ['12h', '24h']
  }
};

/**
 * Shared location parameters. Spread into every location-based weather tool so
 * the AI can provide a location in ONE of three consistent ways: coordinates,
 * a saved location name, or a free-text city name (geocoded on demand). Tools
 * using this fragment must declare `required: []` — resolveLocationAsync enforces
 * that at least one usable form is present at call time (falling back to
 * WEATHER_DEFAULT_LOCATION when the operator has configured one; the hint below
 * is only added to the schema in that case, so models don't omit locations on
 * servers with no default).
 */
const DEFAULT_LOCATION_HINT = getDefaultLocation()
  ? ` If the user does not specify a location, omit all location parameters — the server's configured default location ("${getDefaultLocation()}") is used.`
  : '';

const LOCATION_SCHEMA_PROPERTIES = {
  latitude: {
    type: 'number' as const,
    description: `Latitude (-90 to 90). Not required if location_name or city_name is provided.${DEFAULT_LOCATION_HINT}`,
    minimum: -90,
    maximum: 90
  },
  longitude: {
    type: 'number' as const,
    description: 'Longitude (-180 to 180). Not required if location_name or city_name is provided.',
    minimum: -180,
    maximum: 180
  },
  location_name: {
    type: 'string' as const,
    description: 'A saved location alias, e.g. "home". List them with list_saved_locations.'
  },
  city_name: {
    type: 'string' as const,
    description: 'A place name to geocode, e.g. "Paris, France". Include state or country to disambiguate.'
  }
};

/**
 * Shared output-verbosity parameter for high-volume tools.
 */
const DETAIL_SCHEMA_PROPERTY = {
  detail: {
    type: 'string' as const,
    description: 'Output verbosity: "summary" (shortest), "standard" (default, balanced), or "full" (everything the source provides).',
    enum: ['summary', 'standard', 'full']
  }
};

/**
 * Tool definitions - each tool defined separately for conditional registration
 */
export const TOOL_DEFINITIONS = {
  get_forecast: {
    name: 'get_forecast' as const,
    description: 'Get future weather forecast for a location. Use this for upcoming weather predictions (e.g., "tomorrow", "this week", "next 7 days", "hourly forecast"). Automatically selects the best data source: NOAA for US locations (more detailed), Open-Meteo for international locations. For current weather, use get_current_conditions. For past weather, use get_historical_weather.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        days: {
          type: 'number' as const,
          description: 'Number of days to include in forecast (1-16 for global, 1-7 for US NOAA, default: 7)',
          minimum: 1,
          maximum: 16,
          default: 7
        },
        granularity: {
          type: 'string' as const,
          description: 'Forecast granularity: "daily" for day/night periods or "hourly" for hour-by-hour detail (default: "daily")',
          enum: ['daily', 'hourly'],
          default: 'daily'
        },
        include_precipitation_probability: {
          type: 'boolean' as const,
          description: 'Include precipitation probability in the forecast output (default: true)',
          default: true
        },
        include_severe_weather: {
          type: 'boolean' as const,
          description: 'Include severe weather probabilities such as thunderstorm chance, wind gust probabilities, and tropical storm/hurricane risks (default: false, US/NOAA only)',
          default: false
        },
        include_normals: {
          type: 'boolean' as const,
          description: 'Include climate normals (30-year averages) for comparison with forecasted temperatures, plus US daily records (default: false, daily forecasts only).',
          default: false
        },
        include_astronomy: {
          type: 'boolean' as const,
          description: 'Include astronomy details for each forecast day (default: false, daily forecasts only). Use when asked about the moon phase, a full moon or new moon, moonrise/moonset, golden hour, twilight, or "when does it get dark".',
          default: false
        },
        source: {
          type: 'string' as const,
          description: 'Data source: "auto" (default, selects NOAA for US or Open-Meteo for international), "noaa" (US only), or "openmeteo" (global)',
          enum: ['auto', 'noaa', 'openmeteo'],
          default: 'auto'
        },
        compare_models: {
          type: 'boolean' as const,
          default: false,
          description: 'Compare 5 global weather models (GFS, ECMWF, ICON, GEM, UKMO) and summarize their agreement/divergence instead of a single forecast. Use when asked how confident or certain a forecast is, or whether models agree. Daily granularity only; always Open-Meteo (default: false).'
        },
        ensemble_spread: {
          type: 'boolean' as const,
          description: 'Show one model\'s ensemble spread (ECMWF ENS, 50 members) instead of a single forecast — how confident the model itself is, day by day. Use when asked how certain/uncertain the forecast is. Daily only; always Open-Meteo (default: false).',
          default: false
        },
        ...DETAIL_SCHEMA_PROPERTY,
        ...UNIT_SCHEMA_PROPERTIES
      },
      required: []
    }
  },

  get_current_conditions: {
    name: 'get_current_conditions' as const,
    description: 'Get the most recent weather observation for a location. Use this for current weather or when asking about "today\'s weather", "right now", or recent conditions without a specific historical date range. Returns NOAA station observations for US locations and Open-Meteo model data for international locations. Automatically includes frostbite-risk and heat-stress (WBGT) context when conditions are extreme. For specific past dates or date ranges, use get_historical_weather instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        include_fire_weather: {
          type: 'boolean' as const,
          description: 'US locations get NOAA fire-weather indices (Haines, grassland, red-flag); elsewhere, and on source metar, a computed Fosberg Fire Weather Index. Dryness context is model-path only. (default: false)',
          default: false
        },
        include_normals: {
          type: 'boolean' as const,
          description: 'Include climate normals (30-year averages) for comparison with current conditions, plus US daily records (default: false).',
          default: false
        },
        source: {
          type: 'string' as const,
          description: 'Data source: "auto" (default, selects NOAA for US or Open-Meteo for international), "noaa" (US only), "openmeteo" (global), or "metar" (global airport station observations). Choose "metar" when the user wants an ACTUAL or REAL observation rather than a model estimate — "what is the station actually reporting?", "measured", "observed conditions", "METAR", "airport weather", "flight category", "raw observation". It is the only source that returns real instrument readings outside the US. It reports from the nearest airport, which may be tens of kilometers from the requested point, and always states the station, its distance, and the age of the observation.',
          enum: ['auto', 'noaa', 'openmeteo', 'metar'],
          default: 'auto'
        },
        ...UNIT_SCHEMA_PROPERTIES
      },
      required: []
    }
  },

  get_alerts: {
    name: 'get_alerts' as const,
    description: 'Get active weather alerts, watches, warnings, and advisories for a location. Coverage: the United States (NOAA), Canada (Environment and Climate Change Canada), European MeteoAlarm member countries, Japan (JMA), and the official national CAP feeds of India (NDMA SACHET), the Philippines (PAGASA) and Indonesia (BMKG). All of the above are keyless. With an optional `GOOGLE_WEATHER_API_KEY`, official alerts are also available for ~45+ more territories (Australia, Brazil, Mexico, and others) via the Google Weather API. Use this for safety-critical weather information when asked about "any alerts?", "weather warnings?", "is it safe?", "dangerous weather?", or "weather watches?". For forecast data, use get_forecast instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        active_only: {
          type: 'boolean' as const,
          description: 'Whether to show only active alerts (default: true)',
          default: true
        },
        ...DETAIL_SCHEMA_PROPERTY
      },
      required: []
    }
  },

  get_historical_weather: {
    name: 'get_historical_weather' as const,
    description: 'Get historical weather data for a specific date range in the past. Use this when the user asks about weather on specific past dates (e.g., "yesterday", "last week", "November 4, 2024", "30 years ago"). Automatically uses NOAA API for recent dates (last 7 days, US only) or Open-Meteo API for older dates (worldwide, back to 1940). Do NOT use for current conditions - use get_current_conditions instead. Dates are interpreted as UTC calendar days; for US timezones the range may include the prior local evening.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        start_date: {
          type: 'string' as const,
          description: 'Start date in ISO format (YYYY-MM-DD or ISO 8601 datetime)',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date in ISO format (YYYY-MM-DD or ISO 8601 datetime)',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum number of hourly observations to return (default: 168 = one week, max: 744 = full 31-day hourly window). Applies to hourly output only; daily-granularity output for ranges over 31 days always shows the full range.',
          minimum: 1,
          maximum: 744,
          default: 168
        },
        ...UNIT_SCHEMA_PROPERTIES
      },
      required: ['start_date', 'end_date']
    }
  },

  get_weather_summary: {
    name: 'get_weather_summary' as const,
    description: 'Get a combined weather overview for a location in a SINGLE call — current conditions, forecast and alerts, optionally air quality and lightning. Best for broad questions like "What\'s the weather like in Seattle?", "Is it safe to hike today?", or "Give me a weather rundown". For a single specific data product (just the forecast, just alerts, etc.), call that specialized tool directly. Sections that are unavailable for a location (e.g. alerts in a country not yet covered) are noted rather than failing the whole summary.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        include: {
          type: 'array' as const,
          description: 'Which sections to include (default: ["current", "forecast", "alerts"]). Add "air_quality" and/or "lightning" for a fuller picture.',
          items: {
            type: 'string' as const,
            enum: ['current', 'forecast', 'alerts', 'air_quality', 'lightning']
          }
        },
        days: {
          type: 'number' as const,
          description: 'Number of forecast days to include when the forecast section is requested (1-16 for global, 1-7 for US NOAA, default: 7)',
          minimum: 1,
          maximum: 16,
          default: 7
        },
        source: {
          type: 'string' as const,
          description: 'Source for the current and forecast sections: "auto" (default: NOAA in the US, Open-Meteo elsewhere), "noaa" or "openmeteo".',
          enum: ['auto', 'noaa', 'openmeteo'],
          default: 'auto'
        },
        ...DETAIL_SCHEMA_PROPERTY,
        ...UNIT_SCHEMA_PROPERTIES
      },
      required: []
    }
  },

  check_service_status: {
    name: 'check_service_status' as const,
    description: 'Check whether the upstream weather APIs (NOAA, Open-Meteo) are reachable. Call this after any weather tool returns an error, or before a batch of requests. Returns per-service status and links to the official status pages.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },

  search_location: {
    name: 'search_location' as const,
    description: 'Search for locations by name and get their coordinates. Uses Nominatim (OpenStreetMap) for coverage of cities, towns, villages and hamlets worldwide. The weather tools geocode city_name themselves, so use this to disambiguate an ambiguous place name or to show the candidate matches (e.g., "Springfield", "San Francisco, CA", "Small Village, County") — not as a required first step before a weather call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description: 'Location name to search for (e.g., "Paris", "New York, NY", "Tokyo")'
        },
        limit: {
          type: 'integer' as const,
          description: 'Maximum number of results to return (1-50, default: 5)',
          minimum: 1,
          maximum: 50,
          default: 5
        }
      },
      required: ['query']
    }
  },

  get_air_quality: {
    name: 'get_air_quality' as const,
    description: 'Get air quality data including AQI (Air Quality Index), pollutant concentrations, and UV index for a location, worldwide. Use this when asked about "air quality", "pollution", "AQI", "UV index", "safe to exercise outside", "pollen count", "allergy day", or health-related environmental conditions. Shows the appropriate AQI scale (US AQI for US locations, European EAQI elsewhere) with health recommendations. In Europe, pollen is included automatically in grains/m³ with no API key; elsewhere a grass/tree/weed Universal Pollen Index (0–5) is included only when an optional GOOGLE_POLLEN_API_KEY is configured, and without that key pollen is not available outside Europe.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        forecast: {
          type: 'boolean' as const,
          description: 'Include hourly air quality forecast grouped by day (default: false, shows current only). Number of days controlled by forecast_days.',
          default: false
        },
        forecast_days: {
          type: 'number' as const,
          description: 'Number of forecast days when forecast=true (1-7, default: 5). 7 days is the maximum the air quality model provides (168 hours).',
          minimum: 1,
          maximum: 7,
          default: 5
        }
      },
      required: []
    }
  },

  get_marine_conditions: {
    name: 'get_marine_conditions' as const,
    description: 'Get marine conditions including wave height, swell, ocean currents and sea state for any ocean or coastal point worldwide. Use this when asked about "ocean conditions", "wave height", "surf conditions", "safe to boat", "marine forecast", "swell", or "sea state". Shows a safety assessment for maritime activities. NOTE: Data has limited accuracy in coastal areas and is NOT suitable for coastal navigation - always consult official marine forecasts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        forecast: {
          type: 'boolean' as const,
          description: 'Include daily marine forecast (default: false, shows current only). Number of days controlled by forecast_days.',
          default: false
        },
        forecast_days: {
          type: 'number' as const,
          description: 'Number of forecast days when forecast=true (1-16, default: 5). The marine model typically provides ~10 days of data; trailing days without data are omitted with a note.',
          minimum: 1,
          maximum: 16,
          default: 5
        }
      },
      required: []
    }
  },

  get_weather_imagery: {
    name: 'get_weather_imagery' as const,
    description: 'Get weather imagery including radar, satellite and precipitation maps for a location. Use this when asked about "show radar", "satellite image", "precipitation map", "weather map", "animated radar", or "what does radar show". Precipitation/radar is global via RainViewer; satellite is GOES GeoColor (Western Hemisphere) via NASA GIBS. For numerical forecast data, use get_forecast instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        type: {
          type: 'string' as const,
          description: 'Type of imagery: "radar" or "precipitation" (global, RainViewer) or "satellite" (Western Hemisphere GOES GeoColor, NASA GIBS). Default: "precipitation"',
          enum: ['radar', 'satellite', 'precipitation'],
          default: 'precipitation'
        },
        animated: {
          type: 'boolean' as const,
          description: 'Return animated frames showing progression over time (default: false)',
          default: false
        },
        composite: {
          type: 'boolean' as const,
          description: 'Return a finished radar map — the overlay rendered onto a base map with a marker — as an MCP image content block alongside the text. Radar/precipitation only, and the latest frame only (animation stays URL-based). You always receive the image and can describe it; whether it displays inline depends on the client. Default: false',
          default: false
        },
        ...DETAIL_SCHEMA_PROPERTY
      },
      required: []
    }
  },

  get_lightning_activity: {
    name: 'get_lightning_activity' as const,
    description: 'Get real-time lightning strike activity and a safety assessment for a location, worldwide. Use this when asked about "lightning nearby", "lightning strikes", "thunderstorm activity", "is it safe from lightning", or "lightning danger". Provides a 4-level safety assessment (safe/elevated/high/extreme) based on proximity. SAFETY-CRITICAL tool for outdoor activities and severe weather monitoring.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        radius: {
          type: 'number' as const,
          description: 'Search radius in kilometers (1-500, default: 100)',
          minimum: 1,
          maximum: 500,
          default: 100
        },
        timeWindow: {
          type: 'number' as const,
          description: 'Time window in minutes for historical strikes (5-120, default: 60)',
          minimum: 5,
          maximum: 120,
          default: 60
        },
        ...DETAIL_SCHEMA_PROPERTY
      },
      required: []
    }
  },

  get_river_conditions: {
    name: 'get_river_conditions' as const,
    description: 'Monitor river levels and flood status for a location, worldwide. Use this when asked about "river flooding", "river level", "flood stage", "streamflow", "safe to kayak", or "river conditions". Three data modes: US locations return NOAA NWPS gauge observations within the search radius, with official flood categories and forecasts. Great Britain returns Environment Agency gauge observations, with no forecast and no flood categories. Everywhere else returns Open-Meteo Flood (GloFAS v4) modeled river discharge in m³/s, snapped to the nearest modeled river channel; no official flood-stage thresholds exist for model data. SAFETY-CRITICAL tool for flood-prone areas and water recreation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        radius: {
          type: 'number' as const,
          description: 'Gauge search radius in kilometers (1-500); used by the US gauge path (default: 50) and the Great Britain gauge path (default: 25); ignored for the global model path',
          minimum: 1,
          maximum: 500,
          default: 50
        },
        source: {
          type: 'string' as const,
          description: 'Data source: "auto" (default, selects NOAA for the US, the Environment Agency gauge network in Great Britain, or Open-Meteo elsewhere), "noaa" (US only), "ea" (Environment Agency river gauges, Great Britain), or "openmeteo" (global)',
          enum: ['auto', 'noaa', 'openmeteo', 'ea'],
          default: 'auto'
        },
        forecast_days: {
          type: 'number' as const,
          description: 'Number of discharge forecast days (1-210, default: 7); global model path only, ignored for US gauge data',
          minimum: 1,
          maximum: 210,
          default: 7
        },
        ...DETAIL_SCHEMA_PROPERTY
      },
      required: []
    }
  },

  get_wildfire_info: {
    name: 'get_wildfire_info' as const,
    description: 'Monitor active wildfires and fire activity for a location, worldwide. Use this when asked about "wildfires nearby", "fire danger", "active fires", "wildfire smoke", "fire perimeters", or "evacuation risk". Two data modes routed by country: US locations return NIFC named incidents; locations outside the US return NASA FIRMS satellite heat detections (VIIRS, near real-time), clustered by proximity — no fire names or containment exist in satellite data, and detections can include industrial heat sources or agricultural burns. SAFETY-CRITICAL tool for wildfire-prone areas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...LOCATION_SCHEMA_PROPERTIES,
        radius: {
          type: 'number' as const,
          description: 'Search radius in kilometers (1-500, default: 100)',
          minimum: 1,
          maximum: 500,
          default: 100
        },
        source: {
          type: 'string' as const,
          description: 'Data source: "auto" (default, routes by country — NIFC named incidents for the US, NASA FIRMS satellite detections elsewhere), "nifc" (US incidents only; finds nothing outside the US), or "firms" (satellite detections, works anywhere including the US — useful for fires not yet catalogued as incidents)',
          enum: ['auto', 'nifc', 'firms'],
          default: 'auto'
        },
        day_range: {
          type: 'number' as const,
          description: 'Days of detection history (1-5, default: 1); FIRMS path only, and more than 1 day requires a configured FIRMS_MAP_KEY (keyless data covers the last 24 hours). The NIFC path ignores day_range.',
          minimum: 1,
          maximum: 5,
          default: 1
        },
        ...DETAIL_SCHEMA_PROPERTY
      },
      required: []
    }
  },

  save_location: {
    name: 'save_location' as const,
    description: 'Save a location for easy reuse in weather queries. Use this when a user wants to save a frequently used location like "home", "work", "cabin", or "aunt lisa\'s house". Accepts either a location query (which will be geocoded automatically) or direct coordinates. Saved locations can then be used with any weather tool by providing location_name instead of coordinates. SMART UPDATES: If the alias already exists, any field you omit is preserved (including description, alternateNames, and notes) — provide only what you want to change (e.g. just name/activities, without location details, to update those while preserving coordinates and metadata). Pass an empty value ("" or []) to explicitly clear a field.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        alias: {
          type: 'string' as const,
          description: 'Short name/alias for this location (e.g., "home", "work", "cabin"). Will be lowercased automatically. Max 50 characters.',
          maxLength: 50
        },
        location_query: {
          type: 'string' as const,
          description: 'Location to geocode and save (e.g., "Seattle, WA", "Paris, France", "Lake Tahoe, CA"). Will be geocoded using Nominatim. Not required if latitude/longitude provided.'
        },
        latitude: {
          type: 'number' as const,
          description: 'Latitude if providing coordinates directly. Not required if location_query provided.',
          minimum: -90,
          maximum: 90
        },
        longitude: {
          type: 'number' as const,
          description: 'Longitude if providing coordinates directly. Not required if location_query provided.',
          minimum: -180,
          maximum: 180
        },
        name: {
          type: 'string' as const,
          description: 'Display name for the location (required when using latitude/longitude). E.g., "My Home in Seattle"'
        },
        description: {
          type: 'string' as const,
          description: 'Short description for natural language matching (e.g., "My sister\'s house", "The lake house"). Helps Claude understand contextual references.'
        },
        alternateNames: {
          type: 'array' as const,
          description: 'Alternate names/aliases for this location (e.g., ["sister\'s place", "Jane\'s house"]). Enables more natural language queries.',
          items: {
            type: 'string' as const
          }
        },
        notes: {
          type: 'string' as const,
          description: 'Freeform notes about this location for future reference'
        },
        activities: {
          type: 'array' as const,
          items: {
            type: 'string' as const
          },
          description: 'Optional activities you do at this location (e.g., ["boating", "fishing"], ["hiking", "camping"]). Helps AI provide relevant weather information. Each activity max 50 characters.'
        }
      },
      required: ['alias']
    }
  },

  list_saved_locations: {
    name: 'list_saved_locations' as const,
    description: 'List all saved locations. Use this when a user wants to see their saved locations or asks "what locations do I have saved?" or "show my saved places". Helpful for reminding users what location names they can use with weather tools.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },

  get_saved_location: {
    name: 'get_saved_location' as const,
    description: 'Get details for a specific saved location. Use this when a user wants to view information about a particular saved location, like "show me details for my home location" or "what are the coordinates for my cabin?".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        alias: {
          type: 'string' as const,
          description: 'The alias/name of the saved location to retrieve (e.g., "home", "work")'
        }
      },
      required: ['alias']
    }
  },

  remove_saved_location: {
    name: 'remove_saved_location' as const,
    description: 'Remove a saved location. Use this when a user wants to delete a saved location, like "remove my work location" or "delete the cabin from saved locations".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        alias: {
          type: 'string' as const,
          description: 'The alias/name of the saved location to remove (e.g., "home", "work")'
        }
      },
      required: ['alias']
    }
  }
};

export interface WeatherServerOptions {
  /** The saved-location store every location-based tool resolves through. Required, not
   *  defaulted: a defaulted store resolves to ~/.weather-mcp/locations.json, and an
   *  in-process test that forgot to pass one would write the developer's real file. */
  locationStore: LocationStore;
}

/**
 * Build an MCP Server with the enabled tools registered.
 *
 * The returned Server is **unconnected** — the caller attaches the transport it
 * wants. No signal handler is registered and no process state is touched, so a
 * caller may build more than one.
 */
export function createWeatherServer(options: WeatherServerOptions): Server {
  const { locationStore } = options;

  /**
   * Create MCP server instance
   */
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  /**
   * Handler for listing available tools
   * Only returns tools that are enabled in the configuration
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const enabledTools = toolConfig.getEnabledTools();
    const tools = enabledTools
      .map(toolName => TOOL_DEFINITIONS[toolName])
      .filter(Boolean); // Filter out any undefined tools

    return { tools };
  });

  /**
   * Handler for tool execution
   * Validates that tools are enabled before execution
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Check if tool is enabled
      if (!toolConfig.isEnabled(name as any)) {
        throw new Error(`Tool '${name}' is not enabled. Please check your ENABLED_TOOLS configuration.`);
      }

      switch (name) {
        case 'get_forecast':
          return await withAnalytics('get_forecast', async () =>
            handleGetForecast(args, noaaService, openMeteoService, locationStore, geocodingService, nceiService, acisService, true, metnoService)
          );

        case 'get_current_conditions':
          return await withAnalytics('get_current_conditions', async () =>
            handleGetCurrentConditions(args, noaaService, openMeteoService, nceiService, locationStore, geocodingService, acisService, aviationWeatherService, true)
          );

        case 'get_alerts':
          return await withAnalytics('get_alerts', async () =>
            handleGetAlerts(args, noaaService, locationStore, geocodingService, meteoAlarmService, geoMetService, nominatimService, googleWeatherService, nationalCapService, jmaService)
          );

        case 'get_historical_weather':
          return await withAnalytics('get_historical_weather', async () =>
            handleGetHistoricalWeather(args, noaaService, openMeteoService, locationStore, geocodingService)
          );

        case 'get_weather_summary':
          return await withAnalytics('get_weather_summary', async () =>
            handleGetWeatherSummary(
              args, noaaService, openMeteoService, nceiService, locationStore, geocodingService,
              meteoAlarmService, geoMetService, nominatimService, googleWeatherService, nationalCapService,
              jmaService, true, metnoService
            )
          );

        case 'check_service_status':
          return await withAnalytics('check_service_status', async () =>
            handleCheckServiceStatus(noaaService, openMeteoService, SERVER_VERSION)
          );

        case 'search_location':
          return await withAnalytics('search_location', async () =>
            handleSearchLocation(args, geocodingService)
          );

        case 'get_air_quality':
          return await withAnalytics('get_air_quality', async () =>
            handleGetAirQuality(args, openMeteoService, locationStore, geocodingService, googlePollenService)
          );

        case 'get_marine_conditions':
          return await withAnalytics('get_marine_conditions', async () =>
            handleGetMarineConditions(args, noaaService, openMeteoService, locationStore, geocodingService)
          );

        case 'get_weather_imagery':
          return await withAnalytics('get_weather_imagery', async () =>
            handleGetWeatherImagery(args, locationStore, geocodingService)
          );

        case 'get_lightning_activity':
          return await withAnalytics('get_lightning_activity', async () =>
            handleGetLightningActivity(args, locationStore, geocodingService)
          );

        case 'get_river_conditions':
          return await withAnalytics('get_river_conditions', async () =>
            handleGetRiverConditions(args, noaaService, locationStore, geocodingService, openMeteoService, nominatimService, environmentAgencyService)
          );

        case 'get_wildfire_info':
          return await withAnalytics('get_wildfire_info', async () =>
            handleGetWildfireInfo(
              args, nifcService, locationStore, geocodingService,
              firmsService, nominatimService
            )
          );

        case 'save_location':
          return await withAnalytics('save_location', async () =>
            handleSaveLocation(args, locationStore, nominatimService)
          );

        case 'list_saved_locations':
          return await withAnalytics('list_saved_locations', async () =>
            handleListSavedLocations(locationStore)
          );

        case 'get_saved_location':
          return await withAnalytics('get_saved_location', async () =>
            handleGetSavedLocation(args, locationStore)
          );

        case 'remove_saved_location':
          return await withAnalytics('remove_saved_location', async () =>
            handleRemoveSavedLocation(args, locationStore)
          );

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      // Redact sensitive fields from args before logging
      const redactedArgs = args ? redactSensitiveFields(args) : undefined;

      // Log the error with redacted details
      logger.error('Tool execution error', error as Error, {
        tool: name,
        args: redactedArgs ? JSON.stringify(redactedArgs) : undefined,
      });
      // Format error for user display (sanitized)
      const userMessage = formatErrorForUser(error as Error);

      // A life-threatening alert banner resolved by get_forecast or
      // get_current_conditions before their weather request failed. The warning
      // outranks the failure, so it renders above the message rather than being
      // lost with the thrown error. Every other error carries nothing and this
      // is the empty string, leaving the existing output byte-identical.
      const banner = criticalAlertBannerFromError(error);

      return {
        content: [
          {
            type: 'text',
            text: banner + userMessage
          }
        ],
        isError: true
      };
    }
  });

  return server;
}

/**
 * Clear the upstream caches the entry point's shutdown path has always cleared.
 *
 * Two of the sixteen services, in the same order src/index.ts used before this
 * module existed: NOAA and Open-Meteo are the only ones whose caches shutdown
 * ever touched. Exposed as one named function rather than by exporting the two
 * singletons, so callers get a seam and not a mutable handle.
 */
export function clearServiceCaches(): void {
  noaaService.clearCache();
  openMeteoService.clearCache();
}
