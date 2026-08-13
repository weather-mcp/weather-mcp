# Wildfire season check-in — Denver

> **You:** Are there any wildfires burning near Denver? Should I be worried about smoke for my run?

**Claude Code answered** (using `get_wildfire_info`):

<!-- answer -->
There are **8 active fires within 300 km of Denver, but none close enough to threaten the city** — the safety assessment comes back at the lowest "Awareness" tier.

The ones worth knowing about:

- **Willow** — the nearest, 88 miles away near Leadville: 7,196 acres, 67% contained.
- **Aspen Acres** — the big one, 110 miles south near Beulah: 102,003 acres, 72% contained after 45 days.
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
**Containment:** 67% ███████░░░
**Discovery Date:** 6/28/2026
**Days Active:** 45

---

## Fishhook

**Type:** 🔥 Wildfire
**Distance:** 165.6 km (102.9 mi)
**Location:** US-CO, Routt County near Steamboat Springs
**Coordinates:** 40.4142, -106.7256

### Status
**Size:** 309 acres (125 hectares)
**Containment:** 100% ██████████
**Discovery Date:** 7/12/2026
**Days Active:** 32

---

## Aspen Acres

**Type:** 🔥 Wildfire
**Distance:** 177.5 km (110.3 mi)
**Location:** US-CO, Custer County near Beulah
**Coordinates:** 38.1500, -105.1855

### Status
**Size:** 102003 acres (41279 hectares)
**Containment:** 72% ███████░░░
**Discovery Date:** 6/29/2026
**Days Active:** 45

---

## Fuhr Gulch

**Type:** 🔥 Wildfire
**Distance:** 249.0 km (154.7 mi)
**Location:** US-CO, Moffat County near Craig
**Coordinates:** 40.4128, -107.7817

### Status
**Size:** 1650 acres (668 hectares)
**Containment:** 100% ██████████
**Discovery Date:** 7/21/2026
**Days Active:** 22

---

## 310

**Type:** 🔥 Wildfire
**Distance:** 258.7 km (160.8 mi)
**Location:** US-CO, Garfield County near Parachute
**Coordinates:** 39.4448, -107.9855

### Status
**Size:** 603 acres (244 hectares)
**Containment:** 76% ████████░░
**Discovery Date:** 8/6/2026
**Days Active:** 7

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
**Your run is fine.** US AQI is **51 — barely into "Moderate"** — and the smoke signal specifically, PM2.5, is low at 8.8 μg/m³, so the distant fires aren't putting meaningful smoke at street level in Denver right now. Only unusually sensitive people are advised to trim prolonged outdoor exertion.

One thing the run *does* need: sunscreen. UV index is 5 (Moderate) this afternoon at Denver's elevation.
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

**Observation Time:** 8/13/2026, 2:00:00 PM

## 🟡 US Air Quality Index: 51

**Category:** Moderate (Yellow)
**Description:** Air quality is acceptable

**Health Implications:**
Air quality is acceptable; however, unusually sensitive people may experience minor respiratory symptoms.

⚠️ **Caution:** Unusually sensitive people should consider reducing prolonged outdoor exertion.

## 🟡 UV Index: 5.0

**Level:** Moderate
**Description:** Protection recommended
**Recommendation:** Wear sunscreen, hat, and sunglasses. Seek shade during midday hours.

*Note: UV index under clear sky would be 8.6*

## Pollutant Concentrations

**PM2.5 (Fine Particulate Matter):** 8.8 μg/m³
**PM10 (Coarse Particulate Matter):** 9.7 μg/m³
**Ozone (O₃):** 134 μg/m³
**Nitrogen Dioxide (NO₂):** 1.5 μg/m³
**Sulfur Dioxide (SO₂):** 0.70 μg/m³
**Carbon Monoxide (CO):** 147 μg/m³
**Ammonia (NH₃):** N/A
**Aerosol Optical Depth:** 0.320 (atmospheric haze indicator)

*European AQI: 61 (Poor)*
````

</details>
<!-- /capture:air-quality -->

---

**Features shown:** `get_wildfire_info` — active fires within a radius (NIFC), containment, distance, safety assessment tier · `get_air_quality` on the US path — US AQI scale, pollutant breakdown (PM2.5 is the smoke signal), UV index, health recommendations.

<!-- capture-stamp -->
*Captured 2026-08-13 with weather-mcp v1.18.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
