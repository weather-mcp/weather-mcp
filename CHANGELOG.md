# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **An empty NOAA river result outside NWPS coverage now discloses the coverage
  gap instead of advising a wider search.** `get_river_conditions` with
  `source: "noaa"` at a non-US point rendered
  `ℹ️ **No river gauges found within 50 km**` followed by advice to expand the
  radius — advice that cannot succeed at any radius, under an ℹ️ that reads as an
  all-clear on a flood-safety tool. The coverage sentence existed but sat inside
  the handler's `catch`, and a non-US NWPS query does not throw, so it was
  unreachable in exactly the case it was written for. The report now states that
  NOAA's National Water Prediction Service gauges rivers in the United States and
  Puerto Rico only, that no gauges returned is an absence of coverage rather than
  an all-clear, and names `source: "openmeteo"` for global modeled discharge.
  This also covers the default path: `isInUS`'s CONUS bounding box contains
  Toronto and Vancouver, so those points route to NWPS on `source: "auto"` and
  got the same unusable advice — they now get the disclosure. **Routing itself is
  unchanged**; those points still route to NWPS, the tool simply says so. The
  coverage set is matched against the country the geocoder resolves, which is `us`
  for the United States and its territories. **Known limitation:** NWPS gauges
  neither Guam nor the US Virgin Islands, but OpenStreetMap resolves both to `us`
  at country zoom, so a forced `source: "noaa"` query there still renders the
  in-coverage advice rather than the disclosure — unchanged from before this fix,
  and tracked in #86. A US point with no gauge in radius is untouched: inside
  coverage, widening the radius genuinely can find a gauge, so that advice still
  renders byte-identically. (#85)

## [1.25.9] - 2026-08-28

### Fixed

- **A lightning feed outage is now reported as unknown, not as a first-query cold
  start.** A transport failure to the Blitzortung feed was caught, logged and turned
  into an empty result, which was indistinguishable at the renderer from "this area
  has only just started being monitored". The report then asserted the benign cause —
  that a location's first lookup starts near zero coverage — and prescribed a remedy
  that cannot work during an outage: re-check shortly, when every re-check reads the
  same zero. An unreachable feed now renders
  `## ⚪ Safety Status: UNKNOWN (LIVE FEED UNAVAILABLE)` with an honest explanation
  naming the feed and its automatic background reconnect, and advises consulting
  official weather services instead of re-checking. A feed that drops partway through
  collection counts as an outage too, not only one that never connects. The same
  ⚪ heading renders inline in `get_weather_summary`'s `lightning` section rather
  than collapsing it. **Cold-start output is byte-identical** — a genuine first query
  for an area reads exactly as it always has. Files: `src/services/blitzortung.ts`,
  `src/handlers/lightningHandler.ts`, `src/types/lightning.ts`, `docs/TOOLS.md`,
  `docs/ERROR_HANDLING.md`.
  ([#76](https://github.com/weather-mcp/weather-mcp/issues/76))

- **Strikes already buffered from earlier monitoring now survive an outage instead of
  being discarded.** Every transport failure returned an empty strike list, so the
  server's own buffer went unread on the two outage shapes users hit most often — a
  feed that was already down when the query started, and one whose subscribe was
  refused. A strike 5 km away that arrived shortly before the feed dropped was
  reported as nothing observed. Buffered **ELEVATED**, **HIGH** and **EXTREME**
  strikes now retain their urgent verdict, with the full shelter recommendations and a
  caveat that the live feed could not be reached; buffered safe-band strikes remain
  listed, but the heading and message say current conditions are unknown rather than
  "no immediate lightning threat". The strikes returned during an outage are filtered
  by the query's own radius and time window, the same as on the healthy path.

- **A failed subscribe no longer leaves its geohashes recorded as subscribed.** They
  were written before the broker had accepted anything, so a second query for the same
  area — or the first query for a saved location whose startup pre-warm failed —
  skipped resubscribing, found a coverage stamp for a topic no one was listening to,
  and produced exactly the cold-start report this release exists to remove. The
  geohashes staged by a failed subscribe are now rolled back.

- **The lightning failure logs no longer carry broker detail.** The three stderr sites
  that record a feed failure passed the underlying error object through, and its
  message and stack name the broker host and port; they now record only the error's
  `name` and `code`. The failure reason has never appeared in the report itself, and
  still does not.

## [1.25.8] - 2026-08-27

### Fixed

- **A lightning strike whose distance is unknown is now reported as unavailable
  at every site that prints it, instead of being read as a strike at zero
  kilometres.** `LightningStrike.distance` is optional, but its only producer
  (`filterStrikes` in `src/services/blitzortung.ts`) always sets it — so four
  readers in `src/handlers/lightningHandler.ts` each invented their own handling
  of a state none of them could observe, and two of them were wrong in opposite
  directions. One such strike rendered `Nearest Strike: 0.0 km away` and
  `Distance: undefined km` simultaneously, beneath a green *no significant
  lightning activity detected* verdict. The `Nearest Strike` and
  `Average Distance` lines and the per-strike `Distance` rows now say
  `unavailable` when the distance is unknown, and print a figure only when there
  is a real reading. **`0.0 km` therefore means a strike directly overhead and
  nothing else** — the contract established for the safety assessment in
  v1.25.1, now honoured by every reader. The average distance is a mean over the
  strikes that carry a distance, rather than counting an unknown one as zero in
  the numerator while still dividing by it. `LightningStatistics.nearestDistance`
  and `averageDistance` are now `number | null` (`src/types/lightning.ts`).
  **No live feed produces this state:** it is a latent invariant held in
  `src/services/blitzortung.ts` with nothing enforcing it, reachable only through
  a future second producer, and it is now honoured rather than assumed.
  Reports with a distance on every strike are unchanged, byte for byte.
  ([#83](https://github.com/weather-mcp/weather-mcp/issues/83))

## [1.25.7] - 2026-08-27

### Fixed

- **Every non-safety category is now keyed on the number the report prints, so a
  figure and the label beside it can never disagree.** Twelve sites across
  `get_air_quality`, `get_current_conditions` and `get_forecast`'s
  `compare_models` computed a category from a raw upstream value while printing
  that value rounded. Sweeping the full grid of all twelve, **34 printed values
  mapped to two different labels before this change and none do after**
  (US AQI 5, European AQI 5, UV 4, Red Flag Threat 3, vapour-pressure deficit 3,
  topsoil moisture 3, model spread 2 in °F and 2 in °C, visibility 3 imperial and
  4 metric — every grid indexed by division). Touched
  `src/handlers/airQualityHandler.ts`, `src/handlers/currentConditionsHandler.ts`,
  `src/utils/fireWeather.ts`, `src/utils/modelComparison.ts` and
  `src/utils/unitFormat.ts`.

  **This is not a one-way change, and which way each surface moves is stated
  rather than smoothed over.** Measured over a `±1` window at each ladder
  threshold:

  - *Toward caution:* **UV** (399 of 16,004 sampled cases, none the other way),
    **Red Flag Threat**, and **vapour-pressure deficit** — all ascending `<`
    ladders, so rounding up at a seam raises the label.
  - *Away from caution:* **both AQI scales** (495 cases each, none the other
    way). The US AQI and the European EAQI are published as whole numbers, so
    banding on the integer is the correct reading of the scale rather than a
    softening — the code had been classifying at a precision the scale does not
    have. Also **topsoil moisture** and **imperial visibility**, by at most half
    a display unit (0.005 m³/m³, 0.05 mi), because both are
    descending-severity ladders; the alternative is two reports printing an
    identical number under different words.
  - **Visibility under metric preferences now keys on the km figure the report
    prints.** It previously keyed on a miles value the report never showed.
  - **A clear US report now reads `(clear)`.** NOAA publishes clear visibility
    as 16090 m, which prints `10.0 miles` but failed a `>= 10.0` test on the
    raw 9.99786 — so that branch could never fire, even at an exact ten statute
    miles. Three captured examples gain the suffix.
  - **The model-agreement spread bands on the whole degree it prints**, which in
    °C makes the ladder `tight ≤ 2`, `moderate 3–4`, `divergent ≥ 5`. That
    coarsening is inherent to printing a whole degree, not introduced here.
  - **Haines Index and Grassland Fire Danger values between rungs no longer read
    as the top rung.** Both ladders used strict equality on their middle rungs,
    so a value of `4.5` (or `2.5`) matched no arm and fell through to
    `Very High`. They are now contiguous; every integer keeps its label.

  **Ensemble-spread confidence is deliberately unchanged** — the IQR it bands on
  is never printed, so the rule has no referent there.

## [1.25.6] - 2026-08-27

### Fixed
- **A wave printing `0.5m` is no longer called `Calm (rippled)`, the band that ends below 0.5.** `get_marine_conditions` printed the significant wave height rounded to one decimal but decided the Douglas sea-state category from the raw, unrounded metres — so two reports could show the identical height under different sea states, and the label could contradict the number printed beside it. The sea state is now computed from the height the report actually prints. The two safety clauses had the same defect on both of their inputs: *choppy (short period)* and *long-period swell (powerful)* compared raw metres and raw seconds against their cutoffs while the report printed both at one decimal, so a swell displayed as `6.0s` could still trigger the clause that fires below 6 seconds. Both now key on the displayed period and the displayed height. **The sea-state change is one-way toward caution** — measured across `0..18 m` at `0.005 m` steps, **68 cases become more cautious and none become less cautious**, and the printed heights that previously mapped to two sea states each now map to one. **The two safety clauses move the other way, and that is the correct direction for them.** Their cutoffs are strict (`> 1.0 m`, `< 6 s`, `> 12 s`), so keying them on the displayed figures *removes* a qualifier wherever the raw value cleared a cutoff that the printed value does not — measured across height `0..3 m` at `0.005 m` steps and period `0..15 s` at `0.05 s` steps, **2,071 of 180,901 pairs lose a qualifier and none gain one**. A report whose own lines read `1.0m (3.3ft)` and `5.9s` was being called *choppy (short period)* by a test that reads "greater than 1.0 m", contradicting the number printed beside it; it no longer is. The sea state on the same report is unaffected. **Seven of the eight Douglas thresholds move; the eighth cannot.** Exactly seven printed heights were ambiguous — `0.5m`, `0.1m`, `2.5m`, `4.0m`, `6.0m`, `9.0m` and `14.0m` — because a one-decimal value can never land on `1.25 m`, so only the tenths-aligned thresholds were ever able to misfire — worth stating so nobody reads a seam test at 1.25 and concludes the fix did nothing. **Both marine render paths move together**: the NOAA gridpoint path used for the Great Lakes and major US coastal bays and the Open-Meteo path used for open ocean call the same band function, and both were driven against the built dist before and after. The wind-versus-swell dominance line is deliberately unchanged — it compares two raw values against each other, with no displayed threshold involved. Follows the same defect fixed in `get_lightning_activity` in v1.25.2 and `get_wildfire_info` in v1.25.5. (`src/utils/marine.ts`, `docs/TOOLS.md`)
- **A river forecast point printing at its action stage now carries the flood label.** `get_river_conditions` renders each forecast-series point's stage at two decimals at `detail="full"`, but derived that point's flood category from the raw, unrounded stage — so a stage of 7.996 ft against an action stage of 8 ft printed `8.00 ft` with **no flood label at all**. The number the reader sees had reached the threshold and the report did not say so. The category is now computed from the stage the report prints. **The gauge's published thresholds are deliberately left alone.** They are NOAA's own gauge metadata at NOAA's own precision; rounding them too would move the official action stage, which is not this project's to move — so a threshold of 8.004 ft still means 8.004 ft, and a stage displaying as `8.00` correctly stays below it. **One-way toward caution** — measured across `6..20 ft` at `0.0005 ft` steps against thresholds of 8 / 10 / 14 / 18 ft, **38 cases become more cautious and none become less cautious**. **US path only, and the other path is provably untouched**: this is the NOAA NWPS gauge path, and the Open-Meteo/GloFAS path used outside the US publishes no flood stages at all, so it never reaches this code — confirmed byte-identically against the branch base rather than by inspection, in both unit systems. Nothing about which gauges are found, their ordering, the observed stage, the trend line, or the historic crests changed. (`src/handlers/riverConditionsHandler.ts`, `docs/TOOLS.md`)

## [1.25.5] - 2026-08-27

### Fixed
- **A wildfire report whose nearest fire sits just past a tier threshold now returns the more cautious tier, on both of the tool's paths.** `get_wildfire_info` printed each fire's distance rounded to one decimal but decided the danger tier from the raw, unrounded measurement — so two reports could show the identical distance under different tiers. A fire at 5.02 km printed `5.0 km` and read 🟠 **HIGH ALERT**, while one at 4.98 km printed the same `5.0 km` and read ⚠️ **EXTREME DANGER**. The tier is now computed from the distance the report actually prints, so the displayed number and the tier it falls in can never disagree. **This surface needed the opposite endpoint rule from the lightning fix in v1.25.2, and the reason is worth stating**: lightning's bands improve as the distance grows, so rounding down toward the displayed figure can only move a report toward caution. Wildfire's bands invert — `<5 km` is the *most* dangerous tier — so rounding down moves a report toward danger being **under**-reported. The comparisons therefore became inclusive (`≤`) rather than staying exclusive, which also makes the sentence the report has always printed true: a fire at exactly 5.0 km is "within 5 km" in every ordinary reading, and it now reads **EXTREME DANGER** instead of HIGH ALERT. **The change is one-way toward caution** — measured across `0..65 km` at `0.005 km` steps against the shipped rounding helper, **32 cases become more cautious and none become less cautious**, and the three printed distances that previously mapped to two tiers each (`5.0`, `25.0`, `50.0` km) now map to one. The affected windows are narrow — `[5, 5.05]`, `[25, 25.05)` and `[50, 50.05]` km, the middle one half-open because `toFixed` rounds `25.05` up while `5.05` and `50.05` round down — so a report outside them is byte-for-byte what it was, confirmed by driving the built dist against four live points in both unit systems before and after. **Both routing paths move together**: the NIFC named-incident path used in the US and the NASA FIRMS satellite-detection path used everywhere else are separate code with separate wording, and both are fixed, both are covered by the new tests, and both were driven live. **One deliberate exception, in the other direction.** The fire that drives the assessment is the nearest one that is not fully contained, and that test also ran on the raw value while the report printed containment rounded to a whole percent — so a fire at 99.6% displayed `**Containment:** 100%` and still produced **EXTREME DANGER**, which is exactly the incoherence the uncontained-fire filter was introduced to remove, surviving at the rounding edge. The filter now keys on the displayed containment, so a fire shown as `100%` no longer drives the tier. This is marginally *less* cautious and is taken deliberately: a report can no longer show `100%` contained beside an evacuation warning, and the exclusion note the report already printed — *"is 100% contained and excluded from the danger assessment"* — is now true at the rounding edge rather than false. A fire at 99.4% still displays `99%` and still produces **EXTREME DANGER**. Separately, the published tier table in `docs/TOOLS.md` had the same seam the lightning table did: it listed `EXTREME DANGER (<5km)` and `HIGH ALERT (5-25km)`, so 5 km appeared in one row's range and was excluded from the other's, and a reader classifying a report by its own printed number could reach a different tier than the server did. The table now states endpoints that admit one reading — **EXTREME DANGER** ≤5 km, **HIGH ALERT** >5–25 km, **CAUTION** >25–50 km, **AWARENESS** >50 km — says that the tier keys on the distance as displayed, and notes the containment exclusion. Follows the same defect found in `get_lightning_activity` ([#80](https://github.com/weather-mcp/weather-mcp/issues/80), fixed in v1.25.2). (`src/handlers/wildfireHandler.ts`, `docs/TOOLS.md`)

## [1.25.4] - 2026-08-26

### Fixed
- **The release script no longer corrupts `CHANGELOG.md` when a release note contains a `$`.** `scripts/update-docs-for-release.sh` promotes the `[Unreleased]` section into the new version section with `String.replace(pattern, string)`, and JavaScript interprets `$` sequences inside a replacement **string** — `` $` `` means *everything in the file before the match*, `$'` means everything after it, and `$&` and `$1`-`$9` have their own meanings. The notes for this very release contain the phrase *the numeric form matches `^[0-3]$` rather than going through `parseInt`*, where the `$` is followed by a backtick, so preparing v1.25.4 spliced the file's own seven-line header into the middle of that sentence and pushed the rest of the bullet below a second copy of the preamble. **Nothing threw and nothing caught it**: the write succeeded and `scripts/check-doc-versions.sh` reported all checks passing over the corrupted file, because it verifies version strings, tool counts and the link-reference block — none of which the splice touches. The replacement is now a **function**, which inserts the string literally and has no metacharacters at all, so the fix removes the hazard rather than escaping this one instance of it. The sibling `sed` half of the same trap was already guarded (`SUMMARY_SED` escapes `/`, `&` and `\` in the one-line summary); only the JavaScript half was missed, because a template literal passed to `replace` looks like plain interpolation. The two other `replace` calls in the script are unaffected — both use `$1` deliberately and substitute URLs and version strings, which cannot contain a `$`. **Release tooling only — nothing in the published package changed**, and no previously released changelog section was affected: this is the first release note in the project's history to quote a regular expression. Recorded as **G35** in `GOTCHAS.md`. (`scripts/update-docs-for-release.sh`)
- **Numeric `LOG_LEVEL` values now take effect, and the documented default was the loudest setting there is.** `LogLevel` is a numeric TypeScript enum, so it carries reverse mappings: the guard `levelStr in LogLevel` was true for `"3"`, and the lookup then returned the *string* `"ERROR"` rather than the number `3`. The level gate compares a number against that string, which coerces to `NaN`, so the comparison was never true and **nothing was ever suppressed**. The issue reported this as the documented interface silently doing nothing; it was worse than nothing. Every value from `0` to `3` ran the server at full `DEBUG` verbosity, so `LOG_LEVEL=1` — the value `README.md`'s MCP client config block tells you to copy, the value `.env.example` ships, and the value both files document as the default — made the server **noisier** than leaving the variable unset, which correctly ran at `INFO`. Only the four *names* worked, and only by accident of the same lookup. **Both spellings are now accepted and neither is deprecated**: `0`/`1`/`2`/`3` and `DEBUG`/`INFO`/`WARN`/`ERROR`, case- and whitespace-insensitively, so every existing MCP client config carrying `"LOG_LEVEL": "1"` becomes *correct* rather than starting to warn. The parse no longer indexes the enum by a runtime string at all — it matches an explicit ordered name list and derives the level from its index, which removes the hazard from the file rather than guarding it, so the next person tidying that function cannot reintroduce the bug. **An unusable value is now heard rather than silently accepted.** `4`, `-1`, `1.9`, `3wat`, `TRACE`, an empty string and a stray leading space all previously reached `INFO` with no diagnostic; each now emits one `Invalid LOG_LEVEL: "…". Expected 0-3 or DEBUG/INFO/WARN/ERROR. Using default: INFO` line on stderr, echoing the value **as supplied** so an invisible whitespace typo is visible inside the quotes — an empty string renders as `""` and a stray leading space is legible between them. The echo is **escaped and bounded** rather than interpolated raw: it goes through `JSON.stringify` and is capped at 64 characters, with the true length reported when it is cut. Every log record this server writes to stderr is a single JSON object, and this warning is the only line on that stream whose content comes from an environment variable — the one other unstructured line, the `[ToolConfig] Enabled tools` startup notice, echoes only tool names from a fixed set — so an embedded newline in the variable would otherwise let a mistyped `LOG_LEVEL` forge a log entry for anything reading that stream by line, and a pasted file would become the entire diagnostic. Escaping preserves the visible-whitespace property the diagnostic exists for, and ordinary typos are unaffected: the warning for `4` is byte-identical either way. It falls back to `INFO` and deliberately **does not clamp** the way the cache config does: clamping `4` to `ERROR` would let a typo *silence* the server, a misconfiguration that hides its own diagnosis, so the fallback fails toward being heard. For the same reason the numeric form matches `^[0-3]$` rather than going through `parseInt`, which would take `1.9` as `1` and `3wat` as `3` — the domain has four members, exactness is free, and a typo should be told rather than rounded. An **absent** variable stays silent, since not configuring a thing is not a misconfiguration. The warning goes through `console.warn` rather than the logger, for two binding reasons: the logger singleton is mid-construction when the parse runs, and `console.warn` writes to stderr, the only stream an MCP server may use. **The startup line no longer reports a value that is not in force.** It echoed the raw environment string, which was harmless while the raw string meant nothing; with the parse working it would have become a diagnostic that lies, reporting `"logLevel":"4"` for a server actually running at `INFO`. It now reports the effective level. Verified against the built dist across the full input domain — seventeen values swept, each emitting one line at all four levels and read for which survived — and by four spawns of the server from a directory outside the repo, since this repository's own `.env` sets `LOG_LEVEL=0` and a probe from the repo root would silently test that instead of a default install. **Nothing about what is logged, or at which level any existing call site logs, has changed** — only which levels are emitted. stdout stayed empty throughout, on every probe. Reported by **@dgahagan** ([#78](https://github.com/weather-mcp/weather-mcp/issues/78)). (`src/utils/logger.ts`, `src/index.ts`)
- **The `get_lightning_activity` parameter reference no longer publishes a `timeWindow` range the server rejects.** `docs/TOOLS.md` documented `timeWindow` as accepting `1-180` minutes while the handler validates `5-120`, so a caller following the reference with `timeWindow: 1` or `timeWindow: 180` got a validation error for a value the reference called legal. The documented range is now the range the server enforces. **Documentation only — no behaviour changed**, and the fix brings the docs up to the code rather than the reverse: the validator, its own error message (*"timeWindow must be a number between 5 and 120 minutes"*) and the published tool schema in `src/index.ts` already agreed on `5-120`, and the documented default of `60` was correct throughout. (`docs/TOOLS.md`)

## [1.25.3] - 2026-08-26

### Fixed
- **The geometry disclosure on a national CAP alert list no longer contradicts the line directly beneath it, or changes with `detail`.** When `get_alerts` lists warnings from the national CAP feeds of India, the Philippines or Indonesia, alerts whose area geometry could not be loaded are listed in a country-level block above a disclosure naming how many they are. That count was computed over the **display-capped slice** rather than over the block it describes, which was wrong twice over. It contradicted the remainder line about twenty lines below — the `standard` read said `Area geometry for 10 alerts could not be loaded or parsed` directly above `…and 40 more warnings` — and it **changed with `detail`**, which is incoherent for a fact about an upstream feed: the feed does not know what verbosity the caller asked for, so the same India read reported `10` at `standard` and `25` at `full` for one unchanging set of alerts. The count is now computed over the whole country-level block, so it is invariant under `detail` and describes the block rather than the page. **Both sentences that report it now read one binding**, so the block-scoped disclosure and its sibling line (the one that fires when the matched warnings consume the entire display cap) are structurally unable to diverge. **The sentence carrying the count was reworded to match its own scope:** where it said the alerts are *listed at country level*, it now says they are *treated as country-level* — when the display cap pushes some of them into the remainder they are routed country-level without appearing anywhere on the page, and the claim has always been about which way the alert was routed, never about where it was printed. **The behaviour change, and it discloses more rather than less:** the disclosure is gated on that count, so the case where only the *remainder* lost geometry — every shown warning has usable geometry, the ones past the cap do not — previously printed nothing at all and now renders. **No warning's visibility, matching, ordering or capping moved.** Every alert that was listed is still listed, in the same block, in the same order; the polygon-matching split is untouched, and an incomplete ring set still may include a point and may never exclude one. `get_weather_summary`'s `alerts` section renders through the same handler and moves with it — at its default `detail` it shows the country-level counts block, whose total the corrected disclosure now agrees with, and driven at `detail="standard"` it carries the corrected disclosure itself. Verified against the built dist on the live SACHET feed: the `standard` and `full` reads disclose the same number as each other, equal to the `summary` block's country-level total and to shown + remainder in each read, on both public paths. (`src/handlers/alertsHandler.ts`)
- **The keyless "not yet covered" message no longer claims India's alerts are matched to your exact point.** Asked for alerts somewhere outside coverage with no `GOOGLE_WEATHER_API_KEY` configured, `get_alerts` lists where it *can* answer, and that sentence attributed polygon matching to all three national CAP countries at once — *"via their national CAP feeds, matched by alert polygon — India (NDMA SACHET), the Philippines (PAGASA), and Indonesia (BMKG)"*. India has never been point-matched: SACHET serves geometry from a separate endpoint that returns HTTP 403 to server-side clients, so Indian warnings render in the country-level block with an explicit note, exactly as v1.24.0 designed and documented. The sentence now splits the precision claim — the Philippines and Indonesia matched by alert polygon, India matched at country level — while still naming all three countries, since they are the coverage answer and under-claiming a real capability would be its own error. The module's own header docblock made the same false claim and is corrected with it. Nothing else about the message changes, and it still never names Google. This brings the code up to the docs rather than the reverse: `docs/TOOLS.md`, `README.md`, `CLAUDE.md` and the `get_alerts` tool description already stated India's country-level precision correctly. (`src/handlers/alertsHandler.ts`)

## [1.25.2] - 2026-08-26

### Fixed
- **A lightning report whose nearest strike sits just past a threshold now returns the more cautious band.** `get_lightning_activity` printed the nearest-strike distance rounded to one decimal but decided the safety verdict from the raw, unrounded measurement — so two reports could show the identical distance under different verdicts. A strike at 50.02 km printed `50.0 km` and read 🟢 SAFE, while one at 49.99 km printed the same `50.0 km` and read 🟡 ELEVATED. The verdict is now computed from the distance the report actually prints, so the displayed number and the band it falls in can never disagree. **The change is one-way toward caution**: rounding down to the displayed figure can only lower a distance, which can only raise severity — measured across `0..60 km` at `0.001 km` steps, 148 cases become more cautious and **none** become less cautious. The affected windows are narrow: `(50, 50.05]`, `(16, 16.04995]` and `(8, 8.04995]`, so a report outside them is byte-for-byte what it was. **Both surfaces move together** — `get_weather_summary`'s `lightning` section runs through the same handler, and since `get_lightning_activity` is not in the default `basic` preset while `get_weather_summary` is, the summary is the path a default install actually has to this verdict. Separately, the published band table in `docs/TOOLS.md` was itself wrong: it read `Elevated (16-50km)` where the code bands 16.0 km as **high**, and listed 8.0 km inside `High (8-16km)` while `Extreme (<8km)` excluded it, so a reader classifying a report by its own printed number could reach a different verdict than the server did, for two independent reasons. The table now states endpoints that match the code and admit one reading — **Extreme** ≤8 km, **High** >8–16 km, **Elevated** >16–50 km, **Safe** >50 km — and says that the band keys on the distance as displayed. Reported by **@dgahagan** ([#80](https://github.com/weather-mcp/weather-mcp/issues/80)). (`src/handlers/lightningHandler.ts`, `src/utils/displayBanding.ts`, `docs/TOOLS.md`)

## [1.25.1] - 2026-08-25

### Fixed
- **The lightning report no longer claims no strikes were observed while listing strikes.** `get_lightning_activity`'s 🟢 SAFE verdict means *the nearest strike is beyond 50 km* — it never meant *nothing was found* — but the report said the latter, printing `No lightning strikes observed during the limited monitoring period` or `No significant lightning activity detected in the area` directly above `Total Strikes: 20`, `Active Thunderstorm: Yes`, and a list of the strikes themselves. Both coverage states were affected: the reported partial-coverage case and an adjacent complete-coverage one that nobody had filed. A `safe` verdict with strikes present now states the fact and claims only what the band actually means — `Nearest lightning 203.2 km away — no immediate lightning threat at this location.` — which is the semantics `docs/TOOLS.md` already published for the band. **With no strikes found, every word is unchanged**, on both coverage paths. The limited-coverage ⚠️ caveat gained a matching variant: an absence of strikes is not what is under-informed when strikes were found, so with strikes present it now says what is — *the nearest-strike distance below is a floor, because a closer strike could have occurred during the minutes that were not monitored* — which is exactly the number the verdict rests on. The coverage recommendation is unchanged and still fires whether or not strikes were seen, and it deliberately stays inside the `safe` gate, so nothing tells a caller with lightning inside 8 km to "treat this result as inconclusive". Both surfaces are fixed at once: `get_weather_summary`'s `lightning` section runs through the same handler, and since `get_lightning_activity` is not in the default `basic` preset while `get_weather_summary` is, the summary is the path a default install actually had to this text. Separately, a strike at exactly `0.0` km — coordinates equal to the query point — was read with `||` rather than `??`, so it fell through as "no strikes" and rendered a green all-clear for a strike on top of the caller; it now bands `extreme`. Internally, the safety sentence and the coverage caveat are now driven by the same value the verdict itself was banded on, so the two can never describe the same report differently. Reported by **@dgahagan** ([#77](https://github.com/weather-mcp/weather-mcp/issues/77)). (`src/handlers/lightningHandler.ts`)

## [1.25.0] - 2026-08-25

### Changed
- **`mqtt` is now an optional dependency, so you can install without it.** Nothing changes for anyone who does nothing: optional dependencies are installed by default, so a plain `npm install` or `npx` still gets `mqtt` and lightning works exactly as before. What is new is that you can now decline it — `npm install -g @dangahagan/weather-mcp --omit=optional` installs **121 packages instead of 163**, dropping 42. `mqtt` is the only dependency in the tree that serves a single tool, and that tool (`get_lightning_activity`) is not in the default `basic` preset, so until now every install carried it for a feature most installs never expose. **What you give up, on both surfaces it reaches:** `get_lightning_activity` returns an error naming the package and how to get it back, and `get_weather_summary`'s optional `lightning` section renders as `## lightning (unavailable)` carrying the same message — the summary itself still succeeds and its other sections are unaffected. Neither ever reports "no strikes": a missing package rendering as an all-clear on lightning is exactly the fabricated-safe-answer this project treats as its worst failure mode, so the absence is a contract failure that propagates, not a silent degradation. The same holds for a package that is present but **unloadable** — a damaged or partial install — which reports its own distinct message and remedy rather than borrowing the "reinstall without --omit=optional" advice, since that install never omitted anything. The server does not cache that state, though Node caches the failed module itself, so a repaired install needs a restart to take effect. **The opt-out applies to the published package, not to a source build** — `import type` erases from the emitted JavaScript, but TypeScript still needs `mqtt`'s bundled declarations to compile, so building from a clone continues to use a plain `npm install`. Internally the package is no longer imported at load time at all: it is resolved by a memoised dynamic `import()` at its single call site, behind a single-flight promise so that concurrent callers share one resolution and one log line. That was not merely an optimisation — the service module is imported unconditionally at startup, above the tool gate, so before this change a missing `mqtt` did not disable one tool, it prevented the server from starting at all and `tools/list` never answered. Verified against the built dist with the package absent: the server starts, non-lightning tools return normal results, the two lightning surfaces report unavailable, startup logs the reason exactly once regardless of how many saved locations are pre-warmed, and with the default `basic` preset nothing about `mqtt` is logged at all. (`src/services/blitzortung.ts`, `src/errors/ApiError.ts`, `package.json`)

### Fixed
- **Version headings in this changelog now link to their diff.** Each `## [X.Y.Z]` heading is a reference-style Markdown link, which renders as a link only when a matching definition exists at the foot of the file. The release script added the heading without the definition, so every new version showed up as literal `[X.Y.Z]` bracket text with no way to click through to what changed. New releases now get that definition automatically, and `[Unreleased]` is re-pointed to compare against the version just released. A few older versions were never tagged, so they have nothing to compare against and deliberately stay plain text — a link naming a tag that does not exist would only 404.

## [1.24.0] - 2026-08-24

### Added
- **Keyless national CAP alerts for India, the Philippines, and Indonesia on `get_alerts`** - `get_alerts` answered keyless for the US, Canada and 38 European countries, and since v1.23.0 for ~45 more territories **only with a billed Google key**. Everywhere else got a shrug — including India (1.4 B people), Indonesia (280 M) and the Philippines (115 M), and for India there was no path at all, because Google's own coverage 404s there (v1.23.0 live verification). All three countries publish official, keyless **CAP 1.2** feeds *with polygon geometry* — a strictly better source class than anything the server has for Europe, whose keyless feeds carry no geometry at all. The ICR framed these as three independent efforts, one service each; they are in fact the **same shape** (an RSS/Atom index listing per-alert CAP documents), so this ships as **one shared CAP ingestion layer plus three data-only feed adapters**, not three services. The new branch sits between the offshore `isInUS` fallback and the Google branch, so the routing invariant holds by construction: reaching Google still proves the point is in no keyless authority, and **none of these three ever contacts Google, key or no key**. **Matching is by the alert's own polygon** where the publisher supplies geometry inline — the Philippines and Indonesia today — which is the first keyless point-level alert matching in this server; a warning is shown only when its ring actually contains the requested point, verified live against BMKG, whose single active warning correctly read as *"1 active warning elsewhere in Indonesia, none covering this point"* for Jakarta. **India is country-level in practice**: SACHET publishes geometry from a separate `FetchPolygonXMLFile` endpoint that returns HTTP 403 to server-side clients while the CAP document endpoint on the same host returns 200 to a bare `curl` — endpoint-specific WAF blocking, not fingerprinting, confirmed across headers and alert ids — so 44 of 45 polygon fetches fail per refresh and those warnings render in the country-level block with an explicit "geometry could not be loaded or parsed" note. That is the designed degradation, and the important half is what it is **not**: an alert whose geometry is missing is always listed, never dropped, because treating "geometry unavailable" as "not near you" would be a fabricated all-clear on safety data. The docs say per-country which precision applies rather than claiming polygon matching uniformly. **Contract, not garnish, throughout**: an index failure propagates with a fixed sanitized message; a right-root document with no usable envelope (`<rss><error>maintenance</error></rss>`) throws rather than reporting zero alerts; when some documents fail the count is disclosed and stated to be *not* an all-clear for those alerts; and a ✅ is reserved for a feed that was read **in full** — when nothing loads the output renders `ℹ️`, and when only *some* alerts could not be read the honest-empty answer says so rather than printing a green check the feed never supported. Read-time filtering drops non-`Actual`, `Cancel`, expired and superseded warnings, and `responseType: AllClear` **last** — PAGASA's "Final" advisory is itself an `Update` carrying `AllClear` *and* the `references` that retire the prior advisory, so dropping AllClear earlier would leave a cancelled but unexpired advisory live. Caching keys documents and polygons on **`(identifier, published stamp)`, not identifier alone**: a SACHET RSS `guid` is the alert *thread* id and its URL serves whatever the latest version is, so identifier-only keying would keep serving the version first seen — an alert extended from 12:00 to 15:00 would read as *no alert* after 12:00. The pair is encoded as one injective token because `Cache.generateKey` joins with an unescaped `:` and both parts routinely contain colons. The country list caches the complete **unfiltered** set and filters on every read, so an original reappears when the Update superseding it expires first; geometry state never enters the 24 h document cache, so a transient polygon failure cannot freeze an alert to country-level for a day; and `polygonUnavailableCount` is derived over the returned view rather than cached, so the disclosure line can never name a count that contradicts the block beneath it. **Security surface**, this being the first feature to fetch URLs supplied by an upstream body: each feed carries a required HTTPS host/path allowlist checked before every document and geometry fetch, with userinfo and explicit ports rejected; redirects are not followed, so a 3xx cannot walk a request off an allowlisted host; response size is capped at the transport as well as after reading; a refused URL is counted, logged as a security event, and never fetched; and no log line or error message ever carries a URL, a response body, or alert geometry. Bounds throughout — 200 index items, 256 rings per warning, 10,000 points per ring, a 6-way fan-out, a per-feed request-start limiter honouring BMKG's documented 60 req/min, and a 40 s refresh deadline that starts no new work, aborts in flight sockets, and counts anything unsettled as unavailable. An **incomplete** ring set may include a point but never exclude one — whether the 256-ring cap discarded it or an individual `<polygon>` sibling failed to parse, the surviving rings can still put a warning in the matched block, while a warning they miss falls to the country-level block with the geometry disclosure instead of disappearing. Only geometry that parsed in full is allowed to answer "this does not cover you"; a point covered solely by a dropped ring must never read as "elsewhere". **First XML dependency**: `fast-xml-parser@^5.11.0` (the 4.x line fails `npm audit --audit-level=moderate`). Its parser is lenient — `'<a><b></a>'` parses without throwing — so well-formedness goes through `XMLValidator` first, a `<!DOCTYPE` declaration is refused outright, an HTML error page served with HTTP 200 is reported as a shape failure rather than zero alerts, and because `XMLValidator` itself accepts two self-closing roots (including two sharing a tag name, which the parser silently coalesces into an array) the root check is a post-parse structural one. **Byte-identity verified**: built-dist `get_alerts` output for Kansas City (NOAA), Toronto (GeoMet), Berlin (MeteoAlarm) and **Sydney with a key** is identical to the branch base, md5 for md5, with the keyed pair run by propagating one key explicitly into both child processes and asserting the Google attribution in both before comparing; keyless Sydney differs by exactly the one coverage sentence. Ten existing test files pass **unedited** — the new service parameters are optional and trailing, so every existing caller stays on the old path by construction. **Live-verified** across six points in both `standard` and `full` and through `get_weather_summary`: SACHET cold refresh 8.0 s against the 40 s deadline, warm refresh 26 ms re-fetching the index only, zero disallowed URLs on any feed, attributions byte-exact, no `Unknown | Unknown | Unknown` line, and the geometry disclosure count matching its block exactly (25 shown + 20 remainder = 45 failures). Reading that output caught a defect no assertion did: *"No active weather alerts for your location in Philippines"*, now given its definite article. Deliberately out of scope: Mexico (CONAGUA — no reachable feed index), Japan (JMA — area-code JSON, not CAP), SACHET's undocumented `FetchLocationWiseAlerts` POST shortcut, ETag conditional GETs, `language`/`source` parameters, `active_only: false` history, `check_service_status` rows, sub-country matching for Europe, and any behavioural change to the NOAA / GeoMet / MeteoAlarm / Google paths. (`src/services/nationalCap.ts`, `src/utils/capParse.ts`, `src/utils/pointInPolygon.ts`, `src/types/cap.ts`, `src/handlers/alertsHandler.ts`, `src/handlers/weatherSummaryHandler.ts`, `src/config/cache.ts`, `src/index.ts`)

- **Heat/cold stress context on `get_current_conditions` (WBGT + frostbite time-to-onset)** - The tool already showed *how it feels* — `Feels Like (Heat Index)` / `(Wind Chill)` in the US, apparent temperature elsewhere — but never what that means for the body. A wind chill of −40 °F and one of −5 °F rendered identically in form, yet one freezes exposed skin in minutes. Two gated lines now close that gap on **both** the NOAA and Open-Meteo paths (and therefore in `get_weather_summary`'s current section, which renders through the same formatters): a 🥶 **frostbite risk** line banding a computed North American Wind Chill Index into a time-to-onset for exposed skin, and a 🥵 **heat stress** line banding an estimated WBGT into exertion-risk categories, since heat index alone understates humid-heat risk for outdoor exertion. This is the Fosberg pattern (v1.20.0) in its purest form — a pure computation module, disclosed heuristic bands, honest derived-not-official framing — except with **zero service changes, zero new request variables, and zero cache-key changes**: every input was already fetched on every path, so the whole feature is one new pure util module, handler rendering, two config gates, and docs. **There is no new parameter and no schema change** (design principle 1: automatic output enhancement over parameter proliferation). Lines render only when thresholds are crossed — effective wind chill at or below −18 °F, or air temperature at or above 80 °F *and* rounded WBGT at or above 80 °F — so moderate-weather output is **byte-identical**, verified by diffing built-dist output for a moderate US point (San Francisco, NOAA path) and a moderate non-US point (Milan, Open-Meteo path) in **both imperial and metric**, plus the METAR source, against the v1.23.0 branch base: identical md5 across all five probes. The existing unit fixtures all sit at moderate temperatures, so every one of them passes unedited — that *is* the lock. **Which number drives the band is the load-bearing decision**: on the NOAA path a station-published `windChill` drives both the band and the display, so the risk statement can never disagree with the `Feels Like (Wind Chill)` number above it; absent one, the index is computed from temperature and sustained wind. On the Open-Meteo path it is always computed and **never banded off `apparent_temperature`**, which is a Steadman model making a different claim — and because the `Feels Like` line therefore does *not* show the band's basis, that line echoes its own value (live at Vostok: `Feels Like` −86 °F while the actual wind chill driving the band is −113 °F, a 27° gap that would have been invisible). Both bands are computed from the **rounded** display value, so the shown number and its band can never disagree at an edge (the v1.20.0 fire-weather lesson). A **calm-air carve-out** keeps the warning alive below the formula's 3 mph validity floor — −50 °F air freezes skin regardless of wind — by substituting the air temperature as the effective value; the pure helper still returns `null` there, staying faithful to the published domain, and the substituted value is named **"air temperature … in calm air"** rather than dressed up as a wind chill it is not. Wind that was **never reported** is kept distinct from measured calm air — a station with a dead anemometer would otherwise have its −25 °F observation rendered as "in calm air", asserting a fact nobody measured while the air-temperature band quietly understated a blizzard; that case now says wind is unknown and that skin could freeze sooner. Both numbers are disclosed as **computed by this server**, and the heat line carries a mandatory in-output caveat naming the two ways it can mislead: *estimated from temperature and humidity assuming full sun; thresholds vary with acclimatization*. That full-sun assumption is the ABM model's own published bias and it is visible in practice — Phoenix at 109 °F and 15 % RH still scores WBGT 92 "Extreme". Missing inputs omit the line silently with no `⚠️` note (garnish, not contract), and NaN never reaches the output. **Live-verified**: Vostok renders Extreme frostbite risk at a −113 °F wind chill matching the design's recorded upstream probe; New Orleans (NOAA) and Kuwait City (Open-Meteo) render the WBGT line with its caveat; metric and imperial produce identical bands with values in the caller's unit (−113 °F ↔ −81 °C, 95 °F ↔ 35 °C). Deliberately out of scope: the METAR path (one render path per release, the standing Fosberg-on-METAR precedent), forecast-path per-day thermal stress, and the full Liljegren WBGT, which needs solar radiation and an iterative solve. (`src/utils/thermalStress.ts`, `src/handlers/currentConditionsHandler.ts`, `src/config/displayThresholds.ts`, `src/utils/units.ts`, `src/index.ts`)

### Changed
- **Alert coverage statements now name India, the Philippines, and Indonesia.** The keyless `get_alerts` not-covered message and the tool description list the three new countries, and every "outside/beyond the US, Canada, and Europe" boundary sentence across the README, `docs/TOOLS.md`, `docs/GOOGLE_WEATHER_KEY_SETUP.md`, `SECURITY.md` and `CLAUDE.md` moves with them. The not-covered sentence is the only existing rendered string this release changes, and it is reached only on the keyless elsewhere path. Also corrected in `docs/TOOLS.md` and the Google key guide: the claim that Google returns the same answer for "no active alerts" and "region not covered" — falsified during v1.23.0 live verification, which is why an uncovered region already renders a distinct no-coverage note rather than a ✅.

### Fixed
- **The "…and N more" line on a capped alert list no longer tells you to raise a detail level you are already at.** When `get_alerts` caps a long list it appends a remainder line — `*…and 16 more warnings, mostly Moderate. Use detail="full" to see more.*` — and that closing hint rendered even when the call was already `detail="full"`, where `FULL_DISPLAY_CAP` is the last cap there is and no parameter reaches the rest. On the India path this was routine rather than theoretical: a live read on 2026-08-24 showed 39 active NDMA SACHET warnings, 25 rendered and 14 described only by a sentence pointing at a door that does not exist. The hint is now gated on the detail level, so below `full` it reads exactly as before — the advice is correct and actionable there, since the cap really does rise from 10 to 25 — and at `full` the line simply ends after the count and severity mix. Applies to all four renderers that cap: MeteoAlarm (Europe), the national CAP feeds (India, the Philippines, Indonesia), the keyed Google fallback, and MSC GeoMet (Canada). Output at `summary` and `standard` is byte-identical to v1.23.0.

### Documentation
- **The README now names the official package and shows how to verify it.** Republished copies of this server exist on npm under other scopes; they are MIT-licensed forks, which the licence permits, but they are not maintained here and are usually several versions behind. The README states plainly that the official package is `@dangahagan/weather-mcp`, published from this repository via npm trusted publishing, and gives the one command that checks a tarball's provenance attestation against the exact commit and workflow that built it (`npm view @dangahagan/weather-mcp@latest dist.attestations`) — so you can confirm what you are installing without installing it first. The issue tracker covers the official package only; anything installed from another scope should be reported to that package's publisher.

## [1.23.0] - 2026-08-18

### Added
- **Global alerts fallback on `get_alerts` (optional `GOOGLE_WEATHER_API_KEY`)** - `get_alerts` routes by country — US → NOAA, Canada → ECCC via MSC GeoMet, 38 European countries → MeteoAlarm — and everywhere else returned a polite "not yet available for this region". That elsewhere branch was the largest remaining hole in the server's safety-data story: an Australian, Japanese, or Brazilian user asking "any weather warnings?" got a shrug, and alerts are the highest-value category in the routing doctrine. WMO's Severe Weather Information Centre, the keyless candidate for exactly this hole, was verified not production-usable during v1.19.0 and nothing has changed. An optional key now fills the gap with Google's Weather API `publicAlerts:lookup` endpoint, an aggregation of official national feeds across roughly 45 territories including Australia, New Zealand, Japan, South Korea, Taiwan, the Philippines, Thailand, Singapore, Vietnam, Brazil, Mexico, Ecuador, Jamaica and Côte d'Ivoire. **The keyless authorities are untouched and never contact Google** — NOAA, ECCC, and MeteoAlarm are jurisdictional authorities and stay first choice even when a key exists, and the branch order alone guarantees it: reaching the Google branch already proves the point is none of those. **No client-side country allowlist ships in code**: Google's own caveat is that alert regions are provider polygons and "country and region coverage alignment may not be exact", so a hardcoded list would drift and mis-gate border regions — Google answers the coverage question per request instead, and an uncovered answer is cached so the region isn't re-probed. **Unlike the pollen key, this data is contract, not garnish.** Pollen is a section riding an air-quality response; alerts *are* the tool's entire answer, so the failure posture is the peer-source posture of the GeoMet and MeteoAlarm services: a rejected key, quota exhaustion, timeout, or network failure propagates with a fixed sanitized message rather than degrading silently, because a fabricated "✅ no alerts" produced by a failed fetch would be a dangerous lie about safety data. **An empty answer is split into its two real causes**, because they mean opposite things: a covered region with nothing active (HTTP 200) renders "no alerts found" with a standing coverage caveat rather than a bare all-clear (the FIRMS not-all-clear framing), while a region Google does not cover (HTTP 404) renders a distinct `ℹ️ No alert coverage for this location` that states plainly it is **not** an all-clear. The design originally gave both one message on the assumption that Google returns the same shape for each; live testing disproved it — India, Kenya, Hong Kong and the open ocean all 404 while Australia, Japan, Taiwan, Mexico and Brazil answer 200 — so a user asking about Mumbai during monsoon season was being shown a green check mark for a question that was never asked. Rendering is a fourth CAP-shaped renderer kept deliberately close to the MeteoAlarm one and reusing the same severity ranking, emoji, 10/25 display caps and remainder note (Google's severity enum is exactly NOAA's): per alert a severity/urgency/certainty line, area name, effective and expiry times rendered **in the alert's own `timezoneOffset`** per the times-as-issued doctrine, description verbatim at `full`, instructions at `standard`+`full`, and safety recommendations at `full`. **Attribution is mandatory in two layers** and both render: the exact required string `Source: Includes weather data from Google` in the footer, and a per-alert `**Source:**` line naming the original publisher with its authority URI. **Key hygiene follows the FIRMS threat model** because the key rides in the URL query string: the service never logs or throws a request URL or a raw axios error, every thrown error is a fixed pre-written string, logs carry only `{ status, code }`, and unit tests assert a configured key appears in no thrown message and no logger call argument. Responses are cached **in memory only** for 5 minutes per location and never persisted, a deliberate reading of the Google Maps Platform terms — 5 minutes is the TTL the server already uses for every other alert source, since alert volatility is alert volatility regardless of source. There are no retries, matching the GeoMet and MeteoAlarm services. **Without a key the output is byte-for-byte unchanged**: verified by diffing built-dist `get_alerts` output for Sydney (the elsewhere branch itself), a US point, Berlin (MeteoAlarm, which returned real DWD warnings during the sweep rather than a vacuous empty), and Toronto (GeoMet, which also re-locks the CONUS-box overrun) against the v1.22.0 base with no key set — all four identical — and locked by `alerts-routing.test.ts`, `alerts-detail.test.ts`, and `alert-sorting.test.ts` passing unedited, since the new service parameter is optional and trailing and those files pass at most seven arguments. Deliberately out of scope: every other Google Weather API endpoint (forecast, current, history, minute-nowcast), polygon rendering or point-in-polygon filtering, `languageCode` as a tool parameter (pinned `en`; Google translates only the title anyway), key reporting in `check_service_status`, persistent caching, and any change to the NOAA/GeoMet/MeteoAlarm paths. Note that like the pollen key this one is **not a free registration** — Google requires a Cloud billing account with a payment method even for the free tier, and a key restricted to the Pollen API will *not* work here (the Weather API must be enabled and the key unrestricted or Weather-restricted); see [`docs/GOOGLE_WEATHER_KEY_SETUP.md`](./docs/GOOGLE_WEATHER_KEY_SETUP.md). **Live-verified against a real key**, which passed the free-tier gate — the Weather API has exactly one SKU ("Weather Usage", `9DB8-727A-ACFE`, Essentials tier, **10,000 free events/month**), so alerts bill under it and there is no separate alerts SKU — and then corrected **six** things the published documentation got wrong, each now locked by a regression test. **The response array field is `weatherAlerts`, not `alerts`**: reading the documented name returned an empty array for every location on Earth, so the feature would have shipped silently doing nothing. **`severity`/`urgency`/`certainty` are SCREAMING_CASE** (`"SEVERE"`), not the CAP title case the design assumed was "exactly NOAA's" — every alert would have ranked `Unknown` and rendered a grey marker, collapsing the severity sort. **`timezoneOffset` is a seconds duration** (`"28800s"`), not `±HH:MM` — every effective and expiry time would have silently rendered in UTC, shifting a safety-critical figure rather than failing loudly. **`safetyRecommendations` holds objects** (`{ directive, subtext }`) while its sibling `instruction` holds plain strings. **`dataSource` is `{ publisher, name, authorityUri }`** with no `fullName`. And — the pollen-T6 deviation repeating almost exactly — **an uncovered region answers HTTP 404 `NOT_FOUND`, not the `regionCode`-only HTTP 200 the docs described**; that fell through to the generic-status branch and *threw*, which under the contract-not-garnish posture meant a mid-Pacific point surfaced a hard error while the "don't re-probe uncovered regions" cache never populated. It now resolves to no-data and caches, matched on the message rather than the status so a genuinely malformed request still errors instead of being cached as "no alerts here". Live sampling also showed field presence varies widely by publisher — one PAGASA alert carried no severity, no times, and no instructions at all — so the CAP line is now omitted entirely rather than rendering `Unknown | Unknown | Unknown`. The rejected-key mapping was confirmed exactly as designed (HTTP 400 carrying `API key not valid` / `API_KEY_INVALID`), the routing invariant was proven live (a valid key set, `LOG_LEVEL=0`: the US, Berlin, and Toronto requests produced **zero** Google log lines and zero Google attribution), and the key string was verified to appear in no driver output, no log, nowhere in the repo, and nowhere in git history. One upstream fact is recorded but not acted on: the response carries a `nextPageToken`, so pagination exists where the docs listed none — nothing was truncated in testing against the 10/25 display caps, but a heavily-warned location could under-report. (`src/services/googleWeather.ts`, `src/types/googleWeather.ts`, `src/handlers/alertsHandler.ts`, `src/handlers/weatherSummaryHandler.ts`, `src/config/api.ts`, `src/index.ts`)

### Documentation
- **`docs/GOOGLE_WEATHER_KEY_SETUP.md`** - A sibling of the pollen setup guide covering the console walk-through for the Weather API key: project, billing, enabling the **Weather API** specifically, key restriction (Application restrictions **None**, API restrictions **Weather API**) and per-day quota capping, with an explicit section on why an existing Pollen-restricted key cannot be reused and what to do instead. Carries the same `**Last verified:**` freshness stamp convention and is now stamped **live-verified**, the walkthrough having been walked in the console during provisioning — which corrected one of its own steps: for Maps Platform keys the **API restrictions** control lives on the *Google Maps Platform → Credentials* page, not *APIs & Services → Credentials*, and APIs that aren't enabled on the project don't appear in its "Select APIs" list at all (the failure mode that later makes a working key look rejected).

## [1.22.0] - 2026-08-18

### Added
- **Global pollen fallback on `get_air_quality` (optional `GOOGLE_POLLEN_API_KEY`)** - Pollen has been Europe-only since it shipped in v1.18.0, and not by choice: it rides the CAMS *European* model on the air-quality endpoint the tool already calls, which returns real grains/m³ in Europe and HTTP 200 with every species null everywhere else. US users — most of the install base — got nothing, and the tool description said so. An optional key now fills that gap with Google's Pollen API: when a `GOOGLE_POLLEN_API_KEY` is configured **and** all six CAMS species come back null, `get_air_quality` renders a grass/tree/weed **Universal Pollen Index** (0–5) with category labels and an in-season plant list for the ~65+ countries Google covers, including the United States. **Europe is untouched** — it keeps the richer keyless per-species grains/m³ data and never contacts Google, which protects both the monthly quota and the privacy posture. The trigger is the all-six-null gate, so *partial* European coverage also stays keyless: one real species is coverage. To guarantee the trigger and the render can never drift apart, both now read the same extracted `finiteCamsPollen` helper. **The Google data is garnish, not contract** (the ACIS/records precedent): the entire fetch sits in one try/catch and the air-quality call never fails because of it — a quota error, timeout, network failure, uncovered country, or empty response all degrade silently to today's no-section behavior. The single exception is a **rejected key**, which renders one note (`*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is unavailable.*`) on the wildfire-F3 disclosure precedent, because silence would hide a misconfiguration forever from a user who deliberately configured a key. Out-of-season types are omitted rather than rendered as zero (Google drops the index object entirely for them), while a zero index that *is* present renders as a meaningful "none detected", mirroring the existing CAMS olive-0 rule. The rendered footer carries the exact string `Source: Includes pollen data from Google`, which the Pollen API policies require to appear on or next to the data. **Key hygiene follows the FIRMS threat model**, because the key rides in the URL query string: the service never logs or throws a request URL or a raw axios error, every thrown error is a fixed pre-written string, logs carry only `{ status, code }`, and coordinates go through `redactCoordinatesForLogging` — with unit tests asserting a configured key appears in no thrown message and no logger call argument. Responses are cached **in memory only** for 6 hours per location and never persisted, a deliberate and disclosed reading of the Google Maps Platform terms; an uncovered region caches a null sentinel so it isn't re-probed every call. There are no retries — garnish must not add latency on failure. **Without a key the output is byte-for-byte unchanged**: verified by diffing built-dist `get_air_quality` output for a US point (Kansas City) and a European point (Berlin) against the v1.21.0 branch base with no key set, and locked by `air-quality-pollen.test.ts` and `air-quality-forecast.test.ts` passing unedited — the new service parameter is optional and trailing, so the keyless path is the old path by construction. Deliberately out of scope: the multi-day Google pollen forecast (day 1 only), health-recommendation strings, per-plant deep detail, key reporting in `check_service_status` (matching FIRMS, which reports none), and any persistent caching. Note that unlike the NCEI and FIRMS keys, this one is **not a free registration** — Google requires a Cloud billing account with a payment method even for the free 5,000 lookups/month tier, which is why it stays strictly optional and is never described as simply "free"; see [`docs/GOOGLE_POLLEN_KEY_SETUP.md`](./docs/GOOGLE_POLLEN_KEY_SETUP.md). **Live-verified against a real key**, which confirmed the rejected-key mapping exactly (HTTP 400 carrying both `API key not valid` and `API_KEY_INVALID`) and corrected one wrong assumption: an **uncovered region answers HTTP 400 `INVALID_ARGUMENT` with "Information is unavailable for this location", not the HTTP 200 with an empty payload the design expected**. The rendered outcome was already right either way (silent no-section), but because that answer *threw*, the "don't re-probe uncovered regions" cache was never populated and such a location re-queried Google on every single call — burning the very quota the 6-hour TTL exists to protect. That answer now resolves to no-data and caches, matched on the message rather than the status so that a genuinely malformed request still surfaces as an error instead of being silently cached as "no pollen here" for six hours. Live verification also showed the upstream shape is subtler than documented: `indexInfo` presence is **independent of `inSeason`** — a type can report `inSeason: false` yet carry a real index, while another omits both — so the render guards on the index value being finite and shows "in season" only when Google actually says so. (`src/services/googlePollen.ts`, `src/types/googlePollen.ts`, `src/handlers/airQualityHandler.ts`, `src/config/api.ts`, `src/config/cache.ts`, `src/index.ts`)

### Documentation
- **README "Optional API keys" section + standing key policy** - The README's headline promises ("zero API keys, zero signup, zero cost"; "no credit card"; "No API keys, tokens, or accounts needed") were true for the default configuration but had no single honest caveat, while the three optional keys were scattered across an env-var row, a prose aside, and nothing at all. They now consolidate into one **Optional API keys** section that leads with the default-works-keyless framing, then states plainly for each key what it adds, what still works without it, and what it actually costs to obtain — including that the Google Pollen key requires a billing account and is therefore *not* a free registration like NCEI and FIRMS. The section also records the **standing key policy** (mirrored into the planning index so future feature triage inherits it): optional keys must always have a usable free tier, no tool will ever *require* a key, and features that would require a *paid* key are out of scope absent significant demand for that specific service.

## [1.21.0] - 2026-08-18

### Changed
- **Climate normals hardening (`include_normals`)** - `include_normals` has been global since v1.2.0 — NCEI is tried only when an `NCEI_API_TOKEN` is set *and* the point is in the US, and everything else falls back to 1991–2020 normals computed from the Open-Meteo archive for any coordinates on Earth. Since the project ships keyless, that "fallback" is the path virtually every caller is already on, US included. The planning index and the coverage roadmap both still listed normals as a US-only gap; both were stale, and what was left was not a coverage feature but a hardening pass on the path everyone uses. **One archive pull per location, not per date:** normals were cached per `(lat, lon, month, day)` — up to 366 keys per location in an LRU capped at 1,000 entries, where each eviction cost a full 30-year refetch. The service now fetches `1991-01-01`…`2020-12-31` **once per location** and computes all 366 `"MM-DD"` slots in a single pass, caching the table under a new `CacheConfig.ttl.normals` entry (the TTL was previously hardcoded at two call sites). Live-verified at **+2.5 % bytes** over what a *single* date cost before, so every subsequent date at that location — and the whole `get_weather_summary` fan-out — is a cache hit; a cache eviction now costs one pull instead of up to 366. The old "fetch only the target month ±1" comment was removed with the code: the range was contiguous, so the API returned every interior day of all 30 years anyway and the optimization was illusory. **A real averaging bug is fixed:** sample filtering tested `!== undefined`, so Open-Meteo's JSON `null`s reached the sum, where `sum + null` coerces to `+ 0` and quietly dragged means *down* at any location with archive gaps. Means now use only non-null samples, a slot needs at least 15 of 30 years to render at all (**Feb 29** carves out at 6, since only 8 leap days exist in the period, and it now yields a real leap-day mean rather than nothing), and an all-null response caches an all-unavailable table so an ocean point never refetches per date. **Rate-limit posture:** Open-Meteo weights archive calls by period length. Concurrent requests for the same location now share one in-flight pull instead of racing, and a 429 is retried once after ~2 s. Normals remain garnish throughout — every failure path still ends at the unavailable note and never fails the parent forecast or current-conditions response. **AK/HI/PR now reach NCEI:** the NCEI gate used a private contiguous-US box, so a token holder in Anchorage or Honolulu silently never got official station normals; it now uses the shared `isInUS` predicate the records line already used. **Rendering:** five near-identical blocks across two handlers collapse into one shared helper, which also fixes a drift — the success path rendered `## 📊 Climate Context` while every failure path rendered `## Climate Normals`, one section under two names depending on whether the data arrived. Normals are now stored as unrounded floats with all rounding at render. **Imperial output is byte-identical** (verified by diffing built-dist Kansas City output against the branch base); **metric values may differ by up to 1° as displayed**, because the old path rounded °C→°F to integers at compute time and metric users then paid a lossy °C→°F→int→°C round-trip — that is the fix, not drift (Paris live: normal high 24 °C → 25 °C, normal precipitation 1 mm → 0.9 mm). Finally, the international guarantee is actually tested: the non-US normals test accepted *either* a rendered section *or* the unavailable note, so it passed even if non-US normals broke entirely; it now asserts the section renders. (`src/utils/normals.ts`, `src/services/openmeteo.ts`, `src/config/cache.ts`, `src/handlers/forecastHandler.ts`, `src/handlers/currentConditionsHandler.ts`)

### Added
- **Single-model ensemble spread on `get_forecast` (`ensemble_spread: true`)** - `compare_models` (above) answers "do the models agree?"; this answers the sibling question it cannot: **"how confident is the model itself?"** A global ensemble runs the same model many times from perturbed initial conditions, and the spread of those members is the model's own uncertainty estimate — one that widens with lead time in a way five deterministic models cannot show (5 samples versus 50). The flag returns a **member-spread confidence view** built from one fixed model, **ECMWF IFS 0.25° (ENS)** — 50 perturbed members plus a control run, fetched in a single keyless call to Open-Meteo's Ensemble API. Following the same summarize-don't-dump philosophy as the comparison and GloFAS river discharge, it **never renders fifty forecasts**: each day gets a High/Moderate/Low confidence label, the p25–p75 interquartile band for the daily high and low with the median, how many members produce measurable precipitation with the amount range **across the wet members only**, a typical wind band, and a conditions consensus naming a runner-up bucket when it holds at least a quarter of members. Every rendered range is the interquartile band rather than the absolute envelope: with 50 members the extremes are single outlying runs, and min–max would read as far more uncertainty than the ensemble actually carries — `detail: "full"` adds the envelope as its own line for readers who want it, and `detail: "summary"` collapses to one line per day. The **control run renders as a headline reference but is excluded from every statistic, fraction, band, and trimming decision**, exactly as `best_match` is in the comparison: it is the unperturbed higher-weight run, not an equal-probability member. Because it is extracted from the unsuffixed series by a separate function and never merged into the member series, that exclusion is structural rather than a filter that could be forgotten. The honest framing is in the output, following the FIRMS hotspots-not-incidents and Fosberg derived-not-official precedents: **member fractions are raw model output, not calibrated probabilities** — a confident ensemble can still be wrong — and the confidence labels and spread bands are disclosed as project heuristics. `precipitation_probability_max` is deliberately never requested: on the ensemble endpoint it returns HTTP 200 with all-null control *and* member arrays, because probability is *derived from* ensembles rather than published by them — the wet-member fraction computed here IS that product. Ragged horizons are handled from real data rather than assumption: ECMWF's daily data ends around day 14, so `days: 16` renders 14 days and trims the rest under a note, while interior gaps are retained and render with their reduced member count. Fewer than two perturbed members, or nothing left after trimming, raises an error rather than presenting a one-member "distribution". Interactions are settled deliberately: `ensemble_spread` and `compare_models` are **mutually exclusive** (distinct products, distinct requests), and `granularity: "hourly"` and `source: "noaa"` are **validation errors** thrown before any request — silently returning a plain forecast to someone asking how certain the forecast is would be dishonest — while `include_normals`/`include_astronomy`/`include_severe_weather`/`include_precipitation_probability` are silently ignored. At US points the spread is used too, with a footer disclosure that the NOAA/NWS point forecast is not the model being spread; NOAA is never contacted on this path. `get_weather_summary` **strips** the flag. **Requests without the flag are byte-for-byte unchanged** (verified by diffing built-dist output for US, non-US, normals, astronomy, hourly, and `compare_models` requests against the branch base, and locked by `forecast-fallback.test.ts`, `forecast-model-comparison.test.ts`, `astronomy.test.ts`, `normals.test.ts`, `almanac-handler.test.ts`, and `weather-summary-handler.test.ts` all passing unedited): the spread uses a separate service method on a separate host, a separate five-variable request, and a distinct cache namespace, leaving `getForecast` and `getModelComparison` untouched. The member count shown always comes from the response rather than the documented constant. Deliberately out of scope: caller-selectable ensemble models, hourly member spread, combining with `compare_models` in one output, and any probability calibration or skill claim. (`src/utils/ensembleSpread.ts`, `src/services/openmeteo.ts`, `src/types/openmeteo.ts`, `src/handlers/forecastHandler.ts`, `src/handlers/weatherSummaryHandler.ts`, `src/index.ts`)

- **Multi-model forecast comparison on `get_forecast` (`compare_models: true`)** - "How confident is this forecast?" was a natural assistant question the server could not answer: `get_forecast` returned one deterministic forecast with no uncertainty signal, and models disagree exactly when uncertainty matters most — storm tracks, rain/no-rain days, temperature swings. The flag now returns a **model-agreement view** built from five global models fetched in a single Open-Meteo request: **GFS** (NOAA/NCEP), **ECMWF IFS**, **ICON** (DWD), **GEM** (ECCC), and **UKMO** (UK Met Office). Following the `formatEnsembleForecast` precedent set by GloFAS river discharge, it **summarizes agreement and divergence rather than dumping five forecasts**: per-day temperature spread with an agreement band (tight/moderate/divergent), how many models predict measurable precipitation with the amount range across the wet models, wind ranges, and a conditions consensus naming up to two dissenting models. Each day carries an overall Good/Moderate/Low agreement label, and a divergent day names the responsible model ("driven by ICON") **only** when removing it actually drops the band a level — otherwise it honestly reports the models as broadly split rather than scapegoating one. Open-Meteo's `best_match` blend renders as a headline reference line but is **excluded from every statistic, band, participation count, and trimming decision**: it is a blend of (largely) these same models, so counting it would double-count and artificially tighten every spread. The honest framing is in the output, following the FIRMS hotspots-not-incidents and Fosberg derived-not-official precedents: spread is a *proxy* for uncertainty, not a guarantee — a tight spread can still be wrong — and model run times differ and are not shown. **Every live-verified null mode is handled distinctly**, because a model returning HTTP 200 with all-null arrays is real (the Flood-API/pollen precedent): an all-null model is dropped before any statistics and disclosed by name; a model missing one product still participates in the others (UKMO publishes no precipitation probability at all, so that count is legitimately lower and the output says so); and ragged horizons (ECMWF ~14 days, GFS 15 of 16 requested) produce per-day "(N of 5 models)" counts with trailing days below 2 models trimmed under a note, while interior gaps are retained. Fewer than two surviving models raises an error rather than presenting a one-model "comparison". Interactions are settled deliberately rather than left implicit: `granularity: "hourly"` and `source: "noaa"` are **validation errors** (the comparison IS the requested product, so silently returning a plain forecast would be dishonest — unlike garnish flags, which are ignored); `include_normals`/`include_astronomy` are silently ignored; `include_precipitation_probability: false` composes; and `detail` gives one line per day, the full blocks, or additionally compact per-model value lines. At US points the comparison is used too, with a footer disclosure that the NOAA/NWS point forecast is not among the compared models (`gfs_seamless` represents the US global model) — NOAA is never contacted on this path. `get_weather_summary` explicitly **strips** the flag, since a comparison block is the wrong shape inside a summary. **Requests without the flag are byte-for-byte unchanged** (verified by diffing built-dist output for a US and a non-US point against the v1.20.0 branch base, and locked by `forecast-fallback.test.ts`, `astronomy.test.ts`, `normals.test.ts`, `almanac-handler.test.ts`, and `weather-summary-handler.test.ts` all passing unedited): `getForecast` keeps its exact request params, cache key, and TTL, and the comparison uses a separate service method, a separate six-variable request, and a distinct cache namespace. Agreement bands, the precipitation threshold, and the weather-code buckets are disclosed in code as project heuristics, not published standards. Deliberately out of scope: caller-selectable models (regional models break the anywhere-on-Earth contract), hourly comparison, and single-model ensemble spread. (`src/utils/modelComparison.ts`, `src/services/openmeteo.ts`, `src/types/openmeteo.ts`, `src/handlers/forecastHandler.ts`, `src/handlers/weatherSummaryHandler.ts`, `src/index.ts`)

### Fixed
- **Test suite: METAR climate-normals fixture no longer fails around local midnight** - `tests/unit/metar-handler.test.ts` built its ACIS records slot from `new Date()` while the handler derives the slot from the *observation's* timestamp, so for roughly the first 20 minutes after local midnight the two landed on different calendar dates and the test failed for reasons unrelated to anything under test. The fixture now derives its date from the observation it feeds the aviation fake. Test-only — no product behavior changes. (`tests/unit/metar-handler.test.ts`)

## [1.20.0] - 2026-08-14

### Added
- **Global `get_wildfire_info` (NASA FIRMS)** - The last US-only safety tool now routes by **country**, the same way `get_alerts` does: US points keep the NIFC/WFIGS named-incident path byte-for-byte unchanged (verified by diffing built-dist Sacramento output against `main`, and locked by `tests/unit/wildfire-handler.test.ts` passing unedited), while everywhere else returns **NASA FIRMS satellite fire detections** (VIIRS Suomi NPP, near real-time — detections land within ~3 h of overpass). FIRMS returns *hotspots*, not managed incidents — no fire names, sizes, or containment — so the output frames them honestly: detections are clustered (greedy FRP-descending, 2 km centroid radius, deterministic), each cluster reporting count, distance + 16-point bearing, peak fire radiative power (MW), newest-detection age, day/night mix, confidence summary, and satellite; a header disclosure states that detections may be industrial heat sources, gas flares, or agricultural burns; and a no-detections result carries an explicit not-all-clear caveat (cloud cover hides fires; small/new fires evade detection) instead of reading as safe. The safety assessment reuses the NIFC distance tiers keyed on the nearest cluster, with no containment logic (FIRMS has none). **Keyless-first:** with zero configuration the tool works globally from FIRMS' keyless 24 h regional flat CSV files (a conservative inset picks the right regional cut — 9 KB–5.2 MB — falling back to the ~10 MB `Global` file whenever a point isn't comfortably inside one, e.g. the Middle East gap or the US–Canada border band; parsed rows are cached per region file for 30 min, so repeated queries across a region cost one fetch). An optional free `FIRMS_MAP_KEY` upgrades to targeted Area-API bbox queries and `day_range` 1–5; because the Area API counts calendar UTC days while the flat files are rolling, the keyed path requests one extra day and filters to the true rolling window so "last 24 h" stays honest. A rejected key falls back keyless with a disclosure note; `day_range > 1` without a key serves 24 h data plus an upgrade note; the key is never present in any thrown message or log line (structurally enforced and unit-tested). New `source` parameter (`auto`/`nifc`/`firms`) with deliberately **no cross-fallback** — incidents and detections are different claims; `source: "firms"` works in the US too, useful for fires not yet catalogued in WFIGS. Country resolution reuses the cached country-level Nominatim reverse lookup, so Toronto and Vancouver (inside the deliberately sloppy CONUS boxes) now correctly route to FIRMS. Both CSV shapes the two FIRMS paths emit (14-column Area API with abbreviated confidence and unpadded times; 13-column flat files, spelled-out and zero-padded) are parsed by header name, never by position. **Routing correctness, from the pre-release review:** NIFC coverage is keyed on an evidence-gated allowlist (`us`, `pr`, `vi`, `gu`) rather than the bare string `'us'`, so Puerto Rico, the US Virgin Islands, and Guam keep the named-incident path they had before this release — the territory set was confirmed against what WFIGS actually publishes (all-years `POOState` values carry `US-GU`/`US-VI`/`US-PR` and none for American Samoa or the Northern Marianas, which route to FIRMS). A forced `source: "nifc"` outside that coverage no longer prints `✅ No active wildfires found` over a place NIFC does not watch: the empty result states that NIFC/WFIGS tracks US incidents only, that this is an absence of coverage rather than an all-clear, and points at `source: "firms"` — still with no cross-fallback. And the keyed bbox now *slices* longitude across the antimeridian instead of clamping it (two disjoint queries meeting at ±180, merged before clustering), so a 500 km query near the dateline no longer silently drops everything the keyless path finds. (`src/services/firms.ts`, `src/utils/firmsHotspots.ts`, `src/types/firms.ts`, `src/handlers/wildfireHandler.ts`, `src/config/api.ts`, `src/config/cache.ts`, `src/index.ts`, `.env.example`)

- **Global fire weather on `get_current_conditions` (computed Fosberg index)** - `include_fire_weather` was US-only: outside the US it rendered a two-line stub and computed nothing. It now returns a **Fosberg Fire Weather Index** computed by this server from the current temperature, relative humidity, and sustained wind already in hand, plus a dryness-context block (vapour-pressure deficit in kPa, topsoil moisture in m³/m³). The roadmap premise turned out to be wrong and is corrected here: `src/utils/fireWeather.ts` held no formulas to reuse — it is an *interpretation* layer over five series NOAA pre-computes on its gridpoint API — so nothing in the codebase computed a fire-weather index before this. The distinction is carried in the output rather than hidden: the section closes with *"Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority."*, the same way rivers distinguish gauge from model and current conditions distinguish station from model. **The US path is byte-for-byte unchanged** (verified by diffing built-dist Denver output against the branch base, both with and without the flag, and locked by `tests/unit/fireWeatherContext.test.ts` passing unedited): `getFireWeatherContext`, with its US geography boxes and northern-hemisphere seasonality, is never called on the global path, so the index is hemisphere-proof by construction — it reflects conditions actually measured, not a guess from the calendar. Requests without the flag are byte-identical everywhere, since the two extra request variables (`soil_moisture_0_to_1cm`, `vapour_pressure_deficit`) are appended only when fire weather is asked for, and the current-conditions cache key incorporates the flag so a non-fire response is never served to a fire-weather request. Values arrive in the caller's preferred units (Open-Meteo converts server-side), so they are normalized back to the fixed °F/mph the index needs before computing — no second fetch, and the index is identical whether you ask in metric or imperial (verified live in Milan). Open ocean returns HTTP 200 with null dryness fields, which drop their lines; a missing core input renders an explicit unavailable note, never `NaN`. Works in the US too via `source: "openmeteo"` (the rivers/FIRMS precedent). Band boundaries are disclosed in the code as project heuristics, not an agency scale. **Null-safety and blast radius, from the pre-release review:** the unavailable note now depends only on whether an input is missing, never on the caller's unit preference — Open-Meteo returns `null` (not `undefined`) for absent values, and under metric the null used to survive unit conversion (`celsiusToFahrenheit(null)` → 32) and render a fabricated `2 (Low)` index where imperial correctly rendered the note. The three core fields are typed nullable and guarded with `!= null` throughout, so a null omits its line rather than displaying a converted zero anywhere in the conditions block. The two extra request variables are also best-effort now, matching how this codebase treats every other enrichment: if Open-Meteo ever rejects them for the model at some coordinate, the request is retried once without them instead of failing the whole `get_current_conditions` call, and the section simply renders without its dryness context. Deliberately out of scope this release: Haines globally (needs pressure-level variables) and Fosberg on the METAR source — whose note now points at *both* index routes (`source: "noaa"` in the US, or omitting `source` for the computed index elsewhere) rather than only at NOAA, which would reject the non-US callers most likely to read it. (`src/utils/fireWeather.ts`, `src/utils/units.ts`, `src/services/openmeteo.ts`, `src/types/openmeteo.ts`, `src/handlers/currentConditionsHandler.ts`, `src/index.ts`)

## [1.19.0] - 2026-08-13

### Added
- **Composited radar maps on `get_weather_imagery` (`composite: true`)** - The tool returned tile *URLs*, and a RainViewer tile is a transparent precipitation overlay: with no base map underneath it renders as geography-free colored blobs, or — over dry skies — a fully blank square that reads as a broken link. `composite: true` now returns a **finished picture** instead: the radar overlay rendered onto a NASA GIBS base map (`OSM_Land_Water_Map` land/water plus `Reference_Features_15m` coastline/border outlines) with a high-contrast crosshair at the requested location, attached as an MCP image content block alongside the existing text (`[text, image]`). The map is **centered on the requested coordinates** rather than aligned to the upstream tile grid — a tile-aligned composite drops the location wherever it happens to fall inside its tile, which in live testing put a saved location 36 px from the edge of its own map. The pipeline works in one shared global pixel space (RainViewer's 512px tiles at zoom *z* and the GIBS 256px tiles at zoom *z+1* describe the same grid), assembles whichever tiles cover a 512×512 window around the point, and crops to it; output size, zoom, and payload are unchanged, and longitude wrap at the antimeridian and clamping at the poles are both handled. The assistant always receives the image and can describe the actual weather pattern; whether it renders inline depends on the client, and text-only clients ignore the image block per protocol and lose nothing. Compositing is pure JS — `pngjs` is promoted to a runtime dependency (zero transitive deps, same bar `astronomy-engine` met in v1.16), with no native modules and no new API key. Radar/precipitation only, latest observed frame only: `animated: true` keeps its frames URL-based and attaches just the newest one (13 composited frames would be a multi-megabyte payload), and `type: "satellite"` returns an explanatory note rather than an error, since GeoColor is already a complete picture. Live-measured payloads run 30–97 KB PNG / 40–129 KB base64 at radar zoom 6 — an order of magnitude under the 1 MB defensive cap. **The composite is garnish, never contract:** any failure in the path (unparseable tile URL, tile fetch, decode, over-cap encode) logs a warning and returns the normal URL-based text output with a one-line note, so the tool call never fails because compositing failed. Requests without `composite` are byte-for-byte unchanged (verified by diffing built-dist output against `main`). Base tiles cache 24 h, composites 10 min. (`src/services/basemap.ts`, `src/utils/composite.ts`, `src/handlers/weatherImageryHandler.ts`, `src/types/imagery.ts`, `src/index.ts`)
- **Interactive-map link on `get_weather_imagery`** - Raw tile URLs are transparent precipitation overlays with no base map underneath — standalone they render as colored blobs (or a blank square where dry), and RainViewer frames expire after ~2 hours. The output now always appends a first-party browser viewer that layers them properly: RainViewer's live map (`map.html?loc=lat,lon,zoom`) for radar/precipitation, NASA Worldview (`?v=` extent, latitude clamped at the poles) for satellite. Both URL formats verified against first-party sources 2026-08-13. (`src/handlers/weatherImageryHandler.ts`, `src/index.ts`)
- **International weather alerts on `get_alerts` (Canada + Europe)** - The most prominent remaining US-only safety tool now routes by **country**: US points keep the NOAA path byte-for-byte unchanged (verified by diffing built-dist Seattle output against `main`, and locked by `tests/unit/alerts-detail.test.ts`/`alert-sorting.test.ts` passing unedited), Canadian points get Environment and Climate Change Canada alerts from the keyless MSC GeoMet OGC API Features collection (native bbox, real polygons, `status_en: "ended"` items filtered), and points in the 38 EUMETNET MeteoAlarm member countries get their national met service's official warnings from the country's keyless CAP JSON feed — every slug in the membership map live-verified on 2026-08-13 (one corrected: North Macedonia's live slug is `republic-of-north-macedonia`). Everywhere else returns a clean not-covered message naming the region instead of a wrong-country NOAA error. Because alert authority is jurisdictional rather than geometric, coordinate-only requests resolve their country via a new **country-level Nominatim reverse lookup** (`zoom=3` — the privacy-minimal "which country" question; cached permanently on ~1.1 km rounding, open-ocean "no country" results included); a saved location or geocoded `city_name` that already knows its country skips the lookup entirely. The reverse answer **wins over the `isInUS` bounding boxes**, which deliberately overrun the border — Toronto and Vancouver now correctly route to ECCC instead of a wrong-country NOAA query — while a no-country answer (US coastal waters) still falls back to `isInUS`, preserving NOAA marine alerts offshore. MeteoAlarm feeds ship every language variant and days of expired items (Germany: 161 published, 51 actually active), so warnings select the English `info` entry (fallback: first), and expiry + `Update`-chain supersession are filtered **at read time** on every call — a cached list never serves a warning that expired since it was cached. Feeds are large (Germany 2.76 MB) and cached 5 minutes, parsed once. Renderers honour the licence terms as terms: CAP text and `alert_text_en` verbatim, issue times always shown in the offsets the source published (both new paths skip NOAA's station-timezone side-call), attribution footers name "EUMETNET – MeteoAlarm (national warnings: <service>)" and "Environment and Climate Change Canada (MSC GeoMet)". European output carries an explicit country-level-granularity coverage note; display caps disclose the remainder (`standard` top 10, `full` top 25, `summary` counts by severity/colour); `active_only: false` notes that historical alerts aren't available outside the US instead of erroring. `get_weather_summary` drops its US-only alerts short-circuit — the alerts section now dispatches everywhere and renders real warnings (Paris) or the handler's own not-covered message (Sydney). Rest-of-world (WMO SWIC/Alert-Hub) was evaluated and is not production-usable — deliberately out of scope. (`src/services/meteoalarm.ts`, `src/services/geomet.ts`, `src/services/nominatim.ts`, `src/types/meteoalarm.ts`, `src/types/geomet.ts`, `src/handlers/alertsHandler.ts`, `src/handlers/weatherSummaryHandler.ts`, `src/utils/locationResolver.ts`, `src/config/cache.ts`, `src/index.ts`)
- **`examples/` folder — real prompts, real output** - Eight conversation-first scenario files (Tokyo trip planning, Oklahoma City severe weather, Sydney boating, Paris METAR + pollen, Memphis/Manaus rivers, Denver wildfire, Berlin 1945 + Chicago normals, Lake Tahoe saved locations) showing a user prompt, the answer Claude Code gave, and the verbatim server output behind it in collapsible blocks. All 17 tools are covered (matrix in `examples/README.md`). Raw-output blocks are captured over the real MCP protocol from `dist/index.js` and regenerate in place with `npm run examples` (`scripts/capture-examples.mjs`, same client pattern as the stress harness; the saved-locations scenario runs against a scratch `HOME` so it never touches a real `~/.weather-mcp/`). Linked from the README's prompt list and Documentation section.

## [1.18.0] - 2026-08-13

### Added
- **Pollen levels on `get_air_quality` (European locations)** - Current pollen for six species (alder, birch, grass, mugwort, olive, ragweed) in grains/m³, rendered automatically when the data exists. The values come from the CAMS European model on the same Open-Meteo air-quality endpoint the tool already calls, so there is no new provider, key, or tool — the marginal cost is six extra current-block request variables (the hourly forecast fetch stays trimmed to the three variables it reads, per v1.13). Coverage is Europe-only: non-European points return HTTP 200 with every species null (verified live — real values in Berlin/London, all-null in Michigan/Tokyo), so the section renders only when at least one species carries a real value and non-European output is byte-identical to before. In-season zeros ("none detected") do render. Unblocks the long-parked FE §6.1 idea, whose "no free API" blocker went stale. (`src/services/openmeteo.ts`, `src/handlers/airQualityHandler.ts`, `src/index.ts`)
- **Worldwide station observations via `source: "metar"` on `get_current_conditions`** - Outside the US this tool had never returned an observation: it returned a model, and the footer said so. NOAA's Aviation Weather Center publishes decoded METARs worldwide as keyless JSON, so `source: "metar"` now returns real instrument readings from real airport stations on every continent — verified live against KBFI (Seattle), EGLC (London), HKNW (Nairobi), YSSY (Sydney), BIRK (Reykjavik), and KGDW (Michigan). Works in the US too, as a second opinion with flight category and the raw METAR. Because a METAR is a measurement *at an airport* while Open-Meteo is an estimate *at the caller's exact coordinates*, the two answer different questions and there is deliberately no auto-routing: **`auto` is byte-for-byte unchanged** (verified by diffing built-dist output against `main` for a US and a non-US point), and the METAR branch is reachable only on explicit request. Station identity, distance, 16-point bearing, elevation, and observation age are always shown, since they are what make the reading interpretable; caveat lines appear for a far station (100–250 km), a stale observation (90 min – 6 h), and off-cycle `SPECI` reports. Absent fields are omitted rather than blanked — wind gusts appear in 14% of reports and present-weather in 8% — and `visib: "10+"` keeps its qualifier instead of being flattened to a bare 10. No station within 250 km yields a friendly message, not an error and not a silent fallback. `include_normals` is supported; `include_fire_weather` renders a one-line note, since Haines and transport wind need NOAA gridpoint data a METAR does not carry. Keyless, no signup, 10-minute cache. (`src/services/aviationWeather.ts`, `src/types/aviationWeather.ts`, `src/utils/metarStation.ts`, `src/handlers/currentConditionsHandler.ts`, `src/index.ts`)
- **`include_astronomy` parameter on `get_forecast`** - Opt-in almanac block for daily forecasts: each day gains a `**Moon:**` line (phase name, illumination %, moonrise/moonset) and a `**Twilight:**` line (civil/nautical/astronomical dawn and dusk), plus one `**Next full moon:** … · **Next new moon:** …` line per response. Computed locally with the new `astronomy-engine` dependency (MIT, zero transitive deps, ±1 arcminute, validated against USNO times) — no API calls, no cache, no attribution required. Works on both the NOAA path (one block per calendar date, correct even for "Tonight"-first responses) and the Open-Meteo path (after the Sunset line); polar cases render explicit wording ("none (polar day)" / "none (polar night)") instead of dropping fields; all times honor the forecast's IANA timezone and the 12h/24h preference. Hourly granularity ignores the flag, matching `include_normals`. (`src/utils/astronomy.ts`, `src/handlers/forecastHandler.ts`, `src/index.ts`)
- **US record high/low on the `include_normals` path** - For US locations, `get_forecast` (first forecast day) and `get_current_conditions` now append a records line after the climate normals — `**Records for Aug 12:** High 96°F (1977) · Low 49°F (1953) — records since 1945` — sourced from the keyless RCC ACIS API (nearest long-record station, preferring threaded/stitched records; full 366-day table fetched in one call and cached 7 days, station selection 30 days). Records are garnish, never load-bearing: any ACIS failure logs a warning and omits the line, independent of whether the normals fetch itself succeeded. Non-US locations are unchanged (no records line, no ACIS request), matching normals' own US-only NCEI sourcing. Attribution: "Records: NOAA Regional Climate Centers (ACIS)". (`src/services/acis.ts`, `src/types/acis.ts`, `src/utils/records.ts`, `src/handlers/forecastHandler.ts`, `src/handlers/currentConditionsHandler.ts`, `src/index.ts`)
- **Global `get_river_conditions`** - The tool was US-only: it queried NOAA's NWPS gauge network unconditionally, so any non-US location returned nothing useful. It now auto-selects by location, matching the `get_current_conditions` pattern — US coordinates keep the NWPS gauge path exactly as-is (stage, flow, official flood categories, crest history, forecast series), and everywhere else returns Open-Meteo Flood API (GloFAS v4) modeled river discharge. New `source` parameter (`auto`/`noaa`/`openmeteo`) forces a branch; there is deliberately no cross-fallback, since gauge observations and model discharge are different claims. (`src/handlers/riverConditionsHandler.ts`, `src/services/openmeteo.ts`, `src/index.ts`)
- **Channel snapping for model discharge** - GloFAS discharge is modeled per ~0.05° grid cell, and a cell that misses the river channel reports local runoff instead of the river — live probe: Memphis 35.125,-90.075 reads 0.63 m³/s while the cell one step west reads 11,640 m³/s. Each request now probes a 3×3 neighborhood in a single multi-coordinate call and selects the cell with the highest mean discharge over the past 31 days, disclosing the move ("Nearest modeled river channel: ~5 km W of requested point") whenever the winner is not the requested point. Cells with no modeled channel at all return a friendly "no river data" result rather than an error, and a winner under 0.1 m³/s is labeled minor local drainage rather than presented as a river. (`src/utils/riverDischarge.ts`)
- **Discharge presented against its own history and ensemble** - GloFAS publishes no flood-stage thresholds, so model output is framed relative to what it can support: current discharge with a rise/fall trend (relative ±10%), a ratio against the past-31-day mean, and a daily ensemble forecast showing the median inside its p25–p75 band. `detail="full"` adds the min/max envelope and the full requested range; `forecast_days` accepts 1–210 (default 7). Model output carries an explicit "not gauge observations" caveat and the CC-BY attribution required by Open-Meteo. (`src/utils/units.ts`, `src/config/cache.ts`)

### Fixed
- **`save_location` smart updates silently dropped metadata** - Updating an existing alias (e.g. an activities-only update) discarded its saved `description`, `alternateNames`, and `notes`: the handler wrote the raw request values — `undefined` whenever omitted — on both the partial-update and full re-save paths. All three fields now follow the same preserve-when-omitted contract as `activities`: an omitted field keeps its stored value, an explicit `""`/`[]` clears it, and cleared values are never persisted as empty strings/arrays. The live re-test then caught the same drop for `activities` itself on a full re-save with coordinates (its preserve logic only covered the partial-update path), so all four optional fields now share one merge contract on any update to an existing alias. The confirmation output reflects the effective post-merge values, and the tool description states the contract. Found in the 2026-08-13 full-suite live test. (`src/handlers/savedLocationsHandler.ts`, `src/index.ts`)
- **Stale NOAA observations were served as "current" with no age indication** - The NOAA path of `get_current_conditions` returned whatever the first responding station's latest observation was, however old — the live test caught a station dark for 2 days (KMOP) whose Aug 11 reading was presented as current weather. The handler now shows the observation's age beside its timestamp (like the METAR path), retries up to 2 further gridpoint stations when the nearest one's observation is older than 6 hours (noting the substitution: *"Nearest station (KMOP) has not reported since …; showing … instead."*), and appends a stale-observation warning when even the best available reading is over 2 hours old — falling back to the nearest station's data rather than erroring when nothing fresh exists. Thresholds live in `DisplayThresholds.currentConditions`; the fix flows into `get_weather_summary`'s current section automatically. (`src/handlers/currentConditionsHandler.ts`, `src/config/displayThresholds.ts`, `src/utils/timezone.ts`)
- **NOAA recent-date historical responses could truncate silently** - When the reporting station stops mid-window, observations simply end early with nothing saying so. The NOAA recent path now appends *"Observations end \<time\>; the reporting station may have gone offline."* when the newest returned observation precedes the effective end of the requested range by more than the stale threshold. Data is unchanged. (`src/handlers/historicalWeatherHandler.ts`)
- **Fully contained fires drove alarmist wildfire safety assessments** - The escalation tier was chosen by distance alone, so a fire 2.5 km from the live-test point that had been 100% contained for weeks still produced "⚠️ EXTREME DANGER — Evacuate immediately if advised by authorities." The tier now comes from the nearest wildfire with containment below 100%; excluded fires are disclosed (*"Nearest fire (…) is 100% contained and excluded from the danger assessment."*), an all-contained radius renders an AWARENESS-level assessment with a note instead of a danger tier, and the fire list itself is unchanged. (`src/handlers/wildfireHandler.ts`)
- **NOAA marine reports didn't say which water body they describe** - `get_marine_conditions` for a point ~60 miles inland returned a calm "Lake Huron" report with nothing indicating the data describes a distant water body. The NOAA marine path now always opens with *"Conditions describe \<region\> — the nearest covered water body, which may be distant from the requested point."* The Open-Meteo path, which reports for the exact coordinates, is unchanged. (`src/handlers/marineConditionsHandler.ts`)

### Changed
- **`get_historical_weather` documents its UTC date interpretation** - Date bounds are UTC midnights, so a US-eastern request for `2026-08-10 → 2026-08-12` includes observations from the evening of Aug 9 local time. Behavior is unchanged and intentional; the tool description now says so. (`src/index.ts`)

## [1.14.0] - 2026-08-12

### Added
- **Configurable default location (`WEATHER_DEFAULT_LOCATION`)** - Optional server-wide fallback used when a location-based tool is called with no location at all, so clients whose users have a known home location can ask "what's the weather?" without passing coordinates every time. Accepts a saved location alias (including alternate names), a `"lat,lon"` coordinate pair, or a free-text place name (geocoded through the existing city-name cache, so it resolves at most once per process). An explicit `latitude`/`longitude`, `location_name`, or `city_name` in the call always takes precedence. Responses that used the fallback disclose it with a `**Location:** … — server default` header, and when a default is configured the tool schemas tell the model it may omit location parameters. Requested in [#46](https://github.com/weather-mcp/weather-mcp/issues/46). (`src/config/defaultLocation.ts`, `src/utils/locationResolver.ts`, `src/index.ts`)
- **CI workflow** - GitHub Actions now builds and runs the unit test suite on every push to `main` and every pull request, so PRs (including Dependabot's) get real check runs. Integration tests stay out of CI — they hit live weather APIs and are too flaky for every push. Idea adapted from the `quinnmacro/weather-mcp` fork. (`.github/workflows/ci.yml`)

### Fixed
- **Coarse US timezone fallback mis-bucketed Eastern/Central cities** - The longitude bands `guessTimezoneFromCoords` falls back to when `tz-lookup` fails split the continent evenly, putting Atlanta and Pittsburgh in Central time and Kansas City through Dallas in Mountain time. Bands retuned (`-85/-101/-115`) against known city coordinates, with a dedicated fallback test suite (tz-lookup mocked to fail). No effect on normal operation, where `tz-lookup` resolves coordinates accurately. Adapted from the `dapcook/weather-mcp` fork. (`src/utils/timezone.ts`, `tests/unit/timezone-fallback.test.ts`)

## [1.13.0] - 2026-07-17

### Added
- **`forecast_days` parameter on `get_air_quality`** - Request 1-7 days of AQI forecast (default: 5; 7 days / 168 hours is the Open-Meteo air quality model's maximum). Previously the service always fetched 5 days but the output silently showed only the first 24 hours. (`src/handlers/airQualityHandler.ts`, `src/index.ts`)
- **`forecast_days` parameter on `get_marine_conditions`** - Request 1-16 days of daily marine forecast (default: 5; 16 is the Marine API's accepted maximum, verified live 2026-07-16). The marine model typically provides ~10 days of real data — trailing days it null-pads are trimmed from the output with a note saying how many requested days had no data. Previously the handler hardcoded a 5-day fetch with no override. (`src/handlers/marineConditionsHandler.ts`, `src/services/openmeteo.ts`, `src/index.ts`)
- **`detail="full"` lists every radar animation frame on `get_weather_imagery`** - Animated radar previously always showed first/middle/last of ~13 frames with no escape hatch. `detail="full"` now renders all frames (in addition to its existing embed-images behavior), and the brevity note at lower detail levels points at it — the same disclosure contract as `get_forecast`'s hourly cap. (`src/handlers/weatherImageryHandler.ts`)
- **Forecast (nowcast) radar frames appended defensively** - When RainViewer's `radar.nowcast` feed carries frames, animated radar now appends them after the observed frames, labeled with their minute offset (e.g. "+10 min forecast"). The feed was empty on all live checks (2026-07-16), so output is unchanged until it returns — missing/empty nowcast is handled as the normal case. (`src/services/rainviewer.ts`, `src/types/imagery.ts`)
- **`detail` parameter on `get_river_conditions`, `get_wildfire_info`, and `get_lightning_activity`** - `detail="full"` lifts the display caps to a uniform 25 (river gauges 5→25, historic crests 3→25, fires 5→25, listed strikes 10→25) — capped, not unbounded: ~1,500-1,900 NWPS gauges sit within 500 km of Chicago, and listing them all would exceed client token limits several times over. The remainder note stays accurate at every level (including `full` when more than 25 exist), and lower detail levels now name the escape hatch (`use detail="full" for more`). Lightning statistics always aggregated every strike and are unchanged at all levels. (`src/handlers/riverConditionsHandler.ts`, `src/handlers/wildfireHandler.ts`, `src/handlers/lightningHandler.ts`, `src/index.ts`)
- **Per-day peak UV in the air quality forecast** - Each forecast day header now carries the day's peak UV index with the same level mapping the current-conditions UV block uses (e.g. `### Friday, Jul 17 — peak US AQI 63 (Moderate) · UV 10 (Very High)`). Days whose UV data is all-null omit the UV clause entirely rather than coercing to "UV 0 (Low)". (`src/handlers/airQualityHandler.ts`)
- **Observed rise/fall trend on every shown river gauge** - Each gauge now fetches its NWPS stageflow series and renders an inline trend on the stage line — direction, magnitude, and window (e.g. `9.16 ft  ↗ rising (+8.9 ft / 6h)`), derived from the latest real reading vs. the earliest real reading in a 6-hour lookback. Every point passes the existing -999/year-0001 sentinel guards. Stageflow fetches run nearest-first in small batches with a 30-minute cache and stop cleanly on an NWPS rate-limit rejection; a gauge whose series can't be fetched simply shows no trend. (`src/handlers/riverConditionsHandler.ts`, `src/services/noaa.ts` types)
- **Multi-point river forecast series at `detail="full"`** - Gauges whose NWPS stageflow response carries a forecast series (mostly tidal and major-river gauges — roughly 1 in 5) render it as a per-point list with local time, stage, and flood category derived from the gauge's own thresholds. Reuses the series already fetched for the trend — no extra API calls. Gauges without a usable series render nothing, not an empty section. (`src/handlers/riverConditionsHandler.ts`)
- **Wildfire results now disclose upstream truncation** - When NIFC's ArcGIS layer reports `exceededTransferLimit`, the report says *"Results may be incomplete — the fire data service truncated the response."* at every detail level — including the zero-fires branch, where truncation could hide fires entirely. Previously the flag was only logged. (`src/handlers/wildfireHandler.ts`)

### Fixed
- **Null AQI hours rendered as "AQI 0 (Good)"** - Past the air quality model's real horizon, Open-Meteo pads the hourly arrays with `null`s, which coerced to `0` in the range math and displayed as Good air quality — dangerously misleading for the exact days users would check before an event. Non-finite values are now treated as missing: trailing no-data hours are trimmed (with a note about how many requested hours the model couldn't provide), interior nulls are excluded from period ranges, and an all-null response yields a clear "no forecast data" message. (`src/handlers/airQualityHandler.ts`)
- **Marine forecast days past the model horizon would render as "0 m (Calm)"** - The same null-padding class of bug as the AQI fix, pre-empted before it could ship: with the forecast range now extendable to 16 days, null-padded days would have coerced to calm seas. Every per-day field is guarded with finite-number checks, interior no-data days render a placeholder instead of zeros, and an all-null forecast yields a clear "no forecast data" message. (`src/handlers/marineConditionsHandler.ts`)
- **`get_river_conditions` credited USGS Water Services, which it never calls** - The report footer, `docs/TOOLS.md`, and the README all listed USGS Water Services as a source of real-time streamflow data. Every river value the tool displays comes from NOAA NWPS; the USGS client methods (`getUSGSStreamflow`, `getUSGSStreamflowForSite`) have never been called by any handler. The footer now credits NWPS alone. Gauge IDs still show the USGS site number when NWPS reports one — that is an identifier NWPS supplies, not a USGS API call. (`src/handlers/riverConditionsHandler.ts`, `docs/TOOLS.md`, `README.md`)
- **River gauge rendered the NWPS "observation not current" placeholder literally** - The v1.11.1 sentinel fix guarded the forecast block but not the observed one: a gauge whose observation is stale (year-0001 validTime, sentinel values, `obs_not_current` category) rendered `Observed: Dec 31, 1, 7:03 PM` with an `OBS NOT CURRENT` category. Found live on SCTM3 (Massachusetts Bay at Scituate) once `detail="full"` widened the view to 25 gauges. Such a status now renders as "No current observations available", the same as an absent one. (`src/handlers/riverConditionsHandler.ts`)

### Changed
- **Historical hourly `limit` ceiling raised 500 → 744** - A 31-day range in hourly mode fetches 744 observations, but the display cap stopped at 500, silently dropping the tail of any hourly range past ~20.8 days. The ceiling now matches the largest hourly window (31 days × 24 h); the default stays 168. The schema also now documents that `limit` applies to hourly output only — daily-granularity output (ranges over 31 days) always shows the full range, and NOAA's own 1-500 recent-observations clamp is unchanged. (`src/config/displayThresholds.ts`, `src/index.ts`)
- **Marine tool no longer fetches 13 unused hourly variables** - `get_marine_conditions` requested a full hourly block on every forecast call, then displayed none of it (only a "N hours available" line, now removed). The request carries `current` and `daily` aggregates only — daily is the right granularity for this tool, and the response is much smaller. (`src/services/openmeteo.ts`)
- **Air quality forecast now shows the full fetched range, grouped by day** - The forecast section previously printed a single undated "Next 24 hours" block whose 6-hour buckets included hours already past and gave no hint which calendar day an evening spike belonged to. It now renders every fetched day under a dated header (e.g. `### Thursday, Jul 17 — peak US AQI 133 (Unhealthy for Sensitive Groups)`) with 6-hour period ranges inside each day, skips hours before the current observation time, and labels each period with the category of its **peak** AQI (previously the midpoint of min/max, which understated health risk in rising-pollution periods). Dates and hours are read from Open-Meteo's location-local timestamps directly, so output no longer shifts with the server's timezone. (`src/handlers/airQualityHandler.ts`)
- **Air quality forecast fetch trimmed from 24 hourly variables to 3** - The hourly forecast request carried every pollutant concentration and per-pollutant AQI sub-index, none of which the forecast display has ever read at any detail level. It now requests only `us_aqi`, `european_aqi`, and `uv_index`. Current-conditions variables are untouched — pollutant concentrations still display for the current hour. (`src/services/openmeteo.ts`)

## [1.12.0] - 2026-07-16

### Added
- **Auto-fallback from NOAA to Open-Meteo for border-adjacent locations** - The US routing boxes overrun the border (Toronto, Vancouver, and Windsor all sit inside them), so `get_current_conditions` and `get_forecast` with `source: "auto"` previously returned a hard NOAA error for those cities. When NOAA rejects an auto-routed point (its non-retryable coverage/4xx failures), both tools now fall back to Open-Meteo model data and note the switch under the heading. Transient NOAA outages still propagate as errors, and an explicit `source: "noaa"` keeps its strict error contract. (`src/handlers/currentConditionsHandler.ts`, `src/handlers/forecastHandler.ts`)
- **Global `get_current_conditions`** - The tool is no longer US-only. It now uses the same auto-select routing as `get_forecast`: US coordinates keep returning NOAA station observations (unchanged output), and international coordinates return Open-Meteo current weather — temperature, feels-like, today's range, dewpoint, humidity, wind with gusts, pressure, cloud cover, and recent precipitation. This also fixes the `current` section of `get_weather_summary`, which previously failed outside the US. (`src/handlers/currentConditionsHandler.ts`, `src/services/openmeteo.ts`)
- **`source` parameter on `get_current_conditions`** - `"auto"` (default, NOAA in the US and Open-Meteo elsewhere), `"noaa"` (US only), or `"openmeteo"` (works anywhere, including the US — useful for comparison). Same contract as `get_forecast`'s `source`. (`src/index.ts`)
- **`OpenMeteoService.getCurrentConditions()`** - New service method with a 15-minute cache TTL keyed by unit signature, so imperial and metric responses never share an entry. (`src/services/openmeteo.ts`)
- **Exported `isInUS()` geography helper** - Extracted from `forecastHandler` into `src/utils/geography.ts` with the same bounding boxes (CONUS, Alaska, Hawaii, Puerto Rico) so both tools route identically. (`src/utils/geography.ts`)

### Fixed
- **Recent-date historical weather hard-failed for international locations** - `get_historical_weather` routed any request starting within the last 7 days to NOAA regardless of location, so "yesterday's weather" for Paris, Tokyo, or Toronto returned a raw NOAA coverage error. Recent dates now route to NOAA only for US coordinates (via the shared `isInUS` helper); everywhere else uses the Open-Meteo archive, which serves data through yesterday. US-box border points NOAA rejects fall back to Open-Meteo with the same note and error contract as `get_current_conditions`/`get_forecast` — transient NOAA outages still propagate. (`src/handlers/historicalWeatherHandler.ts`)
- **Historical output mislabeled southern latitudes** - The Open-Meteo location line hardcoded `°N`, printing e.g. `-32.8647°N` for the Chilean Andes. Coordinates now render with proper hemisphere labels (`32.8647°S, 70.1714°W`). (`src/handlers/historicalWeatherHandler.ts`)
- **Metric snowfall was understated 10×** - Open-Meteo reports `snowfall` in **cm** unless `precipitation_unit=inch` is requested (its own `current_units` metadata says so), but the output labelled the raw value with the caller's precipitation unit — a real 1.4 mm snowfall rendered as "0.1 mm". Snowfall is now converted to mm for metric output in current conditions and in historical weather (hourly `snowfall` and daily `snowfall_sum`); imperial output was already correct. (`src/utils/unitFormat.ts`, `src/handlers/currentConditionsHandler.ts`, `src/handlers/historicalWeatherHandler.ts`)
- **Trace precipitation rendered an all-zero section** - Drizzle below display precision (e.g. 0.004 in) triggered a `## Recent Precipitation` section reading "0.00 in". The section and its breakout lines are now gated on a per-unit trace floor (0.005 in / 0.05 mm). (`src/config/displayThresholds.ts`)
- **International weather summaries leaked a raw NOAA error for alerts** - Every non-US `get_weather_summary` ended with `⚠️ Could not retrieve alerts data … Parameter "point" is invalid: out of bounds`. Non-US locations now get a clean "Weather alerts are currently available for US locations only." note, without the doomed NOAA round-trip. (`src/handlers/weatherSummaryHandler.ts`)

### Notes
- International current conditions are **model-interpolated values, not station observations**, and are labelled as such in the output footer. Visibility and snow depth are not included on the international path (hourly-only variables in Open-Meteo).
- Fire weather indices (`include_fire_weather`) remain US-only; international requests emit a short note instead of making a NOAA call.
- `get_alerts`, `get_river_conditions`, and `get_wildfire_info` are still US-only.

## [1.11.1] - 2026-07-13

### Added
- **Startup pre-warming of lightning monitoring for saved locations** - Blitzortung strikes are only buffered for an area once it has been subscribed, so the first `get_lightning_activity` query for a location previously reported ~zero monitoring coverage. The server now subscribes each saved location's geohashes at startup (best-effort and non-blocking) so their coverage accumulates before the first query. Disable with `WEATHER_LIGHTNING_PREWARM=false` (also skipped automatically when the lightning tool is not enabled). The limited-coverage notice now explains *why* coverage can be low on a first lookup and that historical strikes cannot be backfilled.

### Fixed
- **`city_name` and low-limit `search_location` geocoding failed for valid US places** - The geocoding client serialized query spaces as `+` instead of RFC 3986 `%20`, and Nominatim returns zero matches for such `+`-encoded queries when only one result is requested. Because the on-demand `city_name` resolver requests a single result, every `city_name` lookup (e.g. `city_name="Clare, MI"`) — and any `search_location(..., limit=1)` — failed with "No locations found" even though the place exists. Query parameters are now percent-encoded (`%20`), and the geocoding service requests a small result floor internally before slicing to the caller's limit, so single-result lookups are no longer at the fragile boundary. (`src/services/geocoding.ts`)
- **River forecast rendered NWPS placeholder sentinels literally** - `get_river_conditions` printed `-999.00 ft` / `-999.00 kcfs` and a year-0001 "Dec 31, 1" valid time for gauges whose forecast is not current. Missing-data sentinels (values `<= -900`) and implausible timestamps (year `< 2000`) are now detected: the `### Forecast` block is shown only when it carries at least one real value and a plausible time, and is otherwise suppressed. The same guard is applied to observed stage/flow. (`src/handlers/riverConditionsHandler.ts`)

## [1.11.0] - 2026-07-13

### Added
- **Universal location resolution across all weather tools** - Every location-based tool (`get_current_conditions`, `get_alerts`, `get_historical_weather`, `get_air_quality`, `get_marine_conditions`, `get_weather_imagery`, `get_lightning_activity`, `get_river_conditions`, `get_wildfire_info`) now accepts the same three location forms that `get_forecast` did: `latitude`+`longitude`, a saved `location_name`, or a free-text `city_name` (geocoded on demand). A shared `LOCATION_SCHEMA_PROPERTIES` fragment keeps the tool schemas consistent, and name-based lookups echo the resolved place and coordinates in a `**Location:**` header. This resolves the previous mismatch where saved-location guidance advertised calls the tool schemas rejected.
- **`get_weather_summary` composite tool** - Answers broad "what's the weather like?" questions in a single call by aggregating current conditions, forecast, and alerts (optionally air quality and lightning) for one location. Accepts an `include` array, `detail`, and `days`. Location is resolved once and passed to each section so there is no repeated geocoding; a section that is unavailable (e.g. US-only alerts abroad) is noted rather than failing the whole summary.
- **`detail` output control** - `get_forecast`, `get_alerts`, and `get_weather_imagery` accept `detail: "summary" | "standard" | "full"` (default `standard`) to trade completeness for token cost. Hourly forecasts are capped (24h summary / 48h standard) unless `full`; alerts include the full NWS description only at `full`; imagery returns direct URLs by default and embeds Markdown images only at `full`.

### Changed
- **Preset tiers reworked around a "summary-first" default.** The default `basic` preset (used when `ENABLED_TOOLS` is unset — what most users get) is now 6 tools led by `get_weather_summary`: `get_weather_summary`, `get_forecast`, `get_current_conditions`, `get_alerts`, `search_location`, `check_service_status`. `standard` adds history, air quality, and the four saved-location management tools (12 total). `full` adds the specialized environmental/safety tools (marine, imagery, lightning, river, wildfire) and is now the complete 17-tool set, identical to `all`. Because every tool accepts `city_name`/`location_name`, the default set answers most weather questions on its own.
- The NOAA forecast path fetches point data once and reuses `gridId`/`gridX`/`gridY` for the forecast and gridpoint calls, avoiding duplicate upstream point lookups on a cold cache.

### Fixed
- `search_location` now escapes provider-returned strings (`name`, `display_name`) before embedding them in Markdown, matching the existing escaping of the user query.

## [1.10.0] - 2026-07-13

### Added
- **Unit localization for weather output** - Temperature, wind speed, precipitation, pressure, and distance/visibility/elevation can now be rendered in imperial or metric units. Set a server-wide default with the `WEATHER_UNITS` environment variable (`imperial` | `metric`, default `imperial`), or override per request with a `units` parameter on `get_forecast`, `get_current_conditions`, and `get_historical_weather`. This closes the gap that previously forced forks to hardcode Celsius in source.
- **Per-unit overrides** - Pin individual units independently of the system, via env (`WEATHER_TEMPERATURE_UNIT`, `WEATHER_WIND_SPEED_UNIT`, `WEATHER_PRECIPITATION_UNIT`, `WEATHER_PRESSURE_UNIT`, `WEATHER_DISTANCE_UNIT`) or per-call params (`temperature_unit`, `wind_speed_unit`, `pressure_unit`, etc.). Wind supports `mph`, `kmh`, `ms`, and `kn` (knots); pressure supports `inHg` and `hPa`.
- **12h / 24h clock format** - Times (forecast headers, sunrise/sunset, observation times) honor a `WEATHER_TIME_FORMAT` env default or per-call `time_format` parameter.

### Changed
- The Open-Meteo request now asks upstream for the requested units directly (no double conversion), and the NOAA forecast path uses the NWS `units=us|si` parameter. Unit-system signatures are included in cache keys so imperial and metric responses stay distinct.
- Climate-normals output (`formatNormals`) is now unit-aware and matches the requested system.
- Minor: the climate-normals "Normal Precipitation" line now uses the `in` label (was `"`), matching the rest of the forecast output.

### Notes
- Default output is unchanged (imperial), so existing users see no difference unless they opt in.
- Domain-specialized readings keep their conventional units: fire-weather mixing height/transport wind, river gauge stage, and the marine tool's dual metric/imperial wave output are unaffected by this setting.

## [1.9.0] - 2026-07-13

### Added
- **`city_name` parameter for `get_forecast`** - Request a forecast by free-text place name (e.g. `city_name="Paris, France"` or `city_name="Bend, Oregon"`) without first saving the location or looking up coordinates. The name is geocoded on demand via the existing multi-provider geocoding service (Census/Nominatim/Open-Meteo), and the resolved place is disclosed in the output as a `**Location:**` header so an ambiguous match is transparent. Coordinates and saved `location_name` still take precedence when provided. (Inspired by the community `jablum` fork.)
- **Geocode caching** - City-name lookups are cached with an infinite TTL (a place's coordinates are static), so repeated forecasts for the same city do not re-hit the geocoding providers.

## [1.8.3] - 2026-07-13

### Fixed
- **`get_historical_weather` header date shift** - The `**Period:**` line built a `Date` from the requested `start_date`/`end_date` and rendered it with `toLocaleDateString()`, which shifted the displayed range one day earlier in server timezones behind UTC (e.g. a `2024-01-10 → 2024-01-11` request showed `1/9/2024 to 1/10/2024`). Now displays the requested ISO dates directly. Observation data was always correct; only the header was wrong.
- **`get_historical_weather` observation count** - The hourly header reported the total number of observations fetched rather than the number actually shown (e.g. `Number of observations: 48` when `limit: 3` returned 3 rows). Now shows the displayed count with the available total for context (`3 (of 48 available)`).

## [1.8.2] - 2026-07-07

Documentation and packaging release — no functional changes to the server or tools.

### Changed
- **README overhaul** - Restructured for prospective users: install one-liner and value proposition up front, honest "Why this server?" positioning, compact 16-tool table, and data source credits. The full tool reference moved to the new [docs/TOOLS.md](./docs/TOOLS.md)
- **Package metadata** - npm and MCP registry descriptions/keywords now reflect all 16 tools and the no-API-key design; added a social preview image for GitHub link sharing
- **Publishing pipeline** - npm publishing now runs automatically on version tags via GitHub Actions with Trusted Publishing (OIDC); release prep script keeps versions, changelog, test counts, and tool counts in sync across all docs

### Fixed
- **Stale imagery docs** - Tool reference incorrectly said satellite imagery was "not yet implemented"; it has been available since v1.8.0 (GOES GeoColor via NASA GIBS, Western Hemisphere)

## [1.8.1] - 2026-07-06

### Changed
- **Dependencies** - Integrated Dependabot updates (PRs #33–#34)
  - `mqtt` 5.15.1 → 5.15.2 (fixes: don't overwrite explicit TLS SNI servername; support relative WebSocket URLs)
  - `@types/node` 26.0.0 → 26.1.0 (dev)
  - `@vitest/coverage-v8` / `vitest` 4.1.9 → 4.1.10 (dev)
  - `tsx` 4.22.4 → 4.23.0 (dev)

### Fixed
- **MCP Registry sync** - `server.json` version had fallen behind (stuck at 1.6.1 while npm was at 1.8.0); now synced with `package.json` as part of the release process

## [1.8.0] - 2026-06-22

### Added
- **Satellite imagery** - `get_weather_imagery type="satellite"` is now implemented (was a "not yet implemented" stub) using NOAA GOES-East/West ABI GeoColor via NASA GIBS (Western Hemisphere coverage, day+night). Returns the latest snapshot.
- **Accurate global timezones** - `guessTimezoneFromCoords` now uses `tz-lookup` for precise coordinate→IANA resolution worldwide (including no-DST zones like Arizona and sub-regional US zones), replacing the US-only longitude heuristic. Improves time formatting for international users.
- **NCEI Climate Normals** - Implemented official NOAA 1991–2020 climate normals retrieval for US locations (previously a placeholder that always fell back to Open-Meteo)
  - Finds the nearest NCEI station with daily normals via a bounding-box `/stations` query (sorted by distance, expands once if empty)
  - Reads daily high/low temperature normals (`DLY-TMAX-NORMAL`/`DLY-TMIN-NORMAL`, °F) and monthly precipitation (`MLY-PRCP-NORMAL`) averaged to a daily value
  - Handles Feb 29 (reference year is non-leap), missing-value sentinels, rate limits, and auth errors; caches results indefinitely
  - Requires a free `NCEI_API_TOKEN`; gracefully falls back to Open-Meteo when unavailable or outside US coverage
  - Used by `get_forecast` and `get_current_conditions` for US climate context

### Changed
- **`get_weather_imagery`** - Removed the unused `layers` parameter (it was validated but had no effect; RainViewer no longer supports overlay layers).

### Removed
- Reliance on RainViewer for satellite imagery (RainViewer discontinued satellite IR and most color schemes in Jan 2026; documented in `docs/development/DATA_SOURCE_BLOCKERS.md`).

## [1.7.1] - 2026-06-21

### Fixed
- **River Conditions (NWPS API)** - Repaired the river gauge integration after upstream NWPS API changes broke `get_river_conditions`
  - The NWPS `/gauges` endpoint stopped honoring the `west/south/east/north` bounding-box parameters, so every query silently downloaded the entire ~13MB gauge catalog (~12,700 gauges), causing request timeouts and retries
  - Now queries with `bbox.{xmin,ymin,xmax,ymax}` plus the required `srid=EPSG_4326`; river gauge lookups return in under a second again
  - Updated response parsing to unwrap the `{ "gauges": [...] }` envelope (previously expected a bare array)
  - Updated the `NWPSGauge` type for the current schema: `state`/`wfo`/`rfc` are now `{ abbreviation, name }` objects, and `flood`/`inService`/`county`/`timeZone`/`usgsId` are optional (only returned by the per-gauge detail endpoint)
  - Handle underscore-delimited flood categories (`no_flooding`, `not_defined`) in display output

### Changed
- **Dependencies** - Integrated Dependabot updates (PRs #18–#22)
  - `@modelcontextprotocol/sdk` 1.21.x → 1.29.0
  - `axios` 1.13.x → 1.18.0
  - `dotenv` 17.2.x → 17.4.2
  - `mqtt` 5.15.0 → 5.15.1
  - `typescript` 5.9.3 → 6.0.3 (dev)
  - `@types/node` 24.10.0 → 25.9.3 (dev)
  - Development dependency group updates (Babel, esbuild)

## [1.7.0] - 2025-11-16

### Added
- **Saved Locations** - Save frequently used locations with simple aliases (e.g., "home", "work", "cabin") and reference them by name instead of coordinates
  - `save_location` - Save a location with an alias, optional activities, and geocoding by name
  - `list_saved_locations` - View all saved locations
  - `get_saved_location` - Get details for a saved location
  - `remove_saved_location` - Delete a saved location
  - Optional per-location `activities` (e.g., boating, fishing, hiking) for contextually relevant weather
  - Smart updates: change a saved location's name/activities without re-specifying coordinates
  - Locations persist to `~/.weather-mcp/locations.json`
- **Location names in tools** - `get_forecast` accepts a `location_name` parameter to use a saved location instead of latitude/longitude

### Changed
- **Geocoding** - Switched location search to Nominatim/OpenStreetMap for better small-town coverage

## [1.6.1] - 2025-11-10

### Fixed

#### Security Fixes
- **Blitzortung MQTT Security** - Added TLS warnings and security guidance for lightning feed
  - Added runtime warning when using plaintext MQTT connections
  - Enhanced documentation about security implications
  - Recommended mitigations for production deployments (TLS proxy, trusted networks)
  - Environment variable `BLITZORTUNG_MQTT_URL` for TLS-enabled brokers
- **Coordinate Privacy** - Implemented coordinate redaction in logging to protect user privacy
  - Added `redactCoordinatesForLogging()` utility that rounds coordinates to ~1.1km precision (2 decimal places)
  - Updated all handlers to use redacted coordinates in logs (lightning, marine, imagery)
  - Environment variable `LOG_PII=true` to enable full precision logging (not recommended for production)
  - Complies with GDPR/CPRA data minimization requirements
- **Markdown Injection Prevention** - Fixed vulnerability in location search results
  - Added `escapeMarkdown()` function to sanitize user input
  - Prevents injection of malicious Markdown (links, images, scripts)
  - Normalizes whitespace to prevent structure injection

#### Performance & Reliability Fixes
- **River Conditions Performance** - Implemented bounding box queries to avoid downloading entire gauge catalog
  - Added `getNWPSGaugesInBoundingBox()` method with server-side filtering
  - Calculates efficient bounding box based on search radius and latitude
  - Falls back to client-side filtering if API doesn't support bbox queries
  - Reduces bandwidth and latency by orders of magnitude for location-specific queries
- **Cached Data Mutation** - Fixed forecast handler mutating cached NOAA data
  - Changed `getMaxProbabilityFromSeries()` to work on local copies
  - Prevents severe weather calculations from affecting other formatters using same cached object
  - Eliminates intermittent "missing probability" bugs
- **Blitzortung Subscription Management** - Implemented LRU-based subscription cleanup
  - Changed subscription tracking from Set to Map with timestamps
  - Added automatic eviction when exceeding 50 concurrent subscriptions
  - Added stale subscription pruning (1-hour inactivity threshold, checked every 15 min)
  - Prevents unbounded memory and CPU growth from subscription accumulation
- **RainViewer Polar Coordinate Handling** - Fixed tile generation for extreme latitudes
  - Added Web Mercator latitude clamping (±85.05112878°) to prevent NaN coordinates
  - Prevents division by zero in tile calculations at polar regions
  - Logs warning when clamping occurs
- **Timezone Fallback** - Changed international timezone fallback from server timezone to UTC
  - Provides predictable, unambiguous timestamps for all users
  - Eliminates misleading timestamps for international queries (e.g., Sydney users seeing Chicago times)
  - US timezone heuristic unchanged (America/New_York, Chicago, Denver, Los_Angeles)

### Added
- **Comprehensive Test Coverage** - Added 28 unit tests for v1.6.1 fixes
  - Coordinate redaction privacy tests
  - Markdown injection prevention tests
  - RainViewer polar coordinate clamping tests
  - Timezone fallback behavior tests
  - Cache immutability tests
  - NWPS bounding box calculation tests

### Changed
- **Dependencies** - Updated to latest versions (integrated Dependabot PRs #5, #6)
  - `@modelcontextprotocol/sdk` 1.21.0 → 1.21.1
  - `vitest` 4.0.7 → 4.0.8
  - `@vitest/coverage-v8` 4.0.7 → 4.0.8

## [1.6.0] - 2025-11-09

### Added

#### Safety & Hazards - River Monitoring and Wildfire Tracking
- **NEW: `get_river_conditions` Tool** - Monitor river levels and flood status for safety and recreation
  - **Current Water Levels** from nearest NOAA and USGS gauges
    - Automatic gauge discovery within customizable radius (default: 50km)
    - Distance calculation to each gauge using Haversine formula
    - River and location names for context
  - **Flood Stage Information** - Critical safety data
    - Action, minor, moderate, and major flood thresholds
    - Current flood status with color-coded warnings
    - Forecast conditions when available
  - **Streamflow Data** from USGS Water Services
    - Real-time discharge in cubic feet per second (CFS)
    - Flow rate trends and comparisons
  - **Historical Context**
    - Historic flood crests when available
    - Recent crest data for context
  - **Safety Assessment** for recreational activities
    - Boating and kayaking safety guidance
    - Flood warnings and evacuation context
  - **US Coverage** via NOAA NWPS and USGS APIs
  - **1-Hour Cache** for gauge data
  - **User Queries**:
    - "What are the river conditions near me?"
    - "Is the river flooding?"
    - "Safe to kayak on the river today?"
    - "Check Mississippi River levels"

- **NEW: `get_wildfire_info` Tool** - Monitor active wildfires and fire perimeters for safety planning
  - **Active Fire Detection** from NIFC WFIGS
    - Wildfire locations and prescribed burns
    - Automatic filtering within customizable radius (default: 100km)
    - Distance-based sorting (nearest fires first)
  - **Fire Attributes**:
    - Fire size in acres and hectares
    - Containment percentage with visual progress bar
    - Discovery date and days active
    - Fire type classification (Wildfire vs Prescribed Fire)
    - Location details (state, county, city)
    - Coordinates of fire origin
  - **4-Level Safety Assessment** - Proximity-based warnings
    - **EXTREME DANGER** (<5km): Evacuate immediately if advised
    - **HIGH ALERT** (5-25km): Prepare for possible evacuation
    - **CAUTION** (25-50km): Monitor conditions, air quality impacts
    - **AWARENESS** (>50km): Stay informed about fire progression
  - **Comprehensive Fire Details** - Up to 5 nearest fires displayed
    - Detailed statistics for each fire
    - Visual containment indicators
    - State/county/city location information
  - **Safety Recommendations** based on distance to nearest wildfire
  - **30-Minute Cache** for fire data (updates frequently)
  - **Data Source**: NIFC WFIGS (Wildland Fire Interagency Geospatial Services)
  - **User Queries**:
    - "Are there wildfires near Los Angeles?"
    - "Check for active fires in Colorado"
    - "How close is the nearest wildfire?"
    - "Show me fire containment status"

### Technical Changes
- **New Type Definitions**:
  - Extended `src/types/noaa.ts` with NWPS river gauge types
    - `NWPSGauge`, `GaugeStatus`, `FloodCategories`
    - `HistoricCrest`, `USGSIVResponse`, `USGSSite`
  - Created `src/types/wildfire.ts` for NIFC ArcGIS data
    - `FirePerimeterAttributes`, `FirePerimeterFeature`
    - `NIFCQueryResponse`, `WildfireInfo`

- **New Service Clients**:
  - Enhanced `src/services/noaa.ts` with NWPS and USGS clients
    - `nwpsClient`: NOAA National Water Prediction Service
    - `usgsClient`: USGS Water Services API
    - `getNWPSGauge()`: Fetch individual gauge data
    - `getAllNWPSGauges()`: Fetch all available gauges
    - `getUSGSStreamflow()`: Real-time streamflow by bounding box
  - Created `src/services/nifc.ts` - NIFC ArcGIS REST API client
    - `queryFirePerimeters()`: Bounding box fire queries
    - `checkServiceStatus()`: NIFC service health check
    - ArcGIS Feature Server integration
    - 30-minute cache for fire perimeter data

- **New Utility**:
  - Created `src/utils/distance.ts`
    - `calculateDistance()`: Haversine formula for lat/lon distances
    - Used by both river and wildfire tools for proximity filtering

- **New Handlers**:
  - `src/handlers/riverConditionsHandler.ts`
    - Validates coordinates and radius parameters
    - Fetches all NWPS gauges and filters by distance
    - Queries USGS for streamflow data
    - Formats comprehensive river condition reports
  - `src/handlers/wildfireHandler.ts`
    - Converts center point + radius to bounding box
    - Queries NIFC for fire perimeters
    - Filters by actual distance and sorts by proximity
    - Provides 4-level safety assessment
    - Distinguishes wildfires from prescribed burns

- **Tool Configuration Updates**:
  - Added `get_river_conditions` and `get_wildfire_info` to `ToolName` type
  - Both tools added to 'all' preset (now 12 tools total)
  - New aliases: 'river', 'rivers', 'flood', 'streamflow', 'wildfire', 'wildfires', 'fire', 'fires', 'smoke'
  - Basic preset unchanged (5 tools) - minimal impact on typical users

- **Caching Strategy**:
  - River conditions: 1-hour TTL (gauge data updates frequently)
  - Wildfire information: 30-minute TTL (fire data changes rapidly)

### Testing
- **NEW**: `tests/integration/safety-hazards.test.ts` (17 comprehensive tests)
  - River Conditions: 7 tests covering gauge queries, validation, error handling
    - St. Louis, MO (Mississippi River) gauge discovery
    - Houston, TX multi-river area testing
    - Nevada desert (no gauges) edge case
    - Radius parameter validation and clamping
    - Coordinate validation
  - Wildfire Information: 10 tests covering fire detection, safety assessment, validation
    - Los Angeles (high fire risk area) wildfire queries
    - Denver, CO fire detection
    - Boston (low fire risk) edge case
    - Radius parameter validation and clamping
    - Coordinate validation
    - Safety assessment verification
  - NIFC service health checks

### Documentation
- Updated README.md with v1.6.0 features
  - Added tools 11 and 12 to Available Tools section
  - Updated Features section with river and wildfire monitoring
  - Added cache strategy for new tools
- Updated ROADMAP.md
  - Marked v1.6.0 as COMPLETE
  - Updated tool inventory and cumulative totals

### Implementation Notes
- **NOAA NWPS API**: Temporarily unavailable during initial testing (service downtime)
  - Error handling confirmed working correctly
  - Graceful degradation with user-friendly messages
  - Tests will be re-run when API is back online
- **NIFC WFIGS API**: Operational and tested successfully
  - Detected real "La Plata" wildfire in Colorado during testing
  - 133 acres, 92% contained, discovered August 17, 2025

## [1.5.0] - 2025-11-09

### Added

#### Weather Visualization & Lightning Safety - Visual Analysis and Real-Time Strike Monitoring
- **NEW: `get_weather_imagery` Tool** - Access weather radar and precipitation maps
  - **Precipitation Radar** from RainViewer API (free, global coverage)
    - Static radar images showing current precipitation
    - Animated radar loops (up to 2 hours of history)
    - Tile URLs for efficient rendering
    - Automatic coordinate-to-tile calculation
    - Timestamp metadata for each frame
  - **Global Coverage** - Works anywhere in the world
  - **15-Minute Cache** for radar data to reduce API load
  - **Graceful Degradation** when imagery unavailable
  - **Future-Ready**: Satellite imagery deferred to future release
  - **User Queries**:
    - "Show me the current radar"
    - "Is there precipitation nearby on radar?"
    - "Show animated radar for the last hour"

- **NEW: `get_lightning_activity` Tool** - Real-time lightning strike detection and safety assessment
  - **Real-Time Strike Detection** from Blitzortung.org (free, no API key required)
    - Lightning strikes within customizable radius (default: 100km)
    - Time window for historical strikes (default: 60 minutes)
    - Distance calculation using Haversine formula
    - Strike polarity (cloud-to-ground vs intra-cloud)
    - Strike amplitude in kiloamperes (kA)
  - **4-Level Safety Assessment** - Critical for outdoor safety
    - **Safe** (>50km): No immediate lightning threat
    - **Elevated** (16-50km): Monitor conditions, plan indoor access
    - **High** (8-16km): Seek shelter immediately
    - **Extreme** (<8km): Active thunderstorm, dangerous conditions
  - **Comprehensive Statistics**:
    - Total strikes and strike density (per sq km)
    - Strikes per minute rate
    - Nearest strike distance
    - Average distance of all strikes
    - Cloud-to-ground vs intra-cloud classification
  - **Safety Recommendations** - Context-aware guidance based on proximity
  - **Geographic Region Detection** - Optimizes API endpoints for best coverage
  - **5-Minute Cache** for strike data
  - **Graceful Degradation** - Returns empty array if API unavailable
  - **User Queries**:
    - "Are there lightning strikes nearby?"
    - "How close is the lightning?"
    - "Is it safe to be outside?" (lightning risk assessment)
    - "Show recent lightning activity"

### Technical Changes
- **New Type Definitions**:
  - `src/types/imagery.ts` - Weather imagery types
    - `ImageryType`: 'radar' | 'satellite' | 'precipitation'
    - `WeatherImageryParams`, `WeatherImageryResponse`
    - `ImageFrame`, `RainViewerResponse`
  - `src/types/lightning.ts` - Lightning strike types
    - `LightningSafetyLevel`: 'safe' | 'elevated' | 'high' | 'extreme'
    - `LightningStrike`, `LightningStatistics`, `LightningSafety`
    - `LightningActivityResponse`

- **New Service Clients**:
  - `src/services/rainviewer.ts` - RainViewer API client
    - `getRadarData()`: Fetch available radar timestamps
    - `getPrecipitationRadar()`: Get radar imagery for location
    - `buildCoordinateTileUrl()`: Calculate tile URLs from coordinates
    - Tile coordinate conversion (lat/lon to tile x/y/z)
  - `src/services/blitzortung.ts` - Blitzortung.org API client
    - `getLightningStrikes()`: Fetch recent strikes in radius
    - `calculateDistance()`: Haversine distance calculation
    - `parseStrikes()`: Parse and filter strike data
    - `determineRegion()`: Geographic region detection
    - `generateMockData()`: Development/fallback data

- **New Handlers**:
  - `src/handlers/weatherImageryHandler.ts`
    - `getWeatherImagery()`: Validates and processes imagery requests
    - `formatWeatherImageryResponse()`: Formats imagery data for MCP response
    - Validation for imagery type, animated flag, coordinates
  - `src/handlers/lightningHandler.ts`
    - `getLightningActivity()`: Processes lightning activity requests
    - `assessSafety()`: Calculates safety level from strike distances
    - `calculateStatistics()`: Computes comprehensive strike statistics
    - `formatLightningActivityResponse()`: Formats for MCP response

- **Tool Configuration Updates**:
  - Added `get_weather_imagery` and `get_lightning_activity` to `ToolName` type
  - Both tools added to 'all' preset (now 10 tools total)
  - New aliases: 'imagery', 'radar', 'satellite', 'lightning', 'strikes', 'thunderstorm'
  - Basic preset unchanged (5 tools) - minimal impact on typical users

- **Error Handling**:
  - Extended `ApiError` service types to include 'RainViewer'
  - Updated help link logic for RainViewer service

### Testing
- **15 new integration tests** added (764 total):
  - Weather imagery tests (7 tests) - `tests/integration/visualization-lightning.test.ts`
    - Precipitation radar retrieval (New York, London, Tokyo)
    - Animated vs static radar
    - Radar type alias handling
    - Validation (invalid type, coordinates, satellite not implemented)
  - Lightning activity tests (8 tests) - `tests/integration/visualization-lightning.test.ts`
    - Lightning detection (Miami, New York, London, Tokyo, Sydney, Austin)
    - Default and custom search parameters
    - Safety assessment and statistics calculation
    - Strike details validation
    - Validation (invalid radius, time window, coordinates)
- **Updated unit tests**:
  - Tool configuration tests updated for 10 tools (was 8)
  - All 764 tests passing with 100% pass rate

### Documentation
- Updated ROADMAP.md to mark v1.5.0 as complete
- Updated FUTURE_ENHANCEMENTS.md:
  - Section 8.1 (Real-Time Lightning Data) marked as implemented
  - Section 12.1 (Radar & Satellite Image URLs) marked as partially implemented
- Tool inventory now shows 10 total tools

### Configuration Impact
With v1.4.0 tool configuration system, users have full control:
- **Typical user**: `ENABLED_TOOLS=basic` (5 tools, no change)
- **Power user**: `ENABLED_TOOLS=all` (all 10 tools including imagery and lightning)
- **Lightning safety focus**: `ENABLED_TOOLS=basic,+lightning`
- **Visual analysis**: `ENABLED_TOOLS=standard,+imagery,+lightning`
- **Weather enthusiast**: `ENABLED_TOOLS=full,+imagery,+lightning`

### Benefits
- ✅ **Weather Visualization**: Visual confirmation of precipitation via radar imagery
- ✅ **Lightning Safety**: Critical real-time safety information for outdoor activities
- ✅ **Global Coverage**: Both tools work worldwide
- ✅ **Free APIs**: No API keys or costs required (RainViewer, Blitzortung.org)
- ✅ **Safety-Critical**: 4-level assessment helps users make informed decisions
- ✅ **Minimal Overhead**: Both tools only in 'all' preset, doesn't affect basic users
- ✅ **Zero Breaking Changes**: Existing configurations continue to work

### Use Cases
- **Outdoor Safety**: Check for nearby lightning before outdoor activities
- **Weather Analysis**: Visual confirmation of approaching precipitation
- **Emergency Planning**: Real-time lightning threat assessment
- **Education**: Understand storm structure through radar and strike patterns
- **Recreation**: Boaters, hikers, golfers can check safety conditions

**Token Overhead**: ~400 tokens added (total: ~1,400 with all tools, ~600 with basic preset)

## [1.4.0] - 2025-11-08

### Added

#### Tool Configuration System - Reduce Context Overhead & Customize Functionality
- **NEW: Configurable Tool Loading** - Control which MCP tools are exposed via `ENABLED_TOOLS` environment variable
  - **4 Presets** for easy configuration:
    - `basic` (default): Essential 5 tools - forecast, current_conditions, alerts, search_location, check_service_status
    - `standard`: Basic + historical_weather (6 tools)
    - `full`: Standard + air_quality (7 tools)
    - `all`: All 8 tools including marine_conditions
  - **Flexible Syntax** for fine-grained control:
    - Use presets: `ENABLED_TOOLS=full`
    - Select specific tools: `ENABLED_TOOLS=forecast,current,alerts`
    - Add to presets: `ENABLED_TOOLS=basic,+historical,+air_quality`
    - Remove from presets: `ENABLED_TOOLS=all,-marine`
    - Complex combinations: `ENABLED_TOOLS=standard,+air_quality,-alerts`
  - **Tool Aliases** - Short names for convenience:
    - `forecast`, `current`, `conditions`, `alerts`, `warnings`
    - `historical`, `history`, `status`, `location`, `search`
    - `air_quality`, `aqi`, `marine`, `ocean`, `waves`
  - **Smart Defaults**: Only `basic` tools enabled by default (5 of 8 tools)
  - **Runtime Validation**: Prevents disabled tools from being called
  - **Startup Logging**: Shows which tools are enabled on server start

### Technical Changes
- New configuration module: `src/config/tools.ts`
  - `ToolConfig` class with singleton pattern
  - `parseEnabledTools()`: Parses complex configuration syntax
  - `resolveToolName()`: Handles tool aliases and full names
  - `isEnabled()`: Check if specific tool is enabled
  - `getEnabledTools()`: Get list of all enabled tools
- Updated `src/index.ts`:
  - Tool definitions moved to `TOOL_DEFINITIONS` constant
  - `ListToolsRequestSchema` handler filters by enabled tools
  - `CallToolRequestSchema` handler validates tool is enabled before execution
  - Enhanced startup logging with enabled tool count and list
- Environment variable: `ENABLED_TOOLS` (optional, defaults to `basic`)

### Testing
- **27 new unit tests** added (749 total, 100% pass rate):
  - Tool configuration tests: 27 tests (`tests/unit/tool-config.test.ts`)
    - Preset parsing (basic, standard, full, all)
    - Individual tool selection
    - Addition syntax (+tool)
    - Removal syntax (-tool)
    - Combination syntax (presets + additions + removals)
    - Alias resolution
    - Edge cases (whitespace, invalid names, duplicates, case insensitivity)
    - Static method tests (preset/alias definitions)

### Documentation
- Updated README.md with "Tool Selection" configuration section
- Updated .env.example with comprehensive tool configuration examples
- All configuration examples and benefits documented

### Benefits
- ✅ **Reduced Context Overhead**: Load only needed tools (basic = 5 tools vs all = 8 tools)
- ✅ **Better Security**: Only expose necessary functionality
- ✅ **Easy Customization**: Mix and match with flexible syntax
- ✅ **Backwards Compatible**: Defaults to `basic` preset if not configured
- ✅ **Zero Breaking Changes**: Existing deployments continue to work
- ✅ **Minimal Token Impact**: Tool filtering happens at registration, not per-request

### Use Cases
- **Typical Weather User**: `ENABLED_TOOLS=basic` (5 tools, minimal overhead)
- **Power User**: `ENABLED_TOOLS=all` (all 8 tools, maximum functionality)
- **Specific Needs**: `ENABLED_TOOLS=forecast,current,air_quality` (custom selection)
- **Air Quality Focus**: `ENABLED_TOOLS=basic,+air_quality` (core + AQI monitoring)
- **No Marine Data**: `ENABLED_TOOLS=all,-marine` (everything except ocean conditions)

## [1.3.0] - 2025-11-07

### Enhanced

#### Version Management & User Updates - Keep Users on Latest Version
- **NEW: Version Information in Status Check** - `check_service_status` tool now displays version info
  - Shows installed version number
  - Links to latest release on GitHub
  - Links to CHANGELOG and upgrade instructions
  - Recommends `@latest` tag for automatic updates
  - Helps users discover when they're running outdated versions
- **NEW: Startup Version Logging** - Server logs version info on startup
  - Displays installed version in structured logs
  - Includes links to latest release and upgrade instructions
  - Provides tip for automatic updates via `npx @latest`
  - Visible in MCP client logs for awareness
- **Updated Installation Instructions** - README now recommends `@latest` tag
  - All npx examples updated to use `@dangahagan/weather-mcp@latest`
  - Ensures new users automatically get latest version on each run
  - Reduces version drift across user base
  - Addresses issue where several hundred users may be on older versions

### Documentation
- Updated README.md with `@latest` in all npx installation examples
- Enhanced "Upgrading to Latest Version" section with clearer instructions
- Updated "Quick Start: Claude Code" section with recommended configuration
- Clarified npx caching behavior and upgrade workflow

### Benefits
- **Automatic Updates**: Users with `@latest` config stay current automatically
- **Version Visibility**: Users can easily check their version via status tool
- **Reduced Support**: Fewer issues from outdated versions
- **Better UX**: Users discover new features and bug fixes faster

**Migration Note**: Existing users should update their MCP configuration to use `@latest`:
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp@latest"]
    }
  }
}
```

## [1.2.1] - 2025-11-07

### Enhanced

#### Fire Weather Intelligence - Contextual Messaging
- **Intelligent Fire Weather Explanations** - Smart contextual messages when fire weather indices unavailable
  - **NEW: `getFireWeatherContext()`** utility - Provides region, season, and weather-aware explanations
  - **Geographic Detection**: Identifies Western US, California, Southern states, Eastern US regions
  - **Seasonal Awareness**: Differentiates winter vs. fire season with appropriate messaging
  - **Humidity-Based Context**: Recognizes high humidity conditions that suppress fire risk
  - **User Education**: Explains when and why fire danger indices are calculated
  - **Improved UX**: Replaces confusing empty fields with clear, helpful information
  - **Atmospheric Monitoring Section**: Always displays mixing height and transport wind data
  - **Zero Breaking Changes**: All existing functionality preserved

### Technical Changes
- New utility function: `getFireWeatherContext()` in `src/utils/fireWeather.ts`
  - Detects geographic region from coordinates
  - Determines current season and date context
  - Analyzes weather conditions (humidity, temperature)
  - Generates tailored explanatory messages
- Updated `currentConditionsHandler.ts`: Enhanced fire weather display logic with contextual messaging
- Improved test organization: Moved test scripts from root to `tests/` directory

### Testing
- **29 new unit tests** added (722 total, 100% pass rate):
  - Fire weather context detection: 29 tests (`tests/unit/fireWeatherContext.test.ts`)
    - Geographic region detection (Western US, California, Southern, Eastern)
    - Seasonal context (winter, fire season, shoulder months)
    - Humidity-based messaging
    - Temperature-based context
    - Edge cases and boundary conditions

### Documentation
- Enhanced user experience with contextual fire weather explanations
- Improved inline code documentation for fire weather utilities

## [1.2.0] - 2025-11-07

### Enhanced

#### Climate Normals - Historical Context for Weather
- **NEW: Climate Normals Support** - Compare current and forecasted weather to 30-year averages (1991-2020)
  - **Optional Parameter**: `include_normals=true` for `get_current_conditions` and `get_forecast`
  - **Hybrid Data Strategy**:
    - **Primary**: Open-Meteo computed normals (global, zero setup, completely free)
    - **Optional**: NOAA NCEI official normals (US only, requires free API token)
    - Automatically selects best source: tries NCEI first for US locations with token, falls back to Open-Meteo
  - **Displays**:
    - Normal high/low temperatures for the date
    - Normal precipitation amount
    - **Departure from normal**: "+8°F warmer than normal" or "-5°F cooler than normal"
    - Helps answer "Is this weather unusual?"
  - **Data Source**:
    - Open-Meteo: Computed from 30 years (1991-2020) of ERA5 reanalysis data
    - NCEI: Official NOAA climate normals (requires `NCEI_API_TOKEN` env variable)
  - **Caching**: Normals cached indefinitely (static historical data)
  - **No Token Required**: Default implementation uses completely free Open-Meteo API

#### Snow and Ice Data - Winter Weather Tracking
- **Enhanced Winter Weather Display** - Automatic snow/ice data extraction and formatting
  - **Snow Depth**: Current snow on ground (inches)
  - **Snowfall Forecast**: Expected accumulation over forecast period
  - **Ice Accumulation**: Freezing rain accumulation forecast
  - **Smart Display**: Only shows when winter weather is present
  - **Unit Conversion**: Automatically converts from metric (mm/cm) to US units (inches)
  - **Integration**:
    - Current conditions: Shows current snow depth
    - Forecasts: Shows expected snowfall and ice for forecast period
  - **Data Source**: NOAA gridpoint data and observations

#### Timezone-Aware Time Display - Local Time Context
- **Enhanced Time Formatting** - All timestamps now display in local timezone
  - **Automatic Detection**: Uses timezone from NOAA station data or geographic coordinates
  - **Formatted Display**: "Nov 7, 2025, 2:30 PM EST" instead of ISO 8601
  - **Applied To**:
    - Current conditions observation time
    - Forecast update times
    - Weather alert effective/expiration times
    - Marine conditions observation time
    - Forecast period headers (hourly forecasts)
  - **Timezone Support**:
    - IANA timezone identifiers (e.g., "America/New_York")
    - Automatic DST handling
    - Fallback to geographic guess if API timezone unavailable
  - **Format Styles**: Short, medium, long, and full format options

### Technical Changes

#### Climate Normals Infrastructure
- New services:
  - `src/services/ncei.ts`: NCEI Climate Data Online (CDO) API client (placeholder for future full implementation)
  - `src/config/api.ts`: Optional NCEI API token configuration
- New utilities (`src/utils/normals.ts`):
  - `computeNormalsFrom30YearData()`: Computes 30-year averages from historical data
  - `getClimateNormals()`: Hybrid selection logic (NCEI → Open-Meteo fallback)
  - `formatNormals()`: Markdown formatting with departure calculations
  - `calculateDeparture()`: Computes +/- from normal
  - `isLocationInUS()`: Geographic detection for NCEI eligibility
  - `getNormalsCacheKey()`: Cache key generation
- Enhanced Open-Meteo service:
  - `getClimateNormals()`: Fetches 30 years of historical data (1991-2020)
  - Optimized to fetch only target month ±1 (75% data reduction)
  - Returns computed ClimateNormals object
- Updated error types: Added 'NCEI' to service union in all error classes
- Handler updates:
  - `currentConditionsHandler`: Added `include_normals` parameter and display logic
  - `forecastHandler`: Added `include_normals` parameter (daily forecasts only)

#### Snow/Ice Utilities
- Comprehensive snow utilities (`src/utils/snow.ts`):
  - `extractSnowDepth()`: Extract current snow on ground from observations
  - `extractSnowfallForecast()`: Aggregate snowfall from gridpoint forecasts
  - `extractIceAccumulation()`: Aggregate ice accumulation from gridpoint forecasts
  - `formatSnowData()`: Markdown formatting for winter weather section
  - `hasWinterWeather()`: Check if any winter weather data present
- Unit conversion: Automatic mm/cm → inches
- Time filtering: Extract data for specific forecast periods
- Threshold handling: Skip trace amounts (< 0.1" snow, < 0.05" ice)

#### Timezone Infrastructure
- Comprehensive timezone utilities (`src/utils/timezone.ts`):
  - `formatInTimezone()`: Format ISO datetime in specific timezone (4 styles)
  - `formatDateInTimezone()`: Date-only formatting
  - `formatTimeInTimezone()`: Time-only formatting with abbreviation
  - `getTimezoneAbbreviation()`: Get timezone abbreviation (EST/EDT/PST/etc.)
  - `guessTimezoneFromCoords()`: Geographic fallback for missing timezone data
  - `formatTimeRangeInTimezone()`: Format time ranges with timezone context
  - `isValidTimezone()`: Validate IANA timezone identifiers
- Uses Luxon library for robust timezone handling
- Fallback chain: NOAA station timezone → geographic guess → system timezone → UTC

### Testing
- **340 new unit tests** added (693 total, 100% pass rate):
  - Climate normals utilities: 31 tests (`tests/unit/normals.test.ts`)
    - 30-year average computation
    - Cache key generation
    - Departure calculation
    - Formatting with/without current temps
    - Date component extraction
    - US location detection
  - Snow/ice utilities: 29 tests (`tests/unit/snow.test.ts`)
    - Snow depth extraction (multiple units)
    - Snowfall forecast aggregation
    - Ice accumulation tracking
    - Time-based filtering
    - Formatting and display logic
  - Timezone utilities: 33 tests (`tests/unit/timezone.test.ts`)
    - Multi-format datetime display
    - Timezone abbreviation handling
    - Geographic coordinate guessing
    - Time range formatting
    - IANA timezone validation
  - **Fire weather utilities: 92 tests** (`tests/unit/fireWeather.test.ts`) - **SAFETY-CRITICAL**
    - Haines Index categorization (all thresholds validated)
    - Grassland fire danger levels
    - Red Flag Warning threat assessment
    - Fire weather data extraction
    - Mixing height dispersion context
    - Transport wind interpretation
  - **Air quality utilities: 114 tests** (`tests/unit/airQuality.test.ts`) - **HEALTH-CRITICAL**
    - US EPA AQI categorization (all 6 categories, exact thresholds)
    - European EAQI categorization (all 6 categories)
    - UV Index categorization (WHO standards)
    - Pollutant information (7 pollutants)
    - Concentration formatting with precision
    - Geographic AQI selection (US territories)
  - **NCEI service: 41 tests** (`tests/unit/ncei.test.ts`)
    - Service initialization and configuration
    - Token validation and availability
    - Error handling interceptor
    - Climate normals placeholder implementation
- All existing 353 tests continue to pass
- Comprehensive edge case coverage including safety/health-critical calculations

### Documentation
- Updated `CLAUDE.md` with implementation patterns
- Created `docs/development/CLIMATE_NORMALS_PLAN.md` - comprehensive planning document
- Updated README.md with new feature descriptions
- Updated ROADMAP.md - moved Tier 1 items to completed

### Benefits
- ✅ **Climate Context**: Users can assess if weather is unusual for the date
- ✅ **Winter Awareness**: Automatic snow/ice alerts in forecasts and conditions
- ✅ **Time Clarity**: All times displayed in familiar local format instead of UTC
- ✅ **Zero Setup**: Default implementation requires no API tokens
- ✅ **Opt-In Design**: New features are optional parameters (backward compatible)
- ✅ **Global Coverage**: Climate normals work worldwide via Open-Meteo
- ✅ **US Enhancement**: Optional NCEI integration for official US climate normals

### API Changes
- **Backward Compatible**: All new features are opt-in via optional parameters
- New optional parameters:
  - `get_current_conditions`: `include_normals` (boolean, default false)
  - `get_forecast`: `include_normals` (boolean, default false)
- New environment variable:
  - `NCEI_API_TOKEN`: Optional NCEI API token for US climate normals

### Performance
- Climate normals cached indefinitely (static data)
- Optimized historical data fetching (75% reduction by fetching only ±1 month)
- No performance impact when normals not requested
- Timezone formatting adds negligible overhead (<1ms)

## [1.1.0] - 2025-11-07

### Enhanced

#### Marine Conditions - Great Lakes & Coastal Bay Support
- **Enhanced `get_marine_conditions`** with dual-source support for inland lakes
  - **NOAA Data Integration**: Automatically uses NOAA gridpoint data for:
    - All 5 Great Lakes (Superior, Michigan, Huron, Erie, Ontario)
    - Major US coastal bays (Chesapeake Bay, San Francisco Bay, Tampa Bay, Puget Sound)
    - Lake Okeechobee and other large navigable inland waters
  - **Automatic Source Selection**: Intelligent geographic detection
    - Detects Great Lakes coordinates and uses NOAA marine data
    - Falls back to Open-Meteo for ocean locations and when NOAA data unavailable
    - Zero token overhead - no new parameters required
  - **Marine Data from NOAA**:
    - Wave height, wave period, wave direction (from gridpoint forecasts)
    - Wind speed, wind direction, wind gusts (in knots for marine use)
    - Current conditions with safety assessments
  - **Enhanced Coverage**: Addresses previous limitation where Great Lakes locations returned "N/A"
    - Traverse City, MI (Grand Traverse Bay) - now provides wave/wind data
    - Duluth, MN (Lake Superior) - full marine conditions
    - Cleveland, OH (Lake Erie) - complete wind/wave information
  - **Graceful Degradation**: Falls back to Open-Meteo if NOAA data unavailable
  - **Clear Data Source Attribution**: Output indicates whether data is from NOAA or Open-Meteo

### Technical Changes
- Added geographic detection utilities (`src/utils/geography.ts`):
  - `shouldUseNOAAMarine()`: Detects Great Lakes and coastal bay locations
  - `getGreatLakeRegion()`: Identifies which Great Lake contains coordinates
  - `getMajorCoastalBayRegion()`: Detects major US coastal bays
  - Bounding box definitions for all 5 Great Lakes and 5 major coastal areas
- Enhanced NOAA type definitions with marine forecast properties:
  - New interface: `GridpointMarineForecast` with 9 marine data fields
  - Added to `GridpointProperties`: waveHeight, wavePeriod, waveDirection, windWaveHeight, swellHeight/Direction
- Enhanced marine utilities (`src/utils/marine.ts`):
  - `extractNOAAMarineConditions()`: Extracts marine data from gridpoint response
  - `formatWindSpeed()`: Converts km/h to knots for marine display
  - New interface: `NOAAMarineConditions` for NOAA-sourced marine data
- Updated `marineConditionsHandler`:
  - Dual-source logic: tries NOAA first for Great Lakes/bays, falls back to Open-Meteo
  - Separate formatters: `formatNOAAMarineConditions()` and `formatOpenMeteoMarineConditions()`
  - Enhanced logging for source selection and fallback scenarios
- Updated service injection: handler now receives both `noaaService` and `openMeteoService`

### Testing
- Added comprehensive integration test suite (`tests/integration/great-lakes-marine.test.ts`):
  - Geographic detection validation (15 tests total)
  - NOAA marine data retrieval for all Great Lakes
  - Coastal bay detection (San Francisco Bay, Chesapeake Bay)
  - Open-Meteo fallback for ocean locations
  - Error handling and graceful degradation
  - Marine data format validation
- Added unit tests for geography utilities (`tests/unit/geography.test.ts`):
  - Bounding box validation for all regions (26 tests)
  - Edge case handling and boundary testing
  - No overlaps between Great Lakes and coastal bay regions

### Documentation
- Updated ROADMAP.md with v1.1.0 completion status
- No changes to tool descriptions (maintains lean design philosophy)
- Zero token overhead - existing tool description unchanged

### Benefits
- ✅ Great Lakes boaters/sailors now get accurate marine forecasts
- ✅ Addresses user feedback about N/A data for inland lakes
- ✅ No new tools added (maintains 8-tool count from v1.0.0)
- ✅ Zero token overhead (smart routing, no new parameters)
- ✅ Backward compatible (Open-Meteo remains default for ocean locations)
- ✅ Improves existing tool quality without API proliferation

## [0.6.0] - 2025-11-06

### Added

#### Marine Conditions Tool
- **NEW TOOL: `get_marine_conditions`** - Comprehensive marine weather for coastal and ocean areas
  - Global coverage via Open-Meteo Marine API
  - Current marine conditions:
    - **Significant Wave Height**: Average height of highest 1/3 of waves (meters and feet)
    - **Wave Direction**: Cardinal direction of wave propagation
    - **Wave Period**: Time between successive wave crests (longer = more powerful)
    - **Wind Waves**: Locally generated waves from current winds
      - Height, direction, period, and peak period
    - **Swell**: Long-period waves from distant weather systems
      - Height, direction, period, and peak period
    - **Ocean Currents**: Velocity and direction (m/s and knots)
  - Safety assessment with color-coded conditions:
    - 🟢 Calm (0-2m): Safe for most vessels
    - 🟡 Moderate (2-4m): Challenging for small craft
    - 🟠 Rough (4-6m): Hazardous for small vessels
    - 🔴 Very Rough (6-9m): Dangerous for most vessels
    - 🟤 High (>9m): Extremely dangerous
  - Optional 5-day marine forecast with daily summaries
  - Wave height categorization based on Douglas Sea Scale
  - Interpretation guidance for wave types and periods
  - Important disclaimer about coastal accuracy limitations
  - 1-hour cache for marine data

#### Severe Weather Probabilities
- **Enhanced `get_forecast`** with severe weather forecasting (US only)
  - New parameter: `include_severe_weather` (boolean, default: false)
  - Probabilistic severe weather data from NOAA gridpoint forecasts:
    - **Thunderstorm Probability**: Likelihood of thunder in next 48 hours
    - **Wind Gust Probabilities**: Categorized by intensity
      - 20+ mph, 30+ mph, 40+ mph, 50+ mph, 60+ mph thresholds
      - Shows highest risk category with percentage
    - **Tropical Storm Winds**: Probability of 39-73 mph winds
    - **Hurricane-Force Winds**: Probability of 74+ mph winds
    - **Lightning Activity Level**: 1-5 scale with qualitative description
  - Smart display logic:
    - Only shows significant probabilities (filters low-risk data)
    - Prioritizes highest wind gust category
    - Includes emoji indicators for quick visual assessment
  - Works with both daily and hourly forecast granularities
  - Graceful fallback if severe weather data unavailable
  - Maximum probability extraction over next 48 hours

### Technical Changes
- Added Open-Meteo Marine API integration
  - New service client for `marine-api.open-meteo.com`
  - Support for current, hourly, and daily marine data
  - Comprehensive wave, swell, and current parameters
- Enhanced NOAA gridpoint data with severe weather fields
  - New type definitions: `GridpointSevereWeather` interface
  - Added 11 new severe weather probability fields
  - Lightning activity level support
- New utility modules:
  - `src/utils/marine.ts`: Wave height categorization, safety assessment, activity suitability
  - Helper functions for wave/current formatting with unit conversions
- New handler: `src/handlers/marineConditionsHandler.ts`
- Enhanced forecast handler with severe weather formatting
  - `formatSevereWeather()`: Extracts and formats gridpoint probabilities
  - `getMaxProbabilityFromSeries()`: Time-windowed probability analysis
- Comprehensive test coverage:
  - `tests/test_marine_conditions.ts`: 7 integration tests for marine weather
  - `tests/test_severe_weather.ts`: 5 integration tests for severe forecasts
  - `tests/test_noaa_gridpoint.ts`: Gridpoint API exploration
- Updated version to 0.6.0 across all service user-agents

### Documentation
- Updated tool descriptions with marine and severe weather capabilities
- Added semantic trigger phrases for AI tool selection:
  - Marine: "ocean conditions", "wave height", "surf conditions", "safe to boat"
  - Severe weather: "thunderstorm chance", "wind gusts", "tropical storm"
- Enhanced safety disclaimers for marine navigation
- Added interpretation guides for wave conditions and severe weather probabilities

## [0.5.0] - 2025-11-06

### Added

#### Air Quality Tool
- **NEW TOOL: `get_air_quality`** - Comprehensive air quality monitoring with global coverage
  - Air Quality Index (AQI) with automatic region detection:
    - US AQI for United States locations (0-500 scale)
    - European EAQI for international locations (0-100+ scale)
  - Health recommendations based on AQI levels:
    - Categorized as Good, Moderate, Unhealthy for Sensitive Groups, Unhealthy, Very Unhealthy, or Hazardous
    - Specific cautionary statements for sensitive populations
    - Activity recommendations based on air quality
  - Pollutant concentrations:
    - PM2.5 (Fine Particulate Matter)
    - PM10 (Coarse Particulate Matter)
    - Ozone (O₃)
    - Nitrogen Dioxide (NO₂)
    - Sulfur Dioxide (SO₂)
    - Carbon Monoxide (CO)
    - Ammonia (NH₃) when available
    - Aerosol Optical Depth (atmospheric haze indicator)
  - UV Index with protection recommendations:
    - Categorized as Low, Moderate, High, Very High, or Extreme
    - Specific sun protection guidance
    - Clear sky UV index comparison
  - Optional hourly air quality forecasts (5-day outlook)
  - Smart AQI display prioritizing relevant index for location
  - 1-hour cache for current conditions

#### Fire Weather Enhancement
- **Enhanced `get_current_conditions`** with optional fire weather data (US only)
  - New parameter: `include_fire_weather` (boolean, default: false)
  - Fire danger indices from NOAA gridpoint data:
    - **Haines Index** (2-6 scale): Atmospheric stability and dryness affecting fire growth potential
      - Categorized as Low, Moderate, High, or Very High
      - Detailed fire behavior implications
    - **Grassland Fire Danger Index** (1-4 scale): Fire risk in grassland/rangeland fuels
    - **Red Flag Threat Index** (0-100 scale): Likelihood of Red Flag Warning conditions
  - Smoke dispersion metrics:
    - **Mixing Height**: Vertical extent of atmospheric mixing (affects smoke dispersion)
    - **Transport Wind Speed**: Wind speed for smoke transport and fire spread
  - Color-coded risk levels (Green, Yellow, Orange, Red)
  - Graceful degradation when fire weather data unavailable
  - 2-hour cache for gridpoint data

### Technical Changes
- Added Open-Meteo Air Quality API integration
  - New service client for `air-quality-api.open-meteo.com`
  - Support for current and forecast air quality data
  - Comprehensive pollutant and AQI parameter requests
- Added NOAA gridpoint data API integration
  - New methods: `getGridpointData()` and `getGridpointDataByCoordinates()`
  - Access to 60+ gridpoint forecast variables
  - Fire weather indices extraction and formatting
- New utility modules:
  - `src/utils/airQuality.ts`: AQI interpretation and health recommendations
  - `src/utils/fireWeather.ts`: Fire danger index interpretation
- New type definitions:
  - `OpenMeteoAirQualityResponse` and related types
  - `GridpointResponse` and fire weather property types
- Comprehensive test coverage:
  - `tests/test_air_quality.ts`: 10 integration tests for air quality
  - `tests/test_fire_weather.ts`: 6 integration tests for fire weather
- Updated version to 0.5.0 across all service user-agents

### Documentation
- Updated tool descriptions with air quality and fire weather capabilities
- Enhanced semantic trigger phrases for AI tool selection
- Added health and safety use case documentation

## [0.4.0] - 2025-11-06

### Added
- **NEW TOOL: `search_location`** - Geocoding for natural language location queries
  - Convert location names to coordinates (e.g., "Paris", "Tokyo", "San Francisco, CA")
  - Returns multiple results with relevance ranking
  - Location metadata: timezone, elevation, population, country, administrative regions
  - Feature type classification (capital, city, airport, etc.)
  - 30-day cache for location searches
  - Enables conversational queries like "What's the weather in London?"

- **Enhanced `get_forecast`** - Global coverage and extended forecasts
  - NEW parameter: `source` - Manual data source selection
    - `"auto"` (default): Intelligent routing based on location
    - `"noaa"`: Force NOAA API (US only, more detailed)
    - `"openmeteo"`: Force Open-Meteo API (global)
  - Extended forecast range: Up to 16 days (was 7 days)
  - Global forecast support via Open-Meteo Forecast API
  - Automatic US location detection (Continental, Alaska, Hawaii, territories)
  - Sunrise/sunset times with daylight duration
  - UV index for international locations
  - Wind direction conversion (degrees to cardinal directions)
  - Unified response format across data sources

- Open-Meteo service expansion
  - Added Forecast API client (`getForecast()` method)
  - Added Geocoding API client (`searchLocation()` method)
  - Multiple Axios clients for different Open-Meteo endpoints
  - Proper error handling and caching per endpoint

### Technical Changes
- Comprehensive location metadata in geocoding responses
- Smart data source routing based on coordinates
- Extended daily forecast support (16 days maximum)
- 2-hour cache for forecast data
- 30-day cache for location searches
- New integration tests:
  - `tests/test_search_location.ts`: 8 tests
  - `tests/test_global_forecasts.ts`: 9 tests

### Fixed
- Improved forecast accuracy for international locations
- Better error messages for out-of-range forecast requests

## [0.3.0] - 2025-11-05

### Added
- **NEW TOOL: `get_alerts`** - Weather alerts, watches, and warnings (US only)
  - Active weather alerts from NOAA
  - Severity levels: Extreme, Severe, Moderate, Minor
  - Urgency and certainty indicators
  - Effective/expiration times and affected areas
  - Automatic sorting by severity (most severe first)
  - Detailed instructions and recommended responses
  - 5-minute cache TTL for timely alert updates

- **Enhanced `get_forecast`** - Hourly forecasts and precipitation probability
  - NEW parameter: `granularity` - Choose forecast detail level
    - `"daily"` (default): Day/night forecast periods
    - `"hourly"`: Hour-by-hour detailed forecasts (up to 156 hours)
  - NEW parameter: `include_precipitation_probability` (default: true)
    - Shows chance of precipitation for each period
    - Helps users plan around rain/snow
  - Temperature trends in hourly forecasts
  - Humidity display for comfort assessment

- **Enhanced `get_current_conditions`** - Comprehensive weather details
  - **Heat Index**: Automatically shown when temperature > 80°F
  - **Wind Chill**: Automatically shown when temperature < 50°F
  - **24-Hour Temperature Range**: High and low from last 24 hours
  - **Wind Gusts**: Shown when 20%+ higher than sustained wind
  - **Enhanced Visibility**: Descriptive categories (clear, haze, fog, dense fog)
  - **Detailed Cloud Cover**: Cloud types and heights (e.g., "Scattered clouds at 3,500 ft")
  - **Recent Precipitation History**: Last 1, 3, and 6 hours
  - Intelligent display thresholds via `DisplayThresholds` config

### Technical Changes
- New NOAA endpoints:
  - `/alerts/active` with coordinate-based filtering
- Forecast period parsing for hourly data
- Smart display logic based on weather conditions
- Configurable display thresholds in `src/config/displayThresholds.ts`
- Enhanced type definitions for alerts and detailed observations

### Documentation
- Updated README with v0.3.0 features
- Tool descriptions enhanced for better AI understanding
- Added safety and planning use cases

## [0.2.0] - 2025-11-04

### Added
- Historical weather data support
- NOAA observation stations integration
- Open-Meteo Historical Weather API integration
- Caching system with configurable TTL
- Error handling and retry logic

## [0.1.0] - 2025-11-03

### Added
- Initial release
- Basic forecast support (NOAA API)
- Current conditions support
- MCP server implementation
- Claude Code integration

[Unreleased]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.9...HEAD
[1.25.9]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.8...v1.25.9
[1.25.8]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.7...v1.25.8
[1.25.7]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.6...v1.25.7
[1.25.6]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.5...v1.25.6
[1.25.5]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.4...v1.25.5
[1.25.4]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.3...v1.25.4
[1.25.3]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.2...v1.25.3
[1.25.2]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.1...v1.25.2
[1.25.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.25.0...v1.25.1
[1.25.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.24.0...v1.25.0
[1.24.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.23.0...v1.24.0
[1.23.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.20.0...v1.21.0
[1.20.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.14.0...v1.18.0
[1.14.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.11.1...v1.13.0
[1.11.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.11.0...v1.11.1
[1.11.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.8.2...v1.11.0
[1.8.2]: https://github.com/weather-mcp/weather-mcp/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.6.1...v1.7.1
[1.6.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.4.0...v1.6.1
[1.4.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/weather-mcp/weather-mcp/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/weather-mcp/weather-mcp/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/weather-mcp/weather-mcp/compare/v0.4.0...v1.0.0
[0.4.0]: https://github.com/weather-mcp/weather-mcp/compare/v0.2.0...v0.4.0
[0.2.0]: https://github.com/weather-mcp/weather-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/weather-mcp/weather-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/weather-mcp/weather-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/weather-mcp/weather-mcp/releases/tag/v0.1.0
