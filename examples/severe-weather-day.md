# A hazardous-weather day — Oklahoma City

> **You:** What's going on with the weather in Oklahoma City today? Anything I should worry about?

**Claude Code answered** (using `get_weather_summary`):

<!-- answer -->
The story in Oklahoma City today is **extreme heat**, not storms. It's currently **99°F and clear** (KOKC station reading from 28 minutes ago), heading for 101°F this afternoon and 101°F again Wednesday — dry until Wednesday night, when a 66% chance of showers and thunderstorms moves in.

There's one active alert: a **Heat Advisory from NWS Norman, in effect until Wednesday 7 PM** — so this isn't a one-day spike, it's a multi-day event. Plan around it: outdoor time early morning or after sunset (still 81°F tonight), and hydrate aggressively.
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
**Time:** Sep 8, 2026, 12:50 PM (28 minutes ago)

**Conditions:** Clear
**Temperature:** 99°F
**Wind:** 16 mph from 150°
**Pressure:** 30.05 inHg
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Clear at 12500ft

---
*Data source: NOAA National Weather Service*

---

# Weather Forecast (Daily)

**Location:** 35.4730, -97.5171
**Elevation:** 1211ft
**Updated:** Sep 8, 2026, 12:13 PM
**Showing:** 4 periods

## This Afternoon
**Temperature:** 101°F
**Precipitation Chance:** 1%
**Wind:** 12 mph S
**Forecast:** Sunny

## Tonight
**Temperature:** 81°F
**Precipitation Chance:** 1%
**Wind:** 12 mph S
**Forecast:** Clear

## Wednesday
**Temperature:** 101°F
**Precipitation Chance:** 6%
**Wind:** 10 mph SSW
**Forecast:** Sunny

## Wednesday Night
**Temperature:** 77°F
**Precipitation Chance:** 66%
**Wind:** 6 to 9 mph S
**Forecast:** Showers And Thunderstorms Likely

---
*Data source: NOAA National Weather Service (US)*

---

# Weather Alerts

**Location:** 35.4730, -97.5171
**Status:** Active alerts only
**Updated:** Sep 8, 2026, 1:17 PM

⚠️ **2 active alerts found**

🟡 **Heat Advisory**
---
**Heat Advisory issued September 8 at 12:05PM CDT until September 8 at 7:00PM CDT by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Woods; Alfalfa; Grant; Kay; Major; Garfield; Noble; Blaine; Kingfisher; Logan; Payne; Caddo; Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Kiowa; Jackson; Tillman; Comanche; Stephens; Garvin; Murray; Pontotoc; Coal; Cotton; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan; Wilbarger; Wichita; Baylor; Archer; Clay
**Effective:** Sep 8, 2026, 12:05 PM
**Expires:** Sep 9, 2026, 4:00 AM
**Ends:** Sep 8, 2026, 7:00 PM

**Recommended Response:** Execute
**Sender:** NWS Norman OK

🟡 **Heat Advisory**
---
**Heat Advisory issued September 8 at 12:05PM CDT until September 9 at 7:00PM CDT by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Woods; Alfalfa; Grant; Kay; Major; Garfield; Noble; Blaine; Kingfisher; Logan; Payne; Caddo; Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Kiowa; Jackson; Tillman; Comanche; Stephens; Garvin; Murray; Pontotoc; Coal; Cotton; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan; Wilbarger; Wichita; Baylor; Archer; Clay
**Effective:** Sep 8, 2026, 12:05 PM
**Expires:** Sep 9, 2026, 4:00 AM
**Onset:** Sep 9, 2026, 12:00 PM
**Ends:** Sep 9, 2026, 7:00 PM

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

- **What:** heat index values up to 109 expected (both advisories).
- **Where:** portions of central, east central, northern, northwest, southeast, southern, and southwest Oklahoma, and northern Texas.
- **When:** until 7 PM CDT this evening for the first advisory; from noon to 7 PM CDT Wednesday for the second.
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
**Updated:** Sep 8, 2026, 1:17 PM

⚠️ **2 active alerts found**

🟡 **Heat Advisory**
---
**Heat Advisory issued September 8 at 12:05PM CDT until September 8 at 7:00PM CDT by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Woods; Alfalfa; Grant; Kay; Major; Garfield; Noble; Blaine; Kingfisher; Logan; Payne; Caddo; Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Kiowa; Jackson; Tillman; Comanche; Stephens; Garvin; Murray; Pontotoc; Coal; Cotton; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan; Wilbarger; Wichita; Baylor; Archer; Clay
**Effective:** Sep 8, 2026, 12:05 PM
**Expires:** Sep 9, 2026, 4:00 AM
**Ends:** Sep 8, 2026, 7:00 PM

**Description:**
* WHAT...For the first Heat Advisory, heat index values up to 109.
For the second Heat Advisory, heat index values up to 109 expected.

* WHERE...Portions of central, east central, northern, northwest,
southeast, southern, and southwest Oklahoma and northern Texas.

* WHEN...For the first Heat Advisory, until 7 PM CDT this evening.
For the second Heat Advisory, from noon to 7 PM CDT Wednesday.

* IMPACTS...Hot temperatures and high humidity may cause heat
illnesses.

**Instructions:**
Drink plenty of fluids, stay in an air-conditioned room, stay out of
the sun, and check up on relatives and neighbors.

**Recommended Response:** Execute
**Sender:** NWS Norman OK

🟡 **Heat Advisory**
---
**Heat Advisory issued September 8 at 12:05PM CDT until September 9 at 7:00PM CDT by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Woods; Alfalfa; Grant; Kay; Major; Garfield; Noble; Blaine; Kingfisher; Logan; Payne; Caddo; Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Kiowa; Jackson; Tillman; Comanche; Stephens; Garvin; Murray; Pontotoc; Coal; Cotton; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan; Wilbarger; Wichita; Baylor; Archer; Clay
**Effective:** Sep 8, 2026, 12:05 PM
**Expires:** Sep 9, 2026, 4:00 AM
**Onset:** Sep 9, 2026, 12:00 PM
**Ends:** Sep 9, 2026, 7:00 PM

**Description:**
* WHAT...For the first Heat Advisory, heat index values up to 109.
For the second Heat Advisory, heat index values up to 109 expected.

* WHERE...Portions of central, east central, northern, northwest,
southeast, southern, and southwest Oklahoma and northern Texas.

* WHEN...For the first Heat Advisory, until 7 PM CDT this evening.
For the second Heat Advisory, from noon to 7 PM CDT Wednesday.

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
Here's the animated radar for the past hour — 13 frames from RainViewer (the links below open the tiles directly). Consistent with today's near-zero precipitation chances (1% this afternoon, 1% tonight), there's nothing on it: the heat is today's story, with the 66% chance of storms not arriving until Wednesday night.

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

### Frame 1 - 2026-09-08T16:10:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/4746a5a43ba3/512/6/14/25/4/1_1.png

### Frame 7 - 2026-09-08T17:10:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/f1a100fcbbc5/512/6/14/25/4/1_1.png

### Frame 13 - 2026-09-08T18:10:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/5475b75f8b4f/512/6/14/25/4/1_1.png

*Showing 3 of 13 frames for brevity — use detail="full" for all frames*

**Interactive map:** https://www.rainviewer.com/map.html?loc=35.4676,-97.5164,7
*Opens live animated radar over a base map in the browser — the frame URLs above are transparent overlay tiles (blank where dry) and expire within about two hours.*

---

⚠️ **DISCLAIMER:** RainViewer provides global precipitation radar. Data may have 5-10 minute delay. For official forecasts, consult local meteorological services.

---
*Generated: 2026-09-08T18:18:23.532Z*
*Data source: RainViewer*
````

</details>
<!-- /capture:radar -->

---

**Features shown:** `get_weather_summary` one-call overview (current + forecast + alerts) · `get_alerts` `detail` levels (`standard` vs `full` alert text) · `get_weather_imagery` animated radar (RainViewer).

<!-- capture-stamp -->
*Captured 2026-09-08 with weather-mcp v1.28.1 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
