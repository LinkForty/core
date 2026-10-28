import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import redis from '@fastify/redis';
import { initializeDatabase, DatabaseOptions } from './lib/database.js';
import { redirectRoutes, type RedirectRouteOptions } from './routes/redirect.js';
import { linkRoutes } from './routes/links.js';
import { analyticsRoutes } from './routes/analytics.js';
import { sdkRoutes, type SdkRouteOptions } from './routes/sdk.js';
import { webhookRoutes } from './routes/webhooks.js';
import { templateRoutes } from './routes/templates.js';
import { qrRoutes } from './routes/qr.js';
import { wellKnownRoutes } from './routes/well-known.js';
import { healthRoutes } from './routes/health.js';
import type { LinkFortyConfig } from './lib/config.js';

/**
 * Configuration options for creating a LinkForty server instance.
 */
export interface ServerOptions {
  database?: DatabaseOptions;
  redis?: {
    url: string;
  };
  cors?: {
    origin: string | string[];
  };
  logger?: boolean;
  /** When true or a number (proxy hop count), Fastify trusts X-Forwarded-For so request.ip is the real client IP. Set when behind a reverse proxy. */
  trustProxy?: boolean | number;
  /** Options for the redirect routes: abuse-report link, launchpad page hooks. */
  redirect?: RedirectRouteOptions;
  /** Options for the SDK routes: install match scoping. */
  sdk?: SdkRouteOptions;
  /**
   * The instance's settings from linkforty.config.json, as loadConfig() returns
   * them. Options passed in code take precedence over the file.
   */
  config?: LinkFortyConfig;
}

/**
 * Create and configure a LinkForty Fastify server instance.
 *
 * Registers CORS, optional Redis, the database connection, and all built-in
 * route plugins. The returned instance is ready to call `listen()` on.
 *
 * @param options - Server configuration (database, Redis, CORS, logger).
 * @returns A configured Fastify instance with all routes registered.
 */
export async function createServer(options: ServerOptions = {}) {
  const fastify = Fastify({
    logger: options.logger !== undefined ? options.logger : true,
    trustProxy: options.trustProxy,
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
  await fastify.register(healthRoutes);
  await fastify.register(wellKnownRoutes);
  await fastify.register(redirectRoutes, {
    ...options.redirect,
    notFoundDefaults: options.redirect?.notFoundDefaults ?? options.config?.notFound,
    launchpad: {
      ...options.redirect?.launchpad,
      defaults: options.redirect?.launchpad?.defaults ?? options.config?.launchpad,
    },
  });
  await fastify.register(linkRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(sdkRoutes, options.sdk ?? {});
  await fastify.register(webhookRoutes);
  await fastify.register(templateRoutes);
  await fastify.register(qrRoutes);

  return fastify;
}

// Re-export utilities and types
export * from './lib/utils.js';
export * from './lib/client-ip.js';
export * from './lib/database.js';
export * from './lib/fingerprint.js';
export * from './lib/webhook.js';
export * from './lib/link-lookup.js';
export * from './lib/portable/index.js';
export * from './lib/link-safety.js';
export * from './lib/launchpad.js';
export * from './lib/not-found-page.js';
export * from './lib/config.js';
export * from './lib/event-emitter.js';
export * from './types/index.js';
export type { RedirectRouteOptions } from './routes/redirect.js';
export type { SdkRouteOptions } from './routes/sdk.js';
export { redirectRoutes, linkRoutes, analyticsRoutes, sdkRoutes, webhookRoutes, templateRoutes, qrRoutes, previewRoutes, debugRoutes, wellKnownRoutes, healthRoutes } from './routes/index.js';
