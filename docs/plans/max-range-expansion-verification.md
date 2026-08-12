# Max-Range Expansion — Live Verification (2026-07-16)

**Status:** COMPLETE — all three decisions (D1, D2, D3) verified working live.
**No defects found; no code changes required.** Two observations recorded below
(O1, O2) — neither is a regression from this branch and neither blocks merge.
**Parent:** `docs/max-range-expansion-plan.md` (D1 marine, D2 historical limit,
D3 imagery frames + nowcast); implementation tracker
`docs/max-range-expansion-implementation-plan.md`
**Branch:** `feat/max-range-expansion` @ `db26f78` (clean tree; `dist/` rebuilt
2026-07-16 15:29, confirmed newer than every file under `src/` — the MCP
servers under test ran this build)
**Method:** Live MCP calls through the configured `weather-local` server
(imperial, all tools) pointed at the local `dist/index.js`, plus direct handler
invocation for output-size measurement. Gate re-run: `npm run build` (0 errors),
`npx vitest run tests/unit` (1,218 passed / 43 files, 1.04 s).

## Verdict

All three features behave exactly as designed. Most importantly, the
null-padding trap the plan was written around — the class of bug that has never
been visible in the mocked suite — is genuinely handled on both tools:
`get_marine_conditions` at `forecast_days: 16` and `get_air_quality` at
`forecast_days: 7` each render only the days the model really provides, trim the
tail with an explicit note, and produce **no** phantom "0 m (Calm)" or
"AQI 0 (Good)" days.

## Fix-by-fix results

### D1 — Marine `forecast_days` + full-range display ✅

Test point 41.0, −70.0 (open water south of Cape Cod).

| Check (from acceptance criteria) | Result |
|---|---|
| `forecast: true, forecast_days: 16` | **9 real days** rendered (Jul 16–24), every day with real values |
| Trailing null days | Trimmed, with footer: *"The marine model provided no data for the final 7 requested day(s)."* |
| No null-derived "0 m (Calm)" days | Confirmed — none present |
| Interior-null guarding | Confirmed live: **Sat Jul 18** has no swell data; the swell lines are **omitted**, not zero-filled. This is the exact bug class the plan targeted, caught in real data. |
| `forecast_days: 17` | Rejected: `Invalid forecast_days: 17. Must be between 1 and 16.` |
| `forecast_days: 0` | Rejected: `Invalid forecast_days: 0. Must be between 1 and 16.` |
| Default (param omitted) | 5 days — unchanged |
| Request no longer contains `hourly=` | Confirmed — no `hourly` in `buildMarineParams` (`src/services/openmeteo.ts`) |
| "N hours available" line removed | Confirmed — string absent from `src/` |
| Current conditions unaffected | Confirmed — full current block (waves, wind waves, swell, currents) still renders |

Model horizon was **9 days** on this date/point, consistent with the plan's
"~10 days" live finding. The 16-day ceiling with trimming is behaving as the
design intended: it tracks whatever the model actually serves rather than
hardcoding today's horizon.

### D2 — Historical hourly `limit` ceiling 500 → 744 ✅

Test point 42.36, −71.06 (Boston), range 2026-06-01 → 2026-07-01 (31 days).

| Check | Result |
|---|---|
| `limit: 744` over a 31-day range | Header reads **"Number of observations: 744"**; output runs 6/1 00:00 → 7/1 23:00 (all 744 hours) |
| No "(of M available)" truncation note at 744 | Confirmed — note absent, nothing silently dropped |
| `limit: 745` | Rejected: `Invalid limit: 745. Must be between 1 and 744.` |
| Truncation still disclosed below the max | `limit: 3` → **"Number of observations: 3 (of 744 available)"** |
| Hourly-only semantics documented | `docs/TOOLS.md:176` states the hourly-only scope and the daily-path exception; schema description matches |

### D3 — Imagery `detail="full"` all frames; nowcast defensive ✅

Test point 42.36, −71.06, `type: precipitation, animated: true`.

| Check | Result |
|---|---|
| `detail: "full"` with 13 frames | Lists **all 13** frames (embedded Markdown images), 17:30Z → 19:30Z at 10-min steps |
| `detail: "standard"` | Keeps 3-of-13 (frames 1, 7, 13) as URLs |
| Escape-hatch note | *"Showing 3 of 13 frames for brevity — use detail="full" for all frames"* — matches `get_forecast`'s disclosure contract |
| Nowcast frames live | **Still empty upstream.** Direct check of `api.rainviewer.com/public/weather-maps.json`: `past: 13, nowcast: []` — same as the plan's 2026-07-16 finding |
| Empty nowcast handled as normal | Confirmed — output unchanged, no error, no empty section |
| Nowcast not advertised in tool description | Correct per D3 — the schema description mentions frames only, not nowcast |

**Nowcast caveat (carried forward, not a defect):** because RainViewer's feed
has been empty on every check, the *non-empty* nowcast path cannot be verified
live. It is covered by unit tests only (`tests/unit/rainviewer-nowcast.test.ts`,
4 tests): empty array, absent property, 3 frames appended after past frames in
order and labeled `+10/+20/+30 min forecast`, and non-animated returning only
the latest past frame. This is exactly the defensive posture D3 called for. If
the feed returns, re-verify live before advertising nowcast in the tool
description.

## Observations (no fix applied)

### O1 — At `limit` ≳ 490, historical output exceeds MCP client token caps

**Not a regression — the pre-existing 500 ceiling already crossed this line.**

Measured directly (Boston, 31-day hourly range, ~205 chars/observation):

| `limit` | chars | est. tokens | vs. 25k client cap |
|---|---|---|---|
| 168 (default) | 34,083 | ~8.5k | ok |
| 500 (**old** ceiling) | 101,821 | ~25.5k | already over |
| 744 (new ceiling) | 152,682 | ~38.2k | over |

In this session, `limit: 744` came back as *"result (152,682 characters across
6,822 lines) exceeds maximum allowed tokens"* and was diverted to a file rather
than returned inline. The data was complete and correct — verified by grepping
the diverted file — but a client with a 25k cap cannot consume it directly.

Why this is not a blocker: the old 500 ceiling was *already* ~25.5k tokens, so
this branch does not introduce the overflow, it extends a range that was
partly unusable inline to begin with. The feature does what D2 specified —
the tail is no longer *silently* dropped, which was the actual defect. Users
who need the full 744 hours are opting into a large payload knowingly, and
clients degrade gracefully (divert to file) rather than truncating.

Worth considering for `docs/output-completeness-plan.md` (Tier 2), not here:
either note the payload size in the `limit` schema description, or let the
handler mention that very large ranges may be delivered out-of-band.

### O2 — Historical truncation note lacks an escape-hatch pointer

Minor consistency gap. The imagery note names its escape hatch:

> *Showing 3 of 13 frames for brevity — use detail="full" for all frames*

The historical note discloses truncation but not the remedy:

> **Number of observations:** 3 (of 744 available)

The plan cites `get_forecast`'s disclosure contract as the model for D3, and
D2's own rationale is about not losing data silently — so "(of 744 available)"
is arguably half the contract: the user learns data is missing but not that
`limit` is the lever. Pre-existing wording, untouched by this branch, and
cosmetic. Candidate for the Tier 2 output-completeness pass.

## Also spot-checked (unreleased air-quality work carried on this branch)

`get_air_quality` at 42.36, −71.06, `forecast: true, forecast_days: 7`:

- 5 dated day sections rendered (Jul 16–20) with 6-hour period ranges
- Footer: *"Forecast covers 103 hours across 5 day(s). Each period's category
  reflects its peak AQI."* + *"The air quality model provided no data for the
  final 50 requested hour(s)."*
- **No "AQI 0 (Good)" hours** — the null-coercion fix holds at the 7-day max
- Past hours correctly skipped (today starts at the 3 PM observation hour)
- `forecast_days: 8` rejected: `Invalid forecast_days: 8. Must be between 1 and 7.`

## Gate

| Gate | Result |
|---|---|
| `npm run build` | 0 errors |
| `npx vitest run tests/unit` | **1,218 passed** (43 files), 1.04 s |
| Targeted suites (`rainviewer-nowcast`, `marine-forecast`, `imagery-handler`) | 48 passed |
| CHANGELOG (Unreleased) | Covers all three decisions + both null-padding fixes |
| `docs/TOOLS.md` | Updated for marine `forecast_days` (1-16), historical `limit` (1-744, hourly-only), imagery `detail="full"` |

Live-network integration tests were not used for judgment, per the known
flakiness noted in `docs/testing/` and project memory.

## Conclusion

`feat/max-range-expansion` meets every acceptance criterion in
`docs/max-range-expansion-plan.md`. The branch is ready to merge as-is. The two
observations above are follow-up candidates for
`docs/output-completeness-plan.md`, not defects in this work.
