#!/bin/bash
# scripts/update-docs-for-release.sh
# Prepares a release: bumps versions, updates CHANGELOG and all doc
# references, and verifies consistency. After running, review the diff,
# commit, and push the vX.Y.Z tag — CI handles the npm publish.
#
# Usage:
#   ./scripts/update-docs-for-release.sh <patch|minor|major|X.Y.Z> ["one-line summary"]
#
# Examples:
#   ./scripts/update-docs-for-release.sh patch
#   ./scripts/update-docs-for-release.sh 1.9.0 "Saved-location support in all weather tools"
#
# CHANGELOG behavior:
#   - If "## [Unreleased]" has content, it is promoted into the new version
#     section (write your notes there as you develop).
#   - If it is empty, a draft section is seeded from conventional commits
#     since the last tag (feat->Added, fix->Fixed, security->Security,
#     everything else->Changed). Review and edit before committing.

set -euo pipefail

if [ $# -eq 0 ]; then
  grep '^# ' "$0" | sed 's/^# //;s/^#//' | head -18
  exit 1
fi

BUMP=$1
SUMMARY=${2:-}
TODAY=$(date +%Y-%m-%d)

if ! git diff --quiet package.json server.json CHANGELOG.md 2>/dev/null; then
  echo "❌ package.json, server.json, or CHANGELOG.md has uncommitted changes. Commit or stash first."
  exit 1
fi

# --- 1. Bump package.json (+ lockfile) ---------------------------------------
OLD_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
echo "📦 Version: ${OLD_VERSION} → ${NEW_VERSION}"

# --- 2. Sync server.json (MCP registry manifest) ------------------------------
node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('server.json', 'utf8'));
s.version = '${NEW_VERSION}';
for (const p of s.packages || []) p.version = '${NEW_VERSION}';
fs.writeFileSync('server.json', JSON.stringify(s, null, 2) + '\n');
"
echo "📝 server.json synced to ${NEW_VERSION}"

# --- 3. CHANGELOG: promote [Unreleased] or seed from git log ------------------
# --match='v*' is load-bearing: bare `git describe --tags` returns the nearest
# tag by ancestry of ANY shape, so a single checkpoint tag (say
# backup-before-refactor) would become the compare base and ship a link that
# resolves on GitHub while showing the wrong diff range. It must also agree with
# check-doc-versions.sh's R3, which reads `git tag -l 'v*' --sort=-v:refname`.
LAST_TAG=$(git describe --tags --abbrev=0 --match='v*' 2>/dev/null || echo "")
REL_VERSION="$NEW_VERSION" REL_DATE="$TODAY" REL_LAST_TAG="$LAST_TAG" node <<'EOF'
const fs = require('fs');
const { execSync } = require('child_process');
const { REL_VERSION: version, REL_DATE: today, REL_LAST_TAG: lastTag } = process.env;

let text = fs.readFileSync('CHANGELOG.md', 'utf8');
const m = text.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/);
if (!m) { console.error('❌ No "## [Unreleased]" section found in CHANGELOG.md'); process.exit(1); }

let body = m[1].trim();
if (body) {
  console.log('📝 CHANGELOG: promoting [Unreleased] content to ' + version);
} else {
  console.log('📝 CHANGELOG: [Unreleased] is empty — seeding draft from commits since ' + (lastTag || 'start'));
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const subjects = execSync(`git log ${range} --no-merges --pretty=%s`, { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  const groups = { Added: [], Fixed: [], Security: [], Changed: [] };
  for (const s of subjects) {
    const mm = s.match(/^(\w+)(\(.*\))?!?:\s*(.*)/);
    const type = mm ? mm[1] : '';
    const desc = mm ? mm[3] : s;
    if (type === 'feat') groups.Added.push(desc);
    else if (type === 'fix') groups.Fixed.push(desc);
    else if (type === 'security') groups.Security.push(desc);
    else groups.Changed.push(desc);
  }
  body = Object.entries(groups)
    .filter(([, items]) => items.length)
    .map(([h, items]) => `### ${h}\n` + items.map(i => `- ${i}`).join('\n'))
    .join('\n\n');
  if (!body) body = '### Changed\n- TODO: describe this release';
  console.log('   ⚠️  Review the seeded entries — they are raw commit subjects.');
}

text = text.replace(
  /## \[Unreleased\]\n[\s\S]*?(?=\n## \[)/,
  `## [Unreleased]\n\n## [${version}] - ${today}\n\n${body}\n`
);

// --- link-reference block at the foot of the file ----------------------------
// The heading just promoted is a Markdown *reference* link: it renders as a diff
// link only if a matching "[X.Y.Z]: <url>" definition exists in the block at the
// foot of CHANGELOG.md. Promoting the heading without writing the definition is
// how nineteen releases' worth of drift accumulated before being repaired by
// hand in PR #75; scripts/check-doc-versions.sh now asserts the result at step 9.
//
// The compare base is the previous **tag**, not the previous heading. Several
// early headings were never tagged, so e.g. [1.13.0] compares against v1.11.1 —
// lastTag (git describe --tags --match='v*') already holds exactly that value.
const unreleasedDef = text.match(/^\[Unreleased\]: (\S+)$/m);
if (!unreleasedDef) {
  console.error('❌ No "[Unreleased]: <url>" link definition found at the foot of CHANGELOG.md');
  console.error('   It is the anchor this script reads the repository URL from, and re-points.');
  process.exit(1);
}
const baseMatch = unreleasedDef[1].match(/^(https?:\/\/.+?)\/(?:compare|releases)\//);
if (!baseMatch) {
  console.error('❌ Could not derive a repository URL from the [Unreleased] link definition:');
  console.error(`   ${unreleasedDef[1]}`);
  process.exit(1);
}
const base = baseMatch[1];
// No previous tag means nothing to compare against — link the release itself.
const newDef = lastTag
  ? `[${version}]: ${base}/compare/${lastTag}...v${version}`
  : `[${version}]: ${base}/releases/tag/v${version}`;

// Both substitutions anchor on ^[Unreleased]: with the `m` flag and NO `g`. That
// is load-bearing: an unanchored substitution here would rewrite every older
// release's definition — the same failure the "New in" sed at the foot of this
// script carries its own warning about, after it happened during v1.14.0 prep.
text = text.replace(/^(\[Unreleased\]: \S+)$/m, `$1\n${newDef}`);
text = text.replace(/^\[Unreleased\]: \S+$/m, `[Unreleased]: ${base}/compare/v${version}...HEAD`);
console.log(`🔗 CHANGELOG: linked [${version}] against ${lastTag || 'its release tag'}`);

fs.writeFileSync('CHANGELOG.md', text);
EOF

# --- 4. Test count (also confirms the suite passes) ---------------------------
echo "🧪 Running tests to get current count..."
# The trailing `|| true` guards against `set -o pipefail` + `head -1` closing
# the pipe early (SIGPIPE makes the pipeline "fail" and silently killed the
# script here during v1.14.0 prep). The empty-count check below still catches
# a genuinely failed test run.
TEST_OUTPUT=$(npm test 2>&1 || true)
TEST_SUMMARY=$(printf '%s\n' "$TEST_OUTPUT" | grep -E "^[[:space:]]*Tests[[:space:]]+[0-9]" | tail -1 || true)
if [ -z "$TEST_SUMMARY" ]; then
  echo "❌ Could not determine test count — did npm test fail?"
  exit 1
fi
# A red suite must stop the release. Before v1.23.0 prep this block only
# checked for an *empty* count, so a single failing test sailed through — and
# because the summary then reads "Tests  1 failed | 2273 passed (2274)", the
# old "first number on the line" extraction wrote the **failure count** into
# the README badge and CLAUDE.md ("1 tests, 100% pass rate"). Both halves are
# fixed here: abort on failures, and read the number attached to "passed".
if printf '%s' "$TEST_SUMMARY" | grep -qE "[0-9]+ failed"; then
  echo "❌ Test suite is red — refusing to prepare a release:"
  echo "   ${TEST_SUMMARY}"
  echo "   (Six files under tests/integration/ make live network calls and flake."
  echo "    Re-run npm test to tell a flake from a real regression.)"
  exit 1
fi
TEST_COUNT=$(printf '%s' "$TEST_SUMMARY" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | head -1 || true)
if [ -z "$TEST_COUNT" ]; then
  echo "❌ Could not parse a passing-test count from: ${TEST_SUMMARY}"
  exit 1
fi
TEST_COUNT_FMT=$(node -p "(${TEST_COUNT}).toLocaleString('en-US')")
TEST_COUNT_BADGE=${TEST_COUNT_FMT//,/%2C}   # shields.io URL-encodes the comma
echo "   ${TEST_COUNT_FMT} tests passing"

# --- 5. Tool count (from the TOOL_DEFINITIONS registry in src/index.ts) --------
TOOL_COUNT=$(grep -cE "name: '[a-z_]+' as const" src/index.ts)
if [ "$TOOL_COUNT" -eq 0 ]; then
  echo "❌ Could not count tools in src/index.ts — did the TOOL_DEFINITIONS format change?"
  exit 1
fi
echo "🔧 ${TOOL_COUNT} MCP tools defined in src/index.ts"

# --- 6. Doc reference updates --------------------------------------------------
SUMMARY_TEXT=${SUMMARY:-"See CHANGELOG.md"}
# Escape sed-replacement metacharacters (/ & \) so summaries can contain paths
SUMMARY_SED=$(printf '%s' "$SUMMARY_TEXT" | sed -e 's/[\/&\\]/\\&/g')

# CLAUDE.md keeps a short "Recent releases" list — one line per release, capped
# at CLAUDE_RELEASE_LINES. Release narrative belongs in CHANGELOG.md and the
# plan docs, not here (the file was trimmed from 70 KB on 2026-08-22 for exactly
# this reason), so the cap is enforced by the script rather than by hand.
CLAUDE_RELEASE_LINES=3

# The prepend below anchors on the first existing "New in" line. If someone
# removes the last one, the sed would silently do nothing and the release
# would ship without its line — so refuse instead.
if ! grep -qE '^- \*\*New in v[0-9]' CLAUDE.md; then
  echo "❌ CLAUDE.md has no '- **New in vX.Y.Z:**' line to anchor on."
  echo "   Add one under '## Project Status' → 'Recent releases' and re-run."
  exit 1
fi

# Insert a new "New in" history line above the first existing one (first match
# only — an unanchored substitution here would rewrite every older release's
# line to the new summary, which is exactly what happened on v1.14.0 prep).
sed -i "0,/^- \*\*New in v[0-9]/s//- **New in v${NEW_VERSION}:** ${SUMMARY_SED}\n&/" CLAUDE.md

# Prune: keep only the newest CLAUDE_RELEASE_LINES "New in" lines. They are
# contiguous, so this drops the tail of the list and touches nothing else.
awk -v keep="$CLAUDE_RELEASE_LINES" '
  /^- \*\*New in v[0-9]/ { n++; if (n > keep) next }
  { print }
' CLAUDE.md > CLAUDE.md.tmp && mv CLAUDE.md.tmp CLAUDE.md

sed -i -E \
  -e "s/\*\*Version:\*\* [0-9]+\.[0-9]+\.[0-9]+/**Version:** ${NEW_VERSION}/g" \
  -e "s/\*\*Test Coverage:\*\* [0-9,]+ tests/**Test Coverage:** ${TEST_COUNT_FMT} tests/" \
  -e "s/[0-9]+ MCP Tools/${TOOL_COUNT} MCP Tools/" \
  -e "s/^\*\*Last Updated:\*\* .*/**Last Updated:** ${TODAY} (v${NEW_VERSION})/" \
  CLAUDE.md

sed -i -E \
  -e "s/- \*\*Current Version:\*\* .*/- **Current Version:** ${NEW_VERSION}/" \
  -e "s/\*\*Test Coverage:\*\* [0-9,]+ tests/**Test Coverage:** ${TEST_COUNT_FMT} tests/" \
  docs/README.md

# README: tests badge, test-count prose, and "N tools" mentions
sed -i -E \
  -e "s/tests-[0-9%C]+%20passing/tests-${TEST_COUNT_BADGE}%20passing/" \
  -e "s/TypeScript, [0-9,]+ tests/TypeScript, ${TEST_COUNT_FMT} tests/" \
  -e "s/Run all [0-9,]+ tests/Run all ${TEST_COUNT_FMT} tests/" \
  -e "s/\b[0-9]+ tools\b/${TOOL_COUNT} tools/g" \
  README.md

sed -i -E "s/all [0-9]+ MCP tools/all ${TOOL_COUNT} MCP tools/" docs/TOOLS.md

# npm and MCP registry descriptions mention the tool count
sed -i -E "s/[0-9]+ weather tools/${TOOL_COUNT} weather tools/" package.json server.json

echo "📝 Updated CLAUDE.md, docs/README.md, README.md, docs/TOOLS.md, package.json, server.json"

# --- 7. Social preview image (tool count in the tagline) ------------------------
if ! grep -q "${TOOL_COUNT} weather tools" .github/social-preview.html; then
  sed -i -E "s/[0-9]+ weather tools/${TOOL_COUNT} weather tools/" .github/social-preview.html
  CHROME=$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || true)
  if [ -n "$CHROME" ]; then
    "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1280,640 \
      --screenshot=.github/social-preview.png "file://$PWD/.github/social-preview.html" >/dev/null 2>&1
    echo "🖼️  Social preview PNG re-rendered with ${TOOL_COUNT} tools"
  else
    echo "⚠️  .github/social-preview.html updated, but no Chrome found to re-render the PNG"
  fi
  echo "   ⚠️  Manual step: upload .github/social-preview.png at GitHub → Settings → Social preview"
fi

# --- 8. SECURITY.md supported-versions row (minor/major bumps) -----------------
MAJOR_MINOR=$(echo "$NEW_VERSION" | cut -d. -f1-2)
if ! grep -q "| ${MAJOR_MINOR}.x" SECURITY.md; then
  sed -i "0,/^| [0-9]/s//| ${MAJOR_MINOR}.x   | :white_check_mark: |\n&/" SECURITY.md
  echo "📝 SECURITY.md: added ${MAJOR_MINOR}.x to supported versions"
fi

# --- 9. Verify -----------------------------------------------------------------
echo ""
./scripts/check-doc-versions.sh

echo ""
echo "✅ Release v${NEW_VERSION} prepared. Next steps:"
echo "   1. Review the diff (especially CHANGELOG.md wording): git diff"
echo "   2. git add -A && git commit -m \"chore: Release v${NEW_VERSION}\""
echo "   3. git push origin main"
echo "   4. git tag v${NEW_VERSION} && git push origin v${NEW_VERSION}   # triggers npm publish via CI"
echo "   5. gh release create v${NEW_VERSION} --title \"v${NEW_VERSION}\" --notes-file <(awk '/^## \\[${NEW_VERSION}\\]/{f=1;next} /^## \\[/{f=0} f' CHANGELOG.md)"
echo "   6. ./mcp-publisher login github && ./mcp-publisher publish     # MCP registry (manual)"
