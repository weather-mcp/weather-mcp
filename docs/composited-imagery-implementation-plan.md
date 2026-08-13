# Composited Weather Imagery (MCP image content) — Implementation Plan

**Status:** READY (2026-08-13)

Execution plan for `docs/composited-imagery-plan.md` (the WHAT/WHY); rules live
in `docs/orchestration-playbook.md`.

## Kickoff

A fresh Opus session should run this with:

```
/run-plan docs/composited-imagery-implementation-plan.md
```

Or, equivalently: read `docs/composited-imagery-plan.md` (design — especially
its "Settled decisions & verification results" section, which resolves D1–D7),
`docs/orchestration-playbook.md` (rules of engagement), and this file, then
execute the task graph below — green baseline, one subagent per task, review
the diff, run the gate yourself, commit, tick the tracker, push.

The gate after every task, from `weather-mcp/`:

```bash
npm run build     # 0 errors
npm test          # 100% pass
npm audit         # no high/critical
```

**Gate caveat (standing):** several files under `tests/integration/` make
**live network calls** and flake independently (six as of v1.18.0 — see the
repo memory / prior plans). If the gate goes red only in those files, re-run
before suspecting the diff. **T6 adds another file in that category** and must
follow the same tolerant-of-flake convention.

## Scope & branch

**Branch:** `feat/composited-imagery`. Target release: **TBD** (CHANGELOG
entries go under `[Unreleased]`; the version bump is a release step).

In scope: the design plan's settled D1–D7 — the `composite` opt-in parameter on
`get_weather_imagery`, the pure compositing utilities, the GIBS basemap
service (land/water base + reference-features outlines), the location-marker
crosshair, the `[text, image]` content return with graceful text-only
degradation, `pngjs` promotion to a runtime dependency, caching, tests, and
docs.

### Deferred / out of scope

| Item | Reason |
|------|--------|
| Satellite image-content return | D7 — GeoColor is already a full picture; consistency return deferred as a follow-up planning idea. |
| Compositing animation frames | D3 — payload budget; latest frame only. Animation stays URL-based and the interactive-map link covers the animated case. |
| In-image attribution text | D4 — needs a font rasterizer dependency; rejected. Attribution lives in the text block. |
| `Reference_Labels_15m` place labels | Dead upstream — 404s at every probed tile (verified 2026-08-13). |
| Lightning/wildfire overlay maps | D7 — explicitly a different feature. |
| Configurable base provider | D2 settled on a single provider (GIBS); revisit only if GIBS terms change. |

## Findings that shape the graph

Spot-checks against the code and live endpoints, reconciled into the tasks:

- **`prependLocationLine`'s generic constraint requires `text` on every
  content block** (`src/utils/locationResolver.ts:65–67`:
  `T extends { content: Array<{ type: string; text: string }> }`). An image
  block has no `text`, so the composite return **does not compile** until the
  constraint widens to `text?: string`. The runtime guard already checks
  `content[0]?.type === 'text'`, so behaviour is unchanged. Mechanical
  consequence of an in-scope change (playbook §Task rules) — baked into T4.
  The handler's own return type (`weatherImageryHandler.ts:36`) widens the
  same way.
- **GIBS tile matrix sets are layer-specific.** `src/services/gibs.ts:25`
  hardcodes `GoogleMapsCompatible_Level7` for GeoColor; the base layers need
  **`GoogleMapsCompatible_Level9`** (`OSM_Land_Water_Map`) and
  **`GoogleMapsCompatible_Level13`** (`Reference_Features_15m`) — a wrong
  matrix returns HTTP 400 `InvalidParameterValue TILEMATRIXSET` (verified
  live). The new basemap service must carry per-layer matrix constants, not
  reuse the GeoColor one. WMTS REST path order is `{z}/{row=y}/{col=x}`.
- **Radar tiles carry their own tile address.** RainViewer frame URLs embed
  `/512/{z}/{x}/{y}/` (zoom 6 location tiles, zoom 4 global —
  `src/services/rainviewer.ts:74–113`), and the parse regex is proven in
  `scripts/capture-examples.mjs:371`. The composite path parses the latest
  frame's URL rather than recomputing tile math. Base children at z+1 = 7 are
  within both base layers' matrix maxima for both zoom levels.
- **The features layer is transparent.** The capture script's stitcher
  (`fetchOsmBase`) forces alpha to 255 — correct for an opaque base, wrong for
  stitching `Reference_Features_15m`, whose transparency must survive until it
  is blended onto the base. The new stitch utility must preserve RGBA;
  opacity-forcing is a separate explicit step.
- **`pngjs` is currently a devDependency** (`package.json:87`), used by the
  capture script. D5 promotes it; it is pure JS with zero transitive deps.
- **`Cache<T>` is generic** (`src/utils/cache.ts:25`) — `Buffer` values are
  fine. Tile buffers are ~2–8 KB and composites ~25–91 KB (live-measured), so
  memory stays modest under the default 1000-entry LRU.
- **Composite failures are garnish, not contract.** ACIS/NIFC precedent: the
  basemap/composite path may throw plain `Error`s; the handler catches
  everything, logs a warning, and returns the normal URL-based text output
  with a one-line note. No `ApiServiceName` union widening is needed (unlike
  METAR, nobody explicitly requested a *service* — they requested imagery,
  which still arrives).
- **The default-output no-change guarantee has a test suite.**
  `tests/unit/imagery-handler.test.ts` (mocks the rainviewer module) and
  `tests/unit/gibs.test.ts` must pass **untouched** after T4 — a request
  without `composite: true` produces byte-identical output to `main`.
- **Live fixtures:** Miami at radar zoom 6 is tile `6/17/27`; the verified
  sample composites (plain and with features) live in the 2026-08-13
  verification session record. Measured payloads: 24–91 KB PNG, 32–121 KB
  base64.

## Task graph

### Phase 1 — Foundations

**T1 — Promote `pngjs` to a runtime dependency** (`haiku`)

- Files: `package.json`, `package-lock.json`
- Move `pngjs` (`^7.0.0`) from `devDependencies` to `dependencies` and run
  `npm install` to regenerate the lock. No code changes.
- Acceptance: `pngjs` listed under `dependencies`; full gate green.
- Commit: `chore: Promote pngjs to a runtime dependency`
- Depends on: — · **parallel-safe with T2** (disjoint files)

**T2 — Pure PNG compositing utilities** (`sonnet`)

- Files: `src/utils/composite.ts` (new), `tests/unit/composite.test.ts` (new)
- Pure module — no I/O, no caching, no logging. Port and generalize the proven
  logic from `scripts/capture-examples.mjs:314–358`:
  - `stitch512(tileBuffers: [Buffer, Buffer, Buffer, Buffer]): PNG` — four
    256px tiles (TL, TR, BL, BR order) into one 512px RGBA image,
    **preserving alpha** (see Findings — the features layer is transparent).
  - `flattenOpaque(png: PNG): void` — force alpha 255 (applied to the base
    layer only).
  - `blendOnto(base: PNG, overlay: PNG): void` — source-over alpha blend
    (verbatim from the capture script).
  - `drawMarker(png: PNG, px: number, py: number): void` — small
    high-contrast crosshair (dark core, 1px light outline) at the pixel,
    clipped at edges.
  - `latLonToTilePixel(lat, lon, z, x, y, size = 512): { px, py }` — Web
    Mercator position of a coordinate *within* a given tile.
  - `parseRadarTileUrl(url: string): { z, x, y } | null` — the
    `/512/{z}/{x}/{y}/` regex from the capture script.
  - `encodePng(png: PNG): Buffer` and an exported
    `MAX_COMPOSITE_BYTES = 1_000_000` cap constant (defense-in-depth; measured
    real-world max is ~91 KB).
- Acceptance: full gate green. New tests are deterministic and pure — fixture
  tiles are **generated programmatically with pngjs in the test** (no binary
  fixtures): quadrant placement (distinct solid-color tiles land in the right
  corners), alpha preservation through `stitch512`, `flattenOpaque`,
  `blendOnto` against hand-computed pixel values (including a=0 short-circuit
  and a=255 replacement), marker pixels present/clipped at a corner,
  `latLonToTilePixel` for known coordinates (Miami 25.7617,-80.1918 in tile
  6/17/27), and the URL-parse matrix (valid URL, no match, global zoom-4
  shape).
- Commit: `feat: Add pure PNG compositing utilities`
- Depends on: — · **parallel-safe with T1** (disjoint files)

**T3 — GIBS basemap service + cache TTLs** (`sonnet`)

- Files: `src/services/basemap.ts` (new), `src/config/cache.ts`,
  `tests/unit/basemap.test.ts` (new)
- `BasemapService` (module-singleton like `gibsService`), keyless:
  - Layer constants with **per-layer matrix sets** (see Findings):
    `OSM_Land_Water_Map` @ `GoogleMapsCompatible_Level9`,
    `Reference_Features_15m` @ `GoogleMapsCompatible_Level13`; WMTS REST URL
    shape `…/wmts/epsg3857/best/{layer}/default/{matrix}/{z}/{y}/{x}.png`.
  - `getBaseComposite(z, x, y): Promise<PNG>` — for the 512px tile at
    (z, x, y): fetch the four z+1 children of each layer (8 tile fetches,
    axios `arraybuffer`, descriptive User-Agent per the METAR precedent:
    `weather-mcp/<version> (+https://github.com/weather-mcp/weather-mcp)`),
    stitch each layer via T2's `stitch512`, `flattenOpaque` the land/water
    base, `blendOnto` the features layer, return the decoded PNG.
  - **Raw tile buffers cached individually** keyed `layer/z/y/x` with a new
    `CacheConfig.ttl.basemapTiles = 24 * HOUR` (near-static reference layers —
    rationale comment per house style). Add
    `CacheConfig.ttl.compositeImage = 10 * MINUTE` in the same edit (used by
    T4; radar frames are immutable per timestamp and the feed cadence is
    ~10 min).
  - Failures throw plain `Error`s (garnish precedent — see Findings); no retry
    ladder needed (the handler degrades to text-only).
- Acceptance: full gate green. Mocked-axios unit tests (generated tiny PNG
  buffers): correct URLs including both matrix sets and `{z}/{y}/{x}` order;
  stitched 512×512 result with features visible over the base; second call
  serves all 8 tiles from cache (assert one round of HTTP calls); a failed
  tile fetch rejects (no partial composite); `tests/unit/config.test.ts`
  untouched (it asserts individual keys, not a snapshot).
- Commit: `feat: Add GIBS basemap fetch-and-stitch service`
- Depends on: T2 · **parallel-safe with T1** (disjoint files)

### Phase 2 — Handler and registration

**T4 — `composite` parameter returning `[text, image]`** (`opus`)

- Files: `src/handlers/weatherImageryHandler.ts`, `src/types/imagery.ts`,
  `src/utils/locationResolver.ts`, `src/index.ts`
- Types: add `composite?: boolean` to `WeatherImageryParams` and the handler
  args; define an exported content-block union
  (`{ type: 'text'; text: string } | { type: 'image'; data: string;
  mimeType: string }`) for the handler return. Widen `prependLocationLine`'s
  generic constraint to `Array<{ type: string; text?: string }>` (mechanical —
  see Findings; runtime guard already correct).
- Validation: `composite` must be boolean (mirror the `animated` check).
- Handler behaviour (`composite: true`):
  - Radar/precipitation only. `type: 'satellite'` + `composite` appends a
    one-line note ("composite rendering is available for radar/precipitation
    only") to the normal satellite output — a note, **not** an error.
  - Composite the **latest frame only** (D3). With `animated: true`, frames
    stay URL-based and a note says the attached image is the latest frame.
  - Pipeline: check the composite cache
    (key `framePath|z/x/y|markerPx`, `CacheConfig.ttl.compositeImage`) →
    `parseRadarTileUrl` on the latest frame URL → fetch the overlay tile
    (axios `arraybuffer`, API timeout config) → `basemapService
    .getBaseComposite(z, x, y)` → `blendOnto` radar → `drawMarker` at the
    requested coordinates via `latLonToTilePixel` → `encodePng` → enforce
    `MAX_COMPOSITE_BYTES` (over-cap → degrade, note) → base64.
  - Return `content: [text, image]` where the image block is
    `{ type: 'image', data: <base64>, mimeType: 'image/png' }`. The text block
    gains: a line noting the attached composited map (frame timestamp, zoom),
    and the attribution lines — radar © RainViewer plus the GIBS
    acknowledgment ("Imagery provided by services from NASA's Global Imagery
    Browse Services (GIBS), part of NASA's Earth Science Data and Information
    System (ESDIS)").
  - **Any failure in the composite path** (parse, fetch, decode, cap) →
    `logger.warn` and return the normal URL-based text output with a one-line
    "composite unavailable" note. The tool call itself never fails because
    compositing failed.
- Registration (`src/index.ts:508–530`): add the `composite` property to the
  schema — description along the lines of: *"Return a finished radar map (the
  radar overlay composited onto a NASA GIBS base map with a location marker)
  as an MCP image content block alongside the text. Radar/precipitation only;
  the latest frame only. The assistant always receives and can describe the
  image; whether it displays inline depends on the client. Default: false."*
  — and extend the tool description's composite sentence accordingly. Do not
  promise inline rendering (client survey finding).
- Acceptance: full gate green. **`tests/unit/imagery-handler.test.ts` and
  `tests/unit/gibs.test.ts` pass with zero edits** — the no-change guarantee
  for requests without `composite`. Manual spot-check via the built dist: a
  `composite: true` call for Miami returns a text block plus a base64 image
  block that decodes as a 512×512 PNG.
- Commit: `feat: Add composited radar imagery as MCP image content`
- Depends on: T1, T3

### Phase 3 — Tests

**T5 — Handler unit tests for the composite branch** (`sonnet`)

- Files: `tests/unit/imagery-composite.test.ts` (new)
- Model on `tests/unit/imagery-handler.test.ts` (module mocks for rainviewer /
  basemap / the overlay fetch; generated fixture tiles). Cover:
  `composite: true` returns exactly `[text, image]` with
  `mimeType: 'image/png'` and base64 data that pngjs decodes to 512×512;
  omitted/false `composite` returns the text-only shape **byte-identical** to
  the pre-branch formatter output for the same fixtures; `animated: true` +
  `composite` composites only the latest frame and appends the note;
  satellite + `composite` → note, no image block, no basemap call; basemap
  failure → text-only + "composite unavailable" note, no throw; oversize
  encode (mock the cap) → degradation note; marker pixels present at the
  expected coordinates; both attribution lines present in the text block;
  composite cache hit skips the second fetch round.
- Acceptance: new tests deterministic, no live calls; full gate green.
- Commit: `test: Cover composite imagery branch and degradation paths`
- Depends on: T4 · **parallel-safe with T6** (disjoint files)

**T6 — Integration tests: mocked end-to-end + tolerant live smoke** (`sonnet`)

- Files: `tests/integration/imagery-composite.test.ts` (new)
- Two blocks: (1) mocked HTTP against the **real** basemap service + handler
  end to end — generated PNG tile bodies for both GIBS layers and the radar
  overlay, asserting the full pipeline produces a valid composite and that a
  single GIBS 400 (`InvalidParameterValue`) degrades to text-only; (2) one
  live smoke test — real RainViewer frame + real GIBS tiles for one location,
  assert the image block decodes to a 512×512 PNG, generous timeout, **never
  fail the suite on a network error** (tolerant-of-flake convention).
- **This is a new live-network integration file** — say so in the file header
  so the gate caveat stays discoverable.
- Acceptance: mocked block deterministic; live block tolerant; full gate green
  (re-run once if only live files are red).
- Commit: `test: Add composite imagery integration coverage`
- Depends on: T4 · **parallel-safe with T5** (disjoint files)

### Phase 4 — Live verification and docs

**T7 — Live sweep + documentation checklist** (`opus`)

- Files: `CHANGELOG.md`, `README.md`, `docs/TOOLS.md`, `CLAUDE.md`,
  `docs/planning/README.md`, `docs/composited-imagery-plan.md` (→ moved),
  this file (→ moved)
- **Live sweep against the built dist** (drivers need `process.exit(0)` — see
  repo memory; run serially, not in parallel):
  - A location with active precipitation: `composite: true` returns
    `[text, image]`; decode and **visually inspect** the PNG (base map,
    radar echoes, marker, features outlines all present).
  - An echo-free location: base map + marker still render (no blank square).
  - `animated: true` + `composite`: URL frames plus one latest-frame image
    and the note.
  - `satellite` + `composite`: note, no image.
  - A repeat call: composite cache hit (one upstream fetch round in logs).
  - A no-`composite` call **byte-identical** to `main`'s output for the same
    location/frame (allowing for frame-timestamp drift — compare structure if
    the feed advances).
  - Record observed payload sizes.
- Docs:
  - CHANGELOG entry under `[Unreleased]`.
  - README: tool table row for `get_weather_imagery` (composite option), and
    the attribution/data-sources section gains the GIBS acknowledgment.
  - `docs/TOOLS.md`: the `composite` parameter, what the image contains, the
    client-rendering caveat, the latest-frame-only rule.
  - `CLAUDE.md`: `basemap.ts` + `composite.ts` in the architecture tree; a
    status blurb for the release; bump the tool-behaviour notes for
    `get_weather_imagery`.
  - `docs/planning/README.md`: flip the "Composited imagery via MCP image
    content blocks" row to ✅ shipped; add a 💡 follow-up row for the
    satellite image-content return (deferred D7).
  - Mark `docs/composited-imagery-plan.md` status `IMPLEMENTED`, then **move
    the plan set (design plan + this file) to `docs/plans/`** and update every
    reference (playbook convention).
- Acceptance: live sweep recorded in the tracker (table like the METAR plan's
  T8 record); full gate green; all doc boxes done.
- Commit: `docs: Record composited radar imagery`
- Depends on: T5, T6

## Assumptions to confirm before `/run-plan`

- **A1 — parameter name.** The design left the surface open
  (`render: "composite"` vs other). Chosen: **`composite: boolean`** (default
  `false`) — a single new switch, mirrors `animated`, no enum to grow. Flip to
  a `render` enum before running if you expect more render modes later.
- **A2 — plain `Error`s in the composite path.** No `ApiServiceName` union
  widening; the composite is garnish (ACIS/NIFC precedent) and the handler
  degrades to the normal URL output on any failure.
- **A3 — `prependLocationLine` constraint widening** is treated as a
  mechanical consequence, not new scope.
- **A4 — payload cap 1 MB** (PNG bytes, pre-base64). Measured worst case is
  ~91 KB; the cap is defense-in-depth only.
- **A5 — CHANGELOG under `[Unreleased]`**; the version bump is a release step.
- **A6 — tile fetches use axios** with the METAR-style descriptive
  User-Agent, keeping service-layer consistency (the capture script's
  bare `fetch` stays as-is).
- **A7 — no-change guarantee.** `tests/unit/imagery-handler.test.ts` and
  `tests/unit/gibs.test.ts` pass untouched after T4; if either needs editing,
  stop and ask.

## Progress Tracker

- [ ] T1 — Promote pngjs to a runtime dependency (`haiku`)
- [ ] T2 — Pure PNG compositing utilities (`sonnet`)
- [ ] T3 — GIBS basemap service + cache TTLs (`sonnet`)
- [ ] T4 — `composite` parameter returning `[text, image]` (`opus`)
- [ ] T5 — Handler unit tests for the composite branch (`sonnet`)
- [ ] T6 — Integration tests: mocked end-to-end + tolerant live smoke (`sonnet`)
- [ ] T7 — Live sweep + documentation checklist (`opus`)

**Done when:** every box is ticked with its commit SHA, the full gate
(`npm run build`, `npm test`, `npm audit`) is green, the T7 live sweep is
recorded (including the visual inspection of a real composite and the
no-`composite` no-change check), `tests/unit/imagery-handler.test.ts` and
`tests/unit/gibs.test.ts` still pass unedited, and
`docs/composited-imagery-plan.md` is marked `IMPLEMENTED` and the plan set
moved to `docs/plans/`. Opening the PR is the human's call.
