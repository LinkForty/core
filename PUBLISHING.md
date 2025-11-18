# Publishing Guide for @linkforty/core

This guide walks you through publishing the `@linkforty/core` package to GitHub and npm.

## Pre-Publishing Checklist

- [x] Git repository initialized
- [x] .gitignore configured
- [x] .npmignore configured
- [x] README.md complete with examples
- [x] LICENSE file (MIT)
- [x] CHANGELOG.md created
- [x] CONTRIBUTING.md created
- [x] Package builds successfully
- [x] Examples directory with working code
- [x] All exports properly configured in package.json

## Step 1: Create GitHub Repository

### Option A: Using GitHub CLI (gh)

```bash
# Install GitHub CLI if needed
brew install gh

# Login to GitHub
gh auth login

# Create repository
cd /Users/brandon/WebstormProjects/linkforty-core
gh repo create linkforty/core --public --description "Open-source deeplink management engine with device detection and analytics"

# Add remote
git remote add origin https://github.com/linkforty/core.git
```

### Option B: Using GitHub Web UI

1. Go to https://github.com/new
2. Repository name: `core`
3. Organization: `linkforty` (or create organization first at https://github.com/organizations/new)
4. Description: "Open-source deeplink management engine with device detection and analytics"
5. Public repository
6. Do NOT initialize with README, .gitignore, or license (we have these)
7. Click "Create repository"

Then add the remote:

```bash
cd /Users/brandon/WebstormProjects/linkforty-core
git remote add origin https://github.com/linkforty/core.git
```

## Step 2: Initial Commit and Push

```bash
cd /Users/brandon/WebstormProjects/linkforty-core

# Stage all files
git add .

# Create initial commit
git commit -m "feat: initial release of @linkforty/core v1.0.0

- Smart link routing with device detection
- Click analytics with geolocation
- UTM parameter support
- Link expiration and targeting rules
- Redis caching for performance
- PostgreSQL storage
- Full TypeScript support
- Docker deployment examples"

# Create main branch and push
git branch -M main
git push -u origin main

# Create v1.0.0 tag
git tag -a v1.0.0 -m "Release v1.0.0 - Initial public release"
git push origin v1.0.0
```

## Step 3: Configure GitHub Repository Settings

### Enable GitHub Pages (optional - for documentation)

1. Go to repository Settings → Pages
2. Source: Deploy from branch → main → /docs (if you add docs later)

### Set up branch protection

1. Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable:
   - Require pull request reviews before merging
   - Require status checks to pass before merging

### Add repository topics

1. Go to repository main page
2. Click ⚙️ next to "About"
3. Add topics: `deeplink`, `onelink`, `url-shortener`, `analytics`, `mobile-links`, `typescript`, `fastify`, `nodejs`

## Step 4: Publish to npm

### Verify package contents

Before publishing, verify what will be included:

```bash
cd /Users/brandon/WebstormProjects/linkforty-core
npm pack --dry-run
```

This should show:
- dist/ directory (compiled JavaScript)
- *.d.ts files (TypeScript declarations)
- README.md
- LICENSE
- CHANGELOG.md
- package.json

### Login to npm

```bash
npm login
# Follow prompts to enter credentials
```

### Publish to npm

```bash
# For first-time publish of scoped package
npm publish --access public

# Verify it's published
npm view @linkforty/core
```

### Future Updates

For subsequent releases:

```bash
# Update version in package.json
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# This creates a git commit and tag automatically

# Push changes and tags
git push && git push --tags

# Publish to npm
npm publish
```

## Step 5: Create GitHub Release

### Using GitHub CLI

```bash
gh release create v1.0.0 \
  --title "v1.0.0 - Initial Release" \
  --notes "$(cat CHANGELOG.md | sed -n '/## \[1.0.0\]/,/^---/p' | sed '1d;$d')"
```

### Using GitHub Web UI

1. Go to https://github.com/linkforty/core/releases/new
2. Tag: v1.0.0
3. Title: "v1.0.0 - Initial Release"
4. Description: Copy content from CHANGELOG.md for v1.0.0
5. Click "Publish release"

## Step 6: Verify Publication

### Check npm

```bash
# View package info
npm view @linkforty/core

# Test installation
mkdir /tmp/test-linkforty
cd /tmp/test-linkforty
npm init -y
npm install @linkforty/core

# Verify it works
node -e "const { createServer } = require('@linkforty/core'); console.log('✓ Package works!');"
```

### Check GitHub

- Visit https://github.com/linkforty/core
- Verify README displays correctly
- Check releases page
- Verify topics are visible

## Step 7: Post-Publication Tasks

### Update badges in README (if needed)

The npm version badge should now work:
```markdown
[![npm version](https://img.shields.io/npm/v/@linkforty/core.svg)](https://www.npmjs.com/package/@linkforty/core)
```

### Set up GitHub Actions (optional)

Create `.github/workflows/publish.yml` for automated publishing:

```yaml
name: Publish Package

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### Announce the release

- Post on social media (Twitter, LinkedIn, Reddit r/opensource)
- Submit to https://news.ycombinator.com
- Share in relevant Discord/Slack communities
- Update your portfolio/website

## Marketing Checklist

After publication, promote your open-source project:

- [ ] Share on Twitter/X with relevant hashtags (#opensource #nodejs #typescript)
- [ ] Post on LinkedIn
- [ ] Submit to https://www.producthunt.com
- [ ] Share on Reddit: r/opensource, r/node, r/typescript
- [ ] Post on Hacker News: https://news.ycombinator.com/submit
- [ ] Add to awesome lists (search "awesome-nodejs" on GitHub)
- [ ] Write a blog post about the project
- [ ] Create demo video/GIF for README
- [ ] Set up project website (optional)

## Maintenance

### Responding to Issues

- Enable GitHub Discussions for questions
- Use issue templates for bug reports and feature requests
- Triage issues weekly
- Label issues appropriately

### Accepting Contributions

1. Review PRs promptly
2. Require tests for new features
3. Maintain code quality standards
4. Update CHANGELOG.md for each release
5. Credit contributors in release notes

### Release Schedule

Suggested release cadence:
- **Patch releases** (bug fixes): As needed
- **Minor releases** (new features): Monthly or quarterly
- **Major releases** (breaking changes): Annually or as needed

## Support

If you encounter any issues during publication:

1. Verify npm credentials: `npm whoami`
2. Check package name availability: `npm view @linkforty/core`
3. Ensure you have permissions for the @linkforty scope
4. Review npm documentation: https://docs.npmjs.com/

For GitHub issues:
- Check SSH keys: `ssh -T git@github.com`
- Verify remote: `git remote -v`
- Check permissions: Ensure you own the repository or have write access

---

**Ready to publish?** Follow these steps in order and you'll have your package live on npm and GitHub! 🚀
