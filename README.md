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

## API Reference

### Links

#### Create a Link

`userId` is optional. When provided, the link is scoped to that user (multi-tenant mode). When omitted, the link has no owner (single-tenant mode).

```bash
POST /api/links
Content-Type: application/json

{
  "userId": "user-uuid",
  "originalUrl": "https://example.com",
  "title": "My Link",
  "description": "Summer campaign link",
  "iosAppStoreUrl": "https://apps.apple.com/app/id123456",
  "androidAppStoreUrl": "https://play.google.com/store/apps/details?id=com.example",
  "webFallbackUrl": "https://example.com/product/123",
  "appScheme": "myapp",
  "iosUniversalLink": "https://example.com/app/product/123",
  "androidAppLink": "https://example.com/app/product/123",
  "deepLinkPath": "/product/123",
  "deepLinkParameters": { "ref": "campaign-1" },
  "utmParameters": {
    "source": "twitter",
    "medium": "social",
    "campaign": "summer-sale"
  },
  "ogTitle": "Check out this deal",
  "ogDescription": "50% off summer sale",
  "ogImageUrl": "https://example.com/og-image.png",
  "targetingRules": {
    "countries": ["US", "CA"],
    "devices": ["ios", "android"],
    "languages": ["en"]
  },
  "attributionWindowHours": 168,
  "customCode": "summer-sale",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

All fields except `originalUrl` are optional.

Install attribution settings, per link:

- `attributionWindowHours` (1–2160, default 168): how long after a click an install can still be matched to it.
- `attributionWindowMinutes` (5–129600): the same window in minutes, for windows under an hour. Send one or the other; when set it replaces the hours, and updating the link with `attributionWindowHours` clears it.
- `oneInstallPerClick` (default `false`): a click is matched to one install only. A second install that would have matched the same click is matched to another click, or recorded as organic. Suited to single-use links, such as sign-in links.

#### Get All Links

```bash
# Single-tenant (all links)
GET /api/links

# Multi-tenant (scoped to user)
GET /api/links?userId=user-uuid
```

#### Get a Specific Link

```bash
GET /api/links/:id
GET /api/links/:id?userId=user-uuid
```

#### Update a Link

```bash
PUT /api/links/:id?userId=user-uuid
Content-Type: application/json

{
  "title": "Updated Title",
  "isActive": false
}
```

#### Duplicate a Link

```bash
POST /api/links/:id/duplicate?userId=user-uuid
```

#### Delete a Link

```bash
DELETE /api/links/:id?userId=user-uuid
```

### Analytics

#### Get Analytics Overview

```bash
# All links
GET /api/analytics/overview?days=30

# Scoped to user
GET /api/analytics/overview?userId=user-uuid&days=30
```

Returns: `totalClicks`, `uniqueClicks`, `clicksByDate`, `clicksByCountry`, `clicksByDevice`, `clicksByPlatform`, `topLinks`

#### Get Link-Specific Analytics

```bash
GET /api/analytics/links/:linkId?days=30
```

### Redirect

```bash
GET /:shortCode
GET /:templateSlug/:shortCode
```

Redirects users to the appropriate URL based on device type (iOS/Android/web), evaluates targeting rules, and tracks the click asynchronously. See [Redirects](docs/redirects.md) for the not-found page, the mobile interstitial and the Launchpad page.

### QR Codes

```bash
GET /api/links/:id/qr?format=png&size=300
GET /api/links/:id/qr?format=svg
GET /api/links/:id/qr?url=https://links.example.com/spring/abc123   # encode the link on a custom host / template path
```

Without `url` the code encodes `SHORTLINK_DOMAIN/{shortCode}`. `url` must be an http(s) URL whose path ends in the link's short code; anything else is a 400. The Launchpad page uses it to encode its own address, so a phone that scans the code lands on the same host and path the visitor is on.

### Webhooks

```bash
GET    /api/webhooks?userId=user-uuid
POST   /api/webhooks                     # Body: { name, url, events, userId? }
GET    /api/webhooks/:id?userId=user-uuid
PUT    /api/webhooks/:id?userId=user-uuid
DELETE /api/webhooks/:id?userId=user-uuid
POST   /api/webhooks/:id/test?userId=user-uuid
```

Events: `click_event`, `install_event`, `conversion_event`, `sdk_event`. Payloads are HMAC SHA-256 signed.

Which webhooks hear about a link: one with an `organization_id` receives events for every link in that organization; one without receives events for links created by its `user_id`; one with neither receives events for links that have neither. To keep a delivery log, pass a function to `setWebhookDeliveryLogger()`. It is called with the webhook id, the attempt's result and the payload sent.

### Mobile SDK Endpoints

```bash
POST /api/sdk/v1/install               # Report app install, get deferred deep link
GET  /api/sdk/v1/attribution/:fingerprint  # Debug attribution lookups
POST /api/sdk/v1/event                 # Track in-app conversion events
GET  /api/sdk/v1/resolve/:shortCode    # Resolve link to deep link data (no redirect)
GET  /api/sdk/v1/health                # Health check
```

An event whose `installId` this server no longer has is **recovered, not
refused**: the install is recorded again (marked `recovered`, with no link,
click or confidence score, so it is never mistaken for a fresh attributed
install) and the event is stored against it.

This matters because the id lives in the app's storage for the life of the
install while the server's copy may not: a restore from an older backup, a
manual cleanup, an app build pointed at a fresh database, or an analytics
retention job all leave a live device holding an id nothing resolves. The
bundled SDKs store the id once and never re-register, so without recovery
that device is refused forever with no way back. The 404 that remains carries
`code: "INSTALL_NOT_FOUND"` and `action: "reregister"`.

### Health

```bash
GET  /health                           # Liveness — process is up (no DB access)
GET  /health/ready                     # Readiness — 503 if the database is unreachable
```

### Debug & Testing

```bash
POST /api/debug/simulate               # Simulate a link click with custom parameters
WS   /api/debug/live?userId=user-uuid  # WebSocket live click event stream
GET  /api/debug/user-agents            # Common UA strings for testing
GET  /api/debug/countries              # Common countries list
GET  /api/debug/languages              # Common languages list
```

### Well-Known Routes

```bash
GET /.well-known/apple-app-site-association   # iOS Universal Links
GET /.well-known/assetlinks.json              # Android App Links
```

### OG Preview

```bash
GET /:shortCode/preview                # OG meta tag page for social scrapers
```

## Reference

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
