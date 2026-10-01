#!/bin/bash
# scripts/check-doc-versions.sh
# Checks version consistency across all documentation

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Checking documentation version consistency..."
echo ""

# Get source of truth
PACKAGE_VERSION=$(node -p "require('./package.json').version")
echo "📦 package.json version: ${GREEN}${PACKAGE_VERSION}${NC}"
echo ""

ERRORS=0

# Check CLAUDE.md
CLAUDE_VERSION=$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' CLAUDE.md | head -1)
if [ -n "$CLAUDE_VERSION" ]; then
  if [ "$CLAUDE_VERSION" == "$PACKAGE_VERSION" ]; then
    echo "✅ CLAUDE.md version: ${GREEN}${CLAUDE_VERSION}${NC}"
  else
    echo "❌ CLAUDE.md version: ${RED}${CLAUDE_VERSION}${NC} (expected ${PACKAGE_VERSION})"
    ERRORS=$((ERRORS+1))
  fi
else
  echo "⚠️  CLAUDE.md version: ${YELLOW}Version not found${NC}"
fi

# Check docs/README.md
DOCS_README_VERSION=$(grep "Current Version:" docs/README.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [ -n "$DOCS_README_VERSION" ]; then
  if [ "$DOCS_README_VERSION" == "$PACKAGE_VERSION" ]; then
    echo "✅ docs/README.md version: ${GREEN}${DOCS_README_VERSION}${NC}"
  else
    echo "❌ docs/README.md version: ${RED}${DOCS_README_VERSION}${NC} (expected ${PACKAGE_VERSION})"
    ERRORS=$((ERRORS+1))
  fi
else
  echo "⚠️  docs/README.md version: ${YELLOW}Version not found${NC}"
fi

# Check CHANGELOG.md top entry
CHANGELOG_TOP_VERSION=$(grep -m 1 "^## \[[0-9]" CHANGELOG.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ "$CHANGELOG_TOP_VERSION" == "$PACKAGE_VERSION" ]; then
  echo "✅ CHANGELOG.md top entry: ${GREEN}v${CHANGELOG_TOP_VERSION}${NC}"
else
  echo "⚠️  CHANGELOG.md top entry: ${YELLOW}v${CHANGELOG_TOP_VERSION}${NC} (package.json is v${PACKAGE_VERSION})"
  echo "   Note: This is OK if working on next release (unreleased section)"
fi

# --- Tree checks: map coverage and home paths (begin) ---------------------------
# Two rules this project states as fact and nothing ran until now. Both read the
# tracked tree, not a diff, so a defect that landed in an earlier release still
# fails here. They run before the test suite below, so a failure costs seconds.
#
# 1. CLAUDE.md's src/ architecture map (GOTCHAS G31). Every top-level src/*.ts
#    file and every directory under src/ has a row, and every module in a
#    directory the map enumerates file by file is named — in the map block itself. The default is include: a new directory is checked until someone
#    adds it to EXCLUDED_DIRS, which is a visible edit. The two excluded
#    directories are described in the map by pattern rather than file by file.
#    Matching is by basename, so config/cache.ts and utils/cache.ts cannot tell
#    each other apart; that grain is accepted (plan-release-governance-gates).
# 2. No absolute home path in a committed file (bindings, "Never in a committed
#    file"). The /release leak scan reads only the outgoing diff. The two
#    placeholder usernames are the documented examples; anything else is a real
#    path. The owner's own name is never written here, for the same reason.
echo ""
echo "🗺️  Checking the src/ architecture map in CLAUDE.md..."
EXCLUDED_DIRS="types analytics"
MAP_ERRORS=0
# Only the fenced block that opens with "src/" counts as the map: a module named
# in prose elsewhere in CLAUDE.md is not mapped (diff-review copilot-F1).
MAP_BLOCK=$(awk '/^```$/ { if (in_map) exit; getline next_line; if (next_line == "src/") in_map = 1; next } in_map' CLAUDE.md)
if [ -z "$MAP_BLOCK" ]; then
  echo "❌ CLAUDE.md has no fenced block opening with 'src/' — the architecture map could not be read"
  MAP_ERRORS=$((MAP_ERRORS+1))
fi
for f in src/*.ts; do
  [ -n "$MAP_BLOCK" ] || break   # one error above, not one per module
  [ -e "$f" ] || continue
  base_re=$(basename "$f" | sed 's/\./\\./g')
  if ! grep -qE "^[├└]── ${base_re}" <<< "$MAP_BLOCK"; then
    echo "❌ ${f} has no row in CLAUDE.md's map — add a '── $(basename "$f")' row to the src/ tree"
    MAP_ERRORS=$((MAP_ERRORS+1))
  fi
done
for d in src/*/; do
  [ -n "$MAP_BLOCK" ] || break
  name=$(basename "$d")
  if ! grep -qE "^[├└]── ${name}/" <<< "$MAP_BLOCK"; then
    echo "❌ src/${name}/ has no row in CLAUDE.md's map — add a '── ${name}/' row to the src/ tree"
    MAP_ERRORS=$((MAP_ERRORS+1))
  fi
  case " $EXCLUDED_DIRS " in *" $name "*) continue ;; esac
  for f in "$d"*.ts; do
    [ -e "$f" ] || continue
    # Anchored on the left: a bare substring match lets a.ts pass on jma.ts.
    base_re=$(basename "$f" | sed 's/\./\\./g')
    if ! grep -qE "(^|[^A-Za-z0-9_])${base_re}" <<< "$MAP_BLOCK"; then
      echo "❌ ${f} is not named in CLAUDE.md's map — add a line for it under src/${name}/"
      MAP_ERRORS=$((MAP_ERRORS+1))
    fi
  done
done
if [ $MAP_ERRORS -eq 0 ]; then
  echo "✅ Architecture map: ${GREEN}every src/ directory has a row; every enumerated module is named${NC}"
fi
ERRORS=$((ERRORS+MAP_ERRORS))

echo ""
echo "🏠 Checking tracked files for absolute home paths..."
HOME_PLACEHOLDERS='you|user'
HOME_HITS=$(git grep -n -E '(/var)?/home/[A-Za-z0-9_-]+/|/Users/[A-Za-z0-9_.-]+/|[A-Z]:\\Users\\' -- . |
  grep -vE "/home/(${HOME_PLACEHOLDERS})/" || true)
if [ -z "$HOME_HITS" ]; then
  echo "✅ Home paths: ${GREEN}none outside the placeholders (/home/you/, /home/user/)${NC}"
else
  while IFS= read -r hit; do
    echo "❌ Home path in a committed file: ${RED}${hit}${NC}"
    echo "   Replace it with a placeholder (/home/you/) or a relative path"
    ERRORS=$((ERRORS+1))
  done <<< "$HOME_HITS"
fi
# --- Tree checks (end) ------------------------------------------------------------

# Check test count consistency
echo ""
echo "🧪 Checking test count consistency..."
# Vitest prints "Tests  1930 passed (1930)" when green, but
# "Tests  1 failed | 1929 passed (1930)" when anything fails. The
# parenthetical total is the count the docs quote in both cases, so anchor
# on it — reading the first number in the line makes one flaky live-network
# test report a suite of 1 and three phantom doc mismatches.
# That parse is shared with the release writer through
# scripts/lib/derived-facts.mjs, so the two scripts cannot disagree about how
# many tests there are; this script keeps its own pick of the summary line.
# `|| true` keeps a red suite from aborting the script under `set -e`.
TEST_OUTPUT=$(npm test 2>&1 || true)
TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep -E "Tests[[:space:]]+[0-9]" | tail -1)
TEST_COUNT=$(node scripts/lib/derived-facts.mjs test-count "$TEST_SUMMARY" || true)
if [ -n "$TEST_COUNT" ]; then
  echo "📊 Actual test count: ${GREEN}${TEST_COUNT}${NC}"

  # Documentation can be perfectly consistent while the suite is red — that
  # is a test problem, not a doc problem, so say so without failing here.
  if node scripts/lib/derived-facts.mjs is-red "$TEST_SUMMARY"; then
    echo "⚠️  ${YELLOW}Test suite is not green${NC} — counts checked against the total; run 'npm test'"
  fi
else
  echo "⚠️  Could not determine test count (npm test failed?)"
fi

# Check tool count consistency (source of truth: TOOL_NAMES in src/config/tools.ts,
# read through scripts/lib/derived-facts.mjs — the same derivation the release
# writer and the stress harness use, so the three cannot disagree)
echo ""
echo "🔧 Checking tool count consistency..."
TOOL_COUNT=$(node scripts/lib/derived-facts.mjs tool-count)
echo "📊 Tools declared in src/config/tools.ts: ${GREEN}${TOOL_COUNT}${NC}"

# Every tool-count and test-count site in the docs, from the one table the
# release writer rewrites from (DOC_SITES in scripts/lib/derived-facts.mjs).
# The checker cannot cover less ground than the writer because there is one
# list; each row must match exactly once, so a reworded or duplicated site
# fails here instead of escaping it. test-count rows are skipped, with a
# warning, when the suite produced no count — tool counts are still checked
# then.
echo ""
echo "📋 Checking every doc count site..."
SITES_RC=0
SITES_OUT=$(node scripts/lib/derived-facts.mjs check-sites "$TEST_COUNT") || SITES_RC=$?
printf '%s\n' "$SITES_OUT"
SITE_FAILURES=$(printf '%s\n' "$SITES_OUT" | sed -nE 's/^📊 Doc count sites: .* ([0-9]+) failed.*/\1/p')
if [ -z "$SITE_FAILURES" ]; then
  # No summary line means the verb did not run to completion — never read that as clean.
  echo "❌ Doc count sites: ${RED}check-sites produced no summary (exit ${SITES_RC})${NC}"
  ERRORS=$((ERRORS+1))
else
  ERRORS=$((ERRORS+SITE_FAILURES))
fi

# Check MCP registry field constraints on server.json (enforced only at
# `mcp-publisher publish` time, so a violation otherwise surfaces mid-publish).
echo ""
echo "📋 Checking server.json MCP registry constraints..."
# The registry caps `description` at 100 characters.
DESC_LEN=$(node -p "require('./server.json').description.length" 2>/dev/null)
if [ -z "$DESC_LEN" ]; then
  echo "❌ server.json description: ${RED}could not read${NC}"
  ERRORS=$((ERRORS+1))
elif [ "$DESC_LEN" -le 100 ]; then
  echo "✅ server.json description length: ${GREEN}${DESC_LEN}${NC} (≤ 100)"
else
  echo "❌ server.json description length: ${RED}${DESC_LEN}${NC} (registry limit is 100)"
  ERRORS=$((ERRORS+1))
fi

# Check for broken internal links
echo ""
echo "🔗 Checking for broken documentation links in README.md..."
BROKEN_LINKS=0
while IFS= read -r link; do
  # Extract file path from markdown link
  filepath=$(echo "$link" | sed -E 's/.*\(([^)]+)\).*/\1/' | sed 's/^.\///')
  if [ ! -f "$filepath" ]; then
    echo "❌ Broken link in README.md: ${RED}${filepath}${NC}"
    BROKEN_LINKS=$((BROKEN_LINKS+1))
    ERRORS=$((ERRORS+1))
  fi
done < <(grep -oE '\[.*\]\(\./[^)]+\.md\)' README.md)

if [ $BROKEN_LINKS -eq 0 ]; then
  echo "✅ All documentation links valid"
fi

# --- CHANGELOG link-reference block (R1-R5) -----------------------------------
# Every "## [X.Y.Z]" heading in CHANGELOG.md is a Markdown *reference* link: it
# renders as a diff link only when a matching "[X.Y.Z]: <url>" definition exists
# in the block at the foot of the file. Nineteen releases' worth of missing
# definitions accumulated unnoticed and were repaired by hand in PR #75. Three
# rules keep the block from drifting again:
#
#   R1  every heading that has a matching vX.Y.Z git tag has a definition
#   R2  every definition names a tag that exists
#   R3  [Unreleased]: exists and compares against the newest tag
#   R4  the version being prepped has a definition, tag or no tag
#   R5  every definition's URL is the one the emitter would have written
#
# The invariant is keyed off **git tags, not headings** — deliberately. A number
# of early sections were never tagged, so no compare URL can honestly be written
# for them; one naming a tag that does not exist looks authoritative and 404s.
# Keying off tags makes those sections legal by construction rather than by a
# hardcoded exception list, which would drift the moment another one appeared —
# which is why no version is named anywhere in this block. Bare sections are
# bare on purpose; do not "fix" them by adding definitions.
#
# One exemption: the package.json version is exempt from R2 and R3's
# tag-existence requirement. update-docs-for-release.sh writes both lines during
# release prep (step 3) and then runs this script (step 9) *before* the human
# cuts the tag at step 4 of its printed "Next steps" — so at that moment the new
# version legitimately has a heading and a definition but no tag. Without the
# exemption every release would fail its own verification step.
#
# R4 is what keeps that exemption from casting a shadow. R1 is keyed off tags, so
# it skips the untagged version being prepped — which is the one version a release
# run exists to verify, and the one whose missing definition this whole block was
# written to prevent. R4 checks exactly that version, exactly while it has no tag,
# so the two rules partition the headings instead of leaving a gap between them.
echo ""
echo "🔗 Checking CHANGELOG link-reference block..."

CHANGELOG_HEADINGS=$(grep -oE '^## \[[0-9][^]]*\]' CHANGELOG.md | sed -E 's/^## \[//;s/\]$//' || true)
CHANGELOG_DEFS=$(grep -oE '^\[[0-9][^]]*\]:' CHANGELOG.md | sed -E 's/^\[//;s/\]:$//' || true)
# Deliberately one assignment: forcing this to "" is how the empty-tag-set path
# below gets exercised, without contriving a tagless clone.
GIT_TAG_VERSIONS=$(git tag -l 'v*' | sed -E 's/^v//' || true)

if [ -z "$GIT_TAG_VERSIONS" ]; then
  # A shallow or tagless checkout is a checkout artifact, not documentation
  # drift. Say the block was NOT checked — never print a ✅ nobody earned.
  echo "⚠️  ${YELLOW}CHANGELOG link block not checked${NC} — this checkout has no vX.Y.Z tags"
else
  LINK_ERRORS=0
  NEWEST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -1)

  # Exact whole-line membership in a newline-separated list.
  version_in_list() { printf '%s\n' "$2" | grep -qxF "$1"; }

  # R1 — a tagged heading must have a definition.
  for v in $CHANGELOG_HEADINGS; do
    if version_in_list "$v" "$GIT_TAG_VERSIONS" && ! version_in_list "$v" "$CHANGELOG_DEFS"; then
      echo "❌ CHANGELOG: heading ${RED}[${v}]${NC} is tagged (v${v}) but has no link definition"
      LINK_ERRORS=$((LINK_ERRORS+1))
    fi
  done

  # R2 — a definition must name a tag that exists (or the version being prepped).
  for v in $CHANGELOG_DEFS; do
    if ! version_in_list "$v" "$GIT_TAG_VERSIONS" && [ "$v" != "$PACKAGE_VERSION" ]; then
      echo "❌ CHANGELOG: definition ${RED}[${v}]${NC} names tag v${v}, which does not exist"
      LINK_ERRORS=$((LINK_ERRORS+1))
    fi
  done

  # R3 — [Unreleased] must exist and compare against the newest tag.
  UNRELEASED_BASE=$(grep -oE '^\[Unreleased\]: .*/compare/v[0-9][^ ]*\.\.\.HEAD' CHANGELOG.md |
    head -1 | sed -E 's#^.*/compare/##;s#\.\.\.HEAD$##' || true)
  if ! grep -qE '^\[Unreleased\]: ' CHANGELOG.md; then
    echo "❌ CHANGELOG: ${RED}no [Unreleased]: link definition${NC}"
    LINK_ERRORS=$((LINK_ERRORS+1))
  elif [ "$UNRELEASED_BASE" != "$NEWEST_TAG" ] && [ "$UNRELEASED_BASE" != "v${PACKAGE_VERSION}" ]; then
    echo "❌ CHANGELOG: [Unreleased] compares against ${RED}${UNRELEASED_BASE:-an unparseable base}${NC} (expected ${NEWEST_TAG})"
    LINK_ERRORS=$((LINK_ERRORS+1))
  fi

  # R4 — the prepped version has no tag yet, so R1 skips it. Only fires while the
  # tag is absent, so it complements R1 rather than double-reporting with it.
  if ! version_in_list "$PACKAGE_VERSION" "$GIT_TAG_VERSIONS" &&
     version_in_list "$PACKAGE_VERSION" "$CHANGELOG_HEADINGS" &&
     ! version_in_list "$PACKAGE_VERSION" "$CHANGELOG_DEFS"; then
    echo "❌ CHANGELOG: heading ${RED}[${PACKAGE_VERSION}]${NC} is being released but has no link definition"
    LINK_ERRORS=$((LINK_ERRORS+1))
  fi

  # R5 — R2 checks a definition's *key*; this checks its *value*. Without it a
  # definition can name a real tag and still point anywhere at all: a URL built
  # from a checkpoint tag (compare/backup-before-refactor...v1.25.0) resolves on
  # GitHub and quietly shows the wrong diff range. The legal forms are exactly the
  # two the emitter writes — a compare ending in ...v<version> whose left side is
  # a real tag, or the releases/tag form the earliest release uses. The base is
  # read from [Unreleased] rather than hardcoded, the same way the emitter does it.
  LINK_BASE=$(grep -oE '^\[Unreleased\]: \S+' CHANGELOG.md | head -1 |
    sed -E 's/^\[Unreleased\]: //;s#/(compare|releases)/.*##')
  if [ -n "$LINK_BASE" ]; then
    while read -r key url; do
      # Skip anything R2 already rejected, so one broken line gets one message.
      if ! version_in_list "$key" "$GIT_TAG_VERSIONS" && [ "$key" != "$PACKAGE_VERSION" ]; then
        continue
      fi
      case "$url" in
        "$LINK_BASE"/*) ;;
        *)
          echo "❌ CHANGELOG: definition ${RED}[${key}]${NC} does not point at ${LINK_BASE}"
          LINK_ERRORS=$((LINK_ERRORS+1))
          continue
          ;;
      esac
      rest=${url#"$LINK_BASE"/}
      case "$rest" in
        compare/*...*)
          left=${rest#compare/}; left=${left%...*}
          right=${rest##*...}
          if [ "$right" != "v${key}" ]; then
            echo "❌ CHANGELOG: definition ${RED}[${key}]${NC} compares to ${RED}${right}${NC}, not v${key}"
            LINK_ERRORS=$((LINK_ERRORS+1))
          elif ! version_in_list "${left#v}" "$GIT_TAG_VERSIONS"; then
            echo "❌ CHANGELOG: definition ${RED}[${key}]${NC} compares from ${RED}${left}${NC}, which is not a vX.Y.Z tag"
            LINK_ERRORS=$((LINK_ERRORS+1))
          fi
          ;;
        releases/tag/v"${key}") ;;
        *)
          echo "❌ CHANGELOG: definition ${RED}[${key}]${NC} has an unrecognised URL form: ${RED}${rest}${NC}"
          LINK_ERRORS=$((LINK_ERRORS+1))
          ;;
      esac
    done < <(grep -oE '^\[[0-9][^]]*\]: \S+' CHANGELOG.md | sed -E 's/^\[([^]]*)\]: /\1 /')
  fi

  if [ $LINK_ERRORS -eq 0 ]; then
    DEF_COUNT=$(printf '%s\n' "$CHANGELOG_DEFS" | grep -c . || true)
    echo "✅ CHANGELOG link block: ${GREEN}${DEF_COUNT} definitions, [Unreleased] → ${UNRELEASED_BASE}${NC}"
  fi
  ERRORS=$((ERRORS+LINK_ERRORS))
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
  echo "✅ ${GREEN}All documentation checks passed!${NC}"
  exit 0
else
  echo "❌ ${RED}Found ${ERRORS} documentation inconsistencies${NC}"
  echo ""
  echo "Run this command to see what needs updating:"
  echo "  grep -rn 'Version:' CLAUDE.md docs/README.md"
  echo "  grep -A 5 '^## \[' CHANGELOG.md | head -20"
  exit 1
fi
