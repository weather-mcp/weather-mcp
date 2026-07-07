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
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
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
fs.writeFileSync('CHANGELOG.md', text);
EOF

# --- 4. Test count (also confirms the suite passes) ---------------------------
echo "🧪 Running tests to get current count..."
TEST_COUNT=$(npm test 2>&1 | grep -E "Tests.*[0-9]+ passed" | grep -oE '[0-9]+' | head -1)
if [ -z "$TEST_COUNT" ]; then
  echo "❌ Could not determine test count — did npm test fail?"
  exit 1
fi
TEST_COUNT_FMT=$(node -p "(${TEST_COUNT}).toLocaleString('en-US')")
echo "   ${TEST_COUNT_FMT} tests passing"

# --- 5. Doc reference updates --------------------------------------------------
SUMMARY_TEXT=${SUMMARY:-"See CHANGELOG.md"}

sed -i -E \
  -e "s/\*\*Version:\*\* [0-9]+\.[0-9]+\.[0-9]+/**Version:** ${NEW_VERSION}/g" \
  -e "s/- \*\*New in v[0-9]+\.[0-9]+\.[0-9]+:\*\* .*/- **New in v${NEW_VERSION}:** ${SUMMARY_TEXT}/" \
  -e "s/\*\*Test Coverage:\*\* [0-9,]+ tests/**Test Coverage:** ${TEST_COUNT_FMT} tests/" \
  -e "s/^\*\*Last Updated:\*\* .*/**Last Updated:** ${TODAY} (v${NEW_VERSION})/" \
  CLAUDE.md

sed -i -E \
  -e "s/- \*\*Current Version:\*\* .*/- **Current Version:** ${NEW_VERSION}/" \
  -e "s/\*\*Test Coverage:\*\* [0-9,]+ tests/**Test Coverage:** ${TEST_COUNT_FMT} tests/" \
  docs/README.md

sed -i -E \
  -e "s/test suite with [0-9,]+ automated tests/test suite with ${TEST_COUNT_FMT} automated tests/" \
  -e "s/\*\*[0-9,]+ tests\*\* across unit and integration test suites/**${TEST_COUNT_FMT} tests** across unit and integration test suites/" \
  README.md

echo "📝 Updated CLAUDE.md, docs/README.md, README.md"

# --- 6. SECURITY.md supported-versions row (minor/major bumps) -----------------
MAJOR_MINOR=$(echo "$NEW_VERSION" | cut -d. -f1-2)
if ! grep -q "| ${MAJOR_MINOR}.x" SECURITY.md; then
  sed -i "0,/^| [0-9]/s//| ${MAJOR_MINOR}.x   | :white_check_mark: |\n&/" SECURITY.md
  echo "📝 SECURITY.md: added ${MAJOR_MINOR}.x to supported versions"
fi

# --- 7. Verify -----------------------------------------------------------------
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
