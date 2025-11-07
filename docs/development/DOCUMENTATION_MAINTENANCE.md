# Documentation Maintenance Guide

**Version:** 1.0
**Last Updated:** 2025-11-07
**Purpose:** Comprehensive guide for maintaining up-to-date documentation across the Weather MCP Server project

---

## Table of Contents

1. [Overview](#overview)
2. [Documentation Inventory](#documentation-inventory)
3. [Version Update Checklist](#version-update-checklist)
4. [Automated Maintenance Scripts](#automated-maintenance-scripts)
5. [Documentation Review Schedule](#documentation-review-schedule)
6. [Common Maintenance Tasks](#common-maintenance-tasks)
7. [Troubleshooting Version Drift](#troubleshooting-version-drift)
8. [Claude Code Automation Guide](#claude-code-automation-guide)

---

## Overview

### Purpose

This guide ensures all project documentation remains synchronized with the codebase as the project evolves through release versions. It provides:

- **Comprehensive checklists** for version updates
- **Automated scripts** for consistency checking
- **Clear ownership** of documentation responsibilities
- **Automation templates** for Claude Code to assist with updates

### Current State Assessment (2025-11-07)

**Status:** Documentation drift detected between v1.1.0 (current) and v1.2.0 (in development)

**Critical Findings:**
- ✅ **Test Count:** 446 tests (correctly documented in README.md)
- ⚠️ **Version Status:** package.json shows v1.1.0, but CHANGELOG.md claims v1.2.0 released
- ⚠️ **README.md:** Documents v1.2.0 features as released (premature)
- ❌ **CLAUDE.md:** Shows v1.0.0, test count 312 (outdated)
- ❌ **CODE_REVIEW.md:** References v0.6.0 (severely outdated)
- ❌ **SECURITY_AUDIT.md:** References v0.6.0 (needs re-audit)

### Source of Truth Hierarchy

1. **package.json** → `version` field (PRIMARY SOURCE OF TRUTH)
2. **CHANGELOG.md** → Version history and release dates
3. **Test suite** → `npm test` output for test counts
4. **Git tags** → Release verification (`git tag -l`)

All other documentation must derive from these sources.

---

## Documentation Inventory

### User-Facing Documentation (8 files)

These files are public-facing and critical for users:

| File | Purpose | Update Frequency | Owner |
|------|---------|------------------|-------|
| **README.md** | Main project documentation | Every release | Maintainer |
| **CHANGELOG.md** | Version history | Every release | Maintainer |
| **SECURITY.md** | Security policy & reporting | As needed | Security Team |
| **CONTRIBUTING.md** | Contribution guidelines | As needed | Maintainer |
| **CLIENT_SETUP.md** | MCP client configuration | As needed | Maintainer |
| **TESTING_GUIDE.md** | Manual testing procedures | Every major release | QA/Dev |
| **ERROR_HANDLING.md** | Error handling documentation | As needed | Dev |
| **.github/CACHING.md** | Caching architecture | As needed | Dev |

**Quality Standard:** Must be accurate, clear, and up-to-date at time of release.

### Developer-Facing Documentation (7 files)

Internal documentation for developers and AI assistants:

| File | Purpose | Update Frequency | Owner |
|------|---------|------------------|-------|
| **CLAUDE.md** | AI assistant guide | Every minor release | Maintainer |
| **CODE_REVIEW.md** | Code quality assessment | Every major release | Code Reviewer |
| **SECURITY_AUDIT.md** | Security audit report | Every major release | Security Auditor |
| **TEST_COVERAGE_REPORT_V{X}.md** | Test coverage details | Every minor release | QA/Dev |
| **docs/README.md** | Documentation index | Every minor release | Maintainer |
| **MCP_BEST_PRACTICES.md** | MCP implementation guide | As needed | Dev |
| **CLIMATE_NORMALS_PLAN.md** | Feature planning doc | When complete, archive | Dev |

**Quality Standard:** Must accurately reflect current codebase state.

### Planning/Research Documentation (7 files)

Strategic and historical documents:

| File | Purpose | Update Frequency | Archival Status |
|------|---------|------------------|-----------------|
| **ROADMAP.md** | Product roadmap | Weekly/Sprint | Active |
| **FUTURE_ENHANCEMENTS.md** | Enhancement proposals | As needed | Active |
| **NOAA_API_RESEARCH.md** | API research findings | As needed | Reference |
| **IMPLEMENTATION_PLAN.md** | Initial implementation plan | N/A | Archive candidate |
| **HISTORICAL_DATA_PLAN.md** | Historical data planning | N/A | Archive candidate |
| **PROJECT_STATUS.md** | Project status tracking | Deprecated? | Review needed |
| **PROJECT_DESCRIPTION.md** | Project description | As needed | Review needed |

**Maintenance Policy:** Archive completed planning docs to `docs/archive/` directory.

### Release Documentation (4 files)

Version-specific documentation:

| File | Purpose | Update Frequency | Notes |
|------|---------|------------------|-------|
| **CHANGELOG.md** (root) | Primary changelog | Every release | Keep at root |
| **docs/releases/CHANGELOG.md** | Duplicate? | N/A | **REMOVE** (duplicate) |
| **docs/releases/RELEASE_NOTES_V{X}.md** | Detailed release notes | Per major release | Keep for history |
| **docs/publishing/PUBLISHING.md** | Publishing process | As needed | Process doc |

**Action Required:** Consolidate duplicate CHANGELOGs, keep only root version.

---

## Version Update Checklist

### Pre-Release: Version Bump Preparation

**When:** Before bumping `package.json` version number

#### Step 1: Verify Current State

```bash
# Check current version
node -p "require('./package.json').version"

# Run tests and note count
npm test 2>&1 | grep -E "Tests.*passed"

# Check for uncommitted changes
git status

# Verify on correct branch
git branch --show-current
```

#### Step 2: Update CHANGELOG.md

1. **Add new version section** at the top:
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added
   - New feature descriptions

   ### Changed
   - Modified feature descriptions

   ### Fixed
   - Bug fix descriptions

   ### Security
   - Security improvements (if any)
   ```

2. **Update links section** at bottom:
   ```markdown
   [X.Y.Z]: https://github.com/dgahagan/weather-mcp/compare/vPREV...vX.Y.Z
   ```

3. **Move `[Unreleased]` items** to new version section

4. **Update test count** if changed:
   ```markdown
   **Test Coverage:** XXX tests, 100% pass rate
   ```

**File:** `CHANGELOG.md`

#### Step 3: Update README.md

1. **Update version badges** (if present):
   ```markdown
   ![Version](https://img.shields.io/badge/version-X.Y.Z-blue)
   ```

2. **Update feature descriptions:**
   - Change "NEW in vX.Y.Z" for current release features
   - Remove version qualifiers for older features
   - Keep "ENHANCED in vX.Y.Z" only for recent updates (2-3 versions back)

3. **Update test count** in Testing section:
   ```markdown
   ### Automated Test Suite

   This project includes a comprehensive test suite with XXX automated tests:
   ```
   **Lines:** Search for "tests" in README.md (typically lines 592, 609)

4. **Update project structure** if new files added:
   ```markdown
   ### Project Structure
   ```
   **Lines:** Around line 654-697

5. **Verify all documentation links** still exist:
   - CLIENT_SETUP.md
   - CACHING.md
   - CODE_REVIEW.md
   - SECURITY_AUDIT.md
   - etc.

**File:** `README.md`

#### Step 4: Update CLAUDE.md

1. **Update version** at top:
   ```markdown
   **Version:** X.Y.Z (Production Ready)
   ```
   **Line:** ~10

2. **Update project structure** with new files:
   ```markdown
   ### Core Components
   ```
   **Lines:** 18-48

3. **Update test count** in Testing section:
   ```markdown
   - **Test Coverage:** XXX tests, 100% pass rate
   ```
   **Line:** ~375

4. **Update "Last Updated" footer:**
   ```markdown
   **Last Updated:** YYYY-MM-DD (vX.Y.Z release)
   ```
   **Line:** ~398

**File:** `CLAUDE.md`

#### Step 5: Update docs/README.md

1. **Update version:**
   ```markdown
   - **Current Version:** X.Y.Z
   ```
   **Line:** ~59

2. **Update test coverage:**
   ```markdown
   - **Test Coverage:** XXX tests
   ```
   **Line:** ~61

3. **Verify all documentation links** in index

**File:** `docs/README.md`

#### Step 6: Update SECURITY.md

1. **Update Supported Versions table:**
   ```markdown
   | Version | Supported          |
   | ------- | ------------------ |
   | X.Y.x   | ✅ Current         |
   | A.B.x   | ✅ Previous        |
   | < A.B   | ❌                 |
   ```
   **Lines:** 9-14

2. **Update security audit reference** if re-audited:
   ```markdown
   The project has undergone a comprehensive security audit (vX.Y.Z, YYYY-MM-DD):
   ```
   **Lines:** 150-154

**File:** `SECURITY.md`

#### Step 7: Create Test Coverage Report (Minor/Major Releases)

**When:** Every minor or major version (X.Y.0)

```bash
# Generate coverage report
npm run test:coverage

# Create new report file
cp TEST_COVERAGE_REPORT_V1.0.md TEST_COVERAGE_REPORT_V{X.Y}.md
```

**Update new file:**
1. Title: `# Test Coverage Report - Weather MCP Server v{X.Y.Z}`
2. Date: Current date
3. Test counts: From `npm test` output
4. Coverage percentages: From coverage report
5. New tests: List tests added since last report

**File:** `TEST_COVERAGE_REPORT_V{X.Y}.md` (new file)

#### Step 8: Update Code Quality Docs (Major Releases)

**When:** Every major version (X.0.0) or significant refactoring

**CODE_REVIEW.md:**
1. Run code quality analysis
2. Update version in title and throughout
3. Update test count
4. Update code quality score
5. Document new features/changes
6. Re-assess technical debt

**File:** `docs/development/CODE_REVIEW.md`

**SECURITY_AUDIT.md:**
1. Run security audit (`npm audit`)
2. Update version in title
3. Update audit date
4. Re-assess security posture
5. Document new security features
6. Update vulnerability count

**File:** `docs/development/SECURITY_AUDIT.md`

#### Step 9: Update package.json Version

**IMPORTANT:** This is the final step before committing!

```bash
# Bump version (replace X.Y.Z with actual version)
npm version X.Y.Z --no-git-tag-version

# Verify
node -p "require('./package.json').version"
```

**File:** `package.json`

#### Step 10: Commit and Tag

```bash
# Stage all documentation updates
git add CHANGELOG.md README.md CLAUDE.md docs/ package.json

# Commit with conventional commit message
git commit -m "chore(release): prepare vX.Y.Z release

- Update version to X.Y.Z across all documentation
- Update test counts (XXX tests)
- Update CHANGELOG with vX.Y.Z release notes
- Update README, CLAUDE.md, SECURITY.md

🤖 Generated with Claude Code"

# Create git tag
git tag -a vX.Y.Z -m "Release vX.Y.Z"

# Verify tag
git tag -l
```

---

### Post-Release: Verification

**When:** Immediately after publishing release

#### Step 11: Verify Published Package

```bash
# Check npm registry
npm view @dangahagan/weather-mcp version

# Check GitHub releases
open https://github.com/dgahagan/weather-mcp/releases

# Verify MCP registry listing (if applicable)
open https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp
```

#### Step 12: Update ROADMAP.md

1. **Move completed features** from "Planned" to "Completed"
2. **Update version numbers** for completed milestones
3. **Add new planning sections** for next version
4. **Update completion dates**

**File:** `ROADMAP.md`

#### Step 13: Archive Completed Planning Docs

**When:** Feature implementation is complete and released

```bash
# Create archive directory if not exists
mkdir -p docs/archive

# Move completed planning docs
mv docs/FEATURE_PLAN.md docs/archive/FEATURE_PLAN_vX.Y.Z.md

# Update docs/README.md to remove references to archived docs
```

**Files to consider archiving:**
- Completed implementation plans
- Completed feature planning docs
- Old release notes (< 3 versions old)

---

## Automated Maintenance Scripts

### Script 1: Version Consistency Checker

**Purpose:** Verify all documentation has consistent version references

**Location:** `scripts/check-doc-versions.sh`

**Create this file:**

```bash
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

# Function to check version in file
check_version_in_file() {
  local file=$1
  local pattern=$2
  local description=$3

  if [ -f "$file" ]; then
    local found_version=$(grep -oE "$pattern" "$file" | head -1)
    if [ -n "$found_version" ]; then
      if [[ "$found_version" == *"$PACKAGE_VERSION"* ]]; then
        echo "✅ $description: ${GREEN}$found_version${NC}"
      else
        echo "❌ $description: ${RED}$found_version${NC} (expected $PACKAGE_VERSION)"
        ((ERRORS++))
      fi
    else
      echo "⚠️  $description: ${YELLOW}Version not found${NC}"
    fi
  else
    echo "❌ $description: ${RED}File not found${NC}"
    ((ERRORS++))
  fi
}

# Check CLAUDE.md
check_version_in_file \
  "CLAUDE.md" \
  'Version: [0-9]+\.[0-9]+\.[0-9]+' \
  "CLAUDE.md version"

# Check docs/README.md
check_version_in_file \
  "docs/README.md" \
  'Current Version: [0-9]+\.[0-9]+\.[0-9]+' \
  "docs/README.md version"

# Check CHANGELOG.md top entry
CHANGELOG_TOP_VERSION=$(grep -m 1 "^## \[" CHANGELOG.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ "$CHANGELOG_TOP_VERSION" == "$PACKAGE_VERSION" ]; then
  echo "✅ CHANGELOG.md top entry: ${GREEN}v${CHANGELOG_TOP_VERSION}${NC}"
else
  echo "⚠️  CHANGELOG.md top entry: ${YELLOW}v${CHANGELOG_TOP_VERSION}${NC} (package.json is v${PACKAGE_VERSION})"
  echo "   Note: This is OK if working on next release (unreleased section)"
fi

# Check test count consistency
echo ""
echo "🧪 Checking test count consistency..."
TEST_COUNT=$(npm test 2>&1 | grep -E "Tests.*[0-9]+ passed" | grep -oE '[0-9]+' | head -1)
if [ -n "$TEST_COUNT" ]; then
  echo "📊 Actual test count: ${GREEN}${TEST_COUNT}${NC}"

  # Check README.md test count
  README_TEST_COUNT=$(grep -E "[0-9]+ (automated )?tests" README.md | head -1 | grep -oE '[0-9]+')
  if [ "$README_TEST_COUNT" == "$TEST_COUNT" ]; then
    echo "✅ README.md test count: ${GREEN}${README_TEST_COUNT}${NC}"
  else
    echo "❌ README.md test count: ${RED}${README_TEST_COUNT}${NC} (expected ${TEST_COUNT})"
    ((ERRORS++))
  fi

  # Check CLAUDE.md test count
  CLAUDE_TEST_COUNT=$(grep -E "Test Coverage.*[0-9]+ tests" CLAUDE.md | head -1 | grep -oE '[0-9]+' | head -1)
  if [ "$CLAUDE_TEST_COUNT" == "$TEST_COUNT" ]; then
    echo "✅ CLAUDE.md test count: ${GREEN}${CLAUDE_TEST_COUNT}${NC}"
  else
    echo "❌ CLAUDE.md test count: ${RED}${CLAUDE_TEST_COUNT}${NC} (expected ${TEST_COUNT})"
    ((ERRORS++))
  fi
else
  echo "⚠️  Could not determine test count (npm test failed?)"
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
    ((BROKEN_LINKS++))
    ((ERRORS++))
  fi
done < <(grep -oE '\[.*\]\(\./[^)]+\.md\)' README.md)

if [ $BROKEN_LINKS -eq 0 ]; then
  echo "✅ All documentation links valid"
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
```

**Make executable:**
```bash
chmod +x scripts/check-doc-versions.sh
```

**Usage:**
```bash
# Manual check
./scripts/check-doc-versions.sh

# Add to CI/CD pipeline
npm run check-docs  # Add script to package.json
```

**Add to package.json scripts:**
```json
{
  "scripts": {
    "check-docs": "./scripts/check-doc-versions.sh"
  }
}
```

---

### Script 2: Pre-Release Documentation Updater

**Purpose:** Automate routine documentation updates

**Location:** `scripts/update-docs-for-release.sh`

**Create this file:**

```bash
#!/bin/bash
# scripts/update-docs-for-release.sh
# Automates routine documentation updates for new release

set -e

# Check if version provided
if [ $# -eq 0 ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 1.3.0"
  exit 1
fi

NEW_VERSION=$1
CURRENT_VERSION=$(node -p "require('./package.json').version")
TODAY=$(date +%Y-%m-%d)
TEST_COUNT=$(npm test 2>&1 | grep -E "Tests.*[0-9]+ passed" | grep -oE '[0-9]+' | head -1)

echo "🔄 Updating documentation for release v${NEW_VERSION}"
echo "   Current version: v${CURRENT_VERSION}"
echo "   Date: ${TODAY}"
echo "   Test count: ${TEST_COUNT}"
echo ""

# Update CLAUDE.md version
echo "📝 Updating CLAUDE.md..."
sed -i.bak "s/Version: [0-9]\+\.[0-9]\+\.[0-9]\+/Version: ${NEW_VERSION}/" CLAUDE.md
sed -i.bak "s/Test Coverage: [0-9]\+ tests/Test Coverage: ${TEST_COUNT} tests/" CLAUDE.md
sed -i.bak "s/Last Updated: [0-9-]\+ (v[0-9.]\+)/Last Updated: ${TODAY} (v${NEW_VERSION} release)/" CLAUDE.md
rm -f CLAUDE.md.bak

# Update docs/README.md
echo "📝 Updating docs/README.md..."
sed -i.bak "s/Current Version: [0-9]\+\.[0-9]\+\.[0-9]\+/Current Version: ${NEW_VERSION}/" docs/README.md
sed -i.bak "s/Test Coverage: [0-9]\+ tests/Test Coverage: ${TEST_COUNT} tests/" docs/README.md
rm -f docs/README.md.bak

# Update package.json
echo "📝 Updating package.json version..."
npm version "$NEW_VERSION" --no-git-tag-version

echo ""
echo "✅ Automated updates complete!"
echo ""
echo "⚠️  Manual steps still required:"
echo "   1. Update CHANGELOG.md with release notes"
echo "   2. Update README.md feature descriptions"
echo "   3. Update SECURITY.md supported versions"
echo "   4. Create TEST_COVERAGE_REPORT_V${NEW_VERSION}.md (if minor/major release)"
echo "   5. Review CODE_REVIEW.md and SECURITY_AUDIT.md (if major release)"
echo ""
echo "Run './scripts/check-doc-versions.sh' to verify updates."
```

**Make executable:**
```bash
chmod +x scripts/update-docs-for-release.sh
```

**Usage:**
```bash
# Update docs for v1.3.0 release
./scripts/update-docs-for-release.sh 1.3.0

# Verify updates
./scripts/check-doc-versions.sh
```

---

### Script 3: Archive Old Documentation

**Purpose:** Move completed planning docs to archive

**Location:** `scripts/archive-docs.sh`

```bash
#!/bin/bash
# scripts/archive-docs.sh
# Archives completed planning documentation

set -e

ARCHIVE_DIR="docs/archive"
mkdir -p "$ARCHIVE_DIR"

echo "📦 Archiving completed documentation..."
echo ""

# List candidate files for archiving
echo "Candidates for archiving:"
echo "  - IMPLEMENTATION_PLAN.md (if feature complete)"
echo "  - HISTORICAL_DATA_PLAN.md (if feature complete)"
echo "  - Old RELEASE_NOTES (older than 3 versions)"
echo ""

echo "Which file do you want to archive? (or 'q' to quit)"
read -r FILE_TO_ARCHIVE

if [ "$FILE_TO_ARCHIVE" == "q" ]; then
  echo "Cancelled."
  exit 0
fi

if [ ! -f "$FILE_TO_ARCHIVE" ]; then
  echo "❌ File not found: $FILE_TO_ARCHIVE"
  exit 1
fi

# Get version to tag archived file
echo "What version was this completed in? (e.g., 1.2.0)"
read -r VERSION

BASENAME=$(basename "$FILE_TO_ARCHIVE" .md)
ARCHIVED_NAME="${BASENAME}_v${VERSION}.md"

mv "$FILE_TO_ARCHIVE" "${ARCHIVE_DIR}/${ARCHIVED_NAME}"
echo "✅ Archived to: ${ARCHIVE_DIR}/${ARCHIVED_NAME}"
echo ""
echo "Don't forget to:"
echo "  - Update docs/README.md to remove references"
echo "  - Commit the change: git add . && git commit -m 'docs: archive ${BASENAME} (completed in v${VERSION})'"
```

**Make executable:**
```bash
chmod +x scripts/archive-docs.sh
```

---

## Documentation Review Schedule

### Weekly Reviews (Every Sprint)

**Responsibility:** Development Team Lead

**Tasks:**
- [ ] Update ROADMAP.md with sprint progress
- [ ] Review and triage new issues/PRs
- [ ] Update FUTURE_ENHANCEMENTS.md with new ideas
- [ ] Check for new security advisories (`npm audit`)

**Time Required:** 15-30 minutes

### Pre-Release Reviews (Before Every Release)

**Responsibility:** Release Manager

**Tasks:**
- [ ] Run `./scripts/check-doc-versions.sh`
- [ ] Complete [Version Update Checklist](#version-update-checklist)
- [ ] Verify all documentation links in README.md
- [ ] Review CHANGELOG.md for completeness
- [ ] Update SECURITY.md if needed
- [ ] Create release notes (if major/minor release)

**Time Required:** 1-2 hours

### Quarterly Reviews (Every 3 Months)

**Responsibility:** Project Maintainer

**Tasks:**
- [ ] Full documentation audit (all files)
- [ ] Update CODE_REVIEW.md with fresh code quality analysis
- [ ] Update SECURITY_AUDIT.md with fresh security audit
- [ ] Review and archive completed planning docs
- [ ] Update CONTRIBUTING.md with process improvements
- [ ] Review and update TESTING_GUIDE.md
- [ ] Verify CLIENT_SETUP.md instructions for all clients
- [ ] Check for broken external links in documentation

**Time Required:** 4-6 hours

---

## Common Maintenance Tasks

### Task 1: Fix Version Drift

**Symptom:** Different documentation files show different version numbers

**Solution:**

1. **Identify source of truth:**
   ```bash
   node -p "require('./package.json').version"
   ```

2. **Find all version references:**
   ```bash
   grep -rn "Version: [0-9]" CLAUDE.md docs/
   grep -rn "v[0-9]\+\.[0-9]\+\.[0-9]\+" README.md CHANGELOG.md
   ```

3. **Update each file** using the checklist above

4. **Verify:**
   ```bash
   ./scripts/check-doc-versions.sh
   ```

**Time Required:** 30 minutes

### Task 2: Update Test Counts

**Symptom:** Documentation shows incorrect test count

**Solution:**

1. **Get actual count:**
   ```bash
   npm test 2>&1 | grep "Tests" | grep "passed"
   ```

2. **Update all references:**
   - README.md (search for "tests")
   - CLAUDE.md (search for "Test Coverage")
   - TEST_COVERAGE_REPORT (if exists for current version)

3. **Verify:**
   ```bash
   ./scripts/check-doc-versions.sh
   ```

**Time Required:** 10 minutes

### Task 3: Add New Tool Documentation

**Symptom:** New MCP tool added to code but not documented

**Solution:**

1. **Update README.md:**
   - Add to "Available Tools" section
   - Add to feature list at top
   - Update tool count if referenced

2. **Update CLAUDE.md:**
   - Add handler to "Core Components" → "handlers/"
   - Add to "Key Features" list
   - Update any architecture diagrams

3. **Update TESTING_GUIDE.md:**
   - Add test cases for new tool

4. **Update CLIENT_SETUP.md:**
   - Add usage examples if needed

**Time Required:** 1-2 hours

### Task 4: Consolidate Duplicate Documentation

**Symptom:** Same content appears in multiple files

**Solution:**

1. **Identify primary file** (usually root or docs/)
2. **Compare content:**
   ```bash
   diff file1.md file2.md
   ```
3. **Merge unique content** into primary file
4. **Archive or delete** duplicate
5. **Update all links** pointing to removed file
6. **Document in CHANGELOG:**
   ```markdown
   ### Changed
   - Consolidated duplicate CHANGELOG files into root version
   ```

**Time Required:** 30-60 minutes

### Task 5: Archive Completed Planning Doc

**Symptom:** Planning doc for completed feature still in active docs

**Solution:**

1. **Verify feature is complete:**
   - Check ROADMAP.md
   - Check CHANGELOG.md for release
   - Confirm with team

2. **Run archive script:**
   ```bash
   ./scripts/archive-docs.sh
   ```

3. **Update docs/README.md** to remove from active list

4. **Commit:**
   ```bash
   git add docs/archive/ docs/README.md
   git commit -m "docs: archive FEATURE_PLAN (completed in vX.Y.Z)"
   ```

**Time Required:** 15 minutes

---

## Troubleshooting Version Drift

### Problem 1: CHANGELOG Shows Unreleased Version

**Symptom:**
```markdown
## [1.3.0] - 2025-11-07

...

[1.3.0]: https://github.com/...
```

But `package.json` shows `1.2.0`.

**Root Cause:** CHANGELOG was updated before package.json was bumped.

**Solution:**

**Option A: Version Not Ready for Release**
```markdown
## [Unreleased]

### Added
- Features planned for v1.3.0

...

## [1.2.0] - 2025-11-07
```

**Option B: Ready to Release**
```bash
# Bump package.json to match
npm version 1.3.0 --no-git-tag-version

# Verify all docs match
./scripts/check-doc-versions.sh

# Commit and tag
git add .
git commit -m "chore(release): prepare v1.3.0"
git tag -a v1.3.0 -m "Release v1.3.0"
```

### Problem 2: README Documents Unreleased Features

**Symptom:** README.md says "NEW in v1.3.0" but package.json is v1.2.0

**Root Cause:** Documentation written for features in development

**Solution:**

**Option A: Feature Incomplete - Remove or Clarify**
```markdown
<!-- Before -->
**Snow Data**: Enhanced winter weather information (NEW in v1.3.0)

<!-- After -->
**Snow Data**: Enhanced winter weather information (Planned for v1.3.0)
```

**Option B: Feature Complete - Bump Version**
```bash
# Complete version bump process
npm version 1.3.0 --no-git-tag-version
# ... (follow Version Update Checklist)
```

### Problem 3: Test Count Mismatch

**Symptom:** README says 446 tests, CLAUDE.md says 312 tests

**Root Cause:** Documentation not updated after adding tests

**Solution:**

1. **Get truth:**
   ```bash
   npm test 2>&1 | grep "Tests.*passed"
   # Example output: Tests  446 passed (446)
   ```

2. **Update all files:**
   ```bash
   # README.md
   sed -i '' 's/[0-9]\+ tests/446 tests/g' README.md

   # CLAUDE.md
   sed -i '' 's/Test Coverage: [0-9]\+ tests/Test Coverage: 446 tests/' CLAUDE.md
   ```

3. **Verify:**
   ```bash
   ./scripts/check-doc-versions.sh
   ```

### Problem 4: CODE_REVIEW.md References Old Version

**Symptom:** CODE_REVIEW.md title says "v0.6.0" but current is v1.2.0

**Root Cause:** CODE_REVIEW.md not updated for recent releases

**Solution:**

**Option A: Quick Version Update (Not Recommended)**
```bash
# Only updates version references, doesn't re-review code
sed -i '' 's/v0\.6\.0/v1.2.0/g' docs/development/CODE_REVIEW.md
sed -i '' 's/November 6, 2025/November 7, 2025/' docs/development/CODE_REVIEW.md
```

**Option B: Full Code Review (Recommended)**

Use Claude Code to perform comprehensive code review:

```bash
# See "Claude Code Automation Guide" below
```

This ensures CODE_REVIEW.md accurately reflects current codebase.

---

## Claude Code Automation Guide

### How to Use Claude Code for Documentation Maintenance

Claude Code can automate many documentation tasks. Here are proven prompts and workflows:

### Automation 1: Pre-Release Documentation Update

**When:** Before bumping package.json version

**Prompt:**

```
I'm preparing to release version X.Y.Z of the Weather MCP Server. Please help me update all documentation according to the Version Update Checklist in docs/development/DOCUMENTATION_MAINTENANCE.md.

Current state:
- package.json version: [current version]
- New version: X.Y.Z
- Release date: [YYYY-MM-DD]
- Test count: [run npm test and provide count]

Please:
1. Update CHANGELOG.md with new version entry (if not already done)
2. Update README.md test counts and version references
3. Update CLAUDE.md version, test count, and last updated date
4. Update docs/README.md version and test count
5. Update SECURITY.md supported versions table
6. Verify all documentation links in README.md still work
7. Run ./scripts/check-doc-versions.sh and fix any errors

After completing, provide a summary of all changes made.
```

**Expected Result:** All routine documentation updated, ready for package.json version bump

### Automation 2: Create Test Coverage Report

**When:** After minor or major version release

**Prompt:**

```
Please create a comprehensive test coverage report for version X.Y.Z of the Weather MCP Server.

Use TEST_COVERAGE_REPORT_V1.0.md as a template and:
1. Run npm run test:coverage
2. Create new file: TEST_COVERAGE_REPORT_VX.Y.md
3. Update all version references to X.Y.Z
4. Update test counts and coverage percentages from current test output
5. Document new tests added since last report
6. Compare coverage with previous version (improvements/regressions)

Provide the complete new report.
```

**Expected Result:** New test coverage report ready to commit

### Automation 3: Update Code Quality Documentation

**When:** After major release or significant refactoring

**Prompt:**

```
Please perform a comprehensive code quality review for version X.Y.Z and update docs/development/CODE_REVIEW.md.

Review:
1. Overall code quality score (A+ to F scale)
2. Code organization and architecture
3. Test coverage and quality
4. Documentation quality
5. Security considerations
6. Performance optimizations
7. Technical debt assessment
8. Dependency health (npm audit)

Compare with previous CODE_REVIEW.md (vPREV) and note improvements/regressions.

Use the existing CODE_REVIEW.md structure as a template.
```

**Expected Result:** Updated CODE_REVIEW.md with current assessment

### Automation 4: Security Audit Update

**When:** After major release or security-relevant changes

**Prompt:**

```
Please perform a comprehensive security audit for version X.Y.Z and update docs/development/SECURITY_AUDIT.md.

Review:
1. Run npm audit and summarize findings
2. Check input validation coverage
3. Review error handling and information leakage
4. Assess dependency security
5. Review authentication/authorization (if applicable)
6. Check for common vulnerabilities (injection, XSS, etc.)
7. Update security posture rating (A+ to F scale)
8. Document any new security features

Compare with previous SECURITY_AUDIT.md (vPREV) and note improvements.

Use the existing SECURITY_AUDIT.md structure as a template.
```

**Expected Result:** Updated SECURITY_AUDIT.md with current security assessment

### Automation 5: Fix Documentation Version Drift

**When:** After discovering version inconsistencies

**Prompt:**

```
I've discovered version inconsistencies in the documentation. Please help me fix them.

Run ./scripts/check-doc-versions.sh to identify all issues, then:

1. Review the error output
2. Identify the source of truth (package.json version: [X.Y.Z])
3. Update all files with incorrect version references
4. Fix any test count discrepancies
5. Fix any broken documentation links
6. Re-run the check script to verify fixes
7. Provide a summary of all corrections made

Be thorough - check CHANGELOG.md, README.md, CLAUDE.md, docs/README.md, SECURITY.md, CODE_REVIEW.md, and SECURITY_AUDIT.md.
```

**Expected Result:** All version references synchronized across documentation

### Automation 6: Create Release Notes

**When:** For major or significant minor releases

**Prompt:**

```
Please create comprehensive release notes for version X.Y.Z of the Weather MCP Server.

Review:
1. CHANGELOG.md entries for this version
2. Git commits since last release (git log vPREV..vX.Y.Z)
3. Closed issues/PRs for this milestone

Create a new file: docs/releases/RELEASE_NOTES_VX.Y.md

Include:
- Release highlights (3-5 key features/improvements)
- New features (detailed descriptions with examples)
- Enhancements to existing features
- Bug fixes (user-impacting only)
- Performance improvements
- Security updates
- Breaking changes (if any)
- Upgrade guide (if needed)
- Deprecation notices (if any)
- Known issues
- Contributors acknowledgment

Use docs/releases/RELEASE_NOTES_V0.1.0.md as a reference for format.
```

**Expected Result:** Professional release notes ready for GitHub release

### Automation 7: Quarterly Documentation Audit

**When:** Every 3 months

**Prompt:**

```
Please perform a comprehensive documentation audit for the Weather MCP Server project.

Check all markdown files and:

1. Version Consistency:
   - Run ./scripts/check-doc-versions.sh
   - Verify package.json matches all doc references
   - Check CHANGELOG.md is up to date

2. Cross-Reference Validation:
   - Verify all links in README.md exist and are current
   - Check all internal documentation links
   - Test external links (API docs, status pages)

3. Content Accuracy:
   - Compare feature descriptions with actual code
   - Verify test counts are current
   - Check CLI examples still work
   - Verify API endpoint documentation matches implementation

4. Completeness:
   - All new features since last audit documented?
   - All MCP tools have complete documentation?
   - Client setup guides current for all clients?

5. Cleanup Opportunities:
   - Identify completed planning docs to archive
   - Find duplicate content to consolidate
   - Locate outdated version references ("NEW in v0.X")

Provide:
- Summary of findings (errors, warnings, suggestions)
- Prioritized list of updates needed
- Recommendations for improvement
- Estimated effort for fixes

Reference docs/development/DOCUMENTATION_MAINTENANCE.md for standards.
```

**Expected Result:** Comprehensive audit report with actionable recommendations

### Automation 8: Archive Completed Planning Docs

**When:** After feature completion and release

**Prompt:**

```
I've completed the [FEATURE_NAME] feature and released it in version X.Y.Z. Please help me archive the planning documentation.

1. Review docs/FEATURE_PLAN.md to confirm it's complete
2. Create docs/archive/ directory if it doesn't exist
3. Move docs/FEATURE_PLAN.md to docs/archive/FEATURE_PLAN_vX.Y.Z.md
4. Update docs/README.md to remove the archived file from active docs list
5. Update ROADMAP.md to mark the feature as completed
6. Prepare a commit message for the archival

Let me know if any content from the plan should be moved to permanent documentation before archiving.
```

**Expected Result:** Planning doc archived, documentation index updated

---

## Best Practices

### 1. Single Source of Truth

**Always derive from:**
- **Version:** package.json
- **Test count:** `npm test` output
- **Release dates:** Git tags (`git tag -l`)

**Never:**
- Hardcode version numbers in multiple places
- Manually sync version numbers
- Guess at test counts

### 2. Prevent Premature Documentation

**Don't:**
- Document features as "NEW in vX.Y.Z" before release
- Add CHANGELOG entry for unreleased version
- Update version in docs before bumping package.json

**Do:**
- Use `[Unreleased]` section in CHANGELOG
- Mark features as "Planned" or "In Development"
- Update all docs atomically with version bump

### 3. Automate What's Automatable

**Good candidates for automation:**
- Version number updates (use scripts)
- Test count updates (parse npm output)
- Link validation (check file existence)
- Consistency checks (version across docs)

**Not automatable (requires human judgment):**
- CHANGELOG content writing
- Feature descriptions
- Breaking change documentation
- Security audit assessments

### 4. Review Before Release

**Pre-release checklist:**
- [ ] All documentation updated
- [ ] Version consistency check passes
- [ ] All tests passing
- [ ] No security vulnerabilities
- [ ] CHANGELOG complete
- [ ] Git tag ready

**Don't:**
- Rush documentation updates
- Skip version consistency checks
- Forget to update test counts

### 5. Keep Documentation DRY (Don't Repeat Yourself)

**Do:**
- Link to canonical documentation
- Reference other docs when appropriate
- Maintain single source for complex topics

**Don't:**
- Copy/paste feature descriptions across files
- Duplicate CHANGELOGs
- Maintain multiple copies of same content

---

## Maintenance Ownership

### Primary Maintainer Responsibilities

**Daily:**
- Review and merge PRs with doc updates
- Monitor issue tracker for doc bugs

**Weekly:**
- Update ROADMAP.md with sprint progress
- Review FUTURE_ENHANCEMENTS.md

**Per Release:**
- Complete Version Update Checklist
- Run version consistency checks
- Create release notes (if major/minor)
- Tag release in Git

**Quarterly:**
- Full documentation audit
- Update CODE_REVIEW.md
- Update SECURITY_AUDIT.md
- Archive completed planning docs

### Contributor Responsibilities

**When adding features:**
- Update README.md with feature description
- Update CLAUDE.md if architecture changes
- Add tool documentation if new MCP tool
- Update TESTING_GUIDE.md with test cases

**When fixing bugs:**
- Update CHANGELOG.md
- Update error handling docs if relevant

**When changing dependencies:**
- Run `npm audit`
- Update SECURITY.md if security implications

---

## Appendix: Documentation File Reference

### Quick Reference Table

| File | Purpose | Update Frequency | Priority | Owner |
|------|---------|------------------|----------|-------|
| **README.md** | Main docs | Every release | 🔴 Critical | Maintainer |
| **CHANGELOG.md** | Version history | Every release | 🔴 Critical | Maintainer |
| **CLAUDE.md** | AI guide | Every minor release | 🟠 High | Maintainer |
| **SECURITY.md** | Security policy | As needed | 🟠 High | Security |
| **CONTRIBUTING.md** | Contribution guide | As needed | 🟡 Medium | Maintainer |
| **package.json** | Source of truth | Every release | 🔴 Critical | Maintainer |
| **docs/README.md** | Docs index | Every minor release | 🟡 Medium | Maintainer |
| **CODE_REVIEW.md** | Code quality | Every major release | 🟡 Medium | Reviewer |
| **SECURITY_AUDIT.md** | Security audit | Every major release | 🟡 Medium | Security |
| **TEST_COVERAGE_REPORT** | Test coverage | Every minor release | 🟡 Medium | QA |
| **CLIENT_SETUP.md** | Setup guide | As needed | 🟢 Low | Maintainer |
| **TESTING_GUIDE.md** | Test procedures | Every major release | 🟢 Low | QA |
| **ROADMAP.md** | Product roadmap | Weekly | 🟠 High | Maintainer |
| **FUTURE_ENHANCEMENTS.md** | Enhancement ideas | As needed | 🟢 Low | Maintainer |

### Version-Specific Files

These files should be created per major version:

- `TEST_COVERAGE_REPORT_V{X.Y}.md` - Per minor release
- `docs/releases/RELEASE_NOTES_V{X.Y}.md` - Per major/minor release
- `docs/archive/PLAN_NAME_v{X.Y.Z}.md` - When feature completed

---

## Changelog for This Document

### Version 1.0 (2025-11-07)

**Initial Release**

- Comprehensive documentation maintenance guide
- Version update checklist (10 steps)
- Automated maintenance scripts (3 scripts)
- Documentation review schedule
- Common maintenance tasks
- Troubleshooting guide
- Claude Code automation guide (8 workflows)
- Best practices and ownership guidelines

**Created by:** Claude Code
**Reviewed by:** [Pending human review]

---

**Questions or Suggestions?**

This is a living document. If you find issues or have suggestions for improvement:

1. Open an issue: https://github.com/dgahagan/weather-mcp/issues
2. Submit a PR with improvements
3. Discuss in team meetings

**Last Updated:** 2025-11-07
**Next Review:** 2026-02-07 (quarterly)