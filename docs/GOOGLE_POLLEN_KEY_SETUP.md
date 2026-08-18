# Google Pollen API Key Setup

**Last verified:** 2026-08-18 (web-verified; not yet tested against a live key)

> Google's signup flow, pricing, and free-tier terms change over time. This
> walkthrough is re-verified quarterly by a scheduled check; if a step below
> doesn't match what you see, the console is right and this doc is stale —
> please open an issue.

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

Still on the key's page, under **API restrictions**, select **Restrict key**
and choose **Pollen API** only. An unrestricted key works against every API
enabled on the project, so a leak is far more costly.

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

## Key handling in this server

The key travels in the request query string, so the service is written to the
same standard as the FIRMS key path: it never logs or throws a request URL or a
raw HTTP error, every error message is a fixed pre-written string, and logs
carry only a status code. Unit tests assert that a configured key appears in no
thrown message and no log argument.

Responses are cached **in memory only**, for 6 hours per location, and nothing
is written to disk — Google Maps Platform terms generally prohibit persisting
API content.
