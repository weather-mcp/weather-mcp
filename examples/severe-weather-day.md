# A hazardous-weather day — Oklahoma City

> **You:** What's going on with the weather in Oklahoma City today? Anything I should worry about?

**Claude Code answered** (using `get_weather_summary`):

<!-- answer -->
The story in Oklahoma City today is **extreme heat**, not storms. It's currently **104°F and clear** (KOKC station reading from 17 minutes ago), heading for 103°F this afternoon and 102°F again Friday, with no rain in sight.

There's one active alert: a **Heat Advisory from NWS Norman, in effect until Sunday 7 PM** — so this isn't a one-day spike, it's a multi-day event. Plan around it: outdoor time early morning or after sunset (still 81°F tonight), and hydrate aggressively.
<!-- /answer -->

<!-- capture:summary -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_weather_summary</code></summary>

**Call:**

```js
get_weather_summary({
  city_name: "Oklahoma City, OK",
  days: 2
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Weather Summary

**Location:** Oklahoma City, Oklahoma County, Oklahoma, United States (35.4730, -97.5171)

**Includes:** current, forecast, alerts

---

# Current Weather Conditions

**Station:** https://api.weather.gov/stations/KOKC
**Time:** Aug 13, 2026, 3:20 PM (17 minutes ago)

**Conditions:** Clear
**Temperature:** 104°F
**Pressure:** 29.83 inHg
**Visibility:** 10.0 miles
**Cloud Cover:** Clear at 12500ft

---
*Data source: NOAA National Weather Service*

---

# Weather Forecast (Daily)

**Location:** 35.4730, -97.5171
**Elevation:** 1211ft
**Showing:** 4 periods

## This Afternoon
**Temperature:** 103°F
**Precipitation Chance:** 0%
**Wind:** 16 mph SSW
**Forecast:** Sunny

## Tonight
**Temperature:** 81°F
**Precipitation Chance:** 2%
**Wind:** 16 mph S
**Forecast:** Clear

## Friday
**Temperature:** 102°F
**Precipitation Chance:** 3%
**Wind:** 17 mph SSW
**Forecast:** Sunny

## Friday Night
**Temperature:** 79°F
**Precipitation Chance:** 3%
**Wind:** 12 to 15 mph S
**Forecast:** Mostly Clear

---
*Data source: NOAA National Weather Service (US)*

---

# Weather Alerts

**Location:** 35.4730, -97.5171
**Status:** Active alerts only
**Updated:** Aug 13, 2026, 3:36 PM

⚠️ **1 active alert found**

🟡 **Heat Advisory**
---
**Heat Advisory issued August 13 at 12:48PM CDT until August 16 at 7:00PM CDT by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Stephens; Garvin; Murray; Pontotoc; Coal; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan
**Effective:** Aug 13, 2026, 12:48 PM
**Expires:** Aug 14, 2026, 3:30 AM
**Ends:** Aug 16, 2026, 7:00 PM

**Recommended Response:** Execute
**Sender:** NWS Norman OK

*Showing a condensed summary. Use detail="full" for complete alert descriptions.*

---
*Data source: NOAA National Weather Service*

---

*Composite summary. Use the individual tools (get_forecast, get_current_conditions, get_alerts, ...) for deeper detail.*
````

</details>
<!-- /capture:summary -->

> **You:** Give me the full text of those alerts.

**Claude Code answered** (using `get_alerts` with `detail: "full"`):

<!-- answer-2 -->
Full text of the Heat Advisory:

- **What:** heat index values of 105 to 110 expected.
- **Where:** portions of central, east central, southeast, and southern Oklahoma.
- **When:** until 7 PM CDT Sunday.
- **Impacts:** hot temperatures and high humidity may cause heat illnesses.
- **Instructions from NWS:** drink plenty of fluids, stay in an air-conditioned room, stay out of the sun, and check up on relatives and neighbors.
<!-- /answer-2 -->

<!-- capture:alerts-full -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_alerts</code></summary>

**Call:**

```js
get_alerts({
  latitude: 35.4676,
  longitude: -97.5164,
  detail: "full"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Weather Alerts

**Location:** 35.4676, -97.5164
**Status:** Active alerts only
**Updated:** Aug 13, 2026, 3:36 PM

⚠️ **1 active alert found**

🟡 **Heat Advisory**
---
**Heat Advisory issued August 13 at 12:48PM CDT until August 16 at 7:00PM CDT by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Stephens; Garvin; Murray; Pontotoc; Coal; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan
**Effective:** Aug 13, 2026, 12:48 PM
**Expires:** Aug 14, 2026, 3:30 AM
**Ends:** Aug 16, 2026, 7:00 PM

**Description:**
* WHAT...Heat index values of 105 to 110 expected.

* WHERE...Portions of central, east central, southeast, and southern
Oklahoma.

* WHEN...Until 7 PM CDT Sunday.

* IMPACTS...Hot temperatures and high humidity may cause heat
illnesses.

**Instructions:**
Drink plenty of fluids, stay in an air-conditioned room, stay out of
the sun, and check up on relatives and neighbors.

**Recommended Response:** Execute
**Sender:** NWS Norman OK

---
*Data source: NOAA National Weather Service*
````

</details>
<!-- /capture:alerts-full -->

> **You:** Show me the radar.

<!-- answer-3 -->
Here's the animated radar for the past hour — 13 frames from RainViewer (the links below open the tiles directly). Consistent with the 0% precipitation chances, there's nothing on it: the heat is the whole story today.

*Two things to know if you click those frame URLs: RainViewer only retains about two hours of history, so links in this captured output have long since expired — and even a live tile over dry skies renders as a blank white square, because radar tiles are transparent precipitation overlays with nothing to draw when it isn't raining. For what a tile with actual weather on it looks like, see the committed snapshot in [the Tokyo example](./weekend-trip-planning.md).*
<!-- /answer-3 -->

<!-- capture:radar -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_weather_imagery</code></summary>

**Call:**

```js
get_weather_imagery({
  latitude: 35.4676,
  longitude: -97.5164,
  type: "radar",
  animated: true
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Weather Imagery

**Location:** 35.4676, -97.5164
**Type:** Radar
**Coverage:** Global
**Resolution:** 13 frames
**Source:** RainViewer
**Animated:** Yes

## 🎬 Animation Frames (13 frames)

### Frame 1 - 2026-08-13T18:30:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/061f0cb2acc8/512/6/14/25/4/1_1.png

### Frame 7 - 2026-08-13T19:30:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/8fdb47068a61/512/6/14/25/4/1_1.png

### Frame 13 - 2026-08-13T20:30:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/155731d3c90c/512/6/14/25/4/1_1.png

*Showing 3 of 13 frames for brevity — use detail="full" for all frames*

**Interactive map:** https://www.rainviewer.com/map.html?loc=35.4676,-97.5164,7
*Opens live animated radar over a base map in the browser — the frame URLs above are transparent overlay tiles (blank where dry) and expire within about two hours.*

---

⚠️ **DISCLAIMER:** RainViewer provides global precipitation radar. Data may have 5-10 minute delay. For official forecasts, consult local meteorological services.

---
*Generated: 2026-08-13T20:36:46.024Z*
*Data source: RainViewer*
````

</details>
<!-- /capture:radar -->

---

**Features shown:** `get_weather_summary` one-call overview (current + forecast + alerts) · `get_alerts` `detail` levels (`standard` vs `full` alert text) · `get_weather_imagery` animated radar (RainViewer).

<!-- capture-stamp -->
*Captured 2026-08-13 with weather-mcp v1.18.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
