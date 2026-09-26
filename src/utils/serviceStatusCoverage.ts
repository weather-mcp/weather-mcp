/**
 * What check_service_status probes, and every upstream it does not.
 *
 * The not-checked list renders into every verdict so a status call made after a
 * specialist tool's error cannot be read as an all-clear for that upstream.
 * tests/unit/status-handler.test.ts pins both lists against src/services/: a new
 * service file, and every host literal in src/services/, fails that test until
 * it is placed in one of them (or declared upstream-free/no-request there). The
 * `sources` basenames and the `hosts` hostnames both exist for that test only.
 */

export interface NotCheckedUpstream {
  readonly provider: string;
  readonly sources: readonly string[];
  readonly hosts: readonly string[];
}

export const STATUS_PROBED_SOURCES: readonly string[] = Object.freeze(['noaa.ts', 'openmeteo.ts']);

// The hosts the two probes' clients are built on (noaa.ts:51, openmeteo.ts:102).
export const STATUS_PROBED_HOSTS: readonly string[] = Object.freeze(['api.weather.gov', 'archive-api.open-meteo.com']);

const entry = (provider: string, sources: string[], hosts: string[]): NotCheckedUpstream =>
  Object.freeze({ provider, sources: Object.freeze(sources), hosts: Object.freeze(hosts) });

export const STATUS_NOT_CHECKED: readonly NotCheckedUpstream[] = Object.freeze([
  entry('NOAA river gauges (NWPS)', ['noaa.ts'], ['api.water.noaa.gov']),
  entry('USGS', ['noaa.ts'], ['waterservices.usgs.gov']),
  entry('NOAA NCEI', ['ncei.ts'], ['www.ncei.noaa.gov']),
  entry('Aviation Weather Center METAR', ['aviationWeather.ts'], ['aviationweather.gov']),
  entry(
    'Open-Meteo (forecast, air quality, marine, flood, ensemble and geocoding hosts)',
    ['openmeteo.ts', 'geocoding.ts'],
    [
      'api.open-meteo.com',
      'air-quality-api.open-meteo.com',
      'marine-api.open-meteo.com',
      'flood-api.open-meteo.com',
      'ensemble-api.open-meteo.com',
      'geocoding-api.open-meteo.com',
    ]
  ),
  entry('Census.gov geocoder', ['geocoding.ts'], ['geocoding.geo.census.gov']),
  entry('Nominatim (OpenStreetMap)', ['nominatim.ts', 'geocoding.ts'], ['nominatim.openstreetmap.org']),
  entry('MET Norway', ['metno.ts'], ['api.met.no']),
  entry('MeteoAlarm', ['meteoalarm.ts'], ['feeds.meteoalarm.org']),
  entry('MSC GeoMet', ['geomet.ts'], ['api.weather.gc.ca']),
  entry('JMA', ['jma.ts'], ['www.data.jma.go.jp']),
  entry(
    'NDMA SACHET, PAGASA and BMKG',
    ['nationalCap.ts'],
    ['sachet.ndma.gov.in', 'publicalert.pagasa.dost.gov.ph', 'www.bmkg.go.id']
  ),
  entry('Google Weather', ['googleWeather.ts'], ['weather.googleapis.com']),
  entry('Google Pollen', ['googlePollen.ts'], ['pollen.googleapis.com']),
  entry('Environment Agency', ['environmentAgency.ts'], ['environment.data.gov.uk']),
  entry('NIFC', ['nifc.ts'], ['services3.arcgis.com']),
  entry('NASA FIRMS', ['firms.ts'], ['firms.modaps.eosdis.nasa.gov']),
  entry('NASA GIBS', ['basemap.ts'], ['gibs.earthdata.nasa.gov']),
  entry('RainViewer', ['rainviewer.ts'], ['api.rainviewer.com', 'tilecache.rainviewer.com']),
  entry('Blitzortung', ['blitzortung.ts'], ['blitzortung.ha.sed.pl']),
  entry('RCC ACIS', ['acis.ts'], ['data.rcc-acis.org']),
]);

// Semicolons, not commas: several provider labels contain commas.
export function formatNotCheckedLine(): string {
  const providers = STATUS_NOT_CHECKED.map((e) => e.provider);
  return `**Not checked by this tool:** ${providers.join('; ')}. A failure in one of these is not diagnosable here.\n`;
}
