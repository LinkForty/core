import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/database.js';
import { generateShortCode } from '../lib/utils.js';

const createLinkSchema = z.object({
  userId: z.string().uuid(),
  originalUrl: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
  iosUrl: z.string().url().optional(),
  androidUrl: z.string().url().optional(),
  webFallbackUrl: z.string().url().optional(),
  customCode: z.string().optional(),
  utmParameters: z.object({
    source: z.string().optional(),
    medium: z.string().optional(),
    campaign: z.string().optional(),
    term: z.string().optional(),
    content: z.string().optional(),
  }).optional(),
  targetingRules: z.object({
    countries: z.array(z.string()).optional(),
    devices: z.array(z.enum(['ios', 'android', 'web'])).optional(),
    languages: z.array(z.string()).optional(),
  }).optional(),
  ogTitle: z.string().optional(),
  ogDescription: z.string().optional(),
  ogImageUrl: z.string().url().optional(),
  ogType: z.string().optional(),
  attributionWindowHours: z.number()
    .int('Attribution window must be an integer')
    .min(1, 'Attribution window must be at least 1 hour')
    .max(2160, 'Attribution window must be at most 2160 hours (90 days)')
    .optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateLinkSchema = createLinkSchema.partial().extend({
  isActive: z.boolean().optional(),
}).omit({ userId: true });

export async function linkRoutes(fastify: FastifyInstance) {
  // Get all links for a user
  fastify.get('/api/links', async (request: FastifyRequest<{
    Querystring: { userId: string }
  }>) => {
    const { userId } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    const query = `
      SELECT l.*,
             COUNT(ce.id) as click_count
      FROM links l
             LEFT JOIN click_events ce ON l.id = ce.link_id
      WHERE l.user_id = $1
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `;

    const result = await db.query(query, [userId]);

    return result.rows.map(row => ({
      ...row,
      clickCount: parseInt(row.click_count),
      utmParameters: row.utm_parameters,
      targetingRules: row.targeting_rules,
    }));
  });

  // Get single link
  fastify.get('/api/links/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    const result = await db.query(
      `SELECT l.*, COUNT(ce.id) as click_count
       FROM links l
              LEFT JOIN click_events ce ON l.id = ce.link_id
       WHERE l.id = $1 AND l.user_id = $2
       GROUP BY l.id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Link not found');
    }

    const link = result.rows[0];
    return {
      ...link,
      clickCount: parseInt(link.click_count),
      utmParameters: link.utm_parameters,
      targetingRules: link.targeting_rules,
    };
  });

  // Create link
  fastify.post('/api/links', async (request) => {
    const data = createLinkSchema.parse(request.body);

    // Generate short code
    let shortCode = data.customCode || generateShortCode();

    // Ensure short code is unique
    let attempts = 0;
    while (attempts < 10) {
      const existing = await db.query(
        'SELECT id FROM links WHERE short_code = $1',
        [shortCode]
      );

      if (existing.rows.length === 0) {
        break;
      }

      shortCode = generateShortCode();
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('Unable to generate unique short code');
    }

    const result = await db.query(
      `INSERT INTO links (
        user_id, short_code, original_url, title, description,
        ios_url, android_url, web_fallback_url, utm_parameters, targeting_rules,
        og_title, og_description, og_image_url, og_type,
        attribution_window_hours, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
      [
        data.userId,
        shortCode,
        data.originalUrl,
        data.title || null,
        data.description || null,
        data.iosUrl || null,
        data.androidUrl || null,
        data.webFallbackUrl || null,
        JSON.stringify(data.utmParameters || {}),
        JSON.stringify(data.targetingRules || {}),
        data.ogTitle || null,
        data.ogDescription || null,
        data.ogImageUrl || null,
        data.ogType || 'website',
        data.attributionWindowHours || 168, // Default 7 days
        data.expiresAt || null,
      ]
    );

    const link = result.rows[0];
    return {
      ...link,
      clickCount: 0,
      utmParameters: link.utm_parameters,
      targetingRules: link.targeting_rules,
    };
  });

  // Update link
  fastify.put('/api/links/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    const data = updateLinkSchema.parse(request.body);

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === 'utmParameters' || key === 'targetingRules') {
          updates.push(`${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = $${paramIndex}`);
          values.push(JSON.stringify(value));
        } else {
          const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          updates.push(`${dbKey} = $${paramIndex}`);
          values.push(value);
        }
        paramIndex++;
      }
    });

    if (updates.length === 0) {
      throw new Error('No updates provided');
    }

    updates.push('updated_at = NOW()');
    values.push(id, userId);

    const result = await db.query(
      `UPDATE links SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
         RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error('Link not found');
    }

    const link = result.rows[0];
    return {
      ...link,
      utmParameters: link.utm_parameters,
      targetingRules: link.targeting_rules,
    };
  });

  // Duplicate link
  fastify.post('/api/links/:id/duplicate', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    // Get original link
    const originalLink = await db.query(
      'SELECT * FROM links WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (originalLink.rows.length === 0) {
      throw new Error('Link not found');
    }

    const link = originalLink.rows[0];

    // Generate new short code
    let shortCode = generateShortCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await db.query(
        'SELECT id FROM links WHERE short_code = $1',
        [shortCode]
      );

      if (existing.rows.length === 0) {
        break;
      }

      shortCode = generateShortCode();
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('Unable to generate unique short code');
    }

    // Create duplicate with new short code and "(Copy)" suffix in title
    const title = link.title ? `${link.title} (Copy)` : null;

    const result = await db.query(
      `INSERT INTO links (
        user_id, short_code, original_url, title, description,
        ios_url, android_url, web_fallback_url, utm_parameters, targeting_rules,
        og_title, og_description, og_image_url, og_type,
        attribution_window_hours, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
      [
        link.user_id,
        shortCode,
        link.original_url,
        title,
        link.description,
        link.ios_url,
        link.android_url,
        link.web_fallback_url,
        link.utm_parameters,
        link.targeting_rules,
        link.og_title,
        link.og_description,
        link.og_image_url,
        link.og_type,
        link.attribution_window_hours,
        link.expires_at,
      ]
    );

    const newLink = result.rows[0];
    return {
      ...newLink,
      clickCount: 0,
      utmParameters: newLink.utm_parameters,
      targetingRules: newLink.targeting_rules,
    };
  });

  // Delete link
  fastify.delete('/api/links/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    const result = await db.query(
      'DELETE FROM links WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Link not found');
    }

    return { success: true };
  });
}
