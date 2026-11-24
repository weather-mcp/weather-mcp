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
**Days Active:** 148

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
**Days Active:** 147

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

**Observation Time:** 11/23/2026, 10:00:00 PM

## 🟡 US Air Quality Index: 59

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

**PM2.5 (Fine Particulate Matter):** 13 μg/m³
**PM10 (Coarse Particulate Matter):** 14 μg/m³
**Ozone (O₃):** 13 μg/m³
**Nitrogen Dioxide (NO₂):** 27 μg/m³
**Sulfur Dioxide (SO₂):** 1.2 μg/m³
**Carbon Monoxide (CO):** 200 μg/m³
**Aerosol Optical Depth:** 0.120 (atmospheric haze indicator)

*European AQI: 41 (Moderate)*
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
**Time:** Nov 23, 2026, 4:58 PM (5.5 hours ago)

⚠️ **This observation is 5.5 hours old** — the station may have stopped reporting. Conditions may have changed substantially.

**Conditions:** Partly Cloudy
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Scattered clouds at 1312ft

## Fire Weather

ℹ️ **Seasonal Fire Risk:** Low
Winter season with minimal fire risk due to cold temperatures, snow cover, or high humidity. Fire danger indices are calculated during dry, warm periods with elevated fire potential.

**Atmospheric Monitoring:**
**Mixing Height:** 1059 ft (poor dispersion)
**Transport Wind:** 3 mph (light - poor smoke transport)

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
**65 satellite heat detections in the last 3 days within 200 km, in 38 clusters.** The nearest is 23.9 km northwest of the city: 4 night-time hotspots, newest about 5 hours old, seen by both NOAA-20 and NOAA-21. That distance puts the server's safety tier at **HIGH ALERT**.

Read this differently from the Denver answer, because it *is* different data:

- Outside the US there are **hotspots, not incidents.** There are no fire names, no acreage, no containment percentages — because no agency is publishing them here. What a satellite sees is heat.
- Some detections may not be wildfires at all. The server says so up front: detections can be industrial heat sources, gas flares, or agricultural burns. The nearest cluster's peak intensity is only 2.1 MW, which is small.
- Two satellites contribute, so one fire seen on two overpasses counts every detection. Each cluster names the satellites that saw it.
- An empty result would not have been an all-clear either. Cloud cover hides fires from satellites, and small or new fires can slip between overpasses.

So: real heat signatures nearby, most of them small. Check the nearest clusters against local news and the Greek fire service before the trip, and check again closer to it.
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
**Satellites:** NOAA-20, NOAA-21 (VIIRS)

⚠️ Satellite heat detections — not managed incident data. No fire names, sizes, or containment are available; detections may include industrial heat sources, gas flares, or agricultural burns.

🔥 **65 satellite fire detections in the last 3 days, grouped into 38 clusters within 200 km**

## Detection Cluster 1

**Detections:** 4 hotspots (0 day / 4 night)
**Distance:** 23.9 km (14.85 mi) NW
**Center:** 38.1281, 23.5253
**Peak intensity:** 2.1 MW (fire radiative power)
**Newest detection:** 4.8 hours ago
**Confidence:** 4 nominal
**Satellite:** NOAA-20 (VIIRS), NOAA-21 (VIIRS)

---

## Detection Cluster 2

**Detections:** 3 hotspots (0 day / 3 night)
**Distance:** 52.3 km (32.50 mi) NNE
**Center:** 38.3743, 24.0602
**Peak intensity:** 1.7 MW (fire radiative power)
**Newest detection:** 4.8 hours ago
**Confidence:** 3 nominal
**Satellite:** NOAA-20 (VIIRS), NOAA-21 (VIIRS)

---

## Detection Cluster 3

**Detections:** 1 hotspot (1 day / 0 night)
**Distance:** 53.2 km (33.06 mi) NNW
**Center:** 38.3834, 23.3932
**Peak intensity:** 4.3 MW (fire radiative power)
**Newest detection:** 3 days ago
**Confidence:** 1 nominal
**Satellite:** NOAA-21 (VIIRS)

---

## Detection Cluster 4

**Detections:** 1 hotspot (0 day / 1 night)
**Distance:** 58.0 km (36.04 mi) W
**Center:** 37.9202, 23.0704
**Peak intensity:** 1.4 MW (fire radiative power)
**Newest detection:** 28.4 hours ago
**Confidence:** 1 nominal
**Satellite:** NOAA-20 (VIIRS)

---

## Detection Cluster 5

**Detections:** 2 hotspots (2 day / 0 night)
**Distance:** 61.2 km (38.03 mi) NW
**Center:** 38.3574, 23.2135
**Peak intensity:** 6.1 MW (fire radiative power)
**Newest detection:** 18.1 hours ago
**Confidence:** 2 nominal
**Satellite:** NOAA-20 (VIIRS), NOAA-21 (VIIRS)

---


*Note: 33 additional clusters found within radius (showing nearest 5 only — use detail="full" for more)*

## Safety Assessment

🟠 **HIGH ALERT** - Satellite fire detections within 25 km
- Monitor fire conditions closely
- Prepare for possible evacuation
- Watch for smoke and changing conditions


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

**Time:** Nov 24, 2026, 7:15 AM

**Conditions:** Partly cloudy
**Temperature:** 55°F
**Today's Range:** High 64°F / Low 51°F
**Dewpoint:** 47°F
**Humidity:** 76%
**Wind:** 4 mph from 63°, gusting to 10 mph
**Pressure:** 30.09 inHg
**Cloud Cover:** 67%

## Fire Weather

**🟢 Fosberg Fire Weather Index:** 4 (Low)
Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.

**Dryness context:**
- **Vapour-pressure deficit:** 0.3 kPa (low drying power)
- **Topsoil moisture (top 1 cm):** 0.33 m³/m³ (wet)

*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*

---
*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*
````

</details>
<!-- /capture:athens-fire-weather -->

---

**Features shown:** `get_wildfire_info` on both paths — NIFC named incidents in the US (containment, distance to the mapped perimeter, safety tier) and NASA FIRMS satellite heat detections everywhere else (clustered hotspots from NOAA-20 and NOAA-21, each cluster naming the satellites that saw it, no names or containment, never an all-clear) · `get_current_conditions` with `include_fire_weather` on both paths — NOAA's published indices in the US, a server-computed Fosberg index with dryness context elsewhere, each labeled for what it is · `get_air_quality` on the US path — US AQI scale, pollutant breakdown (PM2.5 is the smoke signal), UV index, health recommendations.

<!-- capture-stamp -->
*Captured 2026-11-24 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
