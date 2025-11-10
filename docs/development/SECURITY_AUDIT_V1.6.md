# Weather MCP Security Audit
Generated: 2025-11-10

## Overview
- Focused on data-in-transit protections, privacy posture, and input/output handling in the MCP server (`src/`).
- Activities: manual code review plus documentation scan. No penetration testing or live API calls were performed.
- Threat model assumptions: the server may run in a shared environment (logs shipped to SaaS aggregators), and untrusted clients can exercise all MCP tools.

## Findings

### 1. Blitzortung lightning feed defaults to plaintext MQTT (Severity: High)
- Evidence: `src/services/blitzortung.ts:51-59` hard-codes `mqtt://blitzortung.ha.sed.pl:1883` and never enables TLS or authenticates the broker.
- Impact: Anyone on the same network path can sniff or tamper with lightning messages. Injected strikes can trick the tool into issuing false "EXTREME" safety guidance, while sniffed data reveals which areas your users monitor.
- Recommendation: Default to a TLS endpoint (e.g., `wss://`), expose certificate pinning/rejectUnauthorized options, and fail loud when `BLITZORTUNG_MQTT_URL` uses plaintext. Document how to provision credentials or run a proxy if the public broker never enables TLS.

### 2. Precise user coordinates are logged without redaction (Severity: Medium)
- Evidence: multiple handlers call `logger.info` with raw lat/lon pairs, e.g., `src/handlers/lightningHandler.ts:175-180`, `src/handlers/weatherImageryHandler.ts:55-60`, and `src/handlers/marineConditionsHandler.ts:44-76`. The lightning service also logs every strike with coordinates (`src/services/blitzortung.ts:215-224`).
- Impact: In hosted deployments, log aggregation creates a timestamped record of every user query (including sensitive locations like private residences). That violates data-minimization requirements (GDPR/CPRA) and increases breach impact if logs leak.
- Recommendation: Either remove location logging by default or round/nonce the coordinates. Provide a config flag (e.g., `LOG_PII=false`) so operators must explicitly opt into verbose telemetry. Ensure strike logging happens at DEBUG level and is disabled unless troubleshooting.

### 3. `search_location` echoes unsanitized input into Markdown (Severity: Medium)
- Evidence: `src/handlers/locationHandler.ts:41-44` inserts `query` directly into `**Query:** "${query}"` without escaping newlines or Markdown control characters.
- Impact: An attacker can craft a query like `Seattle"\n![exfil](https://attacker.example/pixel)` to make downstream Markdown renderers fetch arbitrary URLs, causing SSRF-like traffic from the MCP client or exfiltration beacons inside trusted conversations.
- Recommendation: Escape user-provided strings before embedding in Markdown (replace `*`, `_`, `[`, `]`, `(`, `)`, and normalize whitespace). Add a regression test that proves injected Markdown is rendered literally.

### 4. `get_river_conditions` enables trivial DoS amplification (Severity: Medium)
- Evidence: The handler always calls `getAllNWPSGauges()` (`src/handlers/riverConditionsHandler.ts:41-49` and `src/services/noaa.ts:692-710`), downloading the entire U.S. gauge catalog for every request, regardless of radius.
- Impact: A malicious client can repeatedly trigger multi-megabyte downloads and heavy geospatial filtering, starving the server and rate-limiting legitimate NOAA traffic. Because the MCP server keeps doing this even for tiny radii, the attacker does not need elevated privileges.
- Recommendation: Introduce server-side rate limits, fetch gauges via bounding boxes, and cache the national catalog so repeat requests hit memory instead of NOAA. Treat this as an availability fix and add monitoring for unusually high `getAllNWPSGauges` call counts.

## Additional Notes
- Automated tests and dependency audits were not executed in this pass; rerun `npm audit` and `npm test` after addressing the above.
- Consider extending the existing `SECURITY.md` with guidance on log retention, TLS requirements for third-party feeds, and safe Markdown rendering practices so operators understand the configuration knobs.
