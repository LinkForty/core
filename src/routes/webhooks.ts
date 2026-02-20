import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/database.js';
import { generateWebhookSecret } from '../lib/webhook.js';
import type { Webhook, WebhookEvent } from '../types/index.js';

const webhookEventSchema = z.enum(['click_event', 'install_event', 'conversion_event']);

const createWebhookSchema = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1),
  headers: z.record(z.string()).optional(),
  retryCount: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

const updateWebhookSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  url: z.string().url().optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
  isActive: z.boolean().optional(),
  headers: z.record(z.string()).optional(),
  retryCount: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});

export async function webhookRoutes(fastify: FastifyInstance) {
  // Get all webhooks (optionally filtered by userId)
  fastify.get('/api/webhooks', async (request: FastifyRequest<{
    Querystring: { userId?: string }
  }>) => {
    const { userId } = request.query;

    let result;
    if (userId) {
      result = await db.query(
        `SELECT id, user_id, name, url, events, is_active, retry_count, timeout_ms, headers, created_at, updated_at
         FROM webhooks
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
    } else {
      result = await db.query(
        `SELECT id, user_id, name, url, events, is_active, retry_count, timeout_ms, headers, created_at, updated_at
         FROM webhooks
         ORDER BY created_at DESC`
      );
    }

    // Don't expose secrets in list view
    return result.rows;
  });

  // Get a single webhook with secret
  fastify.get('/api/webhooks/:id', async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { userId?: string }
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    let result;
    if (userId) {
      result = await db.query(
        'SELECT * FROM webhooks WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    } else {
      result = await db.query(
        'SELECT * FROM webhooks WHERE id = $1',
        [id]
      );
    }

    if (result.rows.length === 0) {
      throw new Error('Webhook not found');
    }

    return result.rows[0];
  });

  // Create a new webhook
  fastify.post('/api/webhooks', async (request: FastifyRequest) => {
    const data = createWebhookSchema.parse(request.body);

    // Generate secure random secret
    const secret = generateWebhookSecret();

    const result = await db.query(
      `INSERT INTO webhooks (user_id, name, url, secret, events, retry_count, timeout_ms, headers)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.userId || null,
        data.name,
        data.url,
        secret,
        data.events,
        data.retryCount || 3,
        data.timeoutMs || 10000,
        JSON.stringify(data.headers || {}),
      ]
    );

    return result.rows[0];
  });

  // Update a webhook
  fastify.put('/api/webhooks/:id', async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { userId?: string }
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;
    const data = updateWebhookSchema.parse(request.body);

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.url !== undefined) {
      updates.push(`url = $${paramCount++}`);
      values.push(data.url);
    }
    if (data.events !== undefined) {
      updates.push(`events = $${paramCount++}`);
      values.push(data.events);
    }
    if (data.isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(data.isActive);
    }
    if (data.headers !== undefined) {
      updates.push(`headers = $${paramCount++}`);
      values.push(JSON.stringify(data.headers));
    }
    if (data.retryCount !== undefined) {
      updates.push(`retry_count = $${paramCount++}`);
      values.push(data.retryCount);
    }
    if (data.timeoutMs !== undefined) {
      updates.push(`timeout_ms = $${paramCount++}`);
      values.push(data.timeoutMs);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    let whereClause = `WHERE id = $${paramCount++}`;
    if (userId) {
      values.push(userId);
      whereClause += ` AND user_id = $${paramCount}`;
    }

    const result = await db.query(
      `UPDATE webhooks
       SET ${updates.join(', ')}
       ${whereClause}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('Webhook not found');
    }

    return result.rows[0];
  });

  // Delete a webhook
  fastify.delete('/api/webhooks/:id', async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { userId?: string }
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    let result;
    if (userId) {
      result = await db.query(
        'DELETE FROM webhooks WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );
    } else {
      result = await db.query(
        'DELETE FROM webhooks WHERE id = $1 RETURNING id',
        [id]
      );
    }

    if (result.rows.length === 0) {
      throw new Error('Webhook not found');
    }

    return { success: true };
  });

  // Test a webhook
  fastify.post('/api/webhooks/:id/test', async (request: FastifyRequest<{
    Params: { id: string }
    Querystring: { userId?: string }
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    // Get webhook
    let webhookResult;
    if (userId) {
      webhookResult = await db.query(
        'SELECT * FROM webhooks WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    } else {
      webhookResult = await db.query(
        'SELECT * FROM webhooks WHERE id = $1',
        [id]
      );
    }

    if (webhookResult.rows.length === 0) {
      throw new Error('Webhook not found');
    }

    const webhook: Webhook = webhookResult.rows[0];

    // Create test payload
    const testPayload = {
      event: 'click_event' as WebhookEvent,
      event_id: '00000000-0000-0000-0000-000000000000',
      timestamp: new Date().toISOString(),
      data: {
        id: '00000000-0000-0000-0000-000000000000',
        linkId: '00000000-0000-0000-0000-000000000000',
        clickedAt: new Date().toISOString(),
        ipAddress: '127.0.0.1',
        userAgent: 'LinkForty-Test/1.0',
        deviceType: 'web',
        platform: 'test',
        countryCode: 'US',
      },
    };

    // Deliver webhook synchronously for testing
    const { deliverWebhook } = await import('../lib/webhook.js');
    const result = await deliverWebhook(webhook, testPayload);

    return {
      success: result.success,
      statusCode: result.responseStatus,
      responseBody: result.responseBody,
      error: result.errorMessage,
    };
  });
}
