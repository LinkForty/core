# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2025-11-26

### Added

#### Mobile SDK Support
- **Well-Known Routes**: Added domain verification endpoints for iOS Universal Links and Android App Links
- **Apple App Site Association (AASA)**: Automatic generation of `.well-known/apple-app-site-association` file
- **Digital Asset Links**: Automatic generation of `.well-known/assetlinks.json` for Android
- **Environment Configuration**: New environment variables for mobile app configuration
  - `IOS_TEAM_ID` - Apple Developer Team ID
  - `IOS_BUNDLE_ID` - iOS app bundle identifier
  - `ANDROID_PACKAGE_NAME` - Android package name
  - `ANDROID_SHA256_FINGERPRINTS` - Android app SHA-256 fingerprints (comma-separated for multiple keystores)

#### New API Endpoints
- `GET /.well-known/apple-app-site-association` - iOS Universal Links verification
- `GET /.well-known/assetlinks.json` - Android App Links verification

#### Documentation
- Added Mobile SDK Integration section to README
- Added environment variable examples for mobile app configuration
- Added testing guide for domain verification endpoints
- Comprehensive error messages with documentation links when configuration is missing

### Compatibility
- Fully backward compatible - mobile SDK features are opt-in via environment variables
- Works with existing Core deployments without any changes
- Compatible with LinkForty React Native SDK and future mobile SDKs

---

## [1.1.0] - 2025-11-18

### Added

#### Webhook System
- **Webhook Management API**: Full CRUD operations for webhook endpoints
- **Event Notifications**: Automatic webhook triggers for click events
- **HMAC Signatures**: SHA-256 signed payloads for webhook security verification
- **Retry Logic**: Exponential backoff retry mechanism (configurable 1-10 attempts)
- **Custom Headers**: Support for custom HTTP headers in webhook requests
- **Timeout Configuration**: Configurable timeout (1s-60s) for webhook deliveries
- **Test Endpoint**: Built-in webhook testing with synthetic events
- **Database Schema**: Webhooks table with user isolation and cascade deletion

#### New API Endpoints
- `GET /api/webhooks` - List all webhooks for a user
- `GET /api/webhooks/:id` - Get webhook details with secret
- `POST /api/webhooks` - Create new webhook endpoint
- `PUT /api/webhooks/:id` - Update webhook configuration
- `DELETE /api/webhooks/:id` - Delete webhook
- `POST /api/webhooks/:id/test` - Test webhook with synthetic event

#### Webhook Events
- `click_event` - Triggered on every link click with full analytics data
- `install_event` - Reserved for future app install tracking
- `conversion_event` - Reserved for future conversion tracking

#### Technical Features
- Fire-and-forget async delivery (non-blocking)
- Exponential backoff: 1s → 2s → 4s → 8s → 16s (capped at 30s)
- Request timeout protection with AbortController
- Response body capture (limited to 1000 characters)
- Delivery attempt logging and error tracking
- Secret generation with crypto.randomBytes (64 hex characters)

### Database Changes
- Added `webhooks` table with UUID primary key
- Foreign key constraint to users table (CASCADE DELETE)
- Indexes on `user_id` and `is_active` for query optimization
- JSONB column for custom headers storage

---

## [1.0.0] - 2024-11-13

### Added

#### Core Features
- **Smart Link Routing**: Create short links with device-specific URLs for iOS, Android, and web
- **Device Detection**: Automatic user-agent parsing to route users to platform-specific URLs
- **Click Analytics**: Comprehensive tracking with geolocation, device type, platform, and referrer data
- **UTM Parameters**: Built-in support for UTM campaign tracking (source, medium, campaign)
- **Link Expiration**: Time-based link expiration with automatic enforcement
- **Targeting Rules**: Geographic, device, and language-based link targeting
- **Redis Caching**: Optional Redis integration with 5-minute TTL for high-performance link lookups
- **PostgreSQL Storage**: Reliable data persistence with indexed queries

#### API Endpoints
- `POST /api/links` - Create new links with full configuration
- `GET /api/links` - List all links for a user
- `GET /api/links/:id` - Get specific link details
- `PUT /api/links/:id` - Update existing links
- `DELETE /api/links/:id` - Delete links
- `DELETE /api/links/bulk-delete` - Bulk delete multiple links
- `GET /api/analytics/overview` - Get aggregated analytics across all links
- `GET /api/analytics/links/:id` - Get link-specific analytics
- `GET /:shortCode` - Redirect endpoint with device detection and tracking

#### Developer Features
- **TypeScript Support**: Full type definitions for all exports
- **Modular Architecture**: Import individual route handlers or use complete server
- **Custom Route Registration**: Extend with custom Fastify routes
- **Utility Functions**: Exported helpers for device detection, geolocation, and URL building
- **Database Migrations**: Automated schema initialization and migration scripts
- **Docker Support**: Ready-to-use Docker Compose configuration

#### Database Schema
- Users table with secure password hashing
- Links table with JSONB support for UTM parameters and targeting rules
- Click events table with comprehensive tracking fields
- Optimized indexes for fast lookups and analytics queries

#### Security & Performance
- Parameterized queries to prevent SQL injection
- Zod schema validation on all inputs
- Configurable CORS for API access control
- Asynchronous click tracking for non-blocking redirects
- Database connection pooling with retry logic
- Exponential backoff for failed database connections

#### Documentation
- Comprehensive README with API examples
- Docker deployment guide
- Environment variable configuration
- Database schema documentation
- Utility function examples
- Advanced usage patterns

### Dependencies

#### Runtime
- `fastify` ^4.24.0 - Fast web framework
- `@fastify/cors` ^8.4.0 - CORS support
- `@fastify/redis` ^6.1.0 - Redis integration
- `pg` ^8.11.0 - PostgreSQL client
- `nanoid` ^5.0.0 - Unique ID generation
- `geoip-lite` ^1.4.7 - IP geolocation
- `ua-parser-js` ^1.0.37 - User-agent parsing
- `zod` ^3.22.0 - Schema validation
- `dotenv` ^16.3.0 - Environment configuration

#### Development
- `typescript` ^5.2.0 - TypeScript compiler
- `tsx` ^4.0.0 - TypeScript execution
- `vitest` ^1.0.0 - Testing framework
- Type definitions for all dependencies

### Package Configuration
- ES Modules support
- Multiple export paths (main, utils, database, routes, types)
- Pre-configured npm package with LICENSE and README
- Example code for quick start

### Performance Benchmarks
- Redis caching reduces database queries by ~90% for frequently accessed links
- Async click tracking adds <1ms overhead to redirect latency
- Connection pooling supports 100+ concurrent requests
- Average redirect response time: <50ms (with cache)

---

## Release Notes

### v1.0.0 - Initial Release

This is the first stable release of @linkforty/core, providing a complete, production-ready deeplink management engine. The package has been extracted from the LinkForty SaaS platform and open-sourced under the MIT license.

**Key Highlights:**
- Battle-tested in production environments
- Comprehensive API for link management and analytics
- High performance with Redis caching
- Flexible deployment options (Docker, manual, npm package)
- Full TypeScript support
- MIT licensed for commercial and personal use

**What's Next:**
- Bulk operations via API
- Link grouping and tags
- A/B testing capabilities
- QR code generation
- Webhook delivery logs and analytics

---

[1.5.0]: https://github.com/linkforty/core/releases/tag/v1.5.0
[1.1.0]: https://github.com/linkforty/core/releases/tag/v1.1.0
[1.0.0]: https://github.com/linkforty/core/releases/tag/v1.0.0
