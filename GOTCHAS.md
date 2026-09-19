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

**Status:** active. **Verify line re-run 2026-09-02** (noaa-forecast-horizon-disclosure curation): typing `deliveredHours` as `string` in `src/handlers/forecastHandler.ts` — the file this plan changed — produced `TS2322`, `TS2365` and `TS2362` (the latter two at the two sites that consume it, which is the load-bearing direction) while `npm test` reported 121 files / 2,941 tests passing; the trap is intact. **Verify line re-run 2026-09-01, second time** (openmeteo-nullable-scalar-types curation): a `TS2322` planted in `src/utils/finiteSample.ts` (1 error) while `npm test` reported 120 files / 2,933 tests passing; the trap is intact. The same run leaned on the load-bearing direction as its keystone: widening 63 scalar declarations *after* the guards had landed produced **0** build errors, which is the only evidence that the four handlers were the complete consumer set (`824dc02`). **Verify line re-run 2026-09-01** (marine-sea-state-taxonomy curation): a `TS2322` planted in `src/utils/marine.ts` (2 errors) while `npm test` reported 118 files / 2,917 tests passing; the trap is intact. The same run met the load-bearing direction on its first task — see [G63]. **Re-run 2026-08-28** (issue-83 absent-strike-distance curation): a `TS2322` and two `TS6133` errors planted in `src/handlers/lightningHandler.ts` — the file this plan changed — while `npm test` reported 114 files / 2,772 tests passing. The trap is intact. The same run also exercised this entry in the **load-bearing direction**: widening `LightningStatistics` to `number | null` *first* produced exactly two `TS18047` errors at the two render sites and no others, which is the only evidence that no other `src/` file consumes the field — a green suite says nothing about it. **Re-verified 2026-08-24** (optional-mqtt curation): two
deliberate `TS2322`/`TS6133` errors in `src/utils/version.ts` still left
`npm test` reporting 103 files / 2,519 tests passing. **Re-verified 2026-08-26**
(cap-disclosure-accuracy curation): the same two error codes in
`src/handlers/alertsHandler.ts` while that file's own suite reported 41/41
passing. The trap is intact and unchanged. Lint candidate — the gate already
runs `build` before `test`; the trap is reading only the second result.

---

## G2 — Long tool descriptions in `src/server/weatherServer.ts` are single-quoted

**Trigger:** editing any `description:` string in `TOOL_DEFINITIONS`.

**Rule:** these are single-quoted TypeScript strings on one very long line.
Never introduce a raw `'` — rewrite the phrase (`the alert polygon`, not
`the alert's own polygon`) rather than escaping, so the line stays readable.

**Why:** the strings are long enough that an apostrophe is invisible in review,
and the resulting error points at a *different* line hundreds of lines away
(the next string literal that gets mis-paired).

**Verify:** `grep -n "description: '" src/server/weatherServer.ts` and confirm
none of the matched strings contains an unescaped `'`.

**Evidence:** 2026-08-23 (`e612a74`) — the reported errors were at
`src/index.ts:783,785,789`, while the actual defect was at `:417` — line numbers
in the file as it was then.

**Status:** active; **file moved 2026-09-09** (issue-95) — `TOOL_DEFINITIONS` was
carried byte-for-byte from `src/index.ts` into `src/server/weatherServer.ts`, so
the rule is unchanged and only the path moved. **Verify line re-run 2026-09-18**
(`35fcba8`, search-location-limit-bound T1, which edits the `search_location`
`limit` description): all 74 `description:` strings in the file parse with a
balanced closing quote and none carries an unescaped inner `'`. The replacement
text was chosen apostrophe-free rather than escaped, per the rule. Related: [G1],
and [G103] — the same file's *test* side is typechecked by nothing at all.

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

**Extended 2026-08-27** (`028b750`, river/marine band-rounding T5) — **the
vacuity can come from the *subject you picked*, not only from a failing feed,
and that half survives a perfectly healthy upstream.** The plan named St. Louis
as the US river point for a change to the forecast-series flood label. Roughly
4 in 5 NWPS gauges carry no forecast series at all, and St. Louis's carry none —
so even on a green feed that probe renders no series, exercises none of the
changed code, and hashes identical on both sides. The run's first sweep hit
*both* halves at once: the construct count was zero because NOAA was also
rate-limiting, and the body read `Error details: Rate limit exceeded for NOAA`
on each side. **So the construct grep is not only a health check on the feed; it
is a check that the subject you chose can express the construct at all.** Choose
the probe subject by confirming it carries the construct (here: probe candidate
tidal and major-river points and keep one whose gauges have a series — Portland
OR yielded 8), then assert the count, then compare hashes. Re-pointing there took
the count from 0/0 to 16/16.

**The base column can be the defect's own proof, 2026-09-02** (`d40e309`,
noaa-forecast-horizon-disclosure T3). Where the defect *is* "the output does not
distinguish X from Y", the sweep's **base** hashes state it in one line: Memphis
at `days: 7`, `days: 10` and `days: 16` all hashed to `11bb816c…` on base, and
the two summary probes at `days: 7` and `days: 10` both to `8c88efa8…`. Two
probes that *should* differ hashing identically is the bug, not drift — the
opposite reading from this entry's usual one, and worth asserting deliberately
when the plan's whole premise is that a distinction is missing.

**The unit-level twin, 2026-09-03** (`84fbcef`, critical-alert-banner T4). This entry is
written for live sweeps, but the vacuity is available to **any `toBe` between two generated
strings**, with no network involved. A byte-identity contract of the shape "render with the flag
absent equals render with the flag `false`" passes just as happily when a fake service failed and
both sides are an error string — and a unit test has no feed to blame, so nothing looks wrong.
Five such locks came back from the subagent comparing two renders with no assertion that either
had rendered; the fix is the same construct check the live half uses, one line per side
(`expect(textOf(a)).toContain('# Weather Forecast')`). **Generalise the rule as: a hash or a
`toBe` is a claim about two things being equal, never a claim that either exists.**

**The normalisation itself can fabricate a difference, 2026-09-08** (`f5d51a3`/`c4626a7`,
forecast-auto-source-contract T5). Where the sweep's job is "prove the diff set is *exactly*
these N lines" rather than "prove no diff", the natural method is to strip the expected lines
and hash the remainder. Stripping a rendered line's **text** with `grep -v` leaves the blank
line that line appends, so two probes whose only real difference was the two expected lines
still hashed differently, and the first reading was "there is a third change". There is no such
change; `cat -s` on both sides resolves it. **Use `diff` as the authority on *what* changed and
the hash only to summarise it** — a hash tells you two things differ, never where, and a
line-oriented normalisation has to account for a rendered line's surrounding whitespace as well
as its text.

**Status:** active, **extended 2026-08-27, 2026-09-02 and 2026-09-03**, **re-run 2026-09-01**
(openmeteo-nullable-scalar-types T1–T3: the plan told the sweep in advance that
a probe landing on a wire null would differ from base by exactly the omitted
line and to record that as the fix, not drift — Sydney Heads (two `Peak Period`
lines) and Denver (one `Ammonia` line) did exactly that, while Paris and both
summary paths hashed identical with the constructs present; classifying before
comparing is what made a non-identical hash a pass rather than a retry),
**re-confirmed 2026-08-28**
(`95faae9`, issue-85 river coverage disclosure T2) — a second instance of the
subject-vacuity half, found the cheap way. The plan called for "a US point with
no gauge in radius"; the candidate picked for it, Nevada `39.00,-117.00`,
**returned 2 gauges**, so it could not express the construct at all. Memphis at
`radius: 1` reaches the branch, and the pair then hashed identical with the
construct grep non-zero on both sides. Confirming the subject *before* the sweep
cost one probe; discovering it afterwards would have invalidated the record.
Related: [G47] (the same vacuity where the output is a bare number, with a
positive control in place of the construct grep), [G37] (a driver that
constructs any service never exits without an explicit `process.exit(0)`, and
parallel drivers were what first made this feed drift look like NOAA rate
limiting), [G28] (a probe whose parse cannot see what it is looking for).

**A display cap can hide a construct the data actually has, 2026-09-17**
(wildfire-display-coherence T5). The construct is not always absent from the
*feed* — it can be absent from the *render*. The plan's suggested subject,
Sacramento `r=300`, carries a 97%-contained fire and so can express the
nine-cell bar; but `get_wildfire_info` shows only the nearest **five** fires at
default `detail`, and that fire is the **seventh**. The probe reported zero
95-99-band fires and the subject looked wrong when it was the *view* that was
narrow. Two other candidates each expressed one of the two constructs and never
both. **Sweep the parameter that widens the view — `detail`, a limit, a page
size — before rejecting a subject**: `detail="full"` turned the same coordinates
into the verified subject carrying both constructs. Corollary for the plan
author: "expected, given the live null share" is a claim about the feed, and the
acceptance criterion is about the report.

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

**The same degeneracy hides on a *seam* rather than on a value, 2026-09-18**
(`7a5b9b1`, nws-alert-jurisdiction T1). A property asserting two bounding-box
predicates are disjoint — `isInUS(p) && isInNwsTerritory(p)` false for every
fixture — is vacuous at any coordinate no fixture occupies, and the coordinate
that matters is the **shared endpoint**. Boxes here are written with inclusive
comparisons on both sides, so two boxes that "touch" at `-65.2` (`<= -65.2` and
`>= -65.2`) are both true on that exact line: they overlap. The plan's own
mutation row predicted such a mutation would "stay green, by design — edges
touch, boxes do not overlap", and it did stay green, for the wrong reason. Where
a property is about the relationship between two ranges, put a fixture **on** the
seam and one just inside the gap, not only at the region centres. Shipped code was
unaffected (a real `0.05` gap), but the check that was supposed to defend it was
not defending it.

**Status:** active. **Verify line re-run 2026-08-26** (cap-disclosure-accuracy
curation): mutating `count > topCount` to `>=` still turns exactly one test red
(`alerts-remainder-detail.test.ts` — *"resolves a tie deterministically, by
first appearance in the remainder"*), so `74b69ab`'s tie case still holds the
line. The same run applied this entry prospectively rather than forensically:
the two new fixtures in `alerts-national-cap.test.ts` were mutation-checked
*before* being committed (revert `countryLevel` → `shownCountryLevel`, confirm
both go red), which is the cheaper end of this lesson. Sharper instance of [G11]
— every assertion passes and the output is still wrong. Not lintable: only a
human can tell that a fixture is degenerate with respect to the thing it claims
to test.

---

## G14 — Both release scripts run the full Vitest suite internally

**Trigger:** editing `scripts/check-doc-versions.sh` or
`scripts/update-docs-for-release.sh`.

**Rule:** never iterate by re-running the whole script. Extract the block you
are changing into a scratch harness — `awk` it out of the real file by its
sentinel comment so the two cannot diverge — and exercise every case there.
Run the real script only to confirm the pass and one deliberate failure.
**Capture the exit code and the output on that first invocation** — redirect to a
file and echo `$?` in the same command. There is no cheap second look, and
re-running it only to find out whether it passed costs another full suite.

**Why:** `check-doc-versions.sh` shells out to `npm test` to get the count it
validates against (`:70`), so every invocation costs ~65 s. `update-docs-for-release.sh`
runs the suite itself (`:163`) **and** then invokes the checker (`:277`), which
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
runs at `update-docs-for-release.sh:277`, step 9 of release prep — before the
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

**Rule:** grep **both** the tool dispatch in `src/server/weatherServer.ts` and
the summary's own `switch` in `weatherSummaryHandler.ts`. Exercise the change through both
tools, and document both user-visible consequences. **Read what the summary
passes down before assuming the sub-tool's own default applies** — it does not
forward an absent parameter, it substitutes its own.

**Why:** preset membership differs between the two. `get_lightning_activity` is
absent from the default `basic` preset while `get_weather_summary` — which calls
the same handler through its `include` array — **is** in it. So a change to a
"tool that is off by default" can still be the thing a default install actually
experiences, and reasoning about the specialized tool alone gets the blast
radius wrong. The summary also catches per-section failures into a
`## <section> (unavailable)` block, so a thrown error surfaces very differently
there than it does from the tool.

**And the summary calls the same handler with different arguments, not with
the caller's.** `weatherSummaryHandler.ts` builds one `subArgs` object for every
section, and `const detail = validateDetail(typedArgs.detail, 'summary')` makes
its default detail **`summary`**, not the `standard` that `get_alerts` defaults
to on its own. So a change gated on detail level can be *invisible* through the
summary at its default while being live through the specialized tool — the two
paths render different branches of the same handler. `subArgs` also blanks
`compare_models` and `ensemble_spread` outright. "Same handler, therefore same
output" is the wrong inference; the right one is "same handler, different
arguments, so check which branch each path lands in".

**Verify:** search `SummarySection` and the summary switch, then drive the
changed section through both MCP tools against the built dist — and drive the
summary at an **explicit** detail level as well as at its default, comparing the
two in one run.

**Evidence:** 2026-08-24 (optional-mqtt) — raised as a minor finding in the
Codex plan review (R3). It corrected the design plan's framing (which called
lightning "a tool that is switched off"), added a test contract, and added a
built-dist probe that would otherwise have been missed entirely.

**Broadened 2026-09-03** (`6345182`, japan-alerts T10) with the half that is
about **dependency injection rather than arguments**. Routing reaches the
summary automatically; a *service* does not. Adding a trailing optional
parameter to `handleGetAlerts` is safe by construction at every existing call
site — which is exactly why the summary's own call site is easy to miss: it
compiles, every test passes, and the new branch is simply never taken from that
path. Both cross-vendor prep-review legs filed it independently as this plan's
only blocker. Proved by running the built dist both ways: with the parameter
threaded a Japanese point rendered JMA and Google's `isKeyAvailable()` was never
called; with it omitted, Google **was** contacted for the same point. So the
grep is two greps — `src/server/weatherServer.ts` for the dispatch **and**
`weatherSummaryHandler.ts` for the summary switch — and the acceptance check is
that both chains pass the new argument, not that the build is clean.

**Status:** active. **Re-verified live 2026-08-25** (`99ba469`,
lightning-safe-message-coherence T5): under the genuine default preset the
server exposes 6 tools — `get_lightning_activity` **absent**,
`get_weather_summary` **present** — and the summary rendered the changed
lightning text in four safety states. Getting that probe honest required [G26]:
the first attempt ran from the repo root and silently tested the `full` preset.

**Broadened 2026-08-26** (`f2bb40e`, cap-disclosure-accuracy T4) with the
`subArgs` half above. The implementation plan asserted that
`get_weather_summary` "passes no `detail`, so it renders at the `standard`
default" and built its live probe on that; the probe came back with **no
disclosure line at all** and would have read as a clean negative ([G28]) had the
plan's expected shape not been asserted first. The summary was rendering the
`detail === 'summary'` counts branch, where the changed line has never existed.
Re-run at an explicit `detail: 'standard'`, both paths disclosed the same
corrected count in the same run. The plan's premise was wrong, not the code —
which is the point: this is a claim a plan can state confidently and get
backwards, because it is invisible in the summary's own `switch`. Lint candidate
— a test asserting `subArgs.detail` for each section would pin it mechanically.

**Sharpened 2026-08-27** (`ffe8e6b`, issue-82 display-band-coherence T6) — **the
"substitutes its own" half is true of exactly seven keys, and guessing which is
how a plan gets the blast radius wrong in the other direction.**
`weatherSummaryHandler.ts:111-125` **spreads the caller's `args` first** and then
overrides only `latitude`, `longitude`, `location_name`, `city_name`,
`compare_models`, `ensemble_spread` and `detail`. Everything else — `units`,
`units_*`, `include_fire_weather`, `source` — **passes straight through**,
confirmed live: `units: 'metric'` renders `16.1 km (clear)` inside the summary's
current section. So the rule is not "the summary substitutes its own arguments"
but "the summary overrides seven named keys and forwards the rest": read the
override list, do not infer it in either direction.

And the `detail` hazard only bites sections that *read* `detail`.
`currentConditionsHandler.ts` never reads it at all (its single match is the
comment `// Cloud cover details`), so for that section the summary's default
`summary` and an explicit `standard` render identically — which is why the T6
probe could assert the same string at both levels rather than finding the
counts-branch surprise the 2026-08-26 entry above records for alerts. **Check
whether the section under test reads `detail` before predicting that the two
paths diverge.**

**Re-verified 2026-08-28** (`de592f6`, issue-83 absent-strike-distance) — and worth
noting that the Verify line does **not** require a live probe. That plan forbade
one (the state is unreachable through `filterStrikes`, and per [G30] a first
lightning probe reports zero strikes anyway), yet the summary path was still
driven for real: a scratch driver stubbed `blitzortungService` on the built dist
and called `handleGetWeatherSummary` directly at its default `detail` and at all
three explicit levels. All four rendered the changed lines identically
(`**Nearest Strike:** distance unavailable`, no `0.0 km`, no `undefined`). The
implementation plan had *inferred* both paths agreed, on the sound-looking
ground that the statistics lines sit outside any `detail` gate — which is exactly
the inference the 2026-08-26 entry above records getting backwards for alerts.
**A fixture-driven drive of the summary handler costs a minute and replaces the
inference; "no live probe allowed" is not a reason to skip it.**

**The second path exists in the *schema* too, 2026-09-02** (`b4b18a3`,
noaa-forecast-horizon-disclosure T4) — **and a docs task that qualifies one
tool's parameter leaves the summary's declaration contradicting it.** Every
parameter the summary forwards is declared **twice** in `TOOL_DEFINITIONS`: once
on the specialized tool and once on `get_weather_summary`. When the NOAA
forecast-horizon plan corrected `docs/TOOLS.md`'s `days` entries for both tools,
`src/index.ts:332` already read `1-16 for global, 1-7 for US NOAA` while `:478`
read a bare `(1-16, default: 7)` — so the summary's pre-call contract said one
thing and its own docs page said another, on a parameter whose post-call
behaviour is identical through both tools. The plan had deferred `:478` on the
reasoning that `:332` "is already accurate and `:478` is left with it"; accuracy
is not inherited between two independent strings.

Note the tier argument that made the deferral look principled and is wrong: a
risk floor covering `TOOL_DEFINITIONS` **forbids `light`**, it does not forbid
the edit. On a plan already at `standard` the floor is satisfied and touching one
description string buys no extra ceremony. **Check whether the floor is actually
costing anything before deferring on it.**

**Verify:** for any parameter the summary forwards,
`grep -n "description: '" src/server/weatherServer.ts` and read the specialized
tool's declaration against the summary's. They should
express the same constraint or say why they differ.

**Evidence:** raised as `copilot-R1` in the plan review, re-rated to minor by
triage, accepted by the owner at `/run-plan`'s opening and landed in T4.

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

**Status:** active. Related: [G17] (the same file's other concurrency trap),
[G11] — this is the sharpest instance yet of the exit code not being the
acceptance — and [G100], the same mechanism one layer up: there the `await` sits
between a read and the write that depends on it, and the module it reads through
being fully synchronous does not help.

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
`README.md`, `CHANGELOG.md`, or an issue — **or copying a count out of a design
or implementation plan into a code comment, a doc line or a commit body.**

**Rule:** measure it again, in the form the reader will reproduce, before
writing it down. Prefer the number the tool itself reports over one you derive.
A figure inherited from a design document is an assumption, not a measurement.
That holds for a count a plan states about the code as much as for a benchmark:
a plan is written before the work and nothing re-checks its arithmetic, so the
executor is the last reader who can. Measure it with the one-line grep and write
what you measured.

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

**A *resolved-but-badly-shaped* import is a different case from a rejected one,
2026-09-03** (`b3f4c37`, japan-alerts T3). The retry above is observable only
because a **rejected** `import()` is not cached by Node, so `vi.doMock`'s
factory is re-invoked and an `attempts` counter goes 1 → 2. When the import
*succeeds* and merely resolves to a badly-shaped module — an empty array where a
table was expected, a non-array export — Node installs a real module record, and
**Node's own cache, not the mocker, governs the second call**: the factory is
not re-invoked and `attempts` stays 1. A test written on the assumption that the
mqtt-style pattern applies uniformly asserts the wrong number and fails. The
correct claim for the resolved case is not "our memo retried" but "our code
re-validates and re-rejects on every call rather than trusting a one-time-cached
bad shape" — a different property, and the one worth having.

**Status:** active. Related: [G21] (the same file's mock/runtime divergences),
[G11], [G23].

---

## G26 — The repo's own `.env` means a probe from the repo root is not testing the default configuration

**Trigger:** verifying **default-configuration** behaviour of the built dist —
the default tool preset, default units, default log level, analytics off — by
spawning `node dist/index.js` and unsetting the relevant variable.

**Rule:** unsetting the variable in the child env is **not enough**.
`src/index.ts` imports `dotenv/config`, which reads `.env` from the **process's
cwd**, so a server spawned from the repo root silently inherits the repo's own
gitignored `.env`. To probe a default install, spawn the dist with **cwd set
outside the repo** *and* delete the variables from the child env. Assert the
default you expected before reading anything else — `tools/list` is the cheap
check for the preset.

**Why:** the repo `.env` sets `ENABLED_TOOLS`, `LOG_LEVEL` and the `ANALYTICS_*`
trio. A G19 check of "does `get_weather_summary`'s lightning section work on a
default install?", run from the repo root with `ENABLED_TOOLS` deleted from the
child env, reported **17 tools exposed** — the `full` preset — so it exercised
the very configuration the check exists to look past, and its green result meant
nothing. Run again from a temp cwd it reported **6 tools**, with
`get_lightning_activity` absent and `get_weather_summary` present: the actual
claim G19 makes, actually tested. This is the same hazard as [G10]'s
key-propagation half seen from the other side — there a base worktree has *no*
`.env` and silently runs keyless; here the repo root *has* one and silently runs
configured. Both come from dotenv resolving per-process cwd.

**Verify:** spawn the built dist twice with `ENABLED_TOOLS` deleted from the
child environment — once with `cwd` at the repo root, once with `cwd` at a fresh
temp directory — and compare `tools/list` counts. 17 vs 6 is the trap.

**Evidence:** 2026-08-25 (`99ba469`, lightning-safe-message-coherence T5) — the
first summary probe reported `tools exposed: 17 | get_lightning_activity present:
true` while claiming to test the `basic` preset, in which that tool is absent.

**The cheapest fix is often to not import the importer at all, 2026-08-29**
(`17b2699`, issue-86 T3). `dotenv/config` has exactly **one** importer in this
tree — `src/index.ts:9` — so a verification driver that imports a *handler* and
its services directly (`dist/handlers/riverConditionsHandler.js`) never loads
`.env` on either side, whatever cwd it runs from. That closes this entry and
[G10]'s key-propagation half **by construction** rather than by remembering to
scrub or forward the child environment, and it lets per-call parameters carry the
axis under test (`units` as an argument, not `WEATHER_UNITS` in the environment).
The technique only applies when the entry point you need is reachable below
`src/index.ts`; a probe of the **server's** own defaults — the tool preset, the
`tools/list` count — still has to spawn `dist/index.js` and still needs the
temp-cwd discipline above. Check the importer set (`grep -rn dotenv src/`) rather
than assuming it is still one file.

**Status:** active, **extended 2026-08-29**. **Verify line re-run 2026-08-27** (wildfire band-rounding
T3): the live probe spawned the built dist from a temp cwd with `ENABLED_TOOLS`
**unset** and got **6 tools, `get_wildfire_info` absent**, against the 17 a
repo-root spawn reports — run as an explicit control *before* the keyed and
keyless FIRMS probes beside it, so the isolation was proven rather than assumed.
**Re-run 2026-08-25** (`3d85370`, issue-80
lightning band rounding T4): repo-root cwd reported **17** tools, temp cwd
reported **6**. **Re-run again 2026-08-26** (`6c75bcc`,
issue-78-log-level-numeric T4), this time on the `LOG_LEVEL` half the entry
names: same 17-vs-6 tool split, and with `LOG_LEVEL` deleted from the child env
the repo-root spawn ran at **DEBUG** (the repo `.env:19`) while the temp-cwd
spawn ran at **INFO**. Had the probe stayed at the repo root it would have
"confirmed" a default install logs DEBUG. The trap is intact and unchanged. **Re-run 2026-08-27** (`1501080`, issue-82 display-band-coherence T7): temp cwd with
`ENABLED_TOOLS` unset reported **6** tools against **17** from the repo root, run as an
explicit control before any live read. The finding that made it worth running here:
`get_air_quality` is **absent** from that default preset while `get_weather_summary` is
**present**, so the summary is the *only* way a default install reaches the air-quality
rendering under test — the same [G19] asymmetry this entry's 2026-08-25 evidence found
for lightning, now on a second tool. Related: [G10] (the same
dotenv-cwd hazard, inverted), [G19] (the check this defeats). Lint candidate — a
probe helper that always spawns from a clean temp cwd would close it
mechanically.

---

## G27 — Restore a mutation with a file copy, never `git checkout --`, while the fix under test is uncommitted

**Trigger:** mutation-testing a change that is not yet committed — proving a new
test is real by breaking its subject and watching it go red.

**Rule:** back the file up (`cp`) before mutating and restore from that copy.
`git checkout -- <file>` restores to **HEAD**, which silently discards every
uncommitted change in that file, including the fix you were validating. If the
mutation loop is scripted, make each step's anchor assertion fail loudly rather
than pass silently, so a lost edit surfaces on the next iteration instead of
being reported as a passing mutation.

**Why:** the failure is invisible in the moment — the mutation *does* go red, the
restore *does* succeed, and the tree looks clean. What is gone is the change under
test, so every subsequent mutation runs against the unfixed code and its results
mean something different from what the table records.

**Verify:** edit a tracked file without committing, run
`git checkout -- <that file>`, and confirm the edit is gone with no warning.

**Evidence:** 2026-08-25 (v1.25.1, lightning-safe-message-coherence diff review) —
a four-mutation loop restored with `git checkout --` after each step. The first
restore discarded the uncommitted predicate fix; the second mutation's Python
anchor assertion then failed to match, which is the only reason it was caught.
The mutation evidence survived, but only by luck: the accidental clean-tree run
happened to be a valid proof of the un-fixed case.

**Re-verified the hard way 2026-09-03** (critical-alert-banner T1). Mutating
`src/config/displayThresholds.ts` to widen the gate, then restoring it with
`git checkout -- src/config/displayThresholds.ts`, **deleted the entire new
`criticalAlert` block** — the file was tracked but the block was uncommitted, so
the checkout restored `main`'s version, not the pre-mutation one. Caught only by
the post-mutation control run reporting 18 failures where 0 were expected. The
entry's rule was known and written down and was still the thing that went wrong,
because `git checkout --` is muscle memory. The control run is what makes the
trap cheap: **always end a mutation sweep by re-running the suite on the restored
tree and asserting it is green**, not merely by restoring.

**Status:** active. Lint candidate — a mutation helper that snapshots and restores
by copy would close it mechanically.

---

## G28 — A probe that fails validation reports as a clean negative, not as an error

**Trigger:** writing a live probe or QA driver that parses a rendered report and
branches on what it finds.

**Rule:** when a parse returns null/empty, print the raw response before
concluding anything. A tool call rejected by input validation returns an error
string, not a report — and a parser looking for `**Total Strikes:** (\d+)` finds
nothing in it and yields the same `null` it would yield for a genuinely quiet
sky. Assert the *shape* you expected, not merely the absence of what you were
counting.

**Why:** the two outcomes are opposite in meaning and identical in the driver's
output. "No convection anywhere in four regions" is a plausible-looking result
that ends a QA pass early with a false negative recorded as an observation.

**Verify:** call `get_lightning_activity` with `radius: 800` (the validated range
is 1–500) and confirm the response contains no `**Total Strikes:**` line at all.

**Evidence:** 2026-08-25 (v1.25.1 QA pass) — a storm-locating driver passed
`radius: 800`; all four seed regions returned validation errors, the parser
reported `total=null` for each, and the driver concluded "NO CONVECTION FOUND".
Florida was in fact producing 62 strikes within 500 km at that moment.

**Broadened 2026-08-26** (`21928d3`, issue-78-log-level-numeric T1) — the same
rule, in the opposite direction: a *doubled positive*, not a clean negative. A
sweep of `parseLogLevel` reported **two** `Invalid LOG_LEVEL:` warnings per
invalid value where the contract says exactly one. The code was right and the
probe was wrong: importing `dist/utils/logger.js` to reach the exported parser
also runs the module body, which ends in `export const logger =
createDefaultLogger()` and parses the same variable — so the probe's own import
warned once before the probe's explicit call warned again. Dumping the raw
stderr, as this entry's Rule says, showed two identical lines and made the cause
obvious in seconds. **The general form:** a module that exports a pure function
*and* calls it at load time will run that function's side effects once per
import, so a probe that imports it to call it counts them twice. Probe the
singleton the shipped code actually uses.

**Broadened again 2026-08-27** (`cd0f317`, wildfire band-rounding T3) — the
third direction: a **false positive**, where a parse that does not model the
domain reports correct output as a defect. A live Boise probe printed
`**Distance:** 2.7 km` and `**AWARENESS**`, which reads as an obvious
contradiction — 2.7 km should be the most dangerous tier. It was not a defect.
The tier keys on the nearest **uncontained** fire, the 2.7 km fire was 100%
contained and excluded, and the report said so in its own words two lines above
the tier. The parser had taken the *first* `**Distance:**` line, which is the
nearest fire overall, not the one the tier is computed from. **The general
form:** whenever the value under test is computed over a *filtered* subset, a
parse anchored on the first row of the unfiltered list will disagree with it
legitimately — anchor on what the code anchors on, or read the report ([G11])
before calling it a regression. Nearly reported as a live defect on a correct
build.

**Broadened again 2026-08-27** (`a734bf0`, issue-82 display-band-coherence T5) —
**a fourth direction: a capture group too narrow to see the difference, which
renders incoherence as coherence.** A seam sweep asserted that one printed value
never carries two category labels, capturing the label with
`/\*\*Category:\*\* (\S+)/`. `(\S+)` stops at the first space, so
`Unhealthy for Sensitive Groups` and `Unhealthy` both captured as `Unhealthy` —
and the set-size-1 assertion passed over a genuine collision. Measured: under the
pre-fix rule a printed `150` maps to
`{Unhealthy for Sensitive Groups (Orange), Unhealthy (Red)}`; the wide capture
sees 2, the narrow capture sees 1. The sweep was blind at exactly the threshold
the change's headline example used, and every other threshold *did* go red, so
the suite looked thorough. **This codebase's ladders are mostly multi-word**
(`Very High`, `Unhealthy for Sensitive Groups`, `moderate drying power`,
`dense fog`), so a single-token capture is almost always wrong here: capture to
end of line, and prefer including the trailing colour/qualifier so two rungs
sharing a first word stay distinguishable. Sharper than "assert the shape you
expected": here the shape was asserted and the *parse* could not represent the
difference the assertion was about.

**Two parser slips of the same family, 2026-09-01** (`2e7de75`,
marine-sea-state-taxonomy T5 driver), both of which reported *correct* output
as disagreement: a character class of emoji markers written without the `u`
flag (`/^[🟢🟡🟠🔴🟣] \*\*/`) matches half a surrogate pair and finds no legend
row; and a greedy trailing capture `\((.+)\)$` on the wave line swallowed the
rung's own parenthetical, yielding `wavelets` for `(Smooth (wavelets))`. Both
are the multi-word-ladder lesson above in a new coat: this codebase's names
contain parentheses as well as spaces, and its markers are astral-plane
code points. Match names against the table's own name list, and `startsWith`
the marker rather than classing it.

**Status:** active, **broadened 2026-08-26, twice on 2026-08-27, and 2026-09-01**. Same family as
[G10]'s vacuous-hash half — a failed or mis-scoped measurement that renders as a
clean result — its mirror, a correct result that renders as a failure, and now a
parse too coarse to represent the failure at all.
Not lintable: only the probe's author knows what shape the response should have
had.

---

## G29 — Correcting a published threshold table means grepping the whole doc set, then classifying every hit

**Trigger:** rewriting a published band, threshold, or category table — the
lightning safety bands, the wildfire AWARENESS bands, an AQI or UV table.

**Rule:** before declaring the docs touch-set complete, `grep -rn` the repo for
the **old endpoint strings** and classify every hit as **live reference** or
**frozen history**. Rewrite the live ones; leave the frozen ones alone. An
unexpected live hit is a stop-and-ask, not a silent extra edit.

**Why:** the same table is copied into places a per-page docs map does not
reach, and the two classes need opposite treatment. Rewriting a table inside a
shipped `## [X.Y.Z]` changelog entry falsifies the record of what that version
actually shipped — the bindings' `<user-docs>` list does not include
`CHANGELOG.md` at all, and the new `[Unreleased]` entry supersedes the old text
in the same file anyway. But missing a *live* copy leaves a reader classifying a
report by a table the code no longer honours, which is the whole defect being
fixed. Neither failure is visible from the page you set out to edit.

**Verify:** `grep -rn --exclude-dir=node_modules --exclude-dir=dist -E
'>50 ?km|16-50 ?km|8-16 ?km|<8 ?km' .` and confirm every hit is accounted for by
class.

**Evidence:** 2026-08-25 (`3d85370`, issue-80 lightning band rounding T4) —
raised as `codex-R2` and re-rated to a note by `/plan-triage`, which rejected the
proposed edit and kept the discipline. The grep returned four classes from one
pattern: `docs/TOOLS.md:698-701` live (rewritten), `CHANGELOG.md:522-525` frozen
inside `## [1.5.0] - 2025-11-09` (left alone), `CHANGELOG.md:394` and
`docs/TOOLS.md:817` the **wildfire** AWARENESS band belonging to a different plan
in the same sequence, and four `it()` titles in a test file that is a lock and
must not be edited. Only one of the four was this plan's work, and no per-page
docs map would have surfaced the other three.

**Sharpened 2026-08-27** (`cd0f317`, wildfire band-rounding T4) — **the grep
pattern is itself a place to miss a hit.** The plan's pattern
(`\(<5 ?km\)|\(5-25 ?km\)|…`) did not match `docs/releases/CHANGELOG.md:30-33`,
which writes the same band as `(< 5 km)` — a space after the `<`. Raised as `R4`
by the plan review and confirmed: one frozen file, four unclassified lines. The
same table gets typed with and without spaces around `<`, `-` and `km` across
years of entries, so **write the pattern with `?` on every separator**
(`\(< ?5 ?km\)`) and re-run it after editing, not only before. The action for
that hit was still "leave" — `docs/releases/CHANGELOG.md` is the frozen
historical copy ending at 1.6.0 that the bindings say never to write to — so a
missed hit here would have cost nothing; the next one may not be frozen.

**The plan's own classification table can be incomplete, 2026-09-02**
(`b4b18a3`, noaa-forecast-horizon-disclosure T4) — [G12]'s lesson, on this
entry's artifact. The plan enumerated seven classes for
`16 ?days|1-16|up to 16|156 ?hours`; the post-edit re-run returned live hits the
table never listed, including seven in `src/services/openmeteo.ts`, one in
`src/config/displayThresholds.ts` and one in `src/handlers/marineConditionsHandler.ts`.
Every one classified cleanly — they are **Open-Meteo-scoped**, and `1-16` is
*true* of that path — so none was a stop-and-ask, but a builder trusting the
table would have believed the sweep complete without ever running it. **Re-derive
the classification from the grep's own output, not from the plan's table**, and
note that a range string can be simultaneously a false claim on one provider path
and a correct one on another: the class is per *hit*, not per *string*.

**Status:** active, **sharpened 2026-08-27**, **extended 2026-09-02**. **Re-run 2026-09-01** (`2e7de75`, marine-sea-state-taxonomy T5) on the marine legend table itself: four live classes edited or regenerated, four frozen (`CHANGELOG.md` v1.25.6 and v0.6.0 entries, `GOTCHAS.md:1392` — this file's own evidence text — and a different feature's `Extremely dangerous` string in `thermalStress.ts`) left alone; no unexpected live hit. Plans 2 and 3 of the band-rounding
sequence have now landed (wildfire `cd0f317`; river/marine `028b750`). Plan 3's
grep returned **no unexpected live hit**: two live `docs/TOOLS.md` lines edited,
one live `README.md` row with no thresholds to correct, and four frozen
`CHANGELOG.md` entries plus three captured `examples/` lines left alone. Note
that plan 3 had **no wrong table to fix** — neither tool publishes a threshold
table — so the grep's whole value there was proving the absence. Plan 4 (the
non-safety sites) corrects real tables next.
Not lintable: only a human can tell a live reference from a frozen record.

---

## G30 — The first lightning probe of any point always reports zero strikes

**Trigger:** writing a live probe, QA driver, or smoke test that calls
`get_lightning_activity` (or `get_weather_summary` with `include: ['lightning']`)
looking for real convection.

**Rule:** warm the points first, **keep the same process alive**, wait, then
read. The Blitzortung feed only begins buffering an area once that area is first
queried, so a cold first call returns `Total Strikes: 0` and
`SAFE (LIMITED DATA)` no matter what the sky is doing. Never conclude "no
convection anywhere" from a first-pass sweep, and never restart the process
between the warm-up and the read — the buffer lives in the process.

**Why:** the cold-start report is not an error and not malformed. It passes
[G28]'s shape assertion — `## 📊 Lightning Statistics` present, a real
`**Total Strikes:** 0` line, a coherent verdict — and it carries its own honest
explanation of why coverage is short. So a driver that correctly asserts shape
still records a false negative, and the sweep looks like a completed
observation rather than an un-run one. This is the same failure family as
[G10]'s vacuous-hash half and [G28], reached by a third route: a *legitimate*
result that answers a different question from the one asked.

**Verify:** spawn the built dist, call `get_lightning_activity` at four widely
separated points, and confirm every one reports coverage of roughly `0.2 of the
requested 60 minutes` and zero strikes — then wait four minutes in the same
process and re-read.

**Evidence:** 2026-08-25 (`3d85370`, issue-80 lightning band rounding T4) — six
seed points (Tampa, Kansas City, Darwin, Singapore, Lagos, Manaus) all returned
0 strikes at 0.2/60 minutes of coverage on first contact. One kept-alive process
that warmed all six and waited 240 s then found **436 strikes at Tampa**, nearest
112.8 km — live convection that the cold sweep had reported as a quiet sky.

**Status:** active. **Verify line re-run 2026-08-28** (lightning-degradation-honesty
T4, a plan whose whole subject is this render path): a fresh-process probe of
Seattle `47.6062,-122.3321` against the real broker returned
`**Total Strikes:** 0` at `**Monitoring Coverage:** 0.2 of 60 minutes` under
`🟢 SAFE (LIMITED DATA)` — the cold start, exactly as described. The trap is
intact and the figure is unchanged. Related: [G28] (assert the shape — necessary
here but not sufficient), [G10] (a clean-looking result from an un-run measurement). Also
related: the auto-memory note `live-verification-driver-hangs` — the driver holds
a persistent MQTT connection, so it needs an explicit `process.exit(0)` and two
must never run in parallel. Not lintable.

---

## G31 — A new module under `src/` has no changelog bullet to hang off, so the architecture map is missed

**Trigger:** a task adds a file to `src/utils/`, `src/services/`, `src/config/`
or `src/server/` — especially a small pure helper introduced as an internal
refactor rather than as a user-visible feature — **or adds a directory under
`src/` that the map has no row for at all**.

**Rule:** adding a module is a **docs touch** on `CLAUDE.md`, and the design
plan's `## Docs impact` must say so. Two edits, not one: a line in the
`src/` architecture map, and a mention wherever `CLAUDE.md`'s conventions
section states the rule the module now enforces.

**Why:** the release docs walk is driven by the changelog's `### Added` /
`### Changed` bullets — "which page does this bullet touch?" A helper extracted
to hold an existing convention produces **no bullet of its own**; it is invisible
inside the bullet for the fix it enabled. So the per-bullet walk cannot reach it,
the per-page `<user-docs>` map does not list an architecture map as a page, and
`check-doc-versions.sh` only checks version, tool and test counts. Nothing in the
gate or the release procedure fails. The map simply goes quietly stale, one
module at a time, and the file that new contributors and AI assistants read first
stops describing the tree.

**Verify:** `for f in src/utils/*.ts src/services/*.ts src/config/*.ts src/server/*.ts; do
grep -q "$(basename "$f")" CLAUDE.md || echo "MISSING FROM MAP: $f"; done`
Extend the glob whenever a new directory appears under `src/` — the loop can only
report a file in a directory it was told to look in.

**Evidence:** 2026-08-26 (v1.25.2 release, step 4b) — `src/utils/displayBanding.ts`
shipped on `feat/issue-80-lightning-band-rounding` with a design plan, an impl
plan with a dedicated docs task, a clean cross-vendor diff review (0 blockers,
0 majors) and a passing QA record, and **none of them** put it in `CLAUDE.md`'s
utils map. It was caught only by the release's structural pass, which asks what
the diff changed rather than what the changelog says. `CLAUDE.md:196` was in the
same position: it already stated "bands and categories are computed from the
rounded display value" and now had a shared helper enforcing it, with nothing
naming it.

**Status:** active; **widened 2026-09-09** (issue-95), which added a whole new
directory rather than a file in an existing one — `src/server/`. That is the worse
case for this entry, because the `Verify` loop is a fixed glob list and a directory
it does not name cannot produce a `MISSING FROM MAP` line: the check passes by not
looking. The glob now names `src/server/*.ts` and the Trigger says to extend it.
Also load-bearing for plans 2 and 3 of the band-rounding sequence, which consume
the same helper and may add their own. Lintable — the `Verify` loop above is a
two-line check that belongs in `check-doc-versions.sh`; until it is there, it is a
manual step in `## Docs impact`.

---

## G32 — Mutating back to the old implementation does not prove a fixture discriminates the *rejected* ones

**Trigger:** a design plan that names two or more candidate implementations of a
computation and rejects all but one; a mutation check written to satisfy [G13].

**Rule:** mutate to **every** implementation the plan rejected, not only to the
one the code had before. A fixture is only as sharp as the alternatives it can
tell apart, and the plan has already written down which alternatives are
plausible enough to need telling apart — that list *is* the mutation set.

**Why:** cap-disclosure-accuracy rejected three ways to count the same number —
the display-capped slice (the bug), the whole country-level block (the fix), and
the feed-scoped service total. The two new fixtures were mutation-checked
against the first and both turned red, so the check read as done. Substituting
the third left all 2,572 tests green while rendering *"Area geometry for 4 alerts
… rather than matched to your point"* directly beneath *"3 active warnings
matched to your location"* — the failure the plan had predicted in writing, in
the opposite direction from the bug. The fixtures set `matched` empty, which
collapses two of the three expressions onto the third; the old fixtures had
collapsed a different pair the same way.

**Verify:** grep the design plan for `**Rejected:` and mutate to each one in
turn. Any that stays green is a fixture that is degenerate along that axis.

**Evidence:** 2026-08-26 (cap-disclosure-accuracy diff review, finding 1) —
closed by `0deb47b`, which adds a case carrying three matched-but-flagged
warnings beside one that lost geometry entirely, so the block-scoped count and
the feed-scoped total no longer render the same number.

**Two ways a mutation row can be green without the fixture being weak, both
found 2026-08-27** (`7a1e65d`, wildfire band-rounding T2), and both worth
recognising before "sharpening" a test that is already correct:

- **A rejected alternative may have been rejected on non-behavioural grounds,
  in which case no fixture can discriminate it.** The wildfire design rejected
  shifted raw thresholds (`dist < 5.05`) because they encode the render
  precision as a magic constant in six places that breaks silently if
  `toFixed(1)` ever changes — a *maintainability* argument. Measured, the
  shipped rule `displayValue(d,1) <= T` and that alternative differ at
  **exactly two doubles on the whole real line**, `5.05` and `50.05`, and at
  the third seam they do not differ at all because `(25.05).toFixed(1)` rounds
  up. A haversine-placed fixture cannot land on an exact double ([G36]), so the
  axis is unreachable through the handler. **Measure the divergence set and
  report it; do not manufacture a red.** The right output is a sentence saying
  which alternative is behaviourally indistinguishable and why.
- **Mutating to the pre-fix implementation cannot turn a "never worse than
  before" contract red** — that contract compares the new tier against the old
  rule reimplemented inline, so reproducing the old rule exactly makes it hold
  by *equality* everywhere. It is a tautology, not a gap. Expect such a
  mutation to be caught by the coherence and seam contracts instead, and write
  the prediction table that way.

**A third way, found 2026-08-27** (`432ade3`, river/marine band-rounding T2):
**an alternative can be indistinguishable at some seams and distinguishable at
others, so one green mutation row proves nothing about the rule.** The marine
design rejected shifting the threshold (`meters < t - 0.05`) rather than rounding
the value. At five of the seven tenths-aligned Douglas thresholds that mutation is
*mathematically identical* to the shipped rule, because `(0.05)`, `(0.45)`,
`(2.45)`, `(3.95)` and `(5.95)` all `toFixed(1)` **up**, landing the naive shift
exactly on the true rounding boundary. At the two whose half rounds **down** —
`(8.95).toFixed(1)` is `"8.9"`, `(13.95).toFixed(1)` is `"13.9"` — the rules
diverge, at exactly **one double each**. A mutation check run only at `0.5` would
have reported "no test catches this" and invited a fixture that cannot exist;
run only at `9.0` it would have reported full coverage. **Sweep every seam, report
the divergence set per seam, and put a row on each seam that has one.** The
corollary for plans: a `t - 0.06`-style "just below" row cannot catch this class
at all — where the divergence is a single double, only a fixture *on* that double
discriminates.

**A fourth way, found 2026-08-28** (`0ac76d0`, lightning-degradation-honesty T3):
**a mutation that deletes one half of a redundant guard goes red only where the
other half cannot cover.** `getLightningStrikes` classifies a mid-query outage on
`this.connectionLossGeneration !== generationAtSubscribe || !this.isConnected`.
Deleting *only* the generation comparison leaves `!this.isConnected`, which still
correctly catches a `close` with no reconnect — so the plain-close variant and the
no-close control both stay **green**, and only the close-then-reconnect variant
goes red. That is not a coverage gap: it is precisely the case the second half of
the guard exists for, and the design said so in writing. **A plan that demands a
mutation go red in "both variants" of a two-part guard has usually mis-specified
its own acceptance** — report which variant discriminates and why, rather than
manufacturing a red for the variant that is redundantly covered.

**A fifth way, found 2026-09-01** (`f48eda3`, openmeteo-nullable-scalar-types T6):
**the discriminator can be the compiler, not the suite.** Removing the
`?? undefined` normalisation on `getSafetyAssessment`'s four arguments
(`marineConditionsHandler.ts:258-261`) leaves every marine test green, because
the callee already treats `null` and `undefined` alike (`marine.ts:294`) — the
coalesce exists so the call typechecks against a `number | undefined`
parameter, not to change what renders. `npm run build` is what goes red
(`TS2345`). A mutation table that reports only vitest rows would list it as
uncovered; the honest row says *green at runtime, red at `tsc`* and names the
layer.

**Status:** active, **extended 2026-08-27 (twice), 2026-08-28 and 2026-09-01**. **Re-run 2026-08-26** (`07661a9`,
issue-78-log-level-numeric T2), where the design named three parsers and
rejected two: the shipped bug turned 18/32 red, the issue's own
`isNaN(Number(…))`-guard proposal 9/32 (all on the fail-loud contract), and bare
`parseInt` exactly 4/32 — precisely the two traps (`"1.9"` accepted silently,
`"3wat"` resolving to ERROR) that the design cited as its reason for rejecting
it. Mutating only to the shipped bug would have looked complete while leaving
both rejected parsers undiscriminated. Sharper instance of [G13] — the
degeneracy is not in a *value* the fixture repeats but in a *set* the fixture
leaves empty.

---

## G33 — A live smoke test that asserts a security allowlist is asserting the publisher's behaviour, not ours

**Trigger:** an integration test that runs an allowlist, validator, or signature
check over entries fetched live from a third-party feed.

**Rule:** assert that rejections are **counted and disclosed**, not that there
are none. An allowlist exists precisely because upstream can publish something
outside it; a test that fails when it does converts correct defensive behaviour
into a red release gate.

**Verify:** point the assertion at the disclosure path — the entry lands in
`dropped`, `dropped` reaches `unavailableCount`, the render says "not an
all-clear" — and log the rejected URLs rather than failing on them.

**Evidence:** 2026-08-26 (cap-disclosure-accuracy diff review, finding 2) —
PAGASA began serving its four newest CAP documents from
`https://121.58.193.10/output/gfa/…` instead of `publicalert.pagasa.dost.gov.ph`.
`isAllowedFeedUrl` rejected them, `nationalCap.ts:493` counted them into
`unavailableCount`, and the user-facing output was correct and honest.
`tests/integration/national-cap-alerts.test.ts:136` went red on `main` and on
every open branch, blocking `/release` on a defect that was not ours and that the
code had already handled as designed.

**Status:** active. Closed by `bcda01c`, which asserts that the allowlist still
matches the feed at all, logs every rejection by host, and no longer fails on
which documents the publisher chooses to serve from where.

---

## G34 — Vitest replaces `globalThis.console`, so a `process.stderr.write` spy sees nothing

**Trigger:** a unit test asserting that something reaches **stderr** and not
**stdout** — the constraint every MCP server in this repo lives under, since
stdout is the protocol transport.

**Rule:** spy on the **`console` method identities** the source actually calls
(`console.error`, `console.warn`, `console.log`), never on
`process.stderr.write` / `process.stdout.write`. The stream spy is not merely
awkward here, it records **zero calls** and therefore proves nothing — and it
fails in the direction that reads as success, because a `not.toHaveBeenCalled()`
assertion on stdout passes vacuously. Where the claim really is about the
*stream*, make it against the **built dist** in a real child process with the
two streams captured separately; a unit test cannot make it at all.

**Why:** at worker startup Vitest swaps `globalThis.console` for its own
`Console` instance bound to internal `Writable` buffers that forward to the
reporter over RPC (`node_modules/vitest/dist/chunks/console.*.js`). The real
`process.stdout`/`process.stderr` are never touched, so a spy on them observes
nothing no matter what the code under test logs. What survives the swap is
Node's documented contract for the method names themselves —
`console.error`/`console.warn` go to stderr, `console.log` to stdout — which is
why the method identity is the faithful boundary to assert on.

**Verify:** in any test file, `vi.spyOn(process.stderr, 'write')` around a
`console.error('marker')` call, then read `.mock.calls.length`. It is `0`.

**Evidence:** 2026-08-26 (`07661a9`, issue-78-log-level-numeric T2) — the
implementation plan specified two contracts as `vi.spyOn(process.stderr,
'write')` / `vi.spyOn(process.stdout, 'write')`, one of them the
"never touches stdout" assertion. Neither could be written as specified. The
subagent reported it; the orchestrator re-ran the Verify line above
independently before accepting it and got `process.stderr.write calls=0
process.stdout.write calls=0`. Vitest **4.1.11**. The stream-level claim was
made instead against the built dist — a 19-value sweep of the logger module and
four child-process spawns of `dist/index.js`, stdout captured separately and
empty on every one.

**Status:** active, **version-stamped**. Re-run the Verify line after any Vitest
major upgrade and retire this entry if the swap stops happening. Related:
[G21] (the other way Vitest's module and global handling is not what the test
file appears to say), [G11] (the dist is where a rendering or stream claim is
actually checkable). Not lintable: only the test's author knows whether a
given assertion is about a stream or about a call.

---

## G35 — Release prose is a JavaScript replacement string, so a `$` in a changelog bullet rewrites the file

**Trigger:** any script that promotes author-written text into a file with
`String.prototype.replace(pattern, string)` — in this repo,
`scripts/update-docs-for-release.sh` promoting `## [Unreleased]` into the new
version section.

**Rule:** pass a **function** as the replacement (`() => text`), or escape every
`$` as `$$`. A function replacement inserts the string literally and has no
metacharacters at all, which is the only form that is safe against text nobody
audited for `$`. The same hazard has a `sed` half — `/`, `&`, `\` in a `sed`
replacement — which the same script already guards with `SUMMARY_SED`; the JS
half was missed because the syntax looks like plain interpolation.

**Why:** in a string replacement JS interprets `$$`, `` $` ``, `$'`, `$&` and
`$1`-`$9`. `` $` `` means *everything in the subject string before the match* and
`$'` means *everything after it*, so a single stray `` $` `` duplicates an
arbitrarily large slab of the file into the middle of the inserted text. Nothing
throws, the write succeeds, and `scripts/check-doc-versions.sh` passes over the
result — it checks version strings, tool counts and the link-reference block,
none of which the corruption touches.

**Verify:**

```
node -e "console.log('AB'.replace(/B/, 'x\$\`y'))"
```

Prints `AxAy`, not `AxB\`y`.

**Evidence:** 2026-08-26, v1.25.4 prep. The `LOG_LEVEL` bullet contained *"the
numeric form matches `^[0-3]$` rather than going through `parseInt`"*. The `$`
was followed by a backtick, so the seven-line CHANGELOG header was spliced in
after `^[0-3]`, and the remainder of the bullet was pushed below a second copy
of the file's preamble. `check-doc-versions.sh` reported *"All documentation
checks passed"* on the corrupted file. Caught by reading the promoted section,
which is exactly what [G11] says to do. Fixed in the same release by switching
line 94 to a function replacement.

**Status:** active. Related: [G11] (read the real output, do not trust the
green check), [G16] (the other way this same script has silently produced a
plausible-looking wrong result). Lintable in principle — a grep for
`\.replace(` with a template-literal second argument would find it — but there
are three call sites in one script and two of them use `$1` deliberately.

---

## G36 — A seam row written from decimal intuition is wrong on binary halves

**Trigger:** writing an expected tier/band for a value that sits on an exact
half at the render precision (`x.x5` at `toFixed(1)`, `x.5` at `toFixed(0)`),
in a test, an acceptance line, or a changelog claim.

**Rule:** derive the expected display by running `(v).toFixed(n)` in node
before writing the row, and never place a seam fixture on an exact half —
offset it by at least 0.001 at one decimal. Prefer rows like `5.049` /
`5.051` to `5.05`.

**Why:** `toFixed` rounds the *stored* double, and adjacent decimal halves
sit on different sides of their binary representation: `(5.05).toFixed(1)`
and `(50.05).toFixed(1)` round down (`"5.0"`, `"50.0"`) while
`(25.05).toFixed(1)` rounds up (`"25.1"`). A fixture placed by haversine adds
a small floating-point residue on top, so an exact-half row is green or red by
accident. The rows read as obviously correct, and a builder who trusts them
will "fix" the code rather than the row — which here means banding on the raw
value again, reintroducing the defect the plan exists to remove.

**Broadened 2026-08-27** (`cd0f317`, wildfire band-rounding T3) — **the same trap
bites the *measurement*, not just the test table.** A sweep that reports "N cases
become more cautious" has to decide whether the exact half is inside the window,
and **how you index the sweep decides it for you**: `10010/200` is the *same*
double as the literal `50.05` (`toFixed(1)` → `"50.0"`, so it is in), while
`10010*0.005` is a *different* double, `50.050000000000004` (`toFixed(1)` →
`"50.1"`, so it is out). Two sweeps of the same nominal range and step therefore
publish different counts, and the number goes into a changelog. Index a seam
sweep by division (`i/N`), never by repeated or scaled multiplication, and say
which you used beside the count.

**Verify:** `node -e 'for (const v of [5.05,25.05,50.05]) console.log(v.toFixed(1))'`
prints `5.0 25.1 50.0`; and
`node -e 'console.log((10010/200).toFixed(1), (10010*0.005).toFixed(1))'`
prints `50.0 50.1` — same nominal value, opposite side of the seam.

**Evidence:** 2026-08-26 — wildfire band-rounding plan review, raised
independently as R1 by **both** the Claude and Codex legs. The impl plan
asserted `(5.05).toFixed(1)` is `"5.1"` and wrote `5.05 → HIGH` and
`50.05 → AWARENESS` as "unchanged" seam rows; both are the opposite tier under
the plan's own rule, so T2 would have gone red against a correct T1. The
answer was already in the tree: `tests/unit/displayBanding.test.ts:10` pinned
`displayValue(50.05, 1) === 50` when the lightning plan shipped the helper,
and its test title already said *"floating-point storage of .05 differs by
value"*.

**Extended 2026-08-27** (`9d8ffb8`, issue-82 display-band-coherence T1) — **which
*side* of a threshold rounding moves a value onto is the half that gets narrated
backwards.** The plan wrote that its AQI seam was `x.5..x.99` "above an integer
threshold", and built a fixture on `50.51` expecting `Good` before the fix. It is
the opposite: on a `<=` ladder, `x.5..x.99` rounds **up** and keeps its rung,
while `x.01..x.49` rounds **down onto** the threshold and changes rung. So
`50.51 → 51` is `Moderate` on both sides (a control, not a seam) and `50.49 → 50`
is the row that moves; likewise `150.4 → 150` and `60.4 → 60`. The stated
expectation was unreachable — no raw value banded `Good` can round to `51` — and
would have sent a builder hunting a defect in correct code. **Write the seam row
by asking which raw values round *to* the threshold, not which sit near it**, and
keep both a moving row and a non-moving control so the direction is visible
([G13]).

**Status:** active, **broadened 2026-08-27** (measurement half), **extended
2026-08-27** (threshold-side half). **Verify line re-run 2026-09-01** (marine-sea-state-taxonomy curation): `5.0 25.1 50.0` and `50.0 50.1`, unchanged; the same run found the plan's "for every threshold" seam contract unsatisfiable at the one two-decimal threshold (1.25 — no one-decimal display lands on it), which the v1.25.6 lock already records as its non-moving control. Was immediately
load-bearing — plans 3 and 4 of the
band-rounding sequence both wrote seam tables next (river/marine thresholds at
0.1/0.5/1.25/2.5/4.0/6.0/9.0/14.0 m, and the non-safety sites of
[#82](https://github.com/weather-mcp/weather-mcp/issues/82)), and the marine
set is tenths-aligned, which is exactly where this bites. Related: [G13] (a
fixture that cannot discriminate proves nothing), [G29] (correcting a
published band table), [G32] (mutate to every rejected implementation).
`tests/unit/displayBanding.test.ts` is the authoritative lock for any seam
expectation that goes through `displayValue`. Partly lintable — a grep for
`\.[0-9]*5\b` inside a seam table would find candidates, but only a human can
tell a seam row from an ordinary fixture.

---

## G37 — A driver that constructs any service never exits, and the agent running it looks dead rather than blocked

**Trigger:** writing a throwaway driver that imports a handler or service — the
live-verification step of `/run-plan`, an adversarial probe in a `--diff`
review, any scratch script under `.claude/scratch/`.

**Rule:** end every such driver with an explicit `process.exit(0)`, and run
them strictly one at a time. When a review leg or a driver goes quiet,
diagnose by **CPU and process tree**, never by log silence: compare
`/proc/<pid>/stat` jiffies over a few seconds, read `wchan`, and run
`pgrep -a -P <pid>`. If the children are stranded drivers, kill **them**, not
the chain — the CLI then flushes and exits 0 with its work intact.

**Why:** every service constructor calls `new Cache(...)`, which arms a ref'd
5-minute `setInterval` at `src/utils/cache.ts:42` and never `.unref()`s it —
`src/analytics/collector.ts:274` is the only unref'd timer in the tree. One
constructed service therefore holds Node's event loop open forever: the script
body runs, prints, and the process stays. Nothing in the output says "hung".

The second half is what makes this expensive. A vendor CLI invoked
non-interactively (`agy -p`, and the other `--print`-style modes) **buffers its
entire response until it exits**, so a leg that has already finished the review
and written the document is indistinguishable from one that died — zero bytes
of log either way. The CLI is not thinking; it is blocked reaping child shells
that will never return. Waiting it out costs the full per-leg timeout and
produces no document.

**Verify:** with `dist/` built, a two-line driver that constructs one service
and nothing else prints its line and then hangs —

```
node -e 'import("./dist/services/nifc.js").then(m=>{new (Object.values(m).find(v=>typeof v==="function"))();console.log("body finished")})'
```

exits 124 under `timeout 10`, not 0. Adding `process.exit(0)` after the log
makes it exit 0 immediately.

**Evidence:** 2026-08-27, `post-run-pipeline.sh` on `feat/wildfire-band-rounding`
— the Antigravity/Gemini diff-review leg appeared dead for 16 minutes: `agy`
parked in `futex_do_wait` with 4 s of CPU across 19 minutes of wall clock,
`gemini.log` at 0 bytes, no new files in the worktree. It had written nine
`scratch-adversarial-N.ts` probes importing `./src/handlers/wildfireHandler.js`,
**none** with `process.exit(0)`, stranding 22 `npm`/`tsx`/`esbuild` processes.
The review was **already complete** — the review document's mtime was 00:27 and
the stall ran to 00:43. Killing only the probe trees released the CLI, which
exited 0 with the review intact; the leg reported 0 blockers / 0 majors and a
mutation pass turning 18 tests red. Aborting instead would have spent a second
vendor call to redo finished work.

One trap inside the fix: `pkill -f '<driver-name>'` matches the cmdline of the
shell running it, so the kill takes out its own tool call (exit 144) — collect
PIDs with `ps -eo pid,cmd | grep -v grep` first, or split the literal.

**Status:** active. This is the entry the trap deserved: it existed only as a
cross-reference on [G10]'s Status line ("the auto-memory note
`live-verification-driver-hangs`"), with no trigger of its own, which is why a
review agent that read `GOTCHAS.md` as instructed still wrote nine
non-exiting drivers. Related: [G10] (byte-identity runs, where parallel drivers
first self-inflicted what looked like NOAA rate limiting), [G11] (read the
rendered output — which is what these drivers exist to produce). Lintable: a
scratch driver that imports from `src/` or `dist/` and contains no
`process.exit(` is a mechanical grep.

---

## G38 — `FORCE_COLOR` makes `check-doc-versions.sh` fail a check that is actually passing

**Trigger:** running `./scripts/check-doc-versions.sh` from inside an agent
harness, a CI job, or any environment that exports `FORCE_COLOR` — i.e. every
`/run-plan` and `/release` driven by Claude Code.

**Rule:** invoke it as `env -u FORCE_COLOR ./scripts/check-doc-versions.sh`.
If it reports `❌ server.json description length: <N> (registry limit is 100)`
for an `N` that is plainly ≤ 100, that is this bug and **not** a real registry
violation. **Do not shorten `server.json`'s description to make it pass** — that
edits a published registry field to satisfy a broken comparison.

**Why:** the check reads the length with
`DESC_LEN=$(node -p "require('./server.json').description.length")`
(`scripts/check-doc-versions.sh:119`). `node -p` inspects its result, and under
`FORCE_COLOR` it wraps the number in ANSI colour codes, so `DESC_LEN` becomes
`\033[33m98\033[39m` rather than `98`. Bash's `[ "$DESC_LEN" -le 100 ]` then
fails on a non-integer, control falls through to the `else` branch, and the
script prints a confident ❌ and increments `ERRORS` — so it exits non-zero and
the conditional gate addition can never pass in that environment. Nothing in the
message hints that the value was never compared. The failure direction is safe
(it cries wolf rather than passing a real violation), but it is indistinguishable
from a genuine one, and the obvious "fix" damages a published field.

**Verify:** `node -p "require('./server.json').description.length" | cat -A`
prints `^[[33m98^[[39m$` with `FORCE_COLOR` set and `98$` without it; the script
then reports ❌ and ✅ respectively over an unchanged `server.json`.

**Evidence:** 2026-08-27 (`432ade3`, river/marine band-rounding T2) — the T2
subagent reported the ❌ as "a pre-existing script bug with ANSI codes leaking
into an integer comparison", which was right about the mechanism. `server.json`
was byte-identical to `main` and untouched by that plan, and `main` reports the
same ❌ from the same harness, so nothing about the branch caused it.

**A second, harmless colour artifact in the same script, recorded so it is not
chased as corruption (2026-09-11, issue-88 site half T6):** the script's own
summary lines print their escapes **literally** — `❌ \033[0;31mFound 3
documentation inconsistencies\033[0m` — because it uses bare `echo`, which in
`bash` does not interpret `\033` without `-e`, and the file contains no
`echo -e`. This is **pre-existing and identical on `main`** (verified
byte-for-byte on both sides, and the base worktree's release dry run printed the
same), it is unrelated to the `FORCE_COLOR` bug above, and it changes no exit
code. Do not "fix" it as part of unrelated work.

**Status:** active. **Verify line re-run 2026-09-03** (jma-service-residuals T4) — this time against the bug rather than around it: `FORCE_COLOR=1 ./scripts/check-doc-versions.sh` printed `❌ server.json description length: \033[0;31m[33m98[39m\033[0m (registry limit is 100)` and exited 1, while `env -u FORCE_COLOR` over the same unchanged `server.json` passed. The trap is intact, the mechanism is exactly as described, and `server.json` still must not be edited to satisfy it. **Not re-tested 2026-08-28** (openmeteo-nullable-series-types
T6): the run invoked the script as `env -u FORCE_COLOR` throughout and it reported
`server.json description length: 98 (≤ 100)` correctly. That is the workaround
working, **not** evidence the underlying bug is gone — do not read a clean run
under `env -u` as a reason to retire this entry. Lintable, and the better fix is
in the script rather than in every caller: `node -p` on a bare value should be
`node -e 'process.stdout.write(String(...))'`, or the result piped through
`tr -dc '0-9'`. Until then the `env -u` invocation is
the workaround. Related: [G12] (the same script's silent *under*-validation — this
entry is its mirror, a loud over-validation), [G9] and [G14] (release tooling that
runs more than it appears to).

## G39 — `publish.yml` still warns after a publish that succeeded, because npm's processing can outlast even a widened verify window

**Trigger:** pushing a `vX.Y.Z` tag. The **Publish to npm** step and the overall
run are both **green**, and the **Verify publication** step carries a yellow
warning annotation beginning `vX.Y.Z was accepted by npm but is not retrievable
yet after 40 probes over 600s` — the same text, without the `::warning::` prefix,
is also written to the run summary (`$GITHUB_STEP_SUMMARY`), which is where you
are more likely to see it.

**Rule:** the warning already says what happened — published, not yet visible.
**Never re-run the workflow and never `npm publish` by hand on this signal** —
the version already exists, so a republish can only fail or, worse, ship a
version nobody asked for. Confirm at the registry directly:
`curl -s https://registry.npmjs.org/@dangahagan/weather-mcp | jq '.["dist-tags"].latest'`.

**Why:** `npm publish` returns as soon as the registry accepts the tarball, and
says so itself: `Your package is being processed and may take a few minutes to
become available.` The old 150 s poll (10 attempts at 15 s) was never related to
that delay by anything but luck.

**Evidence:** three occurrences, all pre-fix (before `79ea177`) and each on a run
whose `Publish to npm` step itself succeeded.

2026-08-27, v1.25.6 (run `33110039433`). npm's own `.time["1.25.6"]` is
`2026-08-27T19:51:10.607Z`; `latest` moved to 1.25.6 and the provenance
statement was in the sigstore log (`logIndex=2618799930`) the whole time. The
release was complete and correct while the workflow displayed a failure — which
is the dangerous half: a red publish run reads as "not shipped" to anyone
glancing at the Actions tab, and a later release cut on that misreading would be
the real damage.

**Second occurrence:** 2026-08-29, v1.25.11 (run `33235201174`). Same shape,
wider margin: the publish step ended `+ @dangahagan/weather-mcp@1.25.11` at
`05:03:47Z` with provenance in the sigstore log (`logIndex=2633268167`), the
verifier gave up at `06:20Z`, and `latest` moved to 1.25.11 roughly **five
minutes** after the publish — twice the old verifier's whole budget.

**Third occurrence:** 2026-08-29, v1.25.12 (run `33270536961`), the sharpest
case: the verifier gave up at `19:22:52Z` and the registry recorded the version
at `19:22:57.235Z` — five seconds later.

Across the ten releases v1.25.4–v1.25.13 the observed publish-to-visible lag is
`0, 0, 75, 75, 76, 77, 96, 158, 189, 250` seconds — a tight cluster near 76 s
with a heavy tail. That is **bimodal, not a rising trend**: an earlier reading
of these same three occurrences as "two in three days, so the lag is growing" is
wrong, and a budget built on a slope would have kept missing the tail. The right
budget clears the tail, not a trajectory.

**Verify:** on the next release, `gh run view <id> --json conclusion` reads
`success` while the run still carries a warning annotation, and the
`Verify publication` job step is itself green. Compare
`npm view @dangahagan/weather-mcp --json | jq -r '.time["X.Y.Z"]'` against that
step's `completed_at` to get the release's lag and place it in the distribution
above. **A red `Verify publication` after `79ea177` is a different bug** — the
step can now only fail on a fault in its own script — so do not read it as this
entry.

**Status:** fixed in `79ea177` (T1, [weather-mcp#90](https://github.com/weather-mcp/weather-mcp/issues/90)).
The poll is now 40 attempts at 15 s (last probe ~597 s, 2.4× the 250 s worst
observed lag), the trailing sleep is skipped, and exhaustion now emits
`::warning::` and **exits 0** instead of `::error::` + `exit 1` — a slow-to-
propagate publish reads as a yellow annotation on a green run, not a red one.
Related: [G9] and [G14] (release tooling that runs more than it appears to),
[G38] (the sibling case — a release check that reports a confident failure it
never actually measured).

---

## G40 — A plan's claim that no test covers something is a grep, and a fixed function's twin has a twin test

**Trigger:** a plan that states a path has no test, or that exactly one existing
test must change — especially when the same change closes a defect in **two
sibling functions** and the plan names a test for only one of them. This is
load-bearing whenever a project treats "an existing test's expectations would
have to change" as a risk floor.

**Rule:** re-derive the absence by grepping for the **symbol and the `it()`
title**, once per function the diff touches — not once per file, and never from
the plan's own prose. Where a fix has a twin, search for the twin's test with
the *same* pattern that found the first one. If the first test's title names the
defect ("fall through to else"), grep that title: a sibling defect written by the
same hand usually carries the same words.

**Why:** the absence claim decides scope. Here the plan and its triage brief both
recorded that `getGrasslandFireDangerCategory` had **no** fall-through test, so
the task was scoped to rewrite one `it` for `getHainesCategory` and *add* a
grassland sibling. The grassland test existed — in the same file, in a parallel
`Edge cases` block, under a byte-identical title
(`it('should handle decimal values (fall through to else)')`), pinning
`1.5/2.5/3.5 → Very High` with a comment naming the strict-equality defect. It
could not survive the fix, so the authorized risk-floor trip doubled from three
assertions to six, discovered mid-run rather than at planning. The remedy was
correct and cheap — a sibling defect's test is a necessary consequence of fixing
the sibling, not new scope — but it was a scope change the human had approved at
a different size.

Note what did *not* catch it: the design plan grepped `tests/unit/` for the
visibility descriptor strings and correctly reported zero hits, so the discipline
was present and applied to one claim and not the other. A citation table that
verifies "this test exists and says X" ([G12]'s lesson about enumerations being
incomplete rather than stale) will happily confirm every row it lists while the
missing row is the one that matters.

**Verify:** for any function whose ladder or branch structure a diff changes,
`grep -rn "<functionName>" tests/` and read every `it()` title in the blocks that
returns. Then `grep -rn "<the first test's it() title>" tests/` — more than one
hit means more than one lock.

**Evidence:** 2026-08-27 (`effa87b`, issue-82 display-band-coherence T2) — raised
by the executing subagent as a Surprise after its first full-suite run went red
on a test the task had told it did not exist. Confirmed by reading the file: two
`it` blocks, identical titles, identical defect-naming comments, one per ladder.

**The grep that proved the claim can stop proving it, because of your own work**
(2026-09-09, `dfde51a`, issue-88-tool-count-source). The design asserted that no
test said anything about the two release shell scripts, evidenced by
`grep -rln 'check-doc-versions\|update-docs-for-release' tests/` returning
nothing. It returned nothing on the base and returns the plan's **own new test
file** afterwards — whose header comment names both scripts while asserting
nothing about either. The substantive claim survived; the evidence for it did
not. Re-run such a grep *before* writing the file, record the base result, and
expect the post-run result to differ by exactly your own additions — otherwise a
later reader re-runs it, sees a hit, and cannot tell a documentation comment from
a real assertion without opening the file.

**Status:** active. **Re-confirmed 2026-09-01** (`f48eda3`,
openmeteo-nullable-scalar-types T6): the executing subagent pinned
`wind_wave_peak_period` and missed its `swell_wave_peak_period` twin twenty
lines below — both cited together in the task's own live-observation note — and
found it only because the twin's mutation stayed green during the step-6 check.
The twin was caught by mutation rather than by a red suite this time; the grep
the Rule names (`grep -n peak_period src/handlers/marineConditionsHandler.ts`)
would have found it before a line of test was written. Partly lintable — "two `it()` blocks with the same title in
one file" is a mechanical grep, and so is "a plan asserts absence for symbol X
while `tests/` mentions X". Related: [G12] (an enumeration can be incomplete as
easily as stale), [G13] (a test that pins the defect by name is not coverage),
[G32] (the rejected-alternative set is also something a plan enumerates and can
under-enumerate).

---

## G41 — A plan's mechanical acceptance check can be vacuous or spurious, so test the check before obeying it

**Trigger:** a plan hands you a mechanical criterion meant to prove a property
of your own *uncommitted* work — a grep that must return a count, a `git diff`
invocation that must list exactly one file.

**Rule:** before trusting a pass, run the check against a state you know should
fail it; before "fixing" code to satisfy a failure, check whether the criterion
itself is wrong. **Never delete correct code or a correct comment to make a
mechanical check pass** — report the discrepancy instead and let the plan carry
the note.

**Why:** the two failure directions cost different things and both are quiet.

- **Vacuous pass — the dangerous one.** `git diff --stat main...HEAD -- tests/`
  compares two *commits*. An untracked file is not in either, so for a task whose
  whole deliverable is a **new** file the command returns empty output before the
  commit — byte-identical to what it returns when the work was never done. Used
  as an F12 lock check ("the pre-existing test files are unedited: this lists
  only the new file"), it reads as green while proving nothing at all. What
  actually checks it is `git status --short tests/` plus a per-file
  `git diff --quiet tests/unit/<lock>.test.ts`.
- **Spurious fail.** A grep asserting a retired expression is gone will match the
  plan's *own prescribed comment* quoting that expression to explain what
  changed. This repo's plans routinely dictate both — the comment is good
  practice and the grep is good practice, and together they contradict. The
  builder's temptation is to delete the comment.

**The vacuous-pass case recurred verbatim, 2026-09-18** (nws-alert-jurisdiction
T1/T2) — on a plan that **cites this entry in both tasks** and rewrote two other
acceptance checks because of it. Both tasks' F12 locks were written as
`git diff main...HEAD -U0 -- <testfile> | grep -c '^-[^-]'` → `0`, run *before*
the commit, where it compares two commits and reports `0` for a file the working
tree has not yet contributed. The real pre-commit form is the working-tree
`git diff -U0 -- <testfile>`; both forms were run, and the committed form re-run
after each commit. An entry being cited is not the same as an entry being applied,
which is the argument for testing the check rather than trusting the citation.

**A third direction, found 2026-08-28** (`01595d9`/`a729a2d`,
lightning-degradation-honesty T2/T4): **a criterion no correct work can satisfy.**
Distinct from a spurious fail on one wrong expression — these are impossible by
construction, and both invite editing correct work to satisfy them.

- **A diff filter that forgets the syntax the edit requires.** T2's check was
  `git diff tests/ | grep '^[+-]' | grep -v getFeedFailure` returning only the
  `+++/---` headers, to prove the four mock literals gained nothing but the stub.
  Adding a member to an object literal requires a **trailing comma** on the line
  above it, so every one of the four files shows a
  `-getCoverageStart: vi.fn()` / `+getCoverageStart: vi.fn(),` pair. The check can
  never be empty. Syntax is not an assertion; the [F12] footprint held.
- **A hygiene grep that cannot tell our leak from upstream's own text.** T4
  required zero `mqtt://` and `127.0.0.1` hits in the outputs *and the stderr
  log*. The rendered reports were clean, but stderr carried 12 hits — and the
  **base commit carried exactly the same 12** under the identical probe, from two
  pre-existing lines the change never touched: the deliberate
  `SECURITY: Using plaintext MQTT connection` warn that logs the broker at
  connect, and `logger.error(msg, error)` passing the upstream `Error` through,
  whose own `.message` is `connect ECONNREFUSED 127.0.0.1:1`. **Write a hygiene
  criterion as a diff against the base, or scope it to the fields the change
  adds** — "zero hits anywhere" is only satisfiable when nothing upstream ever
  names the host, which for a transport error is never.

**A fourth direction, found 2026-09-08** (`b4e4823`, tools-list-slimming T5):
**a prescribed mutation too small to trip the check it is meant to redden.** T5's
acceptance said to demonstrate the byte budget red by "lowering one constant by
1". The constant is the measured payload *rounded up to the next 1,000*, so it
carries up to 999 bytes of deliberate headroom — 21, as it happened. A `-1` edit
stays green, and a builder who performs it and reports "confirmed red" has
rubber-stamped a lock nobody demonstrated. The mutation's magnitude has to be
derived from the *measured* value, not from the threshold: one byte below what
was actually measured. Read as an instance of the rule above — the criterion was
wrong, not the code — and the right move is to say so and use the smallest
mutation that genuinely reddens, which is what happened.

**Verify:** with an uncommitted new file under `tests/`, run
`git diff --stat main...HEAD -- tests/` and confirm it prints nothing, then
`git status --short tests/` and confirm the file is listed as `??`. The first
command is the one plans keep reaching for.

**Evidence:** 2026-08-28, issue-83 absent-strike-distance. The plan's T2
acceptance read *"`git diff --stat main...HEAD -- tests/` lists only it"*, which
the subagent correctly reported as unsatisfiable-as-written and worked around
with per-file `git diff --quiet` (all four locks CLEAN). The same plan's T1
acceptance required
`grep -c 'distance || 0\|distance || \|\.distance?\.toFixed'` to return `0`,
while its own prescribed comment for that edit reads *"`s.distance || 0` added 0
for a distance-less strike"* — so the grep returned `1` on a correct
implementation (`76c98a4`). Zero *code* sites remained; the same grep minus
comment lines returned `0`.

**A fourth direction, found 2026-08-28** (`dc4b8be`, openmeteo-nullable-series-types
T5): **a sibling task silently disarms a later task's grep.** The check was valid
when the plan was written and still valid when the task ran — what changed is the
text it greps for. T5's acceptance was
`grep -rn "declared types say number\[\]\|trusting the declared" src/` returning
nothing, to prove three stale comments had been rewritten. T1 had earlier moved
one of those comments above a new `import` and **reflowed it**, putting a line
break between `trusting` and `the declared` — so the pattern no longer matched
that file at all, and the grep would have reported clean while the stale comment
stood. Caught by grepping the **construct** the comment is about
(`declared \`number\[\]\``) rather than the plan's literal prose.

The general rule: **an acceptance grep keyed to a prose phrase is fragile against
reflow, and any earlier task that touches the same comment can break it.** Key
acceptance greps to code constructs, or to a phrase short enough to survive
rewrapping, and re-run the check against a state you know should fail it — here,
the un-rewritten comment.

**A fifth direction, found 2026-09-01** (`41475af`, marine-sea-state-taxonomy
T3): **a line-granular diff filter is vacuous when the line carries both the
literal the edit is allowed to change and the literal it must not.** The
check was `git diff -U0 … | grep '^[-+]' | … | grep -vE "'[A-Za-z() ]+'"`
printing nothing, to prove a rename touched only quoted rung names. Every
`SEAM_ROWS` line is `[<number>, '<name>']`, so a mutated number beside an
*unchanged* name is dropped by the last `grep -v` and the filter stays empty —
the T3 subagent proved it by editing `0.06` → `0.07` next to `'Calm (glassy)'`
and watching the check pass. The check that works strips every `'…'` to a
placeholder on both sides and diffs the remainder whole; only comment lines
should differ. Write "only X changed" filters per token, not per line, when
the file puts X on the same line as the things that must not change.

**A sixth direction, found 2026-09-01** (`824dc02`, openmeteo-nullable-scalar-types
T5): **a discriminating control can be un-failable because a different layer
already admits the value.** The plan asked for the two pollen test files to be
typechecked once with the type file *un*-widened, and to read the 14 `TS2322`
errors from the bare-`null` fixtures before trusting the clean run. It reads 0
both ways. The command is real — a scratch file with `const x: number = null`
fails it — but both fixture builders take
`pollen: Record<string, number | null | undefined>`, so a bare `null` had
compiled under the narrow declaration all along and the 14
`null as unknown as number` casts were dead code. The plan's "re-run against a
state you know should fail" instruction was right; what it could not know was
that the failing state did not exist. **When a control comes back green, first
prove the check can fail at all with a planted defect, then look for the other
layer that admits the value** — here a builder parameter widened by an earlier
plan.

**Three instances in one run, 2026-09-03** (critical-alert-banner), all in acceptance lines a
`sonnet` task would have obeyed literally:

1. **A grep that its own prohibition trips.** T8's check was
   `grep -rniE 'check(s|ing)? for alerts|monitors alerts' docs/TOOLS.md README.md CLAUDE.md`
   returns no hit. It returned one — on the new `CLAUDE.md` conventions bullet that **forbids**
   the phrase by quoting it. A negative-wording check cannot tell a violation from a rule against
   it, and the more carefully you document a prohibition the more certainly you trip it.
2. **A grep that a docblock trips.** T3's F5 check was
   `grep -n 'generateKey\|CacheConfig.ttl' src/handlers/criticalAlertBanner.ts` returns nothing.
   It hit a comment naming the *existing* key the module deliberately reuses — the opposite of
   introducing one. Resolved by rewording the comment rather than by waiving the check, because a
   mechanical acceptance line that fails on a correct build is a trap for whoever re-runs it.
3. **Two acceptance lines in the same task that cannot both hold.** T8 required
   `./scripts/check-doc-versions.sh` passes **and** forbade hand-editing the test count. The
   script's only three failures *were* the test-count sites (3132 → 3226), which
   `update-docs-for-release.sh` owns at `/release`. Every branch that adds a test fails that
   check until release. The honest resolution is to report which sub-checks pass — tool counts,
   description length, README links, the CHANGELOG link block — rather than to satisfy the
   literal line by breaking [G12].

**A second shape, 2026-09-09** (`dfde51a`, issue-88-tool-count-source T8): a
**spurious** acceptance check — one that fails on correct code. The plan's
"Done when" required `grep -rn "as const" scripts/` to return nothing, on the
reasoning that all three consumers had been counting a `name: '…' as const`
spelling and none should any more. That is unsatisfiable by construction: the
module doing the consolidating has to *quote the token it replaced*, both in the
comment explaining what it replaced and in the regex that matches the block
terminator `] as const;` in `src/config/tools.ts`. The check came back `3`, and
all three hits were in the new module. **The generalisation: an acceptance grep
that bans a token repo-wide will fail the moment the consolidating module must
name that token.** Scope the ban to everything *except* the new module
(`--exclude`), or state the invariant the ban was standing in for — here, "no
consumer re-derives from the `src/index.ts` spelling", which measured 0 outside
the module and was the thing actually wanted. Vacuous checks pass when they
should fail; spurious ones fail when they should pass, and the second kind wastes
a run arguing with correct code.

**Status:** active, **extended twice on 2026-09-01 and again 2026-09-03**. Lint candidate on the vacuous half — a plan-authoring check
could flag `git diff <ref>...<ref>` used as acceptance for a task whose file list
contains a file marked **new**. Related: [G10] (prove the hash is not vacuous —
same family, a check that cannot fail is not evidence), [G40] (a plan's claim
about test coverage is a grep, and greps are what this entry is about), [G49] (a
citation that drifts under an earlier edit — the same cross-task staleness, in a
document rather than a check).

---

## G42 — `update-docs-for-release.sh` aborts on a red suite *after* writing four files, and its own guard then blocks the retry

**Trigger:** `./scripts/update-docs-for-release.sh <bump> "<summary>"` exits with
`❌ Test suite is red — refusing to prepare a release`. Almost always a flake:
six files under `tests/integration/` make live network calls.

**Rule:** do **not** commit, and do **not** re-run the script. Revert the four
files it already wrote, confirm the flake with a clean full run, then re-run the
script from a clean tree:

```bash
git checkout -- CHANGELOG.md package.json package-lock.json server.json
npm test                       # green ⇒ flake; red twice ⇒ real regression
./scripts/update-docs-for-release.sh patch "<summary>"
```

**Why:** the abort sits at step 4 (`:182`), but steps 1–3 have already run —
`npm version` has rewritten `package.json` and `package-lock.json` (`:48`),
`server.json` is synced (`:53`), and `[Unreleased]` is already promoted into a
dated `## [X.Y.Z]` section with its compare-link definition emitted (`:61-155`).
So a "failed" run leaves a **half-prepared release in the working tree**, and the
script's own precondition at `:32` (`git diff --quiet package.json server.json
CHANGELOG.md`) then refuses the obvious retry with *"has uncommitted changes.
Commit or stash first."*

**One abort moved ahead of the writes, 2026-09-11 (issue-88 site half).** The
script now validates every doc count site before step 1
(`node scripts/lib/derived-facts.mjs validate-sites`, `:41-44`), so a **reworded
or duplicated** count site aborts with the tree **untouched** and needs no
recovery at all. The four-file recovery list in the Rule stays exactly right,
because the red suite at step 4 is now the only abort that still happens after a
write.

Both instinctive recoveries are wrong, and quietly:

- **Re-running after the suite goes green** trips `:32` — or, if you obeyed its
  advice and committed first, `npm version patch` reads the *already bumped*
  `package.json` and you ship **1.25.9** with 1.25.8's notes. The version is
  permanent once tagged.
- **Committing the partial state and hand-finishing it** skips steps 4–9
  entirely: the test count in five files, the tool count in six, the "New in"
  line and its three-item prune, `Last Updated`, the social preview, and
  `SECURITY.md`'s supported-versions row. `check-doc-versions.sh` catches the
  counts; nothing catches the missing "New in" line.

The red is real often enough that it must not be auto-retried — but the flake is
common enough that the recovery is worth knowing by heart. Seen twice during
v1.25.8 prep (2026-08-28), both single-test, neither reproducible across six
subsequent full runs.

**A second-order trap, paid for in the same session:** if you pipe `npm test`
through a `grep` that selects only the summary lines, an intermittent red tells
you a test failed and **discards its name**, so you cannot tell a flake from a
regression without reproducing it. Capture to a file (`npm test 2>&1 | tee
<scratch>/t.log`) and grep the file, not the stream.

**The second-order trap recurred twice in one run, 2026-09-18**
(search-location-limit-bound, at T1's and T2's gates). Both times the gate was
run as `npm test 2>&1 | tail -8`, both times a single test failed out of 3,574
and then 3,582, and both times the name was gone with the stream — so the only
available move was a re-run, which came back 149/149 and then 150/150 green with
no edit in between. Two clean runs after a lost name is a **weaker** result than
one clean run after a known name: it establishes that the failure is not
reproducible, and says nothing about which subsystem flaked or whether the two
occurrences were even the same test. The branch's diff was two schema literals, a
comment, a new test file and eight doc counts, which cannot produce an
intermittent failure anywhere — that is what made the re-run conclusive here, and
it is an argument about the diff rather than evidence from the run. **Redirect
the first invocation**; there is no second chance at a name that was never
printed to a file, and each retry costs another ~70 s suite.

**Verify:** `sed -n '32,34p;157,187p' scripts/update-docs-for-release.sh` — the
precondition guard and the red-suite abort, with steps 1–3 between them.

**Status:** active, **second-order trap re-evidenced 2026-09-18**. Script
candidate: move the test run ahead of the first write, or trap a non-zero exit
and revert the four files the script itself touched. Related: [G30] (a first live lightning probe reports zero strikes — the other
"green means nothing yet" trap), [G10] (a check that cannot fail is not
evidence).

---

## G43 — A singleton "last result" field is not per-request across an `await`

**Trigger:** an async service method records the outcome of a call in an instance
field (`lastFailure`, `currentPhase`, `lastStatus`) and a caller reads that field
*separately*, after awaiting the method.

**Rule:** bind per-request metadata to the value the request returns — a
`WeakMap` keyed on the returned object, or one result envelope. Never communicate
a request's outcome through a `last*`/`current*`/phase field on a shared
singleton unless every caller is demonstrably serialized. Where the degraded
return is a bare `[]` or `{}`, allocate a **fresh** one per call: two calls that
both return the same shared literal collapse to one key.

**Why:** the MCP SDK starts every `tools/call` on its own promise chain
(`node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js:284-367`) —
there is no per-server request queue — and this server's services are
module-level singletons. So any `await` inside a handler is a window in which
another request, or a background pre-warm, runs and overwrites the field. The
result is not a crash but a **swapped answer**: a successful query rendered under
a failed query's verdict, or a real failure erased by a healthy query's reset.
On a safety tool, that is a fabricated all-clear reached by a route no fixture
covering one request at a time can see.

**Verify:** start two calls on the same service, settle them in the *opposite*
order to their start, and assert each returned value carries only its own
metadata. Then make **both** fail and assert the two returned values are not the
same object (`expect(a).not.toBe(b)`) — a shared degraded literal passes the
first test and fails only this one, because in the first test only one side ever
takes the degraded path. Include any background pre-warm that calls the same
transport method.

**Evidence:** 2026-08-28 (`a6ad9ec`/`0ac76d0`, lightning-degradation-honesty
T1/T3, `Source: plan-review codex R1`). The plan as written specified
`lastFeedFailure` and `transportPhase` as instance fields, cleared at the top of
`getLightningStrikes` and written in its catch — while the handler read the getter
only after the method resolved, and the method suspends **10 seconds** at its
accumulation wait (`blitzortung.ts:605`). The interleaving B-clears →
B-waits-10s → A-fails-writes → B-reads renders a *successful* lightning query as
`⚪ UNKNOWN (LIVE FEED UNAVAILABLE)`. Caught at plan review, before any code
existed. Shipped as a `WeakMap<LightningStrike[], LightningFeedFailure>` with a
distinct array per degraded return, and an invocation-local phase passed as an
out-parameter so a pre-warm cannot move a query's phase.

**Status:** active. Related: [G20] (the sibling rule for a *synchronous* guard
flag — same class, opposite direction: G20 forbids introducing an await inside
the guard, G43 forbids relying on a field that spans one). Not lintable as
written, but a grep for `private last[A-Z]` / `private current[A-Z]` on a
singleton service is a plausible tripwire.

---

## G44 — A resolved subscribe promise does not cover a later stream disconnect

**Trigger:** a live-feed query awaits connect/subscribe, then *waits* or
accumulates for a window, while connection loss is delivered to an event listener
rather than to the promise it awaited.

**Rule:** track a monotonic connection-loss generation for the whole query
window. Capture it **after** the transport work resolves — not before — and
compare it before returning. Checking only the catch, or only a final
`isConnected`, misses event-delivered loss and misses loss followed by reconnect.

**Why:** `close` and post-connect `error` events do not reject an
already-resolved connect or subscribe promise, so the query's own catch never
runs and the result renders as a normal, complete answer. And `mqtt`'s
`reconnectPeriod` restores `isConnected` on its own, so a final boolean check can
read `true` across a real unmonitored gap. Capturing the generation *before*
transport work is the mirror-image error: an initial connect that mqtt retries
internally bumps the counter on its way to succeeding, and the query would be
flagged degraded after it had in fact connected.

**Verify:** connect and subscribe successfully, emit `close` during the
accumulation window, and assert the result is classified degraded. Run a second
variant that emits `connect` again before completion — that one is the case a
bare `isConnected` check cannot catch, and it is the only variant that goes red
if you delete the generation comparison alone (see [G32]'s partial-overlap rule).
Keep a no-`close` control.

**Evidence:** 2026-08-28 (`a6ad9ec`/`0ac76d0`, lightning-degradation-honesty
T1/T3, `Source: plan-review codex R2`). `blitzortung.ts`'s `close` handler only
set `isConnected = false` and warned, while `getLightningStrikes` waited 10 s
after subscribing and recorded failures in its catch alone — so a broker that
dropped mid-query rendered as `🟢 SAFE (LIMITED DATA)` explained as a first-query
cold start, the exact defect the plan existed to remove, on a second execution
path the plan had not enumerated.

**Status:** active. Related: [G43] (the per-query binding this classification is
carried on), [G9] (a live smoke test must rethrow what is not a transport
failure). Not lintable.

---

## G45 — A mutation only goes red where the contract can reach it

**Trigger:** running a plan's mutation check ([G13], [G32]) against a codebase
with the three-layer split — service fetches, pure util computes, handler
renders — or against any pair-wise contract where only one side takes the
mutated path.

**Rule:** before concluding a mutation is uncaught, check that the contract
**executes the layer the mutation lives in**. A plan that calls something a
"rendering contract" has named the *subject*, not the entry point: if the
mutation is in the handler's selection logic, a fixture handed straight to the
formatter can never reach it. Same for pairs — a contract asserting "A's outcome
and B's outcome differ" cannot catch a mutation that only manifests when A and B
take the *same* branch.

**Why:** the split is deliberate here, and it makes the cheap test the wrong
test. A hand-built response fixture is the natural way to pin rendered text, and
it is genuinely the right tool for the formatter's own branching — but every
computation that *chooses* what the fixture contains lives one layer up in the
handler. Two of this plan's contracts read naturally as formatter tests and were
written that way; both stayed green under the mutations they were specifically
written to catch, because the mutated lines never executed. The failure is quiet
in the worst way: the mutation check reports "no test catches this", and the
tempting response is to weaken the plan or manufacture a fixture, when the fix is
to re-drive the existing contract through the handler.

**Verify:** for each mutation, name the file and function it edits, then confirm
the failing contract's call stack actually enters that function — drive it
through the handler (module mock + `vi.resetModules()` re-import) rather than
through the pure renderer. If a mutation stays green, re-run it with the contract
re-pointed at the mutated layer *before* recording it as uncovered.

**Evidence:** 2026-08-28 (`0ac76d0`, lightning-degradation-honesty T3). Three
instances in one task: (a) the outage-message evaluation-order mutation lives in
`getLightningActivity`, so the formatter-only contract 6 stayed green until it was
re-driven through the handler; (b) the `!= null` → `!== null` mutation is the
*handler's* computation, not the formatter's `=== true` check, so a fixture with
the field hand-omitted proved nothing and a handler-path case with a bare
`vi.fn()` stub was needed; (c) the shared-degraded-array mutation ([G43]) cannot
be caught by an A-fails/B-succeeds contract at all, because only the failing side
touches the degraded-return path — catching it needed a new case where *both*
queries fail, asserting object identity.

**Extended 2026-08-29** (`1eec0c4`, issue-84 T3) — **a mutation also has to
*diverge*, not merely differ.** Checking that a newly-wired fetch was load-bearing,
the obvious mutation was to prefer the pre-existing value over the fetched one
(`gauge.flood ?? fetched`). It passed the entire suite — because the test helper
hands back the same object the other mock produced, so both branches evaluate to
the same value and the mutation is a no-op at every fixture. The mutation that
works is the one that removes the value entirely (never record the fetch): **20
tests red across four files.** Before recording a mutation as uncaught, check that
it produces a different value at the fixtures in play, not just different source.

**Extended 2026-09-01** (`a4252ca`, tool-name-single-source T4) — **a contract can
be one direction of a two-direction property, so the mutation that proves it is a
different mutation.** The plan predicted that deleting a dispatch arm would redden
both the "every name appears exactly once as a `case` label" contract *and* the
"the set of labels equals the set of names" contract. It reddened only the first,
because the second was implemented as *labels not in the name list* — and deleting
an arm creates no such label. Nothing was wrong: set equality is the **conjunction**
of the two contracts, one per direction, and a separate mutation (adding a bogus
`case 'get_tides':` arm) reddened the second and only the second, proving it
load-bearing rather than redundant. **Before concluding a contract is dead because
the mutation you expected to redden it did not, check whether it covers the
opposite direction and find the mutation that exercises that one.** The tempting
wrong move is to widen the test until it matches the plan's prediction, which
[G41] names directly: the plan's prediction of *which* contract fires is not the
contract.

**Extended again 2026-09-01** (`18489ed`, marine-sea-state-taxonomy T4) — **two
more ways a reachable contract stays green, both caught by the subagent before
commit.** (a) *The expectation was derived from the subject.* Contract 2
("marker severity is monotonic") first mapped each marker back to a tier by
reverse lookup through `SEA_STATE_TIERS` — the same table the mutation
swapped two markers in — so forward and reverse both read the mutated table
and the sequence was monotonic *after* the swap too. Fixed by pinning the five
expected markers as a literal independent of the table. **A derivation test
whose expected values come from the thing under test is self-consistent under
any permutation of it.** (b) *The contract re-called the pure formatter instead
of parsing what the handler rendered.* Contract 6 ("header, wave line and
legend agree") first compared the header against `formatSeaStateLegend()`
called inside the test, so a handler that hand-wrote a wrong legend row (the
rejected alternative) was invisible — the contract never read the handler's
legend at all. Fixed by parsing the legend rows out of the handler's returned
text. Same family as this entry's rule: reaching the layer is necessary, and
reading the layer's *output* rather than re-deriving it is the other half.

**Extended 2026-09-03** (`bc84256`/`f499cbb`, jma-service-residuals T1/T2) — **when
the deliverable is a *deletion*, run the discriminating mutation against the
post-deletion code, because the construct being deleted can be the thing that
absorbs the mutation.** The task was to remove an unreachable
`if (error instanceof JmaAreaDataUnavailableError) { throw error; }` from the
`onRejected` argument of `.then(onFulfilled, onRejected)` in `loadJmaAreas`
(`src/utils/jmaAreaResolver.ts`). The plan ordered a test first — `logger.error`
called exactly once on the empty-array guard — and prescribed the design's one
named-and-rejected alternative as the mutation that would prove it discriminates:
`.then(a, b)` → `.then(a).catch(b)`, which routes the guard's throw into the
handler. **Applied to the pre-deletion code it left the test green**, and reading
that as "the test is vacuous" or "the deadness claim is wrong" would both have
been wrong. The branch rethrows *without logging*, so it is **observationally
inert**: a reached handler and an unreached one produce the same single
`logger.error` call. Nothing could tell them apart while the branch stood — which
is a stronger deadness result than the plan claimed, not a weaker one, and it is
unfalsifiable by construction. The same mutation applied *with* the deletion in
place went red immediately (`expected "error" to be called 1 times, but got 2
times`, the second `'…failed to load'`), because the silent rethrow was gone and
the guard's error reached the handler's own logging.

The generalisation, and the planning rule that follows: **a construct whose only
effect is to re-emit what already happened cannot be proven dead by any test
while it is present.** A test written to protect its removal is not certifying
the *pre*-state; it is a lock on the *post*-state, and its discrimination check
belongs on the task that does the deleting, not on the task that writes the test.
A plan that puts the mutation check on the test-writing task will read a green
mutation and have no correct move available — the two tempting ones are to weaken
the deletion claim and to strengthen the test, and neither is the answer. Related
to this entry's 2026-08-29 extension (a mutation must *diverge*, not merely
differ): there the two branches computed the same value from the fixtures; here a
second, redundant suppressor sat between the mutation and the observable.

**Status:** active, **extended 2026-08-29, twice on 2026-09-01, and 2026-09-03**. Related: [G13] (a fixture that cannot discriminate),
[G32] (mutating to every *rejected implementation* — this entry is about the
*entry point*, that one about the *alternative*), [G11] (read the real output),
[G41] (a plan's mechanical prediction is not the contract), [G57] (the run that
produced the 2026-08-29 extension). Not lintable.

## G46 — A docs task writes the plan's promise, not the code's behaviour

**Trigger:** a task whose deliverable is prose describing behaviour —
`docs/TOOLS.md`, `docs/ERROR_HANDLING.md`, `README.md`, a `CHANGELOG.md`
`[Unreleased]` entry, **or a `GOTCHAS.md` entry's `Trigger:` line rewritten for a
signal a sibling task just changed** — written from the design plan's own wording,
on a plan whose earlier tasks are already green.

**Rule:** every behavioural sentence a docs task publishes must name the test or
the live probe that proves it. A claim traced only to the design plan is a claim
about what was *intended*, and nothing downstream will catch the difference. If
the proof does not exist, the sentence is not ready to ship — narrow it to what
is proven, or go and make the code true, but do not publish it and move on.

**Why:** the docs task sits at the end of the run, after the gate has been green
for several commits, and its natural source is the plan paragraph that specified
the feature. That paragraph describes the design, which is exactly the thing the
implementation may have diverged from. Nothing between the sentence and the
registry re-reads it against the code: the unit suite asserts rendered output for
the states the tests construct, `check-doc-versions.sh` checks version, tool and
test counts rather than claims, and a diff review reads the diff — where the docs
and the code it describes both look correct in isolation. On a safety tool the
result is the project's own worst failure mode with the polarity reversed: not a
fabricated all-clear in the report, but a published promise the report does not
keep.

**Verify:** walk each behavioural claim the task adds and point it at a contract
name or a captured probe. Where the claim is about a *failure* path, induce the
failure rather than mocking it — the failure legs are where the divergence
hides, because they are the legs the happy-path tests never enter.

**Evidence:** 2026-08-28 (`a729a2d`, lightning-degradation-honesty T4; caught at
`/test-drive`, fixed by `09bcd5f`). Three shipped documents — `docs/TOOLS.md`
§11, `docs/ERROR_HANDLING.md`, and the `[Unreleased]` entry — published *"Strikes
already buffered from earlier monitoring still render during an outage. Buffered
ELEVATED, HIGH and EXTREME strikes retain their urgent verdict"*, taken verbatim
from the design plan. The service's catch returned `[]` on every transport
failure, so the buffer was never read on two of the four failure shapes,
including the one users hit most often. The suite was green at 2,797 tests, the
diff review filed three findings and none of them was this, and the handler's
buffered-outage message arm was *structurally unreachable* on those paths — dead
code that read as live. It surfaced only when a drive stood up a fake broker,
buffered a 5 km strike, killed the broker between queries, and read the rendered
report. The fix was one line.

**A literal string a reader will grep for is the sharpest case, 2026-08-30**
(`a93fb48`, issue-90 T2). Rewriting [G39]'s `Trigger:` for the warning that
`79ea177` had introduced one commit earlier, the curation task wrote the
annotation as `⚠ published, not yet visible on npm` — a fair paraphrase of the
plan's description and **a string the workflow does not emit**. The shipped text
begins `vX.Y.Z was accepted by npm but is not retrievable yet after 40 probes
over 600s`. A trigger line exists to be matched against a real signal, so a
plausible paraphrase is worse than a vague description: someone searching the run
log for the quoted words finds nothing and concludes the entry does not apply.
The source of truth was one `grep` away in the same branch. **When a rewritten
claim quotes a string, copy it from the artifact that emits it**, not from the
plan that specified it — and this holds for `GOTCHAS.md` itself, which is
otherwise easy to treat as notes rather than as published prose.

**Status:** active, **extended 2026-08-30**. Related: [G11] (read the real
output), [G41] (test the acceptance check before obeying it), [G45] (a contract
that cannot reach its subject), [G60] (proving a workflow step's behaviour
outside CI — the harness that would have supplied the string). Not lintable —
the check is a human walking claims against proofs.

---

---

## G47 — A rate-limited upstream answers with a well-formed body that parses to a legitimate-looking zero, so every published count needs a positive control

**Trigger:** measuring a count from a live upstream in order to **publish** it — a
coverage table in a design plan, a number in a `CHANGELOG.md` bullet, a docs
sentence naming how many of something a region has. Also any out-of-band `curl`
standing in for what a service module fetches.

**Rule:** measure a **known-non-zero control** in the same batch, and treat the
whole batch as void unless the control comes back non-zero. Check for the
upstream's own error envelope *before* counting — `len(d.get('gauges') or [])`
reads a 429 error body as `0`. And reproduce the service's exact call shape:
NWPS's `/gauges` silently ignores the bbox filter without `srid=EPSG_4326`
(`src/services/noaa.ts:761`), so a hand-rolled query can measure something the
code never asks for.

**Why:** the failure is silent and it looks like data. NWPS enforces **10
requests / 5 minutes** and says so only inside the JSON body, alongside HTTP 429.
A sweep over Puerto Rico, the US Virgin Islands and Guam returned `0, 0, 0` —
a *plausible* answer, close to the truth, and one that would have been recorded
as confirming that no territory is gauged. Only the Nebraska control, which also
read `0` against a known 60, showed that nothing had been measured at all. Rate
limits are the common case against this host, not the exception: the same server
had already 429'd that run's rendered-output probes an hour earlier. And the
check that catches a *rendered* vacuity — [G10]'s construct grep — does not fire
on a bare number, because a number has no construct to grep for. The control row
is the numeric equivalent, and it is the only one available.

**Verify:** issue eleven `/gauges` bbox requests inside five minutes and read the
eleventh: HTTP 429 with
`{"error":{"message":"Rate limit exceeded. Limit: 10 requests / 5 minutes.",...}}`,
on which `d.get('gauges') or []` has length 0 and raises nothing.

**Evidence:** 2026-08-28 (`b2b8d82`, issue-85 river coverage disclosure T4). The
changelog bullet published *"Puerto Rico has 116 NWPS gauges while the US Virgin
Islands and Guam have none"*. Under [G46] that number was re-measured rather than
inherited from the design plan — and the first re-measure returned four zeros,
control included. After a ~7 minute backoff the real figures reproduced the plan
exactly: Nebraska **60**, Puerto Rico **116**, USVI **0**, Guam **0**. The same
run's T2 probes had hit the identical limit and rendered the handler's `catch`
block at all four points; they were discarded and re-run for the same reason.

**Budget the batch by requests, not by probes, 2026-08-29** (`17b2699`, issue-86
T3). The 10-per-5-minutes ceiling is easy to blow through while counting
correctly-but-wrongly: a river probe is **not one request**. An empty-branch
probe costs 1 (`/gauges` bbox), but a gauge-bearing probe costs **1 + up to 5**,
because `riverConditionsHandler.ts:327-331` fetches `getNWPSStageFlow` for every
shown gauge and the display cap is 5 (25 at `detail: "full"`). The issue-86 plan
budgeted *"≤ 9 `/gauges` calls"* for a batch whose gauge-bearing rows alone would
have issued 24, and a base-vs-branch pair of one such probe is 12 requests inside
20 seconds — self-inflicted 429s on the very rows the sweep exists to compare,
which then degrade to no-trend output and hash *identically* on both sides.
**Two levers, both used there:** split the batch into windows of ≤ 9 requests
with a ≥ 330 s gap, and shrink the gauge rows with a small `radius` (4 km at
Omaha returned 1 gauge, ~2 requests, and still expressed the `📊 **Found`
construct). Count the fan-out per probe before planning the windows.

**Status:** active, **extended 2026-08-29**. Related: [G10] (prove the hash is not vacuous — the same
failure with a number in place of rendered text), [G28] (a probe that fails
validation reports as a clean negative), [G4] (never trust the HTTP 200 alone —
here the status is 429 and the body is still well-formed JSON), [G48] (the
sibling from the same feature, where the unreal thing is an injected domain
*value* rather than a measured count), [G52] (a matrix axis the path ignores —
the same "this row is not evidence" family). Partly lintable: a measurement helper
that refuses to report unless a named control row is non-zero would close it
mechanically.

---

## G48 — A fixture can supply a value the live resolver never produces, so a passing, mutation-checked test proves nothing about production

**Trigger:** a test injects a **domain value** — a country code, currency, locale,
status enum, MIME type — through a fake, and a branch is selected by comparing that
value against a set. The risk is not the comparison; it is whether the upstream can
ever hand you that value at all.

**Rule:** before asserting on an injected domain value, **measure what the live
resolver returns for that same input**, at the exact parameters production sends.
If the two differ, the test is describing a world that does not exist. Assert on a
value the resolver can actually emit, and if a set member turns out unreachable, say
so where it is defined.

**Why:** this failure survives every check the project already runs. The test is
green, [G45]'s "the mutation must go red where the contract reaches it" is satisfied,
and even [G32]'s stronger form — mutate to the *rejected* implementation and confirm
exactly the right cases flip — passes cleanly, because the mutation and the fixture
share the same false premise. Nothing inside the suite can see it: the suite never
calls the resolver. Only reading real output at a real point can.

**Verify:** for each injected value, issue the live request the service issues and
compare. A set member that no live input can match is unreachable code, not tested
code.

**Evidence:** 2026-08-28, the `/test-drive` pass on issue-85 (river coverage
disclosure). `NWPS_COVERED_COUNTRIES = new Set(['us', 'pr'])` was chosen so that Guam
and the USVI — which NWPS does not gauge — would receive the coverage disclosure, and
three cases at `tests/unit/river-conditions-global.test.ts` injected `'pr'`, `'vi'`
and `'gu'` to prove it. The G32 mutation check widened the set to `{us, pr, vi, gu}`
and turned **exactly two** red, which read as strong evidence. But
`reverseCountry` asks Nominatim at `zoom=3`, and at country zoom OpenStreetMap
resolves **every US territory to `us`** — on the reverse path and on the forward path
`city_name` uses. So no live input produces `'pr'`, `'vi'` or `'gu'` for those
coordinates: Guam and the USVI match `us`, are treated as covered, and still render
the advice the issue was filed to remove — futile at Guam, which returns 0 gauges at
the maximum `radius: 500`. The `'pr'` member is unreachable; Puerto Rico is covered
because it resolves to `us`. Tracked in #86.

**The defect this entry recorded is fixed, and the entry's prediction was
confirmed under mutation, 2026-08-29** (`e2622f5` + `9447710`, issue #86).
Coverage now requires the `isInUS` boxes as well as the country set, so Guam and
the USVI render the disclosure live. The rule stands unchanged — what closed is
the instance, not the trap — and the run produced the cleanest demonstration of
it yet. Mutating the predicate back to the pre-fix form turned **exactly four**
tests red, all of them from the new block that injects `'us'` (the value the live
resolver actually emits); the three original seam cases injecting `'pr'`, `'vi'`
and `'gu'` stayed **green**, because the mutation and those fixtures share the
same false premise. A reviewer reading only the old block plus a green mutation
row would still have concluded the behaviour was pinned. Both blocks are now kept
deliberately: the injected-`us` block as the description of production, and the
injected-`pr`/`vi`/`gu` block as a seam pin on the *inclusion* of `pr` — no more
than that, with a header comment saying which is which.

**Corrected 2026-08-29 by `/diff-review` (claude), MINOR-1.** This paragraph and
the test header first claimed the injected-`pr`/`vi`/`gu` block was a seam pin on
"the set's contents", i.e. proof the set distinguishes `pr` from `vi`/`gu`. A
mutation disproved it: widening `NWPS_COVERED_COUNTRIES` to the wildfire tool's
`{us, pr, vi, gu}` left `tests/unit/river-conditions-global.test.ts` all-green
(**38 passed (38)** as measured at `938a8e0`), because the new `!inUsBoxes ||`
term short-circuits at Guam and the USVI before the set is read. Dropping `pr` still goes red (1), so inclusion is
pinned and exclusion is not. The lesson generalises past this entry and is filed as
[G54]: **after adding a short-circuit in front of an existing condition, mutate the
inner term and check the old block still goes red** — and where it does not, say
which alternative became indistinguishable rather than describing the block as
proof of the term it can no longer reach.

**A second instance, found and closed 2026-08-29** (`b45aaba`, issue #84). This
entry's own shape, in the fixture direction rather than the resolver direction:
`riverConditions.test.ts` and `river-band-rounding.test.ts` injected
`flood: { categories: { action: 8, minor: 10, ... } }` — flat numbers — and
`HistoricCrest` fixtures with `{ value, date, description }`. **NWPS has never
returned either shape**; the categories are `{ stage, flow }` objects and there is
no `description` field upstream at all. Every one of those tests was green,
mutation-checked, and describing a world that does not exist, which is why three
renderers could sit in the tree for months rendering nothing. The closure is the
mechanism this entry asks for, made permanent: three real `GET /gauges/{lid}`
responses committed under `tests/fixtures/` and driven through the renderer
offline (`tests/unit/nwps-gauge-shape.test.ts`), so a future divergence between
what the fixtures assert and what NWPS sends fails a test instead of shipping.
This established the repo's first committed-capture convention — there was no
`tests/fixtures/` before it.

**The same gap between assumed and live values can make a whole branch
unreachable, 2026-09-03** (japan-alerts T12). A design plan stated that a
disputed-territory area "resolves normally and renders an explicit
no-issuing-office note". True of the *resolver*; false of the *routing*. Live,
`NominatimService.reverseCountry` returns **`'ru'`** for 44.0/145.8, so the point
never reaches the Japanese branch at all and renders through Google as Russia.
The branch is correct, tested, and simply not reachable via bare coordinates —
only via a saved location or geocoded `city_name` carrying the country. Check a
routing assumption by calling the live resolver at the exact coordinate, the
same way this entry's original instance checks a fixture's value; a probe aimed
at that branch otherwise comes back a plausible clean negative ([G28]).

**A third instance, closed 2026-09-08** (`f5d51a3` + `da29508`,
forecast-auto-source-contract). This entry in its purest form, and the longest-lived:
**four** NOAA forecast fixtures supplied `properties.updated`, a key the live NWS forecast
API does not send and never has — the wire's key set is exactly `elevation,
forecastGenerator, generatedAt, periods, units, updateTime, validTimes` on both products.
So `formatNOAAForecast`'s `**Updated:**` line was gated on a field that never arrived, and
it had therefore **never rendered in production for the project's entire history** while the
suite stayed green. The mutation check was available and would have proved nothing: the
fixtures and the handler shared the same false premise. Two details worth carrying: the
fixture that mattered most was an **integration** fake feeding the real handler
(`tests/integration/almanac.test.ts`), found only by enumerating the whole repo rather than
the three unit builders a plan had named; and the sweep's **base** column stated the defect
in one line — `**Updated:**` grep count `0` at every probe including both US points.

**Status:** active — the rule, with its original instance closed. Related: [G45] (a mutation only goes red where the contract can
reach it — this is the case where it goes red for the wrong reason), [G32] (mutating
to the rejected implementation, which shares the fixture's premise and so cannot
expose it), [G11] (read the real output — the only check that caught this), [G47]
(the sibling from the same branch, where the *number* rather than the *value* was
unreal), [G51] (this entry read backwards — the wire produces a value the *type*
denies). Not lintable: nothing in the type system distinguishes a reachable domain
value from an unreachable one.

## G49 — A re-based line citation computed by arithmetic is wrong twice over: the diff's line count is not the file's growth, and the cited line is often not the construct

**Trigger:** a release moves a file that other documents cite by line number — a
roadmap row, a plan's `## Docs impact`, an open-check block, a review anchor — and
you update those citations to keep them usable.

**Rule:** **measure the new line number; never derive it.** Grep the construct in the
new file and read the number back. Two independent errors hide in the arithmetic, and
they do not cancel:

- `git diff --stat` reports **changed** lines (insertions + deletions), not net
  growth. A hunk that rewrites ten lines and adds one reports `11`, and the file grew
  by one.
- The cited line may name a **call site** rather than the definition, or a sentence
  inside a block rather than the block's opening. Two constructs that share a name sit
  at different offsets and shift by different amounts if any hunk lands between them.

**Why:** a stale citation is inert — the next reader greps and finds the construct
anyway. A *confidently wrong* one is worse: it is precise, it is freshly stamped with
the release that supposedly verified it, and it sends the next `/design-plan` to read
the wrong part of the file. The failure is silent in both directions — nothing
compiles these numbers and no gate checks them, so the error survives until someone
acts on it.

**Verify:** for each citation, `grep -n` the construct in the new file and in the base
(`git show <base>:<path>`). Confirm the base number matches what the document actually
claims before trusting your reading of what it meant; if it does not, the citation was
already describing a different construct and re-basing it by any method would have
carried that error forward.

**Evidence:** 2026-08-28, the v1.25.10 release (issue-85 river coverage disclosure).
Three figures were written into `ROADMAP.md` by arithmetic and all three were wrong.
The merge stat's `54` was taken as the file's growth; `riverConditionsHandler.ts` went
from 803 to 843 lines, so the real shift below the change was **+40**. The row-7
citation `deriveFloodCategory:739` was read as the function definition and re-based to
`:793`; `:739` was the **call site** (now `:779`) and the definition was at `:777`
(now `:817`). And the long-standing `catch`-boundary citation `:311` was not the
`catch` at all — that was at `:306` (now `:346`) — but the coverage sentence inside it
(now `:351`). Caught only by grepping the file to check a number already written down.

**Evidence, 2026-09-09** (`dfde51a`, issue-88-tool-count-source T8): the largest
sample this entry has. Deleting 24 lines from `check-doc-versions.sh` and editing
`update-docs-for-release.sh`'s steps 4-5 shifted **18** citations across five
entries (G12, G14, G15, G38, G42). Every one was re-measured by grepping its
construct in both the new file and the base. **Four of the eighteen were already
stale on the base**, before the run touched anything — which is exactly the case
this entry's Verify line tells you to test for, and it fired at 22%:

- G14's `update-docs-for-release.sh:139` named a line inside the CHANGELOG
  link-block heredoc, not the suite run. The suite run was at `:154` on the base
  and is *still* at `:154` — arithmetic would have "corrected" a citation that
  never needed moving, to a line that was never right.
- G14's and G15's `:257` was 15 lines short of the checker invocation at `:272`.
- G12's `README.md:346` was 44 lines short of `:390`, while that same entry's
  Status line already recorded the comment as having "moved twice (346 → 381)" —
  the entry knew, and its own Why paragraph kept the oldest value anyway.
- G12's `update-docs-for-release.sh:219-222` was **mis-attributed rather than
  merely shifted**: on the base that range is the `CLAUDE.md` sed block, and the
  `docs/README.md` block it claimed to name was at `:229-232`. No amount of
  re-basing arithmetic recovers a citation pointing at the wrong construct.

The inverse also happened once and is worth the same weight: the implementation
plan *predicted* G42's `:167` would be stale, and it was **accurate** — it moved
only because of the run's own edit. So a plan's guess about which citations have
rotted is itself a claim to measure, in both directions.

**Status:** active. Related: [G11] (read the real thing rather than trusting a
derivation), [G46] (a docs task writes the plan's promise rather than the code's
behaviour — the same class, one level up: a document asserting what it did not
measure). Not lintable, but nearly so: a checker that greps each `path.ts:NNN`
citation in the roadmap and reports the ones whose line no longer holds the named
construct would catch every instance of this.


## G50 — A task's temporary verification write counts against `parallel-safe`, and its backup path must be task-scoped

**Trigger:** two tasks marked `parallel-safe` on disjoint `Files:` lists, where
either one's self-check temporarily edits, generates, or restores a live
worktree file that appears in **neither** list — the classic case being "widen
the type file, run `tsc`, restore it".

**Rule:** put temporary verification writes and their backup paths in the
parallel touch-set. Serialize the tasks, or give each an isolated worktree.
Back up to a **task-scoped `mktemp`** restored by a shell `trap`, never a
shared literal path:

```bash
BACKUP=$(mktemp); trap 'cp "$BACKUP" <file>; rm -f "$BACKUP"' EXIT
cp <file> "$BACKUP"
```

Confirm the restore landed (`git diff --quiet <file>`) before handing back, and
run nothing else against the worktree while the mutation is in flight.

**Why:** two failure modes, both quiet. A sibling task's gate observes the
transient state and goes **red on work that is correct** — here the widened type
file reports 59 errors tree-wide. And two overlapping backup/restore loops
sharing one path can restore an already-mutated backup, leaving the mutation in
the worktree permanently, where the next commit sweeps it up. The reader's
disjointness test passes on a false reading, because the mutated file is in
neither `Files:` list — which is exactly what makes this worth an entry rather
than leaving it to judgment.

**Verify:** take any plan whose task self-check mutates a shared file, and check
whether that file appears in the task's `Files:` list. If it does not, the
`parallel-safe` marker was decided on incomplete information.

**Evidence:** filed as a candidate by the Codex plan review of
openmeteo-nullable-series-types (2026-08-28), which found T2 and T3 marked
`parallel-safe` while both rewrote `src/types/openmeteo.ts` through a shared
literal `/tmp-backup`. Triage found that path **unwritable in this environment**
(`/tmp-backup` is at the filesystem root), so the self-check could not have run
at all — a second, independent reason the literal path is wrong. Confirmed in
the run: serialized T2→T3→T4 with `mktemp`+`trap` backups, and every restore
verified clean (`7e946d7`, `8b87f0b`, `dc4b8be`). This project had already lost
orchestrator edits once to a subagent mutating the shared tree.

**Status:** active; **narrowed by [G89] 2026-09-09** — this entry covers a
temporary write to a file in *neither* task's list. When the mutated file is in
the mutating task's own list and the sibling merely *runs the suite*, the pair
still looks disjoint and G89 is the entry that catches it. Related: [G27]
(restore by file copy, never `git checkout --` — the same backup discipline for
the uncommitted-fix case), [G89], [G90].

---

## G51 — Widening a type does not make a value newly reachable; it only stops the compiler denying it

**Trigger:** landing a null-guard, range-guard, or variant-guard ahead of the
type change that will admit the value — and reasoning about when the guard
"becomes live".

**Rule:** a declaration is a claim about the wire, not a control over it. If the
upstream already sends the value, the guard is load-bearing **the moment it
lands**, and the type change only stops the compiler certifying the old code as
safe. Never describe a guard as "not yet reachable until the types widen", and
never defer landing one on that reasoning.

**Why:** the inference is seductive precisely on the plans where it is most
wrong. On a type-honesty plan the guards land first (so every commit stays
green) and the widening lands last as the completeness proof, so a builder sees
"my guard compiles against `number[]`" and concludes nothing can reach it yet.
The opposite is true: the reason the plan exists is that the wire has been
sending `null` all along while the type denied it, and the guard is what stops
`Math.round(null)` rendering a fabricated `0`. Believing the guard is inert
invites skipping its live verification, or writing a changelog sentence in the
future tense for behaviour that is already live.

**Verify:** for the value in question, issue the request production issues and
read the raw upstream body — not the parsed object, whose type is the thing in
question. If the wire carries the value, reachability predates the declaration.

**Evidence:** 2026-08-28 (`04765a3`, openmeteo-nullable-series-types T4). The
builder's own Surprises section reported that its live probe returned non-null
temperatures, then concluded *"nothing in the current build makes a null value
reach these lines yet — this becomes reachable once T5 lands the wider types"*.
Open-Meteo answers HTTP 200 with JSON `null` past a model's horizon regardless
of what `src/types/openmeteo.ts` says; T5 changed what the compiler permits,
never what the wire sends.

**A second shape, 2026-09-08** (`f5d51a3`, forecast-auto-source-contract T1): not a
nullability widening but a **field-name** one. `ForecastProperties.updated` was declared
`updated: string` — required — for a field the wire has never sent, so the compiler
certified the guard reading it as safe while the guard was silently false in production
from the day it was written. The plan wrote the rule into the task text in advance and the
changelog bullet was written in the past tense; nothing "became" reachable. The general
form is worth stating: **a required declaration is as much a false claim about the wire as
a non-nullable one**, and `makeRequest<T>` performs no runtime validation, so the generic
is an assertion over the axios body rather than a check on it.

**Status:** active. **Re-confirmed live 2026-09-01** (`0e63f8c`, `3adc2d2`,
openmeteo-nullable-scalar-types T1/T3): the raw Open-Meteo marine body carried
`wind_wave_peak_period: null, swell_wave_peak_period: null` at Sydney Heads and
at 30,-60, and the air-quality body carried `ammonia: null` at Denver, on the
day the guards landed and five commits before the type widened; base rendered
`N/A`, the guard commits omitted the line. The plan wrote this rule into every
task ("do not describe these guards as not yet reachable") and no subagent
repeated the 2026-08-28 inference. Related: [G48] (a fixture can supply a value the live
resolver never produces — this is that entry read backwards: the live resolver
produces a value the *type* denies), [G11] (read the real output). Not
lintable — it is a claim about the upstream, not about the code.

## G52 — A probe-matrix axis the code under test never reads produces duplicate rows that look like independent coverage

**Trigger:** reporting a verification matrix with more than one axis — the
bindings' standing **unit system × provider path** matrix, a detail-level sweep,
a locale or preset axis — where each cell is presented as its own row of
evidence.

**Rule:** before reporting the matrix, confirm the **render path under test
actually reads that axis**. Grep the formatter for the resolver
(`resolveUnitPreferences`, the detail parameter, the preset lookup) and check it
is called *on the path you probed*, not merely somewhere in the file. An axis
the path ignores yields N identical rows, and N identical rows are one probe
reported N times. Say which axis was real and which collapsed, rather than
publishing a cell count that overstates what was exercised.

**Why:** the arithmetic is silently flattering and every row looks healthy. The
rows are not vacuous in [G10]'s sense — the construct is present, the feed is up,
the hashes match for the right reason — so the construct grep, the positive
control and the byte-identity comparison all pass while the matrix proves a
fraction of what its shape claims. The failure compounds with a base-vs-branch
sweep: identical hashes *across* trees are the result you want, and identical
hashes *across the axis* sit in the same table looking equally like success. It
also mis-aims future work, because the matrix is the record a later plan reads
to decide what is already covered.

**Verify:** take any two cells of the matrix that differ only in the axis and
`diff` their raw outputs. Identical bytes mean the axis collapsed; then grep the
formatter that produced them for the axis's resolver and confirm whether the call
exists on that path at all.

**Evidence:** 2026-08-29 (`17b2699`, issue-86 territory NWPS coverage T3). The
byte-identity sweep ran four subjects in **imperial and metric**, eight rows, all
identical across trees with non-zero construct counts. Four of those rows were
duplicates: `resolveUnitPreferences` is called at
`riverConditionsHandler.ts:463`, inside `formatOpenMeteoRiverConditions`
(`:446`–), and **`formatNOAARiverConditions` (`:227`–`:397`) never calls it** —
the NOAA path renders distances dual unconditionally (`50 km (31.1 miles)`,
`1.4 km (0.9 mi)`) and gauge stage in NWPS's native feet. So `units: "metric"` is
a no-op there and `omaha-imp` hashed identically to `omaha-met` for a reason that
had nothing to do with the change under test. Caught by diffing the two branch
outputs against each other rather than only against their base counterparts. The
real metric evidence came from the Open-Meteo path, which does honour the
preference (`3.6 m³/s (127 ft³/s)`). Recorded as an observation rather than
fixed: it is pre-existing, `units` is undocumented for `get_river_conditions`,
and the plan was scoped to one predicate in an F1 file.

**The prediction runs the other way too, 2026-09-02** (`b4b18a3`,
noaa-forecast-horizon-disclosure T3) — **a plan can assert an axis collapses when
it does not, and instruct the run to report two real rows as one.** The plan told
the sweep to expect `get_weather_summary` at its default `detail` and at an
explicit `standard` to be *identical to each other* on the branch, citing this
entry, and to "report as one probe with a note". Measured: 2,093 bytes against
2,950. The forecast section **does** read `detail` — `summary` omits each
period's `detailedForecast` prose that `standard` prints — and the same gap is
present between the two **base** cells, so it is pre-existing rather than
introduced. The error was in the safe direction (the matrix under-claimed), but
the instruction would have discarded a genuine row. This is the [G19] 2026-08-27
clause applied one step earlier: *check whether the section under test reads
`detail`* before predicting either that the paths diverge **or** that they
collapse. **The Verify line below decides it in one `diff`; do not settle it from
the plan's prose in either direction.**

**Status:** active, **extended 2026-09-02**. Related: [G10] (the same "this row proves nothing" family,
where the cause is a failing feed or a subject that cannot express the
construct — here the feed is healthy and the subject is fine, and it is the
*axis* that is inert), [G47] (the numeric sibling), [G11] (reading the output is
what exposed it), [G19] (whether the section reads `detail` at all). Partly lintable — a matrix helper that diffs sibling cells and
refuses to count identical ones as separate rows would close it mechanically.

## G53 — Promoting a routing heuristic to a rendered claim inherits every edge it was allowed to get wrong

**Trigger:** a predicate that only ever *chose a data source* starts also deciding
what the output *asserts* — a bounding box, a locale guess, a tier lookup that now
selects between "here is your data" and "we do not cover you".

**Rule:** re-audit the predicate's edges against the thing it is now claiming, not
against the thing it used to route. A box that is 95% right is fine for "which
upstream do I ask"; the wrong 5% costs one extra API call. The same box behind a
sentence that names a jurisdiction is a false statement about that jurisdiction.
Enumerate the extremes of every region the *rendered text* names by name, not only
the ones the original routing cared about.

**Why:** the promotion is invisible in the diff — the predicate is unchanged, only
its consumer is new — so a reviewer checking "did `isInUS` change?" gets a clean
answer and stops. And the plan's own safety argument reads as airtight ("this can
only add disclosures, and only at points routing already refuses"), which is true
and still permits a false claim, because "routed elsewhere" and "not covered" are
different statements about the same coordinate.

**Evidence:** 2026-08-29, issue-86 territory NWPS coverage, caught by
`/diff-review` as MAJOR-1. `isInUS` (`src/utils/geography.ts`) became decisive for
the NWPS coverage disclosure. Its Puerto Rico box stopped at `18.5 N` / `-67.3 W`;
the island reaches `18.5208 N` (Punta Agujereada) and Mona Island sits at
`-67.89 W`. So
`{ latitude: 18.5208, longitude: -67.15, radius: 10, source: 'noaa' }` rendered
"NWPS gauges rivers in the United States and **Puerto Rico** only, and this
location appears to be outside that coverage" at a point in Puerto Rico with 13
NWPS gauges inside 50 km and the nearest at 14.04 km — while `main` rendered the
correct, actionable "Try expanding the search radius" for the identical call. The
design plan checked the box edges against Key West, Eastport, Northwest Angle,
Utqiaġvik and Adak — every CONUS and Alaska extreme — and never checked Puerto
Rico's, the one place the sentence names. Fixed by widening the box to the
Commonwealth's real extent (`17.85–18.55 N`, `-67.95` to `-65.2 W`).

**Verify:** for each region the rendered string names, look up that region's true
bounding extremes and evaluate the predicate at all four. Partly lintable: a
coverage predicate and the place-names in the string it selects could be
cross-checked against a gazetteer.

**The same promotion happens to a *label*, not only to a predicate, 2026-09-03**
(`d868c6a` / `bd4a81f`, japan-alerts T1 and T8). An upstream's display label for
one entity can be **byte-identical to a different, real entity's**, which is
harmless while it is only a map caption and false the moment it is rendered
beside a claim. JMA's class10 GeoJSON labels the office-less `hoppo` feature
`根室地方` / `Nemuro` — the same string as real area `014010`, which *does* have
an issuing office and *does* receive warnings. Rendering "no office issues
warnings for 根室地方 (Nemuro)" is a false statement about 014010. And the
non-uniqueness is not a one-off: `北部` / "Northern Region" labels **17**
different class10 areas and `南部` / "Southern Region" **18**, because they are
prefecture sub-region names meaningful only beside their parent office. Two
rules follow — key a no-data branch off the structural fact (`officeCode ===
undefined`) and print **no** label for it, and never render an upstream label as
though it identified a place without the context that disambiguates it. A
generated artifact should reproduce its source rather than rename anything, so
the fix belongs at the render site and the trap belongs in the artifact's own
header.

**Status:** active. Related: [G48] (the same feature one level down — the resolver
value the fixture could not produce), [G54] (the sibling from the same review —
the short-circuit that predicate introduced), [G11] (reading the output is what
exposes it), [G4] (empty vs not-covered are different claims).

## G54 — A short-circuited term makes every test downstream of it degenerate, and the block still passes

**Trigger:** adding a conjunct or disjunct in front of an existing condition —
`!inBoxes || (existing)`, `if (!enabled) return; …` — where existing tests
exercised the second term at inputs the first term now decides on its own.

**Rule:** after adding the short-circuit, mutate the **second** term and check the
old block still goes red. Where it does not, the old tests are no longer pinning
what their names say; re-point them at inputs the short-circuit does not swallow,
or relabel them for what they now cover. Do not describe them as proof of the inner
term — write down which alternative became behaviourally indistinguishable, per
[G32].

**Why:** the block keeps passing, so nothing signals the loss. Its *comment* is
usually rewritten in the same diff to explain why it still holds, which is the
moment the false claim gets committed — and it is committed into a lock file, the
artifact the next plan trusts most.

**Evidence:** 2026-08-29, issue-86 territory NWPS coverage, caught by
`/diff-review` as MINOR-1. After
`outsideCoverage = !inUsBoxes || (countryCode !== null && !NWPS_COVERED_COUNTRIES.has(countryCode))`,
mutating the set to `{us, pr, vi, gu}` — the NIFC set the handler comment says it
is "deliberately NOT" — left `tests/unit/river-conditions-global.test.ts`
all-green (**38 passed (38)** as measured at `938a8e0`), because `GUAM_POINT` and
`VIRGIN_ISLANDS_POINT` are outside every box and never reach the set. Dropping `pr` still went red (1), so the block
pins inclusion and not exclusion. The diff's rewritten header nevertheless called
it "proof `NWPS_COVERED_COUNTRIES` distinguishes `pr` from `vi`/`gu` as written",
and [G48] repeated the claim; both were corrected.

**Verify:** mutate each term of the compound condition separately and record which
tests go red per term. A term with no red is unpinned regardless of how many tests
sit in the block.

**Verify line run clean, 2026-09-18** (`9cffd30`, nws-alert-jurisdiction T2) — the
first time this entry's trigger fired and the answer was "both terms pin
something". `isInUS(...) || isInNwsTerritory(...)` is exactly the short-circuit
shape. Mutating `isInUS` to `false` turns **9** cases red, every one of them a
bare-US-coordinate case; mutating `isInNwsTerritory` to `false` turns **13** red,
all territory cases. The two red sets are **disjoint**, which is the strongest
form of the answer this entry asks for: neither term was swallowed by the other,
and the pre-existing block's name still describes what it covers. Recording a
clean run matters as much as recording a dirty one — the entry is about
*measuring*, not about expecting a loss.

**Status:** active. Related: [G32] (mutate to every rejected implementation and
report the divergence set), [G45] (a mutation only goes red where the contract
reaches it), [G13] (a fixture degenerate along one axis), [G53] (the sibling from
the same review — what the short-circuited predicate was deciding), [G99] (the
case where the *added* term is a conjunction inside a fast path, and dropping it
reddens nothing unless the cross-product cell was written).

## G56 — A missing-data sentinel can have more than one encoding, so swapping a truthy guard for a real-value guard un-suppresses the second one

**Trigger:** replacing `if (value)` with `if (isRealValue(value))` (or any
explicit sentinel guard) on a third-party numeric field, to fix a sentinel that
was rendering literally.

**Rule:** before swapping, enumerate **every** value the upstream uses for "not
recorded" on that field, over a real capture — not just the one in the bug
report. Truthiness suppresses `0`, `NaN`, `null`, `undefined` and `""` all at
once; a sentinel guard suppresses exactly what you name and **admits everything
else**, so the swap is a widening in the direction nobody is looking. Where `0`
is a real reading for the field (a stage, a temperature) keep it; where `0` is
physically impossible for the quantity (a flood crest's flow, a wind speed at a
recorded gust), it is a second sentinel and must be excluded explicitly.

**Why:** the old guard was wrong *and* was hiding the second encoding by
accident, so the fix looks strictly like an improvement and is a regression on
the majority of rows. It cannot be caught by the test that motivated the change,
because that test asserts on the sentinel you already knew about. Nothing else
in the suite is likely to assert on the field at all — a "no clause rendered" case
is the assertion nobody writes.

**Verify:** over a committed capture, count the field's distinct values and how
many rows each guard admits. `flow` on PRTO3's 26 recent crests: 20 zeros, 1
`-9999`, 5 real. Truthy admits 5; `isRealValue` alone admits 25; the correct
guard admits 5.

**Evidence:** 2026-08-29 (`1c4c052`, issue-84 flood thresholds, found during T2).
`riverConditionsHandler`'s crest renderer used `if (crest.flow)`, which the design
plan correctly identified as wrong — a live `-9999` is truthy and would print
`(-9999 cfs)`. T1 replaced it with `isRealValue(crest.flow)`, whose sentinel
cutoff is `-900`. But NWPS also encodes an unrecorded crest flow as **`0`**, and
`isRealValue(0)` is true, so **20 of PRTO3's 26 recent crest rows started
rendering `(0 cfs)`** — including the 1996 Willamette flood at 28.55 ft, a crest
that self-evidently did not have zero flow. Caught by rendering the committed
capture and reading it ([G11]); **no assertion in the suite covered a crest flow
clause at all**, so both the old and new behaviour were green. The implementation
plan's own acceptance bullet had specified the right answer ("one whose `flow` is
`0` renders no clause") and the code did not match it — the plan was more correct
than the code, which is the reverse of the usual direction and easy to miss.

**Status:** active. Related: [G11] (read the rendered output — the only check
that caught this), [G4] (never trust the HTTP 200 alone), [G51] (the wire sends
what the type denies; here the wire sends two things where the guard names one),
[G47] (the sibling where the unreal thing is a measured count). Partly lintable:
a grep for `isRealValue(` on a field whose capture contains a `0` could flag
candidates, but only a human can say whether `0` is meaningful for that quantity.

---

## G57 — A plan's per-file instruction is applied per *object*, and the object count moves while the run is in flight

**Trigger:** a task says "add X to the mock/config/registration in these N files",
or any acceptance check written as a per-file grep, on a plan whose earlier tasks
create or extend those same files.

**Rule:** enumerate and patch **every object literal**, not one per file, and
write the acceptance as a per-object check that a partial application fails.
Then **re-enumerate at execution time** rather than trusting the plan's count:
a task that adds test files changes the denominator for every later task, and the
plan was written before those files existed.

**Why:** a per-file grep goes green on a partial application — it finds the one
literal you did patch and says nothing about the three you did not. Where the
call being wired sits inside `Promise.allSettled`, an unwired object throws
`TypeError: not a function`, rejects, and is **swallowed by the very batch the
task is adding**: the suite stays green while the new code path is never
exercised. The number in the plan is the most confident-looking part of the
instruction and the part most likely to be stale.

**Verify:** `grep -c` the object-literal opener and the property in each affected
file and compare the two counts per file. Then mutate the *feature* — not the
mock — so that the wiring being real is what the suite depends on: dropping the
fetched result on the floor should go red.

**Evidence:** 2026-08-29 (`1eec0c4`, issue-84 flood thresholds T3). Raised by the
Copilot `/plan-review` leg as R2 and applied as amendment **B2** before the run:
the plan said "add `getNWPSGauge: vi.fn()` to the mock object in all three files",
but `riverConditions.test.ts` alone held **three** `noaaService` literals, and the
one at `:86` already omitted `getNWPSStageFlow` while passing — the swallow was
already realised in the tree, not hypothetical. **The run then moved the count
again:** T2 added two more literals to that file and created
`nwps-gauge-shape.test.ts`, so execution found **eight** literals across four
files where the reviewed plan named five across three. B2's per-object grep held;
the per-file version it replaced would have passed at five of eight. Verified
load-bearing by mutating the handler to never record the fetched detail — **20
tests red across four files**. Note the weak mutation that does *not* work:
preferring the pre-existing value over the fetched one passes everywhere, because
the test helper hands back the same object the other mock produced, so both
branches evaluate to the same value ([G45]).

**Status:** active. Related: [G45] (a mutation only goes red where the contract
reaches it — and the note above on choosing one that diverges at all), [G50] (a
task's temporary write counts against `parallel-safe`), [G41] (test the
acceptance check before obeying it — this is that rule applied to a grep that
counts). Lintable in part: a check that every `const <service> = {` literal in a
test file exposes the same method set would close the per-file half mechanically.

---

## G58 — Regenerating a capture does not regenerate the prose around it, and the two then disagree in public

**Trigger:** running `npm run examples` (or any capture-refresh script) on a
document that pairs generated output with a hand-written narrative.

**Rule:** after regenerating, **read the prose against the new capture** and
correct every number, direction and date it asserts. The capture is refreshed by
the script; the sentences above it are not, and they are the part a reader
believes first.

**Why:** the script reports success, the diff is enormous and mechanical, and the
narrative sits outside the capture markers the script rewrites — so nothing in
the pipeline compares them. Staleness accumulates silently across releases, and
the failure is invisible in review precisely because the regenerated block is too
large to read line by line. It is also self-concealing: the freshly-dated capture
makes the stale prose look freshly checked.

**Verify:** for each generated example, extract every number in the narrative and
grep for it inside the capture block beneath. A number that appears in the prose
and nowhere in the capture is stale or was never true.

**Evidence:** 2026-08-29 (`27d1219`, issue-84 flood thresholds T7).
`examples/river-and-flood.md` opened with *"reads **1.55 ft and steady**"* and
*"rising about 9 feet over the next week to a crest of 10.5 ft around August
21"*. The capture committed beneath it **on `main`** already read `12.68 ft
↘ falling`, so the prose was stale before this plan touched the file — no release
had compared them. Regenerating for the new `### Flood Stages` sections produced
`9.54 ft ↘ falling` with the series receding to `-2.30 ft`, which would have
shipped the same contradiction under a fresh timestamp. Corrected in the same
commit.

**Second instance, 2026-09-01** (`a0faa5c`, openmeteo-nullable-scalar-types T7):
`examples/wildfire-awareness.md`'s narrative on `main` read AQI 59, UV 5.7, an
11-detection / 8-cluster Athens result and a 205 ft mixing height against the
capture committed beneath it, which read 54, 5.5, 9 / 7 and 108 ft — stale
before this plan touched the file, exactly as the river example was.
Regenerating for the retired `N/A` line would have shipped the same
contradiction under a fresh date. The Verify line was run mechanically this
time (extract every decimal in the answer blocks, grep the capture beneath):
two of six blocks were clean, four needed rewriting, and the one residual miss
was a deliberate rounding (`88 miles` for `87.9 mi`). It is cheap enough to run
on every regeneration.

**The script regenerates everything, so "only N files should change" is not an
acceptance criterion, 2026-09-08** (`2209ac6`, forecast-auto-source-contract T6).
`npm run examples` is a single full sweep, not a per-file refresh: it re-captures
all ten example files against live upstreams, so **every** file changes on every
run regardless of what the branch did. A plan predicting "the diff shows only the
two expected files" is predicting something the script cannot produce. Decide by
**structure, not by file count** — for each changed file, diff for the construct
the branch actually adds (`git diff -U0 -- <f> | grep '^+' | grep -c '<construct>'`)
and separate structural change from live drift. Here two files gained the new line
and eight were pure drift (temperatures, radar frame URLs, an alert's county list);
the eight were restored, matching the repo's targeted-refresh precedent (`a0faa5c`).
Per-file `<!-- capture-stamp -->` markers make that honest — each file states its own
capture date. **And a third instance of this entry's own trap came with it:**
`severe-weather-day.md`'s narrative was already stale against the capture committed on
`main` — 104°F against a captured 99°F, day-of-week claims naming Friday and Sunday for a
Tuesday-to-Wednesday window, and a "105 to 110" heat-index range that appeared in no alert
text — and one claim was wrong in *kind* rather than in number ("no rain in sight" against
a capture reading `Showers And Thunderstorms Likely`). Worth noting for scope: the eight
restored captures were last regenerated three minor releases earlier, at v1.25.18.

**Status:** active, **second instance 2026-09-01**. Related: [G46] (a docs task writes the plan's promise, not the
code's behaviour — this is its sibling, where the docs describe an *older run* of
the code), [G11] (read the rendered output), [G29] (sweep the whole doc set).
Lintable: a check that every decimal in an example's narrative appears somewhere
in that file's capture blocks would catch this class outright.

---

## G59 — A guard whose only observable case is a *combination* of two optional inputs needs a test that supplies both

**Trigger:** adding a validity guard (`isRealValue`, a `NaN` check, a null
check) to a renderer whose output depends on two independently-optional upstream
objects — here a gauge's flood thresholds and its forecast series.

**Rule:** when a plan enumerates classes of upstream response (all thresholds /
some / none), **cross them against the other optional the renderer reads, and
write the cell that is empty.** Mutation is what finds these: a guard that no
test turns red is not covered, whatever line coverage says.

**Why:** partial coverage of a guard set reads as adequate. Three of
`deriveFloodCategory`'s four sentinel guards were pinned by the
action+minor-only fixture, so the suite looked complete; the fourth was
observable only where *both* optionals took their unusual value at once, and the
existing fixture set paired thresholds with a forecast series but never paired
*absent* thresholds with one.

**Verify:** mutate each guard individually and run the subject's suite. Any
mutation that stays green names an uncovered cell in the cross-product.

**Evidence:** 2026-08-29 (issue-84 flood thresholds, `/diff-review` MAJOR-1 and
MINOR-1; fixed in `539d31b`). Removing the `isRealValue(action)` guard left all
110 river tests green while the render put a **🟡 ACTION label on a gauge NOAA
publishes no thresholds for**, three lines below the sentence saying exactly the
opposite — a fabricated safety claim on an F1 surface. The crest path had the
same shape: `occurredTime` present but unparseable is its two-optional corner,
and dropping that guard printed `**NaN:**` with the suite still green.

**Status:** active. Related: [G54] (a short-circuited term makes everything
downstream degenerate and the block still passes), [G48] (a fixture can supply a
value the live resolver never produces), [G11] (read the rendered output).
Lintable: no — this is a mutation-testing result, not a grep.

---

## G60 — A workflow step's script is unreachable by the gate, and the obvious harness for it passes without ever running the thing under test

**Trigger:** needing to prove that a `run:` block in `.github/workflows/*.yml`
behaves — a retry loop, an exit code, a gate that must block — when there is no
`actionlint` and no `act` on this machine and `npm run build && npm test &&
npm audit` cannot see the file at all.

**Rule:** four parts, and the fourth is the one that gets skipped.

1. **Extract the script from the YAML with a parser**, not by hand:
   `yaml.safe_load(...)` then pick the step by `name` and take its `run`. A
   hand-copied or `sed`-mutated extract tests a file that will never run.
2. **Run it under `bash --noprofile --norc -e -o pipefail`** — that is the shell
   GitHub Actions gives a `run:` block on Linux. Plain `bash script.sh` has
   neither `-e` nor `pipefail` and will pass where CI fails.
3. **Parameterise the loop's constants with env defaults in the shipped file**
   (`ATTEMPTS="${NPM_VERIFY_ATTEMPTS:-40}"`), so the exercise shortens a
   ten-minute budget to four seconds **without mutating the script**. Set nothing
   in the workflow and CI still gets the defaults. This is a deliberate trade: a
   reader may reasonably ask why a constant is an env var, and the answer is that
   the alternative is testing bytes that do not ship.
4. **Stub the external binary on `PATH` and make it log every call.** The
   *success* case will pass whether or not the stub was ever consulted, because
   the real binary answers identically — a stub `npm` serving `1.25.13` and the
   real `npm` serving an already-published `1.25.13` produce the same
   `npm now serves: 1.25.13`. **The call count is the only positive control.**

**Why:** the whole reason a workflow defect survives is that nothing in the
standing gate reads the file, so the harness is the only evidence there will be
before a real release — and an assertion that passes for the wrong reason is
worse than no assertion, because it is recorded as proof. Point 4 is [G47]'s
shape moved from a measured count to an exercised code path: the observation is
real, plausible, and about something other than what you meant to test.

**Verify:** delete the stub's directory from `PATH` and re-run the *found* case.
If it still prints the found message and still passes, the harness was never
testing the stub — restore `PATH` and assert on the call log instead. Then run
the exhaustion case and check the log length equals `ATTEMPTS`.

**Evidence:** 2026-08-30 (`79ea177`, issue-90 T1). `publish.yml`'s
`Verify publication` step was rewritten to poll 40×15 s and, on exhaustion, emit
`::warning::` and **exit 0** instead of `::error::` and exit 1. Exit 0 on
exhaustion is the entire point of the change and is the one behaviour a reader
assumes rather than checks, so both exits were exercised against a stub `npm`
under `NPM_VERIFY_ATTEMPTS=4 NPM_VERIFY_INTERVAL_S=1`: found-on-call-3 exited 0
with no annotation and **3** logged calls; never-yielding exited 0 with one
`::warning::` naming the version and `registry.npmjs.org`, the same text in
`$GITHUB_STEP_SUMMARY`, and **4** logged calls. Timing confirmed the elided
trailing sleep independently — 4 attempts at 1 s took 3051 ms, three sleeps not
four. `shellcheck` 0.11.0 was clean on the extract and PyYAML parsed the
workflow; **neither is a workflow linter**, and saying so in the commit is part
of the rule.

**Status:** active. `.github/workflows/publish.yml` is due a second edit from
`plan-release-governance-gates.md`, which arms
an audit gate in the same file and will need exactly this harness to prove the
gate blocks. Related: [G47] (a control that proves the measurement
happened at all — the same failure with a count in place of a code path), [G38]
(a release check reporting a confident failure it never measured), [G4] (never
trust the status alone), [G11] (read the real output), [G46] (quote the string
the artifact emits, not the one the plan describes).

---

## G61 — Importing anything from `src/index.ts` runs `main()`, because there is no `import.meta.url` guard

**Trigger:** importing any symbol from `src/index.ts` — or from the built
`dist/index.js` — anywhere: a unit test, and equally a throwaway `node -e`
one-liner used to check what the build produced. **Since the factory split
(issue-95, 2026-09-09) nothing in the tree does this**, and there is little left
to want: `TOOL_DEFINITIONS`, the schema fragments and the dispatch now live in
`src/server/weatherServer.ts`, whose import is inert but for the analytics
singleton. See the **residue** paragraph under the Rule for the two points that
still apply to *that* import. The verification one-liner is the easy one to
forget, because it does not feel like a test; it starts a real server, opens an
MQTT subscription, and does not exit ([G37]). To inspect the built schema, spawn
the dist as a child and speak JSON-RPC to it, or read the source — never import
it into the checking process.

**Rule.** The four points below apply to an import of the **entry**,
`src/index.ts`. `src/index.ts` calls `main()` unconditionally at module scope, so the
import *is* a server start: it constructs a `StdioServerTransport`, calls
`server.connect()`, and registers `SIGTERM`/`SIGINT` handlers. Four things, all
required together:

1. `vi.mock('@modelcontextprotocol/sdk/server/stdio.js', …)` with a stub class
   exposing `start()`/`close()`/`send()`. The real transport attaches to the
   **test worker's stdin**.
2. `vi.hoisted(() => { process.env.WEATHER_LIGHTNING_PREWARM = 'false';
   process.env.ANALYTICS_ENABLED = 'false';
   process.env.ANALYTICS_SALT = '<any fixed string>'; })` — all three must be set
   *before* the static import evaluates, which is what `vi.hoisted` buys over a
   `beforeEach`. The first skips a live MQTT subscribe, the second keeps the
   analytics client off its flush timer, and the third keeps the import off the
   filesystem: `loadAnalyticsConfig()` builds the analytics singleton at module
   load and calls `getOrGenerateAnalyticsSalt()` **regardless of
   `ANALYTICS_ENABLED`**, which writes `~/.weather-mcp/analytics-salt` when it is
   absent. A fixed salt returns at `src/analytics/config.ts:94` before any
   filesystem access.
3. **Import it exactly once, statically.** Never re-import it under
   `vi.resetModules()` — that re-runs `main()` ([G21] point 3). If the same file
   also needs fresh module state, re-import the *other* module
   (`src/config/tools.js`) and leave `src/index.js` alone.
4. Assert the absence of the failure, not just the presence of the pass — but
   know which half the test file owns and which half is an acceptance check. The
   `Fatal error in main()` half needs **no assertion**: a rejecting `main()`
   reaches `main().catch` → `process.exit(1)`, and Vitest replaces `process.exit`
   in the worker, so the rejection surfaces as an unhandled error and the run
   exits 1 on its own. Never reach for a `process.stderr.write` spy to check it —
   that spy records zero calls and passes vacuously ([G34]). The
   `~/.weather-mcp/` half is checked **at acceptance**, and must be run CI-shaped
   — `HOME=$(mktemp -d) DOTENV_CONFIG_PATH=/nonexistent npx vitest run <file>` —
   because the repo `.env` masks the write ([G26]).

**Residue — what an import of `src/server/weatherServer.ts` needs instead.** The
factory constructs no transport, registers no signal handler and calls no
`process.exit`, so points 1 and 4's first half do not apply and neither does
`WEATHER_LIGHTNING_PREWARM` (the prewarm stayed in the entry). What survives is
point 2's **two analytics pins** and point 3. The factory imports `withAnalytics`
from `src/analytics/index.js`, which re-exports the singleton built at module
load in `src/analytics/config.ts:193`; `loadAnalyticsConfig()` calls
`getOrGenerateAnalyticsSalt()` at `:167` regardless of `ANALYTICS_ENABLED`, and a
fixed `ANALYTICS_SALT` returns at `:94-95` before any filesystem access. So:
`ANALYTICS_ENABLED='false'` and `ANALYTICS_SALT='<any fixed string>'`, hoisted;
and import once, statically, never under `vi.resetModules()` — that re-runs
sixteen service constructors and their `Cache` timers ([G21] point 3).

**Why:** the import is silent when it works and confusing when it does not — a
real transport reading the worker's stdin produces a hang or a protocol error
attributed to whatever test happens to be running, not to the import. It is also
easy to conclude the module is simply untestable and to relocate the symbol
instead; that is a much larger diff than the four lines above, and unnecessary.
Everything else reached by the import is already inert: the sixteen service
constructors — which since the factory split live in `src/server/weatherServer.ts`,
reached transitively — do no I/O (`LocationStore`, still constructed by the entry,
resolves its path and touches nothing until a read or write) and `Cache` timers
already run throughout the suite.
Note that `import 'dotenv/config'` (`src/index.ts:9`) means the import **does**
load the repo's own `.env` ([G26]), so nothing such a test asserts may depend on
a key or on `ENABLED_TOOLS`.

**Verify:** `tests/unit/tool-name-parity.test.ts` no longer imports the entry, so
it now verifies the **residue** rather than the four points: delete its two
`ANALYTICS_*` pins and run it CI-shaped (`HOME=$(mktemp -d)
DOTENV_CONFIG_PATH=/nonexistent npx vitest run <file>`) — the suite stays green
and `analytics-salt` appears under the temp `HOME`, which is the whole point (the
pin's absence is invisible to the assertions and visible only on the filesystem).
Measured 2026-09-09: 64 bytes, mode 0600. For the four points themselves there is
no live example left — nothing imports the entry.

**Evidence:** 2026-09-01 (`a4252ca`, tool-name-single-source T3). Until that
commit **no test imported `src/index.ts` at all**, so the trap had never been
hit — the implementation plan found it by reading the module rather than by
failing, and pre-cleared the mock set. With the four points above the import is
inert: `main()` ran to completion and stderr carried no `Fatal error in main()`.
The home-directory half of that claim was wrong as first written.
`~/.weather-mcp/{locations.json,analytics-salt}` were byte-identical on the dev
machine **only because the repo `.env` was loaded** and its `ANALYTICS_ENDPOINT`
tripped the fail-safe return ahead of the salt call. Run CI-shaped — no `.env`,
temp `HOME` — the test created `analytics-salt` (64 bytes, mode 0600) on every
run until the hoisted `ANALYTICS_SALT` of point 2 landed (diff-review copilot
DR-1, 2026-09-01).

**Status:** active, **narrowed 2026-09-09** (issue-95). The relocation this
entry's Status once rejected has shipped, as `src/server/weatherServer.ts` — and
the trigger it named was the wrong one. It said *revisit if a second test needs a
second symbol from this file*; what actually forced it was a second **transport**,
which needs a `Server` the caller connects. The entry is **not** retired: the rule
about the entry is still true of the entry, and it is the reason nothing may import
it. Related: [G21] (why point 3 is not optional), [G26] (the `.env` the entry
loads — still exactly one importer), [G37] (a driver that constructs services and
never exits), [G31] (the new directory this created).

---

## G62 — A lock written as `not.toContain(<vocabulary word>)` breaks the moment that vocabulary is rendered anywhere else in the report

**Trigger:** writing or reading a test that asserts a rung name, category word
or tier label is *absent* from rendered output as a proxy for some other
property — "no 0.0 m day is rendered" pinned as `not.toContain('Calm (glassy)')`.

**Rule:** assert the construct, not the vocabulary. The property "no zero
forecast day" is `not.toContain('0.0m (0.0ft)')`; the property "no glassy
band" is a match anchored on the line that would carry it (`Max Wave Height:
… (Calm (glassy))`). A bare negative on a word that belongs to a published
scale is a lock on the scale's *rendering footprint*, and any later feature
that prints the scale — a legend, a glossary, a key, a `Calm → Phenomenal`
range line — reddens it on a correct build. When you meet such a lock during a
plan, treat it as an F12 trip to decide, not a defect to route around.

**Why:** the proxy and the property agree only while the word has exactly one
render site. The generated marine legend (D4 of the sea-state plan) prints
every rung name in every Open-Meteo report by design, so
`tests/unit/marine-forecast.test.ts:157` went red on the first T2 gate while
the line above it — the real null-guard — stayed green. The plan had
predicted this test would become *trivially true* if the lowest rung was
renamed and accepted that; nobody predicted the legend would make it
*trivially false*. The two ways out cost different things: an unplanned lock
edit (a second F12 trip on a safety-surface plan) or a naming change whose
reasoning had to stand on its own (the merged WMO 0–1 rung became `Calm`,
which it arguably should have been anyway). Either way the run stopped.

**Verify:** `grep -rn "not.toContain('" tests/unit/ | grep -iE "calm|slight|moderate|rough|high|good|unhealthy|safe|caution|extreme"` lists every negative-vocabulary lock; each is a candidate for this trap the next time its scale gains a render site.

**Evidence:** 2026-09-01 (`df5b7a4`, marine-sea-state-taxonomy T2). The
lowest rung was named `Calm (glassy)` at T1; the legend then carried it into
every report and `marine-forecast.test.ts` reddened. Resolved by decision
(rename to `Calm`) rather than by editing the lock; the lock is byte-identical
to `main`.

**The Verify grep now returns this entry's own remedy, which is [G40]'s
2026-09-09 clause applied to it** (2026-09-17, `7c941d4`,
marine-render-parity T5). `tests/unit/marine-render-parity.test.ts` adds two
hits: a comment at `:236` explaining why a rung word is *not* used, and
`not.toContain('Calm or minimal wave activity')` at `:288`. The second is
**not** an instance of this trap — it is the exact full phrase of a retired
render line, which is the "assert the construct, not the vocabulary" form this
entry prescribes, and it cannot be reddened by the legend printing the word
`Calm`. Read the hit before classing it: the base result for this grep was one
marine hit (`marine-forecast.test.ts:157`) and it is now three, differing by
exactly this plan's own additions.

**Status:** active. **Verify line re-run 2026-09-17** (marine-render-parity T3,
before the NOAA path gained the legend): the only pre-existing marine hit was
`marine-forecast.test.ts:157`, on the Open-Meteo **forecast** path, still
trivially true since v1.25.6 — so rendering every rung name in NOAA output
reddened nothing, as the plan predicted. Related: [G41] (a check that cannot
fail / cannot pass — this is a lock that stops meaning what it says), [G29]
(correcting a published table sweeps the doc set; this entry is the test-suite
half of the same sweep), [G40] (a grep that stops proving its claim because of
your own work), [G96] (the construct assertion that is satisfied by the wrong
part of the string — the other way a precise-looking lock tests nothing).
Partly lintable — the Verify grep enumerates candidates; only a human knows
which are proxies.

---

## G63 — Deriving a union type from a table turns every consumer's stale literal comparison into `TS2367` in the same build, one task early

**Trigger:** a plan that introduces a single-source table and derives a union
from it (`SEA_STATE_SCALE` → `SeaStateLevel`, `TOOL_NAMES` → `ToolName`) and
sequences "type the field as the union" in one task and "replace the consumer's
comparisons" in a later one.

**Rule:** the task that narrows the type owns every site that compares the
field against a literal, or the plan sequences the two edits into one commit.
Grep for `=== '` on the field's name before writing the task graph: each hit
is a `TS2367 This comparison appears to be unintentional because the types …
have no overlap` the moment the union lands, and the earlier task cannot
build green without it. This is D2's guarantee doing its job on the first
build rather than a defect — but a task whose acceptance is "0 errors" with
the consumer file untouched is unsatisfiable as written.

**Why:** the exhaustiveness guarantee is symmetric. It fails a *missing* case
(a rung without a tier) and it equally fails an *impossible* case (a
comparison against a value the union no longer contains), and the second one
lives in files the type-introducing task was told not to touch. The marine
plan's T1 was "the table, and everything that derives from it"; T2 was
"render from the table". The handler's `safety.level === 'Calm'` ternary
was T2's to replace, and it was T1's build that broke.

**Verify:** on a branch with the table in place, revert the handler's marker
call to the old ternary and run `npx tsc --noEmit` — two `TS2367` errors at
the `'Calm'` and `'Very Rough'` arms.

**Evidence:** 2026-09-01 (`3a9d230`, marine-sea-state-taxonomy T1). Build
after T1's table edit alone: `src/handlers/marineConditionsHandler.ts(262,23):
error TS2367` and `(265,23)`. The one-line ternary swap moved from T2 into
T1's commit, noted in the commit body.

**Status:** active. Lintable at plan-authoring time — a task list that narrows
a field's type in file A while a later task edits `=== '` sites on that field
in file B is a mechanical grep. Related: [G1] (read the build's own output —
this is the build succeeding at its job), [G51] (widening a type does not make
a value reachable; this is the mirror, narrowing making a comparison
impossible).

## G64 — `publish.yml` runs the live-network integration files, so an upstream refusing GitHub's runner fails the publish after the tag and release page already exist

**Trigger:** a red `publish.yml` whose failing step is `Test`, on a file under
`tests/integration/` that makes live calls (`safety-hazards`, `global-rivers`,
`visualization-lightning`, `almanac`, `error-recovery`), while the local gate
passed on the same commit.

**Rule:** read which step went red before deciding anything. If `Test` failed
and the `Publish to npm` step never ran, nothing is published — confirm with
`npm view @dangahagan/weather-mcp version` — and `gh run rerun <id>` on the
**same run** is the safe recovery: it re-executes the same tag, and the
workflow's `Skip if version already published` guard makes a duplicate
harmless. Do not bump the version and do not `npm publish` by hand. If instead
`Publish to npm` ran, this is [G39]'s territory, not this entry's. Expect to
rerun more than once: an upstream refusing the runner's address range does not
clear in five minutes.

**Why:** the local gate and the CI gate are the same `npm test`, but they run
from different networks. NOAA NWPS answered this machine in 0.26 s while
refusing the GitHub runner (`NOAA API is currently unavailable` →
`falling back to full gauge catalog download (heavy path)`), and the heavy
fallback alone outlasts the 60 s per-test budget. The tag push is the publish
trigger and `gh release create` had already run, so the visible artefacts of a
release existed before the package did — the half-published state `/release`
step 7 warns about.

**Verify:** `gh run view <id> --log-failed | grep -E 'NWPS bounding box query
failed|currently unavailable'` names the upstream; `npm view
@dangahagan/weather-mcp version` still reports the previous version.

**Evidence:** 2026-09-02, v1.25.17 (run `33589180098`). Attempts at 04:00Z and
04:06Z both timed out at `tests/integration/safety-hazards.test.ts:146`
(`should clamp radius to valid range`, a live St. Louis NWPS query) after the
bbox call was refused; the third rerun at ~04:09Z passed and published
`1.25.17` at 04:11:40Z. The release's diff touched neither
`riverConditionsHandler.ts` nor `noaa.ts`.

**Evidence (second occurrence):** 2026-09-18, v1.31.2 (run `35372699372`). The
first attempt failed at `tests/integration/visualization-lightning.test.ts:215`
(`Test timed out in 15000ms`, a live Blitzortung MQTT query for Tokyo); one
`gh run rerun --failed` published `1.31.2` cleanly. Two things make this the
cleanest confirmation of the entry so far: the **CI run on the identical commit
passed** while the publish run failed, minutes apart — so the two gates ran the
same code over different networks and disagreed — and the release's diff
changed **no** file under `tests/integration/` at all. A different upstream and
a different file from the 2026-09-02 case, so the trap is the live-network
files as a class, not NWPS specifically.

**Evidence (third occurrence):** 2026-09-19, v1.31.3 (run `35440419782`). The
first attempt failed at `tests/integration/safety-hazards.test.ts:146` again —
the *same* file, test and 60 s budget as 2026-09-02 — and one
`gh run rerun --failed` published `1.31.3` cleanly. The full-suite gate had
passed **twice locally** on the same tree minutes earlier (150 files, 3,582
tests, once on the branch and once on the merge commit `780c6cd`), and the `CI`
run on that identical commit was green, so for the second release running the
two gates disagreed over nothing but the network. The release's diff touched a
schema literal, a comment, a new unit test and docs: no path whatsoever to
river conditions. **The recurrence rate is now the finding.** Three occurrences
across 17 releases, two of them in the last two days, and the step order is the
same every time — `Test` red, `Skip if version already published` /
`Publish to npm` / `Verify publication` all **skipped**, `npm view` still on the
previous version. That the recovery is reliable is not an argument for leaving
it: every occurrence spends a release's tag and release page before the package
exists.

**Status:** active, **extended 2026-09-19 (third occurrence)**. The structural fix — running the live-network files in a
separate non-blocking job, or excluding them from the publish gate — is a
`publish.yml` change, not a test change; still not planned, and now carrying three occurrences (one of them twice-repeated) against it. Related: [G39] (red
*after* a successful publish — the opposite half), [G9] (live smoke tests
classify transport failures and skip; the river integration file does not,
which is why a refusal becomes a timeout instead of a skip).

---

## G65 — The mutation set comes from the design's *rejected alternatives*, so a clause the design settled below its decision boundary gets no mutation row and no lock

**Trigger:** building the mutation table for a plan whose design plan declares a
**decision boundary** — "this plan settles that the line exists, where it sits
and what it must contain; the exact sentence is the builder's" — and whose
implementation plan then writes the exact sentence out in a "the copy, settled
here" section.

**Rule:** the mutation set is [G32]'s (every rejected implementation) **plus one
row per number or sub-clause the implementation plan settled below the design's
decision boundary**. Those clauses have no rejected alternative to mutate to, so
[G32]'s procedure — grep the design for `**Rejected:` — cannot generate a row for
them, and a `toContain` prefix that stops before the clause locks nothing after
the truncation point. Pin such a line **whole**, not to a prefix.

**Why:** the two mechanisms fail in the same place and neither notices. The
design rejected three ways to count *delivered days* (distinct calendar dates,
`periods.length / 2`, a hard-coded 7), so the mutation table had seven rows and
every one went red. But the hourly line's **middle clause** — `showing
${periods.length} of the ${days * 24} hours requested` — was settled one level
down, in the implementation plan's copy section: the *shown* count, which the
display cap may have bounded, against the *asked* count. No design alternative
existed for it, so no mutation row covered it; and the test contract asserted
only as far as `…of hourly forecast; showing `. Swapping `periods.length` for
`deliveredHours` there — rendering `showing 156 of the 168 hours requested` at
`detail="standard"`, where 48 hours were actually shown — passed **all eight
contracts** on a fully mutation-checked, live-verified branch. The wrong number
is beside the right one in the same sentence, which is exactly the internally
contradictory rendering [G11] exists for.

The prefix assertion is what makes it invisible rather than merely uncovered: it
reads as a lock on the line and is a lock on the line's opening. A plan that
prescribes the sentence and a test that pins its first half look like belt and
braces and are one belt.

**Verify:** for every contract asserting a rendered line, check the assertion
reaches the line's **end** — the closing `.*` or the final token — and not merely
a distinctive prefix. Then, for each interpolated expression in that line, mutate
it to the nearest in-scope variable of the same type and confirm a contract goes
red. `${periods.length}` beside an in-scope `deliveredHours` is the shape.

**Evidence:** 2026-09-02 (`d65ef25`, noaa-forecast-horizon-disclosure T2). Found
by the orchestrator reading the returned test file against the implementation
plan's copy section, **after** the subagent's seven-row mutation table had come
back fully red and been reported as complete. Contracts 5 and 6 were tightened to
pin the line whole (`showing 24 / 48 / 156 of the 168 hours requested`), and the
new mutation then reddened exactly those two.

**Second instance, 2026-09-02** (diff-review copilot F2 → triage `fix now`): the
same shape one level lower — a lock that stops short on the *boundary* rather
than on the *clause*. The hourly guard `deliveredHours < days * 24` had its
`<` → `<=` mutation stay green, because no fixture sat on the equality: F-H is
156 hours at `days` 6 and 7, F-H2 is 150 at `days` 7, all strictly off the
boundary. The daily guard's boundary *was* covered (F-A, 7 daytime periods at
`days` 7), so the two guards were locked asymmetrically and only the daily
mutation went red. A `<=` regression would have rendered `showing 48 of the 144
hours requested` over a response delivering all 144 — a false shortfall
disclosure, [G11] again. Fixed by F-H3 (144 hours at `days` 6, all three detail
levels, asserting no `*NOAA publishes ` and the *un*-reworded cap remedy); the
`<=` mutation then reddened F-H3 and nothing else, which is the proof the older
fixtures were degenerate along that axis. **The generalisation:** a comparison
operator's mutation set needs a fixture *on* the boundary, not merely either
side of it, and having one on one guard says nothing about its twin.

**Status:** active. Related: [G32] (the rejected-alternative set — this entry is
the gap *beside* it, for behaviour the design deliberately did not settle),
[G45] (a mutation that cannot reach its layer; here it reaches the layer and no
assertion looks at the bytes it changed), [G13] (a fixture that cannot
discriminate — here the fixture can and the assertion does not), [G11] (a number
contradicting the words beside it). Partly lintable — "a `toContain` on a
rendered line that stops before the line's terminator" is a mechanical grep once
the terminator convention is fixed; deciding which prefixes are deliberate is not.

---

## G66 — `npm audit fix` reports "fix available" and then changes nothing, because the fixed version is inside npm's `min-release-age` cooldown

**Trigger:** clearing an `npm audit` advisory during a release pre-flight — most
sharply when a diff-triage deferred one here with "try `npm audit fix`, confirm
the lockfile change, land it as `chore:`".

**Rule:** `npm audit fix` making **no change to `package-lock.json`** is not
evidence that no fix exists. Before concluding anything, read the fixed version's
publish date against the cooldown:

```bash
npm config get min-release-age          # 7 on this machine
npm view <pkg> time | tail -3           # when the patched version was published
```

A patched version younger than that window is invisible to resolution, so `npm
audit fix` runs, prints the same advisory it started with, exits 1, and leaves the
tree byte-identical. Nothing in its output mentions the cooldown. **Record the
advisory as accepted with the date the cooldown clears** and take the bump in a
later `chore:` commit; do **not** reach for `--min-release-age=0`, which switches
off the guard that exists to catch a freshly published compromised package — the
exact risk profile of a package three days old.

**Why:** observed cutting v1.25.18 on 2026-09-02. `npm audit` reported one
moderate in `qs` 6.15.3 (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g) reached as
`@modelcontextprotocol/sdk` → `express@5.2.1` → `body-parser@2.3.0`, and said
`fix available via npm audit fix`. The fix genuinely existed and genuinely
satisfied every range in the chain — `express` wants `qs ^6.14.0`, `body-parser`
wants `^6.15.2`, and `qs@6.16.0` satisfies both — but it was published
2026-08-29T23:50Z, 3.5 days before the release, against `min-release-age = 7`.
`npm audit fix --package-lock-only` therefore produced an empty `git diff
package-lock.json`. The failure reads exactly like an unfixable transitive pin,
which invites the two wrong reactions: forcing a resolution override into
`package.json`, or forcing the cooldown off.

This is the same shape as the retired [G55]'s disproven half, and the distinction
is the point: `min-release-age` gates **install and pack resolution, not `view`**.
`npm view qs versions` lists 6.16.0 while `npm audit fix` will not install it, so
the registry read and the resolver disagree by design, and a session that checks
only one of them concludes the wrong thing. [G51]-family — a filtered read
reported as an absence — except that here it is a filtered *resolution* reported
as "no fix possible".

The second half of the rule is the one that matters at release time: an advisory
knowingly carried needs a **written disposition in the release notes**, not a note
in a terminal. v1.25.18 carries a `### Security` bullet naming the advisory, the
dependency path, why it is unreachable (the server constructs
`StdioServerTransport` and nothing under `src/` imports express, so `qs` is never
loaded), and the date the bump becomes possible. Reachability is checked, not
asserted: `grep -rn 'StreamableHTTP\|express\|SSEServerTransport' src/` returning
only prose hits is the evidence.

**Verify:** whenever `npm audit fix` leaves the lockfile unchanged, print
`npm config get min-release-age` and the patched version's publish time in the
same breath. If the gap explains it, the disposition is "accepted until
<date>" in the release notes plus a follow-up `chore:` — not a resolution
override, and not silence.

---

## G67 — A fixture captured from a live feed expires, because the consumer under test has a recency guard

**Trigger:** capturing a real upstream response into `tests/fixtures/` when any
code path that reads it rejects or re-labels data by **age** — a staleness
cutoff, an "observed N minutes ago" line, a freshest-wins selector, a
not-current sentinel.

**Rule:** freeze the clock. Pin `vi.setSystemTime` to a moment just after the
timestamps inside the fixture, in the same file that loads it. The fixture's own
`dateTime` values are now part of its contract, so say in a comment which
timestamp the frozen clock is anchored to.

**Why:** the two halves of the practice fight each other. This repo captures
fixtures from real responses **on purpose** — the whole point of
`ea-station-L2402.json` is that the `string | object` shape trap is real and not
imagined — but a captured response carries the capture moment inside it. A
6-hour staleness cutoff plus a fixture stamped at capture time yields a test
that is green on the day it is written, green all through the review, and red
forever after, with a failure message about river levels that says nothing about
clocks. Nobody is watching the suite six hours later, so it lands.

The trap scales with how *good* the fixture is: the more faithfully a capture
reproduces a live response, the more live state it smuggles in.

**Verify:** two acceptable fixes, and the check must allow both — freeze the
clock (`setSystemTime`) **or** inject one (pass an explicit `now` into the pure
function, which is the better shape where the signature allows it):

```bash
grep -rl 'tests/fixtures' tests/unit \
  | xargs grep -LE 'setSystemTime|new Date\(' \
  | xargs -r grep -lE 'dateTime|validTime|observedAt'
```

Then confirm by hand that each hit actually exercises an age-sensitive path —
a fixture consumer that reads no timestamp needs neither fix. Run 2026-09-02
over the whole suite: **no outstanding instances.** `ea-gauges.test.ts` injects
`now` explicitly, and `nwps-gauge-shape.test.ts` contains no timestamp at all.

**Evidence:** 2026-09-02 (`fdc35ed`, UK EA gauges T8). `ea-station-L2402.json`
carries two readings stamped `2026-09-02T19:15:00Z`, and `selectStageMeasure`
rejects anything older than 6 hours (`EA_STAGE_STALE_CUTOFF_MINUTES = 360`).
Caught during the task, not after, and fixed by pinning the clock to
`2026-09-02T19:20:00Z`. Had it shipped, the file would have started failing the
same evening.

**Status:** active. Lint candidate — a rule flagging a `tests/fixtures` read in a
file that neither calls `setSystemTime` nor injects a clock. Related: [G48] (the
other way a fixture describes a world that does not exist).

---

## G68 — A safety refusal inside a pure function is only real if the render site honours it

**Trigger:** a pure helper returns `null`/`undefined` to mean **"this comparison
would be unsafe"** rather than "no data", and the caller renders the inputs that
comparison was about.

**Rule:** gate the **whole block** on the refusal, not just the sentence the
helper would have produced. If the function declines to compare A against B,
the renderer must not print B beside A either. Find every render site of every
guard, not just the guard.

**Why:** refusing to state a conclusion while still printing both operands does
not withhold the conclusion — it delegates it. The reader is less equipped to
make the comparison than the code was, and has none of the context that made it
unsafe, so the refusal actively misleads: the numbers look adjacent *because*
they are meant to be compared, and the missing verdict reads as "unremarkable"
rather than "not applicable".

It also passes every test. The helper's own unit tests assert it returns `null`
and are green; the handler's tests assert the verdict line is absent and are
green; and the defect lives entirely in the two lines that are still printed.

**Verify:** for each pure guard returning a refusal, grep its call sites and
check what else is emitted inside the same `if`. The block should be all-or-
nothing.

**Evidence:** 2026-09-02 (`735fe81`, UK EA gauges T7). `bandRiverLevel` refuses
to band a measure whose qualifier is not `Stage`, because `stageScale` describes
the station's Stage measure — banding the River Tweed at Berwick's `Tidal Level`
reading against it renders a false "above typical range" on a river-safety
surface. The refusal worked. The renderer printed the typical range anyway, so a
`4.09 ft` level sat directly above a range it does not belong to, with no verdict
between them. Found by reading live output at a 5 km radius around Berwick;
no assertion could have reached it. Fixed by gating the range on the band.

**Status:** active. Related: [G11] (reading the output is what exposes it),
[G8] (a defensive limit producing a misleading render), [G53].

---

## G69 — Band after the unit conversion, because a rendered threshold is a display value too

**Trigger:** comparing a value against a threshold when **either** is converted
before it is printed — metres to feet, °C to °F, m³/s to ft³/s — and both the
value and the threshold appear in the output.

**Rule:** convert first, round second, compare third, using the caller's own
unit preferences for all three numbers. Pass `prefs` into the band function
rather than banding in storage units and rendering in display units.

**Why:** `displayValue`'s existing discipline says to band on the number the
reader sees, and it is easy to satisfy that for the *reading* while leaving the
*threshold* raw — the threshold feels like upstream metadata rather than
rendered output, and rounding it feels like corrupting a published figure. But
the moment the renderer prints the range, the range is a display value as well,
and a conversion between storage and display collapses pairs that were distinct
in storage. A level of `2.2475 m` against a `typicalRangeHigh` of `2.247 m`
prints as `7.37 ft` and `7.37 ft` under imperial and `2.25 m` and `2.25 m` under
metric, while a raw comparison says *above the published typical range* — a
contradiction directly under two identical numbers, in **both** unit systems.

The single-unit case hides this: as long as nothing is converted, banding on the
stored value and rounding only for display usually agree, so the habit survives
until a converting path arrives.

**Verify:** for each band/threshold pair, check whether the renderer prints the
threshold. If it does, confirm the band function receives the same `prefs` the
renderer uses. `bandRiverLevel` in `src/utils/eaGauges.ts` is the reference
shape; its lock is the display-space test in `tests/unit/ea-gauges.test.ts`.

**Evidence:** 2026-09-02 (`00953cf`, UK EA gauges T3), caught in orchestrator
review of the returned diff rather than by a test — the sub-agent's reasoning
("rounding them would move the published range") is correct in isolation and
wrong once the range is rendered.

**Status:** active. Related: [G36] (the binary-halves trap on the same seam),
[G11], and `src/utils/displayBanding.ts`'s own doc comment, which this extends
rather than contradicts.

---

## G70 — A mock applied to the wrong seam is inert, so the test silently becomes a live-network test that passes while the network is fast

**Trigger:** `vi.spyOn(service as any, '<privateMethod>')` where the method under
test reaches the network by some *other* route — `this.client.get`, a second
axios instance, a module-level helper — rather than through the mocked one.

**Rule:** mock the seam the method under test actually calls, and make the mock
supply the shape that method **inspects**, not the shape a neighbouring method
returns. Confirm by mutation: break the branch the test names and check it goes
red. A status test that cannot go red when the status flips is testing the
network, not the code.

**Why:** an inert mock fails open. Nothing errors, nothing warns, the spy
records zero calls that nobody asserts on, and the real request underneath
usually succeeds — so the test is green for years. What it is actually
measuring is round-trip latency against the test timeout, so it converts into
an intermittent failure the first time the network, the machine, or a parallel
suite is slow, and the failure message names the timeout rather than the mock.
The wrong-seam mock also means the branch the test claims to cover has never
been executed once.

The tell is a `vi.spyOn` on a private method whose name does not appear in the
method under test. Grep it before trusting the mock.

**Verify:** for each `vi.spyOn(x as any, 'm')`, grep the method under test for
`m`; if it does not call it, the mock is inert. **Match the generic form** —
these methods are called as `this.makeRequest<T>(...)`, so a `this\.m\(`
pattern reports zero call sites for a method with five, and the sweep looks
alarming for the wrong reason. Use `this\.m[<(]`. Run 2026-09-02 across
`tests/`: the four spied methods (`makeRequest`, `makeRequestToEnsemble`,
`makeRequestToFlood`, `makeRequestToForecast`) all have real call sites, and
all three `checkServiceStatus` tests now mock `client.get` — **no inert mocks
remain.** Mechanically checkable, so a strong lint candidate.

**Evidence:** 2026-09-02 (`f9f6771`). Two tests in
`tests/integration/error-recovery.test.ts` mocked `makeRequest` while
`OpenMeteoService.checkServiceStatus` calls `this.client.get('/archive', …)`
directly, so both made a real archive-API call inside a 5-second test timeout.
They failed identically on `main` and on the feature branch while the live API
was demonstrably healthy — HTTP 200 in ~0.45 s on three consecutive probes, and
`checkServiceStatus()` itself returning `operational: true` in 474 ms. **The
answer was already written in the file:** the passing sibling test sitting
between the two failures carried the comment *"Mock the client.get method (not
makeRequest) since checkServiceStatus uses it directly"* — someone hit this
once, fixed the one test in front of them, and left its neighbours alone.

**The return-value twin, 2026-09-03** (`5bded01`, critical-alert-banner T5). The seam can be
right and the mock still inert, when the mock **ignores the parameter under test**. The summary's
job is to render the banner exactly once, so its lock is a count of occurrences, and the
mutation that must redden it is threading the flag down into a sub-handler. The sub-handlers were
mocked at the correct module seam — but with `mockResolvedValue`, a fixed string. Threading the
flag therefore changed *nothing observable*: the count stayed 1, the mutation stayed green, and
the effect-level assertion the whole task exists for was unfalsifiable. Only the argument-count
tests beside it went red. Fixed by making each mock honour the flag the way the real handler does
(`args[8]`/`args[7]` → prepend the banner); both leak mutations then redden the count itself.
**A mock's return value is part of the seam.** If the thing under test can vary an input to the
mock, the mock must vary its output accordingly, or every assertion downstream of it is a
tautology.

**Status:** active, **extended 2026-09-03**. Lint candidate (see Verify). Related: [G45] (the mutation
check that exposes it), [G21] (the other way a mock is not the thing you think
it is), [G13] (a fixture that cannot discriminate — this is its mock-shaped
sibling), and the project's determinism rule — anything mockable is mocked.

---

## G71 — `publish.yml` gates the npm publish on the *whole* suite, so a third-party outage fails a release that CI just certified green

**Trigger:** pushing a `vX.Y.Z` tag and finding `publish.yml` red at the **Test**
step, on a commit whose CI run passed.

**Rule:** a red publish run is not evidence the diff is bad. Read *which step*
failed, then check what that step actually runs. `ci.yml:33` runs
`npx vitest run tests/unit` — 110 deterministic files. `publish.yml:54` runs
`npm test`, which is bare `vitest run` and therefore includes
`tests/integration/`, where several files open real network connections. The two
gates are **not the same gate**, so "CI is green" says nothing about whether the
publish will pass. Before reacting, confirm from the registry whether anything
published ([G39], [G55]): if `latest` is still the previous version, nothing
shipped and re-running the failed job is the correct recovery — `publish.yml`
carries a `Skip if version already published` step, so a re-run after a *real*
publish is refused rather than duplicating one.

**Why:** the publish is gated on a GitHub runner completing a live MQTT
connection to a third-party broker — `mqtt://blitzortung.ha.sed.pl:1883` — and
receiving traffic inside a 15-second vitest timeout. Nothing about that is under
this project's control, it is unrelated to whatever the release changes, and it
gets a veto over shipping. The asymmetry is the trap: the workflow that decides
whether code is correct is strictly weaker than the workflow that decides
whether it ships, so the stronger gate is the one nobody watches until a release
stalls on it.

**Verify:** `grep -n 'run:' .github/workflows/ci.yml .github/workflows/publish.yml`
and compare the two Test steps. They differ.

**Evidence:** v1.26.0, 2026-09-03. Run 33698838722 failed at **Test** with two
timeouts in `tests/integration/visualization-lightning.test.ts` (`:145`, `:168`),
both `Error: Test timed out in 15000ms` after
`Connecting to Blitzortung MQTT broker`. The CI run on the identical commit
(`d2b0242`, 33698801825) had passed minutes earlier because it runs unit tests
only. The merge commit's tree hash was byte-identical to the already-green branch
tip (`30781b6d`), and `git diff v1.25.18..main` over
`visualization-lightning.test.ts`, `lightningHandler.ts` and `blitzortung.ts` was
**empty** — the release did not touch the lightning path at all. Locally the same
suite ran green twice and red twice against that same tree. `npm view` confirmed
`latest` was still `1.25.18`, so nothing had published; re-running the failed job
alone published cleanly in 3m20s with no code change. `publish.yml` has failed
this way before — v1.25.12, 2026-08-29.

**Status:** active. The obvious fix — gate the publish on `tests/unit` like CI
does, or mark the live-network integration files as non-gating — was deliberately
**not** taken during the v1.26.0 release, because changing the release machinery
mid-release is the kind of scope expansion `/release` forbids. Related: [G39] and
the retired [G55] (both about reading a red publish run correctly, in the
opposite direction — a *successful* publish reported red), and the standing
flaky-live-network note in the test suite.

---

## G72 — An upstream can answer 200 with well-formed, correctly-shaped content it has stopped updating, and every check this project runs will pass

**Trigger:** adopting an upstream endpoint as a live source, or re-probing one a
plan already named — especially one an earlier plan, a roadmap line, or a
deferral note said was the right endpoint.

**Rule:** **sweep the whole key space, not a sample, and compare against a
sibling endpoint on the same host as a positive control.** `last-modified` from
the origin with a cache-buster is the cheap version:

**But check the cache-buster does not suppress the header you came to read** —
on some hosts it does, and then the check reports the failure it was built to
detect. `api.met.no` sends `last-modified` on a plain request and **omits it
entirely** when an unknown query parameter is appended, so the `?cb=$RANDOM`
form below reads `<none>` at every key and looks exactly like a frozen feed.
Take one reading with the buster and one without before trusting either: if
they disagree about whether the header exists at all, the buster is the
variable, not the upstream. Where the buster has to be dropped, the sibling
control carries the whole check, so it stops being optional.

```bash
curl -s -I "https://host/path/<key>.json?cb=$RANDOM" | grep -i '^last-modified'
```

Run it for **every** key, not two, and run it once for a sibling endpoint you
expect to be current. A stale reading on one key is ambiguous; a stale reading
on every key beside a current sibling is conclusive. Rule out the benign
readings explicitly — a CDN serving from cache reads the same as an origin that
has stopped, which is why the cache-buster and the `x-cache` header matter.

**Why:** this is invisible to everything else. The response is HTTP 200. It
parses. Its shape is exactly what the documentation says. A schema check passes,
a null-guard passes, a type narrows cleanly, and a unit suite that mocks the
transport cannot see it at all. [G47] is the fast sibling — a rate-limited
upstream returning a legitimate-looking zero — and its control is a
known-non-zero count in the same batch. This one is slower and its control is
different: the count is fine, the *shape* is fine, and only the **clock**
disagrees. Nothing in a gate reads a clock.

The consequence on safety data is the project's worst output. A frozen warning
endpoint renders as "no warnings in force", which is a fabricated all-clear
assembled from a source that stopped talking months ago.

**Verify:** sweep all keys and one sibling:

```bash
for o in $(all keys); do curl -s -I "https://www.jma.go.jp/bosai/warning/data/warning/${o}.json?cb=$RANDOM" \
  | grep -i '^last-modified'; done
curl -s -I "https://www.jma.go.jp/bosai/forecast/data/overview_forecast/130000.json?cb=$RANDOM" | grep -i '^last-modified'
```

**Evidence:** 2026-09-03, JMA. `bosai/warning/data/warning/<office>.json` is the
endpoint the international-coverage roadmap, the v1.24.0 Japan deferral and two
earlier design notes all named, and **three separate probes across two sessions
accepted it** — it answers 200 and parses cleanly. A sweep of all **58** offices
found none updated since May 2026 (17 at 28 May, 24 at 27 May, 9 at 26 May, 8
between 21–25 May); the aggregate `warning/data/warning/map.json` was frozen at
28 May too. A cache-busted request returned the same `last-modified` from
AmazonS3/CloudFront with `x-cache: RefreshHit`, ruling out a stale cache, and
the sibling `forecast/data/overview_forecast/130000.json` on the same host was
current. Japan was not quiet: over the same seven days the official XML feed
carried **6,734 warning bulletins**. Re-verified during `/run-plan` T13 —
6 of 6 sampled offices still reported 26–28 May while the sibling reported that
day. The feature was rebuilt against `data.jma.go.jp/developer/xml/feed/` and
ships a per-request cross-check, because a check that the answer actually covers
the point asked about is the only mechanism that catches this class in the
field.

**Status:** active. Related: [G47] (the fast sibling — a throttled upstream
returning a plausible zero; same "well-formed body, wrong answer" family, but
its control is a count and this one's is a clock), [G4] (never trust the HTTP
200 alone), [G11] (read the real thing), [G46] (do not inherit a plan's claim
about an upstream — re-probe it). Partly lintable: a sweep helper that refuses
to report unless a named sibling control is current would close it mechanically.

---

## G73 — The docs task runs before the diff-review fixes land, so the shipped docs describe the pre-fix behaviour and no gate reads prose

**Trigger:** a `/run-plan` whose docs task committed before `/diff-review`, and
whose triage then landed a **fix-now** that changed a *rendered* behaviour —
a new output state, a changed branch condition, a widened or narrowed guard.

**Rule:** at `/release` step 4b, walk the fix commits that landed **after** the
docs commit and check each one against the user doc for its area. Get the
boundary from git, not from memory:

```bash
DOCS=$(git log --format=%H --diff-filter=M -1 <last-release-tag>..HEAD -- docs/ README.md)
git log --oneline "$DOCS"..HEAD --  src/
```

Anything in that list that changed what the tool *renders* is a docs candidate.

**Why:** the pipeline's order guarantees it. The docs task is inside
`/run-plan`; `/diff-review` runs after `/run-plan` finishes; its fixes commit
onto the same branch with the gate re-run — and the gate is build, tests and
`check-doc-versions.sh`. All three pass. `check-doc-versions.sh` reads
**version strings, tool counts and test counts**; it has no opinion about
whether a sentence of prose is still true, and there is no check anywhere that
does. The diff review reads the diff against the plan's contracts, not against
the docs. So a behavioural fix landing after the docs commit is structurally
invisible until a human reads the page.

Observed in v1.27.0: `e29dc82` added a **fifth** Japanese not-an-all-clear
state — a caveat already casting doubt on the feed turns an empty area into
*unconfirmed* rather than clear — three commits after `9515bcd` wrote
`docs/TOOLS.md`. The page shipped naming **three** of five, on the alerts
surface, through a green gate, a three-leg diff review and a full test drive.
Caught only by `/release` step 4b's per-bullet docs walk.

The same shape hits the architecture map, and worse, because it has no
changelog bullet to hang off: `CLAUDE.md` still described the alerts cascade as
`… national CAP IN-PH-ID / Google fallback` after a whole branch was inserted
ahead of Google. Related: [G31] (a new module under `src/` has no changelog
bullet, so the architecture map must be named explicitly), [G35] (the release
tooling passes its own check over text nothing read).

**Verify:** the boundary command above lists a non-empty set on any branch whose
review landed a render fix, and each entry resolves to a doc page or an explicit
"none".

---

## G74 — An item can hold more than one row in the roadmap, and only one of them gets amended

**Trigger:** `/release` step 8, or any read of `<roadmap>` status — especially
for an item that was slotted, then **corrected** (weight, base, or route) in a
later pass. The correction edits one row; a second row for the same item keeps
the superseded text and the old status marker.

**Rule:** before ticking a shipped item, count its rows. Match on the item's
title, not on the plan-doc link — a stale row may point at the same plan:

```bash
grep -c '<item title>' <roadmap>          # expect 1 detail row + 1 run-order row
grep -n 'plan-<name>.md' <roadmap>
```

Tick, strike and re-point **every** hit. Where a duplicate is the superseded
copy, strike it and say so in place rather than deleting it — the double-entry
is itself the finding, and deleting the row deletes the evidence that status
was readable two ways.

**Why:** the roadmap is the single source of truth for feature-idea status, and
that only holds if an item has one row. Observed in v1.27.1: *Two JMA service
residuals from the japan-alerts diff review* was written into **Hardening &
fixes twice on 2026-09-03** — once when `/prioritize` slotted it, and the copy
that `/quick-fix` later amended when it refused both items and moved the weight
`quick-fix → standard` and the base `feat/japan-alerts@841f206 → main`. Only the
amended copy carried the correction. For the rest of that day the file answered
the same question two ways: one row said `standard`/`main`, the other said
`quick-fix`/a branch that had already merged. Both said 📝 **planned** after the
work shipped, until `/release` step 8 struck them.

Nothing in the pipeline can catch this. `backlog-collide.sh` reads the plan
files, not the roadmap's row count; `check-doc-versions.sh` never opens
`<roadmap>` — it lives in the internal repo; and `/prioritize`'s legality check
reads rows as the population it is checking, so a duplicated row is two
population members, not an error. A status query that happens to land on the
stale copy is wrong with no signal that it is.

Related: [G35] (the release tooling passes its own check over text nothing
read), [G73] (a doc that describes the pre-fix behaviour through a green gate).
The family is the same: a written claim that no gate reads.

**Also surfaced in the same release, not filed separately:** `/run-plan`
archived the whole plan set but left the design plan stamped `Status: SETTLED`
rather than `IMPLEMENTED`. `/release` step 8 asks for exactly that confirmation,
which is what caught it — the stamp is the archive's only marker of a plan that
actually shipped, and an archived `SETTLED` plan is indistinguishable from one
promoted and then abandoned.

**Verify:** `grep -c` on a shipped item's title in `<roadmap>` returns the
expected row count, and every returned row carries the same status marker.

---

## G75 — ICU puts a narrow no-break space before AM/PM in some zones and an ordinary space in others, from the same call

**Trigger:** rendering a time through `src/utils/timezone.ts` (or any
`toLocaleString`/Luxon format carrying an AM/PM marker) and then asserting on,
grepping, diffing, or byte-comparing the result.

**Rule:** normalise the separator before the string reaches an assertion or a
committed output. `formatExpiry` in `src/utils/criticalAlert.ts` does
`.replace(/[\u202F\u00A0]/g, ' ')` for exactly this reason. Never write the
expectation by copying a rendered string out of a terminal — the two characters
are indistinguishable there.

**Why:** the same `formatInTimezone(iso, zone, 'full')` call renders
`8:15\u202fPM UTC` for the `UTC` zone and `4:15 PM EDT` for `America/Detroit`.
U+202F (narrow no-break space) and U+0020 look identical on screen and in a diff,
so a `toContain` written against one form fails against the other with a message
showing two apparently identical strings — *"expected '…' to contain '…'"* where
the received text visibly contains the expected text. The zone is data, so which
form you get is decided by the caller's coordinates: a test that passes in
Michigan fails at a UTC fallback, and a byte-identity sweep can differ by a
character nobody can see.

The same class covers U+00A0 (no-break space), which some locales use between a
number and its unit.

**Verify:** `node -e "const {DateTime}=require('luxon'); for (const z of ['UTC','America/Detroit']) console.log(z, [...DateTime.fromISO('2026-09-03T20:15:00Z',{zone:z}).toLocaleString(DateTime.DATETIME_FULL)].map(c=>c.codePointAt(0).toString(16)).join(' '))"` — the UTC row carries `202f` where the Detroit row carries `20`. More generally, pipe any suspect rendered string through `cat -A` or `[...s].map(c=>c.codePointAt(0).toString(16))` before writing an expectation against it.

**Evidence:** 2026-09-03 (`35c69bc`, critical-alert-banner T1). Two
`formatCriticalAlertBanner` tests failed against a banner whose text was visibly
correct; the axis was the zone, not the format. Both were UTC-fallback cases and
both passed for `America/Detroit`. Resolved by normalising inside `formatExpiry`
rather than by encoding U+202F in the expectations, because whitespace that
varies by the caller's coordinates is a latent trap for every later assertion,
grep and byte-identity sweep over the same output.

**Status:** active. Related: [G10] (byte-identity sweeps — an invisible
character is the purest form of a diff you cannot read), [G11] (read the
rendered output; this is the case where reading it is not enough and you have to
read its code points). Lintable in the narrow form: a grep for `\u202F` in
`tests/` expectations, or a check that no rendered-time assertion contains a bare
`' PM'`/`' AM'` without normalisation upstream.

---

## G76 — `api.weather.gov/alerts` serves ~7 days regardless of the `start`/`end` window, so a zero over a long span is retention, not absence

**Trigger:** querying the NWS **archive** endpoint (`/alerts?event=…&start=…&end=…`,
as opposed to `/alerts/active`) to establish that something does or does not
happen — a calibration histogram, a coverage claim, "this event type never
carries severity X".

**Rule:** measure the **span actually returned**, not the span requested, and
say so beside any zero. `props.map(p => p.sent).sort()` gives the real window in
two lines. A zero row is only evidence of absence if a known-frequent control
event returns rows spanning the whole query.

**Why:** the endpoint accepts a 365-day window without complaint, returns HTTP
200 and a well-formed `FeatureCollection`, and quietly serves only the recent
slice it retains. Nothing in the response says the window was truncated. So
"0 Hurricane Warnings over 12 months" and "Hurricane Warnings do not exist" are
the same bytes, and the wrong reading is the natural one — you asked for a year
and got an answer.

This is [G47]'s failure with a different mechanism: there the upstream is
rate-limited and the well-formed body parses to a legitimate-looking zero; here
the upstream is perfectly healthy and the *window* is the lie. G47's control
(is a known-common type present?) does **not** catch it, because the retained
slice contains plenty of common types. The control has to be a **span**
measurement, not a presence check.

**Verify:** query a known-frequent event over 365 days and compute the span of
the returned `sent` timestamps:
`https://api.weather.gov/alerts?event=Tornado%20Warning&start=<now-365d>&end=<now>&limit=500`
— 2026-09-03 this returned 159 rows spanning **7.0 days** (2026-08-27 to
2026-09-03).

**Evidence:** 2026-09-03 (critical-alert-banner T7). The calibration needed to
confirm that Tornado, Tsunami, Extreme Wind and Hurricane Warnings fire. Tornado
Warning came back 136/159 firing; the other three came back `0 rows` over 12- and
24-month windows and would have been recorded as "confirmed absent from the feed"
or, worse, as evidence about the gate. The span control showed the archive holds
one week, so those three are **unverified rather than confirmed** — recorded that
way in the design plan's Verification section instead of being glossed.

**Status:** active. Related: [G47] (the same "zero that looks like data", where
the cause is rate limiting and the control is a presence check — this entry is
the one that control misses), [G10] (prove the measurement is not vacuous),
[G28] (a probe that fails and reports a clean negative). Lintable: a helper that
refuses to report a zero without printing the returned span would close it.

---

## G77 — NWS re-issues a cancelled warning under the same event name, so an event-type filter sees a tornado warning that is over

**Trigger:** classifying NWS alerts by `event` name, or writing any gate,
histogram or coverage claim over `api.weather.gov` alert properties.

**Rule:** the CAP quadruple, not the event name, says whether an alert is live.
A cancellation arrives as the **same `event` string** with
`severity: Minor`, `urgency: Past`, `certainty: Observed`, `response: AllClear`.
Any gate meant to fire on live hazards must test `urgency` (or `messageType`),
and **widening or removing the urgency term un-suppresses every cancellation** —
that is a regression even though it reads like a loosening.

**Why:** "Tornado Warning" is not a state, it is a product name, and NWS uses it
for the cancellation as well as the warning. A filter written as
`event === 'Tornado Warning'` therefore selects a set in which some members are
over. On a safety surface the consequence is the mirror image of this project's
usual failure: not a fabricated all-clear, but a **fabricated alarm** — a banner
announcing a life-threatening tornado warning that was cancelled twenty minutes
ago, which costs the reader's trust in every future banner just as surely.

**Verify:** pull a week of Tornado Warnings from the archive and tally the CAP
axes: 2026-09-03 gave `Extreme/Immediate/Observed/Shelter` ×136 and
`Minor/Past/Observed/AllClear` ×23 across 159 rows. Then confirm the project's
gate rejects the second group — `isCriticalAlert` fires on exactly 136.

**Evidence:** 2026-09-03 (critical-alert-banner T7 calibration). The design
plan's gate excluded these **by accident**: the `urgency ∈ {Immediate}` term was
written to catch imminence, and cancellation-filtering fell out of it unnoticed.
It was found only by asking why 23 of 159 Tornado Warnings did not fire, rather
than by celebrating that 136 did. Recorded because the next person tuning
`DisplayThresholds.criticalAlert` will read `urgencies: ['Immediate']` as a
strictness knob and will not know that relaxing it re-admits cancelled warnings.

**Status:** active. Related: [G4] (never trust the HTTP 200 alone — here the
payload is valid and the *event name* is the misleading part), [G13] (a fixture
that cannot discriminate — a Tornado Warning fixture set with no cancellation in
it cannot see this), [G53] (a claim inheriting edges the heuristic was allowed to
get wrong). Lintable: a test asserting `isCriticalAlert` is false for a
`Minor/Past/Observed/AllClear` record under a firing event name — worth adding.

---

## G78 — A feature whose failure renders nothing still has an error-handling docs surface, and `## Docs impact` will not name it

**Trigger:** shipping anything with a **silent** failure posture — a garnish
section that degrades to nothing, a positive-assertion-only element that omits
itself — or writing a design plan's `## Docs impact` for one.

**Rule:** walk `docs/ERROR_HANDLING.md` for every feature that can fail, not
only for the ones that print something when they do. "It renders nothing" is
itself the thing a reader needs told, and it is a decision worth defending in
prose, not an absence of content.

**Why:** `## Docs impact` is written by asking *what will the user see that is
new*, and the honest answer for a silent failure is "nothing" — so the bullet
never gets written and the page never gets touched. But a reader who asks "what
happens if the alerts lookup fails during a forecast?" gets no answer anywhere,
and the plausible guesses are all wrong: that it errors, that it retries, that
the absence means quiet. The silence is load-bearing and undocumented silence
reads as an oversight rather than a design.

**Verify:** for each new failure path, find the sentence in
`docs/ERROR_HANDLING.md` that a user hitting it would land on. If the answer is
"there is none because nothing renders", that is the finding, not the
justification.

**Evidence:** 2026-09-04, v1.28.0 release, step 4b. The critical-alert banner's
plan set documented the silent-omit posture thoroughly — `docs/TOOLS.md` has a
whole section on why absence is not an all-clear, and `CLAUDE.md` carries it as
a convention — but `docs/ERROR_HANDLING.md`, the page that exists to say what a
user sees when something breaks, said nothing. That page already documents the
lightning feed's in-result ⚪ at length, which is the same class of question with
the opposite answer, so the gap was visible only by walking the page rather than
the changelog. Caught by the release-stage backstop, which is the last reader
who could still fix it cheaply.

**Status:** active. Related: [G73] (the docs task runs before the diff-review
fixes, so shipped prose can describe pre-fix behaviour — same page, different
cause), [G31] (the architecture map's completeness loop, which catches a missing
*module* but not a missing *page*). Lintable: no — nothing mechanical can tell
a deliberate silence from an undocumented one.

---

## G79 — A lock whose expected value is read from a gitignored path passes locally off an untracked artifact and dies on a fresh clone

**Trigger:** a new test whose expected value is a *generated* artifact — a
fingerprint, a golden payload, a captured baseline — that an earlier step of the
same run wrote somewhere convenient, typically `.claude/scratch/`.

**Rule:** **inline the generated literal into the test file.** A test may read a
fixture only from a path the repo actually carries (`tests/fixtures/`). Before
trusting a green run on any test with an external expected value, move the file
aside and re-run: if the suite errors rather than fails, the expected value was
never in the repo.

**Why:** the artifact is real, correct, and provably derived from the right
side — every property the lock needs — and it is still absent everywhere except
the machine that made it. `.claude/` is gitignored wholesale
(`.gitignore:26`, slashless), so the file is invisible to `git status`, survives
every local run, and is simply not there on a clone or in CI. The failure is not
a wrong assertion but an `ENOENT` at import, which takes the **whole suite
file** down before a single assertion runs — so the contract the file was added
to enforce is not weakened, it is entirely absent, and the local green run says
nothing about either.

This is [G10]'s vacuity trap arriving from a new direction. G10 warns about a
baseline taken from the *wrong side*; here the baseline is taken from exactly
the right side (a `git worktree` at `main`, which is the hard part and was done
correctly) and then made unreachable. Provenance and availability are separate
properties and getting the first right does nothing for the second.

**Verify:** `git check-ignore -v <every path a test reads>` — any hit is the
bug. Then `mv` the file aside and re-run the suite; it must still be green.

**Evidence:** 2026-09-08 (`b4e4823`, tools-list-slimming T5). The shape
fingerprint was correctly generated from a `main` worktree and hashed identical
to the branch — then sourced with
`readFileSync(new URL('../../.claude/scratch/fingerprint-from-main.json', …))`.
41/41 green locally, including the CI-shaped `HOME=$(mktemp -d)
DOTENV_CONFIG_PATH=/nonexistent` run, which pins the *environment* and says
nothing about the *filesystem*. With the file moved aside:
`Error: ENOENT … open '.../.claude/scratch/fingerprint-from-main.json'`,
`Test Files 1 failed`. Fixed by inlining the literal.

**Status:** active. Related: [G10] (baseline provenance — the other half of the
same question), [G26] (the repo's own gitignored `.env` making a local run
unrepresentative), [G41] (a check that cannot fail). Lintable: **yes** — a grep
for string literals under `tests/` containing `.claude/` or `../..` outside
`tests/fixtures/` would catch this mechanically.

---

## G80 — The alerts coverage sentence names authorities and mechanisms in one list, and a trim or an insertion silently re-attaches the wrong mechanism

**Trigger:** editing `get_alerts`'s coverage sentence — in
`src/server/weatherServer.ts`'s `TOOL_DEFINITIONS`, in `docs/TOOLS.md` §`get_alerts`, or in a
`CHANGELOG.md` bullet — whether to add a country or to shorten the list.

**Rule:** each authority must sit with **its own** mechanism, and the mechanism
clause must not be able to slide onto a neighbour. Keep the CAP-feed countries
in one bracketed group (`— via their official national CAP feeds — India …, the
Philippines … and Indonesia …`) and every non-CAP authority outside it. After
any edit, read the sentence back and name, for each country, which feed type it
just claimed.

**Why:** the sentence is a mixed list — some entries are authorities (NOAA,
ECCC, MeteoAlarm, JMA), some are authority-plus-mechanism (the three national
CAP feeds) — and English conjunction lets a trailing conjunct inherit the
preceding prepositional phrase for free. Deleting the sub-national matching
narrative leaves `…Indonesia (BMKG) via their official national CAP feeds, and
Japan (JMA)`, which asserts JMA publishes CAP. It does not: JMA publishes the
H27 disaster-prevention XML schema, which is precisely why `src/services/jma.ts`
exists separately from `src/services/nationalCap.ts` and why `src/types/jma.ts`
says "JMA H27 schema, not CAP". The result is a **false coverage claim on the
safety surface**, produced by an edit that removed text rather than adding any,
and no test can see it — nothing in `tests/` asserts on description text at all.

**Verify:** `grep -n "CAP" src/server/weatherServer.ts docs/TOOLS.md` and check that every
country inside a CAP clause is one of IN, PH, ID, and that no other authority
trails one.

**Evidence:** 2026-09-08 (`62521ba` and `f78f6da`, tools-list-slimming T4/T6).
It happened **twice on one branch, from two different causes**. T3's trim
produced it in the tool description; the coherence read caught it. T6's G46
re-read then found `docs/TOOLS.md:368` carrying an independent instance that
predated the branch — `…38 European MeteoAlarm member countries …, via their
official national CAP feeds, India …, and Japan …` — where the misplaced clause
attaches CAP to *Europe* as well. Two authorities mis-described on one page, on
the alerts surface, shipped and unnoticed.

**Status:** active. Related: [G53] (a routing heuristic promoted to a rendered
claim inherits every edge it was allowed to get wrong), [G46] (a docs task
writes the plan's promise, not the code's behaviour — which is how the
`docs/TOOLS.md` instance was found), [G11] (only reading the rendered text
catches it). Lintable: partially — the Verify grep is mechanical.

---

## G81 — `String.length` is a count of UTF-16 code units, so a budget named in bytes under-reports and always in the unsafe direction

**Trigger:** any assertion, constant or published figure that states a **size in
bytes** and gets that size from `JSON.stringify(x).length`, `str.length`, or a
`.length` on anything that is not already a `Buffer`/`Uint8Array`.

**Rule:** measure with **`Buffer.byteLength(s, 'utf8')`**. Then add a positive
control asserting the payload actually contains non-ASCII, so the two rulers
provably differ and a later "simplification" back to `.length` cannot pass every
test in the file.

**Why:** `.length` counts UTF-16 code units. Every character outside ASCII costs
more bytes than code units — an em-dash (U+2014) is one code unit and **three**
UTF-8 bytes, a degree sign two — so a code-unit count is always **less than or
equal to** the byte count. That direction is the whole problem: a budget checked
with the short ruler reads green while the real payload is over the ceiling. It
cannot fail loudly, only quietly, and the gap widens with every non-ASCII
character an editor adds. The error is small enough to look like rounding
(8 bytes on `basic`, 24 on `full` — about 0.06%) and is therefore invisible to
exactly the review that would catch a large one.

The trap is not the arithmetic, which everyone knows. It is that a name can
carry the claim: a constant called `TOOLS_LIST_BYTE_BUDGET` compared against a
`.length` reads as correct at every call site, and the three published figures
downstream of it inherit the wrong unit without anyone restating it.

**Verify:** `grep -rn "\.length" --include="*.ts" src tests | grep -i byte` —
any hit where a byte-named thing is measured by `.length` is the bug. Then, in
the test itself, assert `Buffer.byteLength(payload, 'utf8') > payload.length`;
if that fails the payload is pure ASCII and the two metrics are indistinguishable,
which is worth knowing too.

**Evidence:** 2026-09-08 (tools-list-slimming, codex-DR-2). `TOOLS_LIST_BYTE_BUDGET`
and `tests/unit/tools-list-budget.test.ts` measured `JSON.stringify(...).length`;
`README.md`, `CHANGELOG.md` and the `src/config/tools.ts` comment all published
those numbers as bytes. Remeasured: `basic` 12,979 → **12,987**, `full` 30,812 →
**30,836**, and the `main` baselines 17,442 → 17,458 and 40,212 → 40,254. Both
presets pass on either ruler, so nothing shipped wrong — the defect was the unit
on a number four places claim.

**Status:** active. Related: [G4] (never trust the 200/the green alone), [G47]
(a control that proves the measurement happened at all), [G62] (assert the
construct, not a vocabulary word), [G82] (a fingerprint documenting fields it
never derives — the same release's other instance of a name outrunning what the
code does). Lintable: **yes** — the Verify grep is mechanical.

---

## G82 — A fingerprint's comment can claim fields the derivation never projects, and the lock still passes

**Trigger:** a golden/fingerprint test whose header comment enumerates what it
covers, where the projection function and the comment were written at different
times — or where the expected literal was generated by a *separate* script that
projected a different field set.

**Rule:** the comment lists **exactly** what the derivation function projects,
and names what is deliberately outside it. When you add a claim to the comment,
add the field to the projection in the same commit, and prove the new field red
by flipping one value of each type it can hold ([G41]).

**Why:** a fingerprint is a lock the *next* editor reads rather than re-derives.
Its comment is the interface; the projection is the implementation; and nothing
compares them. A comment claiming coverage the code does not have is worse than
no comment, because it converts an absent check into a believed one — the editor
who changes a default reads "no parameter, enum, default or `required` entry
changed" and concludes the lock has their back.

The failure is invisible from the green run in both directions: the lock passes
because the values it *does* project are unchanged, and it would also pass if
every unprojected field were rewritten.

**Verify:** read the projection function and the comment side by side, then
mutate one value of every field the comment names. Any mutation that does not
turn the suite red is a field the comment claims and the code does not check.

**Evidence:** 2026-09-08 (tools-list-slimming, codex-DR-1). The Contract 3 header
and the expected literal's own comment both said the fingerprint proved "no
parameter, enum, default, or `required` entry" changed, while `deriveFingerprint`
projected `params`/`required`/`enums` only — all 31 defaults across 12 tools were
outside it. Nothing wrong shipped (a line-diff of every `default:` key between
`main` and the branch was empty), but flipping
`get_forecast.include_severe_weather`, `get_current_conditions.source` and
`search_location.limit` all passed. With `defaults` derived, those same three
flips fail exactly their three tools.

**Status:** active. Related: [G41] (a check that cannot fail), [G10] (baseline
provenance), [G79] (the same lock's other trap), [G81] (the same release's other
name-outruns-code instance). Lintable: no — it needs a human to compare prose
against a projection.

## G83 — Centralizing a per-tool pointer makes it configurable away, and lets its wording outrun the capability it points at

**Trigger:** consolidating guidance repeated across many tool descriptions onto
one tool ("call X when Y happens"), or widening the wording of a pointer that
already exists.

**Rule:** before moving a pointer onto one tool, answer both halves. **Reach** —
can the tool it now lives on be switched off? If a preset or a hand-composed
`ENABLED_TOOLS` can omit it, the pointer disappears for that install, and the
model never learns the tool exists. **Span** — does the destination tool's
*capability* cover everything the new wording claims? A sentence that widens from
"this tool errored" to "any tool errored" has just promised coverage the handler
may not have. Bound the claim in its own first clause, name the scope in
`docs/TOOLS.md`, and file the widening as its own item rather than smuggling it
into the consolidation.

**Why:** the per-tool form is redundant but self-carrying — each tool's pointer
ships with that tool, so it is present exactly when it is relevant. Centralizing
trades bytes in every client's context for a single point of failure that is also
a *configuration* surface. And the trade is invisible in the default install,
which is the one anybody tests: every preset here keeps the status tool, so only
a hand-composed list loses the pointer, and nothing fails loudly when it does.

**Verify:** enumerate the configurations that omit the destination tool and check
the pointer's reachability in each (the presets *and* a hand-composed list, both
sides of the change). Then read the destination handler and count the upstreams
it actually probes against the number the new sentence implies.

**Evidence:** 2026-09-08 (tools-list-slimming, v1.28.1). Four weather tools each
carried "use `check_service_status` on error"; the clause moved onto
`check_service_status` itself, which now reads `Call this after any weather tool
returns an error`. Measured both ways. **Reach:** `ENABLED_TOOLS=get_forecast`
and `get_forecast,get_alerts` reach the pointer on `main` and not on the branch;
all four presets keep it. Accepted, because on `main` that pointer named a tool
the model could not call. **Span:** the sentence now spans 17 tools while
`src/handlers/statusHandler.ts` probes NOAA and Open-Meteo only, so a RainViewer,
JMA, NIFC, FIRMS, NWPS or Blitzortung failure is not diagnosable there
(`codex-DR-3`, deferred to a design item). Worst case is one wasted call
returning a truthful two-service report, never a false all-clear — which held
only because the description bounds itself in its first clause, `Check whether
the upstream weather APIs (NOAA, Open-Meteo) are reachable`. `docs/TOOLS.md` §7
was still describing the pre-move wording at release and was corrected there
(`226eb27`).

**Status:** active. Related: [G81], [G82] (the same release's other two), [G12]
(one edit, every site). Lintable: partly — reach is mechanically checkable by
dumping `tools/list` per preset; span is not.

---

## G84 — A hand `curl` of `api.weather.gov` without the service's own `Accept` header reads a staler document than production does

**Trigger:** checking a rendered NWS value by hand — confirming a timestamp,
a field's presence, or a payload's key set with `curl`, `jq`, or a browser,
to verify what the server rendered.

**Rule:** send the header the service sends. `NOAAService` requests forecast
and gridpoint documents with `Accept: application/geo+json`
(`src/services/noaa.ts:65-66`); a bare `curl` sends `*/*` and can be served a
**materially older cached copy from the same URL**. Before calling a rendered
value wrong, re-issue the probe with the service's header — and if the two
disagree, the header is the first suspect, not the renderer.

**Why:** the failure looks exactly like a rendering bug, and it points the wrong
way with confidence. There is no error, no cache header worth reading in the
output, and both responses are well-formed, correctly-shaped, plausible JSON —
so the natural conclusion is that the handler formatted the wrong field or the
wrong timezone. The gap is not a few seconds of drift either; it is large enough
to survive every sanity check a person would apply to a timestamp.

**Verify:**

```bash
curl -s "https://api.weather.gov/gridpoints/LWX/97,71/forecast" | jq -r .properties.updateTime
curl -s -H "Accept: application/geo+json" \
  "https://api.weather.gov/gridpoints/LWX/97,71/forecast" | jq -r .properties.updateTime
```

Two different values from the same URL in the same minute means this entry is
live. Confirm against the service itself by constructing `NOAAService` and
calling `getForecast` directly — that is the value production renders.

**Evidence:** 2026-09-08 (`f5d51a3`, forecast-auto-source-contract T1). The
built dist rendered `**Updated:** Sep 8, 2026, 1:33 PM` for Washington DC. A
bare `curl` of the daily gridpoint endpoint reported
`updateTime: 2026-09-08T16:52:27+00:00` — 12:52 PM local, **41 minutes
earlier** — and the render was nearly filed as a defect on that basis. Five
repeats of the bare form all returned `16:52:27Z`; five with
`Accept: application/geo+json` all returned `17:33:11+00:00`, matching the
render exactly, as did `NOAAService.getForecast` invoked directly. Adding
`?units=us` (which the service also sends) made no difference; the `Accept`
header was the whole of it.

**Status:** active. Related: [G10] (a probe that is not testing what you think
it is — this is the hand-probe twin of the base-worktree configuration trap),
[G11] (read the real output — and make sure the thing you compare it against is
real too), [G48] (a fixture supplying a value the live resolver never produces;
here it is the *verification* that reads a value production never saw). Not
lintable — it is a property of a CDN, not of the code.

---

## G85 — A handler that forwards `...args` to a sibling handler passes keys the forwarding tool never declared

**Trigger:** adding a parameter to a tool whose handler is also reached through
a composite tool (`get_weather_summary` fans out to the forecast, current-
conditions and alerts handlers), or reading a composite's pass-through spread.

**Rule:** a composite handler that builds its sub-call arguments with a raw
spread forwards **every** key the caller sent, including ones absent from the
composite's own `inputSchema`. `src/server/weatherServer.ts` does no per-tool schema
validation, so an undeclared key is not rejected at the boundary — it arrives
at the sub-handler and behaves exactly as if the sub-tool had been called with
it. When you add a parameter to a fanned-out handler, decide explicitly whether
the composite should expose it, null it out, or inherit it silently, and write
the answer down. Do not assume the composite's schema is the gate; it is not.

**Why:** the composite's schema reads as a contract and is not one, so the
reachable surface is larger than the declared surface and nothing says so. The
gap is invisible from either end — the sub-handler sees a normal argument, and
the composite's schema looks complete — which means the behaviour is discovered
by a user, not by a test or a reviewer reading one file.

**Verify:**

```bash
grep -n 'subArgs' src/handlers/weatherSummaryHandler.ts
```

The spread plus an explicit null-out list is the shape: whatever is **not** in
that list is forwarded. Compare it against `get_weather_summary`'s
`inputSchema.properties` in `src/server/weatherServer.ts` — every key in the second that is
not nulled in the first is declared, and every key in neither is an
undeclared pass-through.

**Evidence:** 2026-09-08, `codex-MAJOR-1` on the forecast-auto-source-contract
diff review, downgraded to minor and deferred at triage. `weatherSummaryHandler.ts`
nulls only `location_name`, `city_name`, `compare_models` and `ensemble_spread`,
so `granularity` — never declared on `get_weather_summary` — reaches the
forecast handler and produces an hourly forecast inside a summary. The spread
dates to `1e960b9` (2026-07-13), so this pre-dates the branch that found it by
two months; v1.29.0's new hourly source note simply made the path visible, where
it is correct about the product it labels. Removing the capability is a scope
decision, not a bug fix, which is why the entry is here rather than a patch.

**Status:** active. Related: [G19] (the sub-handler contract a composite
inherits without restating). Partially lintable — a test could assert that the
null-out list plus the declared properties covers every key any sub-handler
reads, but nothing does today.

---

## G86 — A captured example stamps the version in `package.json` at capture time, which is never the version it ships under

**Trigger:** reading a version number inside `examples/`, or deciding whether
`npm run examples` needs to run during `/release`.

**Rule:** `scripts/capture-examples.mjs:326` interpolates
`require('./package.json').version` into each file's `*Captured <date> with
weather-mcp v<version>*` footer. During feature work that is the **previous**
release's number — the code that rendered the output is unreleased and has no
number yet — and after `/release` bumps the version it is stale in the other
direction unless the captures are regenerated, which drifts every file against
live upstreams. Read the stamp as *"captured on this date, from a tree at
roughly this version"*, never as a claim that the shipped release renders it.
The stamps across `examples/` are legitimately mixed and are not a defect.

**Why:** it invites two opposite wrong conclusions. A reader who trusts the
stamp will check out the named tag, find code that cannot produce the captured
output, and conclude the example is fabricated. A release operator who tries to
fix it by regenerating pays fresh live drift across every capture — and here
specifically reintroduces trailing-whitespace bytes, because
`forecastHandler.ts:624` renders `${period.windSpeed} ${period.windDirection}`
and NOAA sends an empty direction at 0 mph, so `git diff --check` goes red.

**Verify:**

```bash
grep -rn 'Captured .* with weather-mcp v' examples/ | sed 's/.*weather-mcp //'
```

More than one version across the set is the normal, expected state.

**Evidence:** 2026-09-08, `codex-MINOR-2` on the forecast-auto-source-contract
diff review, deferred at triage and dispositioned at `/release` v1.29.0 as
**ship as captured**. `git show v1.28.1:src/handlers/forecastHandler.ts` still
reads the dead `properties.updated`, so the two files stamped `v1.28.1` quote
output that tag cannot render; the other seven read `v1.25.18`.

**Status:** active. Related: [G12] (the doc anchors a release rewrites),
[G11] (read the real output). Not lintable — the stamp is honest about capture
time and wrong only if read as a release claim.

---

## G87 — A parser that anchors on `\n` reads a repository that has no EOL policy, and a Windows clone is the input nobody tests

**Trigger:** writing or reviewing a regex that reads *source text* — a `.ts`, a
`.json`, a script — rather than an API response, in a repo with no
`.gitattributes`.

**Rule:** anchor block boundaries as `\r?\n`, never a bare `\n`. There is no
`.gitattributes` in this repo, so an ordinary Windows clone under
`core.autocrlf=true` checks every text file out with CRLF endings, and any
parser anchored on `\n` alone throws on that checkout. Character classes are the
quiet exception that hides the bug: `\s` and `[\s\S]` already absorb a `\r`, so a
parser can be *mostly* CRLF-safe and fail on the one literal `\n` in it.

**Why:** the blast radius is larger than "a bash script a Windows contributor
cannot run anyway". `scripts/lib/derived-facts.mjs` is read back by
`tests/unit/derived-facts.test.ts` through `toolNames()`, which opens the real
`src/config/tools.ts` — so a CRLF checkout turns a portability nit into a red
`npm test`. It is also a *regression* introduced by centralization: the
`grep -cE` derivation this module replaced counted lines and was line-ending
agnostic by construction. Moving a derivation from a line-counting tool to a
block-matching regex silently adds an EOL dependency the old code never had.

**Verify:**

```bash
node -e "import('./scripts/lib/derived-facts.mjs').then(async m => {
  const src = (await import('node:fs')).readFileSync('src/config/tools.ts','utf8');
  console.log(m.parseToolNames(src).length,
              m.parseToolNames(src.replace(/\n/g,'\r\n')).length);
})"
```

Two equal numbers is the fixed state; a throw on the second is the trap.

**Evidence:** 2026-09-09, `codex-m1` on the issue-88-tool-count-source diff
review, dispositioned **fix now**. `BLOCK_RE` at `scripts/lib/derived-facts.mjs:36`
read `\[\n`; under CRLF `parseToolNames` threw `TOOL_NAMES block not found`
while the LF path returned 17. `ENTRY_RE` on the next lines needed no change —
its `\s*` was already tolerant, which is exactly why one literal `\n` was easy to
miss in review.

**Status:** active, fixed at the one site. Related: [G79] (the same module's
lock reading a path that does not exist on a fresh clone), [G82] (a derivation
whose comment outruns what it projects). Lintable in principle — a grep for
`\\n` in a `*.mjs` regex would find it — but there is one such parser today.

## G88 — A linked worktree shares `.git/config`, so a `git config` run inside one changes every checkout of the repository

**Trigger:** setting any `git config` value from inside a `git worktree` — most
often `core.autocrlf`, `core.eol` or a hook path — while probing a portability
or checkout-shaped question.

**Rule:** a linked worktree isolates the **working tree**, not the
configuration. `git config <k> <v>` inside one writes the shared `.git/config`
of the main repository, so it applies to the main checkout and to every other
worktree from that moment on. Scope the experiment to the worktree with
`git -c <k>=<v> <command>`, or set it and unset it in the same breath and then
read `.git/config` back to confirm. Never leave a checkout-affecting setting
behind at the end of a probe.

**Why:** the damage is delayed and the symptom names the wrong problem. The
setting does nothing until something is re-checked-out, so the worktree that set
it behaves correctly and looks clean. The *next* worktree created inherits it,
checks out the shell scripts with `#!/bin/bash\r` shebangs, and every one of
them fails as:

```
env: './scripts/update-docs-for-release.sh': No such file or directory
```

Exit 127, `No such file or directory`, on a file that plainly exists and is
executable — the kernel is reporting the missing interpreter `/bin/bash\r`, not
the missing script. Nothing in that message points at `core.autocrlf`, and
nothing points back at the worktree three steps earlier that set it.

**Verify:**

```bash
git worktree add /tmp/probe HEAD && cd /tmp/probe
git config core.autocrlf true
grep -n autocrlf "$(git rev-parse --git-common-dir)/config"   # the SHARED config
```

A hit is the trap. `git config --unset core.autocrlf` and re-read before doing
anything else.

**Evidence:** 2026-09-09, the `/test-drive` for issue-88-tool-count-source
(Observation 2). Setting `core.autocrlf true` inside the CRLF probe worktree
landed six lines into the real repository's `.git/config`; the writer dry-run
worktree created next inherited it and died at exit 127 with the message above.
The main working tree was undamaged only because its files were never
re-checked-out — `file(1)` confirmed LF throughout and `git status` stayed empty.
A `core.autocrlf` probe is exactly the shape of the next test drive that touches
[G87]'s parser, so this will recur.

**Status:** active, method-level — there is no code fix, only the scoping
discipline above. Related: [G87] (the parser that makes a CRLF probe necessary
in the first place), [G42] (a release tool that mutates before it aborts, which
is why these probes belong in a throwaway worktree at all).

---

## G89 — A full-suite gate is a reader of every test file, not just the task's declared files

**Trigger:** two tasks marked `parallel-safe` on disjoint `Files:` lists, where
one of them **temporarily** edits and restores a live test file — a G41 control,
a mutation probe, a "prove the pin is load-bearing" step — while the other runs
the full suite, or runs a script that runs the full suite
(`scripts/check-doc-versions.sh:70` shells out to `npm test`).

**Rule:** decide `parallel-safe` on the **read set at acceptance**, not on the
declared write sets. A suite discovers tests tree-wide, so every task whose
acceptance runs it is a reader of every test file in the tree. Serialize the
pair, or run one in an isolated worktree. Disjoint `Files:` lists are not
sufficient and never were.

**Why:** three distinct failures, none of which looks like a scheduling problem
when it lands. The reader can load the deliberately mutated test and execute with
its filesystem pins removed — writing state outside its own touch set. It can
catch a non-atomic `cp` restore halfway and see a half-written file. And a
sibling's own F12 lock (`git diff --quiet HEAD -- <the anchored test files>`) goes
**red on work that is correct**, because the mutation is in flight. All three are
nondeterministic and all three get attributed to the diff.

This is the case [G50] does not reach. G50 fires when a temporary write lands on
a file in *neither* task's list; here the mutated files are in the mutating
task's **own** declared list, which is exactly what makes the pair look safe.

**The read set is the whole tree, not just `tests/`.** The entry was written
about a sibling mutating a test file, but a full suite compiles and exercises
`src/` too, so a sibling mid-edit **anywhere** is enough. 2026-09-11
(met.no fallback): T4 and T5 were a declared `parallel-safe` fork on genuinely
disjoint file lists, and T4's acceptance — a full green gate — ran while T5 had
three handler files half-written. T4 reported two failing critical-alert files
as "unrelated to my work", which was the correct call and cost a round trip to
establish; they were T5's, and they were real. A subagent that stops and reports
rather than fixing a sibling's file is behaving well; the marker is what is
wrong. **`parallel-safe` requires disjoint *acceptance*, not just disjoint
files**, and a full-gate acceptance is disjoint from nothing.

**Verify:** for each `parallel-safe` pair, list what each task's acceptance
*reads*, not what it writes. If either acceptance step is `npm test`, the full
gate, or a script that runs them, the read set is the whole tree and the pair is
only safe if neither task writes anything the suite loads — including
temporarily.

**Evidence:** 2026-09-09 (issue-95-server-factory). Filed as `codex-R2` by the
plan review and confirmed against the tree by triage: T2's G41 control blanked
the two `ANALYTICS_SALT` pins in `tests/unit/tool-name-parity.test.ts` and
`tests/unit/tools-list-budget.test.ts` — the exact files T3's full-suite
acceptance reads, directly and again through the doc checker. The plan was
amended to serialize T3 after T2 before the run started. The same reasoning then
fired a **second** time during execution, on a pair the amended plan still
permitted in parallel: T5's acceptance runs the doc checker over `src/` comment
files T4 was editing, so `/run-plan` serialized T4 and T5 as well. Twice in one
plan, on pairs a `Files:`-list check called disjoint.

**Status:** active. Related: [G50] (the narrower case, a write outside both
lists), [G14] (why a checker run is a suite run), [G27] (restore by `cp`, which
is what makes the window non-atomic), [G90] (the other edge a task graph forgets).

---

## G90 — A task after a parallel fork needs an explicit join edge

**Trigger:** two or more tasks may run in parallel, and a later task — final QA,
a byte-identity sweep, a release-notes or version step, anything that records the
finished state — declares a dependency on only one of them.

**Rule:** make the downstream task depend explicitly on **every** branch whose
output belongs in the state it describes. Grouping the siblings under one phase
heading is prose; the dependency edge is what the orchestrator schedules from.

**Why:** the downstream task captures the wrong artifact, and the wrong artifact
is the **durable** one. A QA record or a byte-identity sweep names a SHA, requires
a clean tree, and is what `/release` reads afterwards — so a task that starts
after one sibling and before the other can record a pre-sibling build, read the
other sibling's in-flight edits as a dirty tree, or describe a branch that is not
yet final. Nothing goes red; the artifact is simply wrong, and it is trusted later
precisely because it was written by the verification step.

**Verify:** for every task in a graph, ask which tasks must have **committed**
before its first command runs, and check that each is named in its `depends on`.
A task whose job is to describe the finished branch depends on every task that
changes the branch.

**Evidence:** 2026-09-09 (issue-95-server-factory). Filed as `codex-R1` by the
plan review. T4 and T5 were an explicit parallel fork; T6 — the byte-identity
sweep that records both SHAs, requires a clean tree and writes the QA record
`/release` reads — declared `depends on T5` alone. Amended to `depends on T4 and
T5` before the run, and named in the task graph as the Phase 2 join. It was the
less likely of the two review findings to fire (T4 is `haiku`-sized, T5 is not),
and it was the one whose failure would have been permanent.

**Status:** active, method-level — this is a plan-authoring check, not a code
fix, so it belongs in `/impl-plan`'s graph construction and `/plan-review`'s
parallel-safe pass. Related: [G89] (the other edge a task graph forgets), [G50].

---

## G91 — Filtering `commit-identity.sh` through `grep` turns its refusal into silence, and the commit proceeds

**Trigger:** running `.claude/scripts/commit-identity.sh` and piping it through
`grep`/`awk` to keep the output short — `| grep -E "^class"` — anywhere a command
is about to commit. Most acutely when the commit targets a **different**
repository (`--repo <internal-repo>`), which is the case the flag exists for.

**Rule:** the guard's **exit status** is the signal, not a line in its output.
Capture it: run the script, keep its output, and branch on `$?` — or at minimum
`grep ... || { echo "IDENTITY CHECK DID NOT RUN"; }`. And run it with the cwd
**inside the dev-workflow project**, passing `--repo` to name the other
repository; these scripts anchor on the project, not on their own location or on
your cwd, so `cd`-ing into the target repo first makes the script refuse.

**Why:** a refusal and a clean pass are indistinguishable through a filter — both
print no `class` line, and no-output reads as nothing-to-report. The script's
whole job is to stop a command before it writes, and a `grep` that matches
nothing is a check that cannot fail ([G41]). The failure is silent in the worst
place: an identity guard that did not run looks exactly like one that passed, and
the commit lands either way, because the `&&` is usually on the `git add` rather
than on the guard.

**Verify:** run the check with a deliberately wrong anchor — from inside a
directory with no `.claude/dev-workflow.conf` above it — through your usual
filter. If you see nothing and would have proceeded, the filter is the defect.
The script prints a multi-line `ERROR: not inside a dev-workflow project.` to
which `^class` cannot match.

**Evidence:** 2026-09-09 (issue-95-server-factory, `/run-plan` archive step). The
six in-repo commits were each guarded correctly (`class ok`). The seventh — the
`Archive plan set` commit in `weather-mcp-internal` — was run after `cd`-ing into
that repo, so the script exited with `ERROR: not inside a dev-workflow project.`,
the `| grep -E "^class"` printed nothing, and the commit was made unguarded. It
happened to carry the right identity (verified afterwards with `git log -1
--format=%an/%ae/%cn/%ce`, and the check re-run correctly from the project root
returned `class ok`), so nothing was wrong — but nothing had checked, on the one
commit of the run that went to a different repository with its own config.

**Status:** active. Lintable in the weak sense that a command body can be grepped
for `commit-identity.sh` piped into anything; the real fix is for the calling
command to test the exit status. Related: [G41] (a check that cannot fail), [G47]
(a control that proves the measurement happened at all), [G28] (a probe that fails
reporting as a clean negative), [G88] (the other worktree/repo-boundary trap).

---

## G92 — A diff-of-diffs between two trees is never empty, because `git diff` stamps each file's blob hashes into the header

**Trigger:** proving two runs of the same command behaved identically by
comparing `git diff` output from two worktrees — a branch checkout and a base
checkout — over the files the command writes.

**Rule:** compare the **hunks**, not the stream. Pipe both sides through
`grep -v '^index '` before `diff`, and pass `--unified=0` as well. Better still,
compare the **fact under test** rather than bytes: serialize the values the
change actually owns (a capture manifest) and diff those, so a multi-purpose
command that legitimately rewrites other things cannot make a correct run look
wrong.

**Why:** `git diff` emits `index <pre-image>..<post-image>` for every file, and
those are content hashes of that file in each tree. If the two trees differ in
the file **at all** — even on a line the command under test never touches — all
four hashes differ and the diff-of-diffs is non-empty while both runs behaved
identically. No context setting suppresses the header: `--unified=0` fixes the
*adjacent-line* half of this trap, where a branch-only line near a changed line
bleeds into the context and makes the two streams differ. They are two halves of
one mistake — comparing the bytes of a diff instead of the behaviour it
describes — and fixing only the half you have met leaves a check that still
cannot pass.

**The tell is that the acceptance criterion is unsatisfiable on correct work.**
If the comparison is meant to prove "the two writers agree" and the two trees
were *made* to differ by the very change under test, then whole-stream equality
was never achievable. Re-measure the invariant rather than editing the tree to
satisfy it ([G41]).

**Verify:** in any two worktrees of this repo that differ in a tracked file,
run the same command in both, then
`diff <(git -C A diff --unified=0 -- F) <(git -C B diff --unified=0 -- F)` and
`diff <(git -C A diff --unified=0 -- F | grep -v '^index ') <(git -C B diff --unified=0 -- F | grep -v '^index ')`
— the first is non-empty, the second is empty.

**Evidence:** 2026-09-11 (issue-88 site half, T6 E5). Two worktrees — the branch
at `8127a1c` and `main` at `8d604bd` — each ran
`./scripts/update-docs-for-release.sh patch`, and the plan required the
zero-context diff-of-diffs over `CLAUDE.md`, `docs/README.md`, `package.json`,
`package-lock.json` and `server.json` to be **empty**. It differed in exactly two
lines, both `index` headers, for `CLAUDE.md` and `docs/README.md` — the two files
whose test count T3 had raised on the branch. Excluding the header lines the two
streams were byte-identical, which is the claim that was actually under test.
The corroboration that this is header noise and not behaviour: `package.json`,
`package-lock.json` and `server.json` carried **identical** `index` lines on both
sides, correct because that plan never touched them. The `--unified=0` half of
the same trap had already been caught at review time (`codex-R2`) and fixed;
the header half survived into the run because the fix addressed the instance
rather than the mechanism.

**Status:** active. Related: [G41] (the check itself was the thing that was
wrong), [G10] (the other "prove two runs agree" trap — an identical hash is not
evidence until you show the construct was rendered on both sides), [G42] (the
release writer is the multi-purpose command that makes whole-file comparison
hopeless here).

---

---

## G93 — A trailing-optional parameter makes *position* a moving target, for every selective-forwarding caller and every positional assertion

**Trigger:** appending an optional parameter to a function that already ends in
a run of optional ones — the house pattern here for threading a new service
into a handler without touching its existing call sites.

**Rule:** appending is safe for the **signature** and unsafe for two things
around it.

- **A caller that forwards a *shortened* argument list does not reach the new
  slot by appending.** Count the parameters that caller omits and pass an
  explicit `undefined` for each one before the new argument. Reordering the
  signature to put the new parameter somewhere more natural is the tempting
  wrong remedy: it breaks every call site the trailing position exists to
  protect.
- **An assertion that finds a value by its position breaks while the behaviour
  it protects is unchanged.** Pin the contract — *is this flag among the
  arguments*, *is this slot empty* — not the index or the argument count.

**Why:** the whole point of a trailing optional is that 38 call sites compile
unedited, and that success is what hides the two exceptions. The caller case
fails *loudly* when the types differ (a `MetnoService` will not assign to an
`AcisService`) and **silently** when they do not — a service handed to the wrong
parameter, which is the same shape as [G19]'s warning one level down. The
assertion case is worse because it fails **red on correct work**: the next
person sees a critical-alert test failing on a diff that never touched the
banner, and the cheapest way to make it green is to change the number, which
re-arms the same tripwire for the parameter after this one.

**Verify:** for each caller of the changed function, count its actual arguments
against the parameter list and check the new value lands in the slot you meant.
Then `grep -rn "toHaveLength(\|mock.calls\[0\]\[" tests/` over the tests that
exercise those callers, and `grep -rn 'last[A-Z][a-zA-Z]*Of(' tests/` for
source-scraping helpers keyed on position.

**Evidence:** 2026-09-11 (`cf102f5`, met.no fallback T5). `metnoService` became
`handleGetForecast`'s 9th parameter and all 38 external call sites compiled
unedited, exactly as the plan predicted. Two things it did not predict.
`handleGetWeatherSummary` calls that function with **six** positional arguments,
dropping `acisService` and `criticalAlertBanner`, so appending bound the service
to the `acisService` slot — filed pre-run as `gemini-R1` and fixed with an
explicit `undefined, undefined, metnoService`. And two pre-existing
critical-alert tests went red on behaviour that was **provably unchanged**:
`critical-alert-dispatch.test.ts` asserted the banner flag was the *last*
dispatch argument, and `critical-alert-summary.test.ts` that the summary passed
*exactly six*. Neither was among the nine lock files the plan named, and the
plan's own enumeration grep could not have found them — it requires
`handleGetForecast(` with a paren, and the dispatch test builds that string at
runtime from a bare name. Both were re-pinned to the contract and three
mutations confirm they still catch a dropped flag, a threaded flag, and the
summary dropping the service.

**Status:** active. Related: [G19] (the summary substitutes its own argument
list rather than forwarding an absent parameter — this is the positional
mechanic underneath that rule), [G62] (the other "a lock breaks on a change it
was not protecting against" shape), [G45] (a mutation only goes red where the
contract can reach it — the reason re-pinning to the contract is the fix and
bumping the number is not).

---

## G94 — A fallback that turns an error into an answer leaves the error-handling page overstating what fails, and adds an upstream no changelog bullet ever names

**Trigger:** adding a fallback behind an existing upstream — a second service
that answers when the first one cannot — or writing the `## Docs impact` for
one.

**Rule:** a fallback changes two pages that its own changelog bullet will not
send you to. Walk `docs/ERROR_HANDLING.md` and narrow every error the fallback
now prevents, naming the cases where the message still applies. Then walk the
`README.md` **Data sources** table and the attribution footer, because the
fallback's upstream is a new public data source even though nothing in the
feature list changed.

**Why:** the bullet for a fallback is written about *resilience* — "X no longer
fails when Y is down" — so the docs walk goes to the tool reference and stops.
But the error catalogue is an inventory of what a user sees when something
breaks, and the fallback has just made one of its entries wrong; and the
source table is an inventory of who the data comes from, which a resilience
bullet gives no reason to open. Both pages are inventories, and a change framed
as behaviour never points at an inventory.

**Verify:** for the upstream now behind a fallback, read every error block on
`docs/ERROR_HANDLING.md` and ask whether a user would still see it. Then
`grep -n '<new upstream>' README.md` and confirm a hit in the sources table and
in the attribution footer, not only in the intro sentence.

**Evidence:** 2026-09-11, v1.30.0 release, step 4b. The met.no fallback's docs
task (`817d7f3`) covered `docs/TOOLS.md` thoroughly — a routing table, the
absent `"metno"` source value, the horizon, the attribution, the both-down
case — and added MET Norway to the README's intro sentence. Three sites it did
not reach. `docs/ERROR_HANDLING.md` still presented an Open-Meteo 5xx and a
connection failure as terminal, which for `get_forecast` outside the US they no
longer are. The README **Data sources** table had no MET Norway row, though
every other upstream including later additions has one. And the attribution
footer named every source but MET Norway, whose CC BY 4.0 licence is the one
here that actually mandates attribution. All three found by the release-stage
docs walk, the same backstop that caught [G78].

**Status:** active. Related: [G78] (the other `docs/ERROR_HANDLING.md` gap, and
the inverse case — there a failure rendered nothing, here a failure stopped
happening), [G31] (the architecture map goes stale for the same reason: a new
module has no user-visible bullet to hang off), [G19] (the summary path a
fallback must be threaded into explicitly).

---

## G95 — A test helper's default parameter turns an "absent" fixture into a present one, silently

**Trigger:** writing a fixture for an **absent** field — `undefined`, a missing
key, "upstream did not publish this" — through a shared builder or render helper
that declares a default for that parameter (`function renderAt(distance,
containment = 20)`).

**Rule:** a helper that must be able to produce an *absent* value takes that
parameter **without a default**, explicitly at every call site. A JS default
substitutes on an `undefined` **argument**, not merely on a missing one, so
`renderAt(1.1, undefined)` and `renderAt(1.1)` are the same call — and the
fixture you wrote to mean "NIFC published nothing" silently becomes the default.
Widen the parameter's type (`unknown`) rather than reaching for a sentinel.

**Why:** this is [G13]'s degeneracy one layer up — not a fixture that repeats a
*value*, but a **helper that manufactures one**. It is strictly harder to see:
the call site reads `containment: undefined`, which is exactly what the contract
is about, and the assertion that should have gone red goes green against a
containment of `20`. The test then reads as coverage of the absent case while
never once exercising it. The house convention here makes it recur by
construction — `wildfire-band-rounding.test.ts:12-15` says in its own doc comment
that it **copied** its helpers from `wildfire-handler.test.ts` rather than
importing them, so each new wildfire test file inherits the default along with
the helper, and the next parameter that needs an absent case meets it again.

**Verify:** for every test helper with a defaulted parameter, grep its call
sites for that argument passed as an explicit `undefined`, `null`, or a variable
that can hold one. Any hit is either a fixture that is not testing what it says,
or a default that should not exist. Then drop the default and confirm the
absent-case assertion still passes — if it now fails, it was never testing the
absent case.

**Evidence:** 2026-09-17 (`e115d84`, wildfire-display-coherence T3). The copied
`renderNifcAt(distanceKm, containment = 20)` turned the `not reported` fixture
for an absent containment into a containment of `20`, which renders
`**Containment:** 20% ██░░░░░░░░` — so the contract asserting `not reported`
would have failed against *correct* code, and a builder chasing the failure
could plausibly have "fixed" the implementation instead. Caught by the subagent
while writing the file; the default was dropped and `containment` made explicit
at all five call sites. Related: [G13] (the degenerate-fixture parent), [G56]
(two live encodings where only one is a sentinel — the defect this fixture was
written to lock).

**Status:** active. Not lintable in general — a defaulted parameter is ordinary
and correct everywhere the absent case is not under test, so only a human can
tell which defaults sit in front of a contract about absence.

## G96 — A construct assertion over a whole rendered string can be satisfied by a *different* part of that string

**Trigger:** pinning a *shape* rather than a literal — a regex, a "starts with a
capital and ends in a period", a "contains exactly one heading" — and applying it
to a **whole** rendered report or a whole concatenated field, when the property
is really about one sub-structure inside it.

**Rule:** apply the construct to the **exact sub-structure the mutation would
touch**, not to the string that contains it. Parse the block out first (a regex
with the whole block's shape, and let it throw when it does not match), or strip
the known neighbouring part off the end, *then* assert. If the assertion can
still pass when a neighbour supplies the property, the neighbour is what it is
testing.

**Why:** this is the failure mode [G45] does **not** cover, and the distinction
matters because a builder who has read G45 will check the wrong thing and
conclude the contract is sound. G45 says a mutation only goes red where the
contract can **reach** it — the wrong *layer*. Here the contract reaches exactly
the right layer and still passes, because a rendered report is a concatenation
and a shape assertion over a concatenation is satisfied by **any** part of it
that has the shape. Both halves of a marine sea-state description end in a full
stop, so "ends in a full stop" is true of the joined string whether or not the
separator between them exists.

**Verify:** for each construct assertion, delete the thing it is about and
re-run. If it stays green, name what else in the string satisfied it — there is
always something, and that something is the real subject of the test.

**Evidence:** 2026-09-17 (`7c941d4`, marine-render-parity T5), both instances
found by the executing subagent running the plan's own mandated mutations, and
neither predicted by the plan. (a) Contract 7 asserted
`/^[A-Z][^.]*\.(\s|$)/` on `getSafetyAssessment`'s whole `description` to pin
that D3's full stop separates the rung name from the context sentence. Dropping
the `'.'` left `Moderate Conditions dominated by local wind waves.` — which
still starts with a capital and still ends in a period, because the *context
sentence* carries its own. Three of the four branches stayed green under the
exact mutation they existed to catch; only the no-context branch went red. Fixed
by slicing the known context suffix off and asserting `/^[A-Z][^.]*\.$/` on the
remaining rung-name portion. (b) Contract 3 checked the `⚪ … Unknown` header as
a `toContain` substring; deleting the `**Safety:**` line from
`formatSeaStateBlock` left the header intact, so the contract never saw a
truncated block. Fixed by parsing the whole block with one regex that throws
when the block is malformed, which then also reddened contract 1.

**Status:** active. Related: [G45] (the layer half of the same problem — read
both before concluding a mutation is uncatchable), [G13] and [G32] (a fixture
that cannot discriminate), [G62] (a lock that stops meaning what it says when
the vocabulary gains a second render site), [G82] (a comment claiming fields the
derivation never projects — the same "the assertion is not about what it says it
is about" family). Not lintable: only a human can say which sub-structure a
construct assertion is really about.

---
## G97 — `npm run examples` reports "All captures succeeded" while writing an upstream *error* into a shipped example

**Trigger:** running `npm run examples` — the bindings' conditional gate
addition whenever a tool's output shape changes — and committing what it
produces.

**Rule:** regenerate **only** the example whose output shape actually changed,
and **read the capture before committing it**. The script takes a filter
argument (`scripts/capture-examples.mjs:419-420`), so
`npm run examples boating` rewrites one file. Then grep the regenerated files
for a captured failure before staging:

```bash
git diff --stat examples/ && git diff examples/ | grep -nE '^\+.*(❌|Error retrieving|Unable to fetch|Rate limit exceeded)'
```

Any hit is a stop. A capture that lost hundreds of lines is the same signal by
another route — check `git diff --stat` for a large one-sided deletion.

**Why:** the script's success message is about **transport**, not content. A
tool that catches its own upstream failure and renders a polite error message
has returned text, so the capture "succeeded" and the summary line says so. The
result is that the repository's user-facing documentation ships an error message
as though it were the tool's normal output — and it ships under a commit whose
subject is about something else entirely, because a full regeneration also
rewrites every *other* example with ordinary live-data drift, and the real
damage hides in the noise. This is [G11] at the tooling layer ("the exit code is
not the acceptance") and [G47]'s shape at the content layer (a rate-limited
upstream answers with a well-formed body that reads like a legitimate result).

**Verify:** `npm run examples` on a clean tree, then
`git diff examples/ | grep -nE '^\+.*(❌|Rate limit exceeded)'`. On any run where
an upstream is throttling, this finds the captured error the summary line did
not mention.

**Evidence:** 2026-09-17 (`f91d802`, marine-render-parity T6). A full
`npm run examples` — run because `get_marine_conditions`'s output shape had
changed — rewrote **eight** files. `examples/river-and-flood.md` came back with
`❌ **Error retrieving river gauge data** … Error details: Rate limit exceeded
for NOAA`, deleting **848 lines** of gauge content including the entire
"Found 20 river gauges" listing, while the script printed `All captures
succeeded`. The river path was untouched by that branch. Seven unrelated files
and a radar PNG were reverted and only the marine capture kept. Nothing in the
gate would have caught it: `check-doc-versions.sh` does not read `examples/`,
and no test asserts on captured output.

**Status:** active. Lintable, and the better fix is in the script rather than in
every caller — `capture-examples.mjs` should treat a captured `❌` as a failed
capture and refuse to write it, which would retire this entry. Flagged as such
here. Related: [G11] (read the output, the exit code is not the acceptance),
[G47] (a throttled upstream's well-formed zero needs a positive control),
[G58] (the narrative around a regenerated capture, which is the *other* half of
the examples trap and fired on the same commit), [G86] (the version stamp a
regeneration moves).

---

## G98 — The MCP registry publish is the one distribution channel no gate watches, and it silently fell six releases behind

**Trigger:** cutting a release and treating the green `publish.yml` run plus a
`latest` on npm as "published".

**Rule:** the tag push publishes to **npm only**. The MCP registry is a
**separate, manual, interactive** step — `./mcp-publisher login github &&
./mcp-publisher publish` — and its credential expires silently. Before calling a
release done, read the registry back and compare it to `package.json`:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(sorted((s.get('server',s).get('version','') for s in d.get('servers',[])))[-1])"
```

A version older than `package.json`'s is a stop, not a cosmetic lag.

**Why:** every other outward-facing step in this project announces its own
failure. A red gate stops the release, a bad version pair fails `publish.yml`,
and a failed npm publish leaves the workflow red. The registry step has none of
that: it is run by hand after the workflow is already green, `./mcp-publisher
publish` exits **0** while printing a `401 Invalid or expired Registry JWT
token`, and nothing downstream reads the registry back. So the one channel whose
failure is invisible is also the one channel nobody is watching, and the failure
mode is not a crash but a version that simply stops advancing.

**Evidence:** found while closing out **v1.31.0** (2026-09-17). npm was at
`1.31.0` and `latest`; the registry's newest entry was **`1.25.18`, published
2026-09-02** — so v1.25.19 through v1.31.0 had never reached it, across six
releases and fifteen days, with every one of those releases reported as
published. `~/.mcpregistry_*` did not exist, and `./mcp-publisher publish`
returned `status 401: token is expired` **with exit code 0**, which is why no
release script or shell `&&` chain ever noticed.

**Status:** active. The check above is not wired into
`scripts/check-doc-versions.sh` — doing so would make a network call part of a
doc check that runs on every task — so for now it belongs in `/release` step 7's
registry verification, which the bindings already name and which this trap shows
was being satisfied by reading npm alone. Related: [G4] (never trust the status
alone — here the status is a zero exit over a 401 body), [G28] (a probe that
fails reports as a clean negative), [G39] (the npm half of the same publish, and
the reason a green workflow is not evidence about the registry), [G91]
(a guard's refusal turned into silence, the same shape one layer down).

---

## G99 — A country-code fast path can admit a coordinate the geographic predicate exists to reject

**Trigger:** a jurisdiction pre-filter that consults a **country-code set when a
code is present** and a **geographic predicate only when it is absent** —
`code ? SET.has(code) : inBoxes(lat, lon)`. The shape is attractive because a
resolved location already knows its country, so the common case costs no
geography at all.

**Rule:** the code branch is a **latency shortcut, not a second jurisdiction
oracle.** Before letting a code decide alone, ask whether that country contains
area the predicate deliberately excludes. Where it does, the code must carry the
box with it (`SET.has(code) && inBoxes(...)`), and the set splits in two —
`CODE_ALONE` for codes with no such split, `CODE_PLUS_BOX` for the rest. **Two
sets, never one with a special case**: a single set whose membership means
different things for different members is how the next reader gets it wrong.

Then check the **asymmetry**, which is where the plausible tidy-up lives. A code
belongs in `CODE_PLUS_BOX` only if the box actually covers it. Moving a code
there whose territory lives in the *other* predicate makes the conjunction
evaluate `false` forever and silently drops the feature for that whole country.

**Why:** every check passes. The suite is green, because the natural test for a
country set puts every code on **one** coordinate — and if that coordinate is
outside every box, the set is proved and the conjunction is invisible; if it is
inside, the box is proved and the set is invisible. Either way, deleting the
conjunction reddens nothing. Meanwhile the excluded coordinate has its own
zero-call test **without a code**, which returns early and looks like proof that
the point is excluded. It is not: it says nothing about the same point after
geocoding. The docs written from the plan then publish a suppression claim that
the code arm has already made false.

**Verify:** cross every deliberately excluded coordinate with every country code
a **live** provider can emit there, and write that cell ([G59]). Then mutate the
conjunction away and confirm the suite reddens. Prove each code with a **pair** —
in-box one call, out-of-box zero calls — rather than one case: a single green
case cannot tell you whether the set or the box admitted the point, and moving
the whole matrix onto in-box fixtures destroys the isolation that made the set
testable at all.

**Evidence:** 2026-09-18 (`9cffd30`, nws-alert-jurisdiction T2). Filed as
`codex-R1` by `/plan-review` against the plan, before any code existed, and
absorbed as impl rev 1. The critical-alert banner's new pre-filter put `gu`, `mp`,
`vi` and `as` in one set with `us` and `pr` and let any of them decide alone.
`MP` names the **whole** Northern Marianas while NWS accepts only the southern
arc, and the Open-Meteo geocoder — the last provider in both `GeocodingService`
orders, and the only one that emits ISO territory codes at all — returns `MP` for
Pagan as readily as for Saipan. So a `city_name` falling through to it would have
paid an uncached HTTP 400 and two `securityEvent` warns at precisely the points
the new box was drawn to exclude, while the planned suite stayed green and
`docs/TOOLS.md` said no lookup was made there. The fix is the two-set split above;
the mutation row that pins it (M7 — revert the conjunction) turns **9** cases red,
and **none** of them existed in the plan's first draft. The asymmetry half is
real too: `pr` cannot move into the box set, because Puerto Rico lives in `isInUS`
and not in `isInNwsTerritory`, so the relocation has the same red set as deleting
`pr` outright.

**Status:** active. Partly lintable — a `Set` of country codes read in the same
expression as a coordinate predicate is greppable, though whether a given code
spans served and unserved area is not. Related: [G59] (the cross-product rule
this is a directional instance of — the empty cell here is *code admits, box
refuses*), [G48] (which provider can emit the value at all — the reason `MP` is
reachable and `pr` is reachable only on one path), [G54] (mutate each term of the
compound separately; that is what exposes an unpinned conjunction), [G53] (the
predicate this one guards, and why it is not simply widened), [G46] (the docs
sentence that published the claim the code had already falsified).

---

## G100 — A synchronous store method does not make its *caller's* read-modify-write synchronous

**Trigger:** any handler that reads an entity from a synchronous store, `await`s
anything at all, and then writes that entity back — the classic shape being
"read the existing record, geocode/fetch something, merge, save".

**Rule:** the merge base must be re-read **after the last `await` on the path**
and immediately before the write, with no `await` between the two. A value read
before an `await` is a snapshot, and how stale it can be is bounded by the
awaited work, not by the store. Where an earlier read is still needed to pick a
*branch* (a partial-update mode, a validation path), keep it — but it must not
supply any field that is written back.

**Why:** `src/services/locationStore.ts` is synchronous on purpose. That is the
whole argument for having no lockfile: the read and the write are one
synchronous run, so the collision window was measured at 0.14 ms without
`fsync` and 10.4 ms with it. The design plan then stated that bound as though it
were the *system's* window. It was not.
`src/handlers/savedLocationsHandler.ts` read the existing entry at `:162`,
awaited Nominatim at `:185`, and restored omitted `notes`, `activities`,
`description` and `alternateNames` from that pre-await snapshot at `:231-244` —
so on a full re-save by `location_query` the real window was **external
geocoder latency**, three to four orders of magnitude wider than the number the
design defended. A second client's metadata edit during the round trip was
silently overwritten, and the store being synchronous did nothing about it
because the race was never inside the store.

The generalisation is the part worth keeping: **making a module synchronous
buys you atomicity only across that module's own call.** A caller can reopen
the window as wide as it likes, and nothing in the module's type, tests or
design can see it. The store's own contracts all stayed green throughout.

**Verify:** move the omitted-metadata restoration back onto the pre-await
`existingLocation` and run
`tests/unit/saved-locations-metadata.test.ts` — the two "Concurrent metadata
edit during a geocoded re-save (contract 9)" cases go red and **every
store-level contract in `tests/unit/location-store.test.ts` stays green**, which
is the shape of the trap ([G45]).

**Evidence:** 2026-09-18 (`883a978`, saved-locations-durability T2). Found by
the `/plan-review` codex leg (R1) against the *plan*, not the code — the design
had written its own revisit trigger for precisely this ("any `await` appearing
between the store's read and its write") and then did not apply it to the one
handler that already had one.

**Status:** active. The caller-level sibling of [G20], which is the same
mechanism one layer down — there an `await` between a boolean guard and the
check that reads it, here an `await` between a read and the write that depends
on it. Related: [G45] (why the store's own contracts cannot catch this), [G19]
(the second public path a handler-level rule has to be checked against).

---

## G101 — `realpathSync` reports `ENOENT` for a dangling symlink and for an absent path alike, so "fall back to the literal path" destroys the link

**Trigger:** resolving a user-configurable file path before writing it —
especially before a `rename`-based atomic replace — where the path may not exist
yet.

**Rule:** do not use `realpathSync` to find a write target. Walk the chain
yourself, bounded, and distinguish the two states `realpathSync` conflates:

- `lstatSync(p)` throws `ENOENT` ⇒ **`p` is the target** (nothing there yet).
- `lstatSync(p)` says not a symlink ⇒ **`p` is the target**.
- `lstatSync(p)` says symlink ⇒ `readlinkSync(p)`; `p` becomes the link text
  when absolute, otherwise `resolve(dirname(p), link)`. Continue.
- A hop cap (32 here) ⇒ fail. A link cycle must not spin.

**Why:** `realpathSync` resolves the *whole* chain and throws `ENOENT` both when
the path itself is absent and when a symlink in the chain points at something
absent. A fallback reading "on `ENOENT`, use the literal path" therefore cannot
tell those apart, and in the dangling case it renames the new file **over the
symlink**, deleting the link and writing the content at the link's own pathname.
The user's dotfile manager or synced folder silently stops being wired up, and
the first save is when it happens — the state where the target does not exist
yet is exactly the *normal first run* for that setup.

`rename` is what makes this destructive rather than merely wrong: an in-place
`writeFileSync` follows a symlink, dangling or not, so this whole class of bug
**appears only once you make the write atomic**, which is the opposite of the
direction people expect a robustness fix to break things in.

**Verify:** create a symlink whose target does not exist but whose parent
directory does, save through it, and assert `lstatSync(link).isSymbolicLink()`
is still `true` and the formerly absent target now holds the content — case (g)
in `tests/unit/location-store.test.ts`. Restoring the `realpathSync` fallback
turns **that case and only that case** red; the live-target symlink case stays
green, which is why both cases exist ([G45]).

**Evidence:** 2026-09-18 (`76f73e6`, saved-locations-durability T3). Raised as a
blocker by the `/plan-review` codex leg (R2) against the plan text, with a
direct `/tmp` reproduction of the proposed code:
`{"targetWasLiteralLink":true,"linkIsSymlinkAfterRename":false,"intendedTargetExists":false}`.
The plan had explicitly claimed the fallback "covers a dangling link".

**Status:** active. Lint candidate — `realpathSync` appearing anywhere near a
`renameSync` is greppable. Related: [G102] (the other way the same atomic write
can publish something wrong), [G23] (two error codes that look like one
condition).

---

## G102 — An atomic `rename` does not make an unchecked `writeSync` complete; it publishes the truncation indivisibly

**Trigger:** any `writeSync`/`write` whose return value is discarded, and
especially one inside a temp-file-plus-`rename` sequence.

**Rule:** loop until the whole buffer is written, and treat no progress as a
failure. `fsync` and `rename` run **only after the loop completes**.

```ts
const buf = Buffer.from(data, 'utf8');
for (let off = 0; off < buf.length; ) {
  const n = writeSync(fd, buf, off, buf.length - off);
  if (!(n > 0)) throw <the save error>;   // zero or negative = no progress
  off += n;
}
```

**Why:** `writeSync` returns *the number of bytes written* and is not documented
to write the buffer whole (`node_modules/@types/node/fs.d.ts:2882-2909`). A
short write — a partial `write(2)` under `ENOSPC`, or one interrupted by a
signal — does not throw. It returns a smaller number that nobody reads. The
sequence then `fsync`s and `rename`s that **prefix** over the good file and
reports a successful save.

The trap is that the atomic replace makes this *worse*, not better. The whole
reason for the rename is "a reader sees the old file or the new one, never a
partial" — and an unchecked short write is how you hand the reader a partial
that is, by construction, indivisible and durable. The corruption the mechanism
exists to prevent arrives wearing the mechanism's own guarantee, and every
observable says the save succeeded.

**Verify:** spy on `writeSync` so the first call delegates with a truncated
length and returns that prefix count and later calls delegate in full; assert it
was called more than once and the final file is byte-identical to the full
payload — case (h) in `tests/unit/location-store.test.ts`. A second case returns
`0` and asserts the save fails with the target's bytes unchanged and no temp
residue. Restoring a single unchecked `writeSync` turns **exactly those two**
red.

**Evidence:** 2026-09-18 (`76f73e6`, saved-locations-durability T3). Raised as a
blocker by the `/plan-review` codex leg (R3) against the plan text, from the
installed `@types/node` declaration — no reproduction needed, because the
declaration says it outright and the plan had simply not read it.

**Status:** active. Lint candidate — a `writeSync(` whose result is not bound is
greppable. Related: [G101] (the other trap in the same atomic write), [G8] (a
bounded operation whose partial result must never be used as if it were
complete).

---

## G103 — `tsconfig.json` includes only `src/`, so nothing in the gate typechecks a test file

**Trigger:** writing or reviewing anything under `tests/` — most sharply a cast
that stands in for a real type (`{ geocode: vi.fn() } as unknown as
GeocodingService`), a fixture object built to match an upstream shape, or any
use of `unknown` the repo's "no `any`" convention is meant to police.

**Rule:** treat every type in a test file as **unchecked prose**. The compiler
will not tell you a cast lies, a fixture is missing a required field, or an
assertion compares two things that can never be equal. Where a test's
correctness rests on a type, prove it by **mutation** — break the subject and
watch the test go red — not by the fact that it compiled, because it never was
compiled. If you want a real check on one file, run `npx tsc --noEmit` against
it explicitly; the gate will not do it for you.

**Why:** the two halves of the gate each decline the job, and neither says so.
`tsconfig.json:27` is `"include": ["src/**/*"]`, so `npm run build` never reads
`tests/` at all — `tsc` emits zero errors because it was never handed the file.
Vitest then transpiles each module with esbuild, which strips types without
checking them ([G1]'s mechanism). So a test file is the one place in this
repository where `strict`, `noUnusedLocals`, `noImplicitReturns` and the
standing "no `any`" convention are **stated and not enforced**, and the CLAUDE.md
line declaring TypeScript strict across the project reads as though they are.

This is [G1] with the polarity reversed, and the pair is the whole picture: a
green `npm test` does not mean the build compiles, **and** a green
`npm run build` does not mean the tests typecheck. Neither alone is the
interesting fact; the two together mean a type error in `tests/` is invisible to
the entire gate.

The practical cost is a cast that silently stops describing its subject. The
house pattern for a handler fake is `as unknown as <Service>` — which suppresses
every structural check by construction, so a service that later grows a method
the handler calls leaves every such fake stale with no compiler signal. The fake
still satisfies the cast; the handler calls the missing method and the failure
arrives at runtime, in whichever test happens to exercise that path.

**Verify:**

```bash
cp tests/unit/<any>.test.ts /tmp/backup.test.ts
printf '\nconst deliberate: number = %s;\nvoid deliberate;\n' "'not a number'" >> tests/unit/<any>.test.ts
npm run build; echo "build exit=$?"          # 0 — the file was never read
npx vitest run tests/unit/<any>.test.ts      # green — esbuild strips, never checks
cp /tmp/backup.test.ts tests/unit/<any>.test.ts
```

Two greens is the trap intact; a non-zero build exit means `include` was widened
and this entry can be re-scoped or retired.

**Evidence:** 2026-09-18 (`9f53c5f`, search-location-limit-bound T2). Raised as a
"Surprise" by the executing subagent, which had followed
`tools-list-budget.test.ts`'s `unknown`-cast pattern for convention's sake and
then noticed nothing required it. Verified by the orchestrator before curation: a
`TS2322` (`const deliberateTypeError: number = 'not a number'`) planted in
`tests/unit/search-location-limit.test.ts` left `npm run build` at **exit 0** and
`npx vitest run` at **8/8 passing**; restored by `cp` with a green control run
([G27]).

**Status:** active. **Lint candidate, and the better fix is in the config rather
than in every reviewer** — a second `tsconfig.test.json` extending the base with
`"include": ["src/**/*", "tests/**/*"]` and `"noEmit": true`, run as a gate step,
would close this mechanically and cost one `tsc` pass. Until then the rule above
is the workaround. Related: [G1] (the mirror — a green suite over a broken
build), [G70] (a cast that hands the wrong seam a plausible fake), [G45] and
[G32] (mutation is the check that does work here), [G79] (the other way a test
can be green locally and not be what it claims).

---

## Graveyard

*(When an entry's trap is refactored away, move it here with the reason and the
commit that removed it — never delete, never renumber.)*

## G12 — `check-doc-versions.sh` validates fewer test-count and tool-count sites than `update-docs-for-release.sh` rewrites

**Retired:** 2026-09-11, closed by the issue-88 **site half**
([weather-mcp#88](https://github.com/weather-mcp/weather-mcp/issues/88)) — the plan that built one
shared site table in `scripts/lib/derived-facts.mjs` and made both release scripts read it. This
entry's own Status line named the condition: *"anchoring a check on `Run all [0-9,]+ tests` and one
on `docs/README.md`'s count would close both gaps mechanically and let this entry retire"*. Both
are now rows in that table, and the tool-count gap this entry was widened to cover closes with
them: **every site the writer rewrites is a row the checker validates** — twenty-one rows in eleven
files, where the checker previously validated nine of the writer's sixteen.

All **four** consumers the entry called unmanaged are now rows. The two it named —
`examples/README.md:22` and `.env.example:21` — and two it never found, one link out from
`README.md:6`'s own test badge: `docs/testing/TEST_SUITE_README.md` (twice) and
`docs/publishing/PUBLISHING.md`. Both were stale by more than 2,000 tests when the plan started
(`1,070` and `446` against a real 3,339), which is this entry's thesis holding in a place the entry
itself never looked.

**The v1.14.0 Evidence paragraph below is the reason the table is per-site rather than per-fact.**
One pattern per fact applied globally is exactly the mechanism that rewrote a correct `6 tools`
preset sentence into `17 tools` on the front page; anchoring each row to its own sentence, and
requiring each to match **exactly once**, is what makes a preset count unreachable by the total's
rewrite. Proven live 2026-09-11 (T6 E4): under an injected eighteenth tool, `docs/TOOLS.md:3` moved
17 → 18 while `:5` stayed at `6 tools`.

**The entry's standing lesson is now enforced by a test rather than by a Verify line.** *An entry
enumerating sites can be incomplete as easily as stale, so re-derive the list from
`update-docs-for-release.sh`* is `tests/unit/derived-facts.test.ts` **contract 2** — *every row
matches its real file exactly once* — which goes red the moment a site is reworded, duplicated or
drifts out of the table. That is also why the lesson outlived the entry: re-deriving from the
writer, as the entry advised, would still have missed all four of the unmanaged consumers above,
because the writer never rewrote them either.

**Trigger:** any change that moves the test count — i.e. every commit that adds
or removes a test — or the tool count, i.e. every commit that adds or removes a
tool.

**Rule:** when the count moves, **five** places change: `README.md`'s shields
badge (line ~6), `README.md`'s "N tests" body line (~61), `README.md`'s
`npm test` comment (~381), `CLAUDE.md`'s **Test Coverage** line (~579), and
`docs/README.md`'s **Test Coverage** line (~78).
`update-docs-for-release.sh` rewrites all five; the checker validates only
three. **Two are unvalidated — the `npm test` comment and `docs/README.md`** —
so read both back by eye after any hand-edit, and never infer either from a
green checker.

**Why:** two separate gaps. The checker's README test-count grep
(`[0-9,]+ (automated )?tests`) takes `head -1`, which lands on the body line at
~61 and never reaches the `Run all N tests` comment 320 lines further down. And
the script reads `docs/README.md` only for `Current Version:` (`:36-46`) — it has
exactly three test-count checks (`:83` README body, `:92` `CLAUDE.md`, `:101`
the badge) and never looks at that file's count at all. Both failures are silent
and read as success: `✅ README.md test count` while the comment is stale, and no
line at all about `docs/README.md`. `docs/README.md` is the more insidious of the
two, because `update-docs-for-release.sh:234-237` silently repairs it at the next
release — so the inconsistency is invisible until someone reads the file.

**The tool count has the same shape, and the asymmetry is worse.** Measured
2026-09-09 — re-measure rather than copying these; they moved once already on
the very branch that widened this entry. The writer rewrites `README.md` with a
global substitution (`grep -oE '\b[0-9]+ tools\b' README.md | wc -l` occurrences
— **6**, and 7 before the correction recorded in Evidence below), plus exactly
one site each in `CLAUDE.md`, `docs/TOOLS.md`, `package.json`, `server.json` and
`.github/social-preview.html`. Eleven sites. The checker validates **one
occurrence per file** across six files (`head -1` inside `check_tool_count`), so
**six of eleven are validated and the README's other five are not.** A wrong
number in any of those five reads as a clean run.

Two things this plan **closed**, so do not re-file them: the derivation is now a
single module (`scripts/lib/derived-facts.mjs`) reading `TOOL_NAMES` in
`src/config/tools.ts`, rather than three private greps over `src/index.ts`; and
a drift between that array and the derivation is now a **red test**
(`tests/unit/derived-facts.test.ts`). What stays open is the site table — issue
#88's remaining half — which is what this entry is about.

**Two tool-count consumers neither script manages at all.**
`examples/README.md:22` (*"All 17 tools appear across these examples"*) and
`.env.example:21` (*"All 10 tools…"*) both state a tool count, and neither the
writer nor the checker reads either file. `examples/README.md` happens to be
right today. `.env.example` is stale from v1.5.0 and wrong in four places: `:15`
calls `basic` five tools, `:17` omits `get_weather_summary` from the `basic`
list, and `:18-19` describe pre-1.11 `standard`/`full` memberships — the real
sizes are 6 / 12 / 17 (`src/config/tools.ts`). Both are consumers the future
site table must either manage or explicitly declare out of scope. **The
`.env.example` staleness is deliberately not fixed here** — it is a docs rewrite
with no bearing on the derivation, and it is filed for a standalone fix or #88's
site half.

**Verify:** set `Run all N tests` in `README.md` **and** the `N tests, 100% pass
rate` line in `docs/README.md` to deliberately wrong numbers, then run
`./scripts/check-doc-versions.sh` — it still reports all checks passed.

**Disproven 2026-09-11 (issue-88 site half, T6 E1).** Both sites are now rows in the shared table,
so the checker names both by `file:line` and exits 1. Run quoted under the tool-count twin below.

**Verify, tool-count twin:** set the README `all 17 tools` table cell (`:227`)
to `99 tools` and run the checker — it still passes, because `head -1` reads
only README's *first* occurrence at `:9`. **Run 2026-09-09**
(issue-88-tool-count-source T8): with `:227` reading `| \`all\` | all 99 tools |`
and `:9` untouched, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` printed
`✅ README.md tool count: 17` and `✅ All documentation checks passed!` at
**exit 0**. The trap is live on the tool count exactly as it is on the test
count. Restore from a file copy, never `git checkout --`.
**Disproven 2026-09-11 (issue-88 site half, T6 E1).** The same three-site experiment this entry
prescribes — `README.md:227` set to `| \`all\` | all 99 tools |`, `README.md:390` and
`docs/README.md:78` set to `9,999` — now **fails**, naming every one of them:

```
❌ README.md:227 tool count: 99 (expected 17)
❌ README.md:390 test count: 9999 (expected 3350)
❌ docs/README.md:78 test count: 9999 (expected 3350)
📊 Doc count sites: 21 rows — 18 ok, 3 failed, 0 skipped
❌ Found 3 documentation inconsistencies          [exit 1]
```

Do not use either Verify line to test this entry; they are kept as the record of what the trap was.

**Verify line re-run 2026-08-28** (openmeteo-nullable-series-types curation, on a
tree whose count had just moved 2,809 → 2,814): both sites set to `9,999`, and
the script still printed `✅ README.md test count: 2814`, `✅ CLAUDE.md test
count: 2814` and `✅ All documentation checks passed!`. The trap is intact and
unchanged. (The same
experiment on the **badge** now correctly fails; do not use the badge to test this
entry.)

**Evidence — this trap has already fired in production, on the front page.**
`README.md`'s default-preset sentence was authored `6 tools` correctly at
`1e960b9` (v1.11.0) and silently rewritten to `17 tools` by
`db84d03 chore: Release v1.14.0`, an automated release commit, because the
writer's README substitution is global and cannot tell a preset count from a
total. The `basic` preset holds six; the sentence's own list names six. It
stated a falsehood on the project's front page for **every release from v1.14.0
to v1.29.0**, and no check ever caught it, because the checker's `head -1` reads
only README's first occurrence (`:9`) and never reached `:91`. Corrected
2026-09-09 by rewording the sentence to name the `basic` preset instead of a
number, which puts the site permanently out of the writer's reach. Re-derive
with `git log -L '/\*\*Default preset:\*\*/,+1:README.md'`. This is the
strongest evidence this entry carries, because it is the entry's own
hypothetical actually happening.

**Evidence:** first recorded 2026-08-24 (`338c2b0`) as "the badge is never
validated". Re-running that Verify line on 2026-08-24 during the
changelog-link-refs run **falsified the badge half**: `tests-9%2C999%20passing`
extracts `9999` and reports `❌`, because `31ce822` (2026-07-07) had already
added the encoded-badge check this entry's own Status line had proposed as its
lint candidate — the entry was written against a stale reading of the script.
The `head -1` gap at `README.md:390` is real and survives, confirmed by the same
deliberate-wrong-value experiment: `9,999` there still reports `✅`.

**Broadened 2026-08-25** (`99ba469`, lightning-safe-message-coherence): a
**fifth** site, `docs/README.md`'s **Test Coverage** line, was found by the
Antigravity plan review (R2) — a site this entry had never listed, and one the
checker never reads. The review's stated consequence ("the acceptance gate will
fail") was wrong, which is the point: it fails *silently*. Verify line re-run the
same day with **both** unvalidated sites set to `9,999`, and
`./scripts/check-doc-versions.sh` still reported `✅ All documentation checks
passed!`.

**A plan can also get this wrong one level up, 2026-08-29** (`17b2699`, issue-86
territory NWPS coverage T4): the implementation plan reasoned that *"no
version/tool/test-count string changes"* occurred because *"the test-count anchors
are rewritten only by `/release`"*, and so tasked no doc update at all — while its
own T4 acceptance required `check-doc-versions.sh` to pass. The test task then
added seven tests (2,815 → 2,822) and left the checker **red on the branch**. The
anchors are not `/release`'s alone: the immediately preceding commit on `main`,
`90041f1` (a `test:` commit), moved the README badge 2,814 → 2,815 by hand. **The
commit that moves the count moves the five sites with it**; `/release` rewrites
them again, but it is not the first or only writer. A plan that adds or removes a
test must task the doc update, and a plan asserting the count does not move should
be tested against the suite rather than believed.

**Status:** **retired 2026-09-11** (issue-88 site half — see the Retired paragraph above; the entry is kept whole as the record of the trap). Formerly active, **widened 2026-09-09 (issue-88 source half)** — the entry now covers the tool count as well as the test count; the lint candidate below is half-closed, since the *derivation* half is now a single module with a red test behind it while the *site* half is untouched. **narrowed** 2026-08-24, **broadened and re-verified
2026-08-25**, **Verify line re-run 2026-09-08** (`f4115f2`, forecast-auto-source-contract T7 — the count moved 3,292 -> 3,304 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `3,304`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 3304`, `✅ CLAUDE.md test count: 3304`, `✅ README.md tests badge: 3304` and `✅ All documentation checks passed!` at exit 0, never once naming `docs/README.md` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-09-03, second time** (`4cac538`, critical-alert-banner diff-triage MAJOR-5 — the count moved 3,132 → 3,250 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `3,250`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 3250`, `✅ CLAUDE.md test count: 3250`, `✅ README.md tests badge: 3250` and `✅ All documentation checks passed!` at exit 0, never once naming `docs/README.md` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-09-03** (`99cc032`, jma-service-residuals T4 — the count moved 3,130 → 3,132 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `3,132`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 3132`, `✅ CLAUDE.md test count: 3132`, `✅ README.md tests badge: 3132` and `✅ All documentation checks passed!` at exit 0, never once naming `docs/README.md` — the trap is intact and both gaps are still exactly the two this entry names), **extended 2026-08-29**, **Verify line re-run 2026-09-02** (`d65ef25`, noaa-forecast-horizon-disclosure T2 — the count moved 2,933 → 2,941 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,941`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ All documentation checks passed!` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-09-01, second time** (`f48eda3`, openmeteo-nullable-scalar-types T6 — the count moved 2,917 → 2,933 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,933`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 2933`, `✅ CLAUDE.md test count: 2933`, `✅ README.md tests badge: 2933` and `✅ All documentation checks passed!` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-09-01** (`18489ed`, marine-sea-state-taxonomy T4 — the count moved 2,900 → 2,917 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,917`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 2917`, `✅ CLAUDE.md test count: 2917`, `✅ README.md tests badge: 2917` and `✅ All documentation checks passed!` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-08-27** (`7a1e65d`, wildfire
band-rounding T2 — the count moved 2,611 → 2,660 and all five sites were edited
by content; with both unvalidated sites then set to `9,999` against the real
`2,660`, `./scripts/check-doc-versions.sh` still printed `✅ README.md test
count`, `✅ CLAUDE.md test count`, `✅ README.md tests badge` and `✅ All
documentation checks passed!`, never once naming the two it does not read — the
trap is intact and both gaps are still exactly the two this entry names), **and
2026-08-26** (`07661a9`,
issue-78-log-level-numeric T2 — both unvalidated sites set to `9,999` with the
real count at `2,606`, and `./scripts/check-doc-versions.sh` still reported
`✅ All documentation checks passed!`; the trap is intact and unchanged, and
both gaps are still exactly the two this entry names). **Verify line re-run again 2026-08-27** (`a734bf0`/`ffe8e6b`, issue-82
display-band-coherence T5 and T6 — the count moved 2,700 → 2,717 → 2,742 and all
five sites were edited by content each time; with both unvalidated sites then set
to `9,999` against the real `2,742`, `env -u FORCE_COLOR
./scripts/check-doc-versions.sh` still printed `✅ README.md test count`,
`✅ CLAUDE.md test count` and `✅ All documentation checks passed!`, never once
naming the two it does not read — the trap is intact and both gaps are still
exactly the two this entry names). **Verify line re-run again 2026-08-28** (`b4d8722`, issue-83 absent-strike-distance T2 — the count moved 2,759 → 2,772 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,772`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count`, `✅ CLAUDE.md test count` and `✅ All documentation checks passed!`, never once naming the two it does not read — the trap is intact and both gaps are still exactly the two this entry names). **Verify line re-run again 2026-08-29** (`17b2699`, issue-86 territory NWPS coverage T4 — the count moved 2,815 → 2,822 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,822`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 2822`, `✅ CLAUDE.md test count: 2822`, `✅ README.md tests badge: 2822` and `✅ All documentation checks passed!`, never once naming the two it does not read — the trap is intact and both gaps are still exactly the two this entry names). Match every site by
content, never by line number — the `npm test`
comment has moved three times (346 → 381 → 390), and this entry's own citation
of it was stale by 44 lines until 2026-09-09. Lint candidate — anchoring a check on
`Run all [0-9,]+ tests` and one on `docs/README.md`'s count would close both gaps
mechanically and let this entry retire. Standing lesson beyond the specific gaps:
an entry asserting that a checker *misses* something has a shelf life, so run its
Verify line before relying on it — and an entry enumerating sites can be
**incomplete** as easily as stale, so re-derive the list from
`update-docs-for-release.sh` rather than trusting the entry's own count.

---

## G55 — The publish workflow reports failure after a successful publish, because its verification window is shorter than npm's own processing delay

**Retired:** 2026-08-30, fixed by `79ea177` (T1, [weather-mcp#90](https://github.com/weather-mcp/weather-mcp/issues/90)).
Two reasons. First, this entry duplicates [G39] — same trigger, same publish run,
a different remedy (widen the loop vs. read `curl` instead of `npm view`) — and
that duplication is itself how the `min-release-age` claim below survived
unchallenged: two entries citing each other's shape read as corroboration, not as
one trap described twice. Second, the `min-release-age` attribution in the Rule
below is disproven — marked in place, see below.

**Trigger:** reading the result of `publish.yml` after pushing a `vX.Y.Z` tag, or
deciding what to do about a red release run.

**Rule:** a red `publish.yml` is **not** evidence that nothing published. Read the
**`Publish to npm` step** before reacting: if it ends `+ @dangahagan/weather-mcp@X.Y.Z`,
the package is published and the tag is real. Confirm against the registry directly
with `curl -s https://registry.npmjs.org/@dangahagan%2Fweather-mcp`, **not**
`npm view` — this machine's npm config sets `min-release-age`, which returns a
plain `E404` for a version published minutes ago and looks identical to "never
published" ([G51]-family: a filtered read that reports as an absence).
**Disproven 2026-08-30:** tested directly at 05:50Z — with `min-release-age = 7`
live in the user's npm 12.0.2 config, `npm view @dangahagan/weather-mcp@1.25.13
version` returned `1.25.13` for a version published 26 minutes earlier, identical
to the result under `--min-release-age=0`. `min-release-age` gates **install and
pack resolution, not `view`**; the `E404` this rule attributed to it is far
better explained by the propagation lag documented three paragraphs above (and
in [G39]). The **[G51] citation above does not describe anything real here** —
drop it; it does not apply to this case. Never re-run the workflow and never
`npm publish` by hand on the strength of the red alone; a second publish of the
same version fails, and a second publish of a *bumped* version ships a release
nobody asked for.

**npm 12 consequence:** because the `E404` was propagation lag and not
`min-release-age`, this also settles what `publish.yml:29-30` defers — it pins
npm 11 with a comment promising to revisit for v12. Adopting npm 12 in CI would
**not** break the verify step. It also removes the argument this entry made for
switching the automated probe from `npm view` to `curl` in the first place — that
argument no longer holds either.

**Why:** the `Verify publication` step polls `npm view` 10 times at 15 s, so it
gives up after **150 s**, and npm answers the publish itself with *"Your package
is being processed and may take a few minutes to become available."* The two
numbers are simply not related, so the step is a race the registry is under no
obligation to win. It has now lost twice in a row.

**Verify:** `gh run view <id> --log | grep -a "Publish to npm" | tail -5` shows
the `+ @dangahagan/weather-mcp@X.Y.Z` line and the Sigstore provenance entry on a
run whose overall conclusion is `failure`.

**Evidence:** v1.25.11 (run 33235201174, 2026-08-29) and v1.25.12 (run
33270536961, same day) both concluded `failure` with **only** `Verify publication`
red; both packages published normally and both became `latest`. v1.25.12 is the
sharp case — the publish step logged `+ @dangahagan/weather-mcp@1.25.12` at
19:20:19Z, the verify step exhausted its ten attempts at 19:22:57Z, and the
registry's own `time` field records the version as available at **19:22:57.235Z**.
It missed by under a second. **Corrected 2026-08-30:** the give-up time here is
unanchored and about five seconds late. The step's own duration was measured at
153 s against a publish step ending 19:20:19Z, putting exhaustion at
**19:22:52Z** and the miss at **five seconds**, which is the figure [G39] now
carries. The point the entry was making is unchanged and if anything sharper.

**Status:** retired — superseded by [G39], which now carries this trap's live
status. `79ea177` widened the loop to 40 attempts at 15 s and turned exhaustion
into a `::warning::` + exit 0 instead of `::error::` + exit 1, so the verification
no longer fails on a successful publish. Related: [G28] (a probe that fails
reports as a clean negative), [G4] (never trust the status alone — here the
status is red and the outcome is success), [G47] (a control that proves the
measurement happened at all).
