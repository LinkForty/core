import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';

/**
 * Health endpoints.
 *
 * Without these, `GET /health` fell through to the catch-all redirect route
 * `/:shortCode` and was answered as a short-code lookup — a 404 at best, and on
 * a self-hosted install a 500, which made the Docker HEALTHCHECK (which targets
 * /health) permanently unhealthy and buried the real error (issue #35).
 *
 * Two levels, following the usual liveness/readiness split:
 *
 *   /health       — liveness. The process is up and serving. Never touches the
 *                   database, so a database blip cannot get the container killed
 *                   by an orchestrator that restarts on a failing probe.
 *   /health/ready — readiness. Confirms the database answers, and reports Redis
 *                   when it is configured. 503 when the database is unreachable,
 *                   so a load balancer can drain the instance.
 *
 * Both are static paths, which Fastify's router always prefers over the
 * parametric `/:shortCode`, so they cannot be shadowed by a short link — and by
 * the same token `health` is no longer usable as a short code.
 */
export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
  }));

  fastify.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};

    try {
      await db.query('SELECT 1');
      checks.database = 'ok';
    } catch (error) {
      fastify.log.error(`Health: database check failed: ${error}`);
      checks.database = 'error';
    }

    if (fastify.redis) {
      try {
        await fastify.redis.ping();
        checks.redis = 'ok';
      } catch {
        // Redis is an optional cache with database fallback, so a failure here
        // is degraded, not unready — it must not flip the overall status.
        checks.redis = 'error';
      }
    }

    const ready = checks.database === 'ok';
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'error',
      checks,
    });
  });
}
