# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.33.x   | :white_check_mark: |
| 1.32.x   | :white_check_mark: |
| 1.31.x   | :white_check_mark: |
| 1.30.x   | :white_check_mark: |
| 1.29.x   | :white_check_mark: |
| 1.28.x   | :white_check_mark: |
| 1.27.x   | :white_check_mark: |
| 1.26.x   | :white_check_mark: |
| 1.25.x   | :white_check_mark: |
| 1.24.x   | :white_check_mark: |
| 1.23.x   | :white_check_mark: |
| 1.22.x   | :white_check_mark: |
| 1.21.x   | :white_check_mark: |
| 1.20.x   | :white_check_mark: |
| 1.19.x   | :white_check_mark: |
| 1.18.x   | :white_check_mark: |
| 1.14.x   | :white_check_mark: |
| 1.13.x   | :white_check_mark: |
| 1.8.x   | :white_check_mark: |
| 1.7.x   | :white_check_mark: |
| 1.6.x   | :white_check_mark: |
| 1.5.x   | :white_check_mark: |
| 1.4.x   | :white_check_mark: |
| 1.3.x   | :white_check_mark: |
| 1.2.x   | :white_check_mark: |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of the Weather MCP Server seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Where to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisory** (Preferred): Use the [GitHub Security Advisory](https://github.com/weather-mcp/weather-mcp/security/advisories/new) feature
2. **Email**: Send an email to the project maintainer via GitHub profile contact information
3. **GitHub Issues**: For non-critical security concerns, you may open a regular issue with the `security` label

### What to Include

Please include the following information in your report:

- Type of vulnerability (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the vulnerability
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within **48 hours**
- **Initial Assessment**: We will provide an initial assessment of the vulnerability within **7 days**
- **Fix Timeline**:
  - **Critical vulnerabilities**: Patch within 7-14 days
  - **High vulnerabilities**: Patch within 14-30 days
  - **Medium vulnerabilities**: Patch in next regular release
  - **Low vulnerabilities**: May be addressed in future releases

### Security Update Policy

- Security patches will be released as soon as possible after verification
- Security advisories will be published after patches are available
- CVE IDs will be requested for vulnerabilities when appropriate
- Security releases will be clearly marked in release notes

## Security Best Practices for Users

### Dependency Security

`tz-lookup` and `astronomy-engine` are pinned to exact versions, because
`package-lock.json` is not published and a range would let your install pick up a
release nobody here has reviewed. Geohash encoding for lightning subscriptions is
vendored in `src/vendor/ngeohash.ts` (from `ngeohash` 0.6.4, MIT, notice kept in
the file) rather than installed.

These are the runtime dependencies `package.json` declares:

- `@modelcontextprotocol/sdk` - Official MCP SDK from Anthropic
- `axios` - HTTP client for every upstream request
- `dotenv` - Environment variable loader
- `luxon`, `tz-lookup` - Time zones and local-time formatting
- `astronomy-engine` - Sunrise, sunset and moon phase
- `pngjs` - Decoding and encoding composited radar images
- `mqtt` (optional dependency) - The lightning feed. The server starts without
  it; only `get_lightning_activity` needs it
- `fast-xml-parser` - The project's first XML dependency, added for the
  national CAP alert feeds. Every document is refused before parsing if it
  carries a `<!DOCTYPE` declaration (defence in depth against the
  entity-expansion class; these feeds never use one), and well-formedness is
  checked with `XMLValidator` rather than trusting the parser, which is
  lenient by design and would otherwise accept malformed input silently.

**Automated Scanning:**

Run dependency audits regularly:
```bash
npm run audit
```

To automatically fix vulnerabilities (when safe):
```bash
npm run audit:fix
```

### GitHub Dependabot

We recommend enabling GitHub Dependabot for automated dependency updates:

1. Dependabot is enabled by default for public GitHub repositories
2. Configure `.github/dependabot.yml` if you want to customize update frequency
3. Review and merge Dependabot PRs promptly

Example `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

### Environment Security

- Never commit `.env` files or API keys to version control
- No tool requires a credential. Four optional keys add coverage (see [Optional API keys](README.md#optional-api-keys)); set them only in the environment
- Use environment variables for configuration (see README.md)

### Deployment Security

- Run the server with minimum necessary privileges
- Keep Node.js updated to the latest LTS version
- Use `npm ci` instead of `npm install` in production for reproducible builds
- Consider running in a containerized environment for isolation

## Known Security Considerations

### No Credentials Required

Every tool works with no API key, token or account. Four optional keys (NCEI, NASA FIRMS, Google Pollen, Google Weather) extend coverage; see [Optional API keys](README.md#optional-api-keys).

### What leaves your machine, and what stays on it

**Stays on your machine:**

- **Cache**: Weather responses are cached in memory only. Nothing from the cache is written to disk, and it is gone when the server exits
- **Saved Locations**: Aliases you save are stored in `~/.weather-mcp/locations.json`. On Linux and macOS, the server creates the directory `0700` and the file `0600`, so only your account can read them. A directory or file that already exists keeps its permissions. An install from an earlier version stays as it was until you run `chmod 700 ~/.weather-mcp && chmod 600 ~/.weather-mcp/locations.json`
- **Logging**: By default the server's stderr log carries no saved names, aliases, geocoding queries or notes, and rounds coordinates to about 1 km. A failed tool call is logged by tool name, error class and argument names, not by its arguments or message. Setting `LOG_PII=true` lifts this for local debugging. The MQTT broker URL's credentials are never logged under any setting
- **Analytics salt**: Only when analytics is enabled at the `detailed` level, and unless `ANALYTICS_SALT` is set, the server generates a random salt and stores it in `~/.weather-mcp/analytics-salt` (a new file is `0600`, a new directory `0700`). At any other setting no salt is generated and no file is created. The salt is never sent anywhere; it only makes the detailed-level session hash one-way. If the file cannot be written, the server keeps the salt in memory and makes a new one at the next start. An empty salt file is replaced with a new salt. A salt file the server cannot read is left untouched, and the server keeps a new salt in memory for that run. `ANALYTICS_SALT` supplies the salt without creating the file. A file left by an earlier version is unused unless `detailed` is enabled, and you may delete it

**Sent to other services:**

- **Weather data sources**: The coordinates of each request go to the service that answers it (see [Data sources](README.md#data-sources)). Saved-location names, aliases and notes are not sent
- **Place-name lookup**: A `city_name`, a `location_query`, or a `WEATHER_DEFAULT_LOCATION` place name is sent as you typed it to the geocoders, tried in turn: Census.gov (for queries that look like US places), Nominatim (OpenStreetMap) and the Open-Meteo geocoding API
- **Country lookup**: Tools that route by country (alerts, wildfire, rivers) send the coordinates to Nominatim's reverse lookup, unless the location already carries a country code
- **Optional keys**: All four go over HTTPS, but not in one place. The NCEI token is a request header, the FIRMS map key is part of the URL path, and the two Google keys are URL query parameters. None is written to the logs or shown in error messages
- **Lightning feed**: When you ask for lightning, through `get_lightning_activity` or a `get_weather_summary` request that includes its lightning section, the server subscribes to the Blitzortung MQTT broker for coarse geohash cells around that point. When `get_lightning_activity` is enabled and `WEATHER_LIGHTNING_PREWARM` is on (the default), it also subscribes around each saved location, before you ask. The cells cover an area, not a point, but they show the broker roughly where you are asking about and where your saved places are. The default broker connection is **unencrypted** (`mqtt://`, port 1883), and the server logs a security warning when it connects that way. Set `BLITZORTUNG_MQTT_URL` to an `mqtts://` or `wss://` broker for TLS
- **Analytics**: Off by default, with no default destination. Nothing is sent unless you set `ANALYTICS_ENABLED=true` **and** `ANALYTICS_ENDPOINT`, which must be an `https://` URL on a domain name. Each event holds the server version, the tool name, success or error, the time rounded down to the hour and the analytics level; an error event adds an error category. `ANALYTICS_LEVEL=standard` adds the response time. `detailed` adds a one-way session hash and the event's sequence number in that session. No coordinates, place names, arguments or results are sent. The payload holds no IP address, but the endpoint sees the IP address of your connection, as any HTTPS server does

### Network Security

- Every weather, geocoding and imagery request uses HTTPS. The one exception is the lightning feed's default MQTT connection, described above
- Certificate validation is enabled by default (via axios)
- **URLs taken from a feed body are allowlisted before they are fetched.** The
  national CAP feeds supply their own document and geometry URLs; each is
  checked against that feed's exact HTTPS host list and path prefixes, with
  userinfo and explicit ports rejected, before any request is made. Redirects
  are **not followed** (`maxRedirects: 0`), so a 3xx cannot walk a request off
  an allowlisted host, and response size is capped at the transport as well as
  after reading. A refused URL is counted, logged as a security event, and
  never fetched — and no log or error message ever contains the URL itself,
  a response body, or alert geometry.
- **The same holds for the radar imagery feed.** RainViewer's metadata supplies
  a `path` for each radar frame, which the server joins to the fixed tile host
  `https://tilecache.rainviewer.com`. Every path must be `/`-separated segments
  of letters, digits, `_` and `-`, at most 128 characters, and every frame time
  must be a finite number in the date range. One bad frame refuses the whole
  metadata response; the tool reports an error rather than show an older frame
  as the latest. The metadata request follows no redirects and caps the body at
  256 KiB. The upstream `host` field is ignored.
- **Every imagery tile fetch is bounded.** A radar tile is requested only when
  its URL is HTTPS on exactly `tilecache.rainviewer.com`, with no userinfo and no
  explicit port. Radar tiles and NASA GIBS base-map tiles follow no redirects,
  and each response is capped at the transport (2 MiB per radar tile, 1 MiB per
  base-map tile). Each tile's PNG header is checked for the exact tile size and
  for no interlacing before it is decoded, and before a base-map tile is cached,
  so a small body cannot declare an image large enough to exhaust memory. A
  refused frame or tile URL is logged as a security event with a count or a
  reason code, never the path or the URL.

## Security Testing

### Current Security Controls

✅ **Implemented:**
- Comprehensive input validation with runtime type checking
- Error sanitization to prevent information leakage
- No hardcoded secrets or credentials
- Strong TypeScript typing with strict mode
- Graceful shutdown and resource cleanup
- Structured logging
- Comprehensive automated test coverage

### Recommended Security Testing

1. **Dependency Auditing**: `npm run audit` (weekly)
2. **Static Analysis**: TypeScript strict mode catches many issues
3. **Input Fuzzing**: Test coordinate inputs with edge cases
4. **Error Path Testing**: Verify error messages don't leak sensitive info

## Security Audit History

- **2025-11-10**: Comprehensive security audit for v1.6.0 release (See SECURITY_AUDIT.md)
  - Overall Security Posture: **A- (Excellent, 93/100)**
  - Risk Level: **LOW**
  - Zero critical or high-severity vulnerabilities
  - 1,042 tests passing with 100% pass rate
  - Code Quality: A+ (97.5/100)

- **2025-11-06**: Initial comprehensive security audit for v1.5.0
  - Overall Security Posture: **B+ (Good)**
  - Risk Level: **LOW**
  - Zero critical or high-severity vulnerabilities
  - All recommended critical fixes implemented

## Scope Exclusions

The following are **out of scope** for security reports:

- Vulnerabilities in third-party upstream APIs
- Runtime environment security (Node.js, OS)
- Network infrastructure
- Physical security
- Social engineering

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security Best Practices](https://docs.npmjs.com/security-best-practices)
- [GitHub Security Features](https://docs.github.com/en/code-security)

## Questions?

If you have questions about this security policy, please open a GitHub issue with the `question` label.

---

**Last Updated**: September 30, 2026
