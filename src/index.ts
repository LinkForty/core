import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import redis from '@fastify/redis';
import { initializeDatabase, DatabaseOptions } from './lib/database.js';
import { redirectRoutes } from './routes/redirect.js';
import { linkRoutes } from './routes/links.js';
import { analyticsRoutes } from './routes/analytics.js';

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
  await fastify.register(redirectRoutes);
  await fastify.register(linkRoutes);
  await fastify.register(analyticsRoutes);

  return fastify;
}

// Re-export utilities and types
export * from './lib/utils.js';
export * from './lib/database.js';
export * from './types/index.js';
export { redirectRoutes, linkRoutes, analyticsRoutes } from './routes/index.js';
