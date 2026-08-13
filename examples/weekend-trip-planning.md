# Planning a weekend trip — Tokyo

> **You:** What's the weather looking like in Tokyo this weekend? We're planning an evening harbor cruise — will the moon be out?

**Claude Code answered** (using this server's `get_forecast` tool):

<!-- answer -->
Here's the weekend outlook for Tokyo:

- **Friday, Aug 14** — the wet one: moderate rain, 100% chance, high 79°F / low 74°F.
- **Saturday, Aug 15** — hot and muggy (high 87°F), with an 82% chance of light drizzle.
- **Sunday, Aug 16** — similar: high 86°F, 70% chance of light drizzle.

About the harbor cruise: I have to be honest — **the moon won't be out**. Friday is a new moon (3% illuminated), and by Saturday the thin waxing crescent (7%) sets at 7:49 PM, barely an hour after the 6:31 PM sunset. Once civil twilight ends around 6:58 PM you'll have dark skies over the water — great for city lights, no moonlight. If you want a moonlit cruise, the next full moon is **August 28**.
<!-- /answer -->

---

<!-- capture:tokyo-forecast -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_forecast</code></summary>

**Call:**

```js
get_forecast({
  city_name: "Tokyo, Japan",
  days: 3,
  include_astronomy: true
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
**Location:** Tokyo, Japan (35.6769, 139.7639)

# Weather Forecast (Daily)

**Location:** 35.6769, 139.7639
**Elevation:** 89ft
**Timezone:** Asia/Tokyo
**Forecast Days:** 3

## Friday, August 14
**Temperature:** High 79°F / Low 74°F
**Feels Like:** High 89°F / Low 81°F
**Sunrise:** 4:58 AM
**Sunset:** 6:32 PM
**Moon:** New Moon (3% illuminated) · Rise 6:19 AM · Set 7:22 PM
**Twilight:** Civil 4:31 AM / 6:59 PM · Nautical 3:58 AM / 7:31 PM · Astronomical 3:24 AM / 8:06 PM
**Daylight Duration:** 13h 33m
**Precipitation Chance:** 100%
**Precipitation:** 0.82 in
**Wind:** 6 mph NE
**Wind Gusts:** 18 mph
**Conditions:** Moderate rain
**UV Index:** 7.6

## Saturday, August 15
**Temperature:** High 87°F / Low 73°F
**Feels Like:** High 96°F / Low 80°F
**Sunrise:** 4:59 AM
**Sunset:** 6:31 PM
**Moon:** Waxing Crescent (7% illuminated) · Rise 7:27 AM · Set 7:49 PM
**Twilight:** Civil 4:32 AM / 6:58 PM · Nautical 3:59 AM / 7:30 PM · Astronomical 3:25 AM / 8:04 PM
**Daylight Duration:** 13h 31m
**Precipitation Chance:** 82%
**Precipitation:** 0.01 in
**Wind:** 3 mph NE
**Wind Gusts:** 16 mph
**Conditions:** Light drizzle
**UV Index:** 7.8

## Sunday, August 16
**Temperature:** High 86°F / Low 72°F
**Feels Like:** High 93°F / Low 79°F
**Sunrise:** 5:00 AM
**Sunset:** 6:30 PM
**Moon:** Waxing Crescent (14% illuminated) · Rise 8:31 AM · Set 8:15 PM
**Twilight:** Civil 4:33 AM / 6:56 PM · Nautical 4:00 AM / 7:29 PM · Astronomical 3:26 AM / 8:03 PM
**Daylight Duration:** 13h 29m
**Precipitation Chance:** 70%
**Precipitation:** 0.00 in
**Wind:** 6 mph NE
**Wind Gusts:** 18 mph
**Conditions:** Light drizzle
**UV Index:** 7.0

**Next full moon:** Aug 28 · **Next new moon:** Sep 11

---
*Data source: Open-Meteo (Global)*
````

</details>
<!-- /capture:tokyo-forecast -->

> **You:** Is it raining there right now? Show me the radar.

**Claude Code answered** (using `get_weather_imagery`):

<!-- answer-2 -->
Yes — the rain is already arriving. The current radar frame (5:30 AM Friday, Tokyo time) shows a broad rain shield moving over the Tokyo area, with heavier storm cells — the orange-and-red cores — further southwest over the Kii Peninsula. That lines up with Friday being the washout day in the forecast: 100% chance, moderate rain.
<!-- /answer-2 -->

![Radar over Tokyo composited onto an OpenStreetMap base layer, saved at capture time](./images/tokyo-radar.png)

*A snapshot committed at capture time: the radar tile the server returned, composited onto a map base layer so the echoes have geography under them. The raw tile itself is a transparent precipitation overlay — blank where dry — and RainViewer's frame URLs expire within about two hours, which is why the server's output also includes an **interactive map** link for the live, animated view. Radar © RainViewer · base map © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.*

<!-- capture:tokyo-radar -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_weather_imagery</code></summary>

**Call:**

```js
get_weather_imagery({
  latitude: 35.6769,
  longitude: 139.7639,
  type: "radar"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Weather Imagery

**Location:** 35.6769, 139.7639
**Type:** Radar
**Coverage:** Global
**Resolution:** Latest snapshot
**Source:** RainViewer
**Animated:** No

## 📸 Current Imagery

**Timestamp:** 2026-08-13T20:30:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/155731d3c90c/512/6/56/25/4/1_1.png

**Interactive map:** https://www.rainviewer.com/map.html?loc=35.6769,139.7639,7
*Opens live animated radar over a base map in the browser — the frame URLs above are transparent overlay tiles (blank where dry) and expire within about two hours.*

---

⚠️ **DISCLAIMER:** RainViewer provides global precipitation radar. Data may have 5-10 minute delay. For official forecasts, consult local meteorological services.

---
*Generated: 2026-08-13T20:36:34.116Z*
*Data source: RainViewer*
````

</details>
<!-- /capture:tokyo-radar -->

---

**Features shown:** `city_name` free-text geocoding (no coordinates needed) · `include_astronomy` (moon phase, moonrise/moonset, twilight times — computed locally, no extra API call) · `days` forecast-length control · `get_weather_imagery` radar (RainViewer) with a committed snapshot.

<!-- capture-stamp -->
*Captured 2026-08-13 with weather-mcp v1.18.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
