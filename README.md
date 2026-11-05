<div align="center">
  <img src="./assets/logo.png" alt="LinkForty Logo" width="140"/>

  # LinkForty Core

  **Open-source alternative to Branch.io, AppsFlyer OneLink, and Firebase Dynamic Links**

  Self-hosted deep linking engine with device detection, analytics, deferred deep linking, and smart routing. No per-click pricing, no vendor lock-in, full data ownership — runs on your own PostgreSQL. Firebase Dynamic Links shut down in August 2025; LinkForty is a production-ready, open-source alternative you can deploy today.
</div>

[![npm version](https://img.shields.io/npm/v/@linkforty/core.svg)](https://www.npmjs.com/package/@linkforty/core)
[![CI](https://github.com/linkforty/core/actions/workflows/ci.yml/badge.svg)](https://github.com/linkforty/core/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/linkforty/core/branch/main/graph/badge.svg)](https://codecov.io/gh/linkforty/core)
[![Docker Pulls](https://img.shields.io/docker/pulls/linkforty/core)](https://hub.docker.com/r/linkforty/core)
[![Docker Image Size](https://img.shields.io/docker/image-size/linkforty/core/latest)](https://hub.docker.com/r/linkforty/core)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## Why LinkForty?

- **Self-hosted and open-source** — AGPL-3.0 licensed, deploy on your own infrastructure
- **No per-click pricing** — No usage-based fees, no monthly minimums, no enterprise sales calls
- **Full data ownership** — All click data, analytics, and attribution stored in your PostgreSQL database
- **Privacy-first** — No third-party data sharing, no tracking pixels, your users' data stays with you
- **REST API and mobile SDKs** — SDKs for React Native, Expo, Flutter, iOS (Swift), and Android (Kotlin)
- **Firebase Dynamic Links alternative** — Google shut down Firebase Dynamic Links in August 2025. LinkForty is a self-hosted, open-source alternative

### How LinkForty Compares

| | LinkForty Core | Branch | AppsFlyer |
|---|----------------|--------|-----------|
| **Open source** | Yes (AGPL-3.0) | No | No |
| **Self-hosted** | Yes | No | No |
| **Where your data lives** | Your PostgreSQL | Branch's servers | AppsFlyer's servers |
| **Per-click pricing** | None | Check their pricing | Check their pricing |

## Features

- **Smart Link Routing** - Create short links with device-specific URLs for iOS, Android, and web 
- **Device Detection** - Automatic detection and routing based on user device 
- **Click Analytics** - Track clicks with geolocation, device type, platform, and more 
- **UTM Parameters** - Built-in support for UTM campaign tracking 
- **Targeting Rules** - Filter by country, device, and language before redirecting 
- **QR Code Generation** - Generate QR codes (PNG/SVG) for any link 
- **Deferred Deep Linking** - Install attribution by Google Play install referrer on Android (the redirect puts the click id in the Play listing's `referrer`), and by probabilistic fingerprint matching 
- **Webhooks** - Event-driven integrations with HMAC-signed payloads and retry logic 
- **Smart App Opening** - Mobile clicks serve an interstitial that tries the app via URI scheme, falls back to the App Store / Play Store. Preserves URL fragments for E2E encryption keys 
- **OG Preview Pages** - Social media scraper detection with Open Graph meta tags 
- **iOS Universal Links & Android App Links** - Serve `.well-known` files automatically 
- **Link Expiration** - Set expiration dates for time-sensitive links 
- **Redis Caching** - Optional Redis support for high-performance link lookups 
- **PostgreSQL Storage** - Reliable data persistence with full SQL capabilities 
- **TypeScript** - Fully typed API for better developer experience 
- **No Auth Included** - Bring your own authentication; `userId` is optional for multi-tenant scoping

## Installation

```bash
npm install @linkforty/core
```

## Quick Start

### 1. Basic Server

```typescript
import { createServer } from '@linkforty/core';

async function start() {
  const server = await createServer({
    database: {
      url: 'postgresql://localhost/linkforty',
    },
    redis: {
      url: 'redis://localhost:6379',
    },
  });

  await server.listen({ port: 3000, host: '0.0.0.0' });
  console.log('Server running on http://localhost:3000');
}

start();
```

### 2. Docker (Recommended for Production)

**Quick Start:**

```bash
# Pull the latest image
docker pull linkforty/core:latest

# Run with Docker Compose
curl -O https://raw.githubusercontent.com/linkforty/core/main/docker-compose.yml
docker compose up -d
```

**Or use Docker CLI:**

```bash
docker run -d \
  --name linkforty \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/linkforty?sslmode=disable \
  -e REDIS_URL=redis://host:6379 \
  linkforty/core:latest
```

**Features:**
- Pre-built multi-architecture images (AMD64 + ARM64)
- Automatic updates with version tags
- Non-root user for security
- Built-in health checks
- Supply chain attestations (SBOM + Provenance)

See [DOCKER.md](DOCKER.md) for complete deployment guide.

## Reference

- [API](docs/api.md)
- [Redirects](docs/redirects.md)
- [Configuration](docs/configuration.md): server options and hooks, `linkforty.config.json`, reverse proxies, environment variables
- [Database schema](docs/database-schema.md)
- [Using Core as a library](docs/library-usage.md)
- [Export and import](docs/export-import.md)

## Deployment

Core runs anywhere you can run a container with PostgreSQL 13+ (Redis is optional). See [DOCKER.md](DOCKER.md) for the image, Compose setup, health checks, backups and version pinning.

## Performance

- **Redis caching**: 5-minute TTL on link lookups reduces database queries by 90%
- **Database indexes**: Optimized queries for fast link lookups and analytics
- **Async click tracking**: Non-blocking click event logging via `setImmediate()`
- **Connection pooling**: Efficient database connection management (min 2, max 10)

## Security

- **SQL injection protection**: Parameterized queries throughout
- **Input validation**: Zod schema validation on all inputs
- **CORS configuration**: Configurable CORS for API access control
- **Link expiration**: Automatic handling of expired links
- **Webhook signing**: HMAC SHA-256 signed payloads
- **No auth included**: Core does not include authentication. The optional `userId` parameter provides data scoping but does not verify identity. Add your own auth middleware as needed.

## Mobile SDK Integration

LinkForty Core supports iOS Universal Links and Android App Links for seamless deep linking in mobile applications.

### iOS Universal Links Setup

1. **Set environment variables:**
   ```bash
   IOS_TEAM_ID=ABC123XYZ  # Your Apple Developer Team ID
   IOS_BUNDLE_ID=com.yourcompany.yourapp
   ```

2. **Configure in Xcode:**
   - Add "Associated Domains" capability
   - Add domain: `applinks:yourdomain.com`

3. **Verify AASA file:**
   ```bash
   curl https://yourdomain.com/.well-known/apple-app-site-association
   ```

   Expected response:
   ```json
   {
     "applinks": {
       "apps": [],
       "details": [
         {
           "appID": "ABC123XYZ.com.yourcompany.yourapp",
           "paths": ["*"]
         }
       ]
     }
   }
   ```

### Android App Links Setup

1. **Get your SHA-256 fingerprint:**
   ```bash
   # Debug keystore
   keytool -list -v -keystore ~/.android/debug.keystore \
     -alias androiddebugkey -storepass android -keypass android

   # Release keystore
   keytool -list -v -keystore /path/to/release.keystore \
     -alias your-alias
   ```

2. **Set environment variables:**
   ```bash
   ANDROID_PACKAGE_NAME=com.yourcompany.yourapp
   ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:DD:...

   # Multiple fingerprints (debug + release)
   ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:...,DD:EE:FF:...
   ```

3. **Configure in AndroidManifest.xml:**
   ```xml
   <intent-filter android:autoVerify="true">
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="https" />
     <data android:host="yourdomain.com" />
   </intent-filter>
   ```

4. **Verify assetlinks.json:**
   ```bash
   curl https://yourdomain.com/.well-known/assetlinks.json
   ```

   Expected response:
   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "com.yourcompany.yourapp",
         "sha256_cert_fingerprints": ["AA:BB:CC:..."]
       }
     }
   ]
   ```

### Available Mobile SDKs

| Platform | Package | Install |
|----------|---------|---------|
| React Native | [`@linkforty/mobile-sdk-react-native`](https://github.com/LinkForty/mobile-sdk-react-native) | `npm install @linkforty/mobile-sdk-react-native` |
| Expo | [`@linkforty/mobile-sdk-expo`](https://github.com/LinkForty/mobile-sdk-expo) | `npx expo install @linkforty/mobile-sdk-expo` |
| Flutter | [`linkforty_flutter`](https://github.com/LinkForty/mobile-sdk-flutter) | `flutter pub add linkforty_flutter` |
| iOS (Swift) | [LinkFortySDK](https://github.com/LinkForty/mobile-sdk-ios) | Swift Package Manager |
| Android (Kotlin) | [LinkFortySDK](https://github.com/LinkForty/mobile-sdk-android) | Gradle dependency |

See the [SDK documentation](https://docs.linkforty.com/sdks/react-native) for integration guides.

### Testing Domain Verification

Test iOS Universal Links with Apple's validator:
```bash
https://search.developer.apple.com/appsearch-validation-tool/
```

Test Android App Links with Google's validator:
```bash
adb shell am start -a android.intent.action.VIEW \
  -d "https://yourdomain.com/test"
```


## For AI Tools (llms.txt)

LinkForty provides machine-readable documentation for AI coding assistants (Claude, ChatGPT, Cursor, Copilot).

- **Quick reference**: [docs.linkforty.com/llms.txt](https://docs.linkforty.com/llms.txt)
- **Complete integration guide**: [docs.linkforty.com/llms-full.txt](https://docs.linkforty.com/llms-full.txt)

Download into your project for AI-assisted integration:

```bash
curl -o LINKFORTY.md https://docs.linkforty.com/llms-full.txt
```

The npm package also ships with an `llms.txt` file — AI tools that read from `node_modules` can discover it automatically.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

AGPL-3.0 - see [LICENSE](LICENSE) file for details.

## Managed hosting

Prefer not to run it yourself? [LinkForty Cloud](https://go.linkforty.com/m0ycvnog/core-cloud) is the hosted version, with authentication, teams and a dashboard.

## Support

- **Documentation**: [docs.linkforty.com](https://go.linkforty.com/m0ycvnog/core-docs)
- **Issues**: [GitHub Issues](https://github.com/linkforty/core/issues)
- **Discussions**: [GitHub Discussions](https://github.com/linkforty/core/discussions)
