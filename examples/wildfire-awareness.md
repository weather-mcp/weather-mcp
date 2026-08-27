# Wildfire season check-in — Denver & Athens

Fire season is a global question, but the *data* is not. In the US, an
interagency system tracks named incidents with acreage and containment.
Almost nowhere else does. This example asks the same two questions on both
sides of that line — and the server is explicit about which kind of answer
you're getting.

> **You:** Are there any wildfires burning near Denver? Should I be worried about smoke for my run?

**Claude Code answered** (using `get_wildfire_info`):

<!-- answer -->
There are **8 active fires within 300 km of Denver, but none close enough to threaten the city** — the safety assessment comes back at the lowest "Awareness" tier.

The ones worth knowing about:

- **Willow** — the nearest, 88 miles away near Leadville: 7,196 acres, 67% contained.
- **Aspen Acres** — the big one, 110 miles south near Beulah: 102,003 acres, 72% contained after 46 days.
- Two others (Fishhook, Fuhr Gulch) are already **100% contained** — the server excludes fully contained fires from its danger assessment rather than letting them inflate it.

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

🔥 **Found 8 active fires**
   - 8 wildfires

## Willow

**Type:** 🔥 Wildfire
**Distance:** 141.5 km (87.9 mi)
**Location:** US-CO, Lake County near Leadville
**Coordinates:** 39.1872, -106.4753

### Status
**Size:** 7196 acres (2912 hectares)
**Containment:** 80% ████████░░
**Discovery Date:** 6/28/2026
**Days Active:** 60

---

## Aspen Acres

**Type:** 🔥 Wildfire
**Distance:** 177.5 km (110.3 mi)
**Location:** US-CO, Custer County near Beulah
**Coordinates:** 38.1500, -105.1855

### Status
**Size:** 102003 acres (41279 hectares)
**Containment:** 77% ████████░░
**Discovery Date:** 6/29/2026
**Days Active:** 59

---

## 310

**Type:** 🔥 Wildfire
**Distance:** 258.7 km (160.8 mi)
**Location:** US-CO, Garfield County near Parachute
**Coordinates:** 39.4448, -107.9855

### Status
**Size:** 603 acres (244 hectares)
**Containment:** 100% ██████████
**Discovery Date:** 8/6/2026
**Days Active:** 21

---

## Elk

**Type:** 🔥 Wildfire
**Distance:** 272.2 km (169.1 mi)
**Location:** US-CO, Hinsdale County near Lake City
**Coordinates:** 38.1242, -107.3548

### Status
**Size:** 7257 acres (2937 hectares)
**Containment:** 33% ███░░░░░░░
**Discovery Date:** 7/9/2026
**Days Active:** 49

---

## Stewart

**Type:** 🔥 Wildfire
**Distance:** 275.9 km (171.4 mi)
**Location:** US-CO, Rio Blanco County
**Coordinates:** 39.8367, -108.2165

### Status
**Size:** 26 acres (10 hectares)
**Containment:** 0% ░░░░░░░░░░
**Discovery Date:** 8/26/2026
**Days Active:** 1

---


*Note: 3 additional fires found within radius (showing nearest 5 only — use detail="full" for more)*

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
**Your run is fine.** US AQI is **59 — mid-"Moderate"** — and the smoke signal specifically, PM2.5, is low at 7.3 μg/m³, so the distant fires aren't putting meaningful smoke at street level in Denver right now. Only unusually sensitive people are advised to trim prolonged outdoor exertion.

One thing the run *does* need: sunscreen. UV index is 5.7 (Moderate) this afternoon at Denver's elevation — and the server notes it would be 8.9 under clear sky, so don't let the cloud cover fool you.
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

**Observation Time:** 8/27/2026, 3:00:00 PM

## 🟡 US Air Quality Index: 54

**Category:** Moderate (Yellow)
**Description:** Air quality is acceptable

**Health Implications:**
Air quality is acceptable; however, unusually sensitive people may experience minor respiratory symptoms.

⚠️ **Caution:** Unusually sensitive people should consider reducing prolonged outdoor exertion.

## 🟡 UV Index: 5.5

**Level:** Moderate
**Description:** Protection recommended
**Recommendation:** Wear sunscreen, hat, and sunglasses. Seek shade during midday hours.

*Note: UV index under clear sky would be 6.5*

## Pollutant Concentrations

**PM2.5 (Fine Particulate Matter):** 5.7 μg/m³
**PM10 (Coarse Particulate Matter):** 8.5 μg/m³
**Ozone (O₃):** 127 μg/m³
**Nitrogen Dioxide (NO₂):** 1.5 μg/m³
**Sulfur Dioxide (SO₂):** 0.60 μg/m³
**Carbon Monoxide (CO):** 141 μg/m³
**Ammonia (NH₃):** N/A
**Aerosol Optical Depth:** 0.110 (atmospheric haze indicator)

## 🌾 Pollen

**Weed:** 5 (Very High) — in season

In season: Ragweed (Very High)

*Universal Pollen Index (0–5) for today. Source: Includes pollen data from Google.*

*European AQI: 58 (Moderate)*
````

</details>
<!-- /capture:air-quality -->

**And the fire-weather side of it** (using `get_current_conditions` with `include_fire_weather`):

<!-- answer-3 -->
**Nothing to worry about today — it's actively raining at the reporting station.** NOAA rates the seasonal fire risk **Moderate** and explicitly says conditions don't meet the thresholds that trigger its danger indices, so Haines, Grassland Fire Danger, and Red Flag Threat simply aren't being calculated right now.

What it *does* give you is the smoke-dispersion picture: a **205 ft mixing height (very poor dispersion)** with a 7 mph transport wind. That combination is worth knowing — if something did ignite, the smoke would sit low rather than lift away.

Note where these numbers come from: NOAA **publishes** fire-weather indices for US points, so on this path the server reports them rather than deriving anything.
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
**Time:** Aug 27, 2026, 3:19 PM (31 minutes ago)

**Conditions:** Partly Cloudy
**Temperature:** 88°F
**Dewpoint:** 45°F
**Humidity:** 22%
**Pressure:** 30.25 inHg
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Scattered clouds at 12008ft

## Fire Weather

🟡 **Seasonal Fire Risk:** Moderate
Current conditions do not meet thresholds for fire weather concerns. Fire danger indices are calculated during periods of low humidity, high temperatures, and strong winds.

**Atmospheric Monitoring:**
**Mixing Height:** 108 ft (very poor dispersion)
**Transport Wind:** 9 mph (moderate smoke transport)

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
**Yes — 11 satellite heat detections in the last 3 days, in 8 clusters within 200 km**, and the nearest is close enough to put this at **HIGH ALERT**: 21.7 km WNW of the city center.

But read this differently from the Denver answer, because it *is* different data:

- These are **hotspots, not incidents.** There are no fire names, no acreage, no containment percentages — because no agency is publishing them here. What a satellite sees is heat.
- Some of these may not be wildfires at all. The server says so up front: detections can be industrial heat sources, gas flares, or agricultural burns. The 21.7 km cluster is a single low-power hotspot (5.0 MW) last seen **2 days ago**, which reads more like a burn scar or a one-off than an advancing fire.
- The liveliest signal is actually **Cluster 4** — two hotspots, 6.4 MW peak, and only **8.4 hours old** — but it's 127 km away near Lamia.

So: worth watching, not worth panicking. And critically, if this had come back empty it still wouldn't have meant "no fires" — cloud cover hides fires from satellites, and the server refuses to print an all-clear it can't back up.
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

🔥 **9 satellite fire detections in the last 3 days, grouped into 7 clusters within 200 km**

## Detection Cluster 1

**Detections:** 2 hotspots (2 day / 0 night)
**Distance:** 7.8 km (4.9 mi) NE
**Center:** 38.0379, 23.7848
**Peak intensity:** 2.5 MW (fire radiative power)
**Newest detection:** 34.3 hours ago
**Confidence:** 2 low
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 2

**Detections:** 1 hotspot (0 day / 1 night)
**Distance:** 13.5 km (8.4 mi) NW
**Center:** 38.0814, 23.6355
**Peak intensity:** 1.1 MW (fire radiative power)
**Newest detection:** 45.7 hours ago
**Confidence:** 1 nominal
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 3

**Detections:** 2 hotspots (0 day / 2 night)
**Distance:** 23.9 km (14.9 mi) NW
**Center:** 38.1286, 23.5250
**Peak intensity:** 2.6 MW (fire radiative power)
**Newest detection:** 45.7 hours ago
**Confidence:** 2 nominal
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 4

**Detections:** 1 hotspot (1 day / 0 night)
**Distance:** 38.1 km (23.7 mi) NNW
**Center:** 38.3170, 23.6256
**Peak intensity:** 2.9 MW (fire radiative power)
**Newest detection:** 34.3 hours ago
**Confidence:** 1 low
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 5

**Detections:** 1 hotspot (1 day / 0 night)
**Distance:** 49.1 km (30.5 mi) N
**Center:** 38.4241, 23.6822
**Peak intensity:** 2.2 MW (fire radiative power)
**Newest detection:** 34.3 hours ago
**Confidence:** 1 low
**Satellite:** Suomi NPP (VIIRS)

---


*Note: 2 additional clusters found within radius (showing nearest 5 only — use detail="full" for more)*

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
**Conditions right now are calm — Fosberg index 11 (Low)** — but that's an 11 PM reading on a still night (77°F, 5 mph wind), and the index is deliberately a *now* number, not a forecast.

The line underneath it is the one that matters for next week: **vapour-pressure deficit 2.0 kPa (high drying power)** and **topsoil moisture 0.07 m³/m³ (very dry)**. The landscape is parched even though this particular hour is quiet. Add the afternoon heat — today topped out at 90°F — and a windy day would move that index fast.

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

**Time:** Aug 28, 2026, 12:45 AM

**Conditions:** Clear sky
**Temperature:** 80°F
**Today's Range:** High 97°F / Low 76°F
**Dewpoint:** 59°F
**Humidity:** 48%
**Wind:** 3 mph from 56°, gusting to 7 mph
**Pressure:** 30.00 inHg
**Cloud Cover:** 0%

## Fire Weather

**🟢 Fosberg Fire Weather Index:** 6 (Low)
Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.

**Dryness context:**
- **Vapour-pressure deficit:** 1.8 kPa (moderate drying power)
- **Topsoil moisture (top 1 cm):** 0.08 m³/m³ (very dry)

*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*

---
*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*
````

</details>
<!-- /capture:athens-fire-weather -->

---

**Features shown:** `get_wildfire_info` on both paths — NIFC named incidents in the US (containment, distance, safety tier) and NASA FIRMS satellite heat detections everywhere else (clustered hotspots, no names or containment, never an all-clear) · `get_current_conditions` with `include_fire_weather` on both paths — NOAA's published indices in the US, a server-computed Fosberg index with dryness context elsewhere, each labeled for what it is · `get_air_quality` on the US path — US AQI scale, pollutant breakdown (PM2.5 is the smoke signal), UV index, health recommendations.

<!-- capture-stamp -->
*Captured 2026-08-27 with weather-mcp v1.25.6 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
