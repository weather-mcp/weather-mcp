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

## Thursday, September 3
**Temperature:** High 87°F / Low 77°F
**Feels Like:** High 98°F / Low 87°F
**Sunrise:** 5:14 AM
**Sunset:** 6:06 PM
**Moon:** Third Quarter (64% illuminated) · Rise 9:19 PM · Set 11:28 AM
**Twilight:** Civil 4:48 AM / 6:32 PM · Nautical 4:17 AM / 7:02 PM · Astronomical 3:45 AM / 7:34 PM
**Daylight Duration:** 12h 52m
**Precipitation Chance:** 59%
**Precipitation:** 0.09 in
**Wind:** 4 mph S
**Wind Gusts:** 19 mph
**Conditions:** Slight rain
**UV Index:** 6.8

## Friday, September 4
**Temperature:** High 77°F / Low 72°F
**Feels Like:** High 86°F / Low 79°F
**Sunrise:** 5:15 AM
**Sunset:** 6:05 PM
**Moon:** Third Quarter (52% illuminated) · Rise 10:10 PM · Set 12:39 PM
**Twilight:** Civil 4:48 AM / 6:30 PM · Nautical 4:18 AM / 7:01 PM · Astronomical 3:46 AM / 7:32 PM
**Daylight Duration:** 12h 50m
**Precipitation Chance:** 84%
**Precipitation:** 0.63 in
**Wind:** 3 mph NNE
**Wind Gusts:** 11 mph
**Conditions:** Moderate rain
**UV Index:** 3.8

## Saturday, September 5
**Temperature:** High 79°F / Low 70°F
**Feels Like:** High 83°F / Low 76°F
**Sunrise:** 5:15 AM
**Sunset:** 6:03 PM
**Moon:** Third Quarter (41% illuminated) · Rise 11:12 PM · Set 1:46 PM
**Twilight:** Civil 4:49 AM / 6:29 PM · Nautical 4:19 AM / 6:59 PM · Astronomical 3:47 AM / 7:31 PM
**Daylight Duration:** 12h 47m
**Precipitation Chance:** 65%
**Precipitation:** 0.95 in
**Wind:** 7 mph NNE
**Wind Gusts:** 18 mph
**Conditions:** Moderate rain
**UV Index:** 1.9

**Next full moon:** Sep 27 · **Next new moon:** Sep 11

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

**Timestamp:** 2026-09-02T21:00:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/31753a8fd4ec/512/6/56/25/4/1_1.png

**Interactive map:** https://www.rainviewer.com/map.html?loc=35.6769,139.7639,7
*Opens live animated radar over a base map in the browser — the frame URLs above are transparent overlay tiles (blank where dry) and expire within about two hours.*

---

⚠️ **DISCLAIMER:** RainViewer provides global precipitation radar. Data may have 5-10 minute delay. For official forecasts, consult local meteorological services.

---
*Generated: 2026-09-02T21:02:39.666Z*
*Data source: RainViewer*
````

</details>
<!-- /capture:tokyo-radar -->

---

**Features shown:** `city_name` free-text geocoding (no coordinates needed) · `include_astronomy` (moon phase, moonrise/moonset, twilight times — computed locally, no extra API call) · `days` forecast-length control · `get_weather_imagery` radar (RainViewer) with a committed snapshot.

<!-- capture-stamp -->
*Captured 2026-09-02 with weather-mcp v1.25.18 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
