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

**Status:** active, **extended 2026-08-27 and 2026-09-02**, **re-run 2026-09-01**
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

## G12 — `check-doc-versions.sh` validates three of the **five** test-count sites

**Trigger:** any change that moves the test count — i.e. every commit that adds
or removes a test.

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
the script reads `docs/README.md` only for `Current Version:` (`:60-70`) — it has
exactly three test-count checks (`:104` README body, `:113` `CLAUDE.md`, `:122`
the badge) and never looks at that file's count at all. Both failures are silent
and read as success: `✅ README.md test count` while the comment is stale, and no
line at all about `docs/README.md`. `docs/README.md` is the more insidious of the
two, because `update-docs-for-release.sh:219-222` silently repairs it at the next
release — so the inconsistency is invisible until someone reads the file.

**Verify:** set `Run all N tests` in `README.md` **and** the `N tests, 100% pass
rate` line in `docs/README.md` to deliberately wrong numbers, then run
`./scripts/check-doc-versions.sh` — it still reports all checks passed.
**Verify line re-run 2026-08-28** (openmeteo-nullable-series-types curation, on a
tree whose count had just moved 2,809 → 2,814): both sites set to `9,999`, and
the script still printed `✅ README.md test count: 2814`, `✅ CLAUDE.md test
count: 2814` and `✅ All documentation checks passed!`. The trap is intact and
unchanged. (The same
experiment on the **badge** now correctly fails; do not use the badge to test this
entry.)

**Evidence:** first recorded 2026-08-24 (`338c2b0`) as "the badge is never
validated". Re-running that Verify line on 2026-08-24 during the
changelog-link-refs run **falsified the badge half**: `tests-9%2C999%20passing`
extracts `9999` and reports `❌`, because `31ce822` (2026-07-07) had already
added the encoded-badge check this entry's own Status line had proposed as its
lint candidate — the entry was written against a stale reading of the script.
The `head -1` gap at `README.md:346` is real and survives, confirmed by the same
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

**Status:** active, **narrowed** 2026-08-24, **broadened and re-verified
2026-08-25**, **extended 2026-08-29**, **Verify line re-run 2026-09-02** (`d65ef25`, noaa-forecast-horizon-disclosure T2 — the count moved 2,933 → 2,941 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,941`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ All documentation checks passed!` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-09-01, second time** (`f48eda3`, openmeteo-nullable-scalar-types T6 — the count moved 2,917 → 2,933 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,933`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 2933`, `✅ CLAUDE.md test count: 2933`, `✅ README.md tests badge: 2933` and `✅ All documentation checks passed!` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-09-01** (`18489ed`, marine-sea-state-taxonomy T4 — the count moved 2,900 → 2,917 and all five sites were edited by content; with both unvalidated sites then set to `9,999` against the real `2,917`, `env -u FORCE_COLOR ./scripts/check-doc-versions.sh` still printed `✅ README.md test count: 2917`, `✅ CLAUDE.md test count: 2917`, `✅ README.md tests badge: 2917` and `✅ All documentation checks passed!` — the trap is intact and both gaps are still exactly the two this entry names), **Verify line re-run 2026-08-27** (`7a1e65d`, wildfire
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
comment has moved twice (346 → 381). Lint candidate — anchoring a check on
`Run all [0-9,]+ tests` and one on `docs/README.md`'s count would close both gaps
mechanically and let this entry retire. Standing lesson beyond the specific gaps:
an entry asserting that a checker *misses* something has a shelf life, so run its
Verify line before relying on it — and an entry enumerating sites can be
**incomplete** as easily as stale, so re-derive the list from
`update-docs-for-release.sh` rather than trusting the entry's own count.

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

**Verify:** for any parameter the summary forwards, `grep -n "description: '" src/index.ts`
and read the specialized tool's declaration against the summary's. They should
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

**Trigger:** a task adds a file to `src/utils/`, `src/services/`, or `src/config/`
— especially a small pure helper introduced as an internal refactor rather than
as a user-visible feature.

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

**Verify:** `for f in src/utils/*.ts src/services/*.ts src/config/*.ts; do
grep -q "$(basename "$f")" CLAUDE.md || echo "MISSING FROM MAP: $f"; done`

**Evidence:** 2026-08-26 (v1.25.2 release, step 4b) — `src/utils/displayBanding.ts`
shipped on `feat/issue-80-lightning-band-rounding` with a design plan, an impl
plan with a dedicated docs task, a clean cross-vendor diff review (0 blockers,
0 majors) and a passing QA record, and **none of them** put it in `CLAUDE.md`'s
utils map. It was caught only by the release's structural pass, which asks what
the diff changed rather than what the changelog says. `CLAUDE.md:196` was in the
same position: it already stated "bands and categories are computed from the
rounded display value" and now had a shared helper enforcing it, with nothing
naming it.

**Status:** active. Load-bearing for plans 2 and 3 of the band-rounding sequence,
which consume this same helper and may add their own. Lintable — the `Verify`
loop above is a two-line check that belongs in `check-doc-versions.sh`; until it
is there, it is a manual step in `## Docs impact`.

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
(`scripts/check-doc-versions.sh:163`). `node -p` inspects its result, and under
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

**Status:** active. **Not re-tested 2026-08-28** (openmeteo-nullable-series-types
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

**Status:** active, **extended twice on 2026-09-01**. Lint candidate on the vacuous half — a plan-authoring check
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

**Why:** the abort sits at step 4 (`:167`), but steps 1–3 have already run —
`npm version` has rewritten `package.json` and `package-lock.json` (`:39`),
`server.json` is synced (`:44`), and `[Unreleased]` is already promoted into a
dated `## [X.Y.Z]` section with its compare-link definition emitted (`:52-147`).
So a "failed" run leaves a **half-prepared release in the working tree**, and the
script's own precondition at `:32` (`git diff --quiet package.json server.json
CHANGELOG.md`) then refuses the obvious retry with *"has uncommitted changes.
Commit or stash first."*

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

**Verify:** `sed -n '32,34p;148,172p' scripts/update-docs-for-release.sh` — the
precondition guard and the red-suite abort, with steps 1–3 between them.

**Status:** active. Script candidate: move the test run ahead of the first write,
or trap a non-zero exit and revert the four files the script itself touched.
Related: [G30] (a first live lightning probe reports zero strikes — the other
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

**Status:** active, **extended 2026-08-29 and twice on 2026-09-01**. Related: [G13] (a fixture that cannot discriminate),
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

**Status:** active. Related: [G27] (restore by file copy, never `git checkout --`
— the same backup discipline for the uncommitted-fix case).

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

**Status:** active. Related: [G32] (mutate to every rejected implementation and
report the divergence set), [G45] (a mutation only goes red where the contract
reaches it), [G13] (a fixture degenerate along one axis), [G53] (the sibling from
the same review — what the short-circuited predicate was deciding).

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

**Trigger:** writing a unit test that imports any symbol from `src/index.ts` —
`TOOL_DEFINITIONS`, a schema fragment, or anything else added to it later.

**Rule:** `src/index.ts` calls `main()` unconditionally at module scope, so the
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

**Why:** the import is silent when it works and confusing when it does not — a
real transport reading the worker's stdin produces a hang or a protocol error
attributed to whatever test happens to be running, not to the import. It is also
easy to conclude the module is simply untestable and to relocate the symbol
instead; that is a much larger diff than the four lines above, and unnecessary.
Everything else in the module is already inert at import: the fifteen service
constructors do no I/O (`LocationStore` resolves its path and touches nothing
until a read or write) and `Cache` timers already run throughout the suite.
Note that `import 'dotenv/config'` (`src/index.ts:9`) means the import **does**
load the repo's own `.env` ([G26]), so nothing such a test asserts may depend on
a key or on `ENABLED_TOOLS`.

**Verify:** `tests/unit/tool-name-parity.test.ts` — the first test in the repo to
import `src/index.ts`, whose header and import block document all four points.
Delete the `vi.mock` and run it: the worker takes over stdin.

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

**Status:** active. The standing alternative — relocating `TOOL_DEFINITIONS` into
its own `src/toolDefinitions.ts` — was considered and rejected for tripling the
diff and adding a module ([G31]); revisit it if a second test needs a second
symbol from this file and the mock set has to grow. Related: [G21] (why point 3
is not optional), [G26] (the `.env` the import loads), [G37] (a driver that
constructs services and never exits).

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

**Status:** active. Related: [G41] (a check that cannot fail / cannot pass —
this is a lock that stops meaning what it says), [G29] (correcting a published
table sweeps the doc set; this entry is the test-suite half of the same
sweep). Partly lintable — the Verify grep enumerates candidates; only a human
knows which are proxies.

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

**Status:** active. The structural fix — running the live-network files in a
separate non-blocking job, or excluding them from the publish gate — is a
`publish.yml` change, not a test change; not planned. Related: [G39] (red
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

**Status:** active. Lint candidate (see Verify). Related: [G45] (the mutation
check that exposes it), [G21] (the other way a mock is not the thing you think
it is), and the project's determinism rule — anything mockable is mocked.

---

## Graveyard

*(When an entry's trap is refactored away, move it here with the reason and the
commit that removed it — never delete, never renumber.)*

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
