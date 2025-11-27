import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import redis from '@fastify/redis';
import { initializeDatabase, DatabaseOptions } from './lib/database.js';
import { redirectRoutes } from './routes/redirect.js';
import { linkRoutes } from './routes/links.js';
import { analyticsRoutes } from './routes/analytics.js';
import { sdkRoutes } from './routes/sdk.js';
import { webhookRoutes } from './routes/webhooks.js';
import { qrRoutes } from './routes/qr.js';
import { wellKnownRoutes } from './routes/well-known.js';

export interface ServerOptions {
  database?: DatabaseOptions;
  redis?: {
    url: string;
  };
  cors?: {
    origin: string | string[];
  };
  logger?: boolean;
}

export async function createServer(options: ServerOptions = {}) {
  const fastify = Fastify({
    logger: options.logger !== undefined ? options.logger : true,
  });

  // CORS
  await fastify.register(cors, {
    origin: options.cors?.origin || '*',
  });

  // Redis (optional)
  if (options.redis?.url) {
    await fastify.register(redis, {
      url: options.redis.url,
    });
  }

  // Database
  await initializeDatabase(options.database);

  // Routes
  await fastify.register(wellKnownRoutes);
  await fastify.register(redirectRoutes);
  await fastify.register(linkRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(sdkRoutes);
  await fastify.register(webhookRoutes);
  await fastify.register(qrRoutes);

  return fastify;
}

// Re-export utilities and types
export * from './lib/utils.js';
export * from './lib/database.js';
export * from './lib/fingerprint.js';
export * from './lib/webhook.js';
export * from './lib/event-emitter.js';
export * from './types/index.js';
export { redirectRoutes, linkRoutes, analyticsRoutes, sdkRoutes, webhookRoutes, qrRoutes, previewRoutes, debugRoutes, wellKnownRoutes } from './routes/index.js';
