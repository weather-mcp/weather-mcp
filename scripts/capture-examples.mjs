/**
 * Example-output capture harness.
 *
 * Spawns the LOCAL built server (dist/index.js) as a real MCP stdio subprocess
 * (same pattern as stress-harness.mjs), runs the manifest of tool calls below,
 * and splices each verbatim result into examples/*.md between HTML comment
 * markers:
 *
 *   <!-- capture:some-id -->
 *   ...replaced wholesale on every run...
 *   <!-- /capture:some-id -->
 *
 * Hand-written prose outside the markers is never touched, so the example
 * files can be regenerated at any time (`npm run examples`) without losing
 * their conversational layer. A `<!-- capture-stamp -->` marker in each file
 * is refreshed with the capture date and server version.
 *
 * Run:  npm run build && npm run examples
 * Re-capture one scenario: npm run examples -- <filename-substring>
 *
 * Notes:
 *  - Hits real APIs; calls run SEQUENTIALLY with gaps (parallel live calls
 *    masquerade as rate limiting, and Nominatim allows ~1 req/sec).
 *  - The saved-locations scenario spawns its server with HOME pointed at a
 *    scratch directory so it can never touch the real ~/.weather-mcp/.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SERVER = resolve(ROOT, 'dist', 'index.js');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const TODAY = new Date().toISOString().slice(0, 10);

const CALL_GAP_MS = 2000;      // between ordinary calls
const GEO_GAP_MS = 2500;       // extra gap before geocode-backed calls (Nominatim ~1 req/sec)
const GEO_UNAVAILABLE = /no locations found|could not find|not found/i;

// ---------------------------------------------------------------------------
// Manifest: one entry per example file; calls run in order on one server.
//   id        -> marker id in the markdown file
//   tool/args -> the MCP call, captured verbatim
//   geocoded  -> retry on transient geocoder rate-limiting
//   warmupMs  -> make the call once, discard, wait, call again (lightning
//                needs time to accumulate strikes after first subscribing)
//   image     -> examples-relative path: download the last "Image URL" in the
//                output, composite it onto an OpenStreetMap base layer (radar
//                tiles are transparent overlays — geography-free blobs on their
//                own), and commit the result (imagery URLs expire in ~2h).
//                A warning fires when the overlay is small enough to be
//                echo-free, so a rain-free snapshot never ships unnoticed.
// ---------------------------------------------------------------------------
const EXAMPLES = [
  {
    file: 'examples/weekend-trip-planning.md',
    calls: [
      {
        id: 'tokyo-forecast',
        tool: 'get_forecast',
        args: { city_name: 'Tokyo, Japan', days: 3, include_astronomy: true },
        geocoded: true,
      },
      {
        id: 'tokyo-radar',
        tool: 'get_weather_imagery',
        args: { latitude: 35.6769, longitude: 139.7639, type: 'radar' },
        image: 'images/tokyo-radar.png',
      },
    ],
  },
  {
    file: 'examples/severe-weather-day.md',
    calls: [
      {
        id: 'summary',
        tool: 'get_weather_summary',
        args: { city_name: 'Oklahoma City, OK', days: 2 },
        geocoded: true,
      },
      {
        id: 'alerts-full',
        tool: 'get_alerts',
        args: { latitude: 35.4676, longitude: -97.5164, detail: 'full' },
      },
      {
        id: 'radar',
        tool: 'get_weather_imagery',
        args: { latitude: 35.4676, longitude: -97.5164, type: 'radar', animated: true },
      },
    ],
  },
  {
    file: 'examples/boating-and-marine.md',
    calls: [
      {
        id: 'marine',
        tool: 'get_marine_conditions',
        // A point off Sydney Heads — the marine model needs open water, not city center.
        args: { latitude: -33.85, longitude: 151.35, forecast: true, forecast_days: 3 },
      },
      {
        id: 'lightning',
        tool: 'get_lightning_activity',
        args: { latitude: -33.8688, longitude: 151.2093, radius: 250, timeWindow: 60 },
        warmupMs: 45000,
      },
    ],
  },
  {
    file: 'examples/international-travel.md',
    calls: [
      {
        id: 'metar',
        tool: 'get_current_conditions',
        args: { city_name: 'Paris, France', source: 'metar', units: 'metric' },
        geocoded: true,
      },
      {
        id: 'air-quality',
        tool: 'get_air_quality',
        args: { latitude: 48.8566, longitude: 2.3522 },
      },
    ],
  },
  {
    file: 'examples/river-and-flood.md',
    calls: [
      {
        id: 'memphis-gauges',
        tool: 'get_river_conditions',
        args: { latitude: 35.1495, longitude: -90.049, detail: 'full' },
      },
      {
        id: 'manaus-glofas',
        tool: 'get_river_conditions',
        args: { latitude: -3.119, longitude: -60.0217, forecast_days: 10 },
      },
    ],
  },
  {
    file: 'examples/wildfire-awareness.md',
    calls: [
      {
        id: 'wildfires',
        tool: 'get_wildfire_info',
        args: { latitude: 39.7392, longitude: -104.9903, radius: 300 },
      },
      {
        id: 'air-quality',
        tool: 'get_air_quality',
        args: { latitude: 39.7392, longitude: -104.9903 },
      },
      {
        id: 'denver-fire-weather',
        tool: 'get_current_conditions',
        // US point: NOAA publishes its own fire-weather indices on the
        // gridpoint API, so this path reports rather than computes.
        args: { latitude: 39.7392, longitude: -104.9903, include_fire_weather: true },
      },
      {
        id: 'athens-hotspots',
        tool: 'get_wildfire_info',
        // Outside the US there are no managed incidents to report — this
        // routes to NASA FIRMS satellite heat detections instead.
        args: { latitude: 37.9838, longitude: 23.7275, radius: 200, day_range: 3 },
      },
      {
        id: 'athens-fire-weather',
        tool: 'get_current_conditions',
        // Non-US: no agency index exists, so the server computes a Fosberg
        // index from temperature/humidity/wind and says so.
        args: { latitude: 37.9838, longitude: 23.7275, include_fire_weather: true },
      },
    ],
  },
  {
    file: 'examples/historical-climate.md',
    calls: [
      {
        id: 'berlin-1945',
        tool: 'get_historical_weather',
        // A >31-day range (daysDiff 32) switches the tool to daily summaries —
        // covers the whole Potsdam Conference (Jul 17 – Aug 2, 1945) readably.
        args: {
          latitude: 52.52,
          longitude: 13.405,
          start_date: '1945-07-16',
          end_date: '1945-08-17',
          units: 'metric',
        },
      },
      {
        id: 'chicago-normals',
        tool: 'get_current_conditions',
        args: { latitude: 41.8781, longitude: -87.6298, include_normals: true },
      },
    ],
  },
  {
    file: 'examples/saved-locations-workflow.md',
    scratchHome: true, // never touch the real ~/.weather-mcp/locations.json
    calls: [
      {
        id: 'search',
        tool: 'search_location',
        args: { query: 'Lake Tahoe', limit: 3 },
        geocoded: true,
      },
      {
        id: 'save',
        tool: 'save_location',
        args: {
          alias: 'cabin',
          location_query: 'Lake Tahoe, CA',
          activities: ['boating', 'fishing', 'hiking'],
        },
        geocoded: true,
      },
      { id: 'list', tool: 'list_saved_locations', args: {} },
      {
        id: 'forecast-by-alias',
        tool: 'get_forecast',
        args: { location_name: 'cabin', days: 2 },
      },
      { id: 'details', tool: 'get_saved_location', args: { alias: 'cabin' } },
      { id: 'remove', tool: 'remove_saved_location', args: { alias: 'cabin' } },
    ],
  },
  {
    file: 'examples/README.md',
    calls: [{ id: 'service-status', tool: 'check_service_status', args: {} }],
  },
];

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(env) {
  const client = new Client(
    { name: 'capture-examples', version: '1.0.0' },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER],
    env: { ...process.env, ENABLED_TOOLS: 'all', WEATHER_LIGHTNING_PREWARM: 'false', ...env },
  });
  await client.connect(transport);
  return { client, transport };
}

async function callText(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { text, isError: !!res.isError };
}

/** Retry geocode-backed calls on transient "no locations found" (rate limiting). */
async function geoCall(client, name, args, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(3000);
    last = await callText(client, name, args);
    if (!(last.isError && GEO_UNAVAILABLE.test(last.text))) return last;
  }
  return last;
}

/** Render args as a compact JS-style call, e.g. get_forecast({ days: 3 }). */
function formatCall(tool, args) {
  if (Object.keys(args).length === 0) return `${tool}({})`;
  const body = JSON.stringify(args, null, 2).replace(/"([A-Za-z_][A-Za-z0-9_]*)":/g, '$1:');
  return `${tool}(${body})`;
}

/** Build the details block that replaces a capture marker's contents. */
function renderCapture(call, text) {
  return [
    '<details>',
    `<summary>🔍 Tool call & raw server output — <code>${call.tool}</code></summary>`,
    '',
    '**Call:**',
    '',
    '```js',
    formatCall(call.tool, call.args),
    '```',
    '',
    '**The server returned** (verbatim — this is exactly what the MCP client receives):',
    '',
    '````markdown',
    text.trimEnd(),
    '````',
    '',
    '</details>',
  ].join('\n');
}

/** Replace the contents between <!-- capture:id --> markers in-place. */
function splice(content, id, replacement, file) {
  const re = new RegExp(`(<!-- capture:${id} -->)[\\s\\S]*?(<!-- /capture:${id} -->)`);
  if (!re.test(content)) {
    throw new Error(`marker "capture:${id}" not found in ${file}`);
  }
  return content.replace(re, `$1\n${replacement}\n$2`);
}

function spliceStamp(content, file) {
  const re = /(<!-- capture-stamp -->)[\s\S]*?(<!-- \/capture-stamp -->)/;
  if (!re.test(content)) return content; // stamp is optional per file
  const stamp = `*Captured ${TODAY} with weather-mcp v${VERSION} — raw output is live data and will differ when regenerated (\`npm run examples\`).*`;
  return content.replace(re, `$1\n${stamp}\n$2`);
}

// OSM's tile usage policy requires an identifying User-Agent for programmatic
// access. One capture run fetches four base tiles — comfortably "light use".
const OSM_UA = 'weather-mcp-examples-capture/1.0 (+https://github.com/weather-mcp/weather-mcp)';

async function fetchBuffer(url, headers = {}) {
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Build a 512×512 OSM base image for the tile a RainViewer overlay URL
 * addresses. OSM serves 256px tiles, so the four z+1 children of the same
 * web-mercator tile are stitched into one 512px image — pixel-exact, no
 * resampling.
 */
async function fetchOsmBase(z, x, y) {
  const base = new PNG({ width: 512, height: 512 });
  const quadrants = [
    [2 * x, 2 * y, 0, 0],
    [2 * x + 1, 2 * y, 256, 0],
    [2 * x, 2 * y + 1, 0, 256],
    [2 * x + 1, 2 * y + 1, 256, 256],
  ];
  for (const [cx, cy, ox, oy] of quadrants) {
    const buf = await fetchBuffer(
      `https://tile.openstreetmap.org/${z + 1}/${cx}/${cy}.png`,
      { 'User-Agent': OSM_UA }
    );
    const tile = PNG.sync.read(buf);
    // OSM tiles can be paletted; pngjs normalizes to RGBA on read.
    for (let row = 0; row < 256; row++) {
      for (let col = 0; col < 256; col++) {
        const s = (row * 256 + col) * 4;
        const d = ((row + oy) * 512 + (col + ox)) * 4;
        base.data[d] = tile.data[s];
        base.data[d + 1] = tile.data[s + 1];
        base.data[d + 2] = tile.data[s + 2];
        base.data[d + 3] = 255;
      }
    }
  }
  return base;
}

/** Source-over alpha blend of a semi-transparent overlay onto an opaque base. */
function blendOnto(base, overlay) {
  for (let i = 0; i < base.data.length; i += 4) {
    const a = overlay.data[i + 3] / 255;
    if (a === 0) continue;
    base.data[i] = Math.round(overlay.data[i] * a + base.data[i] * (1 - a));
    base.data[i + 1] = Math.round(overlay.data[i + 1] * a + base.data[i + 1] * (1 - a));
    base.data[i + 2] = Math.round(overlay.data[i + 2] * a + base.data[i + 2] * (1 - a));
  }
}

/**
 * Download the last "Image URL" in a tool's output, composite it over an OSM
 * base map, and write the result to examples/<relPath>. A near-empty overlay
 * PNG (< ~4 KB for a 512px tile) usually means a transparent, echo-free tile —
 * flagged so a rain-free snapshot never ships unnoticed.
 */
async function saveImageSnapshot(text, relPath) {
  const urls = [...text.matchAll(/\*\*Image URL:\*\* (\S+)/g)].map((m) => m[1]);
  if (urls.length === 0) return { ok: false, detail: 'no Image URL lines in output' };
  const url = urls[urls.length - 1];
  // RainViewer tile path: .../512/{z}/{x}/{y}/{color}/{options}.png
  const m = url.match(/\/512\/(\d+)\/(\d+)\/(\d+)\//);
  if (!m) return { ok: false, detail: `unrecognized tile URL shape: ${url}` };
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  try {
    const overlayBuf = await fetchBuffer(url);
    const blankWarning = overlayBuf.length < 4096;
    const overlay = PNG.sync.read(overlayBuf);
    const composite = await fetchOsmBase(z, x, y);
    blendOnto(composite, overlay);
    const out = PNG.sync.write(composite);
    const dest = join(ROOT, 'examples', relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
    return { ok: true, bytes: out.length, blankWarning };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

async function main() {
  let failures = 0;

  const filter = process.argv[2];
  const selected = filter ? EXAMPLES.filter((e) => e.file.includes(filter)) : EXAMPLES;
  if (selected.length === 0) {
    console.error(`No example file matches "${filter}"`);
    process.exit(1);
  }

  for (const example of selected) {
    const path = join(ROOT, example.file);
    let content = readFileSync(path, 'utf8');
    console.log(`\n=== ${example.file} ===`);

    let scratch;
    let env = {};
    if (example.scratchHome) {
      scratch = mkdtempSync(join(tmpdir(), 'weather-mcp-examples-'));
      env = { HOME: scratch };
      console.log(`    (scratch HOME: ${scratch})`);
    }

    let conn;
    try {
      conn = await connect(env);
      for (const call of example.calls) {
        await sleep(call.geocoded ? GEO_GAP_MS : CALL_GAP_MS);
        if (call.warmupMs) {
          console.log(`    ${call.id}: warmup call, then waiting ${call.warmupMs / 1000}s...`);
          await callText(conn.client, call.tool, call.args);
          await sleep(call.warmupMs);
        }
        const fn = call.geocoded ? geoCall : callText;
        const res = await fn(conn.client, call.tool, call.args);
        // The scratch HOME leaks into "Storage location" lines; rewrite it to
        // `~`, which is what the path looks like on a real install. Disclosed
        // in examples/README.md.
        if (scratch) res.text = res.text.split(scratch).join('~');
        if (res.isError) {
          failures++;
          console.log(`  ❌ ${call.id}: tool error — keeping previous content`);
          console.log(`     ${res.text.split('\n')[0].slice(0, 100)}`);
          continue;
        }
        content = splice(content, call.id, renderCapture(call, res.text), example.file);
        console.log(`  ✅ ${call.id} (${res.text.length} chars)`);
        if (call.image) {
          const saved = await saveImageSnapshot(res.text, call.image);
          if (!saved.ok) {
            failures++;
            console.log(`  ❌ ${call.id}: image snapshot failed — ${saved.detail}`);
          } else {
            console.log(`  🖼️  ${call.image} (${saved.bytes} bytes)${saved.blankWarning ? ' ⚠️ looks blank (no echoes?) — verify visually' : ''}`);
          }
        }
      }
    } catch (e) {
      failures++;
      console.log(`  ❌ ${example.file}: ${e.message}`);
    } finally {
      if (conn) await conn.transport.close().catch(() => {});
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    }

    content = spliceStamp(content, example.file);
    writeFileSync(path, content);
  }

  console.log(failures ? `\n${failures} capture(s) failed` : '\nAll captures succeeded');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
