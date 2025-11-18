# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@linkforty/core is a TypeScript-based deeplink management engine that provides smart link routing with device detection, analytics, and UTM parameter support. It's built on Fastify with PostgreSQL for persistence and optional Redis for caching.

## Development Commands

### Building and Running
```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Development server with hot reload (tsx watch)
npm run test           # Run Vitest test suite
npm run migrate        # Run database migrations (create schema)
```

### Database Setup
The project uses automatic schema initialization on startup (src/lib/database.ts:42-126), but you can also run migrations explicitly:
```bash
npm run migrate        # Runs src/scripts/migrate.ts
```

Environment variables (see .env.example):
- `DATABASE_URL`: PostgreSQL connection string (default: postgresql://postgres:password@localhost:5432/linkforty)
- `REDIS_URL`: Optional Redis URL for caching (default: redis://localhost:6379)
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)
- `CORS_ORIGIN`: CORS allowed origins (default: *)

### Testing
```bash
npm run test           # Run all tests
npm run test:watch     # Watch mode
npm run test:coverage  # Generate coverage report
```

Tests use Vitest and should be placed alongside source files with `.test.ts` extension.

## Architecture

### Core Flow
1. **Server Creation** (src/index.ts): `createServer()` initializes Fastify with CORS, optional Redis, database connection, and route registration
2. **Database Layer** (src/lib/database.ts): Global `db` pool with retry logic and automatic schema initialization
3. **Route Handlers**: Three main route modules registered as Fastify plugins
4. **Utilities** (src/lib/utils.ts): Device detection, geolocation, UTM handling

### Key Components

#### Database Schema (src/lib/database.ts)
Three main tables with foreign key relationships:
- **users**: Basic user records (id, email, name, password_hash)
- **links**: Short links with device-specific URLs, UTM params, targeting rules (JSONB), expiration
- **click_events**: Analytics events with IP geolocation, device/platform info, UTM tracking

Critical indexes:
- `idx_links_short_code` (unique): Fast short code lookups for redirects
- `idx_clicks_link_date`: Optimized for time-range analytics queries
- Foreign keys use CASCADE DELETE for cleanup

#### Redirect Flow (src/routes/redirect.ts)
1. **Cache Check**: Try Redis first (`link:{shortCode}`, 5min TTL)
2. **Database Lookup**: Query links table with active/expiration checks
3. **Targeting Rules**: Evaluate country/device/language filters BEFORE redirect
4. **Click Tracking**: Async tracking (setImmediate) with geolocation and device detection
5. **Device Routing**: Select URL based on device type (ios_url → android_url → web_fallback_url → original_url)
6. **UTM Injection**: Append UTM parameters to final redirect URL

**Important**: Targeting rules (src/routes/redirect.ts:49-92) return 404 if user doesn't match criteria. Click tracking happens asynchronously to not block redirects.

#### Link Management (src/routes/links.ts)
- All endpoints require `userId` query parameter for multi-tenancy
- Zod schemas validate inputs (createLinkSchema, updateLinkSchema)
- Short code generation: Custom code OR nanoid with uniqueness retry (max 10 attempts)
- Updates invalidate Redis cache (not implemented - manual invalidation needed)
- All queries join click_events for real-time click counts

#### Analytics (src/routes/analytics.ts)
- **Overview**: User-level aggregate analytics with top links
- **Link-specific**: Detailed analytics for single link
- Time range via `days` query parameter (default: 30)
- Uses COALESCE for handling NULL geography data
- All counts cast to integers from PostgreSQL BIGINT

### Type System (src/types/index.ts)
- `Link`: Database row representation (snake_case fields)
- `CreateLinkRequest` / `UpdateLinkRequest`: API contract (camelCase)
- `UTMParameters`: Structured UTM tracking fields
- `TargetingRules`: Device/country/language filtering
- `AnalyticsData`: Comprehensive analytics response shape

## Code Conventions

### Naming
- **Files**: kebab-case (e.g., `redirect-handler.ts`)
- **Database columns**: snake_case (e.g., `short_code`, `utm_parameters`)
- **TypeScript**: camelCase functions, PascalCase interfaces/types
- **Constants**: UPPER_SNAKE_CASE (e.g., `COUNTRY_NAMES` in utils.ts)

### Database Patterns
- Use parameterized queries exclusively (SQL injection protection)
- JSONB columns for flexible data: `utm_parameters`, `targeting_rules`
- All timestamps: `TIMESTAMP DEFAULT NOW()` with `updated_at` triggers
- UUID primary keys: `gen_random_uuid()`

### Redis Caching
- Pattern: `link:{shortCode}` → stringified link JSON
- TTL: 300 seconds (5 minutes)
- Graceful degradation: Falls back to database on Redis errors
- **Cache Invalidation Gap**: Link updates don't currently invalidate cache (potential stale data issue)

### Error Handling
- Throw errors from route handlers for Fastify error handling
- Log errors via `fastify.log.error()` for structured logging
- Database retry logic: Exponential backoff (src/lib/database.ts:21-39)

## Module Exports

The package exports multiple entry points (package.json:46-52):
```javascript
import { createServer } from '@linkforty/core';              // Main
import { generateShortCode } from '@linkforty/core/utils';   // Utilities
import { db } from '@linkforty/core/database';               // Database pool
import { linkRoutes } from '@linkforty/core/routes';         // Route handlers
import { Link, AnalyticsData } from '@linkforty/core/types'; // TypeScript types
```

## Common Patterns

### Adding a New Route
1. Create route handler function in `src/routes/`
2. Export as Fastify plugin: `async function myRoutes(fastify: FastifyInstance)`
3. Define Zod schemas for request validation
4. Register in `src/index.ts` createServer()
5. Re-export from `src/routes/index.ts`

### Adding a Utility Function
1. Add to `src/lib/utils.ts`
2. Export function with explicit TypeScript types
3. Re-export from `src/index.ts` for public API

### Database Queries
```typescript
// Always use parameterized queries
const result = await db.query(
  'SELECT * FROM links WHERE user_id = $1 AND short_code = $2',
  [userId, shortCode]
);

// For JSONB columns, stringify before insert
JSON.stringify(data.utmParameters || {})
```

## Performance Considerations

- **Redis Caching**: Reduces database load by ~90% for link lookups (5min TTL)
- **Async Click Tracking**: Uses `setImmediate()` to avoid blocking redirects
- **Connection Pooling**: Min 2, max 10 connections (configurable)
- **Indexed Queries**: All analytics queries use indexed fields (link_id, clicked_at)

## Security Notes

- SQL injection protection via parameterized queries throughout
- Zod validation on all API inputs
- CORS configurable per deployment
- Production SSL: Auto-enabled when `NODE_ENV=production`
- User isolation: All queries filtered by `userId` parameter

## Common Issues

### Database Connection Failures
The database client retries connections with exponential backoff (max 10 attempts). Ensure PostgreSQL is running and `DATABASE_URL` is correct.

### Stale Cache After Link Updates
Link updates (PUT /api/links/:id) don't invalidate Redis cache. Either:
1. Wait 5 minutes for TTL expiration
2. Manually invalidate: `await fastify.redis.del(\`link:${shortCode}\`)`
3. Add cache invalidation to update handler

### Short Code Collisions
The system retries up to 10 times for unique short codes. With 8-character nanoid, collision probability is negligible for normal use.

## Migration Notes

- No separate migration files - schema created via `initializeDatabase()`
- Schema changes require updating `src/lib/database.ts` initialization
- For production, consider dedicated migration tool (e.g., node-pg-migrate)
