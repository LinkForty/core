# Docker Auto-Publishing Setup - Complete! ✅

## What Was Created

### 1. GitHub Actions Workflow
**File:** `.github/workflows/docker-publish.yml`

**Features:**
- ✅ Automatically publishes to Docker Hub on tag push
- ✅ Updates `latest` tag on main branch push
- ✅ Multi-architecture support (AMD64 + ARM64)
- ✅ Automated testing after build
- ✅ Creates GitHub releases automatically
- ✅ Smart caching for faster builds
- ✅ Test builds on pull requests (without publishing)

### 2. Production Dockerfile
**File:** `Dockerfile` (root level)

**Improvements over examples/Dockerfile:**
- ✅ Multi-stage build (smaller final image)
- ✅ Non-root user for security
- ✅ Health check included
- ✅ Signal handling with dumb-init
- ✅ Production-optimized dependencies

### 3. Docker Compose File
**File:** `docker-compose.yml` (root level)

**Features:**
- ✅ Uses published image by default
- ✅ Full environment variable support
- ✅ Optional build-from-source mode
- ✅ Health checks for all services
- ✅ Proper volume management
- ✅ Restart policies

### 4. Configuration Files
- `.env.example` - Comprehensive environment template
- `DOCKER.md` - Complete deployment guide

## Next Steps to Enable Auto-Publishing

### 1. Set Up Docker Hub (5 minutes)

1. **Create Docker Hub account** (if you don't have one):
   - Go to https://hub.docker.com/signup
   - Choose username: `linkforty` (or your preferred username)

2. **Create access token:**
   - Go to https://hub.docker.com/settings/security
   - Click "New Access Token"
   - Name: `github-actions`
   - Permissions: `Read, Write, Delete`
   - Copy the token (you won't see it again!)

### 2. Add GitHub Secrets (2 minutes)

1. Go to your GitHub repository:
   `https://github.com/linkforty/core/settings/secrets/actions`

2. Add two secrets:
   - **Name:** `DOCKERHUB_USERNAME`
     **Value:** Your Docker Hub username (e.g., `linkforty`)

   - **Name:** `DOCKERHUB_TOKEN`
     **Value:** The access token you just created

### 3. Publish Your First Image (1 minute)

**Option A: Create a tag (recommended)**
```bash
cd /Users/brandon/WebstormProjects/linkforty-core

# Commit the new files
git add .github/ Dockerfile docker-compose.yml .env.example DOCKER.md
git commit -m "feat: Add Docker auto-publishing with GitHub Actions"

# Push to main
git push origin main

# Create and push a version tag
git tag v1.3.0
git push origin v1.3.0
```

**Option B: Push to main branch**
```bash
git add .github/ Dockerfile docker-compose.yml .env.example DOCKER.md
git commit -m "feat: Add Docker auto-publishing"
git push origin main
```

### 4. Monitor the Build

1. Go to: `https://github.com/linkforty/core/actions`
2. Click on the running workflow
3. Watch the build progress (~5-10 minutes first time)

### 5. Verify Publication

After successful build:
```bash
# Pull your published image
docker pull linkforty/core:latest

# Test it
docker run -d \
  -e DATABASE_URL=postgresql://user:pass@host/db \
  linkforty/core:latest
```

## How It Works

### Automatic Publishing Triggers

1. **Version Tags** (e.g., `v1.3.0`):
   - Publishes: `linkforty/core:v1.3.0`
   - Publishes: `linkforty/core:v1.3`
   - Publishes: `linkforty/core:v1`
   - Publishes: `linkforty/core:latest`
   - Creates GitHub Release with instructions

2. **Main Branch Push**:
   - Updates: `linkforty/core:main`
   - Updates: `linkforty/core:latest`

3. **Pull Requests**:
   - Builds and tests only
   - Does NOT publish to Docker Hub

### Update Workflow (Every Release)

```bash
# Make your changes
git add .
git commit -m "feat: Add awesome feature"

# Push to main
git push origin main

# Create new version
git tag v1.4.0
git push origin v1.4.0

# GitHub Actions automatically:
# 1. Builds Docker image
# 2. Runs tests
# 3. Publishes to Docker Hub
# 4. Creates GitHub release
# Done! ✨
```

## User Experience

### For Self-Hosters

**One-command deployment:**
```bash
curl -O https://raw.githubusercontent.com/linkforty/core/main/docker-compose.yml
docker-compose up -d
```

**With custom configuration:**
```bash
# Get files
curl -O https://raw.githubusercontent.com/linkforty/core/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/linkforty/core/main/.env.example
mv .env.example .env

# Edit settings
nano .env

# Deploy
docker-compose up -d
```

### Updating

```bash
docker-compose pull
docker-compose up -d
```

## Cost

- **Docker Hub:** FREE for public images (unlimited pulls)
- **GitHub Actions:** FREE for public repos (2,000 minutes/month)

## FAQ

**Q: How often should I publish?**
A: Publish whenever you want! It's free and takes 2 minutes.

**Q: Can I delete old versions?**
A: Yes, manage versions at https://hub.docker.com/r/linkforty/core/tags

**Q: What if the build fails?**
A: Check the GitHub Actions logs. Common issues:
- Missing secrets (add DOCKERHUB_USERNAME and DOCKERHUB_TOKEN)
- Build errors (test locally first with `docker build .`)

**Q: Should I publish beta versions?**
A: Yes! Use tags like `v1.4.0-beta.1` for pre-releases

## Recommended Versioning

- `v1.0.0` - Major release (breaking changes)
- `v1.1.0` - Minor release (new features)
- `v1.1.1` - Patch release (bug fixes)
- `v1.2.0-beta.1` - Beta release
- `v1.2.0-rc.1` - Release candidate

## Support

- Check build status: https://github.com/linkforty/core/actions
- View published images: https://hub.docker.com/r/linkforty/core
- Report issues: https://github.com/linkforty/core/issues

---

## You're All Set! 🎉

Your Docker auto-publishing is configured and ready to go. Just add the GitHub secrets and push your first tag!
