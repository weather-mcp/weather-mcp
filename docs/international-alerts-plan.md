# International Alerts (MeteoAlarm + MSC GeoMet) — Design Plan

**Status:** Settled — ready for `/impl-plan`
**Parent:** `docs/planning/INTERNATIONAL_COVERAGE_ROADMAP.md` Phase 3;
planning-index row "International alerts (MeteoAlarm, MSC GeoMet, WMO CAP)"
**Target release:** v1.19.0
**Branch (for /impl-plan):** `feat/international-alerts`
**Upstream verification:** live-tested 2026-08-12 (viability pass, recorded in
`docs/planning/README.md`) and re-verified 2026-08-13 while settling this plan —
see the Verified API contract section below. The re-verification corrected the
GeoMet field names the roadmap had recorded.

## What / Why

`get_alerts` is the most prominent remaining US-only safety tool. Its
description opens with "(US only)" (`src/index.ts:355`), and
`get_weather_summary` hard-codes a short-circuit for non-US points
(`src/handlers/weatherSummaryHandler.ts:121-132`):

```
## Alerts

Weather alerts are currently available for US locations only.
```

Meanwhile the upstream sources for two large regions are free, keyless, and
live-verified: **MeteoAlarm** aggregates the official national warnings of
~35 European met services as per-country CAP JSON feeds, and **MSC GeoMet**
serves Environment and Climate Change Canada alerts as an OGC API Features
collection with real polygons and native bbox filtering. Rest-of-world (WMO
SWIC / Alert-Hub) was evaluated and is **not production-usable** (undocumented
demo feeds, no geometry, no redistribution grant) — those regions get a clean
"not yet covered" message instead.

Fix: route `get_alerts` by **country** — US → NOAA (unchanged), Canada →
GeoMet, MeteoAlarm member countries → the country's MeteoAlarm feed, elsewhere
→ a friendly coverage message. No new tool, no key, no cost.

**Scope decisions (2026-08-13, confirmed with the user):**
- Coordinate-only requests resolve their country via **Nominatim reverse
  geocoding** (country-level, cached permanently) — accuracy at borders matters
  for a safety tool, and the `isInUS` boxes deliberately overrun into Canada
  (Toronto and Vancouver currently test as US).
- European matching is **country-level in v1**. The keyless MeteoAlarm feeds
  carry EMMA/NUTS geocodes but no polygons, so sub-country filtering would
  require bundling region geometry — deferred (see D9).

**The design tension:** alert authority is jurisdictional, not geometric. A
point 2 km inside France must get Météo-France warnings, not DWD's — so the
router needs a real country answer, not a bounding box. But the project has no
reverse geocoding today, and the alerts path must not break the one offshore
case that works now (NOAA marine alerts for US coastal waters, where reverse
geocoding returns *no* country). D1/D2 resolve this ordering carefully.

## Verified API contract (live 2026-08-13)

### MeteoAlarm (Europe)

Base: `https://feeds.meteoalarm.org/api/v1/warnings/feeds-<country>` — keyless
JSON, one country per fetch, no pan-Europe aggregate. (`api.meteoalarm.org`
returns 401 without a MeteoGate registration token — not used.) Slugs are
hyphenated lowercase English names — verified: `feeds-germany`,
`feeds-france`, `feeds-united-kingdom`.

Shape: `{ warnings: [ { alert: <CAP>, uuid } ] }`. The `alert` object is
CAP-shaped: `identifier`, `sender`, `sent`, `status`, `msgType`, `scope`,
`info[]`, and `references` (present **only** on `msgType: "Update"`).
Each `info[]` entry carries `language`, `event`, `severity`, `urgency`,
`certainty`, `onset`, `expires`, `headline`, `description`, `instruction`,
`senderName`, `web`, `responseType`, `area[]` (with `areaDesc` and
EMMA_ID/WARNCELLID geocodes — **no polygons**), and `parameter[]` including
`awareness_level` (`"2; yellow; Moderate"`) and `awareness_type`
(`"5; high-temperature"`).

Load-bearing behaviours, all observed live:

- **`info[]` is duplicated per language** — Germany carried 8 variants
  (`de-DE`, `en`, `fr`, `es`, `ar`, `ru`, `tr`, `pl`). Filter to `en`
  (prefix match, e.g. `en`/`en-GB`), falling back to the first entry.
- **Feeds contain expired warnings.** Germany's 161 warnings included items
  expired 4 days earlier; only 51 remained after filtering
  `expires > now`. Client-side expiry filtering is mandatory.
- **Supersession is trackable**: `Update` messages carry `references` to the
  identifiers they replace. After expiry filtering, drop any warning whose
  `identifier` is referenced by another surviving warning.
- **Severity uses the CAP vocabulary** (`Minor`/`Moderate`/`Severe`/`Extreme`)
  — it maps directly onto the existing NOAA severity ordering.
- **Payloads are large and uncompressed**: Germany 2.76 MB, France 727 KB, UK
  20 KB; the server ignored `Accept-Encoding: gzip` (same byte count). The
  5-minute alerts cache TTL is what makes this affordable; parse once, cache
  the parsed result, and never cache per-request.
- Timestamps carry their own local offsets (`2026-08-09T09:21:00+02:00`).
- Terms (strict): display alerts **unmodified**, attribute
  "EUMETNET – MeteoAlarm" (plus the national service for a single-country
  view), and include the time of issue.

### MSC GeoMet (Canada)

Base: `https://api.weather.gc.ca/collections/weather-alerts/items` — keyless
OGC API Features, `f=json`, native `bbox=minLon,minLat,maxLon,maxLat` works,
features carry real `Polygon` geometry. 329 features nationwide at check time;
zero-result bbox returns HTTP 200 with `numberMatched: 0` (not an error).

**Not CAP-shaped, and the roadmap's recorded field names were wrong** — the
real properties (verified live) are: `alert_type` (e.g. `statement`),
`alert_name_en`/`_fr`, `alert_short_name_en`, `alert_text_en`/`_fr` (the body),
`feature_name_en`/`_fr` (the area), `province`, `status_en`/`_fr` (observed:
`"ended"` — ended items **remain in the collection** and must be filtered),
`risk_colour_en`, `confidence_en`, `impact_en`, `publication_datetime`,
`validity_datetime`, `event_end_datetime`, `expiration_datetime`,
`alert_code`, `feature_id`. No severity/urgency/certainty anywhere.

Terms: attribute Environment and Climate Change Canada; alert content must not
be altered.

### Nominatim reverse geocoding (country resolution)

`https://nominatim.openstreetmap.org/reverse?lat=&lon=&format=jsonv2&zoom=3` —
`zoom=3` returns **country-level only** (verified: Munich →
`{addresstype: "country", address.country_code: "de"}`, Toronto → `"ca"`),
which is the privacy-minimal request for this purpose. Open ocean returns
HTTP 200 with `{"error": "Unable to geocode"}` — a result, not a failure.
Same 1 req/s policy as forward geocoding (the existing `NominatimService`
limiter applies).

## Design decisions (settled)

### D1. Routing: by country, with the offshore escape hatch

Order of resolution in `alertsHandler.ts`:

1. **Country already known** — the location came from a `city_name` geocode or
   a saved location whose `country_code` is stored. Use it (see D2 threading).
2. **Coordinates only** — call the new cached reverse-country lookup (D2).
3. **Reverse says "no country"** (open water) or the lookup fails → fall back
   to `isInUS(lat, lon)`: true → NOAA (this preserves today's working case of
   NOAA marine alerts for US coastal waters), false → the not-covered message
   (with a one-line note if the lookup *errored* rather than returned empty).

Then route: `US` → NOAA (existing path, byte-identical output), `CA` → GeoMet,
country in the MeteoAlarm member map → that country's feed, anything else →
not-covered message. The reverse-geocode answer **wins over `isInUS`** — that
is the whole point: Toronto (inside the deliberately sloppy CONUS box) resolves
to `ca` and gets ECCC alerts instead of a wrong-country NOAA query.

**No `source` parameter in v1.** Unlike current conditions and rivers, alert
authorities do not overlap — a US point has no MeteoAlarm feed and a German
point has no NWS zone, so an override could only select an empty or wrong
source. If a use case appears (e.g. border towns wanting the neighbour's
warnings), it can be added later without breaking anything.

### D2. Country resolution infrastructure

- `ResolvedLocation` (`src/utils/locationResolver.ts:19-24`) gains
  `country_code?: string`. The geocoded path already has it in hand
  (`GeocodingResult.country_code`, `src/services/geocoding.ts:44-45`) and
  currently **discards it** — thread it through, including the
  `CachedCityGeocode` shape, and from saved locations
  (`src/types/savedLocations.ts:17-18`). Pure plumbing; nothing else reads the
  new field, so no existing output changes.
- New `NominatimService.reverseCountry(lat, lon): Promise<string | null>` in
  `src/services/nominatim.ts` — `format=jsonv2&zoom=3`, existing 1 req/s
  limiter and User-Agent, `{"error": "Unable to geocode"}` → `null`.
- Cache: key on coordinates rounded to 2 decimals (~1.1 km), TTL **Infinity**
  (countries don't move) — new `CacheConfig.ttl.reverseCountry` in
  `src/config/cache.ts`.
- Privacy note for the docs: this is the project's first reverse geocode; the
  `zoom=3` request asks only "which country", the same class of disclosure as
  the forward geocoding the server already performs, and the analytics
  privacy stance (`src/utils/geography.ts:258`) is untouched — analytics keeps
  its coarse offline bucketing.

### D3. New service: `src/services/meteoalarm.ts`

`MeteoAlarmService`, following the retry/backoff/sanitized-error shape of
`acis.ts`/`nifc.ts`:

```typescript
getWarnings(countryCode: string): Promise<MeteoAlarmWarning[]>
```

- A static `ISO country code → feed slug` map for the MeteoAlarm membership
  (~35 entries, e.g. `de → germany`, `gb → united-kingdom`, `fr → france`).
  Building this table — and **live-verifying every slug** — is an explicit
  implementation task; the three above are already verified. A country missing
  from the map is simply "not covered" (routes to the D1 message), so an
  incomplete map degrades gracefully.
- Fetch the country feed, then in order: pick the `en` (else first) `info[]`
  entry per warning; drop `expires <= now`; drop warnings referenced by a
  surviving `Update` (supersession); drop `status !== "Actual"` and
  `msgType: "Cancel"` if observed.
- Parse `awareness_level` into the MeteoAlarm colour (`yellow`/`orange`/`red`)
  — Europeans know the colour system, so it renders alongside CAP severity.
- Cache the **parsed, filtered-for-expiry-at-read-time** country result under
  `Cache.generateKey('meteoalarm', countryCode)`, existing
  `CacheConfig.ttl.alerts` (5 min). One 2.8 MB fetch per country per 5 minutes
  is the worst case; never fetch per-request without the cache in front.

### D4. New service: `src/services/geomet.ts`

`GeoMetService`, same construction:

```typescript
getAlerts(latitude: number, longitude: number): Promise<GeoMetAlertFeature[]>
```

- Query `weather-alerts/items` with a small bbox (±0.25°) around the point,
  `f=json`. OGC bbox intersects feature geometry, so nearby-but-not-overhead
  polygons can appear — the output always names the affected area
  (`feature_name_en`), making any over-inclusion visible rather than silent.
  (Client-side point-in-polygon is deliberately out of scope — no geometry
  library exists in this project and the bbox is tight.)
- Filter `status_en` values meaning ended/expired, and anything past
  `expiration_datetime`.
- English fields (`_en`) with the French text available at `detail: 'full'`
  is **not** done in v1 — English only, one language, keep it lean.
- Cache: bbox rounded into the key, `CacheConfig.ttl.alerts` (5 min).
- `numberMatched: 0` is the happy empty path, not an error.

### D5. Rendering: per-source blocks, NOAA path untouched

The NOAA rendering code in `alertsHandler.ts:58-142` is **not modified** — the
US output stays byte-identical, locked by `tests/unit/alerts-detail.test.ts`
passing unedited (the composited-imagery precedent). The two new sources get
their own formatters in the handler, reusing the same severity ordering/emoji
conventions where the source actually supplies severity:

**MeteoAlarm** (CAP-shaped, so visually close to the NOAA blocks):

```
# Weather Alerts — Germany

**Location:** Munich, Bavaria, Germany
**Coverage note:** European alerts are matched at country level — regional
filtering is not yet available. Warnings below may not affect Munich.

⚠️ 51 active warnings for Germany

🟠 **Heat Warning** — Orange (Severe)
---
**Headline:** Official WARNING of HEAT
**Severity:** Severe | **Urgency:** Immediate | **Certainty:** Likely
**Area:** Kreis Südwestpfalz und Stadt Pirmasens
**Issued:** 2026-08-13 09:21 (+02:00)
**Expires:** 2026-08-14 19:00 (+02:00)
...

---
*Data source: EUMETNET – MeteoAlarm (national warnings: Deutscher Wetterdienst).
Alerts shown unmodified as issued; times as published.*
```

- Sorted by CAP severity (existing Extreme→Unknown order), then by expiry.
- Display caps follow the v1.13 pattern: `standard` shows the top 10,
  `full` up to 25, both with a disclosed remainder count ("…and N more
  warnings, mostly Minor"). `summary` shows counts by severity/colour only.
  Country feeds routinely carry 50+ warnings — caps are load-bearing here.
- CAP text fields (headline/description/instruction) render **verbatim** and
  the issue time is always shown — both are licence terms, and the existing
  renderer already behaves this way for NOAA.

**GeoMet** (not CAP-shaped — render what ECCC provides, invent nothing):

```
🔶 **Heat Warning** (warning)
---
**Area:** City of Toronto
**Risk:** Orange | **Confidence:** High
**Issued:** ... | **Ends:** ...

<alert_text_en, verbatim, at standard and full detail>
```

- Sort by `alert_type` rank (warning > watch > advisory > statement), then
  recency. No fabricated Severity/Urgency/Certainty lines.
- Footer: `*Data source: Environment and Climate Change Canada (MSC GeoMet).
  Alert content shown unaltered.*`

**Both paths** skip the NOAA `getStations` timezone side-call (a wasted,
silently-failing US-only round-trip for non-US points — `alertsHandler.ts:39-51`);
timestamps render in the offset the source published, which the licence terms
favour anyway.

### D6. `active_only` semantics on the new sources

Both new sources publish only current warnings (plus stale items we filter).
`active_only: true` (the default) is therefore the natural behaviour;
`active_only: false` renders the same result plus a one-line note that
historical alerts are not available for this region. No error, no silent
ignoring.

### D7. `get_weather_summary` integration

Delete the US-only short-circuit (`weatherSummaryHandler.ts:121-132`) and call
the alerts section unconditionally: the handler itself now produces a graceful
answer everywhere (alerts, or the not-covered message). The summary's alerts
section for a not-covered region shows the handler's own message. The existing
test asserting the short-circuit (`tests/unit/weather-summary-handler.test.ts:128-136`)
is **updated intentionally** — that is a designed behaviour change, not a
regression.

One wrinkle: the summary already resolved the location once, and per-section
handlers re-resolve. The alerts handler receives coordinates from the summary
today; the reverse-country lookup (cached, 1 req/s) adds at most one extra
upstream call per new location — acceptable, no special-casing.

### D8. Attribution and licence compliance (these are terms, not decoration)

| Source | Obligation | Where honoured |
|--------|-----------|----------------|
| MeteoAlarm | Unmodified display; "EUMETNET – MeteoAlarm" attribution (+ national service); time of issue shown | D5 renderer: verbatim CAP text, footer names both, Issued line always present |
| MSC GeoMet | ECCC attribution; content unaltered | D5 renderer: `alert_text_en` verbatim, ECCC footer |
| Nominatim | Identifying User-Agent, 1 req/s | Existing `NominatimService` policy reused |

### D9. Out of scope for v1

- **Rest-of-world alerts** — WMO SWIC/Alert-Hub verified not production-usable
  (demo feeds, no geometry, no redistribution grant). Watch KDE's FOSS Public
  Alert Server as a future aggregator. Not-covered regions get the clean
  message.
- **Sub-country European matching** — requires bundling EMMA/NUTS geometry
  (size, sourcing, licence checks). The user chose country-level for v1; the
  coverage note in D5 makes the granularity explicit. Revisit on feedback.
- **A `source` override parameter** — see D1; authorities don't overlap.
- **French output on GeoMet** — English only in v1.
- **MeteoGate registered API** (polygons, pan-Europe queries) — requires
  registration; would break the zero-key model for marginal v1 gain.
- **`check_service_status` entries** for the new services — the status tool
  checks only NOAA + Open-Meteo today (NIFC/ACIS/aviationweather are also
  absent); extending it is a separate, pre-existing gap.
- **UK Environment Agency flood warnings** — separate planned idea (rivers
  supplement), not an alerts source.

## Edge cases

| Case | Behavior |
|------|----------|
| Toronto / Vancouver (inside the sloppy `isInUS` boxes) | Reverse-country says `ca` → GeoMet. The border-overrun misroute this tool would otherwise inherit is fixed by design |
| Basel / Geneva (metres from a border) | Reverse-country decides; the country of the *point* wins. Neighbour-country warnings are out of scope (D1) |
| US coastal waters (reverse → no country) | `isInUS` fallback → NOAA, preserving today's marine-alert behaviour |
| Mid-ocean, non-US | No country + `isInUS` false → not-covered message |
| Reverse geocode network failure | Fall back to `isInUS` routing with a one-line note; never an error |
| European country not in the slug map (e.g. not a MeteoAlarm member) | Not-covered message naming the region |
| Country feed with zero unexpired warnings | "No active weather alerts for `<Country>`" happy path |
| Feed contains only expired/superseded items | Same as zero — filtered before counting |
| Warning with no `en` info entry | First `info[]` entry renders, in its own language, unmodified |
| GeoMet `status_en: "ended"` items | Filtered out |
| GeoMet bbox catches a neighbouring polygon | Rendered with its own `feature_name_en` — visible, not misleading |
| `active_only: false` outside the US | Current alerts + "historical alerts not available for this region" note |
| Saved location with stored `country_code` | No reverse geocode call at all |

## Testing

- **Unit — routing** (`tests/unit/alerts-routing.test.ts`): country wins over
  `isInUS` (Toronto → GeoMet); coordinate-only → reverse lookup consulted;
  stored/geocoded `country_code` skips reverse; no-country + `isInUS` → NOAA;
  no-country + not US → message; reverse failure → fallback + note.
- **Unit — MeteoAlarm parsing** (`tests/unit/meteoalarm.test.ts`): fixtures
  captured from the live Germany/UK feeds — language selection (en prefix,
  fallback), expiry filtering, `references` supersession, awareness-level
  colour parsing, severity sort, display caps with remainder counts, empty
  feed.
- **Unit — GeoMet mapping** (`tests/unit/geomet.test.ts`): fixture from the
  live nationwide response — field mapping, ended filtering,
  `numberMatched: 0`, alert_type ranking.
- **Unit — reverse country** (`tests/unit/reverse-country.test.ts`): jsonv2
  parsing, "Unable to geocode" → null, cache key rounding, Infinity TTL.
- **Unit — NOAA regression lock:** `tests/unit/alerts-detail.test.ts` and
  `tests/unit/alert-sorting.test.ts` pass **unedited** — the US path
  no-change guarantee.
- **Unit — summary:** `weather-summary-handler.test.ts` short-circuit
  assertions replaced with covered-region (mocked) and not-covered cases.
- **Integration** (`tests/integration/international-alerts.test.ts`): mocked
  responses against captured shapes; one live smoke test per source following
  the flake-tolerant convention (note: adds to the live-network test set —
  see the standing flaky-tests caveat).

**Acceptance (live, against the built dist):**

1. Munich (`city_name` and raw coordinates both) returns German warnings with
   the country-level coverage note, MeteoAlarm + DWD attribution, and issue
   times.
2. Toronto (raw coordinates) routes to GeoMet — ECCC alerts or the clean empty
   message, **not** a NOAA response.
3. Seattle output is byte-identical to `main` for the same arguments.
4. Sydney returns the not-covered message naming the region, not an error.
5. A US offshore point (e.g. 10 km off the Washington coast) still returns
   NOAA alerts.
6. `get_weather_summary` for Paris renders a real alerts section; for Sydney
   it renders the handler's not-covered message.
7. Two consecutive Munich calls hit the 5-minute country-feed cache (verify
   via debug logs — the 2.8 MB class fetch happens once).

## Documentation / registration checklist

- [ ] `src/index.ts`: rewrite the `get_alerts` description — remove "(US
      only)", state the three-region coverage and country-level European
      granularity, keep semantic triggers
- [ ] `src/index.ts` `main()`: construct `MeteoAlarmService`/`GeoMetService`,
      pass through the `get_alerts` and summary dispatch
- [ ] README.md: tool table, coverage notes, feature highlight, test-count
      badge
- [ ] CHANGELOG.md under `[Unreleased]`
- [ ] `docs/TOOLS.md`: `get_alerts` section — coverage map, per-source output
      shapes, licence attributions
- [ ] `docs/planning/README.md`: flip the international-alerts row 💡 → ✅ at
      ship (📝 now, linking this doc); update the ICR Phase 3 sequencing row
- [ ] CLAUDE.md: new services in the architecture tree, status blurb, "US
      only" claims for alerts corrected everywhere they appear
- [ ] Move this plan set to `docs/plans/` at completion
