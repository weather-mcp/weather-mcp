# Reaching into the past — Berlin 1945, Chicago today

The historical archive goes back to 1940, worldwide. And for US locations, current conditions can be framed against 30-year climate normals and all-time records for the date.

> **You:** What was the weather in Berlin during the Potsdam Conference (July 17 – August 2, 1945)?

**Claude Code answered** (using `get_historical_weather`):

<!-- answer -->
The conference opened as a heat spell broke. From the reanalysis archive (daily summaries, Berlin 52.55°N 13.41°E):

- **The day before delegates convened (July 16), Berlin hit 30°C.** Then the weather turned: opening day, **July 17, was cool and wet: high 21°C with 27.1 mm of rain**, and July 18 brought another 8.1 mm.
- Most of the conference ran **mild and unsettled**: highs mostly 20–26°C, with brief warm spikes to 28°C on July 22 and 27, and a cool, damp stretch in the final week (highs 18–21°C from July 28 to August 1).
- **The closing day, August 2, was mild and gray: high 23°C, low 13°C, with light drizzle.**

So the famous photographs of Truman, Churchill/Attlee, and Stalin were taken in distinctly un-summery Berlin weather — a real cool-down from the 30°C just before it began.
<!-- /answer -->

<!-- capture:berlin-1945 -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_historical_weather</code></summary>

**Call:**

```js
get_historical_weather({
  latitude: 52.52,
  longitude: 13.405,
  start_date: "1945-07-16",
  end_date: "1945-08-17",
  units: "metric"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Historical Weather Data (Daily Summaries)

**Period:** 1945-07-16 to 1945-08-17
**Location:** 52.5483°N, 13.4078°E (37m elevation)
**Number of days:** 33
**Data source:** Open-Meteo Historical Weather API (Reanalysis)

## 7/16/1945
- **High Temperature:** 30°C
- **Low Temperature:** 20°C
- **Average Temperature:** 25°C
- **Conditions:** Moderate drizzle
- **Precipitation:** 0.90 mm
- **Max Wind Speed:** 13 km/h

## 7/17/1945
- **High Temperature:** 21°C
- **Low Temperature:** 16°C
- **Average Temperature:** 19°C
- **Conditions:** Moderate rain
- **Precipitation:** 27.10 mm
- **Max Wind Speed:** 20 km/h

## 7/18/1945
- **High Temperature:** 21°C
- **Low Temperature:** 17°C
- **Average Temperature:** 19°C
- **Conditions:** Slight rain
- **Precipitation:** 8.10 mm
- **Max Wind Speed:** 14 km/h

## 7/19/1945
- **High Temperature:** 26°C
- **Low Temperature:** 17°C
- **Average Temperature:** 21°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.50 mm
- **Max Wind Speed:** 15 km/h

## 7/20/1945
- **High Temperature:** 24°C
- **Low Temperature:** 17°C
- **Average Temperature:** 21°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.20 mm
- **Max Wind Speed:** 17 km/h

## 7/21/1945
- **High Temperature:** 24°C
- **Low Temperature:** 17°C
- **Average Temperature:** 20°C
- **Conditions:** Overcast
- **Precipitation:** 0.00 mm
- **Max Wind Speed:** 25 km/h

## 7/22/1945
- **High Temperature:** 28°C
- **Low Temperature:** 17°C
- **Average Temperature:** 22°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.30 mm
- **Max Wind Speed:** 25 km/h

## 7/23/1945
- **High Temperature:** 20°C
- **Low Temperature:** 16°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.70 mm
- **Max Wind Speed:** 31 km/h

## 7/24/1945
- **High Temperature:** 22°C
- **Low Temperature:** 16°C
- **Average Temperature:** 19°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.40 mm
- **Max Wind Speed:** 23 km/h

## 7/25/1945
- **High Temperature:** 20°C
- **Low Temperature:** 13°C
- **Average Temperature:** 17°C
- **Conditions:** Mainly clear
- **Precipitation:** 0.00 mm
- **Max Wind Speed:** 14 km/h

## 7/26/1945
- **High Temperature:** 24°C
- **Low Temperature:** 11°C
- **Average Temperature:** 18°C
- **Conditions:** Overcast
- **Precipitation:** 0.00 mm
- **Max Wind Speed:** 12 km/h

## 7/27/1945
- **High Temperature:** 28°C
- **Low Temperature:** 18°C
- **Average Temperature:** 22°C
- **Conditions:** Moderate rain
- **Precipitation:** 9.30 mm
- **Max Wind Speed:** 20 km/h

## 7/28/1945
- **High Temperature:** 21°C
- **Low Temperature:** 14°C
- **Average Temperature:** 19°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.10 mm
- **Max Wind Speed:** 20 km/h

## 7/29/1945
- **High Temperature:** 18°C
- **Low Temperature:** 14°C
- **Average Temperature:** 16°C
- **Conditions:** Moderate drizzle
- **Precipitation:** 1.90 mm
- **Max Wind Speed:** 34 km/h

## 7/30/1945
- **High Temperature:** 20°C
- **Low Temperature:** 14°C
- **Average Temperature:** 17°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.70 mm
- **Max Wind Speed:** 34 km/h

## 7/31/1945
- **High Temperature:** 18°C
- **Low Temperature:** 13°C
- **Average Temperature:** 16°C
- **Conditions:** Moderate drizzle
- **Precipitation:** 1.90 mm
- **Max Wind Speed:** 29 km/h

## 8/1/1945
- **High Temperature:** 20°C
- **Low Temperature:** 14°C
- **Average Temperature:** 17°C
- **Conditions:** Moderate drizzle
- **Precipitation:** 1.50 mm
- **Max Wind Speed:** 21 km/h

## 8/2/1945
- **High Temperature:** 23°C
- **Low Temperature:** 13°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.10 mm
- **Max Wind Speed:** 18 km/h

## 8/3/1945
- **High Temperature:** 19°C
- **Low Temperature:** 13°C
- **Average Temperature:** 16°C
- **Conditions:** Moderate drizzle
- **Precipitation:** 2.60 mm
- **Max Wind Speed:** 20 km/h

## 8/4/1945
- **High Temperature:** 22°C
- **Low Temperature:** 13°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.90 mm
- **Max Wind Speed:** 11 km/h

## 8/5/1945
- **High Temperature:** 22°C
- **Low Temperature:** 12°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.70 mm
- **Max Wind Speed:** 8 km/h

## 8/6/1945
- **High Temperature:** 25°C
- **Low Temperature:** 15°C
- **Average Temperature:** 20°C
- **Conditions:** Overcast
- **Precipitation:** 0.00 mm
- **Max Wind Speed:** 10 km/h

## 8/7/1945
- **High Temperature:** 24°C
- **Low Temperature:** 17°C
- **Average Temperature:** 20°C
- **Conditions:** Slight rain
- **Precipitation:** 6.80 mm
- **Max Wind Speed:** 14 km/h

## 8/8/1945
- **High Temperature:** 26°C
- **Low Temperature:** 17°C
- **Average Temperature:** 21°C
- **Conditions:** Moderate rain
- **Precipitation:** 14.70 mm
- **Max Wind Speed:** 17 km/h

## 8/9/1945
- **High Temperature:** 25°C
- **Low Temperature:** 17°C
- **Average Temperature:** 21°C
- **Conditions:** Moderate rain
- **Precipitation:** 22.80 mm
- **Max Wind Speed:** 19 km/h

## 8/10/1945
- **High Temperature:** 18°C
- **Low Temperature:** 14°C
- **Average Temperature:** 16°C
- **Conditions:** Slight rain
- **Precipitation:** 8.50 mm
- **Max Wind Speed:** 25 km/h

## 8/11/1945
- **High Temperature:** 17°C
- **Low Temperature:** 14°C
- **Average Temperature:** 15°C
- **Conditions:** Slight rain
- **Precipitation:** 12.90 mm
- **Max Wind Speed:** 24 km/h

## 8/12/1945
- **High Temperature:** 20°C
- **Low Temperature:** 14°C
- **Average Temperature:** 16°C
- **Conditions:** Dense drizzle
- **Precipitation:** 8.50 mm
- **Max Wind Speed:** 15 km/h

## 8/13/1945
- **High Temperature:** 20°C
- **Low Temperature:** 12°C
- **Average Temperature:** 16°C
- **Conditions:** Light drizzle
- **Precipitation:** 1.10 mm
- **Max Wind Speed:** 7 km/h

## 8/14/1945
- **High Temperature:** 22°C
- **Low Temperature:** 14°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 1.00 mm
- **Max Wind Speed:** 9 km/h

## 8/15/1945
- **High Temperature:** 22°C
- **Low Temperature:** 14°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.30 mm
- **Max Wind Speed:** 20 km/h

## 8/16/1945
- **High Temperature:** 21°C
- **Low Temperature:** 15°C
- **Average Temperature:** 18°C
- **Conditions:** Light drizzle
- **Precipitation:** 0.70 mm
- **Max Wind Speed:** 20 km/h

## 8/17/1945
- **High Temperature:** 19°C
- **Low Temperature:** 13°C
- **Average Temperature:** 16°C
- **Conditions:** Overcast
- **Precipitation:** 0.00 mm
- **Max Wind Speed:** 20 km/h
````

</details>
<!-- /capture:berlin-1945 -->

> **You:** Is today's weather in Chicago normal for this time of year?

**Claude Code answered** (using `get_current_conditions` with `include_normals: true`):

<!-- answer-2 -->
Today is running **a little cooler than normal**. Chicago Midway is reporting **46°F under clear skies** just before 1 PM, with a wind chill of 41°F, against a normal high of 52°F and normal low of 39°F for November 14. So the early afternoon is sitting about six degrees below where a typical mid-November day peaks.

For perspective, the books on this date go back to 1928: the **record high is 78°F (1971)** and the record low is 12°F (1940). Today threatens neither.
<!-- /answer-2 -->

<!-- capture:chicago-normals -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_current_conditions</code></summary>

**Call:**

```js
get_current_conditions({
  latitude: 41.8781,
  longitude: -87.6298,
  include_normals: true
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Current Weather Conditions

**Station:** https://api.weather.gov/stations/KMDW
**Time:** Nov 14, 2026, 12:55 PM (15 minutes ago)

**Conditions:** Clear
**Temperature:** 46°F
**Feels Like (Wind Chill):** 41°F
**Dewpoint:** 30°F
**Humidity:** 53%
**Wind:** 11 mph from 340°
**Pressure:** 30.24 inHg
**Visibility:** 10.0 miles (clear)
**Cloud Cover:** Clear at 12500ft

## 📊 Climate Context

**Normal High:** 52°F
**Normal Low:** 39°F
**Normal Precipitation:** 0.11 in

*Climate normals based on 1991-2020 data*
*Source: NCEI*

**Records for Nov 14:** High 78°F (1971) · Low 12°F (1940) — records since 1928
Records: NOAA Regional Climate Centers (ACIS)

---
*Data source: NOAA National Weather Service*
````

</details>
<!-- /capture:chicago-normals -->

---

**Features shown:** `get_historical_weather` — any date range back to 1940, anywhere (Open-Meteo archive) · `include_normals` — 30-year normal high/low with departure from normal, plus the US record high/low for the date and the year it was set (NOAA Regional Climate Centers).

<!-- capture-stamp -->
*Captured 2026-11-14 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
