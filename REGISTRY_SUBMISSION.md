# MCP Registry Submission Guide

This guide covers submitting the Weather MCP Server to various MCP registries for increased discoverability.

## Overview

There are three main MCP registries:

1. **GitHub MCP Registry** (Official) - Primary discovery source
2. **Smithery.ai** - Managed platform with deployment options
3. **Glama.ai** - Automatically aggregates from other registries

## Prerequisites Completed ✅

- [x] npm package published: `@dangahagan/weather-mcp`
- [x] GitHub repository public: https://github.com/dgahagan/weather-mcp
- [x] GitHub release created: v0.1.0
- [x] `smithery.yaml` configuration file added
- [x] `server.json` configuration file added

---

## 1. GitHub MCP Registry (Official)

**Website:** https://github.com/modelcontextprotocol/registry

### Why Submit Here?
- ✅ Official community-driven registry
- ✅ Primary source for MCP server discovery
- ✅ Most authoritative listing
- ✅ Referenced by other tools and platforms

### Submission Process

#### Step 1: Clone the Registry Repository

```bash
cd ~
git clone https://github.com/modelcontextprotocol/registry.git
cd registry
```

#### Step 2: Build the Publisher CLI

```bash
make publisher
```

#### Step 3: Run the Publisher

```bash
./bin/mcp-publisher --help
```

Follow the prompts to:
- Authenticate with GitHub (you'll use `io.github.dgahagan` namespace)
- Point to your `server.json` file
- Submit for review

#### Step 4: Create Pull Request

The publisher CLI will guide you through creating a PR to add your server to the registry.

### Namespace

Your server will be listed as:
```
io.github.dgahagan/weather-mcp
```

### Documentation

Full guide: https://github.com/modelcontextprotocol/registry/blob/main/docs/guides/publishing/publish-server.md

---

## 2. Smithery.ai

**Website:** https://smithery.ai

### Why Submit Here?
- ✅ One-click installation for users
- ✅ Auto-deployment from GitHub
- ✅ Managed hosting options
- ✅ Good discoverability

### Submission Process

#### Option 1: Local Distribution (Recommended for npm packages)

1. **Visit:** https://smithery.ai/new
2. **Click:** "External MCP"
3. **Provide:**
   - **Package Type:** npm
   - **Package Name:** `@dangahagan/weather-mcp`
   - **Description:** Copy from README
   - **Homepage:** https://github.com/dgahagan/weather-mcp
4. **Submit** for approval

#### Option 2: Smithery-Managed Deployment

1. **Visit:** https://smithery.ai/new
2. **Click:** "Connect GitHub Repository"
3. **Select:** dgahagan/weather-mcp
4. **Grant** repository permissions
5. Smithery will:
   - Detect `smithery.yaml`
   - Build and containerize your server
   - Deploy automatically

#### Option 3: Manual Submission

1. Install Smithery CLI:
   ```bash
   npm install -g @smithery/cli
   ```

2. Login:
   ```bash
   smithery login
   ```

3. Publish:
   ```bash
   cd /home/dgahagan/work/personal/weather-mcp
   smithery publish
   ```

### What Happens After Submission

- Your server appears in the Smithery directory
- Users can install with: `npx @smithery/cli install @dangahagan/weather-mcp --client claude`
- Auto-updates when you push to GitHub (if using managed deployment)

### Documentation

- Main docs: https://smithery.ai/docs
- Publishing guide: https://smithery.ai/docs/build/getting-started

---

## 3. Glama.ai

**Website:** https://glama.ai/mcp/servers

### Why Submit Here?
- ✅ Good search and discovery
- ✅ Detailed server information
- ✅ User reviews and ratings

### Submission Process

Glama automatically aggregates servers from other registries, but you can also submit directly:

1. **Visit:** https://glama.ai/mcp/servers
2. **Click:** "Submit Server" (if available)
3. **Provide:**
   - npm package: `@dangahagan/weather-mcp`
   - GitHub repo: https://github.com/dgahagan/weather-mcp
   - Description and details

**OR** wait for automatic indexing once you're in GitHub MCP Registry or Smithery.

---

## Recommended Submission Order

1. **First:** GitHub MCP Registry (official, most important)
2. **Second:** Smithery.ai (best user experience)
3. **Third:** Glama.ai (usually automatic after #1 or #2)

---

## After Submission

### Monitor Your Listings

- **GitHub Registry:** Check your PR status and respond to feedback
- **Smithery:** Monitor your server page for usage stats
- **Glama:** Watch for user reviews and questions

### Update Your README

Once approved, add registry badges:

```markdown
[![GitHub MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://github.com/modelcontextprotocol/registry)
[![Smithery](https://img.shields.io/badge/Smithery-Published-green)](https://smithery.ai/server/@dangahagan/weather-mcp)
```

### Keep Your Listings Updated

When you release new versions:

1. Update npm package: `npm version patch && npm publish`
2. Create GitHub release
3. Registries will automatically detect updates

---

## Troubleshooting

### GitHub Registry

**Issue:** Namespace ownership errors
**Solution:** Ensure you're authenticated as `dgahagan` on GitHub

**Issue:** server.json validation errors
**Solution:** Check schema at https://modelcontextprotocol.io/schemas/registry/server.json

### Smithery

**Issue:** Build failures
**Solution:** Check `smithery.yaml` configuration and ensure TypeScript builds locally

**Issue:** Permission errors
**Solution:** Install Smithery GitHub App on your repository

### Glama

**Issue:** Not showing up
**Solution:** Usually takes 24-48 hours for automatic indexing from other registries

---

## Quick Start Commands

```bash
# For GitHub Registry (after cloning registry repo)
cd ~/registry
make publisher
./bin/mcp-publisher

# For Smithery CLI
npm install -g @smithery/cli
smithery login
smithery publish

# Verify submissions
# Check GitHub Registry: https://github.com/modelcontextprotocol/registry
# Check Smithery: https://smithery.ai/server/@dangahagan/weather-mcp
# Check Glama: https://glama.ai/mcp/servers
```

---

## Benefits of Registry Submission

Once submitted to registries, users will:

- **Discover** your server through registry search
- **Install** with one command via registry tools
- **Trust** your server more (vetted by registries)
- **Update** automatically when you release new versions

Your server's discoverability will increase significantly!

---

## Support

- **GitHub Registry Issues:** https://github.com/modelcontextprotocol/registry/issues
- **Smithery Support:** https://smithery.ai/docs or email support
- **Glama Support:** Through their platform or GitHub

---

## Files Added for Registry Submission

- ✅ `server.json` - GitHub MCP Registry configuration
- ✅ `smithery.yaml` - Smithery.ai configuration
- ✅ `package.json` - Already configured for npm
- ✅ `README.md` - Comprehensive documentation
