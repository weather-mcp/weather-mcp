/**
 * Unit tests for geography utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  getGreatLakeRegion,
  getMajorCoastalBayRegion,
  shouldUseNOAAMarine,
  getMarineRegionDescription,
  getGreatLakesRegions,
  getMajorCoastalBayRegions,
  isInUS,
  isInNwsTerritory,
  isInGreatBritain
} from '../../src/utils/geography.js';

/**
 * Shared coordinate fixtures for the isInUS / isInNwsTerritory disjointness property.
 *
 * Split by which predicate is true, because the property "no coordinate is true for
 * both" is vacuous over a list where both are always false (GOTCHAS G13). The three
 * lists together let one case assert the property AND the positives that give it
 * meaning.
 *
 * NON_US_FIXTURES deliberately omits St Croix and Tortola, which the isInUS block
 * asserts false: both are inside the USVI box and so belong in NWS_TERRITORY_FIXTURES.
 */
type Fixture = readonly [name: string, latitude: number, longitude: number];

/** isInUS true. Every point the isInUS block above asserts true. */
const US_FIXTURES: readonly Fixture[] = [
  ['Denver, CO', 39.7392, -104.9903],
  ['Anchorage, AK', 61.2181, -149.9003],
  ['Honolulu, HI', 21.3069, -157.8583],
  ['San Juan, PR', 18.4655, -66.1057],
  ['Punta Agujereada, PR', 18.5208, -67.15],
  ['Mona Island, PR', 18.09, -67.89],
  ['Isla Caja de Muertos, PR', 17.88, -66.52]
];

/** Both predicates false. The isInUS block's negatives, less the two USVI-box points. */
const NON_US_FIXTURES: readonly Fixture[] = [
  ['Punta Cana, DO', 18.582, -68.4055],
  ['London, UK', 51.5074, -0.1278],
  ['Tokyo, JP', 35.6762, 139.6503],
  ['Sydney, AU', -33.8688, 151.2093],
  ['Edmonton, AB', 53.5461, -113.4938],
  ['Mexico City, MX', 19.4326, -99.1332]
];

/** isInNwsTerritory true — the four territories, plus the BVI the USVI box admits. */
const NWS_TERRITORY_FIXTURES: readonly Fixture[] = [
  ['Hagatna, GU', 13.4443, 144.7937],
  ['Ritidian Point, GU', 13.65, 144.86],
  ['Cocos Island, GU', 13.24, 144.65],
  ['Rota, MP', 14.15, 145.2],
  ['Aguijan, MP', 14.85, 145.56],
  ['Tinian, MP', 15.0, 145.63],
  ['Saipan, MP', 15.185, 145.7467],
  ['St Croix, VI', 17.7333, -64.7833],
  ['Point Udall, VI', 17.755, -64.565],
  ['Charlotte Amalie, VI', 18.3419, -64.9307],
  ['St John, VI', 18.33, -64.73],
  ['Tortola, VG (admitted by the USVI box, deliberately)', 18.4207, -64.64],
  ['Pago Pago, AS', -14.2756, -170.702],
  ['Ta`u, AS', -14.23, -169.45],
  ['Rose Atoll, AS', -14.55, -168.15],
  ['Swains Island, AS', -11.06, -171.08]
];

describe('Geography Utilities', () => {
  describe('Great Lakes Detection', () => {
    it('should detect Lake Michigan for Traverse City, MI', () => {
      const region = getGreatLakeRegion(44.7631, -85.6206);
      expect(region).toBe('Lake Michigan');
    });

    it('should detect Lake Superior for Duluth, MN', () => {
      const region = getGreatLakeRegion(46.7867, -92.1005);
      expect(region).toBe('Lake Superior');
    });

    it('should detect Lake Huron for Port Huron, MI', () => {
      const region = getGreatLakeRegion(43.0, -82.4);
      expect(region).toBe('Lake Huron');
    });

    it('should detect Lake Erie for Cleveland, OH', () => {
      const region = getGreatLakeRegion(41.5, -81.7);
      expect(region).toBe('Lake Erie');
    });

    it('should detect Lake Ontario for Rochester, NY', () => {
      const region = getGreatLakeRegion(43.2, -77.6);
      expect(region).toBe('Lake Ontario');
    });

    it('should return null for non-Great Lakes location', () => {
      const region = getGreatLakeRegion(40.7128, -74.0060); // New York City
      expect(region).toBeNull();
    });

    it('should return null for ocean location', () => {
      const region = getGreatLakeRegion(36.0, -76.0); // Atlantic Ocean
      expect(region).toBeNull();
    });
  });

  describe('Coastal Bay Detection', () => {
    it('should detect Chesapeake Bay', () => {
      const region = getMajorCoastalBayRegion(37.5, -76.3);
      expect(region).toBe('Chesapeake Bay');
    });

    it('should detect San Francisco Bay', () => {
      const region = getMajorCoastalBayRegion(37.8, -122.4);
      expect(region).toBe('San Francisco Bay');
    });

    it('should detect Tampa Bay', () => {
      const region = getMajorCoastalBayRegion(27.8, -82.6);
      expect(region).toBe('Tampa Bay');
    });

    it('should detect Puget Sound', () => {
      const region = getMajorCoastalBayRegion(47.6, -122.3);
      expect(region).toBe('Puget Sound');
    });

    it('should detect Lake Okeechobee', () => {
      const region = getMajorCoastalBayRegion(26.9, -80.8);
      expect(region).toBe('Lake Okeechobee');
    });

    it('should return null for non-bay location', () => {
      const region = getMajorCoastalBayRegion(40.7128, -74.0060); // New York City
      expect(region).toBeNull();
    });
  });

  describe('NOAA Marine Source Detection', () => {
    it('should recommend NOAA for Great Lakes location', () => {
      const result = shouldUseNOAAMarine(44.7631, -85.6206); // Traverse City, MI
      expect(result.useNOAA).toBe(true);
      expect(result.region).toBe('Lake Michigan');
      expect(result.source).toBe('great-lakes');
    });

    it('should recommend NOAA for coastal bay location', () => {
      const result = shouldUseNOAAMarine(37.8, -122.4); // San Francisco Bay
      expect(result.useNOAA).toBe(true);
      expect(result.region).toBe('San Francisco Bay');
      expect(result.source).toBe('coastal-bay');
    });

    it('should recommend Open-Meteo for ocean location', () => {
      const result = shouldUseNOAAMarine(36.0, -76.0); // Atlantic Ocean
      expect(result.useNOAA).toBe(false);
      expect(result.region).toBeNull();
      expect(result.source).toBe('ocean');
    });

    it('should recommend Open-Meteo for international location', () => {
      const result = shouldUseNOAAMarine(51.5, -0.1); // London
      expect(result.useNOAA).toBe(false);
      expect(result.region).toBeNull();
      expect(result.source).toBe('ocean');
    });
  });

  describe('Marine Region Description', () => {
    it('should provide description for Great Lakes location', () => {
      const desc = getMarineRegionDescription(44.7631, -85.6206);
      expect(desc).toBe('Lake Michigan (Great Lakes)');
    });

    it('should provide description for coastal bay location', () => {
      const desc = getMarineRegionDescription(37.8, -122.4);
      expect(desc).toBe('San Francisco Bay (Coastal Bay)');
    });

    it('should provide description for ocean location', () => {
      const desc = getMarineRegionDescription(36.0, -76.0);
      expect(desc).toBe('Open ocean or coastal waters');
    });
  });

  describe('Region List Access', () => {
    it('should return all Great Lakes regions', () => {
      const regions = getGreatLakesRegions();
      expect(regions).toHaveLength(5);
      expect(regions.map(r => r.name)).toContain('Lake Superior');
      expect(regions.map(r => r.name)).toContain('Lake Michigan');
      expect(regions.map(r => r.name)).toContain('Lake Huron');
      expect(regions.map(r => r.name)).toContain('Lake Erie');
      expect(regions.map(r => r.name)).toContain('Lake Ontario');
    });

    it('should return all major coastal bay regions', () => {
      const regions = getMajorCoastalBayRegions();
      expect(regions.length).toBeGreaterThanOrEqual(5);
      expect(regions.map(r => r.name)).toContain('Chesapeake Bay');
      expect(regions.map(r => r.name)).toContain('San Francisco Bay');
    });

    it('should have valid bounding boxes for all regions', () => {
      const allRegions = [...getGreatLakesRegions(), ...getMajorCoastalBayRegions()];

      for (const region of allRegions) {
        expect(region.bbox.minLat).toBeLessThan(region.bbox.maxLat);
        expect(region.bbox.minLon).toBeLessThan(region.bbox.maxLon);
        expect(region.bbox.minLat).toBeGreaterThanOrEqual(-90);
        expect(region.bbox.maxLat).toBeLessThanOrEqual(90);
        expect(region.bbox.minLon).toBeGreaterThanOrEqual(-180);
        expect(region.bbox.maxLon).toBeLessThanOrEqual(180);
      }
    });
  });

  describe('isInUS', () => {
    it('should detect CONUS location (Denver, CO)', () => {
      expect(isInUS(39.7392, -104.9903)).toBe(true);
    });

    it('should detect Alaska (Anchorage)', () => {
      expect(isInUS(61.2181, -149.9003)).toBe(true);
    });

    it('should detect Hawaii (Honolulu)', () => {
      expect(isInUS(21.3069, -157.8583)).toBe(true);
    });

    it('should detect Puerto Rico (San Juan)', () => {
      expect(isInUS(18.4655, -66.1057)).toBe(true);
    });

    // The Commonwealth's extremes, not just its populated middle. get_river_conditions
    // renders a disclosure naming Puerto Rico from this predicate, so a box that stops
    // short of the island tells a caller in Puerto Rico that Puerto Rico is not covered.
    it('should detect the northwest tip of Puerto Rico (Punta Agujereada, 18.5208 N)', () => {
      // Just offshore of the northernmost land of the main island — above the old
      // 18.5 N edge. NWPS has 13 gauges within 50 km of here, nearest at 14.0 km.
      // The box must cover Puerto Rico's coastal water too, because the river
      // disclosure must not deny Puerto Rico there either. Note this coordinate's NWS
      // grid cell (SJU 74,136) is classified *marine*: `/gridpoints/.../forecast`
      // answers 404 "Forecasts for marine areas are not yet supported by this API",
      // so `get_forecast` here falls back to Open-Meteo (measured live 2026-08-29).
      // `isInUS` is still correctly true — it gates coverage, not NWS forecast support.
      expect(isInUS(18.5208, -67.15)).toBe(true);
    });

    it('should detect Mona Island, Puerto Rico (−67.89 W)', () => {
      // West of the old −67.3 edge, and still well east of the Dominican Republic.
      expect(isInUS(18.09, -67.89)).toBe(true);
    });

    it('should detect Isla Caja de Muertos, Puerto Rico (17.88 N)', () => {
      // South of the old 17.9 N edge, just off the island itself. Like the tip above,
      // this coordinate's grid cell (SJU 127,80) is a marine cell, so NWS serves no
      // land forecast for it; that does not make it any less inside the Commonwealth.
      expect(isInUS(17.88, -66.52)).toBe(true);
    });

    it('should still exclude St Croix, US Virgin Islands (−64.78 W)', () => {
      // The widened Puerto Rico box must not swallow the USVI: NWPS gauges 0 rivers
      // there, so it has to keep reaching the coverage disclosure (issue #86).
      expect(isInUS(17.7333, -64.7833)).toBe(false);
    });

    it('should still exclude the British Virgin Islands (Tortola)', () => {
      // Not US at all; east of the unchanged −65.2 edge.
      expect(isInUS(18.4207, -64.64)).toBe(false);
    });

    it('should still exclude the eastern Dominican Republic (Punta Cana)', () => {
      // −68.37 is west of the widened −67.95 edge, so the Mona Passage is not crossed.
      expect(isInUS(18.582, -68.4055)).toBe(false);
    });

    it('should return false for London, UK', () => {
      expect(isInUS(51.5074, -0.1278)).toBe(false);
    });

    it('should return false for Tokyo, Japan', () => {
      expect(isInUS(35.6762, 139.6503)).toBe(false);
    });

    it('should return false for Sydney, Australia', () => {
      expect(isInUS(-33.8688, 151.2093)).toBe(false);
    });

    it('should return false for a Canadian location well north of the CONUS box (Edmonton, AB)', () => {
      // lat 53.5 exceeds the CONUS max (49.4) and the Alaska box's longitude
      // range (<= -129.9) excludes Edmonton's -113.49, so neither box matches.
      expect(isInUS(53.5461, -113.4938)).toBe(false);
    });

    it('should return false for a Mexican location well south of the CONUS box (Mexico City)', () => {
      // lat 19.43 is well below the CONUS min (24.5); longitude keeps it out
      // of the Hawaii box despite the latitude overlap.
      expect(isInUS(19.4326, -99.1332)).toBe(false);
    });
  });

  describe('isInGreatBritain', () => {
    // This predicate is routing-only (see the doc comment on isInGreatBritain and
    // GOTCHAS G53): it decides whether a Nominatim reverse-geocode call is worth
    // making, never what a tool renders. These tests exercise the geographic
    // extremes it must cover generously and the one neighbor (Ireland) it must
    // exclude — they say nothing about EA coverage itself.

    it('should detect London', () => {
      expect(isInGreatBritain(51.5074, -0.1278)).toBe(true);
    });

    it('should detect York', () => {
      expect(isInGreatBritain(53.96, -1.08)).toBe(true);
    });

    it('should detect Sprouston-on-Tweed, on the Scottish border (55.611 N, -2.395 W)', () => {
      expect(isInGreatBritain(55.611, -2.395)).toBe(true);
    });

    it('should detect the Outer Hebrides (Stornoway)', () => {
      expect(isInGreatBritain(58.2091, -6.3862)).toBe(true);
    });

    it("should detect Land's End, Cornwall", () => {
      expect(isInGreatBritain(50.0657, -5.7132)).toBe(true);
    });

    it('should detect the Isles of Scilly', () => {
      expect(isInGreatBritain(49.91, -6.32)).toBe(true);
    });

    it('should detect Shetland, past 60.85 N (Out Stack, the northernmost point of the UK)', () => {
      // The edge most often clipped by an under-drawn GB box.
      expect(isInGreatBritain(60.8607, -0.8935)).toBe(true);
    });

    it('should return false for Dublin, Ireland', () => {
      // Dublin sits inside Ireland's latitude band (which Great Britain's own
      // England/Wales/Scotland band overlaps), so exclusion here depends on the
      // west edge of that middle band, not on latitude alone.
      expect(isInGreatBritain(53.35, -6.26)).toBe(false);
    });

    it('should return false for Paris, France', () => {
      expect(isInGreatBritain(48.85, 2.35)).toBe(false);
    });

    it('should return false for Reykjavik, Iceland', () => {
      expect(isInGreatBritain(64.15, -21.94)).toBe(false);
    });

    it('should return false for a mid-Atlantic point', () => {
      expect(isInGreatBritain(40.0, -40.0)).toBe(false);
    });
  });

  describe('isInNwsTerritory', () => {
    // Routing-only, exactly as isInGreatBritain is (see that predicate's doc block and
    // GOTCHAS G53): this decides whether ONE api.weather.gov alerts request is worth
    // making for the critical-alert banner, and nothing rendered anywhere is derived
    // from it. These cases are the measured edges of what NWS accepts, probed live on
    // 2026-09-18 — the table is in .devdocs/plan-nws-alert-jurisdiction.md. One `it`
    // per named place on purpose: a red tells you which edge moved.
    //
    // A false positive here is NOT free. It costs an HTTP 400 `out of bounds`, which
    // NOAAService.makeRequest logs as a securityEvent and throws on, the banner's catch
    // logs a second time, and getAlerts never caches a failure. That is why the boxes
    // are tight and why the "deliberately false" cases below are as load-bearing as the
    // true ones.

    // --- Guam (box 13.20-13.70 N, 144.60-145.00 E) ---

    it('should detect Hagatna, Guam', () => {
      // The same coordinates tests/unit/river-conditions-global.test.ts uses as
      // GUAM_POINT, so the suite carries one Guam fixture rather than two.
      expect(isInNwsTerritory(13.4443, 144.7937)).toBe(true);
    });

    it('should detect Ritidian Point, the northern tip of Guam', () => {
      expect(isInNwsTerritory(13.65, 144.86)).toBe(true);
    });

    it('should detect Cocos Island, off the southern tip of Guam', () => {
      expect(isInNwsTerritory(13.24, 144.65)).toBe(true);
    });

    // --- CNMI, southern arc only (box 14.05-15.35 N, 145.05-145.90 E) ---

    it('should detect Rota, CNMI', () => {
      expect(isInNwsTerritory(14.15, 145.2)).toBe(true);
    });

    it('should detect Aguijan, CNMI', () => {
      expect(isInNwsTerritory(14.85, 145.56)).toBe(true);
    });

    it('should detect Tinian, CNMI', () => {
      expect(isInNwsTerritory(15.0, 145.63)).toBe(true);
    });

    it('should detect Saipan, CNMI', () => {
      expect(isInNwsTerritory(15.185, 145.7467)).toBe(true);
    });

    // --- US Virgin Islands (box 17.60-18.45 N, -65.15 to -64.50) ---

    it('should detect St Croix, USVI', () => {
      // The same coordinates river-conditions-global.test.ts uses as
      // VIRGIN_ISLANDS_POINT. That tool reads isInUS, which is untouched here.
      expect(isInNwsTerritory(17.7333, -64.7833)).toBe(true);
    });

    it('should detect Point Udall, the easternmost point of the USVI', () => {
      expect(isInNwsTerritory(17.755, -64.565)).toBe(true);
    });

    it('should detect Charlotte Amalie, St Thomas', () => {
      expect(isInNwsTerritory(18.3419, -64.9307)).toBe(true);
    });

    it('should detect St John, USVI', () => {
      expect(isInNwsTerritory(18.33, -64.73)).toBe(true);
    });

    // --- American Samoa (main band -14.65 to -14.05 N, -171.00 to -168.05) ---

    it('should detect Pago Pago, Tutuila', () => {
      expect(isInNwsTerritory(-14.2756, -170.702)).toBe(true);
    });

    it('should detect Ta`u, the easternmost of the Manu`a group', () => {
      expect(isInNwsTerritory(-14.23, -169.45)).toBe(true);
    });

    it('should detect Rose Atoll, the eastern extreme of American Samoa', () => {
      expect(isInNwsTerritory(-14.55, -168.15)).toBe(true);
    });

    // --- American Samoa, Swains Island (separate pocket, -11.20 to -10.95 N) ---

    it('should detect Swains Island, ~350 km north of the main band', () => {
      // A second box, not a widened first one: the region between them is a
      // measured 400.
      expect(isInNwsTerritory(-11.06, -171.08)).toBe(true);
    });

    // --- Deliberately ALLOWED true, and the box is not to be tightened ---

    it('should read true for Tortola, BVI — allowed: inside the USVI box, NWS answers 200, nothing renders', () => {
      // Not US territory, but this predicate answers "will NWS accept an alerts
      // point here", and it does (measured 200). Because nothing is rendered off
      // this predicate, admitting the BVI costs nothing; tightening the box to
      // exclude it would risk clipping St Thomas and St John. Deliberate.
      expect(isInNwsTerritory(18.4207, -64.64)).toBe(true);
    });

    // --- False at the measured seams ---

    it('should return false at 15.2 N, 144.8 E — the merged Guam+CNMI corner NWS answers 400 for', () => {
      // The reason Guam and the CNMI are two boxes: the union of them is not the
      // accepted region, because the accepted region is not convex here.
      expect(isInNwsTerritory(15.2, 144.8)).toBe(false);
    });

    it('should return false for Anatahan, northern CNMI (NWS 400, out of bounds)', () => {
      expect(isInNwsTerritory(16.35, 145.67)).toBe(false);
    });

    it('should return false for Pagan, northern CNMI (NWS 400, out of bounds)', () => {
      // NWS rejects every point from 16.0 N north along 145.7 E. Excluded because
      // the service excludes it, not because it was forgotten.
      expect(isInNwsTerritory(18.1, 145.77)).toBe(false);
    });

    it('should return false for Apia, sovereign Samoa (NWS 400)', () => {
      expect(isInNwsTerritory(-13.83, -171.76)).toBe(false);
    });

    it('should return false for Anegada, BVI — north of the USVI box', () => {
      expect(isInNwsTerritory(18.73, -64.32)).toBe(false);
    });

    // --- False at the deliberate absences (recorded so nobody re-probes them) ---

    it('should return false for Wake Island — US-sovereign but outside NWS point bounds', () => {
      expect(isInNwsTerritory(19.3, 166.63)).toBe(false);
    });

    it('should return false for Midway Atoll — outside NWS point bounds', () => {
      // Note: Midway IS inside isInUS's Hawaii box, so the banner reaches getAlerts
      // there today and draws the 400. That is an isInUS false positive of the
      // Toronto class, deferred by the design plan — this predicate simply adds
      // nothing to it.
      expect(isInNwsTerritory(28.21, -177.38)).toBe(false);
    });

    it('should return false for Johnston Atoll — outside NWS point bounds', () => {
      expect(isInNwsTerritory(16.73, -169.53)).toBe(false);
    });

    it('should return false for Pohnpei, FSM — sovereign COFA state, out of scope', () => {
      // The alerts endpoint answers 200 for the COFA states and /points answers 500.
      // They are sovereign countries resolving to fm/pw/mh, deliberately absent from
      // this predicate and from the banner's country sets until someone asks.
      expect(isInNwsTerritory(6.92, 158.16)).toBe(false);
    });

    it('should return false for Koror, Palau — sovereign COFA state, out of scope', () => {
      expect(isInNwsTerritory(7.34, 134.48)).toBe(false);
    });

    it('should return false for Majuro, RMI — sovereign COFA state, out of scope', () => {
      expect(isInNwsTerritory(7.09, 171.38)).toBe(false);
    });

    // --- False at every point the isInUS block above uses ---

    it('should return false at every coordinate the isInUS block exercises', () => {
      for (const [name, lat, lon] of US_FIXTURES) {
        expect(isInNwsTerritory(lat, lon), name).toBe(false);
      }
      for (const [name, lat, lon] of NON_US_FIXTURES) {
        expect(isInNwsTerritory(lat, lon), name).toBe(false);
      }
    });

    // --- Disjointness with isInUS ---

    it('is disjoint from isInUS, and non-vacuously so — each side has positives', () => {
      // G13: the disjointness property alone is vacuous over a list where both
      // predicates are always false, so the same case asserts the positives that
      // make it mean something. The property holds BECAUSE each side has members.
      for (const [name, lat, lon] of [...US_FIXTURES, ...NON_US_FIXTURES, ...NWS_TERRITORY_FIXTURES]) {
        expect(isInUS(lat, lon) && isInNwsTerritory(lat, lon), name).toBe(false);
      }

      // The US list is true for isInUS...
      for (const [name, lat, lon] of US_FIXTURES) {
        expect(isInUS(lat, lon), name).toBe(true);
      }
      // ...and the territory list is true for isInNwsTerritory.
      for (const [name, lat, lon] of NWS_TERRITORY_FIXTURES) {
        expect(isInNwsTerritory(lat, lon), name).toBe(true);
      }
    });

    it('has adjacent but non-overlapping edges with the Puerto Rico box', () => {
      // isInUS's Puerto Rico box ends at -65.2 and this predicate's USVI box begins
      // at -65.15. They touch; they do not overlap. Both must be false in the gap.
      expect(isInUS(18.0, -65.175)).toBe(false);
      expect(isInNwsTerritory(18.0, -65.175)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle coordinates at Great Lakes boundary', () => {
      // Test coordinates very close to Lake Michigan boundary
      const result1 = shouldUseNOAAMarine(41.6, -87.8); // SW corner
      const result2 = shouldUseNOAAMarine(46.0, -84.8); // NE corner

      // Both should be detected as Lake Michigan
      expect(result1.region).toBe('Lake Michigan');
      expect(result2.region).toBe('Lake Michigan');
    });

    it('should handle coordinates just outside Great Lakes', () => {
      // Just south of Lake Michigan
      const result = shouldUseNOAAMarine(41.5, -87.8);
      expect(result.useNOAA).toBe(false);
    });

    it('should not overlap Great Lakes and coastal bays', () => {
      // Test that no coordinate can match both
      const testPoints = [
        [44.7631, -85.6206], // Traverse City
        [37.8, -122.4], // San Francisco Bay
        [46.7867, -92.1005], // Duluth
        [27.8, -82.6] // Tampa Bay
      ];

      for (const [lat, lon] of testPoints) {
        const greatLake = getGreatLakeRegion(lat, lon);
        const coastalBay = getMajorCoastalBayRegion(lat, lon);

        // A point should not be in both a Great Lake and a coastal bay
        expect(!(greatLake && coastalBay)).toBe(true);
      }
    });
  });
});
