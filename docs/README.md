# Weather MCP Server Documentation

This directory contains the user- and contributor-facing documentation for the
Weather MCP Server.

> **Note on internal docs.** Design plans, implementation plans, code reviews,
> security audits, coverage analyses and the feature-idea roadmap are *internal
> development history* and are not published with the source. They live in a
> private `.devdocs` tree outside this repository. Anything a user or
> contributor needs to read is here or at the repository root.

## Documentation Structure

### 📁 Getting Started
- **[../README.md](../README.md)** - Main project README with installation and usage instructions
- **[../examples/](../examples/README.md)** - Realistic sessions: prompt → assistant answer → verbatim server output (regenerable via `npm run examples`)
- **[CLIENT_SETUP.md](./CLIENT_SETUP.md)** - Setup guides for 8 different MCP clients

### 📁 Tool Reference
- **[TOOLS.md](./TOOLS.md)** - Complete MCP tool reference: every tool, its parameters, and its output
- **[ERROR_HANDLING.md](./ERROR_HANDLING.md)** - Error handling behaviour and messages
- **[MCP_BEST_PRACTICES.md](./MCP_BEST_PRACTICES.md)** - Guide for service status communication

### 📁 Optional API Keys
Every tool works with no key at all. These guides cover the optional keys that
extend coverage beyond their keyless path:
- **[GOOGLE_WEATHER_KEY_SETUP.md](./GOOGLE_WEATHER_KEY_SETUP.md)** - `GOOGLE_WEATHER_API_KEY` — global alerts fallback
- **[GOOGLE_POLLEN_KEY_SETUP.md](./GOOGLE_POLLEN_KEY_SETUP.md)** - `GOOGLE_POLLEN_API_KEY` — global pollen fallback

### 📁 Testing (`testing/`)
- **[TESTING_GUIDE.md](./testing/TESTING_GUIDE.md)** - Manual testing procedures and test cases
- **[TEST_SUITE_README.md](./testing/TEST_SUITE_README.md)** - Test suite overview and structure

### 📁 Analytics (`analytics/`)
- **[MCP_ANALYTICS_SECURITY_GUIDE.md](./analytics/MCP_ANALYTICS_SECURITY_GUIDE.md)** - Security guide for analytics
- **[LOCAL_ANALYTICS_GUIDE.md](./analytics/LOCAL_ANALYTICS_GUIDE.md)** - Local analytics setup and usage

### 📁 Publishing (`publishing/`)
- **[PUBLISHING.md](./publishing/PUBLISHING.md)** - Publishing to npm and creating GitHub releases
- **[REGISTRY_SUBMISSION.md](./publishing/REGISTRY_SUBMISSION.md)** - MCP Registry submission process

### 📁 Releases (`releases/`)
- **[CHANGELOG.md](./releases/CHANGELOG.md)** - Frozen historical changelog through v1.6.0. The **live** changelog is [../CHANGELOG.md](../CHANGELOG.md)
- **[RELEASE_NOTES_v0.1.0.md](./releases/RELEASE_NOTES_v0.1.0.md)** - Detailed release notes for v0.1.0

### 📁 Root Level Documentation
- **[../CLAUDE.md](../CLAUDE.md)** - AI assistant development guide
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** - Contribution guidelines
- **[../SECURITY.md](../SECURITY.md)** - Security policy and vulnerability reporting
- **[../CHANGELOG.md](../CHANGELOG.md)** - Version history

## Quick Links

### For Users
- [Installation](../README.md#installation)
- [Setup Guide](./CLIENT_SETUP.md)
- [Tool Reference](./TOOLS.md)
- [Error Handling](./ERROR_HANDLING.md)

### For Contributors
- [Contributing Guidelines](../CONTRIBUTING.md)
- [AI Assistant Guide](../CLAUDE.md)
- [Testing Guide](./testing/TESTING_GUIDE.md)
- [Test Suite Overview](./testing/TEST_SUITE_README.md)

### For Maintainers
- [Publishing Guide](./publishing/PUBLISHING.md)
- [Registry Submission](./publishing/REGISTRY_SUBMISSION.md)
- [Changelog](../CHANGELOG.md)

### 🔒 Security
- [Security Policy](../SECURITY.md)
- [Analytics Security Guide](./analytics/MCP_ANALYTICS_SECURITY_GUIDE.md)

## Version Information

- **Current Version:** 1.28.0
- **Test Coverage:** 3,250 tests, 100% pass rate

---

For the main project documentation, see [../README.md](../README.md)
