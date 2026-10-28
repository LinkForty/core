import { createServer, loadConfig, ConfigError } from '@linkforty/core';

function getTrustProxy(): boolean | number | undefined {
  const v = process.env.TRUST_PROXY;
  if (v === undefined || v === '') return undefined;
  if (v === '1' || v.toLowerCase() === 'true') return true;
  const n = Number(v);
  if (!Number.isNaN(n) && n >= 0) return n;
  return undefined;
}

/**
 * linkforty.config.json: the file named by LINKFORTY_CONFIG, else the one in the
 * working directory, if there is one. A broken file stops the server here with
 * the bad setting named, rather than starting with the setting ignored.
 */
function readConfig() {
  try {
    const loaded = loadConfig();
    if (loaded.path) console.log(`Configuration: ${loaded.path}`);
    return loaded.config;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`Invalid configuration — ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

async function start() {
  const config = readConfig();
  const server = await createServer({
    config,
    database: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/linkforty',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
    trustProxy: getTrustProxy(),
  });

  await server.listen({
    port: Number(process.env.PORT) || 3000,
    host: '0.0.0.0',
  });

  console.log('LinkForty server running on http://localhost:3000');
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
