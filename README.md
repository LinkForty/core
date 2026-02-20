<div align="center">
  <img src="./assets/logo.png" alt="LinkForty Logo" width="140"/>

  # LinkForty Core

  **Open-source deeplink framework with device detection, analytics, and smart routing**

  LinkForty Core is a TypeScript deeplink framework built on Fastify + PostgreSQL. It provides the engine for creating, managing, and tracking smart links with device-specific routing, targeting rules, QR codes, deferred deep linking, and webhook integrations. Auth, UI, and user management are not included — bring your own, or use separate packages like `@linkforty/ui`.
</div>

[![npm version](https://img.shields.io/npm/v/@linkforty/core.svg)](https://www.npmjs.com/package/@linkforty/core)
[![CI](https://github.com/linkforty/core/actions/workflows/ci.yml/badge.svg)](https://github.com/linkforty/core/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/linkforty/core/branch/main/graph/badge.svg)](https://codecov.io/gh/linkforty/core)
[![Docker Pulls](https://img.shields.io/docker/pulls/linkforty/core)](https://hub.docker.com/r/linkforty/core)
[![Docker Image Size](https://img.shields.io/docker/image-size/linkforty/core/latest)](https://hub.docker.com/r/linkforty/core)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## Features

**Smart Link Routing** - Create short links with device-specific URLs for iOS, Android, and web \
**Device Detection** - Automatic detection and routing based on user device \
**Click Analytics** - Track clicks with geolocation, device type, platform, and more \
**UTM Parameters** - Built-in support for UTM campaign tracking \
**Targeting Rules** - Filter by country, device, and language before redirecting \
**QR Code Generation** - Generate QR codes (PNG/SVG) for any link \
**Deferred Deep Linking** - Probabilistic fingerprint matching for install attribution \
**Webhooks** - Event-driven integrations with HMAC-signed payloads and retry logic \
**OG Preview Pages** - Social media scraper detection with Open Graph meta tags \
**iOS Universal Links & Android App Links** - Serve `.well-known` files automatically \
**Link Expiration** - Set expiration dates for time-sensitive links \
**Redis Caching** - Optional Redis support for high-performance link lookups \
**PostgreSQL Storage** - Reliable data persistence with full SQL capabilities \
**TypeScript** - Fully typed API for better developer experience \
**No Auth Included** - Bring your own authentication; `userId` is optional for multi-tenant scoping

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

Automatically redirects users to the appropriate URL based on device type (iOS/Android/web), evaluates targeting rules, and tracks the click asynchronously.

### QR Codes

```bash
GET /api/links/:id/qr?format=png&size=300
GET /api/links/:id/qr?format=svg
```

### Webhooks

```bash
GET    /api/webhooks?userId=user-uuid
POST   /api/webhooks                     # Body: { name, url, events, userId? }
GET    /api/webhooks/:id?userId=user-uuid
PUT    /api/webhooks/:id?userId=user-uuid
DELETE /api/webhooks/:id?userId=user-uuid
POST   /api/webhooks/:id/test?userId=user-uuid
```

Events: `click_event`, `install_event`, `conversion_event`. Payloads are HMAC SHA-256 signed.

### Mobile SDK Endpoints

```bash
POST /api/sdk/v1/install               # Report app install, get deferred deep link
GET  /api/sdk/v1/attribution/:fingerprint  # Debug attribution lookups
POST /api/sdk/v1/event                 # Track in-app conversion events
GET  /api/sdk/v1/resolve/:shortCode    # Resolve link to deep link data (no redirect)
GET  /api/sdk/v1/health                # Health check
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

## Configuration

### Server Options

```typescript
interface ServerOptions {
  database?: {
    url?: string;           // PostgreSQL connection string
    pool?: {
      min?: number;         // Minimum pool connections (default: 2)
      max?: number;         // Maximum pool connections (default: 10)
    };
  };
  redis?: {
    url: string;            // Redis connection string (optional)
  };
  cors?: {
    origin: string | string[];  // CORS allowed origins (default: '*')
  };
  logger?: boolean;         // Enable Fastify logger (default: true)
}
```

### Environment Variables

```bash
DATABASE_URL=postgresql://localhost/linkforty
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=production
CORS_ORIGIN=*

# Mobile SDK (optional — for iOS Universal Links and Android App Links)
IOS_TEAM_ID=ABC123XYZ
IOS_BUNDLE_ID=com.yourcompany.yourapp
ANDROID_PACKAGE_NAME=com.yourcompany.yourapp
ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:DD:...

# Custom domain for QR code URLs (optional)
SHORTLINK_DOMAIN=yourdomain.com
```

## Database Schema

Core does not create a `users` table. Authentication and user management are the consumer's responsibility. The `user_id` column on `links` and `webhooks` is optional (nullable, no foreign key) — use it for multi-tenant scoping when your auth layer provides a user identity.

### Links Table

| Column                  | Type         | Description                              |
|-------------------------|--------------|------------------------------------------|
| id                      | UUID         | Primary key                              |
| user_id                 | UUID         | Optional owner/tenant identifier         |
| short_code              | VARCHAR(20)  | Unique short code                        |
| original_url            | TEXT         | Original URL                             |
| title                   | VARCHAR(255) | Link title                               |
| description             | TEXT         | Link description                         |
| ios_app_store_url       | TEXT         | iOS App Store URL                        |
| android_app_store_url   | TEXT         | Android Play Store URL                   |
| web_fallback_url        | TEXT         | Web fallback URL                         |
| app_scheme              | VARCHAR(255) | URI scheme (e.g., "myapp")               |
| ios_universal_link      | TEXT         | iOS Universal Link URL                   |
| android_app_link        | TEXT         | Android App Link URL                     |
| deep_link_path          | TEXT         | In-app destination path                  |
| deep_link_parameters    | JSONB        | Custom app parameters                    |
| utm_parameters          | JSONB        | UTM tracking parameters                  |
| targeting_rules         | JSONB        | Country/device/language targeting         |
| og_title                | VARCHAR(255) | Open Graph title                         |
| og_description          | TEXT         | Open Graph description                   |
| og_image_url            | TEXT         | Open Graph image URL                     |
| og_type                 | VARCHAR(50)  | Open Graph type (default: "website")     |
| attribution_window_hours| INTEGER      | Install attribution window (default: 168)|
| is_active               | BOOLEAN      | Active status                            |
| expires_at              | TIMESTAMP    | Expiration date                          |
| created_at              | TIMESTAMP    | Creation timestamp                       |
| updated_at              | TIMESTAMP    | Last update timestamp                    |

### Click Events Table

| Column       | Type         | Description                  |
|--------------|--------------|------------------------------|
| id           | UUID         | Primary key                  |
| link_id      | UUID         | Foreign key to links         |
| clicked_at   | TIMESTAMP    | Click timestamp              |
| ip_address   | INET         | User IP address              |
| user_agent   | TEXT         | User agent string            |
| device_type  | VARCHAR(20)  | Device type (ios/android/web)|
| platform     | VARCHAR(20)  | Platform (iOS/Android/Web)   |
| country_code | CHAR(2)      | Country code                 |
| country_name | VARCHAR(100) | Country name                 |
| region       | VARCHAR(100) | Region/state                 |
| city         | VARCHAR(100) | City                         |
| latitude     | DECIMAL      | Latitude                     |
| longitude    | DECIMAL      | Longitude                    |
| timezone     | VARCHAR(100) | Timezone                     |
| utm_source   | VARCHAR(255) | UTM source                   |
| utm_medium   | VARCHAR(255) | UTM medium                   |
| utm_campaign | VARCHAR(255) | UTM campaign                 |
| referrer     | TEXT         | Referrer URL                 |

### Device Fingerprints Table

| Column           | Type        | Description                         |
|------------------|-------------|-------------------------------------|
| id               | UUID        | Primary key                         |
| click_id         | UUID        | Foreign key to click_events         |
| fingerprint_hash | VARCHAR(64) | SHA-256 hash of fingerprint signals |
| ip_address       | INET        | IP address                          |
| user_agent       | TEXT        | User agent string                   |
| timezone         | VARCHAR(100)| Timezone                            |
| language         | VARCHAR(10) | Browser language                    |
| screen_width     | INTEGER     | Screen width                        |
| screen_height    | INTEGER     | Screen height                       |
| platform         | VARCHAR(50) | Platform                            |
| platform_version | VARCHAR(50) | Platform version                    |
| created_at       | TIMESTAMP   | Creation timestamp                  |

### Install Events Table

| Column                  | Type        | Description                        |
|-------------------------|-------------|------------------------------------|
| id                      | UUID        | Primary key                        |
| link_id                 | UUID        | Attributed link (nullable)         |
| click_id                | UUID        | Attributed click (nullable)        |
| fingerprint_hash        | VARCHAR(64) | Device fingerprint hash            |
| confidence_score        | DECIMAL     | Match confidence (0-100)           |
| installed_at            | TIMESTAMP   | Install timestamp                  |
| first_open_at           | TIMESTAMP   | First app open                     |
| deep_link_retrieved     | BOOLEAN     | Whether deferred link was fetched  |
| deep_link_data          | JSONB       | Deferred deep link data            |
| attribution_window_hours| INTEGER     | Attribution window used (default: 168) |
| device_id               | VARCHAR(255)| Optional device identifier         |
| created_at              | TIMESTAMP   | Creation timestamp                 |

### In-App Events Table

| Column          | Type         | Description                  |
|-----------------|--------------|------------------------------|
| id              | UUID         | Primary key                  |
| install_id      | UUID         | Foreign key to install_events|
| event_name      | VARCHAR(255) | Event name                   |
| event_data      | JSONB        | Custom event properties      |
| event_timestamp | TIMESTAMP    | When the event occurred      |
| created_at      | TIMESTAMP    | Creation timestamp           |

### Webhooks Table

| Column     | Type         | Description                      |
|------------|--------------|----------------------------------|
| id         | UUID         | Primary key                      |
| user_id    | UUID         | Optional owner/tenant identifier |
| name       | VARCHAR(255) | Webhook name                     |
| url        | TEXT         | Delivery URL                     |
| secret     | VARCHAR(255) | HMAC signing secret              |
| events     | TEXT[]       | Subscribed event types           |
| is_active  | BOOLEAN      | Active status                    |
| retry_count| INTEGER      | Max retries (default: 3)         |
| timeout_ms | INTEGER      | Request timeout (default: 10000) |
| headers    | JSONB        | Custom HTTP headers              |
| created_at | TIMESTAMP    | Creation timestamp               |
| updated_at | TIMESTAMP    | Last update timestamp            |

## Utilities

### Generate Short Code

```typescript
import { generateShortCode } from '@linkforty/core';

const code = generateShortCode(8); // Returns 8-character nanoid
```

### Detect Device

```typescript
import { detectDevice } from '@linkforty/core';

const device = detectDevice(userAgent); // Returns 'ios' | 'android' | 'web'
```

### Get Location from IP

```typescript
import { getLocationFromIP } from '@linkforty/core';

const location = getLocationFromIP('8.8.8.8');
// Returns: { countryCode, countryName, region, city, latitude, longitude, timezone }
```

### Build Redirect URL with UTM Parameters

```typescript
import { buildRedirectUrl } from '@linkforty/core';

const url = buildRedirectUrl('https://example.com', {
  source: 'twitter',
  medium: 'social',
  campaign: 'summer-sale'
});
// Returns: https://example.com?utm_source=twitter&utm_medium=social&utm_campaign=summer-sale
```

## Advanced Usage

### Custom Route Registration

```typescript
import { createServer } from '@linkforty/core';

const server = await createServer({
  database: { url: 'postgresql://localhost/linkforty' },
});

// Add custom routes
server.get('/custom', async (request, reply) => {
  return { message: 'Hello World' };
});

await server.listen({ port: 3000 });
```

### Using Individual Route Handlers

```typescript
import Fastify from 'fastify';
import { initializeDatabase, redirectRoutes, linkRoutes } from '@linkforty/core';

const fastify = Fastify();

// Initialize database separately
await initializeDatabase({ url: 'postgresql://localhost/linkforty' });

// Register only specific routes
await fastify.register(redirectRoutes);
await fastify.register(linkRoutes);

await fastify.listen({ port: 3000 });
```

## Deployment

LinkForty can be deployed in multiple ways depending on your needs:

### Production Deployment (Recommended)

Deploy to managed platforms with minimal DevOps overhead:

**Fly.io (Recommended)**
- Global edge deployment
- Managed PostgreSQL and Redis
- Auto-scaling and SSL included
- Starting at ~$10-15/month

[View Fly.io deployment guide](infra/fly.io/DEPLOYMENT.md)

See [`infra/`](infra/) directory for all deployment options and platform-specific guides.

### Docker Deployment (Recommended for Self-Hosting)

**Production-ready Docker images available on Docker Hub:**

```bash
# One-command deployment
curl -O https://raw.githubusercontent.com/linkforty/core/main/docker-compose.yml
docker compose up -d
```

**Image Details:**
- **Registry:** `linkforty/core`
- **Tags:** `latest`, `v1.x.x`, `main`
- **Architectures:** linux/amd64, linux/arm64
- **Base:** Node.js 22 Alpine (minimal, secure)
- **Security:** Non-root user, SBOM attestations

**Version Pinning (Recommended):**
```yaml
services:
  linkforty:
    image: linkforty/core:v1.5.0  # Pin to specific version
```

See [DOCKER.md](DOCKER.md) for complete deployment guide including:
- Environment configuration
- Health checks
- Backup strategies
- Production best practices

### Manual Deployment

For custom infrastructure needs:

1. Install dependencies: `npm install @linkforty/core`
2. Set up PostgreSQL database (13+)
3. Set up Redis (optional but recommended)
4. Run migrations: `npm run migrate`
5. Start server: `node server.js`

### Other Platforms

Community-maintained templates available for:
- AWS (ECS/Fargate)
- Google Cloud Run
- Railway, Render, and more

See [`infra/CONTRIBUTING.md`](infra/CONTRIBUTING.md) to add support for additional platforms.

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

- **React Native**: `npm install @linkforty/mobile-sdk-react-native`
- **iOS Native**: Coming soon
- **Android Native**: Coming soon
- **Flutter**: Coming soon

See [SDK Integration Guide](https://docs.linkforty.com/sdks/react-native/overview) for detailed documentation.

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


## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

AGPL-3.0 - see [LICENSE](LICENSE) file for details.

## Related Projects

- **[@linkforty/ui](https://github.com/LinkForty/ui)** - React UI components for link management
- **[@linkforty/mobile-sdk-react-native](https://github.com/LinkForty/mobile-sdk-react-native)** - React Native SDK for deferred deep linking
- **[LinkForty Cloud](https://linkforty.com)** - Hosted SaaS version with authentication, teams, billing, and more

## Support

- **Documentation**: [https://docs.linkforty.com](https://docs.linkforty.com)
- **Issues**: [GitHub Issues](https://github.com/linkforty/core/issues)
- **Discussions**: [GitHub Discussions](https://github.com/linkforty/core/discussions)

## Built with:
- [Fastify](https://www.fastify.io/) - Fast web framework
- [PostgreSQL](https://www.postgresql.org/) - Powerful database
- [Redis](https://redis.io/) - In-memory cache
- [Zod](https://zod.dev/) - TypeScript-first schema validation
- [nanoid](https://github.com/ai/nanoid) - Unique ID generation
- [geoip-lite](https://github.com/geoip-lite/node-geoip) - IP geolocation
- [ua-parser-js](https://github.com/faisalman/ua-parser-js) - User agent parsing
- [qrcode](https://github.com/soldair/node-qrcode) - QR code generation
