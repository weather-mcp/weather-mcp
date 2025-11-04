# Contributing to Weather MCP Server

Thank you for your interest in contributing to Weather MCP Server! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project aims to foster an open and welcoming environment. Please be respectful and constructive in all interactions.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue on GitHub with:
- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Your environment (OS, Node.js version, etc.)
- Any relevant error messages or logs

### Suggesting Enhancements

We welcome feature suggestions! Please open an issue with:
- A clear description of the feature
- The use case it addresses
- Any implementation ideas (optional)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following the coding standards below
3. **Test your changes** thoroughly
4. **Update documentation** if needed
5. **Submit a pull request** with a clear description

## Development Setup

1. Clone your fork:
```bash
git clone https://github.com/your-username/weather-mcp.git
cd weather-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Run tests:
```bash
npx tsx test_noaa_api.ts
```

## Coding Standards

### TypeScript

- Use TypeScript for all code
- Enable strict mode (already configured)
- Provide type annotations for function parameters and return values
- Avoid using `any` type unless absolutely necessary

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons at the end of statements
- Follow existing code patterns and conventions
- Keep functions focused and single-purpose
- Use descriptive variable and function names

### Comments

- Add comments for complex logic
- Document public APIs and interfaces
- Explain "why" not "what" in comments
- Keep comments up-to-date with code changes

### Error Handling

- Always handle errors gracefully
- Provide clear, user-friendly error messages
- Log detailed errors for debugging (to stderr)
- Never expose internal errors to end users

## Project Structure

```
weather-mcp/
├── src/
│   ├── index.ts           # Main MCP server
│   ├── services/
│   │   └── noaa.ts        # NOAA API service
│   ├── types/
│   │   └── noaa.ts        # TypeScript type definitions
│   └── utils/
│       └── units.ts       # Unit conversion utilities
├── tests/                 # Test files (future)
├── test_noaa_api.ts      # Manual test script
└── dist/                  # Compiled output (generated)
```

## Testing

### Before Submitting

1. Run the build to check for TypeScript errors:
```bash
npm run build
```

2. Test with the NOAA API:
```bash
npx tsx test_noaa_api.ts
```

3. Test manually with Claude Code (if possible)

### Adding Tests

When adding new features:
- Add test cases to `test_noaa_api.ts` for new service methods
- Update `TESTING_GUIDE.md` with new manual test scenarios
- Ensure all existing tests still pass

## Documentation

### When to Update Documentation

Update documentation when you:
- Add a new tool or feature
- Change existing functionality
- Fix a bug that affects usage
- Improve performance significantly

### Which Files to Update

- `README.md` - For user-facing changes
- `TESTING_GUIDE.md` - For new test scenarios
- `NOAA_API_RESEARCH.md` - For API discoveries
- `IMPLEMENTATION_PLAN.md` - For tracking progress
- Code comments - For implementation details

## Commit Messages

Write clear, descriptive commit messages:

### Format
```
Brief description (50 chars or less)

More detailed explanation if needed. Wrap at 72 characters.
- Bullet points for multiple changes
- Use present tense ("Add feature" not "Added feature")
- Reference issues and PRs where relevant
```

### Examples

Good:
```
Add support for hourly forecast

Implement new tool for hourly weather forecasts using NOAA's
hourly forecast endpoint. Includes error handling and tests.

Fixes #123
```

Bad:
```
fixed stuff
```

## Release Process

(For maintainers)

1. Update version in `package.json`
2. Update `CHANGELOG.md` with changes
3. Create a git tag: `git tag v1.0.0`
4. Push tag: `git push origin v1.0.0`
5. Create GitHub release with notes
6. (Optional) Publish to npm: `npm publish`

## Questions?

If you have questions about contributing:
- Open an issue with the "question" label
- Check existing issues and discussions
- Review the code and documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in:
- GitHub contributors list
- Release notes for significant contributions
- Special thanks in README for major features

Thank you for contributing to Weather MCP Server!
