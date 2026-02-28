# LinkForty Core

**Open-source alternative to Branch.io, AppsFlyer OneLink, and Firebase Dynamic Links.**

Self-hosted deep linking engine with device detection, analytics, deferred deep linking, and smart routing. No per-click pricing, no vendor lock-in, full data ownership — runs on your own PostgreSQL.

Firebase Dynamic Links shut down in August 2025. LinkForty is a production-ready, open-source replacement.

[![GitHub](https://img.shields.io/github/stars/LinkForty/core?style=social)](https://github.com/LinkForty/core)

## Quick Start

```bash
curl -O https://raw.githubusercontent.com/linkforty/core/main/docker-compose.yml
docker compose up -d
```

That's it. LinkForty is running at `http://localhost:3000`.

## Docker CLI

```bash
docker run -d \
  --name linkforty \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/linkforty \
  -e REDIS_URL=redis://host:6379 \
  linkforty/core:latest
```

## Features

- **Smart Link Routing** — Device-specific URLs for iOS, Android, and web
- **Deferred Deep Linking** — Probabilistic fingerprint matching for install attribution
- **Click Analytics** — Geolocation, device type, platform, UTM tracking
- **QR Code Generation** — Built-in PNG/SVG QR codes for any link
- **Webhooks** — HMAC-signed event notifications with retry logic
- **iOS Universal Links & Android App Links** — Automatic `.well-known` file serving
- **OG Preview Pages** — Social media scraper detection with Open Graph meta tags
- **Redis Caching** — Optional Redis for high-performance link lookups
- **TypeScript** — Fully typed API

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | No | — | Redis connection string (recommended) |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `production` | Environment mode |
| `CORS_ORIGIN` | No | `*` | CORS allowed origins |
| `IOS_TEAM_ID` | No | — | Apple Team ID for Universal Links |
| `IOS_BUNDLE_ID` | No | — | iOS app bundle ID |
| `ANDROID_PACKAGE_NAME` | No | — | Android package name |
| `ANDROID_SHA256_FINGERPRINTS` | No | — | Android signing certificate fingerprints |

## Image Details

- **Architectures:** linux/amd64, linux/arm64
- **Base:** Node.js 22 Alpine
- **Security:** Non-root user, SBOM + Provenance attestations
- **Health checks:** Built-in

## Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release |
| `v1.6.1` | Specific version (recommended for production) |
| `v1.6` | Latest patch of minor version |
| `v1` | Latest minor of major version |

**Pin versions in production:**

```yaml
services:
  linkforty:
    image: linkforty/core:v1.6.1
```

## Docker Compose (Full Stack)

```yaml
services:
  linkforty:
    image: linkforty/core:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://linkforty:linkforty@postgres:5432/linkforty
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: linkforty
      POSTGRES_PASSWORD: linkforty
      POSTGRES_DB: linkforty
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkforty"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

## Mobile SDKs

| Platform | Package |
|----------|---------|
| React Native | [`@linkforty/mobile-sdk-react-native`](https://www.npmjs.com/package/@linkforty/mobile-sdk-react-native) |
| Expo | [`@linkforty/mobile-sdk-expo`](https://www.npmjs.com/package/@linkforty/mobile-sdk-expo) |
| iOS (Swift) | [LinkFortySDK](https://github.com/LinkForty/mobile-sdk-ios) |
| Android (Kotlin) | [LinkFortySDK](https://github.com/LinkForty/mobile-sdk-android) |

## Why LinkForty?

| | LinkForty | Branch | AppsFlyer | Firebase Dynamic Links |
|---|-----------|--------|-----------|----------------------|
| **Pricing** | Free (self-hosted) | $299+/mo | $500+/mo | Shut down |
| **Open Source** | Yes (AGPL-3.0) | No | No | No |
| **Self-Hosted** | Yes | No | No | No |
| **Data Ownership** | Complete | Vendor | Vendor | Was Google |

## Links

- **Source Code:** [github.com/LinkForty/core](https://github.com/LinkForty/core)
- **Documentation:** [docs.linkforty.com](https://docs.linkforty.com)
- **Cloud Platform:** [linkforty.com](https://linkforty.com) (hosted SaaS)
- **Issues:** [GitHub Issues](https://github.com/LinkForty/core/issues)

## License

AGPL-3.0 — see [LICENSE](https://github.com/LinkForty/core/blob/main/LICENSE) for details.
