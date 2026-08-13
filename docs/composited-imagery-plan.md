# Composited Weather Imagery (MCP image content) — Design Plan

**Status:** SETTLED (2026-08-13) — all design decisions resolved and
upstream-verified; see "Settled decisions & verification results" below.
Execution plan: `docs/composited-imagery-implementation-plan.md`.
**Parent:** user request (2026-08-13, examples/imagery discussion); planning
index row "Composited imagery via MCP image content blocks".
**Target release:** TBD
**Branch (for /impl-plan):** `feat/composited-imagery`
**Upstream verification:** fully verified 2026-08-13 —
RainViewer overlay tiles, tile stitching, and pure-JS PNG compositing proven
in `scripts/capture-examples.mjs`; GIBS base layers, licensing, payload sizes,
and the MCP image-content client survey verified live (see below).

## What / Why

`get_weather_imagery` returns tile **URLs**. Three problems compound for a
human actually trying to *see* the weather:

1. RainViewer radar tiles are **transparent precipitation overlays** — with no
   base map underneath they render as geography-free colored blobs, and a tile
   over dry skies is a fully blank square that reads as a broken link.
2. RainViewer frames **expire in ~2 hours**, so any saved URL rots almost
   immediately.
3. Text-only output can't exploit the fact that modern MCP clients (Claude
   Code, Claude Desktop, and others) render **image content blocks**
   (`{ type: "image", data: <base64>, mimeType: "image/png" }`) inline — the
   assistant could literally show the user a finished weather map.

Fix: give `get_weather_imagery` the option to return a **finished picture** —
the radar/precipitation overlay composited onto a real base map — as an MCP
image content block alongside the existing text.

The v1.18.x interim mitigations already shipped: the output appends an
interactive-map link (RainViewer live map / NASA Worldview, formats verified
2026-08-13), and the examples pipeline composites snapshots offline. This plan
is the third step: compositing inside the server itself.

## Proven mechanics (2026-08-13, in `scripts/capture-examples.mjs`)

The compositing pipeline is already demonstrated working offline, pure-JS:

- RainViewer tile path carries its own web-mercator address
  (`…/512/{z}/{x}/{y}/{color}/{opts}.png`), so the matching base tiles need no
  extra geo math.
- OSM serves 256px tiles; fetching the four z+1 children and stitching them
  yields a pixel-exact 512px base — no resampling.
- `pngjs` (pure JS, zero native deps) decodes both layers; source-over alpha
  blending is ~10 lines; output re-encodes to PNG. A 512px composite lands
  around 280 KB (≈370 KB base64).

## Design decisions to settle (D1–D7) — RESOLVED, see "Settled decisions" below

- **D1 — Opt-in surface.** A new parameter (`render: "composite"`? reuse
  `detail: "full"`?) vs. always-on. Leaning: explicit opt-in parameter;
  base64 payloads are large and text-only agents shouldn't pay for them.
  Client capability can't be detected server-side, so the schema description
  must say "only request this if you can display images".
- **D2 — Base layer & licensing.** OSM raster tiles work (proven) but the OSM
  tile usage policy is aimed at light/interactive use — a popular MCP server
  proxying OSM tiles on every call is likely outside it. Candidates:
  Carto/OSM-derivative CDNs (attribution + terms check), NASA GIBS raster
  layers (keyless, government, fits the project's zero-key data model; base
  imagery rather than a street map), or making the base fetch provider-
  configurable. **This is the main open question — resolve before /impl-plan,
  and verify the chosen provider's terms live.**
- **D3 — Payload budget.** One 512px composite ≈ 370 KB base64. Animated
  requests must NOT composite 13 frames (≈5 MB). Composite the latest frame
  only; animation stays URL-based (and the interactive-map link already covers
  the animated case for humans).
- **D4 — Content shape.** MCP allows mixed content arrays; return
  `[text, image]` so text-only clients degrade gracefully (they already ignore
  image blocks per protocol). Attribution line (radar © RainViewer, base ©
  provider) must be in the text block AND ideally drawn into the image margin.
- **D5 — Dependency posture.** `pngjs` as a **runtime** dependency (pure JS,
  zero transitive deps — same bar astronomy-engine met in v1.16). If the base
  layer is JPEG (GIBS serves JPEG for imagery layers), add `jpeg-js` or prefer
  a PNG-serving layer to keep it to one decoder.
- **D6 — Caching.** Base tiles are near-static — cache aggressively (24h+,
  keyed z/x/y). Radar overlays follow the existing RainViewer frame cadence
  (~10 min). Composite output itself: cache keyed on (frame timestamp, tile),
  short TTL.
- **D7 — Scope.** Radar/precipitation only in v1. Satellite (GIBS GeoColor)
  already *is* a full picture — needs no base layer, but could gain the same
  image-content return for consistency; decide in review. Lightning/wildfire
  overlay maps are explicitly out (different feature).

## Open verification items (before /impl-plan) — ALL VERIFIED 2026-08-13, see below

1. Survey MCP image-content support in target clients (Claude Code, Claude
   Desktop, Cursor, others from `docs/CLIENT_SETUP.md`) — confirm image blocks
   render and what size limits apply.
2. Settle D2 with a live terms/availability check of the chosen base provider.
3. Measure real payload sizes across a few weather situations; confirm client
   token/size ceilings.

## Settled decisions & verification results (2026-08-13)

All D1–D7 decisions and the three open verification items were resolved in a
live verification session (maintainer sign-off on the two judgment calls):

- **D1 — Opt-in surface → settled:** new boolean parameter `composite`
  (default `false`) on `get_weather_imagery`, valid for `radar`/`precipitation`
  only. Schema description states the assistant can always *see* the image and
  describe it; inline display depends on the client.
- **D2 — Base layer → settled: NASA GIBS.** Verified live:
  - **OSM ruled out** — the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
    prohibits distributed apps / bulk-proxied use.
  - **Carto ruled out** — tiles serve openly, but the
    [basemap-styles license](https://github.com/CartoDB/basemap-styles/blob/master/LICENSE.md)
    restricts the CDN to CARTO enterprise customers and non-profit grants.
  - **GIBS confirmed** — keyless, no formal rate limits, imagery freely usable
    with the GIBS acknowledgment line; EPSG:3857 WMTS REST tiles
    (`gibs.earthdata.nasa.gov/wmts/epsg3857/best/…`). Fits the zero-key model,
    and the repo already ships a GIBS client (`src/services/gibs.ts`).
  - **Base composition (maintainer-approved):** `OSM_Land_Water_Map`
    (PNG, `GoogleMapsCompatible_Level9`) as the opaque base, plus
    `Reference_Features_15m` (PNG, `GoogleMapsCompatible_Level13`)
    coastline/border outlines blended over it. `Reference_Labels_15m` is dead
    upstream (404s at every probed tile) — no labels layer.
  - **Location marker (maintainer-approved scope addition):** a small
    high-contrast crosshair drawn at the requested coordinates in the
    composite utility (pure pixel work).
- **D3 — Payload budget → settled:** latest frame only; animation stays
  URL-based. Live-measured composites at radar zoom 6 (base + features +
  radar): **24–91 KB PNG / 32–121 KB base64** across Seattle, Miami, London,
  Kansas City (echo-free), and Tokyo — ~5–10× below the plan's 370 KB estimate
  (the GIBS land/water layer compresses far better than street tiles), and far
  under the ~3.75 MB base64 API image ceiling. A defensive size cap with
  URL-only fallback still applies.
- **D4 — Content shape → settled:** `[text, image]` mixed content array.
  Attribution (radar © RainViewer; NASA GIBS acknowledgment) lives in the text
  block only — drawing text into the image margin would require a font
  rasterizer dependency, rejected as against the lightweight posture.
- **D5 — Dependency posture → settled:** promote `pngjs` (already a
  devDependency for the capture script) to a runtime dependency. Both GIBS
  layers serve PNG, so **no JPEG decoder is needed**.
- **D6 — Caching → settled:** base/feature tiles 24 h TTL (near-static);
  composite output keyed on (frame path, z/x/y, marker pixel), short TTL
  (frames are immutable per timestamp; a 10-minute TTL matches the radar
  cadence).
- **D7 — Scope → settled:** radar/precipitation only. Satellite image-content
  return deferred as a follow-up idea.
- **Client survey (verification item 1):** MCP image content blocks are
  protocol-standard; `[text, image]` degrades gracefully in text-only clients.
  The model always receives the image (it can describe the actual weather
  pattern). User-facing inline rendering varies: Claude Code renders it;
  Claude Desktop currently collapses tool results behind an expander
  ([claude-code#53256](https://github.com/anthropics/claude-code/issues/53256));
  claude.ai web does not inline it in the final response. The schema
  description must not promise inline display.
- **Legibility check:** sample composites (Miami storm) visually verified —
  storm cells, Florida coastline, Keys, and Cuba's outline all clearly
  readable; the features layer materially improves geographic context for
  ~30 KB.

## Rough shape (post-decisions)

- `src/services/basemap.ts` — base-tile fetch + stitch + cache
- `src/utils/composite.ts` — pure decode/blend/encode (port of the
  capture-script logic, unit-testable with fixture tiles)
- `weatherImageryHandler` — opt-in branch returning `[text, image]`
- Tests: fixture-tile compositing (deterministic), payload-size bounds,
  schema/param validation; no live tiles in unit tests

## Rejected alternatives

- **Static-map third-party services** (keyless ones are rate-limited or
  ToS-hostile; keyed ones break the zero-key model).
- **Client-side layering instructions** (return base URL + overlay URL and ask
  the AI to describe them) — no client can composite images itself today.
- **sharp/canvas native deps** — heavier install, platform builds, against the
  project's lightweight posture; pure-JS is proven sufficient at 512px.
