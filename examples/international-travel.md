# Traveling abroad — Paris

> **You:** What's the weather actually being observed in Paris right now — a real station reading, not a model guess? And how's the air quality? My allergies have been brutal.

**Claude Code answered** (using `get_current_conditions` with `source: "metar"`):

<!-- answer -->
Here's an actual instrument reading, not a model estimate. The nearest reporting airport station is **Villacoublay air base (LFPV), 13 km southwest of central Paris**, observed at 22:00 local time, 8 minutes before you asked:

- **31°C** — a genuinely hot evening — and remarkably dry: dew point 7°C, just 22% humidity.
- Light northeast wind at 7 km/h, visibility 10 km+, pressure 1019 hPa.
- The raw METAR says `CAVOK` — ceiling and visibility OK, i.e. clear skies. Flight category VFR.

Note what the server discloses by design: which station this is, how far away it is, and how old the reading is — a METAR measures conditions *at the airport*, so you always know exactly what you're getting.
<!-- /answer -->

<!-- capture:metar -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_current_conditions</code></summary>

**Call:**

```js
get_current_conditions({
  city_name: "Paris, France",
  source: "metar",
  units: "metric"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
**Location:** Paris, Ile-de-France, Metropolitan France, France (48.8589, 2.3200)

# Current Conditions — Villacoublay, ID, FR (LFPV)

**Station:** Villacoublay, ID, FR (LFPV) — 13 km SW of the requested point, elev 171m
**Observed:** Aug 13, 2026, 22:00 GMT+2 (8 minutes ago)

**Temperature:** 31°C (dew point 7°C, humidity 22%)
**Wind:** NNE (30°) at 7 km/h
**Visibility:** +9.7 km
**Pressure:** 1019 hPa
**Flight category:** VFR

`METAR LFPV 132000Z AUTO 03004KT CAVOK 31/07 Q1019 NOSIG`

---
*Data source: NOAA Aviation Weather Center (aviationweather.gov) — METAR station observation*
````

</details>
<!-- /capture:metar -->

**And for air quality and pollen** (using `get_air_quality`):

<!-- answer-2 -->
Air quality is decent: **European AQI 35 — "Fair"** — normal outdoor activity is fine.

For your allergies, the pollen breakdown (automatic for European locations) is the useful part: tree pollens (alder, birch, olive) are at **zero**, grass is low at 4.2 grains/m³, but **mugwort is the one to watch at 11.7 grains/m³** — classic late-summer weed pollen. If you know you react to mugwort/weed pollen, take your antihistamine; if your trigger is trees or grass, Paris should treat you kindly right now.
<!-- /answer-2 -->

<!-- capture:air-quality -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_air_quality</code></summary>

**Call:**

```js
get_air_quality({
  latitude: 48.8566,
  longitude: 2.3522
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Air Quality Report

**Location:** 48.8566, 2.3522
**Timezone:** Europe/Paris
**Elevation:** 36m

**Observation Time:** 8/13/2026, 10:00:00 PM

## 🟢 European Air Quality Index: 35

**Category:** Fair (Green)
**Description:** Air quality is fair

**Health Implications:**
Enjoy your usual outdoor activities.

## 🟢 UV Index: 0.0

**Level:** Low
**Description:** Minimal protection required
**Recommendation:** No protection required. You can safely stay outside.

## Pollutant Concentrations

**PM2.5 (Fine Particulate Matter):** 7.8 μg/m³
**PM10 (Coarse Particulate Matter):** 17 μg/m³
**Ozone (O₃):** 87 μg/m³
**Nitrogen Dioxide (NO₂):** 24 μg/m³
**Sulfur Dioxide (SO₂):** 1.5 μg/m³
**Carbon Monoxide (CO):** 195 μg/m³
**Ammonia (NH₃):** 2.8 μg/m³
**Aerosol Optical Depth:** 0.110 (atmospheric haze indicator)

## 🌾 Pollen

**Alder:** 0 grains/m³
**Birch:** 0 grains/m³
**Grass:** 4.2 grains/m³
**Mugwort:** 11.7 grains/m³
**Olive:** 0 grains/m³
**Ragweed:** 0.1 grains/m³

*Pollen from the CAMS European forecast — available for European locations only.*

*US AQI: 94 (Moderate)*
````

</details>
<!-- /capture:air-quality -->

---

**Features shown:** `source: "metar"` — real airport instrument observations anywhere on earth (station, distance, bearing, observation age always disclosed) · European pollen levels on `get_air_quality` (automatic for European locations) · European EAQI air-quality scale · per-call `units: "metric"`.

<!-- capture-stamp -->
*Captured 2026-08-13 with weather-mcp v1.18.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
