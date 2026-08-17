# Global Normals Hardening — Design Plan

**Status:** 📝 Planned (see [planning index](./planning/README.md))
**Target:** next minor release after v1.21.0
**Prereq reading:** `src/utils/normals.ts`, `src/services/openmeteo.ts` `getClimateNormals`, ICR §Phase 5

## What / Why

The planning index carried "Global climate normals (Open-Meteo archive outside
US)" as an open 💡 idea, and the International Coverage Roadmap's current-state
table listed normals as "NCEI, US stations only". **Both are stale.** Design
exploration (2026-08-17) found that `include_normals` has been global since
v1.2.0: `getClimateNormals` (`src/utils/normals.ts:243`) tries NCEI only when
an `NCEI_API_TOKEN` is configured *and* the point passes a contiguous-US box,
and otherwise falls back unconditionally to
`OpenMeteoService.getClimateNormals` (`src/services/openmeteo.ts:1611`), which
computes 1991–2020 normals from the archive API for any coordinates on Earth.
The project ships keyless, so **the "fallback" is the path virtually every
caller is already on** — US included.

This is the same pattern as FE §1.1's stale "no moon API" claim: the blocker
dissolved without the docs noticing. What remains is not a coverage feature but
a **hardening pass** on the path everyone uses, because exploration also found
real defects in it:

1. **The "±1 month optimization" is illusory.** The archive request spans
   `1991-<m-1>-01` … `2020-<m+1>-<last>` as one contiguous range, so the API
   returns every interior day of all 30 years anyway (live-verified: 10,685
   days for an August request). Only the leading/trailing months of the whole
   span are trimmed. The comment at `openmeteo.ts:1638` misleads.
2. **Cache cardinality × eviction.** Normals are cached per
   `(lat2dp, lon2dp, month, day)` — up to 366 keys per location — inside a
   per-instance in-memory LRU capped at `CacheConfig.maxSize` (default 1000).
   "TTL Infinity" still evicts under pressure, and each evicted date costs a
   full 30-year archive pull to recompute. `src/config/cache.ts` has no
   `normals` entry (the Infinity is hardcoded at two call sites).
3. **No rate-limit posture.** Open-Meteo weights archive calls by period
   length; the 2026-08-12 ICR live check tripped the 600/min limit with two
   consecutive 30-year pulls. A 429 today throws `RateLimitError` immediately
   (no retry, no dedupe of concurrent identical pulls), and the handler's
   catch renders the unavailable note.
4. **Two divergent US predicates.** `isLocationInUS` (`normals.ts:216`,
   contiguous-only: 24–50 N, −125 … −66 W) exists solely to gate the NCEI
   attempt, duplicating `isInUS` (`src/utils/geography.ts:322`, which also
   covers AK/HI/PR). An NCEI-token user in Anchorage or Honolulu silently
   never gets NCEI normals.
5. **Render duplication and drift.** Five near-identical render blocks
   (`forecastHandler.ts:559,795`; `currentConditionsHandler.ts:605,890,1220`);
   the success heading is `## 📊 Climate Context` but the failure path uses
   `## Climate Normals`; the Open-Meteo path rounds °C→°F to integers at
   compute time, so metric users get a lossy °C→°F→int→°C round-trip; the
   Open-Meteo path has no Feb 29 handling (NCEI does, `ncei.ts:156`).
6. **The international guarantee isn't tested.**
   `tests/unit/current-conditions-global.test.ts:688` accepts *either* a
   rendered normals section *or* the unavailable note, so it passes even if
   non-US normals silently break.

ACIS records (`**Records for <date>:**`) are confirmed independent garnish —
own try/catch, gated on `isInUS(…) && acisService`, `getRecordsLine` never
throws — and are **untouched** by this plan.

## Live verification (2026-08-17)

All requests against `archive-api.open-meteo.com/v1/archive`, daily
`temperature_2m_max,temperature_2m_min,precipitation_sum`, `timezone=UTC`:

| Request | Result |
|---------|--------|
| Current shape (Paris, `1991-07-01`…`2020-09-30`, an August month±1 window) | HTTP 200, **292,249 B**, 1.08 s, **10,685 days** returned — interior days (e.g. `1995-01-15`) present, confirming the trim is edge-months-only |
| Full range (Paris, `1991-01-01`…`2020-12-31`) | HTTP 200, **299,650 B**, 0.91 s — **+2.5 % bytes** over the current shape for a table covering all 366 days |
| Third consecutive full pull (Tokyo) | HTTP 200, 302,891 B, 1.07 s |

Three consecutive 30-year pulls succeeded with **no rate-limit headers**; the
2026-08-12 two-pull tripwire did **not** reproduce. Conclusion: the weighted
limit is real per Open-Meteo's fair-use terms and was observed live once, but
it is intermittent — D3's backoff is **defensive**, not a hot path. (No
attempt was made to force a 429 deliberately.)

Current 429 behavior in code (not live-triggered): `handleError` at
`openmeteo.ts:202` throws `RateLimitError` with no retry; every normals call
site catches and renders the unavailable note.

## Scope

**In:** fetch shape (full-year table), cache config entry, concurrent-pull
dedupe + bounded 429 retry, US-predicate unification, shared render helper +
heading fix, float-precision storage, Feb 29 definition, test tightening,
correction of the stale planning rows.

**Out (explicitly):**
- Removing NCEI — it stays as the token-gated US upgrade (official station
  normals beat computed grid normals when available).
- International record highs/lows — no global ACIS equivalent exists; records
  remain US-only garnish.
- Persistent on-disk caching — the project has no disk cache anywhere;
  restart-refetch is acceptable once per location per process lifetime (D1
  reduces it to *one* pull per location).
- Extending `include_normals` to more tools, or changing its schema.
- met.no / other providers (separate ICR Phase 5 items).

## Design decisions (settled)

### D1. One full-year pull per location, cached as a 366-slot table

Replace the per-date fetch with a per-location **normals table**
(ACIS precedent: `src/services/acis.ts` fetches the full 366-slot
leap-calendar records table in one POST and caches it):

- `OpenMeteoService` fetches `1991-01-01`…`2020-12-31` once per
  `(lat2dp, lon2dp)` — live-verified at +2.5 % bytes over what a *single*
  date costs today — and a new pure function in `src/utils/normals.ts`
  computes means for **all 366 MM-DD slots** in one pass.
- Cache key `normals-table:${lat2dp}:${lon2dp}` (one entry per location
  instead of up to 366), TTL from a new `CacheConfig.ttl.normals = Infinity`
  entry (finding 2 — no more hardcoded Infinity; house rule "no hardcoded
  values").
- `getClimateNormals(lat, lon, month, day)` keeps its exact signature and
  `ClimateNormals` return shape — it indexes into the (cached) table. The
  hybrid NCEI-first orchestration in `utils/normals.ts` is unchanged in
  structure.
- The old per-date `normals:${lat}:${lon}:${month}:${day}` keys simply stop
  being written; no migration needed (in-memory cache).

Repeat dates, other dates at the same location, and `get_weather_summary`
fan-out all become cache hits after the first pull.

### D2. Sample hygiene inside the table

- A slot's mean uses only non-null samples; a slot with **fewer than 15
  samples** (half the 30-year record) is marked unavailable and renders the
  existing unavailable note. All-null responses (open ocean — the Flood-API
  HTTP-200-with-nulls precedent) therefore degrade cleanly without trusting
  the 200.
- **Feb 29** (finding 5): computed from its real leap-day samples (8 in
  1992–2020). With the min-sample rule this slot is *always* below 15, so it
  gets an explicit carve-out: min 6 samples for Feb 29 only. No Feb 28
  fallback needed (NCEI's `ncei.ts:156` handling stays as-is on its path).

### D3. Rate-limit posture: dedupe + one bounded retry, still soft-fail

- **In-flight dedupe:** a per-service promise map keyed by the table cache
  key, so concurrent requests for the same location (forecast + current in a
  `get_weather_summary` fan-out) share one archive pull instead of racing.
- **429:** on `RateLimitError`, wait once (2 s + jitter) and retry once; on a
  second 429, give up. This matches the ICR recommendation ("serialize
  first-time pulls with 429 backoff") sized to the live evidence that the
  limit is intermittent.
- **Failure contract unchanged:** normals remain garnish on the parent call —
  every failure path ends at the existing catch and unavailable note, never
  failing the forecast/current response itself.

### D4. One US predicate

Delete `isLocationInUS` from `utils/normals.ts` and gate the NCEI attempt on
the shared `isInUS` (`src/utils/geography.ts:322`) — the same predicate the
ACIS records line already uses two lines later.

- Behavior delta: AK/HI/PR points with an NCEI token now try NCEI (finding 4);
  border overruns (Toronto passes the box) are unchanged and remain
  acceptable — the predicate only decides whether to *attempt* NCEI, and NCEI
  returns no data for non-US points, falling through to Open-Meteo.
- The `isLocationInUS` cases in `tests/unit/normals.test.ts:294-341`
  (including the documented Toronto edge case) are **deleted with the
  function by design** — `isInUS` has its own locks in the geography tests.

### D5. Float-precision storage, render-time rounding

`computeNormalsFrom30YearData` currently rounds °C→°F to integers at compute
time (`normals.ts:95-97`), giving metric users a lossy °C→°F→int→°C
round-trip. The table stores **unrounded floats** (canonical imperial, as
today); all rounding moves to render.

- Imperial output stays integer °F — **byte-identical** on the success path.
- Metric output may shift by ≤ 0.5 °C on some values; this is the fix, not a
  regression, and is disclosed in the changelog line.

### D6. One shared render helper

Extract the five duplicated blocks into a single helper (module:
`utils/normals.ts`, alongside `formatNormals`) that owns the
try/catch, the call to `getClimateNormals`, and both outcomes. The failure
heading aligns to the success heading (`## 📊 Climate Context`, finding 5) —
the unavailable note text itself is unchanged. Success output is byte-identical
(D5 caveat for metric aside).

### D7. Tests are part of the contract

- Tighten `tests/unit/current-conditions-global.test.ts:688` to **assert** the
  normals section renders for the non-US point (mocked service) — the
  either-way assertion is the reason finding 6 could hide.
- New unit locks: full-table compute (mean correctness, null-sample skipping,
  min-sample slots, Feb 29 carve-out), table cache key format, in-flight
  dedupe (two concurrent calls → one fetch), 429 retry-then-soft-fail,
  heading consistency of the shared renderer, NCEI gate on `isInUS`.
- Existing `formatNormals` and NCEI tests pass unedited; `normals.test.ts`
  loses only the deleted-helper cases (D4) and the compute-time-rounding
  assertions that D5 supersedes (updated by design, called out in the impl
  plan).

## Edge cases

| Case | Behavior |
|------|----------|
| Open ocean / no archive data | HTTP 200 with nulls → slots fail the min-sample rule → unavailable note (never trust the 200 alone) |
| Archive 429 twice in a row | Unavailable note; parent response unaffected |
| Cache eviction of a table | Refetch on next request — one pull, not up to 366 |
| Feb 29 | Real leap-day mean (≥ 6 of 8 samples) |
| NCEI token set, AK/HI/PR | Now attempts NCEI (was: silently skipped) |
| NCEI token set, Toronto-ish border overrun | Attempts NCEI, gets no data, falls through to Open-Meteo — same end state as today |

## Testing

1. `npm run build` + full `npm test` (2,058 tests) green.
2. New unit tests per D7.
3. **US byte-stability check** (house convention): diff built-dist output for
   a US point with `include_normals: true` (keyless default) against the
   branch base — success-path imperial output must be byte-identical apart
   from live data drift in the non-normals sections.
4. Live spot checks: Tokyo (non-US normals render), Paris (metric), an
   open-ocean point (unavailable note), Feb 29 date handling via
   `get_forecast` on a leap-adjacent window.

## Documentation / registration checklist (for /run-plan tracking)

- [ ] `src/config/cache.ts` — `normals: Infinity` entry
- [ ] `src/utils/normals.ts` — table compute, shared renderer, `isLocationInUS` removed
- [ ] `src/services/openmeteo.ts` — full-year fetch, table cache, dedupe, 429 retry
- [ ] Handlers (5 blocks) → shared helper
- [ ] Tests per D7
- [ ] `CHANGELOG.md` — hardening entry incl. the D5 metric disclosure
- [ ] `CLAUDE.md` / `docs/TOOLS.md` — note normals are global (hybrid), correct any US-only phrasing
- [ ] `docs/planning/README.md` + `INTERNATIONAL_COVERAGE_ROADMAP.md` — stale-row corrections (done alongside this doc)
- [ ] Move this doc to `docs/plans/` on ship

---

*Drafted 2026-08-17. Upstream claims live-verified same day (see §Live
verification). Re-verify archive weighting behavior before implementation if
significant time passes.*
