# Google Pollen API Key Setup

**Last verified:** 2026-08-18 (**live-verified** — key provisioned and every
step below walked in the console, then exercised against the live API)

> Google's signup flow, pricing, and free-tier terms change over time. This
> walkthrough is re-verified quarterly by a scheduled check; if a step below
> doesn't match what you see, the console is right and this doc is stale —
> please open an issue.
>
> Two concrete examples of that drift, found while provisioning: Google's own
> Pollen billing page still advertises a "$200 monthly credit through
> February 28, 2025" that expired long ago, and its quota documentation
> mentions only a per-minute limit while the console does in fact expose an
> editable **per-day** cap. **Trust the console over the docs — including
> over this one.**

This key is **entirely optional**. Without it the server still returns
European pollen (alder, birch, grass, mugwort, olive, ragweed in grains/m³)
from the keyless CAMS model, and every other tool works exactly as before.
The key adds a grass/tree/weed **Universal Pollen Index** for the ~65+
countries Google covers — including the United States, where CAMS has no
pollen data at all.

## Before you start — the honest caveat

Unlike the other two optional keys in this project ([NCEI](../README.md#optional-api-keys)
and FIRMS, both free registrations), the Google Pollen API **requires a Google
Cloud billing account with a credit card on file**, even to use the free tier.

- **Free tier:** the first 5,000 lookups per month cost nothing.
- **Beyond that:** roughly $10 per 1,000 lookups (tiered — check Google's
  current pricing).
- This server caches pollen responses in memory for 6 hours per location, so
  normal personal use stays far inside the free tier.

If you'd rather not put a card on file, simply don't set the key. Nothing
breaks.

## Steps

### 1. Create or pick a Google Cloud project

Go to the [Google Cloud console](https://console.cloud.google.com/) and either
select an existing project or create a new one (a name like `weather-mcp` is
fine).

### 2. Enable billing on the project

In **Billing**, link a billing account to the project. This is the step that
requires a payment method. The free tier applies automatically — you are not
charged unless you exceed it.

### 3. Enable the Pollen API

In **APIs & Services → Library**, search for **Pollen API** and click
**Enable**. Make sure it's the Pollen API specifically, not the broader Maps
or Weather products.

### 4. Create an API key

In **APIs & Services → Credentials**, choose **Create credentials → API key**.
Copy the key that appears.

### 5. Restrict the key (strongly recommended)

The key's edit page offers **two separate** restriction groups. They are easy
to confuse, and only one of them is useful here:

- **Application restrictions** → choose **None**. The other options don't fit a
  local server process: *Websites (HTTP referrers)* only works for browser
  JavaScript (this server calls the API from Node, which sends no `Referer`, so
  every request would be rejected), *Android/iOS apps* are irrelevant, and
  *IP addresses* — the only conceptually correct one for a server — is brittle
  on a home connection whose ISP address changes, and breaks outright behind a
  VPN. A key that intermittently fails looks exactly like a rejected key.
- **API restrictions** → choose **Restrict key**, then select **Pollen API**
  only. This is the restriction that matters: it caps the blast radius so a
  leaked key can't reach any other (more expensive) API you enable on the
  project later.

### 5b. Cap your usage (recommended)

Because *Application restrictions* is `None`, a leaked key is usable by anyone
who finds it. Set a hard ceiling: go to **Google Maps Platform → Quotas**,
select the Pollen API, and you'll find several editable rows, all defaulting to
unlimited or 6,000/minute. Suggested values:

| Quota | Set to | Why |
|-------|--------|-----|
| Pollen **forecast** usage per day | **150** | 150 × 31 = 4,650, so you stay inside the 5,000/month free tier even in a long month. This is the row that actually protects you. |
| Pollen **forecast** per minute | **60** | Down from 6,000 — still far above real use, but blunts rapid draining. |
| Pollen **heatmap** usage per day | **0** (or 1 if 0 is refused) | This server never requests heatmap tiles, so zero closes that surface completely. |
| Pollen **heatmap** per minute | **0** | Same reasoning. |
| Either *per minute per user* | Leave unlimited | Keys off end-user identity; meaningless for a single server-side caller. |

Note that a **budget alert** (Billing → Budgets & alerts) is *not* a cap — it
only emails you after the fact. Use it as a backstop, never as the limit.

If you ever hit the daily cap, Google returns HTTP 429, which this server maps
to a silent no-pollen-section — air quality still returns normally. A hit cap
degrades gracefully rather than breaking the tool.

> **Note:** because the recommended restriction ties the key to the Pollen API,
> it cannot serve any other Google API. If this project ever adds a second
> Google-backed feature, it will use its own separate environment variable
> rather than reusing this one — see the key-naming decision in the design
> plan. If you prefer a single unrestricted key, you can put the same string
> in each variable.

### 6. Set the environment variable

```bash
export GOOGLE_POLLEN_API_KEY=your_key_here
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
        "GOOGLE_POLLEN_API_KEY": "your_key_here"
      }
    }
  }
}
```

## Verifying it works

Ask for air quality somewhere outside Europe — for example *"What's the pollen
count in Kansas City?"* — and `get_air_quality` should return a `🌾 Pollen`
section with a grass/tree/weed index and the line
`Source: Includes pollen data from Google` (Google's attribution terms require
that sentence to appear with the data).

If the key is wrong or rejected, the tool still returns air quality normally
and adds one note:

```
*Note: GOOGLE_POLLEN_API_KEY was rejected; global pollen data is unavailable.*
```

Any other failure — quota exhausted, timeout, a country Google doesn't cover —
degrades silently to no pollen section, exactly as if no key were set.

**A note on what you'll actually see.** Google returns an index per pollen type
only when it has one; a type with no data is omitted entirely, so a real
response often shows two of the three (e.g. Tree and Weed but not Grass).
Confusingly, `inSeason` and the index are independent: a type can report
`inSeason: false` and still carry a genuine index value, which is why the
`— in season` marker appears only when Google actually says so. Coverage is
also narrower than a map suggests — open ocean and Antarctica return an
explicit "information unavailable" answer, which this server caches for 6 hours
so it doesn't re-query a location Google will never have data for.

## Key handling in this server

The key travels in the request query string, so the service is written to the
same standard as the FIRMS key path: it never logs or throws a request URL or a
raw HTTP error, every error message is a fixed pre-written string, and logs
carry only a status code. Unit tests assert that a configured key appears in no
thrown message and no log argument.

Responses are cached **in memory only**, for 6 hours per location, and nothing
is written to disk — Google Maps Platform terms generally prohibit persisting
API content.
