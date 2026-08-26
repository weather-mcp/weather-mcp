# GitHub Copilot instructions

Weather MCP Server — a TypeScript [Model Context Protocol](https://spec.modelcontextprotocol.io/)
server exposing weather data from NOAA, Open-Meteo and other keyless public APIs.

## Read `CLAUDE.md` first

**[`CLAUDE.md`](../CLAUDE.md) in the repository root is the authoritative guide** for working in this
codebase: architecture, conventions, testing, security, configuration and the project's hard-won
rules. Read it before suggesting changes.

This file deliberately **points** rather than repeats. Every rule restated in two places eventually
disagrees with itself, and a stale copy is worse than no copy — so nothing normative is duplicated
here.

## Where the answers live

| Question | File |
|---|---|
| How is the code organised? What are the conventions? | [`CLAUDE.md`](../CLAUDE.md) |
| What does this tool accept and return? | [`docs/TOOLS.md`](../docs/TOOLS.md) |
| What shipped when? | [`CHANGELOG.md`](../CHANGELOG.md) |
| What trap will I fall into here? | [`GOTCHAS.md`](../GOTCHAS.md) |
| How do I contribute a change? | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| How do I report a vulnerability? | [`SECURITY.md`](../SECURITY.md) |

## What to be careful about

These are pointers to decisions, not the decisions themselves — follow the links before acting:

- **This server reports severe weather.** `CLAUDE.md` draws a distinction between data whose failure
  must propagate loudly and enrichment that may degrade silently. Getting it backwards can produce a
  confident all-clear that is false. Do not infer which side a code path is on from the code around
  it; `CLAUDE.md` says.
- **Existing output is a contract.** Adding a feature must leave current output byte-identical when
  the new flag or key is absent. Existing tests are locks — if one needs editing, the change is
  larger than it looks.
- **Every tool works without an API key.** A few optional keys extend coverage; none is ever required.
- **All logging goes to stderr.** `stdout` carries the MCP protocol, so a stray `console.log` corrupts
  the transport.

## Before opening a pull request

`npm run build` (0 errors), `npm test` (all passing), `npm audit` (clean). `CLAUDE.md` has the full
checklist and the commit-message convention.
