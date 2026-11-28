/**
 * Point-override boxes for the places where `tz-lookup` is a calendar day wrong, and
 * for one place where it is an hour wrong: the Adak/Nome line at Umnak, which
 * `tz-lookup` draws on a meridian near −168.75 while the real line runs diagonally
 * through Samalga Pass, so Nikolski reads `America/Adak` instead of `America/Nome`.
 *
 * `tz-lookup` 6.1.25 (pinned in `package.json`) stores coarse polygons, and at the
 * date line coarse is not an hour off but a whole day: Tutuila resolves to
 * `Pacific/Apia` (UTC+13) instead of `Pacific/Pago_Pago` (UTC−11), Fakaofo to
 * `Pacific/Pago_Pago` instead of `Pacific/Fakaofo`, and Gambell to `Asia/Anadyr`
 * instead of `America/Nome`. `guessTimezoneFromCoords` (`./timezone.ts`) consults
 * {@link timezoneOverrideFor} first and falls through to `tz-lookup` everywhere
 * else, so a point outside every box keeps `tz-lookup`'s answer by construction.
 *
 * **These boxes assert a rendered zone.** Every alert time, banner expiry and
 * fallback forecast day at a point inside one is rendered in the box's zone. They
 * were measured on 2026-11-27 against `geo-tz` 8.1.10 (full-resolution
 * timezone-boundary-builder polygons) at 0.01°: every non-`Etc/` zone `geo-tz`
 * reports inside a box is that box's zone, and the neighbours that must stay out
 * (Apia, Upolu's east tip, Big Diomede, Swains, Atka and the Hawaii–Aleutian side of
 * Samalga Pass) do. Re-measure before editing an
 * edge — see the GOTCHAS entry for the sweep method.
 *
 * **They are owned by the zone question.** Never derive them from, or merge them
 * with, `isInNwsTerritory` or `isInUS` (`./geography.ts`): those are routing
 * predicates whose edges were drawn for a different question (where
 * api.weather.gov answers 400; which upstream to ask), and GOTCHAS G53 is what
 * happens when a routing edge starts deciding rendered output.
 *
 * **Why the Little Diomede west edge is −168.975.** The US–Russia line runs at
 * −168.978 between the two Diomedes; `geo-tz` reads `Asia/Anadyr` at −168.980 and
 * `America/Nome` at −168.975 across the whole box latitude.
 *
 * **Why the Umnak west edge is −169.34.** It is 0.01° east of the furthest-east
 * `America/Adak` point `geo-tz` holds in the area (−169.35), so no Adak point is inside
 * the box. The cost is an open-water wedge in Samalga Pass (lat 52.57–53.08, lon
 * −169.49 to −169.34; 462 points at 0.01°) that keeps `tz-lookup`'s Adak answer. A
 * west edge at −169.5 would put 504 Adak points inside the box.
 *
 * Open sea inside a box gets the box's zone rather than a nautical `Etc/GMT±n`
 * zone, deliberately — a caller asking about the water off Tutuila wants Samoa
 * local time, which is also what Open-Meteo answers there.
 *
 * Pure and zero-I/O.
 */

export interface TimezoneOverrideBox {
  /** For this docblock and test names only — never rendered. */
  readonly place: string;
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
  /** IANA zone identifier. */
  readonly zone: string;
}

function box(
  place: string,
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
  zone: string
): TimezoneOverrideBox {
  return Object.freeze({ place, minLat, maxLat, minLon, maxLon, zone });
}

/**
 * The override table. Bounds are inclusive on all four sides, and no two boxes
 * overlap, so lookup order never matters.
 *
 * No box crosses the antimeridian, which is why a plain `min <= x <= max` test is
 * correct. A box that must cross ±180 has to be split in two, not given
 * `minLon > maxLon`.
 */
export const TIMEZONE_OVERRIDE_BOXES: readonly TimezoneOverrideBox[] = Object.freeze([
  box('American Samoa — Tutuila, Aunu‘u, Manu‘a, Rose Atoll', -14.8, -14.0, -171.1, -167.9, 'Pacific/Pago_Pago'),
  box('Tokelau', -9.7, -8.4, -172.7, -170.9, 'Pacific/Fakaofo'),
  box('St Lawrence Island', 62.8, 64.0, -172.25, -168.4, 'America/Nome'),
  box('Little Diomede and US waters north of it', 65.6, 66.0, -168.975, -168.7, 'America/Nome'),
  box('Russian waters south of Big Diomede', 65.36, 65.64, -170.65, -168.98, 'Asia/Anadyr'),
  box('Umnak, Samalga and Nikolski (Alaska time east of Samalga Pass)', 52.5, 53.5, -169.34, -168.7, 'America/Nome'),
]);

/**
 * The override zone for a coordinate, or `undefined` when no box contains it.
 * A non-finite coordinate matches no box (every comparison is false).
 */
export function timezoneOverrideFor(latitude: number, longitude: number): string | undefined {
  for (const b of TIMEZONE_OVERRIDE_BOXES) {
    if (latitude >= b.minLat && latitude <= b.maxLat && longitude >= b.minLon && longitude <= b.maxLon) {
      return b.zone;
    }
  }
  return undefined;
}
