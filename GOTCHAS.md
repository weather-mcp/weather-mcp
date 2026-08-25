# GOTCHAS

Curated institutional memory: trigger-keyed traps that have actually bitten
this codebase, each with the rule, why it exists, and the evidence. Entries
carry stable `G<n>` ids and are never renumbered — a retired entry moves to the
Graveyard with a reason rather than being deleted.

This file is **committed**. `/impl-plan` cites matching entries per task,
`/plan-review` checks coverage of them, and `/run-plan` pastes only the matching
entries into a subagent's prompt. Subagents never write here; they report
surprises and the orchestrator curates.

The broader standing conventions live in `CLAUDE.md` ("Project Conventions").
This file is for the sharper, more surprising traps — the ones where the
obvious-looking code is wrong.

---

## G1 — A green `npm test` does not mean the build compiles

**Trigger:** any change to `.ts` source, especially editing a long string
literal in `src/index.ts`.

**Rule:** run `npm run build` and read its output. Never infer build health
from a passing test suite, and never commit on `npm test` alone.

**Why:** Vitest transpiles each module itself and does not type-check, so
`tsc` errors do not fail the suite. A syntax error in a tool description can
sit behind 2,492 passing tests.

**Verify:** introduce a deliberate `tsc` error, run `npm test`, and confirm it
still passes.

**Evidence:** 2026-08-23 (`e612a74`, national CAP alerts T10) — an apostrophe
in `the alert's own polygon` terminated a single-quoted string in
`src/index.ts`; `npm test` reported 101 files / 2,492 tests passing while
`npm run build` emitted three TS1005/TS1128 errors.

**Status:** active. **Re-verified 2026-08-24** (optional-mqtt curation): two
deliberate `TS2322`/`TS6133` errors in `src/utils/version.ts` still left
`npm test` reporting 103 files / 2,519 tests passing. Lint candidate — the gate
already runs `build` before `test`; the trap is reading only the second result.

---

## G2 — Long tool descriptions in `src/index.ts` are single-quoted

**Trigger:** editing any `description:` string in `TOOL_DEFINITIONS`.

**Rule:** these are single-quoted TypeScript strings on one very long line.
Never introduce a raw `'` — rewrite the phrase (`the alert polygon`, not
`the alert's own polygon`) rather than escaping, so the line stays readable.

**Why:** the strings are long enough that an apostrophe is invisible in review,
and the resulting error points at a *different* line hundreds of lines away
(the next string literal that gets mis-paired).

**Verify:** `grep -n "description: '" src/index.ts` and confirm none of the
matched strings contains an unescaped `'`.

**Evidence:** 2026-08-23 (`e612a74`) — the reported errors were at
`src/index.ts:783,785,789`, while the actual defect was at `:417`.

**Status:** active. Related: [G1].

---

## G3 — `XMLValidator.validate` accepts several documents that are not one root

**Trigger:** parsing XML from any upstream feed.

**Rule:** validate with `XMLValidator` **before** parsing (the parser itself is
lenient and will not throw), and then **also** check the parsed shape: exactly
one root key that does not start with `?`, and that key's value must not be an
array.

**Why:** three separate gaps, all verified live against `fast-xml-parser`
5.11.0. `XMLParser.parse('<a><b></a>')` returns `{"a":{"b":""}}` without
throwing, so the parser can never be the well-formedness check. `XMLValidator`
*accepts* two distinct self-closing roots (`<rss>…</rss><feed/>`). And it also
accepts two self-closing roots sharing a tag name (`<alert/><alert/>`), which
the parser then silently coalesces into a single key holding a 2-element array
— which is why "exactly one non-PI root key" alone is insufficient. The `?xml`
and `?xml-stylesheet` processing-instruction keys are why the check excludes
`?`-prefixed keys rather than counting all keys.

**Verify:** `src/utils/capParse.ts` `parseXml` guard 7, and the two-root cases
in `tests/unit/cap-parse.test.ts`.

**Evidence:** 2026-08-23 (`f1b757e`, national CAP alerts T3) — found in scratch
against the installed parser version, not from documentation.

**Status:** active.

---

## G4 — A right-root document with no usable envelope is not an empty feed

**Trigger:** parsing any index/list response on safety-critical data.

**Rule:** distinguish three outcomes explicitly — a valid envelope with no
items (**honest empty**, return normally), a missing or unusable envelope
(**throw**), and a transport failure (**throw**). Never return `[]` for a shape
you did not recognise.

**Why:** `<rss><error>maintenance</error></rss>` and `<rss><channel/></rss>`
both have the expected root. Returning `[]` for them renders a ✅ "no active
alerts" built from a maintenance page — a fabricated all-clear, which on alert
data is the single worst failure this codebase can produce. Note
`<rss><channel/></rss>` parses `channel` as the empty **string**, not an
object, so the check must be `isPlainObject`, not truthiness.

**Verify:** `parseCapIndex`'s envelope checks and the corresponding cases in
`tests/unit/cap-parse.test.ts` / `tests/unit/national-cap-service.test.ts`.

**Evidence:** 2026-08-23 (`f1b757e`) — raised as a blocker in the Codex plan
review (codex-R2) before implementation.

**Status:** active. Sharper instance of CLAUDE.md's "never trust the HTTP 200
alone" and "distinguish empty from not-covered".

---

## G5 — `Cache.generateKey` joins with an unescaped `:`

**Trigger:** building a cache key from two or more untrusted upstream strings.

**Rule:** encode the tuple as **one injective token** —
`JSON.stringify([a, b])` — and pass that as a single component. Never pass the
untrusted parts as adjacent components.

**Why:** `Cache.generateKey(...components)` joins with `:` and escapes nothing
(`src/utils/cache.ts:175-189`). Upstream identifiers routinely contain colons
(`urn:uuid:…`), as do ISO timestamps, so `('thread:2026-08-23T00', '00:00Z')`
and `('thread', '2026-08-23T00:00:00Z')` collide — serving one alert's document
under another alert's key.

**Verify:** the key-injectivity test in
`tests/unit/national-cap-service.test.ts`.

**Evidence:** 2026-08-23 (`0918007`, national CAP alerts T4) — raised in the
Codex plan review (codex-R4) with the concrete colliding pair.

**Status:** active. Lint candidate — a rule flagging `generateKey` calls with
more than one non-literal argument.

---

## G6 — Cache the unfiltered set; filter at read time

**Trigger:** caching any list whose members expire, are superseded, or are
otherwise time-filtered.

**Rule:** cache the **complete, unfiltered** parsed list and run the filter on
every return, cached or fresh. Never cache post-filter. Any count derived from
the filtered view must be derived **at return**, never cached alongside the
list.

**Why:** two distinct bugs. Caching post-filter stops an original alert
reappearing when the Update that superseded it expires first (supersession is
deliberately evaluated after expiry, so an expired Update's references are
inert), and it re-fetches every expired document on each refresh. Separately, a
count computed at refresh time and cached will be rendered over a
*re-filtered* list later — so a disclosure line can name a number that
contradicts the block printed beneath it.

**Verify:** `MeteoAlarmService.getWarnings` (`src/services/meteoalarm.ts:238-270`)
and `NationalCapService.readView`; the resurrection and derived-count tests in
`tests/unit/national-cap-service.test.ts`.

**Evidence:** established by MeteoAlarm; re-confirmed 2026-08-23 (`0918007`,
`17b403b`) where the count half was raised as a major plan-review finding (R2)
before implementation.

**Status:** active.

---

## G7 — Never freeze per-refresh state into a long-TTL cache entry

**Trigger:** enriching a cached record with data fetched separately (geometry,
a secondary lookup) after reading it from cache.

**Rule:** cache the record **without** the enrichment state, build a fresh copy
each refresh, and write the enrichment only into the copy. Cache the
enrichment itself only on **success**, so a failure is retried next time.

**Why:** the document cache has a 24-hour TTL; the enrichment can fail
transiently. Writing the failure flag into the cached object makes one timeout
render that alert degraded for a full day, long after the upstream recovered.

**Verify:** `freshCopy` in `src/services/nationalCap.ts`, and the
fail-then-succeed-across-refreshes test in
`tests/unit/national-cap-service.test.ts`.

**Evidence:** 2026-08-23 (`0918007`) — raised as a major plan-review finding
(R1) before implementation.

**Status:** active.

---

## G8 — A bounded array that trims must never be used for exclusion

**Trigger:** applying a cap to any upstream array whose members are then tested
for membership/containment.

**Rule:** when a cap trims a set used to decide "does this apply to the user?",
discard the set **entirely** and disclose it. Never keep the partial set.

**Why:** with polygon rings, keeping the first 256 of 257 means a point covered
only by ring 257 reads as *elsewhere* and the warning is dropped — a fabricated
all-clear produced by a defensive limit. Degrading the whole warning to the
disclosed country-level path is the safe direction.

**Verify:** `buildRings` in `src/utils/capParse.ts`, `applyRings` in
`src/services/nationalCap.ts`, and the 257-ring tests in both suites.

**Evidence:** 2026-08-23 (`f1b757e`, `0918007`) — raised as a major plan-review
finding (codex-R5).

**Status:** active. Note the companion trap: a pure zero-I/O util *detects* the
trim but cannot log it, so the **service** must emit the `securityEvent`
(found at `17b403b` when the inline path was trimming silently).

---

## G9 — Live smoke tests must rethrow anything that is not a transport failure

**Trigger:** writing or editing a test under `tests/integration/` that hits a
live API.

**Rule:** classify the caught error. Skip (log and pass) **only** on the
service's own fixed transport strings; **rethrow** everything else. Put every
`expect` **after** the `try/catch`, guarded on the result being defined. Declare
an empty upstream explicitly rather than letting an all-items loop pass
vacuously.

**Why:** `vitest.config.ts` has no `include`, so `tests/integration/` runs on
every `npm test`. A catch-all that swallows assertion and shape errors turns a
real upstream contract regression into a logged "network flake" that nobody
investigates — and a vacuous loop over an empty feed makes a broken parser look
healthy.

**Verify:** `grep -n 'isTransportFailure\|throw' tests/integration/national-cap-alerts.test.ts`,
and confirm no `catch` block in that file contains `expect(`.

**Evidence:** 2026-08-23 (`2d564ef`) — the shape being avoided is
`tests/integration/international-alerts.test.ts:299-325`, which puts its
`expect`s inside the tolerant catch; raised as a major plan-review finding
(codex-R7).

**Status:** active.

---

## G10 — Byte-identity sweeps: run back-to-back, key both sides, and prove the hash is not vacuous

**Trigger:** proving output is unchanged by diffing built-dist output against a
base worktree.

**Rule:** build both trees first, then run the two probes **back-to-back**.
When a probe needs an API key, load it once and pass it **explicitly into both
child environments**. Assert the keyed marker (e.g. the provider's attribution
line) is present in both outputs *before* comparing hashes. A diff of one line
that is a feed's own timestamp is drift, not a regression — re-run tighter
rather than "fixing" it.

**And the inverse, which is the more dangerous half: an identical md5 proves
nothing until you have confirmed the changed line was actually rendered on both
sides.** Before trusting a match, grep both outputs for the construct under test
and assert it is present. A feed that is failing renders a degraded block with
the construct absent, so both sides hash the same and the sweep reports success
without having exercised the change at all.

**Why:** three independent traps. Live feeds embed their own `Updated` stamps, so
a gap of even a few minutes between runs fabricates a diff. And `.env` is
gitignored, so a base worktree has none — `dotenv` reads each process's own
cwd, meaning the base silently runs *keyless* while the branch runs keyed, and
the resulting mismatch gets blamed on the feature. Third: a *matching* hash is a
false negative whenever the upstream is down, and nothing about the result says
so — the sweep's own output looks exactly like a pass.

Note the load asymmetry that makes the third trap easy to hit: `detail="full"`
fetches 25 alert documents where `standard` fetches 10, so the heavier detail
level rate-limits (SACHET 403s) on a path the lighter one sails through. The
sweep at default detail can be green while the at-`full` read is silently empty.

**Verify:** `.claude/scratch/national-cap-alerts/alerts-sweep.mjs` (gitignored
scratch) and the md5 table in the archived plan set's implementation notes.
Before trusting any match, `grep -c` both outputs for the construct under test
and confirm the count is non-zero on **both** sides — an identical hash over two
degraded blocks is the failure this check exists to catch.

**Evidence:** 2026-08-23 (national CAP alerts T9) — the first sweep showed
Kansas City differing; the diff was one line, NOAA's own `**Updated:**` stamp
advancing 1:02 → 1:06 AM. A tighter re-run was byte-identical with no masking.
The key-propagation half was raised as a major plan-review finding (codex-R10).
The drift half recurred verbatim 2026-08-24 (`6c6a749`, remainder-note-detail
T3): Kansas City again differed by exactly the `**Updated:**` stamp, and New
Delhi by two alert blocks transposing as the feed churned.

2026-08-24 (`6c6a749`) added the vacuous-identity half: the at-`full` India read
returned md5-identical base vs branch and would have been recorded as a pass, but
SACHET was 403-ing — the output carried `99 alerts … could not be loaded` and no
remainder line at all, so the one line the change touches was absent from both
sides. Six back-to-back retries all failed; a 4-minute backoff got a healthy pair
on the second round, and the real diff was then exactly one line.

**Status:** active. Related: the auto-memory note
`live-verification-driver-hangs` (drivers need an explicit `process.exit(0)`;
never run two live drivers in parallel).

---

## G11 — Read the rendered output, not just the assertions

**Trigger:** finishing any feature that renders text a human will read — a
tool's output, and equally a script's own progress or summary line.

**Rule:** run the built dist against real coordinates and **read** the output
before tagging. Cover both unit systems and every provider path the change
touches. For a script, read what it actually printed and what it actually
wrote to disk; the exit code is not the acceptance.

**Why:** a whole class of defects is invisible to assertions because every
assertion passes: text that is internally contradictory, a count that disagrees
with the list beneath it, a quantity mislabelled in a safety line, duplicated
suffixes, and plain grammatical wrongness in generated prose.

**Verify:** each shipped feature's implementation notes in
`.devdocs/archive/completed/` record what was probed and what it showed.

**Evidence:** 2026-08-23 (`1997659`) — live output read
`No active weather alerts for your location in Philippines`; the bare feed name
is wrong in a prepositional phrase and no test could see it. Same rule caught
the v1.20.0 `**X** (X)` suffix duplication and a percentage contradicting its
own label.

Generalised 2026-08-24 (`eee2612`, changelog-link-refs T1): the new link-block
check printed `✅ … [Unreleased] → v1.24.0` built from the newest **tag** rather
than the base it had just parsed, so mid-release-prep it would have asserted the
block pointed at the old version while it pointed at the new one. Every case
passed and the exit code was 0; only reading the line caught it.

**Status:** active. This is the highest-yield entry in the file.

---

## G12 — `check-doc-versions.sh` validates three of the four test-count sites

**Trigger:** any change that moves the test count — i.e. every commit that adds
or removes a test.

**Rule:** when the count moves, **four** places change: `README.md`'s shields
badge (line ~6), `README.md`'s "N tests" body line (~61), `README.md`'s
`npm test` comment (~346), and `CLAUDE.md`'s **Test Coverage** line (~578).
`update-docs-for-release.sh` rewrites all four; the checker validates only
three. **The `npm test` comment is the unvalidated one** — read it back by eye
after any hand-edit, and never infer it from a green checker.

**Why:** the checker's README test-count grep (`[0-9,]+ (automated )?tests`)
takes `head -1`, which lands on the body line at ~61 and never reaches the
`Run all N tests` comment 285 lines further down. The failure is silent and
reads as success: `✅ README.md test count` while that line is stale.

**Verify:** set `Run all N tests` in `README.md` to a deliberately wrong number
and run `./scripts/check-doc-versions.sh` — it still reports all checks passed.
(The same experiment on the **badge** now correctly fails; do not use the badge
to test this entry.)

**Evidence:** first recorded 2026-08-24 (`338c2b0`) as "the badge is never
validated". Re-running that Verify line on 2026-08-24 during the
changelog-link-refs run **falsified the badge half**: `tests-9%2C999%20passing`
extracts `9999` and reports `❌`, because `31ce822` (2026-07-07) had already
added the encoded-badge check this entry's own Status line had proposed as its
lint candidate — the entry was written against a stale reading of the script.
The `head -1` gap at `README.md:346` is real and survives, confirmed by the same
deliberate-wrong-value experiment: `9,999` there still reports `✅`.

**Status:** active, **narrowed** 2026-08-24, **re-verified 2026-08-24**
(optional-mqtt curation): `Run all 9,999 tests` in `README.md` still produced
`✅ All documentation checks passed!`. Note the line has since moved to
`README.md:381` — a new section was inserted above it — so match it by content,
never by line number. Lint candidate — anchoring a third check on
`Run all [0-9,]+ tests` specifically would close it mechanically and
let this entry retire. Standing lesson beyond the specific gap: an entry
asserting that a checker *misses* something has a shelf life, so run its Verify
line before relying on it.

---

## G13 — A uniform-value fixture cannot test a "pick the most common" computation

**Trigger:** writing fixtures for code that selects a mode, majority, or maximum
— `mostly <severity>`, a top-N, a winning category.

**Rule:** the fixture must carry **at least two distinct values, and a
deliberate tie**. A fixture where every item shares a value exercises the
selection with a single candidate, so the comparison, the tie-break, and the
ordering are all unobservable — the test reads as coverage and is not.

**Why:** `remainderNote`'s severity mix was "covered" by four fixtures that were
uniformly `Moderate`. Flipping its tie-break from first-wins to last-wins
(`count > topCount` → `>=`) passed **all 2,508 tests**, while a real 3-vs-3 tie
flips the rendered line from `mostly Moderate` to `mostly Minor`. Uniform
fixtures are the easy default precisely because they make the *other* assertions
(counts, pluralisation) simplest to write.

**Verify:** mutate the comparison in the selection loop
(`src/handlers/alertsHandler.ts`, `remainderNote`'s `count > topCount`) to `>=`
and confirm at least one test goes red.

**Evidence:** 2026-08-24 — found by mutation testing during the
remainder-note-detail diff review; closed by `74b69ab`, which added a
clear-majority case and an exact-tie case. Both new cases also fail when the
loop is mutated to take the last severity seen rather than the most common.

**Status:** active. Sharper instance of [G11] — every assertion passes and the
output is still wrong. Not lintable: only a human can tell that a fixture is
degenerate with respect to the thing it claims to test.

---

## G14 — Both release scripts run the full Vitest suite internally

**Trigger:** editing `scripts/check-doc-versions.sh` or
`scripts/update-docs-for-release.sh`.

**Rule:** never iterate by re-running the whole script. Extract the block you
are changing into a scratch harness — `awk` it out of the real file by its
sentinel comment so the two cannot diverge — and exercise every case there.
Run the real script only to confirm the pass and one deliberate failure.

**Why:** `check-doc-versions.sh` shells out to `npm test` to get the count it
validates against (`:91`), so every invocation costs ~65 s. `update-docs-for-release.sh`
runs the suite itself (`:139`) **and** then invokes the checker (`:257`), which
runs it again — so a release dry run is ~2.5 minutes, and neither cost is
visible from reading the script's top. A five-case truth table iterated against
the real checker is half an hour that a harness does in under a second.

**Verify:** `grep -n 'npm test' scripts/check-doc-versions.sh scripts/update-docs-for-release.sh`
— any hit means the script is suite-bound and needs the harness treatment.

**Evidence:** 2026-08-24 (`eee2612`, `1aca484`, changelog-link-refs T1/T2) — the
implementation plan carried this as a written warning to the builder before the
work started, and it held: the seven-case truth table for the new link-block
rules (including the forced-empty tag set and the mid-release-prep exemption
with its control) ran standalone, and the real checker was invoked twice.

**Status:** active. Related: [G1] — the same "run the thing you are actually
changing, and read what it says" discipline, one layer up.

---

## G15 — A tag-keyed invariant cannot check the release it is being run for

**Trigger:** adding a verification rule keyed off git tags, release numbers, or
any marker that is created *after* the check runs in the procedure.

**Rule:** enumerate the moments the check actually executes and ask what the
marker's state is at each one. If the artefact under test has no marker yet at
the moment that matters, add a companion rule keyed off something that *does*
exist then — `package.json`'s version, the branch, the file itself. Guard the
companion on the marker being **absent**, so the two rules partition the cases
instead of double-reporting the same defect.

**Why:** `check-doc-versions.sh`'s R1 ("every tagged heading has a definition")
runs at `update-docs-for-release.sh:257`, step 9 of release prep — before the
human cuts the tag at step 4 of the printed "Next steps". The version being
released therefore has no tag, so it was the single version R1 could not check,
and the only one the run existed to verify. The exemption that lets the gate pass
on its own first run cast a shadow exactly the width of the new release: a
promoted heading with no definition reported `✅ CHANGELOG link block: 28
definitions` and exited 0 — the very drift the block was written to prevent.

**Verify:** per [G14], `awk` the link block out of the checker and run it against
a `CHANGELOG.md` whose newest heading has no matching definition, with
`PACKAGE_VERSION` set to that version and no tag for it. R4 must report
`is being released but has no link definition`; deleting the R4 block makes the
same case pass green, which is the shape of the original defect.

**Evidence:** 2026-08-24 — found by the changelog-link-refs diff review
(finding 1) by mutating the one case the gate could not see; closed by `1adc1cb`,
which added R4 beside R1. Two regression cases keep it honest: no-double-report
(tagged **and** missing → 1 error, not 2) and no-false-fail (version bumped with
no heading yet → 0).

**Status:** active. Related: [G12] — both are a checker reporting success over
the thing it does not actually look at.

---

## G16 — `git describe --tags` is ancestry-nearest and matches any tag shape

**Trigger:** deriving a release's previous version, or any compare base, from
git tags.

**Rule:** pass `--match='v*'` (or the project's release-tag glob). When another
part of the system independently computes "the newest tag", make both sides use
the same definition and say so in a comment — an ancestry-nearest emitter and a
version-sorted checker agree right up until someone cuts an odd tag.

**Why:** `git describe --tags --abbrev=0` returns the nearest reachable tag by
**ancestry** and considers **all** tag names, so a single `backup-before-refactor`
checkpoint makes it return that instead of `v1.24.0`. Release prep then writes
`[1.25.0]: …/compare/backup-before-refactor...v1.25.0` — a link that *resolves*
on GitHub and silently shows the wrong diff range, which no key-only check can
see. It also disagreed with `check-doc-versions.sh`'s R3, which reads
`git tag -l 'v*' --sort=-v:refname`.

**Verify:** `git tag tmp-probe && git describe --tags --abbrev=0` returns
`tmp-probe`, while `git describe --tags --abbrev=0 --match='v*'` still returns the
newest release tag; then `git tag -d tmp-probe`. Confirm the glob is still in
place with `grep -n 'describe --tags' scripts/update-docs-for-release.sh`.

**Evidence:** 2026-08-24 — changelog-link-refs diff review (finding 2),
reproduced in a throwaway clone; closed by `8adc053`. The glob also fixes a
quieter case: when only non-release tags exist, `LAST_TAG` is now empty, so D4's
`releases/tag/vX.Y.Z` fallback fires where the old code emitted a bogus compare
URL. The checking side is covered independently by R5 (`6a88ce4`), which rejects
a compare whose left side is not a release tag.

**Status:** active.

---

## G17 — A lazy optional import must memoise the in-flight promise, not just the value

**Trigger:** loading an optional module with a dynamic `import()` from anywhere
two or more callers can start concurrently — especially a fire-and-forget
startup loop.

**Rule:** assign the import **promise** synchronously, before the first `await`,
and return that same promise to every concurrent caller. Do the absence
classification and the one-time logging inside its shared rejection handler. A
loaded/`null`/`undefined` value memo handles *later* calls but does not coalesce
callers already in flight.

**Why:** every concurrent caller observes the value as `undefined`, starts its
own import, and runs its own rejection handler — so the "once per process"
warning fires once per caller. `src/index.ts` starts every saved-location
prewarm with `void blitzortungService.prewarmLocation(...)` and never awaits the
previous one, so any user with two saved locations exercises this on every
startup.

**Verify:** hold a mocked import behind a deferred rejection, start two callers,
release it, and assert the import factory and the warning were each observed
exactly once — `tests/unit/mqtt-optional.test.ts` contract 3.

**Evidence:** 2026-08-24 (`7101a5f`, optional-mqtt T1) — raised as a major
finding in the Codex plan review (R1) before implementation, and the live run
confirmed the shape: three saved locations, one warning.

**Status:** active. Related: [G20], which is the same file's other concurrency
trap and the one that actually shipped.

---

## G18 — `import type` erases at runtime but still requires the package at build time

**Trigger:** moving a TypeScript runtime dependency to `optionalDependencies`
while still importing anything from its bundled declarations.

**Rule:** distinguish the **published package** from a **source build**. The
emitted JavaScript can boot without the package; `tsc` cannot compile without
it. Document the opt-out only for the published package, and verify it by
installing a packed tarball with `--omit=optional` — never by building from a
source tree that still has the package present.

**Why:** `import type { X } from 'pkg'` emits no runtime import, which makes it
look as though the dependency is fully optional. It is not: TypeScript must
still resolve the declarations, and an isolated strict Node16 probe with the
package absent fails `TS2307: Cannot find module 'pkg' or its corresponding type
declarations`. A `README` that says `npm install --omit=optional` without
qualification therefore hands source-installers a red build rather than a
working server with one tool disabled.

**Verify:** `npm pack`, install the tarball into a fresh prefix with
`--omit=optional`, confirm `npm ls <pkg>` resolves nothing there, and run the
installed `dist/index.js`. Then confirm the opposite: `npm run build` from a
source tree without the package fails `TS2307`.

**Evidence:** 2026-08-24 (`6bfbbdb` / `ef97915`, optional-mqtt) — raised as a
major finding in the Codex plan review (R2) and independently reproduced. Every
documented command in `README.md` and `docs/CLIENT_SETUP.md` is consequently the
`npm install -g @dangahagan/weather-mcp --omit=optional` form, each carrying an
explicit source-build caveat.

**Status:** active. Directly relevant to the pending micro-dependency vendoring
work, which touches the same dependency block.

---

## G19 — A specialized tool has a second public path through `get_weather_summary`

**Trigger:** changing a handler, service, dependency, or error contract behind
any section `get_weather_summary` can render — `current`, `forecast`, `alerts`,
`air_quality`, `lightning`.

**Rule:** grep **both** the tool dispatch in `src/index.ts` and the summary's
own `switch` in `weatherSummaryHandler.ts`. Exercise the change through both
tools, and document both user-visible consequences.

**Why:** preset membership differs between the two. `get_lightning_activity` is
absent from the default `basic` preset while `get_weather_summary` — which calls
the same handler through its `include` array — **is** in it. So a change to a
"tool that is off by default" can still be the thing a default install actually
experiences, and reasoning about the specialized tool alone gets the blast
radius wrong. The summary also catches per-section failures into a
`## <section> (unavailable)` block, so a thrown error surfaces very differently
there than it does from the tool.

**Verify:** search `SummarySection` and the summary switch, then drive the
changed section through both MCP tools against the built dist.

**Evidence:** 2026-08-24 (optional-mqtt) — raised as a minor finding in the
Codex plan review (R3). It corrected the design plan's framing (which called
lightning "a tool that is switched off"), added a test contract, and added a
built-dist probe that would otherwise have been missed entirely.

**Status:** active.

---

## G20 — Never introduce an `await` between a synchronous guard flag and the check that reads it

**Trigger:** adding any `await` inside a method that guards concurrent entry
with a plain boolean — `if (this.isBusy) { wait } ... this.isBusy = true`.

**Rule:** the assignment must remain in the **same synchronous run** as the
check. Before inserting an await above it, move the awaited work to the caller
and pass the result in. If you cannot, the boolean is no longer a guard and the
method needs a real single-flight promise instead.

**Why:** such a guard is sound only because no other caller can interleave
between the check and the assignment. One `await` in that window lets every
concurrent caller past: each sets the flag and each performs the guarded work.
Here that meant three MQTT broker connections instead of one, with two clients
orphaned — still connected, still holding `message` handlers — because each
attempt overwrote `this.client`. **Nothing in the test suite could see it**: all
2,511 pre-existing tests plus the seven new ones passed while the branch was
opening three connections. It was found only by counting
`Connecting to Blitzortung MQTT broker` lines in live stderr.

**Verify:** stub the connection factory, start two concurrent callers, and
assert `connect()` was called exactly once —
`tests/unit/mqtt-optional.test.ts` contract 8. Reinstating the bad placement
fails that test and **only** that test.

**Evidence:** 2026-08-24. Introduced by `7101a5f` (resolving the optional module
inside `ensureConnected`), shipped green, caught by reading live output during
T4, fixed in `30ad5cf` by resolving in `subscribeToLocation` and passing the
module in.

**Status:** active. Related: [G17] (the same file's other concurrency trap) and
[G11] — this is the sharpest instance yet of the exit code not being the
acceptance.

---

## G21 — Re-importing under `vi.resetModules()` is not the module you imported at the top

**Trigger:** writing a test that uses `vi.resetModules()` plus a dynamic
re-import to reset module-level state, or `vi.doMock` with a factory that
throws.

**Rule:** three things, all learned the hard way:

1. **Class identity is per-epoch, transitively.** A class imported at the top of
   the test file will never satisfy `instanceof` against an error thrown by a
   freshly re-imported module, because that import re-resolves *its* imports
   into new class objects too. Re-import the error module (and `logger.js`, for
   spies to observe the same singleton) **inside** the same reset epoch and use
   those references.
2. **A `vi.doMock` factory cannot deliver a coded error.** Vitest's mocker wraps
   whatever the factory throws in a *new* `Error` — the stock "top level
   variables" hoisting warning, which fires even when nothing is hoisted — and
   moves the original to `.cause` **without copying custom properties**. So
   `err.code` is `undefined` at the code under test, and any
   `code === 'ERR_MODULE_NOT_FOUND'` branch is unreachable through that route.
3. **Re-importing re-runs module bodies, including singleton construction.** If
   a module ends in `export const x = new Thing()` and that constructor starts
   an un-`unref`'d `setInterval`, every case leaks a live timer. Wrap only
   `resetModules()` + the `import()` in `vi.useFakeTimers()` and switch back
   immediately — the timers land on the fake clock and are abandoned, and the
   test body still gets real timers for genuine timeout races.

**Why:** each of these produces a confusing failure that looks like a bug in the
code under test — `expected MqttUnavailableError to be an instance of
MqttUnavailableError`, a classification branch that "does not work", or a suite
that reports green and then hangs.

**Verify:** `tests/unit/mqtt-optional.test.ts` — its file header documents all
three and its helpers implement the workarounds.
`tests/unit/tool-config.test.ts:31-34` is the simple precedent that hits none of
them, which is why it is a misleading model on its own.

**Evidence:** 2026-08-24 (`dbcefd8`, optional-mqtt T3), **Vitest 4.1.11**.
Points 1 and 3 cost real debugging time; point 2 required a scoped
`Error.prototype.code` getter bridging to `.cause` to make the branch reachable
at all.

**Status:** active, **version-stamped**. Point 2 in particular is tied to
`@vitest/mocker` internals — re-run the Verify line after any Vitest major
upgrade, and retire that clause if the wrapper stops discarding `.code`.

---

## G22 — Re-measure a published number at the scope you publish it

**Trigger:** putting a measured quantity — package counts, sizes, timings — into
`README.md`, `CHANGELOG.md`, or an issue.

**Rule:** measure it again, in the form the reader will reproduce, before
writing it down. Prefer the number the tool itself reports over one you derive.
A figure inherited from a design document is an assumption, not a measurement.

**Why:** the same quantity legitimately differs by scope, and the discrepancy is
silent. The optional-`mqtt` design plan measured `110 → 72 packages, 38 removed`
and that figure did not reproduce anywhere: a dev tree gave `158 → 117` (41 by
name, 42 by tree path, because `find` over hoisted directories misses nested
copies), while a fresh install of the packed tarball — the thing a user actually
runs — gave **`163 → 121`, 42 removed**. Three methods, three answers, and `38`
was about to ship in the changelog and the README.

**Verify:** for package counts, install the packed tarball into a fresh prefix
both ways and quote npm's own `added N packages` line, which is what the user
sees in their terminal.

**Evidence:** 2026-08-24 (`9b61494` / `ef97915`, optional-mqtt T4) — caught as
amendment A8 during `/run-plan` when the declaration finally existed to measure
against; the design plan's `## Context` was corrected rather than copied
forward.

**Status:** active. Sharper, numeric instance of [G11].

---

## G23 — `ERR_MODULE_NOT_FOUND` and `MODULE_NOT_FOUND` are different codes from different loaders

**Trigger:** classifying a failed dynamic `import()` by `error.code` to decide
whether a package is absent.

**Rule:** `ERR_MODULE_NOT_FOUND` is the **ESM** loader failing to resolve a bare
specifier — that, and only that, is the `--omit=optional` case. A CommonJS
package (no `"type": "module"`, a `"main"` entry) that resolves but then fails to
require one of *its own* dependencies throws `MODULE_NOT_FOUND` instead, from
inside the CJS loader. Checking only the first is correct for "did the installer
skip this package?" and silently wrong for "is this package usable?". Decide
which question you are asking, and never let the second one fall through to a
caller that returns an empty result.

**Why:** `mqtt` is CommonJS. The optional-dependency work classified absence on
`ERR_MODULE_NOT_FOUND` and rethrew everything else raw, where
`getLightningStrikes`'s pre-existing `catch` turned it into `return []` — which
renders as `## 🟢 Safety Status: SAFE (LIMITED DATA)`, `Total Strikes: 0`. A
green safety verdict assembled from a module that never loaded, on the one tool
whose whole point is a hazard. The two codes look interchangeable and are not,
and the difference only appears with a *damaged* install rather than an absent
one — a state no test had reason to construct.

**Verify:** `mv node_modules/<pkg>/node_modules/<dep> ...hidden`, or overwrite
the package's `main` file with a syntax error, then read `error.code` from a
dynamic import. It is `MODULE_NOT_FOUND`, not `ERR_MODULE_NOT_FOUND`.

**Evidence:** 2026-08-25 (`f523adb`, found by `/diff-review` on
`feat/issue-73-optional-mqtt`) — reproduced both ways against the built dist
installed from a packed tarball. Fixed by giving the load failure its own
`MqttLoadFailedError` with its own remedy, since telling someone to reinstall
without `--omit=optional` when they never omitted it points at the wrong fix.

**Status:** active. Related: [G4] — a module that fails to load is not an empty
feed; [G24].

---

## G24 — Making a dependency optional converts a boot failure into a runtime result

**Trigger:** moving any runtime dependency behind a lazy `import()`, for any
reason.

**Rule:** a static top-level import fails **loudly at startup** for every reason
the module might be unusable — absent, corrupt, half-installed, incompatible. A
lazy import narrows that to whichever reason you explicitly classify, and routes
every other reason into whatever the call site's `catch` already does. Before
landing the change, enumerate the states the static import used to catch and
check each one against the new call path. On safety data the question to ask is
"which of these now renders as a normal result?"

**Why:** this is the trap underneath [G23], and it generalises past `mqtt`. The
optional-dependency plan reasoned carefully about *absence* — it is in the
design's `## Verification`, it has four test contracts — and never asked what
else the static import had been catching. Before the change a corrupt `mqtt`
meant the server did not start and `tools/list` never answered; after it, the
server booted cleanly and answered a lightning query with a green banner. The
change that made the failure survivable is what made it silent.

**Verify:** with the package installed but deliberately corrupted, call the tool
and **read the rendered output** — not the exit code, not the logs.

**Evidence:** 2026-08-25 (`f523adb`) — the diff review's only major finding. The
whole gate stayed green throughout: `tsc` clean, 2,519 tests passing, `npm
audit` clean, and no unit test could observe it, because the suite mocks the
package.

**Status:** active. Related: [G23], [G20], [G11].

---

## G25 — A re-invoked mock proves your memo retried, not that a retry can succeed

**Trigger:** asserting that a failed dynamic `import()` is "retried, not cached",
using a mocked module factory.

**Rule:** Node caches a module that failed to load, so re-importing the same
specifier in the same process replays the same rejection no matter what your own
memo does. A `vi.doMock` factory is re-invoked on every import and hides that
entirely, so a green "it retried and then succeeded" assertion can coexist with a
process that can never recover. Keep the **memo** claim ("we do not cache the
absence") separate from the **outcome** claim ("a repaired install heals without
a restart"), and never publish the second on the strength of a test that only
establishes the first.

**Why:** the optional-`mqtt` loader deliberately leaves its memo `undefined`
after a load failure so the next caller retries, and test contract 4 proves it
by watching an `attempts` counter go 1 → 2 and then succeed. On that evidence
"repairing the install takes effect without restarting the server" was written
into `docs/ERROR_HANDLING.md` and `CHANGELOG.md`. It is false: a server started
against a corrupted `mqtt`, with the package repaired underneath it while
running, still returned the load-failure error on the next query. Our code did
retry; Node returned the cached rejection. The mock was more forgiving than the
runtime, and the assertion that passed was not the claim that shipped.

**Verify:** run the built dist against a genuinely broken package, repair it on
disk while the process is still running, and call the tool again.

**Evidence:** 2026-08-25 — caught during `/diff-review` by probing a claim
written minutes earlier; all three copies corrected to say a restart is needed.

**Status:** active. Related: [G21] (the same file's mock/runtime divergences),
[G11], [G23].

---

## Graveyard

*(No retired entries yet. When an entry's trap is refactored away, move it here
with the reason and the commit that removed it — never delete, never renumber.)*
