# River levels, two ways — Memphis and Manaus

The same tool answers both questions, but from different kinds of data — official US gauge observations vs. modeled discharge for the rest of the world. It never silently swaps one for the other.

> **You:** How's the Mississippi looking at Memphis? Any flood risk?

**Claude Code answered** (using `get_river_conditions` — US NOAA gauges, `detail: "full"`):

<!-- answer -->
**No flood risk at Memphis.** The Mississippi River gauge at Memphis (MEMT1, 2.4 miles from downtown) reads **9.54 ft and falling** — about a third of its 28 ft action stage — with an official flood category of NO FLOODING, and the same is true at all 20 gauges within the 50 km search radius (Wolf River, Loosahatchie, Nonconnah Creek, and the rest).

The forecast series shows the river **continuing to fall through mid-September**, to around -2.3 ft — a normal late-summer drawdown that stays far below flood stage the whole way.

Every gauge carries a **Flood Stages** section. Fourteen of the twenty publish the thresholds NOAA has set for them; the other six state plainly that NOAA publishes none, rather than leaving a silent gap the reader would have to interpret.
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
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 9.54 ft  ↘ falling (-0.4 ft / 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 28.0 ft
**Minor Flood:** 34.0 ft
**Moderate Flood:** 40.0 ft
**Major Flood:** 46.0 ft

**Current stage is 34% of action stage**

### Forecast
**Valid Time:** Aug 30, 2026, 1:00 AM
**Forecasted Stage:** 9.10 ft
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 29, 2026, 1:00 PM:** 9.90 ft
- **Aug 29, 2026, 7:00 PM:** 9.50 ft
- **Aug 30, 2026, 1:00 AM:** 9.10 ft
- **Aug 30, 2026, 7:00 AM:** 8.70 ft
- **Aug 30, 2026, 1:00 PM:** 8.20 ft
- **Aug 30, 2026, 7:00 PM:** 7.80 ft
- **Aug 31, 2026, 1:00 AM:** 7.40 ft
- **Aug 31, 2026, 7:00 AM:** 7.10 ft
- **Aug 31, 2026, 1:00 PM:** 6.70 ft
- **Aug 31, 2026, 7:00 PM:** 6.40 ft
- **Sep 1, 2026, 1:00 AM:** 6.10 ft
- **Sep 1, 2026, 7:00 AM:** 5.90 ft
- **Sep 1, 2026, 1:00 PM:** 5.60 ft
- **Sep 1, 2026, 7:00 PM:** 5.40 ft
- **Sep 2, 2026, 1:00 AM:** 5.10 ft
- **Sep 2, 2026, 7:00 AM:** 5.00 ft
- **Sep 2, 2026, 1:00 PM:** 4.90 ft
- **Sep 2, 2026, 7:00 PM:** 4.70 ft
- **Sep 3, 2026, 1:00 AM:** 4.50 ft
- **Sep 3, 2026, 7:00 AM:** 4.40 ft
- **Sep 3, 2026, 1:00 PM:** 4.20 ft
- **Sep 3, 2026, 7:00 PM:** 4.10 ft
- **Sep 4, 2026, 1:00 AM:** 3.80 ft
- **Sep 4, 2026, 7:00 AM:** 3.60 ft
- **Sep 4, 2026, 1:00 PM:** 3.40 ft
- **Sep 4, 2026, 7:00 PM:** 3.10 ft
- **Sep 5, 2026, 1:00 AM:** 2.80 ft
- **Sep 5, 2026, 7:00 AM:** 2.60 ft
- **Sep 5, 2026, 1:00 PM:** 2.40 ft
- **Sep 5, 2026, 7:00 PM:** 2.10 ft
- **Sep 6, 2026, 1:00 AM:** 1.90 ft
- **Sep 6, 2026, 7:00 AM:** 1.70 ft
- **Sep 6, 2026, 1:00 PM:** 1.50 ft
- **Sep 6, 2026, 7:00 PM:** 1.30 ft
- **Sep 7, 2026, 1:00 AM:** 1.10 ft
- **Sep 7, 2026, 7:00 AM:** 0.90 ft
- **Sep 7, 2026, 1:00 PM:** 0.60 ft
- **Sep 7, 2026, 7:00 PM:** 0.50 ft
- **Sep 8, 2026, 1:00 AM:** 0.30 ft
- **Sep 8, 2026, 7:00 AM:** 0.20 ft
- **Sep 8, 2026, 1:00 PM:** 0.00 ft
- **Sep 8, 2026, 7:00 PM:** -0.20 ft
- **Sep 9, 2026, 1:00 AM:** -0.30 ft
- **Sep 9, 2026, 7:00 AM:** -0.50 ft
- **Sep 9, 2026, 1:00 PM:** -0.60 ft
- **Sep 9, 2026, 7:00 PM:** -0.70 ft
- **Sep 10, 2026, 1:00 AM:** -0.90 ft
- **Sep 10, 2026, 7:00 AM:** -1.00 ft
- **Sep 10, 2026, 1:00 PM:** -1.10 ft
- **Sep 10, 2026, 7:00 PM:** -1.20 ft
- **Sep 11, 2026, 1:00 AM:** -1.40 ft
- **Sep 11, 2026, 7:00 AM:** -1.50 ft
- **Sep 11, 2026, 1:00 PM:** -1.70 ft
- **Sep 11, 2026, 7:00 PM:** -1.80 ft
- **Sep 12, 2026, 1:00 AM:** -1.90 ft
- **Sep 12, 2026, 7:00 AM:** -2.00 ft
- **Sep 12, 2026, 1:00 PM:** -2.10 ft
- **Sep 12, 2026, 7:00 PM:** -2.30 ft

### Recent Historic Crests
- **2025:** 37.55 ft
- **2019:** 41.37 ft
- **2018:** 39.44 ft
- **2017:** 35.99 ft
- **2016:** 39.59 ft
- **2015:** 32.12 ft
- **2014:** 26.24 ft
- **2013:** 33.98 ft
- **2012:** 24.55 ft
- **2011:** 48.03 ft
- **2011:** 36.52 ft
- **2010:** 32.83 ft
- **2009:** 34.72 ft
- **2008:** 37.75 ft
- **2007:** 25.89 ft
- **2006:** 21.44 ft
- **2005:** 35.73 ft
- **2004:** 29.37 ft
- **2003:** 34.04 ft
- **2002:** 38.70 ft
- **2001:** 27.70 ft
- **2000:** 21.26 ft
- **1999:** 32.30 ft
- **1998:** 34.25 ft
- **1997:** 40.76 ft

---

## Nonconnah Creek at Farrisview Boulevard

**Distance:** 11.9 km (7.4 mi)
**Location:** TN
**Coordinates:** 35.0764, -89.9542
**Gauge ID:** FRST1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:45 PM
**River Stage:** 6.62 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 26.0 ft
**Minor Flood:** 31.0 ft

**Current stage is 25% of action stage**

### Recent Historic Crests
- **2017:** 27.83 ft
- **2016:** 31.15 ft
- **2015:** 26.66 ft
- **2014:** 34.37 ft
- **2013:** 27.06 ft

---

## Wolf River at Raleigh

**Distance:** 12.9 km (8.0 mi)
**Location:** TN
**Coordinates:** 35.2017, -89.9225
**Gauge ID:** RLGT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:15 PM
**River Stage:** -2.86 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 5.0 ft
**Minor Flood:** 7.0 ft
**Moderate Flood:** 12.0 ft
**Major Flood:** 15.0 ft

**Current stage is -57% of action stage**

### Recent Historic Crests
- **2017:** 11.48 ft
- **2016:** 16.09 ft
- **2014:** 10.91 ft
- **2013:** 11.19 ft
- **2012:** 7.03 ft
- **2011:** 16.79 ft
- **2010:** 13.80 ft
- **2009:** 8.91 ft
- **2008:** 12.00 ft
- **2006:** 7.71 ft
- **2005:** 8.01 ft
- **2004:** 10.70 ft
- **2003:** 10.55 ft
- **2002:** 12.59 ft
- **2001:** 13.99 ft
- **1999:** 9.79 ft
- **1998:** 9.98 ft
- **1997:** 12.60 ft
- **1996:** 10.42 ft
- **1995:** 8.36 ft
- **1994:** 7.70 ft
- **1992:** 9.70 ft
- **1991:** 12.68 ft
- **1990:** 12.50 ft
- **1989:** 12.13 ft

---

## Loosahatchie River near Frayser

**Distance:** 13.2 km (8.2 mi)
**Location:** TN
**Coordinates:** 35.2597, -89.9942
**Gauge ID:** FRRT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 5:00 PM
**River Stage:** 5.34 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 21.0 ft
**Minor Flood:** 28.0 ft
**Moderate Flood:** 32.0 ft
**Major Flood:** 36.0 ft

**Current stage is 25% of action stage**

### Recent Historic Crests
- **2017:** 27.77 ft
- **2014:** 21.90 ft
- **2013:** 26.70 ft
- **2011:** 39.25 ft

---

## Fletcher Creek at Bartlett

**Distance:** 16.7 km (10.4 mi)
**Location:** TN
**Coordinates:** 35.1694, -89.8664
**Gauge ID:** MPHT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:30 PM
**River Stage:** 1.94 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

### Flood Stages
*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*

### Recent Historic Crests
- **2017:** 15.14 ft
- **2010:** 16.68 ft
- **2001:** 17.94 ft
- **1998:** 14.55 ft (18900 cfs)
- **1997:** 16.84 ft

---

## Loosahatchie River at Singleton Parkway

**Distance:** 20.3 km (12.6 mi)
**Location:** TN
**Coordinates:** 35.2750, -89.8872
**Gauge ID:** SPYT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:45 PM
**River Stage:** 1.72 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

### Flood Stages
*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*

### Recent Historic Crests
- **2017:** 20.12 ft

---

## Wolf River at Germantown

**Distance:** 22.8 km (14.2 mi)
**Location:** TN
**Coordinates:** 35.1164, -89.8014
**Gauge ID:** GERT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 5:45 PM
**River Stage:** 2.78 ft  → steady (last 6h)
**Flow Rate:** 0.19 kcfs (187 cfs)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 15.0 ft
**Minor Flood:** 20.5 ft
**Moderate Flood:** 25.0 ft
**Major Flood:** 28.0 ft

**Current stage is 19% of action stage**

### Forecast
**Valid Time:** Aug 30, 2026, 1:00 AM
**Forecasted Stage:** 2.80 ft
**Forecasted Flow:** 0.19 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
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
- **Sep 1, 2026, 1:00 PM:** 2.80 ft
- **Sep 1, 2026, 7:00 PM:** 2.80 ft
- **Sep 2, 2026, 1:00 AM:** 2.80 ft
- **Sep 2, 2026, 7:00 AM:** 2.80 ft
- **Sep 2, 2026, 1:00 PM:** 2.80 ft
- **Sep 2, 2026, 7:00 PM:** 2.80 ft
- **Sep 3, 2026, 1:00 AM:** 2.80 ft
- **Sep 3, 2026, 7:00 AM:** 2.80 ft

### Recent Historic Crests
- **2025:** 25.29 ft (21454 cfs)
- **2019:** 22.77 ft
- **2017:** 19.46 ft
- **2016:** 25.12 ft
- **2015:** 15.77 ft
- **2014:** 17.73 ft (11700 cfs)
- **2013:** 18.79 ft (8610 cfs)
- **2012:** 9.27 ft (3570 cfs)
- **2011:** 26.91 ft (28900 cfs)
- **2010:** 24.02 ft (22400 cfs)
- **2009:** 14.69 ft (7930 cfs)
- **2008:** 17.55 ft (11600 cfs)
- **2007:** 9.63 ft (3590 cfs)
- **2006:** 13.85 ft (7000 cfs)
- **2005:** 14.75 ft (8020 cfs)
- **2004:** 16.74 ft (10500 cfs)
- **2003:** 20.33 ft (15700 cfs)
- **2002:** 21.94 ft (18500 cfs)
- **2001:** 25.52 ft (26100 cfs)
- **2000:** 11.12 ft (4590 cfs)
- **1999:** 15.28 ft (8620 cfs)
- **1998:** 15.65 ft (9070 cfs)
- **1997:** 23.15 ft (20700 cfs)
- **1997:** 22.64 ft (19600 cfs)
- **1995:** 12.24 ft (6000 cfs)

---

## Nonconnah Creek at Winchester Rd

**Distance:** 23.8 km (14.8 mi)
**Location:** TN
**Coordinates:** 35.0497, -89.8181
**Gauge ID:** NONT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:45 PM
**River Stage:** 6.53 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 16.0 ft
**Minor Flood:** 23.0 ft

**Current stage is 41% of action stage**

### Recent Historic Crests
- **2019:** 27.96 ft
- **2017:** 21.27 ft
- **2016:** 25.13 ft
- **2015:** 18.45 ft
- **2014:** 27.05 ft
- **2013:** 18.79 ft
- **2012:** 17.01 ft (6760 cfs)
- **2011:** 23.48 ft (13800 cfs)
- **2010:** 20.36 ft (10300 cfs)
- **2009:** 18.37 ft (8180 cfs)
- **2008:** 17.76 ft (7540 cfs)
- **2001:** 17.48 ft
- **2001:** 15.64 ft (5400 cfs)
- **1975:** 27.11 ft

---

## Big Creek at Millington

**Distance:** 23.8 km (14.8 mi)
**Location:** TN
**Coordinates:** 35.3344, -89.9178
**Gauge ID:** MLLT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 9.51 ft  → steady (last 6h)
**Flow Rate:** 0.02 kcfs (18 cfs)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 26.0 ft
**Minor Flood:** 34.0 ft
**Moderate Flood:** 38.0 ft
**Major Flood:** 42.0 ft

**Current stage is 37% of action stage**

### Recent Historic Crests
- **2024:** 38.53 ft (13330 cfs)
- **2017:** 35.19 ft
- **2015:** 33.90 ft
- **2014:** 25.35 ft (3350 cfs)
- **2012:** 20.09 ft
- **2011:** 36.92 ft
- **2010:** 46.23 ft
- **2009:** 30.29 ft
- **2008:** 31.25 ft
- **2007:** 20.94 ft
- **2006:** 25.62 ft
- **2005:** 28.92 ft
- **2004:** 30.17 ft
- **2003:** 43.25 ft
- **2002:** 37.49 ft
- **2001:** 39.10 ft
- **2000:** 24.85 ft
- **1999:** 31.48 ft
- **1998:** 30.42 ft
- **1996:** 27.60 ft
- **1995:** 23.53 ft
- **1994:** 28.36 ft
- **1993:** 25.20 ft
- **1992:** 29.00 ft
- **1991:** 30.10 ft

---

## Loosahatchie River at Brunswick

**Distance:** 29.6 km (18.4 mi)
**Location:** TN
**Coordinates:** 35.2811, -89.7661
**Gauge ID:** BRNT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:15 PM
**River Stage:** 3.66 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 19.0 ft
**Minor Flood:** 23.0 ft
**Moderate Flood:** 26.0 ft
**Major Flood:** 28.0 ft

**Current stage is 19% of action stage**

### Recent Historic Crests
- **2017:** 23.56 ft
- **2014:** 23.67 ft
- **2014:** 22.59 ft
- **2012:** 18.68 ft
- **2011:** 24.95 ft
- **2011:** 25.83 ft
- **2010:** 28.67 ft
- **1999:** 5.23 ft
- **1973:** 25.76 ft
- **1972:** 24.67 ft
- **1971:** 23.29 ft
- **1970:** 23.64 ft
- **1969:** 23.24 ft
- **1968:** 22.57 ft
- **1967:** 22.04 ft
- **1966:** 23.26 ft
- **1965:** 26.98 ft
- **1964:** 23.40 ft
- **1963:** 23.30 ft
- **1962:** 24.55 ft
- **1961:** 23.80 ft
- **1960:** 21.55 ft
- **1959:** 24.15 ft
- **1958:** 22.30 ft
- **1957:** 24.00 ft

---

## Big Creek near Rosemark

**Distance:** 32.8 km (20.4 mi)
**Location:** TN
**Coordinates:** 35.3658, -89.8036
**Gauge ID:** ROMT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:45 PM
**River Stage:** 10.98 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 23.0 ft
**Minor Flood:** 31.0 ft
**Moderate Flood:** 34.0 ft
**Major Flood:** 36.0 ft

**Current stage is 48% of action stage**

### Recent Historic Crests
- **2017:** 25.24 ft
- **2014:** 17.67 ft

---

## Wolf River at Collierville

**Distance:** 37.0 km (23.0 mi)
**Location:** TN
**Coordinates:** 35.0814, -89.6506
**Gauge ID:** COTT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:45 PM
**River Stage:** 3.02 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 9.0 ft
**Minor Flood:** 13.0 ft
**Moderate Flood:** 16.0 ft
**Major Flood:** 19.0 ft

**Current stage is 34% of action stage**

### Recent Historic Crests
- **2017:** 14.51 ft
- **2016:** 16.73 ft
- **2015:** 13.00 ft
- **2014:** 14.53 ft

---

## Coldwater River at Olive Branch

**Distance:** 38.1 km (23.7 mi)
**Location:** MS
**Coordinates:** 34.9075, -89.7533
**Gauge ID:** OLVM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 7:00 PM
**River Stage:** 0.48 ft  → steady (last 6h)
**Flow Rate:** 0.05 kcfs (46 cfs)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Minor Flood:** 11.0 ft
**Moderate Flood:** 13.0 ft
**Major Flood:** 15.0 ft

### Recent Historic Crests
- **2019:** 9.99 ft
- **2017:** 10.70 ft
- **2016:** 12.56 ft

---

## Loosahatchie River at Arlington

**Distance:** 41.3 km (25.7 mi)
**Location:** TN
**Coordinates:** 35.3109, -89.6396
**Gauge ID:** ARLT1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:15 PM
**River Stage:** 0.89 ft  → steady (last 6h)
**Flow Rate:** 0.10 kcfs (105 cfs)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 19.0 ft
**Minor Flood:** 20.0 ft
**Moderate Flood:** 22.0 ft
**Major Flood:** 24.0 ft

**Current stage is 5% of action stage**

### Forecast
**Valid Time:** Aug 30, 2026, 1:00 AM
**Forecasted Stage:** 0.90 ft
**Forecasted Flow:** 0.11 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 29, 2026, 1:00 PM:** 0.90 ft
- **Aug 29, 2026, 7:00 PM:** 0.90 ft
- **Aug 30, 2026, 1:00 AM:** 0.90 ft
- **Aug 30, 2026, 7:00 AM:** 0.90 ft
- **Aug 30, 2026, 1:00 PM:** 0.90 ft
- **Aug 30, 2026, 7:00 PM:** 0.90 ft
- **Aug 31, 2026, 1:00 AM:** 0.90 ft
- **Aug 31, 2026, 7:00 AM:** 0.90 ft
- **Aug 31, 2026, 1:00 PM:** 0.80 ft
- **Aug 31, 2026, 7:00 PM:** 0.80 ft
- **Sep 1, 2026, 1:00 AM:** 0.80 ft
- **Sep 1, 2026, 7:00 AM:** 0.80 ft
- **Sep 1, 2026, 1:00 PM:** 0.80 ft
- **Sep 1, 2026, 7:00 PM:** 0.80 ft
- **Sep 2, 2026, 1:00 AM:** 0.80 ft
- **Sep 2, 2026, 7:00 AM:** 0.80 ft
- **Sep 2, 2026, 1:00 PM:** 0.80 ft
- **Sep 2, 2026, 7:00 PM:** 0.80 ft
- **Sep 3, 2026, 1:00 AM:** 0.80 ft
- **Sep 3, 2026, 7:00 AM:** 0.80 ft

### Recent Historic Crests
- **2025:** 21.13 ft (7458 cfs)
- **2025:** 23.92 ft (10649 cfs)
- **2025:** 20.46 ft (7055 cfs)
- **2024:** 20.23 ft (10733 cfs)
- **2021:** 20.37 ft
- **2015:** 20.21 ft
- **2014:** 19.73 ft (9040 cfs)
- **2013:** 15.95 ft (6960 cfs)
- **2012:** 14.19 ft (6480 cfs)
- **2011:** 23.87 ft (22700 cfs)
- **2010:** 25.44 ft (29600 cfs)
- **2009:** 19.20 ft (9340 cfs)
- **2008:** 20.15 ft (11300 cfs)
- **2007:** 11.73 ft (4360 cfs)
- **2006:** 18.20 ft (7700 cfs)
- **2005:** 18.33 ft (8700 cfs)
- **2004:** 19.70 ft (10700 cfs)
- **2003:** 20.52 ft (11342 cfs)
- **2002:** 23.04 ft (19600 cfs)
- **2001:** 24.06 ft (22800 cfs)
- **2000:** 16.35 ft (1635 cfs)
- **1999:** 18.25 ft (7720 cfs)
- **1997:** 23.43 ft (19400 cfs)
- **1996:** 20.43 ft (11100 cfs)
- **1992:** 20.88 ft (13900 cfs)

---

## Coldwater River near Coldwater River at Hernando

**Distance:** 41.6 km (25.8 mi)
**Location:** MS
**Coordinates:** 34.8012, -89.8831
**Gauge ID:** HHSM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 247.14 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

### Flood Stages
*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*

### Recent Historic Crests
- **2019:** 55.32 ft
- **2017:** 55.92 ft
- **2016:** 56.30 ft

---

## Coldwater River at Arkabutla Dam

**Distance:** 44.2 km (27.4 mi)
**Location:** MS
**Coordinates:** 34.7572, -90.1244
**Gauge ID:** ARKM6
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 208.01 ft  → steady (last 6h)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Minor Flood:** 238.3 ft
**Moderate Flood:** 240.0 ft
**Major Flood:** 244.0 ft

### Recent Historic Crests
- **2019:** 238.59 ft
- **2017:** 225.93 ft
- **2011:** 238.67 ft
- **2010:** 230.39 ft
- **2009:** 233.54 ft
- **2002:** 238.89 ft
- **2001:** 241.70 ft
- **1991:** 244.06 ft
- **1989:** 241.05 ft
- **1980:** 238.96 ft
- **1979:** 240.04 ft
- **1973:** 243.08 ft
- **1953:** 241.70 ft

---

## Tyronza River near Twist

**Distance:** 45.6 km (28.3 mi)
**Location:** AR
**Coordinates:** 35.3747, -90.4683
**Gauge ID:** TWGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 7.92 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

### Flood Stages
*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*

### Recent Historic Crests
- **1988:** 34.65 ft

---

## Wolf River at Rossville

**Distance:** 47.4 km (29.5 mi)
**Location:** TN
**Coordinates:** 35.0542, -89.5408
**Gauge ID:** ROST1
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 1.61 ft  → steady (last 6h)
**Flow Rate:** 0.17 kcfs (175 cfs)
**Flood Category:** ✅ NO FLOODING

### Flood Stages
**Action Stage:** 11.0 ft
**Minor Flood:** 13.0 ft
**Moderate Flood:** 14.0 ft
**Major Flood:** 15.5 ft

**Current stage is 15% of action stage**

### Forecast
**Valid Time:** Aug 30, 2026, 1:00 AM
**Forecasted Stage:** 1.60 ft
**Forecasted Flow:** 0.17 kcfs
**Forecasted Category:** ✅ NO FLOODING

### Forecast Series
- **Aug 29, 2026, 1:00 PM:** 1.60 ft
- **Aug 29, 2026, 7:00 PM:** 1.60 ft
- **Aug 30, 2026, 1:00 AM:** 1.60 ft
- **Aug 30, 2026, 7:00 AM:** 1.60 ft
- **Aug 30, 2026, 1:00 PM:** 1.60 ft
- **Aug 30, 2026, 7:00 PM:** 1.60 ft
- **Aug 31, 2026, 1:00 AM:** 1.60 ft
- **Aug 31, 2026, 7:00 AM:** 1.60 ft
- **Aug 31, 2026, 1:00 PM:** 1.60 ft
- **Aug 31, 2026, 7:00 PM:** 1.60 ft
- **Sep 1, 2026, 1:00 AM:** 1.60 ft
- **Sep 1, 2026, 7:00 AM:** 1.60 ft
- **Sep 1, 2026, 1:00 PM:** 1.60 ft
- **Sep 1, 2026, 7:00 PM:** 1.60 ft
- **Sep 2, 2026, 1:00 AM:** 1.60 ft
- **Sep 2, 2026, 7:00 AM:** 1.60 ft
- **Sep 2, 2026, 1:00 PM:** 1.60 ft
- **Sep 2, 2026, 7:00 PM:** 1.60 ft
- **Sep 3, 2026, 1:00 AM:** 1.60 ft
- **Sep 3, 2026, 7:00 AM:** 1.60 ft

### Recent Historic Crests
- **2025:** 14.23 ft (21891 cfs)
- **2019:** 14.09 ft
- **2017:** 12.91 ft
- **2016:** 14.48 ft
- **2015:** 11.73 ft
- **2014:** 11.63 ft (8020 cfs)
- **2013:** 12.96 ft
- **2012:** 7.96 ft (2040 cfs)
- **2011:** 14.46 ft (29400 cfs)
- **2010:** 14.23 ft (21203 cfs)
- **2009:** 10.60 ft (4830 cfs)
- **2008:** 11.33 ft (6910 cfs)
- **2007:** 7.59 ft (1900 cfs)
- **2006:** 11.54 ft (7400 cfs)
- **2005:** 11.57 ft (7420 cfs)
- **2004:** 11.98 ft (8730 cfs)
- **2003:** 12.80 ft (12100 cfs)
- **2002:** 13.16 ft (13900 cfs)
- **2001:** 14.57 ft (24000 cfs)
- **1935:** 13.75 ft (40000 cfs)

---

## St. Francis River at Parkin

**Distance:** 48.3 km (30.0 mi)
**Location:** AR
**Coordinates:** 35.2731, -90.5592
**Gauge ID:** PNGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 1.99 ft  ↘ falling (-0.1 ft / 6h)
**Flood Category:** ✅ NOT DEFINED

### Flood Stages
*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*

---

## Tyronza River near Tyronza

**Distance:** 49.6 km (30.8 mi)
**Location:** AR
**Coordinates:** 35.5050, -90.3800
**Gauge ID:** TYGA4
**Status:** ✅ Active

### Current Conditions
**Observed:** Aug 29, 2026, 6:00 PM
**River Stage:** 8.68 ft  → steady (last 6h)
**Flood Category:** ✅ NOT DEFINED

### Flood Stages
*NOAA publishes no flood-stage thresholds for this gauge. That is an absence of published thresholds, not an absence of flood risk — the **Flood Category:** line above comes from NOAA's own status.*

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

**Discharge:** 79,798 m³/s (2,818,059 ft³/s)  → steady (last 6d)
**vs. recent history:** near the recent average — 31-day mean 105,131 m³/s (3,712,675 ft³/s)

## Ensemble Forecast

Daily median with the p25–p75 ensemble band, in ft³/s, starting today. Members stay tightly clustered for the first few days and diverge from about day 4, so a near-zero band early on reflects that clustering, not certainty.

- **Aug 29:** 2,818,059 · p25–p75 2,818,059–2,818,059
- **Aug 30:** 2,792,221 · p25–p75 2,792,221–2,792,221
- **Aug 31:** 2,773,001 · p25–p75 2,773,001–2,773,001
- **Sep 1:** 2,753,913 · p25–p75 2,753,913–2,753,913
- **Sep 2:** 2,747,576 · p25–p75 2,747,576–2,747,576
- **Sep 3:** 2,741,257 · p25–p75 2,741,257–2,747,576
- **Sep 4:** 2,734,953 · p25–p75 2,734,953–2,734,953

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
*Captured 2026-08-30 with weather-mcp v1.25.12 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
