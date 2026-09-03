# Google Weather API Key Setup

**Last verified:** 2026-08-18 (**live-verified** — key provisioned, every step
below walked in the console, then exercised against the live API)

> Google's signup flow, pricing, and free-tier terms change over time. This
> walkthrough is re-verified quarterly by a scheduled check; if a step below
> doesn't match what you see, the console is right and this doc is stale —
> please open an issue.
>
> The sibling [Pollen key guide](./GOOGLE_POLLEN_KEY_SETUP.md) carries two
> live-verified corrections to Google's own documentation (an expired
> promotional credit still advertised, and an editable per-day quota the docs
> don't mention). Those apply here too. This guide picked up one of its own:
> the **API restrictions** control is on the *Maps Platform* credentials page,
> not the general Cloud one — see step 5. **Trust the console over the docs —
> including over this one.**

This key is **entirely optional**. Without it `get_alerts` still returns
official warnings for the United States (NOAA), Canada (Environment and
Climate Change Canada), the 38 European MeteoAlarm member countries, India
(NDMA SACHET), the Philippines (PAGASA), Indonesia (BMKG), and Japan (the
Japan Meteorological Agency) — all keyless — and every other tool works
exactly as before. The key adds official alerts for
roughly 45 more territories, including Australia, Brazil, and Mexico. See
[Google's coverage page](https://developers.google.com/maps/documentation/weather/coverage)
for the current list; any list in this project's docs is representative, not
exhaustive.

**The US, Canada, Europe, India, the Philippines, Indonesia, and Japan never contact
Google, key or no key.** Those are jurisdictional authorities and stay first
choice; the Google fallback fires only on the branch that would otherwise
return "alerts are not yet available for this region".

## Before you start — the honest caveat

Unlike the [NCEI and FIRMS keys](../README.md#optional-api-keys) (both true
free registrations), the Google Weather API **requires a Google Cloud billing
account with a credit card on file**, even to use the free tier. That is the
same caveat as the Pollen key, and the same billing account serves both.

- **Free tier:** verified 2026-08-18 — the Weather API has exactly one SKU,
  **"Weather Usage"** (`9DB8-727A-ACFE`), in the **Essentials** tier, with
  **10,000 free events per month**. Alerts bill under it; there is no separate
  alerts SKU.
- **Beyond the allowance:** $0.12 per 1,000 events to 100k, dropping in tiers
  after that. Check Google's current pricing before relying on these numbers.
- This server caches alert responses in memory for 5 minutes per location, so
  normal personal use stays far inside the free tier.

If you'd rather not put a card on file, simply don't set the key. Nothing
breaks — the elsewhere branch keeps today's not-covered message, whose coverage
sentence now also names India, the Philippines, Indonesia, and Japan as keyless.

## Already have the Pollen key? Read this first

**A key restricted to the Pollen API will not work here.** The recommended
restriction in the Pollen guide caps that key to the Pollen API specifically,
so pointing it at the Weather API returns a rejection. You have two options:

- **Mint a second key** on the same project and restrict it to the **Weather
  API** — recommended, and the reason this project uses a separate
  `GOOGLE_WEATHER_API_KEY` variable rather than one shared Google key.
- **Use a single unrestricted key** and put the same string in both variables.
  Simpler, but a leaked key then reaches every API enabled on the project.

Either way, the **Weather API must be enabled on the project** — enabling the
Pollen API does not enable it.

## Steps

### 1. Create or pick a Google Cloud project

Go to the [Google Cloud console](https://console.cloud.google.com/) and either
select an existing project or create a new one. If you already followed the
Pollen guide, reuse that project.

### 2. Enable billing on the project

In **Billing**, link a billing account to the project. This is the step that
requires a payment method. Already done if you set up the Pollen key.

### 3. Enable the Weather API

In **APIs & Services → Library**, search for **Weather API** and click
**Enable**. Make sure it's the Weather API specifically — enabling the Pollen
API or a broader Maps product does not cover it.

### 4. Create an API key

On the [**Google Maps Platform → Credentials**](https://console.cloud.google.com/google/maps-apis/credentials)
page, choose **Create credentials → API key**. Copy the key that appears.

### 5. Restrict the key (strongly recommended)

**Use the [Google Maps Platform → Credentials](https://console.cloud.google.com/google/maps-apis/credentials)
page**, not **APIs & Services → Credentials** — the API-restriction control for
Maps Platform keys lives on the former. Click the key to open its edit page.

One catch: **APIs that aren't enabled on the project don't appear in the
"Select APIs" list at all.** If **Weather API** isn't offered, step 3 didn't
take — which is also the failure mode that later makes a working key look
rejected.

The edit page offers **two separate** restriction groups, and only one of them
is useful here — the same reasoning as the Pollen guide:

- **Application restrictions** → choose **None**. *Websites (HTTP referrers)*
  only works for browser JavaScript (this server calls from Node, which sends
  no `Referer`, so every request would be rejected); *Android/iOS apps* are
  irrelevant; and *IP addresses* is brittle on a home connection whose address
  changes and breaks outright behind a VPN. A key that intermittently fails
  looks exactly like a rejected key.
- **API restrictions** → choose **Restrict key**, then select **Weather API**
  only. This is the restriction that matters: it caps the blast radius so a
  leaked key can't reach any other (more expensive) API on the project.

### 5b. Cap your usage (recommended)

Because *Application restrictions* is `None`, a leaked key is usable by anyone
who finds it. Set a hard ceiling under **Google Maps Platform → Quotas**,
select the Weather API, and set the **per-day** usage row to a value that keeps
you inside the monthly free allowance (divide the allowance by 31). Leave the
*per minute per user* rows unlimited — they key off end-user identity, which is
meaningless for a single server-side caller.

A **budget alert** (Billing → Budgets & alerts) is *not* a cap — it only emails
you after the fact. Use it as a backstop, never as the limit.

Unlike the Pollen path, a hit cap here does **not** degrade silently: alerts are
this tool's entire answer, so `get_alerts` surfaces the failure loudly rather
than reporting a possibly-false all-clear. See "Verifying it works" below.

### 6. Set the environment variable

```bash
export GOOGLE_WEATHER_API_KEY=your_key_here
```

Or add it to your MCP client's server config, alongside any other environment
variables:

```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp@latest"],
      "env": {
        "GOOGLE_WEATHER_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Verifying it works

Ask for alerts somewhere outside the keyless authorities (the US, Canada,
Europe, India, the Philippines, Indonesia, and Japan) — for example
*"Any weather warnings in Sydney?"* — and `get_alerts` should return a
`# Weather Alerts — Australia` section ending with the line
`Source: Includes weather data from Google` (Google's attribution terms require
that exact sentence to appear with the data). Each individual alert also
carries a `**Source:**` line naming the original publisher — for example the
Australian Bureau of Meteorology — with its authority URL; that per-alert
attribution is separately required.

If the key is wrong, rejected, or restricted to the wrong API, the tool
**fails loudly** with an actionable message rather than reporting no alerts:

```
Google Weather API key was rejected by the service. Check that the Weather API
is enabled on the Google Cloud project for GOOGLE_WEATHER_API_KEY, and that the
key is unrestricted or restricted to the Weather API — a key restricted to the
Pollen API will not work here.
```

Quota exhaustion, timeouts, and network failures surface the same way. This is
deliberate: pollen is a garnish on an air-quality answer and degrades silently,
but alerts *are* the answer, and a silent "✅ no alerts" produced by a failed
fetch would be a dangerous lie about safety data.

**A note on what you'll actually see.** Google aggregates official national
feeds and matches them by **provider polygon**, so — in Google's own words —
"country and region coverage alignment may not be exact". A location Google
does not cover answers HTTP 404 and renders an explicit no-coverage note saying
that **this is not an all-clear**; a covered location with genuinely no active
alerts renders a ✅ none-found result instead. The two are deliberately
distinguishable, and the coverage caveat is repeated either way.
Alert text is shown in the publisher's source language; only the title is
translated, which is a provider restriction rather than a choice.

## Key handling in this server

The key travels in the request query string, so the service is written to the
same standard as the FIRMS and Pollen key paths: it never logs or throws a
request URL or a raw HTTP error, every error message is a fixed pre-written
string, and logs carry only a status code. Unit tests assert that a configured
key appears in no thrown message and no log argument.

Responses are cached **in memory only**, for 5 minutes per location, and
nothing is written to disk — Google Maps Platform terms generally prohibit
persisting API content. Five minutes is the same TTL the server already uses
for NOAA, ECCC, MeteoAlarm, and the national CAP feeds: alert volatility is
alert volatility regardless of source.
