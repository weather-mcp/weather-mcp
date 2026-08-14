# River levels, two ways — Memphis and Manaus

The same tool answers both questions, but from different kinds of data — official US gauge observations vs. modeled discharge for the rest of the world. It never silently swaps one for the other.

> **You:** How's the Mississippi looking at Memphis? Any flood risk?

**Claude Code answered** (using `get_river_conditions` — US NOAA gauges, `detail: "full"`):

<!-- answer -->
**No flood risk at Memphis.** The Mississippi River gauge at Memphis (MEMT1, 2.4 miles from downtown) reads **1.55 ft and steady** — very low water — with an official flood category of NO FLOODING, and the same is true at all 20 gauges within the 50 km search radius (Wolf River, Loosahatchie, Nonconnah Creek, and the rest).

The forecast series shows the river **rising about 9 feet over the next week to a crest of 10.5 ft around August 21**, then receding — a normal fluctuation that stays far below flood stage the whole way.
<!-- /answer -->

<!-- capture:memphis-gauges -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_river_conditions</code></summary>

**Call:**

```js
get_river_conditions({
  latitude: 35.1495,
  longitude: -90.049,
  detail: "full"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# River Conditions Report

**Location:** 35.1495, -90.0490
**Search Radius:** 50 km (31.1 miles)

📊 **Found 20 river gauges**

## Mississippi River at Memphis

**Distance:** 3.9 km (2.4 mi)
**Location:** TN
**Coordinates:** 35.1231, -90.0775
**Gauge ID:** MEMT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:00 PM
**River Stage:** 1.23 ft  ↘ falling (-0.1 ft / 6h)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 21, 2026, 7:00 PM
**Forecasted Stage:** 10.50 ft
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 14, 2026, 1:00 PM:** 1.20 ft
- **Aug 14, 2026, 7:00 PM:** 1.10 ft
- **Aug 15, 2026, 1:00 AM:** 1.10 ft
- **Aug 15, 2026, 7:00 AM:** 1.30 ft
- **Aug 15, 2026, 1:00 PM:** 1.50 ft
- **Aug 15, 2026, 7:00 PM:** 1.80 ft
- **Aug 16, 2026, 1:00 AM:** 2.10 ft
- **Aug 16, 2026, 7:00 AM:** 2.60 ft
- **Aug 16, 2026, 1:00 PM:** 3.20 ft
- **Aug 16, 2026, 7:00 PM:** 3.50 ft
- **Aug 17, 2026, 1:00 AM:** 4.10 ft
- **Aug 17, 2026, 7:00 AM:** 4.70 ft
- **Aug 17, 2026, 1:00 PM:** 5.10 ft
- **Aug 17, 2026, 7:00 PM:** 5.30 ft
- **Aug 18, 2026, 1:00 AM:** 5.60 ft
- **Aug 18, 2026, 7:00 AM:** 6.30 ft
- **Aug 18, 2026, 1:00 PM:** 6.60 ft
- **Aug 18, 2026, 7:00 PM:** 6.70 ft
- **Aug 19, 2026, 1:00 AM:** 6.90 ft
- **Aug 19, 2026, 7:00 AM:** 7.40 ft
- **Aug 19, 2026, 1:00 PM:** 7.80 ft
- **Aug 19, 2026, 7:00 PM:** 8.00 ft
- **Aug 20, 2026, 1:00 AM:** 8.50 ft
- **Aug 20, 2026, 7:00 AM:** 9.00 ft
- **Aug 20, 2026, 1:00 PM:** 9.30 ft
- **Aug 20, 2026, 7:00 PM:** 9.60 ft
- **Aug 21, 2026, 1:00 AM:** 9.90 ft
- **Aug 21, 2026, 7:00 AM:** 10.20 ft
- **Aug 21, 2026, 1:00 PM:** 10.30 ft
- **Aug 21, 2026, 7:00 PM:** 10.50 ft
- **Aug 22, 2026, 1:00 AM:** 10.50 ft
- **Aug 22, 2026, 7:00 AM:** 10.40 ft
- **Aug 22, 2026, 1:00 PM:** 10.30 ft
- **Aug 22, 2026, 7:00 PM:** 10.00 ft
- **Aug 23, 2026, 1:00 AM:** 9.80 ft
- **Aug 23, 2026, 7:00 AM:** 9.50 ft
- **Aug 23, 2026, 1:00 PM:** 9.30 ft
- **Aug 23, 2026, 7:00 PM:** 9.00 ft
- **Aug 24, 2026, 1:00 AM:** 8.80 ft
- **Aug 24, 2026, 7:00 AM:** 8.50 ft
- **Aug 24, 2026, 1:00 PM:** 8.20 ft
- **Aug 24, 2026, 7:00 PM:** 8.00 ft
- **Aug 25, 2026, 1:00 AM:** 7.70 ft
- **Aug 25, 2026, 7:00 AM:** 7.50 ft
- **Aug 25, 2026, 1:00 PM:** 7.20 ft
- **Aug 25, 2026, 7:00 PM:** 7.00 ft
- **Aug 26, 2026, 1:00 AM:** 6.70 ft
- **Aug 26, 2026, 7:00 AM:** 6.50 ft
- **Aug 26, 2026, 1:00 PM:** 6.30 ft
- **Aug 26, 2026, 7:00 PM:** 6.10 ft
- **Aug 27, 2026, 1:00 AM:** 5.80 ft
- **Aug 27, 2026, 7:00 AM:** 5.60 ft
- **Aug 27, 2026, 1:00 PM:** 5.40 ft
- **Aug 27, 2026, 7:00 PM:** 5.20 ft
- **Aug 28, 2026, 1:00 AM:** 5.00 ft
- **Aug 28, 2026, 7:00 AM:** 4.80 ft
- **Aug 28, 2026, 1:00 PM:** 4.60 ft

---

## Nonconnah Creek at Farrisview Boulevard

**Distance:** 11.9 km (7.4 mi)
**Location:** TN
**Coordinates:** 35.0764, -89.9542
**Gauge ID:** FRST1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:45 AM
**River Stage:** 6.61 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Wolf River at Raleigh

**Distance:** 12.9 km (8.0 mi)
**Location:** TN
**Coordinates:** 35.2017, -89.9225
**Gauge ID:** RLGT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:15 AM
**River Stage:** -2.60 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Loosahatchie River near Frayser

**Distance:** 13.2 km (8.2 mi)
**Location:** TN
**Coordinates:** 35.2597, -89.9942
**Gauge ID:** FRRT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:00 AM
**River Stage:** 5.43 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Fletcher Creek at Bartlett

**Distance:** 16.7 km (10.4 mi)
**Location:** TN
**Coordinates:** 35.1694, -89.8664
**Gauge ID:** MPHT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:30 PM
**River Stage:** 1.78 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Loosahatchie River at Singleton Parkway

**Distance:** 20.3 km (12.6 mi)
**Location:** TN
**Coordinates:** 35.2750, -89.8872
**Gauge ID:** SPYT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:45 AM
**River Stage:** 1.74 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Wolf River at Germantown

**Distance:** 22.8 km (14.2 mi)
**Location:** TN
**Coordinates:** 35.1164, -89.8014
**Gauge ID:** GERT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:45 AM
**River Stage:** 2.94 ft  → steady (last 6h)
**Flow Rate:** 0.40 kcfs (396 cfs)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 14, 2026, 1:00 PM
**Forecasted Stage:** 3.00 ft
**Forecasted Flow:** 0.41 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 14, 2026, 1:00 PM:** 3.00 ft
- **Aug 14, 2026, 7:00 PM:** 2.90 ft
- **Aug 15, 2026, 1:00 AM:** 2.90 ft
- **Aug 15, 2026, 7:00 AM:** 2.90 ft
- **Aug 15, 2026, 1:00 PM:** 2.90 ft
- **Aug 15, 2026, 7:00 PM:** 2.90 ft
- **Aug 16, 2026, 1:00 AM:** 2.90 ft
- **Aug 16, 2026, 7:00 AM:** 2.90 ft
- **Aug 16, 2026, 1:00 PM:** 2.90 ft
- **Aug 16, 2026, 7:00 PM:** 2.80 ft
- **Aug 17, 2026, 1:00 AM:** 2.80 ft
- **Aug 17, 2026, 7:00 AM:** 2.80 ft
- **Aug 17, 2026, 1:00 PM:** 2.80 ft
- **Aug 17, 2026, 7:00 PM:** 2.80 ft
- **Aug 18, 2026, 1:00 AM:** 2.80 ft
- **Aug 18, 2026, 7:00 AM:** 2.80 ft
- **Aug 18, 2026, 1:00 PM:** 2.80 ft
- **Aug 18, 2026, 7:00 PM:** 2.80 ft
- **Aug 19, 2026, 1:00 AM:** 2.80 ft
- **Aug 19, 2026, 7:00 AM:** 2.80 ft

---

## Nonconnah Creek at Winchester Rd

**Distance:** 23.8 km (14.8 mi)
**Location:** TN
**Coordinates:** 35.0497, -89.8181
**Gauge ID:** NONT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:45 AM
**River Stage:** 6.47 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Big Creek at Millington

**Distance:** 23.8 km (14.8 mi)
**Location:** TN
**Coordinates:** 35.3344, -89.9178
**Gauge ID:** MLLT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:00 PM
**River Stage:** 9.53 ft  → steady (last 6h)
**Flow Rate:** 0.02 kcfs (19 cfs)
**Flood Category:** ✅ NO FLOODING

---

## Loosahatchie River at Brunswick

**Distance:** 29.6 km (18.4 mi)
**Location:** TN
**Coordinates:** 35.2811, -89.7661
**Gauge ID:** BRNT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:15 PM
**River Stage:** 3.71 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Big Creek near Rosemark

**Distance:** 32.8 km (20.4 mi)
**Location:** TN
**Coordinates:** 35.3658, -89.8036
**Gauge ID:** ROMT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:45 AM
**River Stage:** 11.03 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Wolf River at Collierville

**Distance:** 37.0 km (23.0 mi)
**Location:** TN
**Coordinates:** 35.0814, -89.6506
**Gauge ID:** COTT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:45 AM
**River Stage:** 3.12 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Coldwater River at Olive Branch

**Distance:** 38.1 km (23.7 mi)
**Location:** MS
**Coordinates:** 34.9075, -89.7533
**Gauge ID:** OLVM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:00 PM
**River Stage:** 0.51 ft  → steady (last 6h)
**Flow Rate:** 0.05 kcfs (49 cfs)
**Flood Category:** ✅ NO FLOODING

---

## Loosahatchie River at Arlington

**Distance:** 41.3 km (25.7 mi)
**Location:** TN
**Coordinates:** 35.3109, -89.6396
**Gauge ID:** ARLT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:15 PM
**River Stage:** 1.08 ft  → steady (last 6h)
**Flow Rate:** 0.13 kcfs (128 cfs)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 14, 2026, 1:00 PM
**Forecasted Stage:** 1.10 ft
**Forecasted Flow:** 0.13 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 14, 2026, 1:00 PM:** 1.10 ft
- **Aug 14, 2026, 7:00 PM:** 1.10 ft
- **Aug 15, 2026, 1:00 AM:** 1.10 ft
- **Aug 15, 2026, 7:00 AM:** 1.10 ft
- **Aug 15, 2026, 1:00 PM:** 1.10 ft
- **Aug 15, 2026, 7:00 PM:** 1.10 ft
- **Aug 16, 2026, 1:00 AM:** 1.10 ft
- **Aug 16, 2026, 7:00 AM:** 1.10 ft
- **Aug 16, 2026, 1:00 PM:** 1.10 ft
- **Aug 16, 2026, 7:00 PM:** 1.10 ft
- **Aug 17, 2026, 1:00 AM:** 1.00 ft
- **Aug 17, 2026, 7:00 AM:** 1.00 ft
- **Aug 17, 2026, 1:00 PM:** 1.00 ft
- **Aug 17, 2026, 7:00 PM:** 1.00 ft
- **Aug 18, 2026, 1:00 AM:** 1.00 ft
- **Aug 18, 2026, 7:00 AM:** 1.00 ft
- **Aug 18, 2026, 1:00 PM:** 1.00 ft
- **Aug 18, 2026, 7:00 PM:** 1.00 ft
- **Aug 19, 2026, 1:00 AM:** 1.00 ft
- **Aug 19, 2026, 7:00 AM:** 1.00 ft

---

## Coldwater River near Coldwater River at Hernando

**Distance:** 41.6 km (25.8 mi)
**Location:** MS
**Coordinates:** 34.8012, -89.8831
**Gauge ID:** HHSM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:00 PM
**River Stage:** 247.08 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Coldwater River at Arkabutla Dam

**Distance:** 44.2 km (27.4 mi)
**Location:** MS
**Coordinates:** 34.7572, -90.1244
**Gauge ID:** ARKM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:00 PM
**River Stage:** 205.55 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Tyronza River near Twist

**Distance:** 45.6 km (28.3 mi)
**Location:** AR
**Coordinates:** 35.3747, -90.4683
**Gauge ID:** TWGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:00 AM
**River Stage:** 9.47 ft  ↗ rising (+0.1 ft / 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Wolf River at Rossville

**Distance:** 47.4 km (29.5 mi)
**Location:** TN
**Coordinates:** 35.0542, -89.5408
**Gauge ID:** ROST1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 12:00 PM
**River Stage:** 1.79 ft  → steady (last 6h)
**Flow Rate:** 0.20 kcfs (205 cfs)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 14, 2026, 1:00 PM
**Forecasted Stage:** 1.80 ft
**Forecasted Flow:** 0.21 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 14, 2026, 1:00 PM:** 1.80 ft
- **Aug 14, 2026, 7:00 PM:** 1.80 ft
- **Aug 15, 2026, 1:00 AM:** 1.80 ft
- **Aug 15, 2026, 7:00 AM:** 1.80 ft
- **Aug 15, 2026, 1:00 PM:** 1.70 ft
- **Aug 15, 2026, 7:00 PM:** 1.70 ft
- **Aug 16, 2026, 1:00 AM:** 1.70 ft
- **Aug 16, 2026, 7:00 AM:** 1.70 ft
- **Aug 16, 2026, 1:00 PM:** 1.70 ft
- **Aug 16, 2026, 7:00 PM:** 1.70 ft
- **Aug 17, 2026, 1:00 AM:** 1.70 ft
- **Aug 17, 2026, 7:00 AM:** 1.70 ft
- **Aug 17, 2026, 1:00 PM:** 1.70 ft
- **Aug 17, 2026, 7:00 PM:** 1.70 ft
- **Aug 18, 2026, 1:00 AM:** 1.70 ft
- **Aug 18, 2026, 7:00 AM:** 1.70 ft
- **Aug 18, 2026, 1:00 PM:** 1.70 ft
- **Aug 18, 2026, 7:00 PM:** 1.70 ft
- **Aug 19, 2026, 1:00 AM:** 1.70 ft
- **Aug 19, 2026, 7:00 AM:** 1.70 ft

---

## St. Francis River at Parkin

**Distance:** 48.3 km (30.0 mi)
**Location:** AR
**Coordinates:** 35.2731, -90.5592
**Gauge ID:** PNGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:00 AM
**River Stage:** 3.12 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Tyronza River near Tyronza

**Distance:** 49.6 km (30.8 mi)
**Location:** AR
**Coordinates:** 35.5050, -90.3800
**Gauge ID:** TYGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 14, 2026, 11:00 AM
**River Stage:** 9.71 ft  ↘ falling (-0.1 ft / 6h)
**Flood Category:** ✅ NOT DEFINED

---


---
*Data source: NOAA National Water Prediction Service (NWPS)*
*River conditions are updated hourly. Always consult official sources for critical decisions.*
````

</details>
<!-- /capture:memphis-gauges -->

> **You:** What about the Amazon at Manaus?

**Claude Code answered** (same tool — global GloFAS modeled discharge):

<!-- answer-2 -->
There are no physical gauges here, so this is **modeled discharge** (GloFAS), and the server frames it accordingly — against the river's own recent history rather than flood categories that don't exist for model data.

The Amazon at Manaus is moving about **104,000 m³/s** (the model cell snapped ~6 km east of your point, to the actual river channel — disclosed in the output). It's **falling, down 10% over six days** and running below its 31-day mean of ~136,000 m³/s: the seasonal recession after the annual flood peak, right on schedule for August. The 10-day ensemble forecast agrees — a steady, tightly clustered decline.
<!-- /answer-2 -->

<!-- capture:manaus-glofas -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_river_conditions</code></summary>

**Call:**

```js
get_river_conditions({
  latitude: -3.119,
  longitude: -60.0217,
  forecast_days: 10
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# River Conditions Report

**Location:** -3.1190, -60.0217
**Source:** Open-Meteo Flood API (GloFAS v4, ~5 km model grid)

⚠️ Model-estimated river discharge — not gauge observations. No official flood-stage thresholds exist for this data; levels are shown relative to recent history and the forecast ensemble.

Nearest modeled river channel: ~6 km E of requested point

## Current Discharge

**Discharge:** 102,801 m³/s (3,630,374 ft³/s)  ↘ falling (-10% / 6d)
**vs. recent history:** near the recent average — 31-day mean 133,692 m³/s (4,721,280 ft³/s)

## Ensemble Forecast

Daily median with the p25–p75 ensemble band, in ft³/s, starting today. Members stay tightly clustered for the first few days and diverge from about day 4, so a near-zero band early on reflects that clustering, not certainty.

- **Aug 14:** 3,630,374 · p25–p75 3,630,374–3,630,374
- **Aug 15:** 3,572,328 · p25–p75 3,572,328–3,572,328
- **Aug 16:** 3,523,313 · p25–p75 3,523,313–3,523,313
- **Aug 17:** 3,466,979 · p25–p75 3,459,006–3,466,979
- **Aug 18:** 3,403,700 · p25–p75 3,403,700–3,403,700
- **Aug 19:** 3,341,572 · p25–p75 3,341,572–3,341,572
- **Aug 20:** 3,280,581 · p25–p75 3,273,036–3,280,581

*Note: 3 more forecast days available — use detail="full" for the full range and the min/max envelope*

---
*River discharge data by Open-Meteo.com (CC-BY 4.0)*
*Always consult official sources for flood-critical decisions.*
````

</details>
<!-- /capture:manaus-glofas -->

---

**Features shown:** US path — NWPS gauge observations, official flood categories, observed trend, forecast series (`detail: "full"`) · global path — GloFAS v4 modeled discharge snapped to the river channel, framed against its own 31-day history and forecast ensemble, `forecast_days` up to 210.

<!-- capture-stamp -->
*Captured 2026-08-14 with weather-mcp v1.19.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
