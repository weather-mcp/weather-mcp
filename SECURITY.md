# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.6.x   | :white_check_mark: |
| 1.5.x   | :white_check_mark: |
| 1.4.x   | :white_check_mark: |
| 1.3.x   | :white_check_mark: |
| 1.2.x   | :white_check_mark: |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of the Weather MCP Server seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Where to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisory** (Preferred): Use the [GitHub Security Advisory](https://github.com/dgahagan/weather-mcp/security/advisories/new) feature
2. **Email**: Send an email to the project maintainer via GitHub profile contact information
3. **GitHub Issues**: For non-critical security concerns, you may open a regular issue with the `security` label

### What to Include

Please include the following information in your report:

- Type of vulnerability (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the vulnerability
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within **48 hours**
- **Initial Assessment**: We will provide an initial assessment of the vulnerability within **7 days**
- **Fix Timeline**:
  - **Critical vulnerabilities**: Patch within 7-14 days
  - **High vulnerabilities**: Patch within 14-30 days
  - **Medium vulnerabilities**: Patch in next regular release
  - **Low vulnerabilities**: May be addressed in future releases

### Security Update Policy

- Security patches will be released as soon as possible after verification
- Security advisories will be published after patches are available
- CVE IDs will be requested for vulnerabilities when appropriate
- Security releases will be clearly marked in release notes

## Security Best Practices for Users

### Dependency Security

This project has minimal runtime dependencies to reduce attack surface:

- `@modelcontextprotocol/sdk` - Official MCP SDK from Anthropic
- `axios` - Well-maintained HTTP client
- `dotenv` - Simple environment variable loader

**Automated Scanning:**

Run dependency audits regularly:
```bash
npm run audit
```

To automatically fix vulnerabilities (when safe):
```bash
npm run audit:fix
```

### GitHub Dependabot

We recommend enabling GitHub Dependabot for automated dependency updates:

1. Dependabot is enabled by default for public GitHub repositories
2. Configure `.github/dependabot.yml` if you want to customize update frequency
3. Review and merge Dependabot PRs promptly

Example `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

### Environment Security

- Never commit `.env` files or API keys to version control
- This server uses **public APIs only** and requires no authentication credentials
- Use environment variables for configuration (see README.md)

### Deployment Security

- Run the server with minimum necessary privileges
- Keep Node.js updated to the latest LTS version
- Use `npm ci` instead of `npm install` in production for reproducible builds
- Consider running in a containerized environment for isolation

## Known Security Considerations

### No Authentication Required

This MCP server uses public weather APIs (NOAA and Open-Meteo) that do not require API keys or authentication. This is by design and reduces security complexity.

### Data Privacy

- **Location Data**: The server processes geographic coordinates (latitude/longitude) transiently for API requests
- **No Personal Data**: No personal identifiable information is collected or stored
- **Local Cache**: Weather data is cached locally on the user's machine
- **No Tracking**: The server does not track users or send telemetry

### Network Security

- All external API calls use **HTTPS only**
- Certificate validation is enabled by default (via axios)
- No sensitive data is transmitted to external services

## Security Testing

### Current Security Controls

✅ **Implemented:**
- Comprehensive input validation with runtime type checking
- Error sanitization to prevent information leakage
- No hardcoded secrets or credentials
- Strong TypeScript typing with strict mode
- Graceful shutdown and resource cleanup
- Structured logging
- Comprehensive test coverage (131+ tests)

### Recommended Security Testing

1. **Dependency Auditing**: `npm run audit` (weekly)
2. **Static Analysis**: TypeScript strict mode catches many issues
3. **Input Fuzzing**: Test coordinate inputs with edge cases
4. **Error Path Testing**: Verify error messages don't leak sensitive info

## Security Audit History

- **2025-11-10**: Comprehensive security audit for v1.6.0 release (See SECURITY_AUDIT.md)
  - Overall Security Posture: **A- (Excellent, 93/100)**
  - Risk Level: **LOW**
  - Zero critical or high-severity vulnerabilities
  - 1,042 tests passing with 100% pass rate
  - Code Quality: A+ (97.5/100)

- **2025-11-06**: Initial comprehensive security audit for v1.5.0
  - Overall Security Posture: **B+ (Good)**
  - Risk Level: **LOW**
  - Zero critical or high-severity vulnerabilities
  - All recommended critical fixes implemented

## Scope Exclusions

The following are **out of scope** for security reports:

- Vulnerabilities in third-party APIs (NOAA, Open-Meteo)
- Runtime environment security (Node.js, OS)
- Network infrastructure
- Physical security
- Social engineering

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security Best Practices](https://docs.npmjs.com/security-best-practices)
- [GitHub Security Features](https://docs.github.com/en/code-security)

## Questions?

If you have questions about this security policy, please open a GitHub issue with the `question` label.

---

**Last Updated**: November 10, 2025
**Next Security Review**: May 2026 (6 months) or upon major version release
