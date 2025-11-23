<div align="center">
  <img src="../assets/linkFortyLogo.png" alt="LinkForty Logo" width="150"/>

  # @linkforty/core Examples

  This directory contains example implementations for deploying LinkForty Core.
</div>

## Quick Start with Docker Compose

The easiest way to get started is using Docker Compose, which will set up PostgreSQL, Redis, and the LinkForty server.

### 1. Start All Services

```bash
cd examples
docker compose up -d
```

This will start:
- PostgreSQL database (port 5432)
- Redis cache (port 6379)
- LinkForty server (port 3000)

### 2. Access the Server

The API will be available at `http://localhost:3000`

**Test it:**
```bash
# Health check
curl http://localhost:3000/health

# Create a test link (you'll need a userId first)
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "originalUrl": "https://example.com",
    "title": "My First Link"
  }'
```

### 3. View Logs

```bash
docker compose logs -f linkforty
```

### 4. Stop Services

```bash
docker compose down
```

To remove volumes (data will be lost):
```bash
docker compose down -v
```

## Basic Server (Node.js)

If you prefer to run the server directly with Node.js:

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### 1. Install Dependencies

```bash
npm install @linkforty/core
```

### 2. Start PostgreSQL and Redis

Using Docker:
```bash
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_DB=linkforty \
  -e POSTGRES_USER=linkforty \
  -e POSTGRES_PASSWORD=changeme \
  postgres:15-alpine

docker run -d --name redis -p 6379:6379 \
  redis:7-alpine
```

Or install locally using your package manager.

### 3. Run the Example Server

```bash
# Set environment variables
export DATABASE_URL=postgresql://linkforty:changeme@localhost:5432/linkforty
export REDIS_URL=redis://localhost:6379
export PORT=3000

# Run the server
npx tsx examples/basic-server.ts
```

## Custom Implementation

You can also create your own server implementation:

### TypeScript Example

```typescript
import { createServer } from '@linkforty/core';

async function start() {
  const server = await createServer({
    database: {
      url: process.env.DATABASE_URL,
      pool: {
        min: 2,
        max: 10,
      },
    },
    redis: {
      url: process.env.REDIS_URL,
    },
    cors: {
      origin: ['https://yourdomain.com'],
    },
    logger: true,
  });

  // Add custom routes
  server.get('/custom', async (request, reply) => {
    return { message: 'Custom endpoint' };
  });

  await server.listen({
    port: 3000,
    host: '0.0.0.0',
  });

  console.log('Server running!');
}

start();
```

### JavaScript Example

```javascript
const { createServer } = require('@linkforty/core');

async function start() {
  const server = await createServer({
    database: {
      url: 'postgresql://linkforty:changeme@localhost:5432/linkforty'
    },
    redis: {
      url: 'redis://localhost:6379'
    }
  });

  await server.listen({ port: 3000, host: '0.0.0.0' });
  console.log('Server running on http://localhost:3000');
}

start().catch(console.error);
```

## Environment Variables

Create a `.env` file:

```bash
DATABASE_URL=postgresql://linkforty:changeme@localhost:5432/linkforty
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
```

## Database Migrations

The database schema is automatically initialized on first startup. If you need to run migrations manually:

```bash
npx tsx node_modules/@linkforty/core/dist/scripts/migrate.js
```

## Production Deployment

For production deployments:

1. **Use environment variables** for configuration
2. **Enable Redis** for caching
3. **Set up PostgreSQL replication** for high availability
4. **Use a process manager** (PM2, systemd)
5. **Set NODE_ENV=production**
6. **Configure CORS** to allow only your domains
7. **Use HTTPS** with a reverse proxy (nginx, Caddy)

### Example with PM2

```bash
# Install PM2
npm install -g pm2

# Start server
pm2 start examples/basic-server.ts --name linkforty

# View logs
pm2 logs linkforty

# Monitor
pm2 monit

# Restart
pm2 restart linkforty

# Set to start on boot
pm2 startup
pm2 save
```

### Example nginx config

```nginx
server {
    listen 80;
    server_name links.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## API Usage Examples

### Create a Link

```bash
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "originalUrl": "https://example.com/product",
    "title": "Product Page",
    "iosUrl": "myapp://product/123",
    "androidUrl": "myapp://product/123",
    "utmParameters": {
      "source": "twitter",
      "medium": "social",
      "campaign": "launch"
    },
    "customCode": "product-launch"
  }'
```

### Get All Links

```bash
curl "http://localhost:3000/api/links?userId=user-123"
```

### Update a Link

```bash
curl -X PUT "http://localhost:3000/api/links/link-id?userId=user-123" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "isActive": false
  }'
```

### Get Analytics

```bash
# Overview
curl "http://localhost:3000/api/analytics/overview?userId=user-123&days=30"

# Link-specific
curl "http://localhost:3000/api/analytics/links/link-id?userId=user-123&days=7"
```

### Test Redirect

```bash
curl -I http://localhost:3000/product-launch
```

## Troubleshooting

### Database Connection Failed

- Verify PostgreSQL is running: `docker ps | grep postgres`
- Check connection string in DATABASE_URL
- Ensure database exists: `psql -U linkforty -d linkforty -c "SELECT 1;"`

### Redis Connection Failed

- Verify Redis is running: `docker ps | grep redis`
- Test connection: `redis-cli ping`
- Make sure REDIS_URL is correct

### Port Already in Use

- Check what's using the port: `lsof -i :3000`
- Change the PORT environment variable

### Migrations Not Running

- Run manually: `npx tsx node_modules/@linkforty/core/dist/scripts/migrate.js`
- Check database permissions

## Support

- Documentation: https://github.com/linkforty/core
- Issues: https://github.com/linkforty/core/issues
- Discussions: https://github.com/linkforty/core/discussions
