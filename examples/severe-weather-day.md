# A hazardous-weather day — Oklahoma City

> **You:** What's going on with the weather in Oklahoma City today? Anything I should worry about?

**Claude Code answered** (using `get_weather_summary`):

<!-- answer -->
The story in Oklahoma City is **wind**, not storms. It's currently **45°F** with 10-mile visibility (KOKC station reading from 25 minutes ago, feels like 41°F with a 6 mph breeze), overnight is 39°F and mostly clear, and Saturday reaches 64°F — dry throughout, with precipitation chances of 0 to 2% across the next four periods.

There's one active alert: a **Wind Advisory from NWS Norman, from 9 PM Saturday until 8 AM Sunday** — northwest winds of 20 to 30 mph with gusts up to 50 mph. Plan around it: secure loose outdoor objects on Saturday, and expect a difficult drive for high-profile vehicles overnight into Sunday (Saturday night's forecast already shows 10 to 25 mph west wind).
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
**Time:** Nov 28, 2026, 12:50 AM (25 minutes ago)

**Temperature:** 45°F
**Feels Like (Wind Chill):** 41°F
**Wind:** 6 mph from 200°
**Pressure:** 29.91 inHg
**Visibility:** 10.0 miles (clear)

---
*Data source: NOAA National Weather Service*

---

# Weather Forecast (Daily)

**Location:** 35.4730, -97.5171
**Elevation:** 1211ft
**Timezone:** America/Chicago
**Updated:** Nov 28, 2026, 12:31 AM
**Showing:** 4 periods

## Overnight
**Temperature:** 39°F
**Precipitation Chance:** 0%
**Wind:** 1 to 5 mph WSW
**Forecast:** Mostly Clear

## Saturday
**Temperature:** 64°F
**Precipitation Chance:** 0%
**Wind:** 1 to 13 mph SSE
**Forecast:** Partly Sunny

## Saturday Night
**Temperature:** 40°F
**Precipitation Chance:** 2%
**Wind:** 10 to 25 mph W
**Forecast:** Partly Cloudy

## Sunday
**Temperature:** 51°F
**Precipitation Chance:** 0%
**Wind:** 8 to 22 mph NNW
**Forecast:** Sunny

---
*Data source: NOAA National Weather Service (US)*

---

# Weather Alerts

**Location:** 35.4730, -97.5171
**Status:** Active alerts only
**Updated:** Nov 28, 2026, 1:14 AM CST

⚠️ **1 active alert found**

🟡 **Wind Advisory**
---
**Wind Advisory issued November 28 at 12:35AM CST until November 29 at 8:00AM CST by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Grant; Kay; Garfield; Noble; Kingfisher; Logan; Payne; Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Stephens; Garvin; Murray; Pontotoc; Coal; Cotton; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan; Wichita; Baylor; Archer; Clay
**Effective:** Nov 28, 2026, 12:35 AM CST
**Expires:** Nov 28, 2026, 3:00 PM CST
**Onset:** Nov 28, 2026, 9:00 PM CST
**Ends:** Nov 29, 2026, 8:00 AM CST

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
Full text of the Wind Advisory:

- **What:** northwest winds 20 to 30 mph with gusts up to 50 mph expected.
- **Where:** portions of central, east central, northern, southeast, southern, and southwest Oklahoma, and northern Texas.
- **When:** from 9 PM Saturday to 8 AM CST Sunday.
- **Impacts:** gusty winds will blow around unsecured objects; tree limbs could be blown down and a few power outages may result.
- **Instructions from NWS:** winds this strong can make driving difficult, especially for high-profile vehicles. Use extra caution.
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
**Updated:** Nov 28, 2026, 1:14 AM CST

⚠️ **1 active alert found**

🟡 **Wind Advisory**
---
**Wind Advisory issued November 28 at 12:35AM CST until November 29 at 8:00AM CST by NWS Norman OK**

**Severity:** Moderate | **Urgency:** Expected | **Certainty:** Likely
**Area:** Grant; Kay; Garfield; Noble; Kingfisher; Logan; Payne; Canadian; Oklahoma; Lincoln; Grady; McClain; Cleveland; Pottawatomie; Seminole; Hughes; Stephens; Garvin; Murray; Pontotoc; Coal; Cotton; Jefferson; Carter; Johnston; Atoka; Love; Marshall; Bryan; Wichita; Baylor; Archer; Clay
**Effective:** Nov 28, 2026, 12:35 AM CST
**Expires:** Nov 28, 2026, 3:00 PM CST
**Onset:** Nov 28, 2026, 9:00 PM CST
**Ends:** Nov 29, 2026, 8:00 AM CST

**Description:**
* WHAT...Northwest winds 20 to 30 mph with gusts up to 50 mph
expected.

* WHERE...Portions of central, east central, northern, southeast,
southern, and southwest Oklahoma and northern Texas.

* WHEN...From 9 PM this evening to 8 AM CST Sunday.

* IMPACTS...Gusty winds will blow around unsecured objects. Tree
limbs could be blown down and a few power outages may result.

**Instructions:**
Winds this strong can make driving difficult, especially for high
profile vehicles. Use extra caution.

**Recommended Response:** Execute
**Sender:** NWS Norman OK

---
*Data source: NOAA National Weather Service*
````

</details>
<!-- /capture:alerts-full -->

> **You:** Show me the radar.

<!-- answer-3 -->
Here's the animated radar for the past couple of hours — 13 frames from RainViewer (the links below open the tiles directly). Consistent with today's zero precipitation chances (0% overnight, 0% Saturday), there's nothing on it: the wind is the story, arriving Saturday night, not rain.

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

### Frame 1 - 2026-11-28T05:10:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/648f8518ab8d/512/6/14/25/4/1_1.png

### Frame 7 - 2026-11-28T06:10:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/e8cb55f0e2bd/512/6/14/25/4/1_1.png

### Frame 13 - 2026-11-28T07:10:00.000Z
**Image URL:** https://tilecache.rainviewer.com/v2/radar/b1191385d77a/512/6/14/25/4/1_1.png

*Showing 3 of 13 frames for brevity — use detail="full" for all frames*

**Interactive map:** https://www.rainviewer.com/map.html?loc=35.4676,-97.5164,7
*Opens live animated radar over a base map in the browser — the frame URLs above are transparent overlay tiles (blank where dry) and expire within about two hours.*

---

⚠️ **DISCLAIMER:** RainViewer provides global precipitation radar. Data may have 5-10 minute delay. For official forecasts, consult local meteorological services.

---
*Generated: 2026-11-28T07:15:12.133Z*
*Data source: RainViewer*
````

</details>
<!-- /capture:radar -->

---

**Features shown:** `get_weather_summary` one-call overview (current + forecast + alerts) · `get_alerts` `detail` levels (`standard` vs `full` alert text) · `get_weather_imagery` animated radar (RainViewer).

<!-- capture-stamp -->
*Captured 2026-11-28 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
