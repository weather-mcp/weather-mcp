/**
 * What check_service_status probes, and every upstream it does not.
 *
 * The not-checked list renders into every verdict so a status call made after a
 * specialist tool's error cannot be read as an all-clear for that upstream.
 * tests/unit/status-handler.test.ts pins both lists against src/services/: a new
 * service file fails that test until it is placed in one of them (or declared
 * upstream-free there). The `sources` basenames exist for that test only.
 */

export interface NotCheckedUpstream {
  readonly provider: string;
  readonly sources: readonly string[];
}

export const STATUS_PROBED_SOURCES: readonly string[] = Object.freeze(['noaa.ts', 'openmeteo.ts']);

const entry = (provider: string, sources: string[]): NotCheckedUpstream =>
  Object.freeze({ provider, sources: Object.freeze(sources) });

export const STATUS_NOT_CHECKED: readonly NotCheckedUpstream[] = Object.freeze([
  entry('NOAA river gauges (NWPS)', ['noaa.ts']),
  entry('USGS', ['noaa.ts']),
  entry('NOAA NCEI', ['ncei.ts']),
  entry('Aviation Weather Center METAR', ['aviationWeather.ts']),
  entry('Open-Meteo (forecast, air quality, marine, flood, ensemble and geocoding hosts)', ['openmeteo.ts', 'geocoding.ts']),
  entry('Census.gov geocoder', ['geocoding.ts']),
  entry('Nominatim (OpenStreetMap)', ['nominatim.ts', 'geocoding.ts']),
  entry('MET Norway', ['metno.ts']),
  entry('MeteoAlarm', ['meteoalarm.ts']),
  entry('MSC GeoMet', ['geomet.ts']),
  entry('JMA', ['jma.ts']),
  entry('NDMA SACHET, PAGASA and BMKG', ['nationalCap.ts']),
  entry('Google Weather', ['googleWeather.ts']),
  entry('Google Pollen', ['googlePollen.ts']),
  entry('Environment Agency', ['environmentAgency.ts']),
  entry('NIFC', ['nifc.ts']),
  entry('NASA FIRMS', ['firms.ts']),
  entry('NASA GIBS', ['basemap.ts']),
  entry('RainViewer', ['rainviewer.ts']),
  entry('Blitzortung', ['blitzortung.ts']),
  entry('RCC ACIS', ['acis.ts']),
]);

// Semicolons, not commas: several provider labels contain commas.
export function formatNotCheckedLine(): string {
  const providers = STATUS_NOT_CHECKED.map((e) => e.provider);
  return `**Not checked by this tool:** ${providers.join('; ')}. A failure in one of these is not diagnosable here.\n`;
}
