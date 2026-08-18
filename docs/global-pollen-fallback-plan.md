# Global Pollen Fallback (Google Pollen API) — Design Plan

**Status:** ✅ SETTLED — reviewed 2026-08-18 during implementation-plan
authoring; execution plan at `docs/global-pollen-fallback-implementation-plan.md`.
D8–D10 added post-review (key-setup doc + quarterly re-check, README
"Optional API keys" section + standing key policy, per-feature key naming).
**Related:** `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` — research register
for what else this key could unlock (rides the same branch's T0 commit)
**Parent:** `docs/planning/README.md` pollen status row (~line 83, "Hourly/daily
pollen *forecast* remains open if ever wanted"); resolves the blocker in
`docs/planning/FUTURE_ENHANCEMENTS.md` §6.1 ("MAJOR ISSUE: Lack of free,
reliable API" — stale; it predates even the v1.18.0 CAMS ship)
**Target release:** v1.22.0 (next minor after v1.21.0)
**Branch (for /impl-plan):** `feat/global-pollen-fallback` — create off `main`
after the v1.21.0 tag; touches only the air-quality path, no dependency on
other in-flight branches.

## Upstream verification (web-verified 2026-08-18; live verification pending a key)

Unlike prior plans, this source is **keyed**, so full live verification waits
for implementation (the key requires a Google Cloud billing account the
project does not yet have). Established from Google's published docs and
policies (fetched 2026-08-18):

- **(a) Endpoint:** GET
  `https://pollen.googleapis.com/v1/forecast:lookup?key=KEY` with
  `location.latitude`, `location.longitude`, `days` (1–5), `languageCode`.
  API-key auth only; billing account required; **5,000 lookups/month free**,
  then ~$10/1,000 (tiered).
- **(b) Coverage:** 65+ countries including the US — everywhere the CAMS gap
  exists that matters. Some countries are uncovered; response shape for those
  is a **live to-verify** (likely error status or empty `dailyInfo`; both must
  end at silent no-section).
- **(c) Response shape:** `dailyInfo[]`, each with `date`,
  `pollenTypeInfo[]` (codes GRASS/TREE/WEED, `inSeason`, `indexInfo` with
  Universal Pollen Index `value` 0–5 + `category` string like "Very Low") and
  `plantInfo[]` (per-species detail). `indexInfo` is **omitted entirely** for
  out-of-season types — guard at use.
- **(d) Attribution is mandatory** (Pollen API policies page, fetched live):
  *"you must include the following attribution on or next to the data:
  'Source: Includes pollen data from Google'"*. The rendered footer must carry
  that exact string.
- **(e) Caching:** Google Maps Platform ToS generally prohibits
  caching/storing API content. This plan uses only a short-lived **in-memory
  session cache** (performance posture; also shields the monthly quota);
  nothing is persisted. Deliberate, disclosed trade-off — drop the TTL if
  stricter compliance is ever wanted.
- **(f) Live to-verify list (during implementation, step T-live):** rejected-key
  status and body markers (expected 400/403 with `API_KEY_INVALID` /
  `"API key not valid"` / `PERMISSION_DENIED`); uncovered-region shape (b);
  exact field casing of `indexInfo`/`category`; whether zero-UPI in-season
  types carry `indexInfo`.

Rejected alternatives (researched 2026-08-18):
- **pollen.com unofficial endpoint** — keyless but undocumented, unsupported,
  and deliberately broken for third parties before (Referer/User-Agent
  checks). Fragile and TOS-questionable; out of character for this project.
- **Ambee / Plume / Atmospore** — paid only, no free tier worth shipping.
- **NAB (National Allergy Bureau)** — station counts on a website, no API.
- **Open-Meteo** — pollen comes only from the CAMS *European* model; the CAMS
  global model publishes no pollen. Nothing to request that we aren't already.

## What / Why

Pollen on `get_air_quality` rides Open-Meteo's air-quality endpoint, whose
pollen source is the CAMS European model: real grains/m³ in Europe, HTTP 200
with all-null species everywhere else (verified live 2026-08-13, v1.18.0),
handler renders no section. US users — most of the install base — get
nothing, and the tool description says so.

This plan adds a **keyed global fallback**: when an optional
`GOOGLE_POLLEN_API_KEY` is configured and the six CAMS species come back
all-null, fetch Google's Pollen API and render a pollen section from its
day-1 forecast. Europe keeps the richer keyless grains/m³ data and **never
contacts Google** (quota + privacy). Without a key, behavior is
**byte-identical to today** — the NCEI/FIRMS "optional key upgrades the tool"
pattern, with the same key-in-URL hygiene threat model as FIRMS.

**The Google data is garnish, not contract** (ACIS/records precedent): any
failure degrades to today's no-section behavior and never fails the
air-quality call.

## Scope

- One new service (`src/services/googlePollen.ts`), one new types file, one
  new config key, handler wiring in `airQualityHandler.ts`, `index.ts`
  instantiation + tool-description update, tests, docs.
- Day-1 ("current") section only, in the existing `## 🌾 Pollen` slot.
- **Descoped:** multi-day Google pollen forecast, health-recommendation
  strings, per-plant deep detail, `statusHandler` key reporting (matches
  FIRMS — it reports no key), persistent caching, any change to the CAMS
  fetch or render path.

## Design decisions (settled)

### D1. Trigger — sequential fallback in the handler, all-six-null gate

`formatAirQuality` is synchronous (`src/handlers/airQualityHandler.ts:75`),
so the fetch lives in `handleGetAirQuality`. After `getAirQuality` succeeds,
fire Google only when **all** hold:

1. `googlePollenService` present (new optional **5th** positional parameter —
   keeps the locked 4-arg calls in `tests/unit/air-quality-pollen.test.ts`
   passing unedited; `undefined` ⇒ old path by construction) and
   `isKeyAvailable()`;
2. `airQualityData.current` exists;
3. **zero** of the six CAMS species pass the finite-number filter.

Extract the existing per-species filter (handler lines ~187–194) into a
shared `finiteCamsPollen(current)` helper used by both the trigger and the
CAMS render block, so the two can't drift. Partial CAMS coverage (≥1 real
species) → CAMS renders its subset, Google never fires — existing test locks
this. Sequential (not parallel with Open-Meteo): latency is added only for
keyed non-European calls, and the trigger needs the CAMS answer first.

### D2. Service — `src/services/googlePollen.ts`, modeled on `firms.ts`

The key rides in the URL query string — same threat model as FIRMS, same
countermeasures: the service **never logs or throws URLs or raw axios
errors**; every thrown error is a fixed pre-written string; logs carry only
`{ status, code }`; module doc-comment carries the same "Security: the key
lives in the URL" block.

```ts
export class GooglePollenKeyRejectedError extends Error { /* fixed message */ }
export interface GooglePollenServiceConfig { timeout?: number; apiKey?: string; }
export class GooglePollenService {
  constructor(config: GooglePollenServiceConfig = {})  // apiKey = GOOGLE_POLLEN_API_KEY default
  isKeyAvailable(): boolean
  getCacheStats(); clearCache();
  /** Day-1 pollen; undefined when the region has no data. Fixed-string errors only. */
  async getCurrentPollen(latitude: number, longitude: number): Promise<GooglePollenDailyInfo | undefined>
}
```

Internals: `validateLatitude`/`validateLongitude`; axios GET with
`params: { key, 'location.latitude', 'location.longitude', days: 1,
languageCode: 'en' }`, `User-Agent: getUserAgent()`, timeout
`CacheConfig.apiTimeoutMs`. Returns `dailyInfo?.[0]`; an empty/absent
`dailyInfo` caches a null sentinel so uncovered regions aren't re-probed for
the TTL. **No retries** — garnish must not add latency on failure.

`GooglePollenKeyRejectedError extends Error` with a fixed message, exactly
like `FIRMSKeyRejectedError` (`src/services/firms.ts:45-50`). Do **not**
extend `ApiError` — `ApiServiceName` is a closed union
(`src/errors/ApiError.ts:8-14`) and FIRMS deliberately stayed outside it.

Error mapping in a module-level `mapPollenApiError(error)` copying
`mapAreaApiError`'s shape: `ECONNABORTED` → fixed timeout string; 400/403
whose stringified body contains a key-rejection marker (upstream (f)) →
`GooglePollenKeyRejectedError`; 429 → fixed quota string; other status →
fixed generic; no response → fixed network string.

### D3. Cache — new `CacheConfig.ttl.googlePollen: 6 * HOUR`

Pollen models update ~daily; 6 h matches the `floodDischarge` daily-model
posture and shields the 5,000/month quota once the 1 h air-quality cache
expires. Cache key `Cache.generateKey('google-pollen', lat.toFixed(2),
lon.toFixed(2))` (FIRMS 2-dp precedent). In-memory only — see upstream (e).

### D4. Config — `GOOGLE_POLLEN_API_KEY` in `src/config/api.ts`

Third entry, NCEI/FIRMS doc-comment convention verbatim: OPTIONAL; get a key
in the Google Cloud console (**requires a billing account**; first 5,000
lookups/month free); benefits: pollen worldwide incl. the US (65+ countries);
if not provided: European pollen via CAMS continues to work, no setup
required; rate limits: 5,000/month free tier. Plus
`isGooglePollenKeyAvailable()` (trim check). `.env.example` gains the entry.
The doc comment and the `.env.example` entry link to the key-setup
walkthrough (D8).

### D5. Rendering — day-1 UPI section in the CAMS slot

Same `## 🌾 Pollen` heading, same slot (after pollutant concentrations,
before the secondary-AQI line). Only types whose `indexInfo.value` is a
finite number render (out-of-season types omit `indexInfo` — upstream (c));
zero UPI *with* `indexInfo` present renders (meaningful "none detected",
mirrors the CAMS olive-0 rule):

```
## 🌾 Pollen

**Grass:** 2 (Low) — in season
**Tree:** 3 (Moderate) — in season
**Weed:** 0 (None)

In season: Ragweed (Moderate), Oak (Low)

*Universal Pollen Index (0–5) for today. Source: Includes pollen data from Google.*
```

Category strings come from Google verbatim (`languageCode: 'en'` pinned);
the `In season:` line comes from `plantInfo` and drops when empty. The
attribution sentence is **mandatory and exact** — upstream (d). Priority in
the slot: CAMS species present → today's block byte-identical; else Google
block; else key-rejected note (D6); else nothing.

`googlePollen` + `googleKeyRejected` reach `formatAirQuality` as trailing
optional parameters.

### D6. Failure modes — silent degrade, except a rejected key

- **No key** → byte-identical to today (no service call, no note).
- **Key rejected** → one line, wildfire-F3 disclosure precedent:
  `*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is
  unavailable.*` + `logger.warn`. Silence would hide the misconfiguration
  forever — the user configured a key expecting pollen.
- **Everything else** (429 quota, timeout, 5xx, network, uncovered region,
  empty/malformed `dailyInfo`) → silent no-section + `logger.warn` (`info`
  for an uncovered region — expected, not a fault). A note would be noise on
  a garnish path.
- The entire Google fetch sits in one `try/catch`; the air-quality call
  **never** fails because of it.

### D7. Wiring & tool description

`src/index.ts`: instantiate `new GooglePollenService()` near the FIRMS init
(~line 177); pass as 5th arg to `handleGetAirQuality` (~line 831). Rewrite
the description tail at ~line 497 (currently "pollen data is not available
outside Europe") to the three-state truth: European locations get CAMS
grains/m³ automatically; elsewhere, a grass/tree/weed Universal Pollen Index
is included when an optional `GOOGLE_POLLEN_API_KEY` is configured; otherwise
pollen is unavailable outside Europe.

### D8. Key-setup doc + quarterly re-verification (added 2026-08-18)

`docs/GOOGLE_POLLEN_KEY_SETUP.md` — a small, concise key-creation walkthrough
(Cloud project → billing account → enable the Pollen API → create and
**restrict** an API key to the Pollen API → set `GOOGLE_POLLEN_API_KEY`),
linked from the README env-var table, `.env.example`, and the
`src/config/api.ts` doc comment. Because Google's signup flow and pricing
change over time, the doc carries a `**Last verified:**` freshness stamp:
web-verified at authoring, upgraded to live-verified at T-live — where
provisioning the real key doubles as the doc's first field test, and any
step that didn't match reality is corrected. A quarterly scheduled cloud
routine (`trig_011tumfWjJZ4VLMdbD5vYR3e`; 1st of Nov/Feb/May/Aug, 14:00 UTC)
re-checks Google's published signup/pricing/policy pages against the doc's
claims and reports drift. It is **report-only** (no commits/PRs/issues; its
findings are read from the run log) and no-ops cleanly while the doc doesn't
exist yet on `main`.

### D9. README "Optional API keys" section + standing key policy (added 2026-08-18)

The README's headline promises ("zero API keys, zero signup, zero cost";
"no credit card"; "No API keys, tokens, or accounts needed") stay true **for
the default configuration** and gain one honest, consolidated caveat: a new
**Optional API keys** section near Configuration, default-works-keyless
framing first, then a three-row table (NCEI, FIRMS, Google Pollen) stating
what each key adds, what still works without it, and the registration cost
plainly. NCEI and FIRMS are true free registrations; the Google key is
free-tier but **requires a Google Cloud billing account (credit card on
file)** and must never be described as simply "free". Existing scattered key
mentions become cross-links to the section. The section — and
`docs/planning/README.md`'s intro, so future feature triage inherits it —
records the **standing key policy**: optional keys must always have a usable
free tier; no tool ever *requires* a key; features that would require a
**paid** key are out of scope unless there is significant user demand for
that specific service.

### D10. Key naming — per-feature keys, permanent (added 2026-08-18)

`GOOGLE_POLLEN_API_KEY` is the permanent name; it is never renamed to a
shared platform key. Any future Google Maps Platform feature (see the ranked
register in `docs/planning/GOOGLE_KEY_OPPORTUNITIES.md` — #1 is a global
weather-alerts fallback) gets its own env var (`GOOGLE_WEATHER_API_KEY`, …).
Rationale: D8's setup doc recommends restricting the key to the Pollen API,
and a restricted key cannot serve other APIs — a shared var would invite
silent `PERMISSION_DENIED` breakage when a second feature read it.
Per-feature vars match the NCEI/FIRMS one-key-one-purpose precedent; a user
with one unrestricted key can put the same string in every var. Settled in
the register on the same date.

## Edge cases

- CAMS partial coverage → Google never fires (D1); existing test locks the
  CAMS subset render.
- `forecast: true` keyed non-European call → Google section renders in the
  current block; the hourly forecast section and `buildAirQualityParams` are
  untouched (the hourly param string `us_aqi,european_aqi,uv_index` is locked
  by an existing unit test).
- Google 200 with `dailyInfo[0]` present but all three types lacking
  `indexInfo` → treated as no data, no section.
- Whitespace-only key → `isKeyAvailable()` false → keyless path.
- Open-Meteo cache hit + Google cache miss (TTLs differ) → fine; the Google
  call is independent of where the CAMS answer came from.

## Testing

`tests/unit/air-quality-pollen.test.ts` (176 lines) **must pass unedited** —
it is the byte-identical keyless lock (4-arg handler calls ⇒ no service ⇒
old path). New `tests/unit/air-quality-google-pollen.test.ts`:

- **Handler** (mock service object `{ isKeyAvailable, getCurrentPollen }`):
  all-null CAMS + key → Google section containing the exact attribution
  string; real CAMS + key → CAMS section AND `getCurrentPollen` **not
  called**; generic service throw → no section, no note, call succeeds;
  `GooglePollenKeyRejectedError` → note line, call succeeds; empty
  day / all-types-missing-`indexInfo` → no section; no 5th arg → output
  strictly equal to keyless output; zero-UPI-with-`indexInfo` renders.
- **Service** (`vi.mock('axios')`, `firms-service.test.ts` style): exact
  request params (`days: 1`, dotted location keys, `languageCode`); cache hit
  on second call; empty `dailyInfo` → `undefined`, cached; key-rejection body
  → `GooglePollenKeyRejectedError`; 429 → fixed string; **key hygiene** — no
  test-key substring in any thrown message or any logger call argument.

## Documentation / registration checklist (for /run-plan tracking)

- [ ] `src/types/googlePollen.ts` (subset-only, all-optional fields)
- [ ] `src/config/cache.ts` — `ttl.googlePollen`
- [ ] `src/config/api.ts` — key + predicate, doc-comment convention
- [ ] `src/services/googlePollen.ts` — service + error mapping + hygiene
- [ ] `src/handlers/airQualityHandler.ts` — 5th param, `finiteCamsPollen`
      helper, fetch, render
- [ ] `src/index.ts` — instantiation, 5th arg, tool description ~line 497
- [ ] `.env.example` — third API-token entry (billing caveat)
- [ ] `README.md` — env-var table (~line 256) + coverage prose
- [ ] `README.md` — new "Optional API keys" section (added 2026-08-18):
      consolidates NCEI/FIRMS/Google keys, keyless-default-first framing,
      honest billing-account caveat for the Google key (the README promises
      "no credit card"), and the standing policy: optional keys must have a
      usable free tier, no tool ever requires a key, paid-key features only
      on significant demand
- [ ] `docs/GOOGLE_POLLEN_KEY_SETUP.md` — key-creation walkthrough with
      Last-verified freshness stamp (added 2026-08-18; quarterly re-check
      via scheduled cloud routine `trig_011tumfWjJZ4VLMdbD5vYR3e`)
- [ ] `docs/planning/README.md` intro — record the standing free-key policy
- [ ] `docs/planning/FUTURE_ENHANCEMENTS.md` §6.1 — blocker resolved
- [ ] `docs/planning/README.md` — pollen status row (~line 83)
- [ ] `CHANGELOG.md` — Unreleased entry (byte-identical-keyless claim,
      garnish doctrine, key hygiene, mandatory attribution, ToS cache note,
      descoped multi-day)
- [ ] `CLAUDE.md` — feature bullet (mirror the v1.20.0 FIRMS key-hygiene
      phrasing)

## Verification

1. `npm run build` clean; `npm test` full suite (< 2 s), with
   `tests/unit/air-quality-pollen.test.ts` passing **zero-edit**.
2. Keyless byte-identity: diff built-dist `get_air_quality` output for a US
   point (Kansas City) and a European point (Berlin) against the branch base
   with no key set.
3. **T-live** — live smoke with a real key via a scratchpad driver against
   `dist/` (driver must end with `process.exit(0)`): US point → Google
   section with attribution; Berlin → CAMS section and (debug log) Google not
   called; garbage key → note line, tool still succeeds; resolve every item
   on the upstream (f) to-verify list and adjust `mapPollenApiError` if the
   live shapes differ.
4. Grep smoke-run output and logs for the key string — must appear nowhere.
