# Publishing Guide

This guide covers how to publish the Weather MCP Server to npm, create GitHub releases, and list in MCP registries.

## Prerequisites

1. **npm account** - Create at https://www.npmjs.com/signup
2. **npm login** - Run `npm login` in your terminal
3. **GitHub repository** - Already done! (public repo at github.com/dgahagan/weather-mcp)

## Step 1: Create a GitHub Release

### 1.1 Create and Push a Version Tag

```bash
# Ensure all changes are committed
git status

# Create a version tag
git tag -a v0.1.0 -m "Release v0.1.0: Initial public release with enhanced error handling"

# Push the tag to GitHub
git push origin v0.1.0
```

### 1.2 Create Release on GitHub

1. Go to https://github.com/dgahagan/weather-mcp/releases
2. Click "Draft a new release"
3. Click "Choose a tag" and select `v0.1.0`
4. Release title: `v0.1.0 - Initial Public Release`
5. Description:

```markdown
## Weather MCP Server v0.1.0

Initial public release of the Weather MCP Server - a Model Context Protocol server providing comprehensive weather data with no API keys required!

### Features

- 🌤️ **Weather Forecasts** (7-day) for US locations via NOAA API
- 🌡️ **Current Conditions** for US locations via NOAA API
- 📊 **Historical Weather Data** (1940-present) globally via Open-Meteo API
- 🔍 **Service Status Checking** with proactive health monitoring
- ⚡ **Enhanced Error Handling** with actionable guidance and status page links
- 🔑 **No API Keys Required** - completely free to use

### Installation

#### Via npm (Recommended)
```bash
npm install -g weather-mcp
```

#### Via npx (No installation)
```bash
npx weather-mcp
```

#### From source
```bash
git clone https://github.com/dgahagan/weather-mcp.git
cd weather-mcp
npm install
npm run build
```

### Usage

Add to your MCP client configuration:

**Claude Code** (`~/.config/claude-code/mcp_settings.json`):
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "weather-mcp"]
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):
```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "weather-mcp"]
    }
  }
}
```

See [CLIENT_SETUP.md](./docs/CLIENT_SETUP.md) for setup instructions for all supported clients.

### What's New in v0.1.0

- ✅ Initial public release
- ✅ NOAA Weather API integration for US forecasts and current conditions
- ✅ Open-Meteo API integration for global historical weather data
- ✅ Service status checking tool
- ✅ Enhanced error handling with status page links
- ✅ Support for 8+ MCP clients (Claude Code, Claude Desktop, Cline, Cursor, Zed, etc.)
- ✅ Comprehensive documentation and testing

### Documentation

- [README.md](./README.md) - Main documentation
- [CLIENT_SETUP.md](./docs/CLIENT_SETUP.md) - Setup for various AI assistants
- [ERROR_HANDLING.md](./docs/ERROR_HANDLING.md) - Error handling documentation
- [MCP_BEST_PRACTICES.md](./docs/MCP_BEST_PRACTICES.md) - MCP implementation guide

### Requirements

- Node.js 18 or higher
- No API keys or tokens required

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### License

MIT License - see [LICENSE](./LICENSE) for details
```

6. Click "Publish release"

## Step 2: Publish to npm

### 2.1 Pre-publish Checks

```bash
# Verify package.json is correct
cat package.json

# Test build
npm run build

# Check what will be published (dry run)
npm pack --dry-run

# This should show:
# - dist/
# - README.md
# - LICENSE
# - package.json
```

### 2.2 Publish to npm

```bash
# First time: publish with public access
npm publish --access public

# Future updates:
# 1. Update version in package.json (e.g., 0.1.0 -> 0.1.1)
# 2. Create git tag
# 3. npm publish
```

### 2.3 Verify Publication

```bash
# Check your package is live
npm view weather-mcp

# Test installation
npx weather-mcp@latest --help
```

## Step 3: Update README with npm Installation

The README.md should be updated with npm installation instructions. See the changes in the next commit.

## Step 4: Submit to MCP Registries (Optional)

### GitHub MCP Registry

1. Add `mcpName` to package.json:
```json
{
  "mcpName": "io.github.dgahagan/weather-mcp"
}
```

2. Follow submission guide: https://github.com/github/mcp-servers

### Smithery.ai Registry

1. Visit https://smithery.ai
2. Click "Submit a server"
3. Provide npm package name: `weather-mcp`
4. Fill out server details

### Glama.ai Directory

1. Visit https://glama.ai/mcp/servers
2. Submit your server with npm package link

## Version Numbering (Semantic Versioning)

Follow semantic versioning (semver):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.2.0): New features, backward compatible
- **PATCH** (0.1.1): Bug fixes, backward compatible

Examples:
- `0.1.0` → `0.1.1`: Bug fixes
- `0.1.1` → `0.2.0`: Added new weather tool
- `0.2.0` → `1.0.0`: Changed tool names (breaking change)

## Release Checklist

Before each release:

- [ ] All tests pass
- [ ] README.md is up to date
- [ ] CHANGELOG.md is updated
- [ ] package.json version is incremented
- [ ] Code is committed and pushed to GitHub
- [ ] Git tag created and pushed
- [ ] GitHub release created
- [ ] npm package published
- [ ] Installation tested with `npx weather-mcp`
- [ ] MCP client configuration tested

## Automation (Future Enhancement)

Consider adding GitHub Actions for automated publishing:

```yaml
# .github/workflows/publish.yml
name: Publish to npm
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## Support After Publishing

Monitor these after publishing:

1. **GitHub Issues** - Respond to bug reports and feature requests
2. **npm downloads** - Track usage via `npm view weather-mcp`
3. **User feedback** - Gather feedback from MCP community
4. **Dependencies** - Keep @modelcontextprotocol/sdk up to date

## Getting Help

- npm docs: https://docs.npmjs.com/
- MCP docs: https://modelcontextprotocol.io/
- Semantic versioning: https://semver.org/
