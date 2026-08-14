# Weather MCP Server Documentation

This directory contains comprehensive documentation for the Weather MCP Server project.

## Documentation Structure

### 📁 Getting Started
- **[../README.md](../README.md)** - Main project README with installation and usage instructions
- **[../examples/](../examples/README.md)** - Realistic sessions: prompt → assistant answer → verbatim server output (regenerable via `npm run examples`)
- **[CLIENT_SETUP.md](./CLIENT_SETUP.md)** - Setup guides for 8 different MCP clients

### 📁 Analytics (`analytics/`)
- **[ANALYTICS_MCP_PLAN.md](./analytics/ANALYTICS_MCP_PLAN.md)** - Privacy-first analytics implementation plan
- **[MCP_ANALYTICS_SECURITY_GUIDE.md](./analytics/MCP_ANALYTICS_SECURITY_GUIDE.md)** - Comprehensive security guide for analytics
- **[LOCAL_ANALYTICS_GUIDE.md](./analytics/LOCAL_ANALYTICS_GUIDE.md)** - Local analytics setup and usage

### 📁 Planning (`planning/`)
- **[README.md](./planning/README.md)** - **Status index** — single source of truth for feature-idea status (idea/planned/shipped/rejected)
- **[INTERNATIONAL_COVERAGE_ROADMAP.md](./planning/INTERNATIONAL_COVERAGE_ROADMAP.md)** - Sequenced plan for taking US-only tools global
- **[FUTURE_ENHANCEMENTS.md](./planning/FUTURE_ENHANCEMENTS.md)** - Raw idea pool with research notes and data sources
- **[FORK_DERIVED_IDEAS.md](./planning/FORK_DERIVED_IDEAS.md)** - Larger feature ideas surfaced by reviewing public forks (2026-08)
- **[archive/](./planning/archive/)** - Historical docs: original implementation plan, v0.x–v1.6 roadmap

### 📁 Testing (`testing/`)
- **[TESTING_GUIDE.md](./testing/TESTING_GUIDE.md)** - Manual testing procedures and test cases
- **[TEST_SUITE_README.md](./testing/TEST_SUITE_README.md)** - Test suite overview and structure
- **[TEST_COVERAGE_REPORT_V1.0.md](./testing/TEST_COVERAGE_REPORT_V1.0.md)** - Test coverage analysis v1.0
- **[TEST_COVERAGE_ANALYSIS_2025.md](./testing/TEST_COVERAGE_ANALYSIS_2025.md)** - Latest test coverage analysis
- **[TEST_RECOMMENDATIONS.md](./testing/TEST_RECOMMENDATIONS.md)** - Test improvement recommendations

### 📁 Development (`development/`)
- **[CODE_REVIEW.md](./development/CODE_REVIEW.md)** - Comprehensive code quality analysis
- **[CODE_QUALITY_REPORT_V1.6.md](./development/CODE_QUALITY_REPORT_V1.6.md)** - Code quality report v1.6
- **[SECURITY_AUDIT.md](./development/SECURITY_AUDIT.md)** - Security audit report
- **[SECURITY_AUDIT_V1.6.md](./development/SECURITY_AUDIT_V1.6.md)** - Security audit v1.6
- **[TEST_QUALITY_ASSESSMENT_V1.2.md](./development/TEST_QUALITY_ASSESSMENT_V1.2.md)** - Test quality assessment
- **[TEST_GAPS_CRITICAL.md](./development/TEST_GAPS_CRITICAL.md)** - Critical test gaps analysis
- **[CLIMATE_NORMALS_PLAN.md](./development/CLIMATE_NORMALS_PLAN.md)** - Climate normals implementation plan
- **[DOCUMENTATION_MAINTENANCE.md](./development/DOCUMENTATION_MAINTENANCE.md)** - Documentation maintenance guide (source-of-truth map, release flow, archiving)

### 📁 Publishing (`publishing/`)
- **[PUBLISHING.md](./publishing/PUBLISHING.md)** - Publishing guide for npm and MCP registry
- **[REGISTRY_SUBMISSION.md](./publishing/REGISTRY_SUBMISSION.md)** - MCP Registry submission process

### 📁 Releases (`releases/`)
- **[CHANGELOG.md](./releases/CHANGELOG.md)** - Complete changelog for all versions
- **[RELEASE_NOTES_v0.1.0.md](./releases/RELEASE_NOTES_v0.1.0.md)** - Detailed release notes for v0.1.0

### 📁 User Guides
- **[ERROR_HANDLING.md](./ERROR_HANDLING.md)** - Enhanced error handling features
- **[MCP_BEST_PRACTICES.md](./MCP_BEST_PRACTICES.md)** - Guide for service status communication

### 📁 Technical Documentation
- **[TOOLS.md](./TOOLS.md)** - Complete MCP tool reference
- **[NOAA_API_RESEARCH.md](./NOAA_API_RESEARCH.md)** - NOAA API research and integration details
- **[orchestration-playbook.md](./orchestration-playbook.md)** - How design plans are written and executed (`/impl-plan`, `/run-plan`)

### 📁 Design Plans (`plans/`)
Shipped features' design plans, implementation plans, and verification
reports. In-flight plans live at the docs root until they ship.
- **[plans/](./plans/)** - e.g. `global-current-conditions-*`, `max-range-expansion-*`, `output-completeness-*`

### 📁 Archive (`archive/`)
- **[archive/](./archive/)** - Historical docs: original project status/description, superseded plans and guides

### 📁 Root Level Documentation
- **[../CLAUDE.md](../CLAUDE.md)** - AI assistant development guide
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** - Contribution guidelines
- **[../SECURITY.md](../SECURITY.md)** - Security policy and vulnerability reporting
- **[../CHANGELOG.md](../CHANGELOG.md)** - Version history

## Quick Links

### For Users
- [Installation](../README.md#installation)
- [Setup Guide](./CLIENT_SETUP.md)
- [Testing Guide](./testing/TESTING_GUIDE.md)
- [Error Handling](./ERROR_HANDLING.md)

### For Contributors
- [Contributing Guidelines](../CONTRIBUTING.md)
- [Code Review](./development/CODE_REVIEW.md)
- [Security Policy](../SECURITY.md)
- [Planning Status Index](./planning/README.md)

### For Maintainers
- [Publishing Guide](./publishing/PUBLISHING.md)
- [Changelog](../CHANGELOG.md)
- [Security Audit](./development/SECURITY_AUDIT_V1.6.md)
- [Planning Status Index](./planning/README.md)

### For Testing
- [Test Suite Overview](./testing/TEST_SUITE_README.md)
- [Test Coverage Report](./testing/TEST_COVERAGE_ANALYSIS_2025.md)
- [Test Recommendations](./testing/TEST_RECOMMENDATIONS.md)
- [Testing Guide](./testing/TESTING_GUIDE.md)

### For Analytics Implementation
- [Analytics Plan](./analytics/ANALYTICS_MCP_PLAN.md)
- [Analytics Security Guide](./analytics/MCP_ANALYTICS_SECURITY_GUIDE.md)
- [Local Analytics](./analytics/LOCAL_ANALYTICS_GUIDE.md)

## Documentation by Category

### 🔒 Security
- [Security Policy](../SECURITY.md)
- [Security Audit v1.6](./development/SECURITY_AUDIT_V1.6.md)
- [Analytics Security Guide](./analytics/MCP_ANALYTICS_SECURITY_GUIDE.md)

### 🧪 Testing & Quality
- [Test Suite README](./testing/TEST_SUITE_README.md)
- [Test Coverage Analysis](./testing/TEST_COVERAGE_ANALYSIS_2025.md)
- [Code Quality Report](./development/CODE_QUALITY_REPORT_V1.6.md)
- [Test Gaps Analysis](./development/TEST_GAPS_CRITICAL.md)

### 📋 Planning & Roadmap
- [Planning Status Index](./planning/README.md)
- [International Coverage Roadmap](./planning/INTERNATIONAL_COVERAGE_ROADMAP.md)
- [Future Enhancements](./planning/FUTURE_ENHANCEMENTS.md)

### 🔧 Development
- [Code Review](./development/CODE_REVIEW.md)
- [AI Assistant Guide](../CLAUDE.md)
- [Documentation Maintenance](./development/DOCUMENTATION_MAINTENANCE.md)

## Version Information

- **Current Version:** 1.20.0
- **Security Posture:** A- (Excellent, 93/100)
- **Test Coverage:** 1,961 tests, 100% pass rate
- **Code Quality:** A+ (Excellent, 97.5/100)
- **Risk Level:** LOW

---

For the main project documentation, see [../README.md](../README.md)
