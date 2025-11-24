<div align="center">
  <img src="./assets/logo.png" alt="LinkForty Logo" width="140"/>

  # LinkForty Core

  **Open-source deeplink management engine with device detection and analytics**

  LinkForty Core is a powerful, self-hosted deeplink management system that enables you to create, manage, and track smart links with device-specific routing, analytics, and UTM parameter support. It's the open-source foundation of the LinkForty platform.
</div>

[![npm version](https://img.shields.io/npm/v/@linkforty/core.svg)](https://www.npmjs.com/package/@linkforty/core)
[![Docker Pulls](https://img.shields.io/docker/pulls/linkforty/core)](https://hub.docker.com/r/linkforty/core)
[![Docker Image Size](https://img.shields.io/docker/image-size/linkforty/core/latest)](https://hub.docker.com/r/linkforty/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features 

✅ **Smart Link Routing** - Create short links with device-specific URLs for iOS, Android, and web \
✅ **Device Detection** - Automatic detection and routing based on user device \
✅ **Click Analytics** - Track clicks with geolocation, device type, platform, and more \
✅ **UTM Parameters** - Built-in support for UTM campaign tracking \
✅ **Link Expiration** - Set expiration dates for time-sensitive links \
✅ **Redis Caching** - Optional Redis support for high-performance link lookups \
✅ **PostgreSQL Storage** - Reliable data persistence with full SQL capabilities \
✅ **TypeScript** - Fully typed API for better developer experience 

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
- ✅ Pre-built multi-architecture images (AMD64 + ARM64)
- ✅ Automatic updates with version tags
- ✅ Non-root user for security
- ✅ Built-in health checks
- ✅ Supply chain attestations (SBOM + Provenance)

See [DOCKER.md](DOCKER.md) for complete deployment guide.

## API Reference

### Create a Link

```bash
POST /api/links
Content-Type: application/json

{
  "userId": "user-uuid",
  "originalUrl": "https://example.com",
  "title": "My Link",
  "iosUrl": "myapp://product/123",
  "androidUrl": "myapp://product/123",
  "webFallbackUrl": "https://example.com/product/123",
  "utmParameters": {
    "source": "twitter",
    "medium": "social",
    "campaign": "summer-sale"
  },
  "customCode": "summer-sale",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**Response:**

```json
{
  "id": "link-uuid",
  "userId": "user-uuid",
  "short_code": "summer-sale",
  "original_url": "https://example.com",
  "title": "My Link",
  "ios_url": "myapp://product/123",
  "android_url": "myapp://product/123",
  "web_fallback_url": "https://example.com/product/123",
  "utmParameters": {
    "source": "twitter",
    "medium": "social",
    "campaign": "summer-sale"
  },
  "is_active": true,
  "expires_at": "2024-12-31T23:59:59Z",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "clickCount": 0
}
```

### Get All Links

```bash
GET /api/links?userId=user-uuid
```

### Get a Specific Link

```bash
GET /api/links/:id?userId=user-uuid
```

### Update a Link

```bash
PUT /api/links/:id?userId=user-uuid
Content-Type: application/json

{
  "title": "Updated Title",
  "isActive": false
}
```

### Delete a Link

```bash
DELETE /api/links/:id?userId=user-uuid
```

### Get Analytics Overview

```bash
GET /api/analytics/overview?userId=user-uuid&days=30
```

**Response:**

```json
{
  "totalClicks": 1234,
  "uniqueClicks": 567,
  "clicksByDate": [
    { "date": "2024-01-01", "clicks": 45 }
  ],
  "clicksByCountry": [
    { "countryCode": "US", "country": "United States", "clicks": 234 }
  ],
  "clicksByDevice": [
    { "device": "mobile", "clicks": 789 }
  ],
  "clicksByPlatform": [
    { "platform": "iOS", "clicks": 456 }
  ],
  "topLinks": [
    {
      "id": "link-uuid",
      "shortCode": "summer-sale",
      "title": "My Link",
      "originalUrl": "https://example.com",
      "totalClicks": 123,
      "uniqueClicks": 67
    }
  ]
}
```

### Get Link-Specific Analytics

```bash
GET /api/analytics/links/:linkId?userId=user-uuid&days=30
```

### Redirect Short Link

```bash
GET /:shortCode
```

This endpoint automatically redirects users to the appropriate URL based on their device type.

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
```

## Database Schema

### Users Table

| Column        | Type         | Description           |
|---------------|--------------|-----------------------|
| id            | UUID         | Primary key           |
| email         | VARCHAR(255) | Unique email          |
| name          | VARCHAR(255) | User name             |
| password_hash | VARCHAR(255) | Hashed password       |
| created_at    | TIMESTAMP    | Creation timestamp    |
| updated_at    | TIMESTAMP    | Last update timestamp |

### Links Table

| Column           | Type         | Description           |
|------------------|--------------|-----------------------|
| id               | UUID         | Primary key           |
| user_id          | UUID         | Foreign key to users  |
| short_code       | VARCHAR(20)  | Unique short code     |
| original_url     | TEXT         | Original URL          |
| title            | VARCHAR(255) | Link title            |
| ios_url          | TEXT         | iOS-specific URL      |
| android_url      | TEXT         | Android-specific URL  |
| web_fallback_url | TEXT         | Web fallback URL      |
| utm_parameters   | JSONB        | UTM parameters        |
| targeting_rules  | JSONB        | Targeting rules       |
| is_active        | BOOLEAN      | Active status         |
| expires_at       | TIMESTAMP    | Expiration date       |
| created_at       | TIMESTAMP    | Creation timestamp    |
| updated_at       | TIMESTAMP    | Last update timestamp |

### Click Events Table

| Column       | Type         | Description                  |
|--------------|--------------|------------------------------|
| id           | UUID         | Primary key                  |
| link_id      | UUID         | Foreign key to links         |
| clicked_at   | TIMESTAMP    | Click timestamp              |
| ip_address   | INET         | User IP address              |
| user_agent   | TEXT         | User agent string            |
| device_type  | VARCHAR(20)  | Device type (mobile/desktop) |
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

### 🚀 Production Deployment (Recommended)

Deploy to managed platforms with minimal DevOps overhead:

**Fly.io (Recommended)**
- Global edge deployment
- Managed PostgreSQL and Redis
- Auto-scaling and SSL included
- Starting at ~$10-15/month

[View Fly.io deployment guide →](infra/fly.io/DEPLOYMENT.md)

See [`infra/`](infra/) directory for all deployment options and platform-specific guides.

### 🐳 Docker Deployment (Recommended for Self-Hosting)

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
    image: linkforty/core:v1.4.0  # Pin to specific version
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
- **Async click tracking**: Non-blocking click event logging
- **Connection pooling**: Efficient database connection management

## Security

- **SQL injection protection**: Parameterized queries throughout
- **Input validation**: Zod schema validation on all inputs
- **CORS configuration**: Configurable CORS for API access control
- **Link expiration**: Automatic handling of expired links


## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- **@linkforty/ui** - React UI components for link management
- **[LinkForty Cloud](https://linkforty.com)** - Hosted SaaS version with additional features 

## Support

- **Documentation**: [https://docs.linkforty.com](https://docs.linkforty.com)
- **Issues**: [GitHub Issues](https://github.com/linkforty/core/issues)
- **Discussions**: [GitHub Discussions](https://github.com/linkforty/core/discussions)

## Built with:
- [Fastify](https://www.fastify.io/) - Fast web framework
- [PostgreSQL](https://www.postgresql.org/) - Powerful database
- [Redis](https://redis.io/) - In-memory cache
- [nanoid](https://github.com/ai/nanoid) - Unique ID generation
- [geoip-lite](https://github.com/geoip-lite/node-geoip) - IP geolocation
- [ua-parser-js](https://github.com/faisalman/ua-parser-js) - User agent parsing


