# Saving your places — the "cabin" workflow

Save a spot once, then ask about it by name forever. This example walks the full lifecycle: search → save → list → use → inspect → remove.

> **You:** We just bought a place at Lake Tahoe. Save it as "cabin" — we mostly go there to boat, fish, and hike.

**Claude Code** first confirms the location (`search_location`):

<!-- capture:search -->
<details>
<summary>🔍 Tool call & raw server output — <code>search_location</code></summary>

**Call:**

```js
search_location({
  query: "Lake Tahoe",
  limit: 3
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Location Search Results

**Query:** "Lake Tahoe"
**Found:** 3 locations

---

## 1. Lake Tahoe

**Full Name:** Lake Tahoe, Placer County, California, United States
**Coordinates:** 39.0885°, -120.0504°
**Country Code:** US
**Type:** Lake
**Confidence:** ⚡ Medium
**Data Source:** OpenStreetMap Nominatim

*To get weather for this location, use these coordinates:*
*Latitude: 39.0885405, Longitude: -120.0503528*

---

## 2. Lake Tahoe

**Full Name:** Lake Tahoe, Freeman Township, Clare County, Michigan, United States
**Coordinates:** 43.9388°, -85.0404°
**Country Code:** US
**Type:** Lake
**Confidence:** ⚠️ Low
**Data Source:** OpenStreetMap Nominatim

*To get weather for this location, use these coordinates:*
*Latitude: 43.9387986, Longitude: -85.0404394*

---

## 3. Lake Tahoe

**Full Name:** Lake Tahoe, Duji, Mobbar, Borno State, Nigeria
**Coordinates:** 13.0968°, 12.5604°
**Country Code:** NG
**Type:** Lake
**Confidence:** ⚠️ Low
**Data Source:** OpenStreetMap Nominatim

*To get weather for this location, use these coordinates:*
*Latitude: 13.0967592, Longitude: 12.5603528*

---
*Multi-service geocoding with automatic fallback (Census.gov, Nominatim, Open-Meteo)*
````

</details>
<!-- /capture:search -->

**...then saves it** (`save_location`):

<!-- capture:save -->
<details>
<summary>🔍 Tool call & raw server output — <code>save_location</code></summary>

**Call:**

```js
save_location({
  alias: "cabin",
  location_query: "Lake Tahoe, CA",
  activities: [
    "boating",
    "fishing",
    "hiking"
  ]
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Saved Location

**Alias:** `cabin`
**Name:** Lake Tahoe
**Coordinates:** 39.0885°, -120.0504°
**Country:** US
**Region:** California
**Activities:** boating, fishing, hiking

---

This location is now saved and can be used with any weather tool:

- `get_forecast(location_name="cabin")`
- `get_current_conditions(location_name="cabin")`
- `get_alerts(location_name="cabin")`
- And all other weather tools

The activities you've tagged will help the AI provide relevant weather information.

*Storage location: ~/.weather-mcp/locations.json*
````

</details>
<!-- /capture:save -->

> **You:** What places do I have saved?

<!-- capture:list -->
<details>
<summary>🔍 Tool call & raw server output — <code>list_saved_locations</code></summary>

**Call:**

```js
list_saved_locations({})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Saved Locations

**Total:** 1 location

---

## `cabin`

**Name:** Lake Tahoe
**Coordinates:** 39.0885°, -120.0504°
**Country:** US
**Region:** California
**Activities:** boating, fishing, hiking
**Saved:** 8/13/2026

---

**Usage Examples:**

```
get_forecast(location_name="cabin")
```

*Storage location: ~/.weather-mcp/locations.json*
````

</details>
<!-- /capture:list -->

> **You:** What's the weather at the cabin this weekend?

**Claude Code answered** (using `get_forecast` with `location_name: "cabin"` — no coordinates needed):

<!-- answer -->
Since you boat there, timing matters this weekend: **this afternoon has a 36% chance of showers and thunderstorms** (high 67°F at the cabin's 6,200 ft elevation), so keep an eye on the sky if you're on the water. **Friday looks like your day** — sunny, high 67°F, with only a slight chance of a storm popping between 2 and 5 PM, then a clear, crisp night around 49°F. Classic Tahoe summer: pleasant days, chilly nights, and afternoon thunderstorms worth respecting on a boat.
<!-- /answer -->

<!-- capture:forecast-by-alias -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_forecast</code></summary>

**Call:**

```js
get_forecast({
  location_name: "cabin",
  days: 2
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
**Location:** cabin (39.0885, -120.0504)

# Weather Forecast (Daily)

**Location:** 39.0885, -120.0504
**Elevation:** 6227ft
**Showing:** 4 periods

## This Afternoon
**Temperature:** 67°F
**Precipitation Chance:** 36%
**Wind:** 5 to 10 mph SW
**Forecast:** Chance Showers And Thunderstorms

A chance of showers and thunderstorms. Partly sunny, with a high near 67. Southwest wind 5 to 10 mph. Chance of precipitation is 40%.

## Tonight
**Temperature:** 49°F
**Precipitation Chance:** 15%
**Wind:** 0 to 10 mph SW
**Forecast:** Slight Chance Showers And Thunderstorms then Partly Cloudy

A slight chance of showers and thunderstorms before 8pm. Partly cloudy, with a low around 49. Southwest wind 0 to 10 mph. Chance of precipitation is 20%.

## Friday
**Temperature:** 67°F
**Precipitation Chance:** 15%
**Wind:** 0 to 5 mph SW
**Forecast:** Sunny then Slight Chance Showers And Thunderstorms

A slight chance of showers and thunderstorms between 2pm and 5pm. Sunny, with a high near 67. Southwest wind 0 to 5 mph. Chance of precipitation is 20%.

## Friday Night
**Temperature:** 49°F
**Precipitation Chance:** 3%
**Wind:** 0 to 5 mph W
**Forecast:** Mostly Clear

Mostly clear, with a low around 49. West wind 0 to 5 mph.

---
*Data source: NOAA National Weather Service (US)*
````

</details>
<!-- /capture:forecast-by-alias -->

> **You:** Show me the cabin's details, then remove it.

<!-- capture:details -->
<details>
<summary>🔍 Tool call & raw server output — <code>get_saved_location</code></summary>

**Call:**

```js
get_saved_location({
  alias: "cabin"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Saved Location: `cabin`

**Name:** Lake Tahoe
**Coordinates:** 39.0885°, -120.0504°
**Country:** US
**Region:** California
**County:** Placer County
**Activities:** boating, fishing, hiking
**Saved:** 8/13/2026, 4:08:35 PM

---

**Usage Examples:**

```
get_forecast(location_name="cabin")
get_current_conditions(location_name="cabin")
get_alerts(location_name="cabin")
get_air_quality(location_name="cabin")
```
````

</details>
<!-- /capture:details -->

<!-- capture:remove -->
<details>
<summary>🔍 Tool call & raw server output — <code>remove_saved_location</code></summary>

**Call:**

```js
remove_saved_location({
  alias: "cabin"
})
```

**The server returned** (verbatim — this is exactly what the MCP client receives):

````markdown
# Location Removed

Successfully removed location: `cabin`

**Remaining locations:** 0

No saved locations remaining.

Use `save_location` to save new locations.
````

</details>
<!-- /capture:remove -->

---

**Features shown:** `search_location` geocoding (Nominatim/OSM) · `save_location` with `activities` context for smarter answers · `list_saved_locations` / `get_saved_location` / `remove_saved_location` · using `location_name` in any weather tool.

*The activities you save travel with the location — ask "can we fish at the cabin Saturday?" and the assistant knows what and where "the cabin" is.*

<!-- capture-stamp -->
*Captured 2026-08-13 with weather-mcp v1.18.0 — raw output is live data and will differ when regenerated (`npm run examples`).*
<!-- /capture-stamp -->
