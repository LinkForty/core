# CI/CD Setup Guide for LinkForty Core

This document explains the CI/CD infrastructure for maintainers.

## Overview

LinkForty Core uses a **two-workflow approach** optimized for security and efficiency:

1. **CI Workflow** (`ci.yml`) - Runs on all PRs, safe for public contributions
2. **Release Workflow** (`release.yml`) - Runs only on main, handles versioning and publishing

## Workflow Details

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers**: Pull requests and pushes to main
**Purpose**: Validate code quality and functionality
**Security**: No secrets used, safe to run on forks

#### Jobs

| Job | Purpose | Node Versions |
|-----|---------|---------------|
| `lint-and-typecheck` | Type checking and linting | 20 |
| `test` | Run test suite | 18, 20, 22 |
| `build` | Compile TypeScript | 20 |
| `package-validation` | Verify package structure | 20 |
| `ci-success` | Gate for PR merging | - |

#### Key Features

- **Matrix Testing**: Tests on Node 18, 20, and 22
- **Coverage Reporting**: Uploads to Codecov (Node 20 only)
- **Build Artifacts**: Uploads dist/ for inspection
- **Export Validation**: Ensures all package.json exports exist
- **Install Testing**: Verifies package can be installed and imported

### 2. Release Workflow (`.github/workflows/release.yml`)

**Triggers**: Push to main branch
**Purpose**: Automated versioning, changelog, and publishing
**Security**: Protected with repository secrets

#### Jobs

| Job | Purpose |
|-----|---------|
| `release` | Semantic release, NPM publish, GitHub release |
| `notify-failure` | Creates issue if release fails |

#### Security Features

- **Repository Check**: Only runs on `linkforty/core` (not forks)
- **Branch Check**: Only runs on `main` branch
- **Secret Protection**: Secrets only available in this workflow
- **Provenance**: NPM packages include build provenance

## Setup Instructions

### 1. Repository Secrets

You need to configure these secrets in GitHub:

#### NPM_TOKEN

1. Go to [npmjs.com](https://www.npmjs.com/)
2. Generate an **Automation** token (not Classic)
3. Add to GitHub: Settings → Secrets → Actions → New secret
4. Name: `NPM_TOKEN`
5. Enable 2FA on your npm account

#### GITHUB_TOKEN

- Automatically provided by GitHub
- No configuration needed

### 2. Branch Protection Rules

Configure branch protection for `main`:

1. Go to Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require pull request reviews before merging (1 approval)
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date
   - ✅ Require conversation resolution
   - ✅ Do not allow bypassing the above settings
   - ✅ Restrict who can push to matching branches (Maintainers only)

4. Required status checks:
   - `lint-and-typecheck`
   - `test (18)`
   - `test (20)`
   - `test (22)`
   - `build`
   - `package-validation`

### 3. Repository Settings

#### General
- ✅ Allow merge commits
- ❌ Allow squash merging
- ❌ Allow rebase merging
- ✅ Automatically delete head branches

#### Actions
- ✅ Allow all actions and reusable workflows
- ✅ Read and write permissions for GITHUB_TOKEN
- ✅ Allow GitHub Actions to create and approve pull requests

#### Dependabot
- ✅ Enable Dependabot alerts
- ✅ Enable Dependabot security updates

### 4. NPM Package Settings

1. Go to [npmjs.com/package/@linkforty/core/access](https://www.npmjs.com/package/@linkforty/core/access)
2. Enable **Require 2FA to publish**
3. Enable **Provenance**

## How It Works

### For Contributors (External)

```
┌─────────────┐
│ Fork Repo   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Make Changes│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Create PR   │──────► CI Workflow runs
└──────┬──────┘        (No secrets exposed)
       │
       ▼
┌─────────────┐
│ Code Review │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Merge to    │
│ main        │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Release WF  │──────► Version bump
│ (Protected) │        NPM publish
└─────────────┘        GitHub release
```

### Semantic Versioning

Commits determine version bumps:

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `feat:` | Minor (1.0.0 → 1.1.0) | `feat: add QR code generation` |
| `fix:` | Patch (1.0.0 → 1.0.1) | `fix: handle null user agent` |
| `BREAKING CHANGE:` | Major (1.0.0 → 2.0.0) | `feat!: redesign API` |
| `docs:`, `chore:` | No release | `docs: update README` |

### Release Process

1. **Commit Analysis**: Scans commits since last release
2. **Version Calculation**: Determines next version
3. **Changelog Generation**: Updates CHANGELOG.md
4. **Build & Test**: Ensures package works
5. **NPM Publish**: Publishes with provenance
6. **GitHub Release**: Creates release with notes
7. **Git Commit**: Commits version bump back to main

## Troubleshooting

### Tests Fail on PR

**Check**:
- Do tests pass locally? (`npm test`)
- Is code typed correctly? (`npm run typecheck`)
- Are all dependencies installed? (`npm ci`)

### Release Doesn't Trigger

**Check**:
- Are you pushing to `main`?
- Is repository `linkforty/core` (not a fork)?
- Are commits formatted correctly? (conventional commits)

### NPM Publish Fails

**Check**:
- Is `NPM_TOKEN` set correctly?
- Is package name available on npm?
- Is 2FA enabled on npm account?
- Check npm token hasn't expired

### Release Creates Wrong Version

**Check**:
- Commit message format (must use conventional commits)
- Previous version in package.json
- Check semantic-release logs in Actions

## Monitoring

### Regular Checks

- **Weekly**: Review Dependabot alerts
- **Monthly**: Update dependencies
- **After each release**: Verify npm package
- **Quarterly**: Review access permissions

### Metrics to Watch

- Test coverage (aim for >80%)
- CI pass rate (should be >95%)
- Time to merge PRs
- Release frequency

## Emergency Procedures

### Rollback a Release

```bash
# 1. Unpublish from npm (within 72 hours)
npm unpublish @linkforty/core@x.x.x

# 2. Delete GitHub release
# Via GitHub UI: Releases → Delete

# 3. Revert version commit
git revert <commit-hash>
git push origin main
```

### Security Incident

1. Rotate all secrets immediately
2. Review recent commits and PRs
3. Publish security advisory
4. Release patched version ASAP

## Questions?

Contact maintainers:
- GitHub Discussions
- Email: maintainers@linkforty.com
