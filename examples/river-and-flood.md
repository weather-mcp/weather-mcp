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
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 12.68 ft  ↘ falling (-0.3 ft / 6h)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 27, 2026, 7:00 PM
**Forecasted Stage:** 12.60 ft
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 27, 2026, 1:00 PM:** 12.90 ft
- **Aug 27, 2026, 7:00 PM:** 12.60 ft
- **Aug 28, 2026, 1:00 AM:** 12.20 ft
- **Aug 28, 2026, 7:00 AM:** 11.90 ft
- **Aug 28, 2026, 1:00 PM:** 11.50 ft
- **Aug 28, 2026, 7:00 PM:** 11.20 ft
- **Aug 29, 2026, 1:00 AM:** 10.90 ft
- **Aug 29, 2026, 7:00 AM:** 10.50 ft
- **Aug 29, 2026, 1:00 PM:** 10.20 ft
- **Aug 29, 2026, 7:00 PM:** 9.90 ft
- **Aug 30, 2026, 1:00 AM:** 9.50 ft
- **Aug 30, 2026, 7:00 AM:** 9.10 ft
- **Aug 30, 2026, 1:00 PM:** 8.80 ft
- **Aug 30, 2026, 7:00 PM:** 8.50 ft
- **Aug 31, 2026, 1:00 AM:** 8.10 ft
- **Aug 31, 2026, 7:00 AM:** 7.70 ft
- **Aug 31, 2026, 1:00 PM:** 7.30 ft
- **Aug 31, 2026, 7:00 PM:** 7.00 ft
- **Sep 1, 2026, 1:00 AM:** 6.80 ft
- **Sep 1, 2026, 7:00 AM:** 6.40 ft
- **Sep 1, 2026, 1:00 PM:** 6.10 ft
- **Sep 1, 2026, 7:00 PM:** 5.90 ft
- **Sep 2, 2026, 1:00 AM:** 5.70 ft
- **Sep 2, 2026, 7:00 AM:** 5.50 ft
- **Sep 2, 2026, 1:00 PM:** 5.30 ft
- **Sep 2, 2026, 7:00 PM:** 5.10 ft
- **Sep 3, 2026, 1:00 AM:** 5.00 ft
- **Sep 3, 2026, 7:00 AM:** 4.90 ft
- **Sep 3, 2026, 1:00 PM:** 4.90 ft
- **Sep 3, 2026, 7:00 PM:** 4.70 ft
- **Sep 4, 2026, 1:00 AM:** 4.60 ft
- **Sep 4, 2026, 7:00 AM:** 4.40 ft
- **Sep 4, 2026, 1:00 PM:** 4.20 ft
- **Sep 4, 2026, 7:00 PM:** 4.00 ft
- **Sep 5, 2026, 1:00 AM:** 3.80 ft
- **Sep 5, 2026, 7:00 AM:** 3.60 ft
- **Sep 5, 2026, 1:00 PM:** 3.30 ft
- **Sep 5, 2026, 7:00 PM:** 3.10 ft
- **Sep 6, 2026, 1:00 AM:** 2.90 ft
- **Sep 6, 2026, 7:00 AM:** 2.70 ft
- **Sep 6, 2026, 1:00 PM:** 2.40 ft
- **Sep 6, 2026, 7:00 PM:** 2.20 ft
- **Sep 7, 2026, 1:00 AM:** 2.00 ft
- **Sep 7, 2026, 7:00 AM:** 1.80 ft
- **Sep 7, 2026, 1:00 PM:** 1.60 ft
- **Sep 7, 2026, 7:00 PM:** 1.30 ft
- **Sep 8, 2026, 1:00 AM:** 1.10 ft
- **Sep 8, 2026, 7:00 AM:** 0.90 ft
- **Sep 8, 2026, 1:00 PM:** 0.70 ft
- **Sep 8, 2026, 7:00 PM:** 0.50 ft
- **Sep 9, 2026, 1:00 AM:** 0.30 ft
- **Sep 9, 2026, 7:00 AM:** 0.10 ft
- **Sep 9, 2026, 1:00 PM:** -0.10 ft
- **Sep 9, 2026, 7:00 PM:** -0.20 ft
- **Sep 10, 2026, 1:00 AM:** -0.40 ft
- **Sep 10, 2026, 7:00 AM:** -0.60 ft
- **Sep 10, 2026, 1:00 PM:** -0.80 ft

---

## Nonconnah Creek at Farrisview Boulevard

**Distance:** 11.9 km (7.4 mi)
**Location:** TN
**Coordinates:** 35.0764, -89.9542
**Gauge ID:** FRST1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:45 PM
**River Stage:** 6.68 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Wolf River at Raleigh

**Distance:** 12.9 km (8.0 mi)
**Location:** TN
**Coordinates:** 35.2017, -89.9225
**Gauge ID:** RLGT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:15 PM
**River Stage:** -2.80 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Loosahatchie River near Frayser

**Distance:** 13.2 km (8.2 mi)
**Location:** TN
**Coordinates:** 35.2597, -89.9942
**Gauge ID:** FRRT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:00 PM
**River Stage:** 5.37 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Fletcher Creek at Bartlett

**Distance:** 16.7 km (10.4 mi)
**Location:** TN
**Coordinates:** 35.1694, -89.8664
**Gauge ID:** MPHT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:30 PM
**River Stage:** 1.93 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Loosahatchie River at Singleton Parkway

**Distance:** 20.3 km (12.6 mi)
**Location:** TN
**Coordinates:** 35.2750, -89.8872
**Gauge ID:** SPYT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:45 PM
**River Stage:** 1.76 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Wolf River at Germantown

**Distance:** 22.8 km (14.2 mi)
**Location:** TN
**Coordinates:** 35.1164, -89.8014
**Gauge ID:** GERT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:45 PM
**River Stage:** 2.80 ft  → steady (last 6h)
**Flow Rate:** 0.19 kcfs (193 cfs)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 28, 2026, 1:00 AM
**Forecasted Stage:** 3.00 ft
**Forecasted Flow:** 0.25 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 27, 2026, 1:00 PM:** 2.80 ft
- **Aug 27, 2026, 7:00 PM:** 2.80 ft
- **Aug 28, 2026, 1:00 AM:** 3.00 ft
- **Aug 28, 2026, 7:00 AM:** 2.90 ft
- **Aug 28, 2026, 1:00 PM:** 2.90 ft
- **Aug 28, 2026, 7:00 PM:** 2.80 ft
- **Aug 29, 2026, 1:00 AM:** 2.80 ft
- **Aug 29, 2026, 7:00 AM:** 2.80 ft
- **Aug 29, 2026, 1:00 PM:** 2.80 ft
- **Aug 29, 2026, 7:00 PM:** 2.80 ft
- **Aug 30, 2026, 1:00 AM:** 2.80 ft
- **Aug 30, 2026, 7:00 AM:** 2.80 ft
- **Aug 30, 2026, 1:00 PM:** 2.80 ft
- **Aug 30, 2026, 7:00 PM:** 2.80 ft
- **Aug 31, 2026, 1:00 AM:** 2.80 ft
- **Aug 31, 2026, 7:00 AM:** 2.80 ft
- **Aug 31, 2026, 1:00 PM:** 2.80 ft
- **Aug 31, 2026, 7:00 PM:** 2.80 ft
- **Sep 1, 2026, 1:00 AM:** 2.80 ft
- **Sep 1, 2026, 7:00 AM:** 2.80 ft

---

## Nonconnah Creek at Winchester Rd

**Distance:** 23.8 km (14.8 mi)
**Location:** TN
**Coordinates:** 35.0497, -89.8181
**Gauge ID:** NONT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:45 PM
**River Stage:** 6.58 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Big Creek at Millington

**Distance:** 23.8 km (14.8 mi)
**Location:** TN
**Coordinates:** 35.3344, -89.9178
**Gauge ID:** MLLT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 9.51 ft  → steady (last 6h)
**Flow Rate:** 0.02 kcfs (18 cfs)
**Flood Category:** ✅ NO FLOODING

---

## Loosahatchie River at Brunswick

**Distance:** 29.6 km (18.4 mi)
**Location:** TN
**Coordinates:** 35.2811, -89.7661
**Gauge ID:** BRNT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:15 PM
**River Stage:** 3.67 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Big Creek near Rosemark

**Distance:** 32.8 km (20.4 mi)
**Location:** TN
**Coordinates:** 35.3658, -89.8036
**Gauge ID:** ROMT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:45 PM
**River Stage:** 11.02 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Wolf River at Collierville

**Distance:** 37.0 km (23.0 mi)
**Location:** TN
**Coordinates:** 35.0814, -89.6506
**Gauge ID:** COTT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:45 PM
**River Stage:** 3.04 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

---

## Coldwater River at Olive Branch

**Distance:** 38.1 km (23.7 mi)
**Location:** MS
**Coordinates:** 34.9075, -89.7533
**Gauge ID:** OLVM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 0.55 ft  → steady (last 6h)
**Flow Rate:** 0.05 kcfs (53 cfs)
**Flood Category:** ✅ NO FLOODING

---

## Loosahatchie River at Arlington

**Distance:** 41.3 km (25.7 mi)
**Location:** TN
**Coordinates:** 35.3109, -89.6396
**Gauge ID:** ARLT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:15 PM
**River Stage:** 0.91 ft  → steady (last 6h)
**Flow Rate:** 0.11 kcfs (108 cfs)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 27, 2026, 7:00 PM
**Forecasted Stage:** 0.90 ft
**Forecasted Flow:** 0.11 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 27, 2026, 1:00 PM:** 0.90 ft
- **Aug 27, 2026, 7:00 PM:** 0.90 ft
- **Aug 28, 2026, 1:00 AM:** 0.90 ft
- **Aug 28, 2026, 7:00 AM:** 0.90 ft
- **Aug 28, 2026, 1:00 PM:** 0.90 ft
- **Aug 28, 2026, 7:00 PM:** 0.90 ft
- **Aug 29, 2026, 1:00 AM:** 0.90 ft
- **Aug 29, 2026, 7:00 AM:** 0.90 ft
- **Aug 29, 2026, 1:00 PM:** 0.90 ft
- **Aug 29, 2026, 7:00 PM:** 0.90 ft
- **Aug 30, 2026, 1:00 AM:** 0.90 ft
- **Aug 30, 2026, 7:00 AM:** 0.90 ft
- **Aug 30, 2026, 1:00 PM:** 0.90 ft
- **Aug 30, 2026, 7:00 PM:** 0.90 ft
- **Aug 31, 2026, 1:00 AM:** 0.90 ft
- **Aug 31, 2026, 7:00 AM:** 0.90 ft
- **Aug 31, 2026, 1:00 PM:** 0.90 ft
- **Aug 31, 2026, 7:00 PM:** 0.90 ft
- **Sep 1, 2026, 1:00 AM:** 0.90 ft
- **Sep 1, 2026, 7:00 AM:** 0.90 ft

---

## Coldwater River near Coldwater River at Hernando

**Distance:** 41.6 km (25.8 mi)
**Location:** MS
**Coordinates:** 34.8012, -89.8831
**Gauge ID:** HHSM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 247.17 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Coldwater River at Arkabutla Dam

**Distance:** 44.2 km (27.4 mi)
**Location:** MS
**Coordinates:** 34.7572, -90.1244
**Gauge ID:** ARKM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 207.74 ft  ↗ rising (+0.1 ft / 6h)
**Flood Category:** ✅ NO FLOODING

---

## Tyronza River near Twist

**Distance:** 45.6 km (28.3 mi)
**Location:** AR
**Coordinates:** 35.3747, -90.4683
**Gauge ID:** TWGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 8.17 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Wolf River at Rossville

**Distance:** 47.4 km (29.5 mi)
**Location:** TN
**Coordinates:** 35.0542, -89.5408
**Gauge ID:** ROST1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 4:00 PM
**River Stage:** 1.65 ft  → steady (last 6h)
**Flow Rate:** 0.18 kcfs (181 cfs)
**Flood Category:** ✅ NO FLOODING

### Forecast
**Valid Time:** Aug 27, 2026, 7:00 PM
**Forecasted Stage:** 1.70 ft
**Forecasted Flow:** 0.19 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 27, 2026, 1:00 PM:** 1.70 ft
- **Aug 27, 2026, 7:00 PM:** 1.70 ft
- **Aug 28, 2026, 1:00 AM:** 1.70 ft
- **Aug 28, 2026, 7:00 AM:** 1.70 ft
- **Aug 28, 2026, 1:00 PM:** 1.70 ft
- **Aug 28, 2026, 7:00 PM:** 1.70 ft
- **Aug 29, 2026, 1:00 AM:** 1.70 ft
- **Aug 29, 2026, 7:00 AM:** 1.70 ft
- **Aug 29, 2026, 1:00 PM:** 1.70 ft
- **Aug 29, 2026, 7:00 PM:** 1.70 ft
- **Aug 30, 2026, 1:00 AM:** 1.70 ft
- **Aug 30, 2026, 7:00 AM:** 1.70 ft
- **Aug 30, 2026, 1:00 PM:** 1.60 ft
- **Aug 30, 2026, 7:00 PM:** 1.60 ft
- **Aug 31, 2026, 1:00 AM:** 1.60 ft
- **Aug 31, 2026, 7:00 AM:** 1.60 ft
- **Aug 31, 2026, 1:00 PM:** 1.60 ft
- **Aug 31, 2026, 7:00 PM:** 1.60 ft
- **Sep 1, 2026, 1:00 AM:** 1.60 ft
- **Sep 1, 2026, 7:00 AM:** 1.60 ft

---

## St. Francis River at Parkin

**Distance:** 48.3 km (30.0 mi)
**Location:** AR
**Coordinates:** 35.2731, -90.5592
**Gauge ID:** PNGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:00 PM
**River Stage:** 3.87 ft  ↘ falling (-0.4 ft / 6h)
**Flood Category:** ✅ NOT DEFINED

---

## Tyronza River near Tyronza

**Distance:** 49.6 km (30.8 mi)
**Location:** AR
**Coordinates:** 35.5050, -90.3800
**Gauge ID:** TYGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 27, 2026, 3:00 PM
**River Stage:** 8.86 ft  → steady (last 6h)
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

**Discharge:** 81,846 m³/s (2,890,349 ft³/s)  → steady (last 6d)
**vs. recent history:** near the recent average — 31-day mean 108,596 m³/s (3,835,045 ft³/s)

## Ensemble Forecast

Daily median with the p25–p75 ensemble band, in ft³/s, starting today. Members stay tightly clustered for the first few days and diverge from about day 4, so a near-zero band early on reflects that clustering, not certainty.

- **Aug 27:** 2,890,349 · p25–p75 2,890,349–2,890,349
- **Aug 28:** 2,844,135 · p25–p75 2,844,135–2,850,692
- **Aug 29:** 2,818,059 · p25–p75 2,818,059–2,818,059
- **Aug 30:** 2,792,221 · p25–p75 2,792,221–2,792,221
- **Aug 31:** 2,773,001 · p25–p75 2,773,001–2,773,001
- **Sep 1:** 2,753,913 · p25–p75 2,753,913–2,760,261
- **Sep 2:** 2,747,576 · p25–p75 2,747,576–2,753,913

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
*Captured 2026-08-27 with weather-mcp v1.25.6 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
