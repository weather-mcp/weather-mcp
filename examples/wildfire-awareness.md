# Wildfire season check-in — Denver & Athens

Fire season is a global question, but the *data* is not. In the US, an
interagency system tracks named incidents with acreage and containment.
Almost nowhere else does. This example asks the same two questions on both
sides of that line — and the server is explicit about which kind of answer
you're getting.

> **You:** Are there any wildfires burning near Denver? Should I be worried about smoke for my run?

**Claude Code answered** (using `get_wildfire_info`):

<!-- answer -->
There are **2 active fires within 300 km of Denver, but none close enough to threaten the city** — the safety assessment comes back at the lowest "Awareness" tier.

Each distance is measured to the nearest edge of the fire's mapped perimeter, not to the spot where it started, and the report says so under every distance:

- **Willow** — the nearest, 82 miles away near Leadville: 7,259 acres, 92% contained.
- **Aspen Acres** — the big one, 106 miles away near Beulah: 102,003 acres, 96% contained after 138 days.

A fire NIFC has published no containment figure for would read `not reported` instead, and the server would still treat it as uncontained when it picks the fire that drives the danger tier.

For Denver itself the practical question is smoke, not flame — let's check the air quality next.
<!-- /answer -->

<!-- capture:wildfires -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_wildfire_info</code></summary>

**Call:**

```js
get_wildfire_info({
  latitude: 39.7392,
  longitude: -104.9903,
  radius: 300
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Wildfire Information Report

**Location:** 39.7392, -104.9903
**Search Radius:** 300 km (186.4 miles)

🔥 **Found 2 active fires**
   - 2 wildfires

## Willow

**Type:** 🔥 Wildfire
**Distance:** 132.3 km (82.21 mi)
**Measured to:** nearest edge of the mapped fire perimeter
**Location:** US-CO, Lake County near Leadville
**Point of Origin (reported):** 39.1872, -106.4753

### Status
**Size:** 7259 acres (2937 hectares)
**Containment:** 92% █████████░
**Discovery Date:** 6/28/2026
**Days Active:** 139

---

## Aspen Acres

**Type:** 🔥 Wildfire
**Distance:** 169.9 km (105.57 mi)
**Measured to:** nearest edge of the mapped fire perimeter
**Location:** US-CO, Custer County near Beulah
**Point of Origin (reported):** 38.1500, -105.1855

### Status
**Size:** 102003 acres (41279 hectares)
**Containment:** 96% █████████░
**Discovery Date:** 6/29/2026
**Days Active:** 138

---


## Safety Assessment

ℹ️ **AWARENESS** - Wildfire detected within 300 km
- Stay informed about fire progression
- Air quality may be affected by smoke


---
*Data source: NIFC (National Interagency Fire Center) WFIGS*
*Wildfire data is updated throughout the day. Always consult official sources for evacuation orders and emergency information.*
*For active incidents and evacuation orders, visit: https://inciweb.nwcg.gov/*
````

</details>
<!-- /capture:wildfires -->

**And for smoke / air quality** (using `get_air_quality`):

<!-- answer-2 -->
**Your run is fine.** US AQI is **57 — "Moderate"** — and the smoke signal specifically, PM2.5, is 8.3 μg/m³, so the distant fires aren't putting meaningful smoke at street level in Denver right now. Only unusually sensitive people are advised to trim prolonged outdoor exertion.

The UV index at this 6 PM reading is 0.0 (Low), so sunscreen isn't a concern either.
<!-- /answer-2 -->

<!-- capture:air-quality -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_air_quality</code></summary>

**Call:**

```js
get_air_quality({
  latitude: 39.7392,
  longitude: -104.9903
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Air Quality Report

**Location:** 39.7392, -104.9903
**Timezone:** America/Denver
**Elevation:** 1599m

**Observation Time:** 11/14/2026, 6:00:00 PM

## 🟡 US Air Quality Index: 57

**Category:** Moderate (Yellow)
**Description:** Air quality is acceptable

**Health Implications:**
Air quality is acceptable; however, unusually sensitive people may experience minor respiratory symptoms.

⚠️ **Caution:** Unusually sensitive people should consider reducing prolonged outdoor exertion.

## 🟢 UV Index: 0.0

**Level:** Low
**Description:** Minimal protection required
**Recommendation:** No protection required. You can safely stay outside.

## Pollutant Concentrations

**PM2.5 (Fine Particulate Matter):** 8.3 μg/m³
**PM10 (Coarse Particulate Matter):** 9.9 μg/m³
**Ozone (O₃):** 39 μg/m³
**Nitrogen Dioxide (NO₂):** 23 μg/m³
**Sulfur Dioxide (SO₂):** 1.0 μg/m³
**Carbon Monoxide (CO):** 220 μg/m³
**Aerosol Optical Depth:** 0.230 (atmospheric haze indicator)

*European AQI: 37 (Fair)*
````

</details>
<!-- /capture:air-quality -->

**And the fire-weather side of it** (using `get_current_conditions` with `include_fire_weather`):

<!-- answer-3 -->
**Nothing to worry about today.** It's mostly cloudy and 46°F at the reporting station. NOAA rates the seasonal fire risk **Low** — winter season — so Haines, Grassland Fire Danger, and Red Flag Threat simply aren't being calculated right now.

What it *does* give you is the smoke-dispersion picture: a **964 ft mixing height (very poor dispersion)** with a 7 mph transport wind. That combination is worth knowing — if something did ignite, the smoke would sit low rather than lift away.

Note where these numbers come from: NOAA **publishes** fire-weather indices for US points, so on this path the server reports them rather than deriving anything. It reads the forecast hour that contains the time you asked, and converts NOAA's metres and km/h to feet and mph.
<!-- /answer-3 -->

<!-- capture:denver-fire-weather -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_current_conditions</code></summary>

**Call:**

```js
get_current_conditions({
  latitude: 39.7392,
  longitude: -104.9903,
  include_fire_weather: true
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Current Weather Conditions

**Station:** https://api.weather.gov/stations/KBJC
**Time:** Nov 14, 2026, 4:47 PM (1.3 hours ago)

**Conditions:** Mostly Cloudy
**Temperature:** 46°F
**Feels Like (Wind Chill):** 42°F
**Dewpoint:** 37°F
**Humidity:** 71%
**Wind:** 9 mph from 340°
**Pressure:** 29.87 inHg
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Broken clouds at 12008ft

## Fire Weather

ℹ️ **Seasonal Fire Risk:** Low
Winter season with minimal fire risk due to cold temperatures, snow cover, or high humidity. Fire danger indices are calculated during dry, warm periods with elevated fire potential.

**Atmospheric Monitoring:**
**Mixing Height:** 964 ft (very poor dispersion)
**Transport Wind:** 7 mph (moderate smoke transport)

*Fire danger indices (Haines Index, Grassland Fire Danger, Red Flag Threat) are calculated during elevated fire risk periods, typically during dry seasons or when Red Flag conditions are possible.*

---
*Data source: NOAA National Weather Service*
````

</details>
<!-- /capture:denver-fire-weather -->

---

## The same two questions, outside the US

> **You:** I'm in Athens next week and it's peak fire season. Same check — anything burning, and how dangerous are the conditions?

**Claude Code answered** (using `get_wildfire_info`):

<!-- answer-4 -->
**No satellite heat detections in the last 3 days within 200 km** — but read that carefully, because it is not the same as "no fires."

Read this differently from the Denver answer, because it *is* different data:

- Outside the US there are **hotspots, not incidents.** There are no fire names, no acreage, no containment percentages — because no agency is publishing them here. What a satellite sees is heat.
- Some detections, when there are any, may not be wildfires at all. The server says so up front: detections can be industrial heat sources, gas flares, or agricultural burns.
- An empty result is not an all-clear. Cloud cover hides fires from satellites, and small or new fires can slip between overpasses, so the server refuses to print an all-clear it can't back up.

So: nothing seen right now, and worth checking again closer to the trip.
<!-- /answer-4 -->

<!-- capture:athens-hotspots -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_wildfire_info</code></summary>

**Call:**

```js
get_wildfire_info({
  latitude: 37.9838,
  longitude: 23.7275,
  radius: 200,
  day_range: 3
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Wildfire Information Report

**Location:** 37.9838, 23.7275
**Search Radius:** 200 km (124.3 miles)
**Source:** NASA FIRMS satellite fire detections (VIIRS, near real-time)

⚠️ Satellite heat detections — not managed incident data. No fire names, sizes, or containment are available; detections may include industrial heat sources, gas flares, or agricultural burns.

**No satellite fire detections in the last 3 days within 200 km.**

*Note: absence of detections is not an all-clear — cloud cover can hide fires from satellites, and small or new fires may evade detection.*

---
*Data source: NASA FIRMS (Fire Information for Resource Management System)*
*We acknowledge the use of data from NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/), part of NASA's Earth Science Data and Information System (ESDIS).*
*Satellite detections update with each polar overpass. Always consult official sources for evacuation orders and emergency information.*
````

</details>
<!-- /capture:athens-hotspots -->

**And the conditions themselves** (using `get_current_conditions` with `include_fire_weather`):

<!-- answer-5 -->
**Conditions right now are calm — Fosberg index 5 (Low)** — on a mainly clear night (60°F, 73% humidity, 4 mph wind), and the index is deliberately a *now* number, not a forecast.

The dryness lines agree: **vapour-pressure deficit 0.5 kPa (low drying power)** and **topsoil moisture 0.35 m³/m³ (wet)**, with today's range topping out at 70°F. That says little about next week — a dry, windy afternoon would move the index fast — so check again closer to the day.

Two honesty notes the server makes itself, worth repeating:

- **This index is computed here, not issued by an authority.** Greece has no equivalent of NOAA's published gridpoint indices, so the server derives Fosberg from temperature, humidity, and wind and labels it *"not an official fire-danger rating."* For an actual warning, heed the Hellenic Fire Service.
- The underlying values are **model-interpolated, not a station observation** — the footer says so. If you want a real instrument reading, `source: "metar"` pulls the nearest airport.
<!-- /answer-5 -->

<!-- capture:athens-fire-weather -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_current_conditions</code></summary>

**Call:**

```js
get_current_conditions({
  latitude: 37.9838,
  longitude: 23.7275,
  include_fire_weather: true
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Current Weather Conditions

**Time:** Nov 15, 2026, 3:00 AM

**Conditions:** Mainly clear
**Temperature:** 60°F
**Today's Range:** High 70°F / Low 59°F
**Dewpoint:** 52°F
**Humidity:** 73%
**Wind:** 4 mph from 49°, gusting to 10 mph
**Pressure:** 30.18 inHg
**Cloud Cover:** 19%

## Fire Weather

**🟢 Fosberg Fire Weather Index:** 5 (Low)
Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.

**Dryness context:**
- **Vapour-pressure deficit:** 0.5 kPa (low drying power)
- **Topsoil moisture (top 1 cm):** 0.35 m³/m³ (wet)

*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*

---
*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*
````

</details>
<!-- /capture:athens-fire-weather -->

---

**Features shown:** `get_wildfire_info` on both paths — NIFC named incidents in the US (containment, distance to the mapped perimeter, safety tier) and NASA FIRMS satellite heat detections everywhere else (clustered hotspots, no names or containment, never an all-clear) · `get_current_conditions` with `include_fire_weather` on both paths — NOAA's published indices in the US, a server-computed Fosberg index with dryness context elsewhere, each labeled for what it is · `get_air_quality` on the US path — US AQI scale, pollutant breakdown (PM2.5 is the smoke signal), UV index, health recommendations.

<!-- capture-stamp -->
*Captured 2026-11-15 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
