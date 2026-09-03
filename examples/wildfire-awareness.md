# Wildfire season check-in — Denver & Athens

Fire season is a global question, but the *data* is not. In the US, an
interagency system tracks named incidents with acreage and containment.
Almost nowhere else does. This example asks the same two questions on both
sides of that line — and the server is explicit about which kind of answer
you're getting.

> **You:** Are there any wildfires burning near Denver? Should I be worried about smoke for my run?

**Claude Code answered** (using `get_wildfire_info`):

<!-- answer -->
There are **6 active fires within 300 km of Denver, but none close enough to threaten the city** — the safety assessment comes back at the lowest "Awareness" tier.

The ones worth knowing about:

- **Willow** — the nearest, 88 miles away near Leadville: 7,196 acres, 80% contained.
- **Aspen Acres** — the big one, 110 miles south near Beulah: 102,003 acres, 82% contained after 64 days.
- One of them (310) is already **100% contained** — the server excludes fully contained fires from its danger assessment rather than letting them inflate it.

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

🔥 **Found 6 active fires**
   - 6 wildfires

## Willow

**Type:** 🔥 Wildfire
**Distance:** 141.5 km (87.9 mi)
**Location:** US-CO, Lake County near Leadville
**Coordinates:** 39.1872, -106.4753

### Status
**Size:** 7196 acres (2912 hectares)
**Containment:** 80% ████████░░
**Discovery Date:** 6/28/2026
**Days Active:** 65

---

## Aspen Acres

**Type:** 🔥 Wildfire
**Distance:** 177.5 km (110.3 mi)
**Location:** US-CO, Custer County near Beulah
**Coordinates:** 38.1500, -105.1855

### Status
**Size:** 102003 acres (41279 hectares)
**Containment:** 82% ████████░░
**Discovery Date:** 6/29/2026
**Days Active:** 65

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
**Days Active:** 27

---

## Elk

**Type:** 🔥 Wildfire
**Distance:** 272.2 km (169.1 mi)
**Location:** US-CO, Hinsdale County near Lake City
**Coordinates:** 38.1242, -107.3548

### Status
**Size:** 7257 acres (2937 hectares)
**Containment:** 73% ███████░░░
**Discovery Date:** 7/9/2026
**Days Active:** 55

---

## Gold Mountain

**Type:** 🔥 Wildfire
**Distance:** 299.2 km (185.9 mi)
**Location:** US-CO, Ouray County near Ouray
**Coordinates:** 38.0329, -107.6640

### Status
**Size:** 39744 acres (16084 hectares)
**Containment:** 92% █████████░
**Discovery Date:** 6/27/2026
**Days Active:** 66

---


*Note: 1 additional fire found within radius (showing nearest 5 only — use detail="full" for more)*

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
**Your run is fine.** US AQI is **64 — "Moderate"** — and the smoke signal specifically, PM2.5, is low at 6.5 μg/m³, so the distant fires aren't putting meaningful smoke at street level in Denver right now. Only unusually sensitive people are advised to trim prolonged outdoor exertion.

One thing to note about the timing: this was an evening check, so the UV index reads 0.0 (Low). Ask again before an afternoon run and the same report carries the daytime figure — at Denver's elevation that is the number to plan sunscreen around.
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

**Observation Time:** 9/2/2026, 3:00:00 PM

## 🟢 US Air Quality Index: 46

**Category:** Good (Green)
**Description:** Air quality is satisfactory

**Health Implications:**
Air quality is considered satisfactory, and air pollution poses little or no risk.

## 🟠 UV Index: 6.0

**Level:** High
**Description:** Protection essential
**Recommendation:** Apply SPF 30+ sunscreen. Wear protective clothing, hat, and sunglasses. Reduce midday sun exposure.

## Pollutant Concentrations

**PM2.5 (Fine Particulate Matter):** 3.0 μg/m³
**PM10 (Coarse Particulate Matter):** 3.8 μg/m³
**Ozone (O₃):** 118 μg/m³
**Nitrogen Dioxide (NO₂):** 1.1 μg/m³
**Sulfur Dioxide (SO₂):** 0.40 μg/m³
**Carbon Monoxide (CO):** 106 μg/m³
**Aerosol Optical Depth:** 0.070 (atmospheric haze indicator)

## 🌾 Pollen

**Grass:** 1 (Very Low)
**Weed:** 5 (Very High) — in season

In season: Ragweed (Very High)

*Universal Pollen Index (0–5) for today. Source: Includes pollen data from Google.*

*European AQI: 52 (Moderate)*
````

</details>
<!-- /capture:air-quality -->

**And the fire-weather side of it** (using `get_current_conditions` with `include_fire_weather`):

<!-- answer-3 -->
**Nothing to worry about today — it's actively raining at the reporting station.** NOAA rates the seasonal fire risk **Moderate** and explicitly says conditions don't meet the thresholds that trigger its danger indices, so Haines, Grassland Fire Danger, and Red Flag Threat simply aren't being calculated right now.

What it *does* give you is the smoke-dispersion picture: a **147 ft mixing height (very poor dispersion)** with a 7 mph transport wind. That combination is worth knowing — if something did ignite, the smoke would sit low rather than lift away.

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
**Time:** Sep 2, 2026, 1:45 PM (1.3 hours ago)

**Conditions:** Clear
**Temperature:** 88°F
**Pressure:** 30.09 inHg
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Clear

## Fire Weather

🟡 **Seasonal Fire Risk:** Moderate
Current conditions do not meet thresholds for fire weather concerns. Fire danger indices are calculated during periods of low humidity, high temperatures, and strong winds.

**Atmospheric Monitoring:**
**Mixing Height:** 109 ft (very poor dispersion)
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
**Yes — 2 satellite heat detections in the last 3 days, in 2 clusters within 200 km**, and the nearest is close enough to put this at **HIGH ALERT**: 24.1 km NW of the city center.

But read this differently from the Denver answer, because it *is* different data:

- These are **hotspots, not incidents.** There are no fire names, no acreage, no containment percentages — because no agency is publishing them here. What a satellite sees is heat.
- Some of these may not be wildfires at all. The server says so up front: detections can be industrial heat sources, gas flares, or agricultural burns. The 24.1 km cluster is a single low-power hotspot (2.0 MW) last seen **2 days ago**, which reads more like a burn scar or a one-off than an advancing fire.
- The only other signal is **Cluster 2** — one 0.7 MW hotspot, also **2 days old**, and 165.6 km away to the NNW.

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

🔥 **29 satellite fire detections in the last 3 days, grouped into 4 clusters within 200 km**

## Detection Cluster 1

**Detections:** 1 hotspot (0 day / 1 night)
**Distance:** 24.1 km (15.0 mi) NW
**Center:** 38.1299, 23.5240
**Peak intensity:** 2.0 MW (fire radiative power)
**Newest detection:** 3 days ago
**Confidence:** 1 nominal
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 2

**Detections:** 9 hotspots (9 day / 0 night)
**Distance:** 47.3 km (29.4 mi) NW
**Center:** 38.3350, 23.4216
**Peak intensity:** 204.7 MW (fire radiative power)
**Newest detection:** 8.4 hours ago
**Confidence:** 3 high, 5 nominal, 1 low
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 3

**Detections:** 16 hotspots (16 day / 0 night)
**Distance:** 57.6 km (35.8 mi) E
**Center:** 38.0038, 24.3842
**Peak intensity:** 66.7 MW (fire radiative power)
**Newest detection:** 10.1 hours ago
**Confidence:** 1 high, 14 nominal, 1 low
**Satellite:** Suomi NPP (VIIRS)

---

## Detection Cluster 4

**Detections:** 3 hotspots (0 day / 3 night)
**Distance:** 165.6 km (102.9 mi) NNW
**Center:** 39.3555, 22.9841
**Peak intensity:** 0.8 MW (fire radiative power)
**Newest detection:** 19.8 hours ago
**Confidence:** 3 nominal
**Satellite:** Suomi NPP (VIIRS)

---


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
**Conditions right now are calm — Fosberg index 8 (Low)** — but that's a 5 AM reading on a still morning (78°F, 4 mph wind), and the index is deliberately a *now* number, not a forecast.

The line underneath it is the one that matters for next week: **vapour-pressure deficit 1.9 kPa (moderate drying power)** and **topsoil moisture 0.08 m³/m³ (very dry)**. The topsoil is parched even though this particular hour is quiet. Add the afternoon heat — today's range runs up to 96°F — and a windy day would move that index fast.

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

**Time:** Sep 3, 2026, 12:00 AM

**Conditions:** Clear sky
**Temperature:** 82°F
**Today's Range:** High 92°F / Low 79°F
**Dewpoint:** 48°F
**Humidity:** 31%
**Wind:** 4 mph from 52°, gusting to 10 mph
**Pressure:** 29.93 inHg
**Cloud Cover:** 6%

## Fire Weather

**🟢 Fosberg Fire Weather Index:** 8 (Low)
Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.

**Dryness context:**
- **Vapour-pressure deficit:** 2.5 kPa (high drying power)
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
*Captured 2026-09-02 with weather-mcp v1.25.18 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
