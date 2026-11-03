# Using Core as a library

Utilities and route handlers exported by `@linkforty/core`, for applications that embed Core rather than run the server as is.

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

#### Starting while the database is busy

`initializeDatabase()` creates or updates the schema on every start. Postgres takes a table's lock *before* it evaluates `IF NOT EXISTS`, so a statement such as `ALTER TABLE links ADD COLUMN IF NOT EXISTS …` for a column that already exists would still request an exclusive lock on `links` — and if a long statement (a retention job, a large export) holds that table, the request waits, and every later query on the table, redirects included, queues behind it until the long statement ends. To keep a routine start from ever doing that, statements whose effect already exists are answered from the catalog and never sent, and you can bound the wait for the rest:

```typescript
await initializeDatabase({
  url: 'postgresql://localhost/linkforty',
  // A schema change that waits longer than this fails the start with
  // SQLSTATE 55P03 rather than queueing the table. Retry or restart.
  lockTimeoutMs: 5000,
});
```

The timeout applies only to the initialisation session and is reset before that connection returns to the pool. When adding schema statements of your own, use the idempotent shapes (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`) or a `DO $$ … IF NOT EXISTS (SELECT … FROM information_schema …)` block, never a bare `ALTER` that asks for a lock on every start.
