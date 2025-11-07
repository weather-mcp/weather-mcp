# Publishing Guide

This guide covers how to publish the Weather MCP Server to npm, create GitHub releases, and list in MCP registries.

## Quick Start Workflow

For experienced users, here's the recommended publishing workflow:

1. **Pre-release quality checks** → Run code-reviewer, security-auditor, and test-automator agents; fix all findings (see "Pre-Release Quality Automation")
2. **Update versions** → Update `package.json` and `server.json` to new version
3. **Commit & push** → Commit version updates to main branch
4. **Build & test** → Run `npm run build` and `npm test`
5. **Publish to npm** → Run `npm publish --access public`
6. **Create GitHub release** → Use `gh release create` or web UI
7. **Publish to MCP registry** → Run `./mcp-publisher login github` then `./mcp-publisher publish`
8. **Verify** → Check npm, GitHub releases, and MCP registry

See detailed instructions below for each step.

---

## Prerequisites

Before you begin:

1. **npm account** - Create at https://www.npmjs.com/signup
2. **npm login** - Run `npm login` in your terminal and verify with `npm whoami`
3. **GitHub CLI (optional)** - Install via `brew install gh` for faster releases
4. **mcp-publisher** - Binary should be in project root (see section 5.2)
5. **GitHub repository** - Public repo at github.com/dgahagan/weather-mcp

---

## Release Checklist

**Use this checklist for every release to ensure nothing is missed:**

### Pre-Release
- [ ] All tests pass (`npm test`)
- [ ] README.md is up to date
- [ ] CHANGELOG.md is updated with release notes
- [ ] All changes committed to main branch
- [ ] **Run code-reviewer agent** → Fix all CRITICAL/HIGH issues, commit fixes
- [ ] **Run security-auditor agent** → Fix ALL security issues, commit fixes
- [ ] **Run test-automator agent** → Enhance test coverage, commit improvements
- [ ] Verification passed: build succeeds, all tests pass, no critical vulnerabilities
- [ ] All pre-release fixes committed (see "Pre-Release Quality Automation" for details)

### Version Updates
- [ ] **package.json** version incremented (e.g., 0.3.0 → 0.4.0)
- [ ] **server.json** version incremented (must match package.json)
- [ ] **server.json** description updated (if needed, ≤100 chars)
- [ ] Version update committed and pushed to GitHub

### Build & Test
- [ ] Build successful (`npm run build`)
- [ ] Dry run checked (`npm pack --dry-run`)
- [ ] Expected files included (dist/, README.md, LICENSE, package.json)

### Publishing
- [ ] npm package published (`npm publish --access public`)
- [ ] npm publication verified (`npm view @dangahagan/weather-mcp version`)
- [ ] Git tag created (if not already)
- [ ] GitHub release created with release notes
- [ ] MCP Registry updated (`./mcp-publisher publish`)
- [ ] MCP Registry verified (check `isLatest: true`)

### Post-Release
- [ ] Installation tested: `npx @dangahagan/weather-mcp@latest`
- [ ] MCP client configuration tested (Claude Code, Claude Desktop, etc.)
- [ ] Release announced (if applicable)

---

## Pre-Release Quality Automation

**⚠️ CRITICAL: Run this workflow BEFORE Step 0 (version bumping)**

To avoid shipping releases with unreviewed code quality, security issues, or inadequate tests, run these three specialized agents. This automated review catches issues early and ensures consistent release quality.

**Time estimate:** 30-60 minutes (including fixes)

### Agent Workflow

Run these agents **in sequence** (each may inform the next):

#### 1. Code Quality Review

**Agent:** `code-reviewer` (`.claude/agents/code-reviewer.md`)

**How to invoke:**
- In Claude Code, type: "Run the code-reviewer agent"
- Or: Use Task tool with `subagent_type="code-reviewer"`

**Output:** `docs/development/CODE_REVIEW.md`

**What to do:**
1. Review the generated report for code quality issues
2. **Fix all CRITICAL issues** (marked with severity ratings)
3. **Strongly consider** fixing HIGH priority issues
4. Address MEDIUM/LOW issues if time permits
5. Commit fixes: `git commit -m "fix: Address code review findings for vX.X.X release"`

#### 2. Security Audit

**Agent:** `security-auditor` (`.claude/agents/security-auditor.md`)

**How to invoke:**
- In Claude Code, type: "Run the security-auditor agent"
- Or: Use Task tool with `subagent_type="security-auditor"`

**Output:** `docs/development/SECURITY_AUDIT.md`

**What to do:**
1. Review security findings in the report
2. **Fix ALL security vulnerabilities** (no exceptions for releases)
3. Update dependencies if vulnerabilities found: `npm audit fix`
4. If `npm audit` shows critical issues, resolve before proceeding
5. Commit fixes: `git commit -m "security: Address security audit findings for vX.X.X release"`

#### 3. Test Suite Enhancement

**Agent:** `test-automator` (`.claude/agents/test-automator.md`)

**How to invoke:**
- In Claude Code, type: "Run the test-automator agent"
- Or: Use Task tool with `subagent_type="test-automator"`

**Output:** Updated test files + recommendations

**What to do:**
1. Review test coverage gaps and recommendations
2. Implement critical test additions (especially for new features)
3. Apply recommended test improvements
4. Run full test suite: `npm test`
5. Verify coverage: `npm run test:coverage`
6. Commit changes: `git commit -m "test: Enhance test coverage for vX.X.X release"`

### Verification Steps

After completing all three agents and their fixes:

```bash
# 1. Ensure all changes are committed
git status  # Should be clean

# 2. Run full build
npm run build  # Must succeed with 0 errors

# 3. Run complete test suite
npm test  # All tests must pass

# 4. Check for vulnerabilities
npm audit  # Should show 0 critical/high vulnerabilities

# 5. Verify test coverage (optional but recommended)
npm run test:coverage  # Check coverage metrics
```

### When to Skip

You may skip this workflow if:
- This is a hotfix release addressing an urgent bug
- No code changes since last review (documentation-only releases)
- Last review was < 7 days ago and no significant changes made

**In all other cases, run the full workflow.**

### Common Issues

**Problem:** Agent outputs are outdated
- **Solution:** Delete old reports in `docs/development/` and re-run agents

**Problem:** Too many findings to address
- **Solution:** Focus on CRITICAL/HIGH severity issues first. Create GitHub issues for MEDIUM/LOW items to address post-release.

**Problem:** Tests fail after implementing fixes
- **Solution:** This is expected! Fix the test failures or adjust the fixes. Never proceed with failing tests.

**Problem:** Agent not available in Claude Code
- **Solution:** Verify agents exist in `.claude/agents/`. If missing, skip automated review but manually review code, security, and tests before release.

---

**✅ Checkpoint:** Once all fixes are committed and verification passes, proceed to Step 0 (version bumping).

---

## Step 0: Update Version Numbers (Do This First!)

**CRITICAL:** Before any publishing steps, update versions in BOTH files to match.

### 0.1 Update package.json

```bash
# Edit package.json manually or use npm version
# For manual editing:
vim package.json  # Change "version": "0.3.0" → "0.4.0"

# Or use npm version command (auto-commits and tags):
npm version minor  # 0.3.0 → 0.4.0
npm version patch  # 0.3.0 → 0.3.1
```

### 0.2 Update server.json

Update **both** version and description (if needed):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
  "name": "io.github.dgahagan/weather-mcp",
  "title": "Weather Data MCP Server",
  "description": "Global weather forecasts, location search, current conditions & historical data (1940-present).",
  "version": "0.4.0",  // ← Update this
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@dangahagan/weather-mcp",
      "version": "0.4.0",  // ← Update this too
      "transport": {
        "type": "stdio"
      }
    }
  ],
  "homepage": "https://github.com/dgahagan/weather-mcp",
  "license": "MIT",
  "categories": ["data", "utilities"],
  "keywords": ["weather", "forecast", "noaa", "open-meteo"]
}
```

**Important:** Description must be ≤100 characters or MCP registry publishing will fail.

### 0.3 Commit Version Updates

```bash
git add package.json server.json
git commit -m "chore: bump version to 0.4.0 for release"
git push origin main
```

---

## Step 1: Build and Test

Before publishing, ensure everything builds correctly.

### 1.1 Build the Project

```bash
npm run build
```

This should complete without errors.

### 1.2 Run Tests

```bash
npm test
```

All tests must pass before publishing.

### 1.3 Dry Run (Preview Package Contents)

```bash
npm pack --dry-run
```

Expected output should include:
- `dist/` directory (all compiled TypeScript)
- `README.md`
- `LICENSE`
- `package.json`

Verify:
- ✅ No unexpected files (like `.env`, `node_modules/`, test files)
- ✅ All necessary files are included
- ✅ Package size is reasonable (should be ~60-70 KB)

---

## Step 2: Publish to npm

### 2.1 Verify npm Login

```bash
# Check if you're logged in
npm whoami

# If not logged in:
npm login
```

### 2.2 Publish

```bash
# Publish with public access (required for scoped packages)
npm publish --access public
```

This will:
1. Run `prepublishOnly` script (builds the project)
2. Create tarball
3. Upload to npm registry

### 2.3 Verify Publication

```bash
# Check the published version
npm view @dangahagan/weather-mcp version

# Check all published versions
npm view @dangahagan/weather-mcp versions

# Check dist-tags (should show latest)
npm view @dangahagan/weather-mcp dist-tags

# Test installation
npx @dangahagan/weather-mcp@latest
```

You should see your new version as `latest`.

---

## Step 3: Create GitHub Release

You can create a GitHub release using either the CLI (faster) or web UI.

### Option A: GitHub CLI (Recommended)

```bash
gh release create v0.4.0 \
  --title "v0.4.0 - Your Release Title" \
  --notes-file release-notes.md

# Or inline notes:
gh release create v0.4.0 \
  --title "v0.4.0 - Your Release Title" \
  --notes "## Release notes here..."
```

**Pro tip:** Save your release notes to a file first, then reference it with `--notes-file`.

### Option B: GitHub Web UI

1. Go to https://github.com/dgahagan/weather-mcp/releases
2. Click **"Draft a new release"**
3. Click **"Choose a tag"**
   - If tag exists: select `v0.4.0`
   - If not: type `v0.4.0` and click "Create new tag: v0.4.0 on publish"
4. Release title: `v0.4.0 - Your Release Title`
5. Description: Use the template below
6. Click **"Publish release"**

### 3.1 Release Notes Template

Use this template and adapt for your release:

````markdown
## Weather MCP Server v0.4.0

Brief description of what this release adds/changes.

### 🌟 New Features

- **Feature name** - Description of feature
- **Another feature** - Description

### 🚀 Enhancements

- Enhancement 1
- Enhancement 2

### 🐛 Bug Fixes

- Fix 1 - Description
- Fix 2 - Description

### 📦 Installation

```bash
# Via npm (recommended)
npm install -g @dangahagan/weather-mcp

# Via npx (no installation)
npx @dangahagan/weather-mcp
```

### 🔧 Usage

Add to your MCP client configuration:

**Claude Code** (`~/.config/claude-code/mcp_settings.json`):
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp"]
    }
  }
}
```

**Claude Desktop** (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp"]
    }
  }
}
```

See [CLIENT_SETUP.md](https://github.com/dgahagan/weather-mcp/blob/main/docs/CLIENT_SETUP.md) for all supported clients.

### 📊 Technical Details

- **Package**: [@dangahagan/weather-mcp](https://www.npmjs.com/package/@dangahagan/weather-mcp)
- **Tests**: XXX tests passing
- **Node.js**: 18.0.0 or higher required
- **No API keys required**

### 📚 Documentation

- [README.md](https://github.com/dgahagan/weather-mcp#readme)
- [CHANGELOG.md](https://github.com/dgahagan/weather-mcp/blob/main/docs/releases/CHANGELOG.md)
- Full release notes in CHANGELOG

### 🙏 Contributing

Contributions welcome! Please submit issues or pull requests.

### 📄 License

MIT License - see [LICENSE](https://github.com/dgahagan/weather-mcp/blob/main/LICENSE)
````

---

## Step 4: Git Tag Workflow

Choose the workflow that best fits your process.

### Option A: Tag After Version Update (Recommended)

This is the cleanest approach - update versions, commit, then tag.

```bash
# 1. Update versions in package.json and server.json
vim package.json server.json

# 2. Commit version updates
git add package.json server.json
git commit -m "chore: bump version to 0.4.0"

# 3. Create annotated tag
git tag -a v0.4.0 -m "Release v0.4.0: Your release title"

# 4. Push everything
git push origin main --tags
```

### Option B: Tag Before Version Update

If you already created a tag from the previous commit:

```bash
# 1. Create tag first (from current commit)
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0

# 2. Update version files
vim package.json server.json

# 3. Commit and push version updates
git add package.json server.json
git commit -m "chore: bump version to 0.4.0 for release"
git push origin main
```

**Note:** With this approach, the tag points to the commit *before* the version update, which is fine but less clean.

### Option C: Using npm version (Auto-tags)

```bash
# Update version AND create git tag automatically
npm version minor  # 0.3.0 → 0.4.0 (also creates v0.4.0 tag)

# Still need to update server.json manually
vim server.json

# Commit server.json
git add server.json
git commit -m "chore: update server.json to 0.4.0"

# Push with tags
git push origin main --tags
```

---

## Step 5: Update Official MCP Registry

The Official MCP Registry (https://registry.modelcontextprotocol.io) is the primary directory for MCP servers.

### 5.1 Prerequisites

1. ✅ **server.json** exists and is updated (done in Step 0)
2. ✅ **mcp-publisher** binary in project root
3. ✅ **GitHub authentication** (you'll need to authorize)

### 5.2 Install mcp-publisher (One-time Setup)

If you don't have the `mcp-publisher` binary:

**Option 1: Homebrew (macOS/Linux)**
```bash
brew install mcp-publisher
```

**Option 2: Download Binary**
Download from https://github.com/modelcontextprotocol/registry/releases

**Option 3: Build from Source**
```bash
git clone https://github.com/modelcontextprotocol/registry.git
cd registry
make publisher
# Binary will be in ./bin/mcp-publisher
cp ./bin/mcp-publisher /path/to/weather-mcp/
```

For this project, the `mcp-publisher` binary is already in the project root.

### 5.3 Authenticate with GitHub (ALWAYS DO THIS FIRST)

**⚠️ IMPORTANT:** Authentication tokens expire frequently (often between releases). **ALWAYS login first** before attempting to publish to avoid authentication errors.

**Recommended Workflow:**
```bash
# Step 1: Login first (ALWAYS)
./mcp-publisher login github

# Step 2: Then publish immediately after successful login
./mcp-publisher publish
```

**Authentication Process:**

```bash
# Using local binary
./mcp-publisher login github

# Using installed binary (if installed globally)
mcp-publisher login github
```

This will:
1. Display a GitHub device code (e.g., `CE98-5582`)
2. Prompt you to visit https://github.com/login/device
3. Ask you to enter the code and authorize the application
4. Save authentication credentials locally
5. Display "✓ Successfully logged in"

**Note:** Keep your terminal window open during this process.

**Why login first?** Authentication tokens expire between releases (days/weeks), and attempting to publish with an expired token will fail with:
```
Error: publish failed: server returned status 401: {"title":"Unauthorized","status":401,"detail":"Invalid or expired Registry JWT token"}
```

By logging in first, you avoid this error and save time.

### 5.4 Publish to Registry

```bash
# Make sure server.json is committed and pushed (should be done in Step 0)
git status  # Verify clean working tree

# IMPORTANT: Login first (tokens expire frequently)
./mcp-publisher login github

# Then publish to registry
./mcp-publisher publish
```

Expected output:
```
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.dgahagan/weather-mcp version 0.4.0
```

### 5.5 Verify Publication

Check the registry to confirm your update:

```bash
# Via curl (with pretty printing)
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp" | python3 -m json.tool

# Or just check for your version
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp" | grep -A 2 "\"version\": \"0.4.0\""

# Via browser
# Visit: https://registry.modelcontextprotocol.io/v0/servers?search=io.github.dgahagan/weather-mcp
```

Look for:
- ✅ Your new version (`"version": "0.4.0"`)
- ✅ `"isLatest": true` on your version
- ✅ Updated description (if you changed it)

### 5.6 Common Issues

**Error: "Invalid or expired Registry JWT token"**
```
Error: publish failed: server returned status 401: {"title":"Unauthorized","status":401,"detail":"Invalid or expired Registry JWT token"}
```
**Solution:** Re-authenticate with `./mcp-publisher login github`

**Error: "validation failed - description length"**
```
Error: validation failed: description must be ≤100 characters
```
**Solution:**
- Edit `server.json` and shorten the description
- Commit and push the change
- Run `./mcp-publisher publish` again

**Error: "authentication required"**
```
Error: authentication required for namespace io.github.dgahagan
```
**Solution:**
- Run `./mcp-publisher login github`
- Ensure your GitHub account matches the namespace (`dgahagan` must own `io.github.dgahagan`)

**Error: "version already exists"**
```
Error: version 0.4.0 already published for io.github.dgahagan/weather-mcp
```
**Solution:**
- Each version can only be published once
- Increment to next version (e.g., 0.4.0 → 0.4.1)
- Update both `package.json` and `server.json`
- Republish

---

## Version Numbering (Semantic Versioning)

Follow semantic versioning (semver): **MAJOR.MINOR.PATCH**

### When to Increment

- **MAJOR** (e.g., 1.0.0 → 2.0.0): Breaking changes
  - Renamed tools
  - Removed functionality
  - Changed parameter types
  - Incompatible API changes

- **MINOR** (e.g., 0.3.0 → 0.4.0): New features, backward compatible
  - New tools added
  - New parameters (optional)
  - New functionality

- **PATCH** (e.g., 0.3.0 → 0.3.1): Bug fixes, backward compatible
  - Bug fixes
  - Performance improvements
  - Documentation updates
  - Internal refactoring

### Examples

- `0.3.0` → `0.3.1`: Fixed caching bug
- `0.3.1` → `0.4.0`: Added `search_location` tool (new feature)
- `0.4.0` → `1.0.0`: Renamed all tools, removed deprecated parameters (breaking)

### Pre-1.0.0 Versioning

Before version 1.0.0, breaking changes can happen in MINOR versions:
- `0.3.0` → `0.4.0` could include breaking changes
- This is acceptable for pre-release software
- Once at 1.0.0, follow strict semver

---

## Post-Release Verification

After publishing, verify everything works:

### Test Installation

```bash
# Test global installation
npm install -g @dangahagan/weather-mcp@latest
weather-mcp --version

# Test npx (no installation)
npx @dangahagan/weather-mcp@latest
```

### Test with MCP Client

1. Update your `mcp_settings.json`:
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@dangahagan/weather-mcp@latest"]
    }
  }
}
```

2. Restart Claude Code or your MCP client

3. Test a query:
   - "What's the weather in Paris?"
   - "Get the forecast for Tokyo"
   - "Search for London coordinates"

### Monitor

After release, monitor:

1. **npm downloads** - `npm view @dangahagan/weather-mcp`
2. **GitHub issues** - Check for bug reports
3. **MCP Registry** - Verify listing appears correctly
4. **User feedback** - Discord, GitHub discussions, etc.

---

## Automation (Future Enhancement)

Consider adding GitHub Actions for automated publishing:

```yaml
# .github/workflows/publish.yml
name: Publish Package
on:
  release:
    types: [published]

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm test
      - run: npm run build

      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-mcp-registry:
    runs-on: ubuntu-latest
    needs: publish-npm
    steps:
      - uses: actions/checkout@v4

      - name: Download mcp-publisher
        run: |
          curl -L -o mcp-publisher https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher-linux
          chmod +x mcp-publisher

      - name: Publish to MCP Registry
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: ./mcp-publisher publish
```

**Required Secrets:**
- `NPM_TOKEN` - Create at https://www.npmjs.com/settings/YOUR_USERNAME/tokens
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

---

## Troubleshooting

### npm publish fails

**Problem:** `npm ERR! 403 Forbidden`
```bash
# Solution: Check you're logged in
npm whoami

# If not logged in:
npm login
```

**Problem:** `npm ERR! Package already exists`
```bash
# Solution: Increment version
# Edit package.json, bump version, try again
```

### GitHub release creation fails

**Problem:** Tag already exists
```bash
# Solution: Use existing tag or delete and recreate
git tag -d v0.4.0  # Delete local tag
git push origin :refs/tags/v0.4.0  # Delete remote tag
git tag -a v0.4.0 -m "Release v0.4.0"
git push origin v0.4.0
```

### MCP Registry publish fails

See section 5.6 "Common Issues" above for detailed solutions.

---

## Getting Help

- **npm docs**: https://docs.npmjs.com/
- **MCP docs**: https://modelcontextprotocol.io/
- **MCP Registry**: https://github.com/modelcontextprotocol/registry
- **Semantic versioning**: https://semver.org/
- **GitHub CLI**: https://cli.github.com/manual/

---

## Summary

The complete publishing workflow:

1. ✅ **Pre-release quality checks** - Run code-reviewer, security-auditor, and test-automator agents; fix all findings (~30-60 min)
2. ✅ Update `package.json` and `server.json` versions
3. ✅ Commit and push version updates
4. ✅ Build and test (`npm run build && npm test`)
5. ✅ Publish to npm (`npm publish --access public`)
6. ✅ Create GitHub release (`gh release create` or web UI)
7. ✅ Publish to MCP Registry (`./mcp-publisher login github && ./mcp-publisher publish`)
8. ✅ Verify all publications
9. ✅ Test installation with npx

**Time estimate:**
- First-time/major release: ~45-75 minutes (including pre-release quality workflow)
- Minor/patch release: ~20-30 minutes (if minimal fixes needed from agents)

Happy publishing! 🚀
