# Almanac (Moon, Twilight, Records) — Design Plan

**Status:** IMPLEMENTED (2026-08-12, on `feat/almanac` for v1.16.0)
**Parent:** `docs/planning/FUTURE_ENHANCEMENTS.md` §1.1 (moon), §1.2 (twilight), §2.2 (records)
**Target release:** v1.16.0
**Branch (for /impl-plan):** `feat/almanac`
**Upstream verification:** live-tested 2026-08-12 — see the viability table in
`docs/planning/README.md`.

## What / Why

Three long-standing "context" ideas from the idea pool, bundled because they
share a theme (calendar/astronomical context for a location) and two share an
implementation (one new local-computation library):

1. **Moon phase** — phase name, illumination %, moonrise/moonset, next
   full/new moon ("will there be a full moon this weekend?").
2. **Extended twilight** — civil/nautical/astronomical dawn and dusk
   (photography, astronomy, "when does it get fully dark?").
3. **US record highs/lows** — record temperature for the date, with the year
   it was set ("is this a record high for today?").

**Settled 2026-08-12:** moon + twilight are computed locally with
`astronomy-engine`; they surface behind a new `include_astronomy` parameter on
`get_forecast`. Records ride the existing `include_normals` flag and use the
keyless RCC ACIS API.

## Design decisions (settled)

### D1. New dependency: `astronomy-engine`

- npm `astronomy-engine` (^2.1.x): MIT, **zero transitive dependencies**,
  ships its own `.d.ts`, ±1 arcminute accuracy (validated against NOVAS),
  valid years 1700–2200.
- Chosen over the alternatives verified live:
  - *Open-Meteo daily moon variables* (`moonrise`/`moonset`/`moon_phase`
    exist now — rise/set matched USNO within 1 min) — rejected for v1 because
    they cover only part of the need: phase is a raw 0–1 cycle fraction (no
    names, no illumination), there are **no twilight variables**, and no
    next-full/new-moon dates. Local math covers everything with zero API
    calls, zero cache, zero attribution.
  - *suncalc* — more downloads but approximate rise/set (± several minutes),
    `NaN` polar edge cases, and missing license metadata in the registry.
  - *USNO API* — works keyless but has a history of extended outages;
    unsuitable as a dependency.
- This is the project's first computational runtime dependency; it preserves
  the zero-cost, zero-key data model (design principle #5) because it is not
  a data source at all.

### D2. New utility: `src/utils/astronomy.ts`

Pure, deterministic functions (no I/O — instant, no caching, fully unit-testable):

```typescript
computeDayAstronomy(lat: number, lon: number, date: DateTime): DayAstronomy
// → { phaseName, illuminationPct, moonrise, moonset,
//     civilDawn, civilDusk, nauticalDawn, nauticalDusk,
//     astroDawn, astroDusk }   // all times nullable (polar cases)

nextMoonQuarters(from: DateTime): { nextFull: DateTime; nextNew: DateTime }
```

- Phase: `Astronomy.MoonPhase()` (0–360°) bucketed into the 8 standard names
  (New, Waxing Crescent, First Quarter, …); illumination from
  `Astronomy.Illumination().phase_fraction`.
- Rise/set: `Astronomy.SearchRiseSet(Body.Moon, …)`.
- Twilight: `Astronomy.SearchAltitude(Body.Sun, …)` at −6° / −12° / −18°.
- Next quarters: `Astronomy.SearchMoonQuarter()` iterated to the next
  full/new.
- **Polar handling is explicit:** search functions return `null` when the
  event doesn't occur; formatter renders "none (polar day)" / "none (polar
  night)" rather than omitting the line silently.
- All times converted to the forecast's IANA timezone via the existing Luxon
  patterns and rendered with `formatLuxonTime` (respects 12h/24h preference).

### D3. Surface: `include_astronomy` on `get_forecast`

- New optional boolean arg (default `false`), validated with
  `validateOptionalBoolean` like `include_normals`
  (`src/handlers/forecastHandler.ts:224`).
- When set, each daily entry gains a block immediately after the existing
  Sunrise/Sunset lines (`forecastHandler.ts:600–626`):

```
**Moon:** Waxing Gibbous (78% illuminated) · Rise 3:42 PM · Set 1:15 AM
**Twilight:** Civil 5:29 AM / 9:02 PM · Nautical 4:47 AM / 9:44 PM · Astronomical 3:58 AM / 10:33 PM
```

- Once per response (not per day), after the last day: 
  `**Next full moon:** Aug 27 · **Next new moon:** Sep 11`.
- Works on both the NOAA and Open-Meteo forecast paths (computation is
  provider-independent — it only needs lat/lon/date/timezone).
- `detail` interaction: none — the flag is the opt-in; both `basic` and
  `full` render the same astronomy block when requested (~40–60 tokens/day).
- Not added to `get_weather_summary` in v1 (summary stays lean); note as a
  possible `include_astronomy` pass-through later.
- Tool schema description gains the semantic triggers: "moon phase", "full
  moon", "moonrise", "golden hour", "when does it get dark".

### D4. Records: extend the `include_normals` path (US only)

- When `include_normals=true` **and** `isInUS(lat, lon)`, both
  `get_current_conditions` and `get_forecast` (day 1 only) append a records
  line after the normals comparison:

```
**Records for Aug 12:** High 96°F (1977) · Low 49°F (1953) — records since 1945
```

- New service `src/services/acis.ts` (RCC ACIS, keyless, no signup —
  verified live):
  - `findRecordsStation(lat, lon)`: `POST /StnMeta` with a ±0.25° bbox
    (widen once to ±0.5° on empty), `elems: "maxt,mint"`,
    `meta: "name,sids,ll,valid_daterange"`; pick the station with the longest
    period-of-record, preferring threaded IDs (`…thr`) which stitch the
    longest continuous records.
  - `getDailyRecords(stationId)`: one `POST /StnData` with
    `smry: {reduce: max/min, add: date}`, `smry_only: 1`,
    `groupby: "year"` — returns record + year for **all 366 day-of-year
    slots in a single call** (live-verified shape:
    `smry: [[["96","1977-08-12"], …366], [["49","1953-08-12"], …366]]`).
  - Day-of-year indexing uses the **leap calendar** (Aug 12 → index 224);
    Feb 29 is a real slot — no off-by-one on post-February dates in common
    years (index by month/day position in a leap year, not `DateTime.ordinal`).
- Caching (ACIS publishes no rate limits or ToS — be a good citizen, cache
  hard): `CacheConfig.ttl.records = 7 * DAY` for the 366-day records table
  (records change at most when a record is broken — a stale week is
  acceptable for trivia context), `ttl.recordsStation = 30 * DAY` for
  StnMeta results.
- **Records are garnish, never load-bearing:** any ACIS failure (down,
  malformed, no station found) logs a `warn` and silently omits the records
  line. The tool call never fails because of records. Timeout: reuse the
  standard API timeout; requests are sequential with the existing normals
  fetch, both behind the same flag.
- Non-US + `include_normals`: behavior unchanged (no records line —
  consistent with normals' own US-only NCEI sourcing).
- Attribution footer line when records render: "Records: NOAA Regional
  Climate Centers (ACIS)".
- Types: `src/types/acis.ts` (`AcisStnMetaResponse`, `AcisStnDataResponse`,
  parsed `DailyRecords`). Values arrive as strings (`"96"`, `"M"` for
  missing, `"T"` for trace) — parse defensively; `"M"` records → omit that
  side of the line.

### D5. What this bundle does NOT include

- No new MCP tool (design principle #1 — parameters over proliferation; the
  `get_astronomy` tool option was considered and rejected 2026-08-12).
- No moonrise/set or twilight via any network API.
- No international records (no viable free source; normals parity).
- No astrology, tides, or satellite-pass data (out of scope).

## Testing

- **Unit — astronomy** (`tests/unit/astronomy.test.ts`): golden-value tests
  against USNO-published times (e.g. Seattle 2026-08-12: new moon,
  moonrise ≈ 5:48 AM PDT — tolerance ±3 min); phase-name bucket boundaries;
  illumination at known quarters (0/50/100%); polar cases (Tromsø in June:
  null astro twilight and "polar day" rendering); 12h/24h formatting.
  All pure — no mocks, must stay well inside the <2 s suite budget.
- **Unit — records** (`tests/unit/acis-records.test.ts`): day-of-year
  indexing incl. Feb 29 and post-Feb dates in common years; station
  selection (longest POR, `thr` preference, bbox widening); `"M"`/`"T"`
  value handling; formatting; graceful-omission on error.
- **Unit — handler:** `include_astronomy` validation and block placement;
  records line appears only with `include_normals` + US.
- **Integration:** mocked ACIS responses (StnMeta + StnData shapes captured
  from the live verification); one live ACIS smoke test (flake-tolerant).

## Documentation / registration checklist

- [x] `package.json`: add `astronomy-engine` (runtime dep)
- [x] `src/index.ts`: `include_astronomy` in the `get_forecast` schema;
      `include_normals` descriptions mention records (US)
- [x] README.md: feature list + example queries
- [x] CHANGELOG.md (entry under `[Unreleased]` per repo convention — version
      bump happens at release)
- [x] `docs/planning/README.md`: flip the three idea rows 📝 → ✅
- [x] CLAUDE.md: note the new dependency and the records/ACIS service
