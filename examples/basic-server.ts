import { createServer } from '@linkforty/core';

async function start() {
  const server = await createServer({
    database: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/linkforty',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
  });

  await server.listen({
    port: Number(process.env.PORT) || 3000,
    host: '0.0.0.0',
  });

  console.log('Link Forty server running on http://localhost:3000');
  console.log('');
  console.log('API Endpoints:');
  console.log('  POST   /api/links          - Create a new link');
  console.log('  GET    /api/links          - List all links (requires ?userId=xxx)');
  console.log('  GET    /api/links/:id      - Get a specific link (requires ?userId=xxx)');
  console.log('  PUT    /api/links/:id      - Update a link (requires ?userId=xxx)');
  console.log('  DELETE /api/links/:id      - Delete a link (requires ?userId=xxx)');
  console.log('  GET    /api/analytics/overview - Get analytics overview (requires ?userId=xxx)');
  console.log('  GET    /api/analytics/links/:linkId - Get link analytics (requires ?userId=xxx)');
  console.log('');
  console.log('Public Endpoint:');
  console.log('  GET    /:shortCode         - Redirect to target URL');
}

start().catch(console.error);
