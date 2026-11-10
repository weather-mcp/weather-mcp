# Wildfire season check-in — Denver & Athens

Fire season is a global question, but the *data* is not. In the US, an
interagency system tracks named incidents with acreage and containment.
Almost nowhere else does. This example asks the same two questions on both
sides of that line — and the server is explicit about which kind of answer
you're getting.

> **You:** Are there any wildfires burning near Denver? Should I be worried about smoke for my run?

**Claude Code answered** (using `get_wildfire_info`):

<!-- answer -->
There are **3 active fires within 300 km of Denver, but none close enough to threaten the city** — the safety assessment comes back at the lowest "Awareness" tier.

Each distance is measured to the nearest edge of the fire's mapped perimeter, not to the spot where it started, and the report says so under every distance:

- **Willow** — the nearest, 82 miles away near Leadville: 7,259 acres, 92% contained.
- **Aspen Acres** — the big one, 106 miles away near Beulah: 102,003 acres, 96% contained after 134 days.
- **Elk**, furthest out near Lake City: 7,257 acres, 90% contained.

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

🔥 **Found 3 active fires**
   - 3 wildfires

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
**Days Active:** 135

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
**Days Active:** 134

---

## Elk

**Type:** 🔥 Wildfire
**Distance:** 269.4 km (167.40 mi)
**Measured to:** nearest edge of the mapped fire perimeter
**Location:** US-CO, Hinsdale County near Lake City
**Point of Origin (reported):** 38.1242, -107.3548

### Status
**Size:** 7257 acres (2937 hectares)
**Containment:** 90% █████████░
**Discovery Date:** 7/9/2026
**Days Active:** 124

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
**Your run is fine.** US AQI is **56 — "Moderate"** — and the smoke signal specifically, PM2.5, is 11 μg/m³, so the distant fires aren't putting meaningful smoke at street level in Denver right now. Only unusually sensitive people are advised to trim prolonged outdoor exertion.

The UV index at this 2 PM reading is 1.4 (Low), so sunscreen isn't a concern today either.
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

**Observation Time:** 11/10/2026, 2:00:00 PM

## 🟡 US Air Quality Index: 56

**Category:** Moderate (Yellow)
**Description:** Air quality is acceptable

**Health Implications:**
Air quality is acceptable; however, unusually sensitive people may experience minor respiratory symptoms.

⚠️ **Caution:** Unusually sensitive people should consider reducing prolonged outdoor exertion.

## 🟢 UV Index: 1.4

**Level:** Low
**Description:** Minimal protection required
**Recommendation:** No protection required. You can safely stay outside.

## Pollutant Concentrations

**PM2.5 (Fine Particulate Matter):** 11 μg/m³
**PM10 (Coarse Particulate Matter):** 15 μg/m³
**Ozone (O₃):** 96 μg/m³
**Nitrogen Dioxide (NO₂):** 10 μg/m³
**Sulfur Dioxide (SO₂):** 1.5 μg/m³
**Carbon Monoxide (CO):** 156 μg/m³
**Aerosol Optical Depth:** 0.100 (atmospheric haze indicator)

*European AQI: 38 (Fair)*
````

</details>
<!-- /capture:air-quality -->

**And the fire-weather side of it** (using `get_current_conditions` with `include_fire_weather`):

<!-- answer-3 -->
**Nothing to worry about today.** It's clear and 64°F at the reporting station. NOAA rates the seasonal fire risk **Low** — winter season — so Haines, Grassland Fire Danger, and Red Flag Threat simply aren't being calculated right now.

What it *does* give you is the smoke-dispersion picture: a **111 ft mixing height (very poor dispersion)** with a 6 mph transport wind. That combination is worth knowing — if something did ignite, the smoke would sit low rather than lift away.

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
**Time:** Nov 10, 2026, 12:53 PM (1.8 hours ago)

**Conditions:** Clear
**Temperature:** 64°F
**Dewpoint:** 27°F
**Humidity:** 24%
**Wind:** 5 mph from 90°
**Pressure:** 30.19 inHg
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Clear

## Fire Weather

ℹ️ **Seasonal Fire Risk:** Low
Winter season with minimal fire risk due to cold temperatures, snow cover, or high humidity. Fire danger indices are calculated during dry, warm periods with elevated fire potential.

**Atmospheric Monitoring:**
**Mixing Height:** 111 ft (very poor dispersion)
**Transport Wind:** 6 mph (moderate smoke transport)

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
**No satellite fire detections within 200 km in the last 3 days.**

But read this differently from the Denver answer, because it *is* different data:

- These are **hotspots, not incidents.** There are no fire names, no acreage, no containment percentages — because no agency is publishing them here. What a satellite sees is heat, and the server says up front that a detection can also be an industrial heat source, a gas flare, or an agricultural burn.
- **Empty is not an all-clear.** Cloud cover hides fires from satellites, and small or new fires can evade detection. The server prints that caveat directly under the result instead of an all-clear it can't back up.

So the honest reading is "no detections", not "no fires". Ask again closer to your trip.
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
**Conditions right now are calm — Fosberg index 1 (Low)** — on an overcast, humid night (60°F, 94% humidity, 2 mph wind), and the index is deliberately a *now* number, not a forecast.

The dryness lines agree: **vapour-pressure deficit 0.1 kPa (low drying power)** and **topsoil moisture 0.36 m³/m³ (wet)**, with today's range topping out at 67°F. That says little about next week — a dry, windy afternoon would move the index fast — so check again closer to the day.

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

**Time:** Nov 10, 2026, 11:30 PM

**Conditions:** Overcast
**Temperature:** 60°F
**Today's Range:** High 67°F / Low 51°F
**Dewpoint:** 58°F
**Humidity:** 94%
**Wind:** 2 mph from 120°, gusting to 4 mph
**Pressure:** 30.13 inHg
**Cloud Cover:** 88%

## Fire Weather

**🟢 Fosberg Fire Weather Index:** 1 (Low)
Computed from current temperature, humidity, and sustained wind. Higher values mean faster potential fire spread in fine fuels.

**Dryness context:**
- **Vapour-pressure deficit:** 0.1 kPa (low drying power)
- **Topsoil moisture (top 1 cm):** 0.36 m³/m³ (wet)

*Derived by this server from Open-Meteo model data — not an official fire-danger rating. Heed warnings from your national fire authority.*

---
*Data source: Open-Meteo (Global) — model-interpolated values, not station observations*
````

</details>
<!-- /capture:athens-fire-weather -->

---

**Features shown:** `get_wildfire_info` on both paths — NIFC named incidents in the US (containment, distance to the mapped perimeter, safety tier) and NASA FIRMS satellite heat detections everywhere else (clustered hotspots, no names or containment, never an all-clear) · `get_current_conditions` with `include_fire_weather` on both paths — NOAA's published indices in the US, a server-computed Fosberg index with dryness context elsewhere, each labeled for what it is · `get_air_quality` on the US path — US AQI scale, pollutant breakdown (PM2.5 is the smoke signal), UV index, health recommendations.

<!-- capture-stamp -->
*Captured 2026-11-10 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
