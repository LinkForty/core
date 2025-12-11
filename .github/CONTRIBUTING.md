# Contributing to LinkForty Core

Thank you for your interest in contributing to LinkForty Core! This document provides guidelines and information about our development process.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Message Guidelines](#commit-message-guidelines)
- [CI/CD Process](#cicd-process)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Security](#security)

## Code of Conduct

This project follows a code of conduct. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 18+ (we test on 18, 20, and 22)
- npm 9+
- PostgreSQL 14+ (for local development)
- Redis 6+ (optional, for local development)

### Local Setup

```bash
# Clone the repository
git clone https://github.com/linkforty/core.git
cd core

# Install dependencies
npm install

# Copy environment example
cp .env.example .env

# Build the project
npm run build

# Run tests
npm test
```

## Development Workflow

1. **Fork the repository** to your own GitHub account
2. **Clone your fork** to your local machine
3. **Create a new branch** from `main` for your changes
4. **Make your changes** with clear, focused commits
5. **Add tests** for any new functionality
6. **Run tests** locally to ensure everything passes
7. **Push to your fork** and create a pull request

### Branch Naming Convention

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Test additions or changes

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning and changelog generation.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- **feat**: A new feature (triggers MINOR version bump)
- **fix**: A bug fix (triggers PATCH version bump)
- **docs**: Documentation changes only
- **refactor**: Code changes that neither fix a bug nor add a feature
- **perf**: Performance improvements (triggers PATCH version bump)
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, dependency updates
- **ci**: CI/CD configuration changes
- **BREAKING CHANGE**: In footer triggers MAJOR version bump

### Examples

```bash
# New feature
feat(analytics): add click tracking with geolocation

# Bug fix
fix(redirect): handle undefined UTM parameters correctly

# Breaking change
feat(api)!: redesign link creation API

BREAKING CHANGE: Link creation now requires organizationId parameter
```

## CI/CD Process

### Continuous Integration (CI)

Our CI pipeline runs automatically on **every pull request** and **push to main**. It includes:

#### 1. **Lint & Type Check**
- TypeScript compilation check (`tsc --noEmit`)
- Code linting (if configured)
- Runs on Node.js 20

#### 2. **Tests**
- Unit tests on Node.js 18, 20, and 22
- Coverage report generation
- Automatic upload to Codecov

#### 3. **Build**
- TypeScript compilation
- Build artifact validation
- Export verification

#### 4. **Package Validation**
- Verify all package.json exports point to real files
- Test package installation
- Ensure package can be imported correctly

**Important**: All CI checks must pass before a PR can be merged.

### Continuous Deployment (CD)

Our release pipeline runs automatically on **every push to main** (protected):

#### Semantic Release Process

1. **Analyzes commits** since last release
2. **Determines version bump** based on commit types
3. **Generates CHANGELOG.md**
4. **Builds and tests** the package
5. **Publishes to NPM** with provenance
6. **Creates GitHub Release** with notes
7. **Commits version bump** back to main

**Important Security Notes**:
- Only runs on the main branch of the official repository
- Does NOT run on forks (protects NPM token)
- Uses GitHub's OIDC token for NPM provenance
- All secrets are protected and never exposed to PRs

## Testing

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- Place test files next to the source: `utils.ts` → `utils.test.ts`
- Use descriptive test names
- Test edge cases and error conditions
- Aim for high coverage on utility functions

Example:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from './my-module';

describe('myFunction', () => {
  it('should handle normal input correctly', () => {
    expect(myFunction('input')).toBe('expected');
  });

  it('should handle edge cases', () => {
    expect(myFunction('')).toBe('');
    expect(myFunction(null)).toThrow();
  });
});
```

## Pull Request Process

### Before Submitting

- ✅ All tests pass locally
- ✅ Code follows TypeScript best practices
- ✅ New features have tests
- ✅ Commit messages follow conventional format
- ✅ Documentation is updated (if needed)

### PR Guidelines

1. **Fill out the PR template** completely
2. **Link related issues** using "Fixes #123"
3. **Keep PRs focused** - one feature/fix per PR
4. **Respond to reviews** promptly
5. **Update your branch** if main has changed

### Review Process

- At least one maintainer approval required
- All CI checks must pass
- No merge conflicts with main
- Branch protection rules enforced

### After Merge

- Your PR will trigger the release workflow
- If your commits include `feat:` or `fix:`, a new version will be published automatically
- The CHANGELOG will be updated
- You'll be credited in the GitHub release notes

## Security

### Reporting Vulnerabilities

**DO NOT** open public issues for security vulnerabilities.

Please email security@linkforty.com with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Security Best Practices

- Never commit secrets, tokens, or credentials
- Use environment variables for sensitive data
- Keep dependencies up to date
- Follow principle of least privilege

### CI/CD Security

Our CI/CD pipeline is designed with security in mind:

- **Fork PRs cannot access secrets** - Prevents malicious actors from stealing NPM tokens
- **Release only on main** - Prevents unauthorized package publishing
- **Required reviews** - Human verification before merge
- **Branch protection** - No direct pushes to main
- **Provenance** - NPM packages include build provenance for supply chain security

## Questions?

- 💬 Open a [Discussion](https://github.com/linkforty/core/discussions)
- 🐛 Report bugs via [Issues](https://github.com/linkforty/core/issues)
- 📧 Email: hello@linkforty.com

Thank you for contributing to LinkForty Core! 🎉
