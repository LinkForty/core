import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/database.js';
import { customAlphabet } from 'nanoid';

const generateSlug = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const createTemplateSchema = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().min(1, 'Template name is required').max(255, 'Name must be less than 255 characters'),
  description: z.string().optional(),
  settings: z.object({
    defaultIosUrl: z.string().url('iOS URL must be a valid URL').optional(),
    defaultAndroidUrl: z.string().url('Android URL must be a valid URL').optional(),
    defaultWebFallbackUrl: z.string().url('Web Fallback URL must be a valid URL').optional(),
    defaultAttributionWindowHours: z.number()
      .min(1, 'Attribution window must be at least 1 hour')
      .max(2160, 'Attribution window cannot exceed 2160 hours (90 days)')
      .optional(),
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
    expiresAfterDays: z.number().optional(),
  }).optional(),
  isDefault: z.boolean().default(false),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255, 'Name must be less than 255 characters').optional(),
  description: z.string().optional(),
  settings: z.object({
    defaultIosUrl: z.string().url('iOS URL must be a valid URL').optional(),
    defaultAndroidUrl: z.string().url('Android URL must be a valid URL').optional(),
    defaultWebFallbackUrl: z.string().url('Web Fallback URL must be a valid URL').optional(),
    defaultAttributionWindowHours: z.number()
      .min(1, 'Attribution window must be at least 1 hour')
      .max(2160, 'Attribution window cannot exceed 2160 hours (90 days)')
      .optional(),
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
    expiresAfterDays: z.number().optional(),
  }).optional(),
  isDefault: z.boolean().optional(),
});

export async function templateRoutes(fastify: FastifyInstance) {
  // Get all templates (optionally filtered by userId)
  fastify.get('/api/templates', async (request: FastifyRequest<{
    Querystring: { userId?: string }
  }>) => {
    const { userId } = request.query;

    let query: string;
    let params: any[];

    if (userId) {
      query = `
        SELECT id, user_id, name, slug, description, settings, is_default, created_at, updated_at
        FROM link_templates
        WHERE user_id = $1
        ORDER BY is_default DESC, name ASC
      `;
      params = [userId];
    } else {
      query = `
        SELECT id, user_id, name, slug, description, settings, is_default, created_at, updated_at
        FROM link_templates
        ORDER BY is_default DESC, name ASC
      `;
      params = [];
    }

    const result = await db.query(query, params);
    return result.rows;
  });

  // Get single template
  fastify.get('/api/templates/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId?: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    let result;
    if (userId) {
      result = await db.query(
        `SELECT id, user_id, name, slug, description, settings, is_default, created_at, updated_at
         FROM link_templates
         WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
    } else {
      result = await db.query(
        `SELECT id, user_id, name, slug, description, settings, is_default, created_at, updated_at
         FROM link_templates
         WHERE id = $1`,
        [id]
      );
    }

    if (result.rows.length === 0) {
      throw new Error('Template not found');
    }

    return result.rows[0];
  });

  // Create template
  fastify.post('/api/templates', async (request) => {
    const data = createTemplateSchema.parse(request.body);

    // Generate unique slug
    let slug = generateSlug();
    let attempts = 0;

    while (attempts < 10) {
      const existing = await db.query(
        'SELECT id FROM link_templates WHERE slug = $1',
        [slug]
      );

      if (existing.rows.length === 0) {
        break;
      }

      slug = generateSlug();
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('Unable to generate unique template slug. Please try again.');
    }

    // If setting as default, unset other defaults
    if (data.isDefault) {
      if (data.userId) {
        await db.query(
          'UPDATE link_templates SET is_default = false WHERE user_id = $1',
          [data.userId]
        );
      } else {
        await db.query(
          'UPDATE link_templates SET is_default = false WHERE user_id IS NULL'
        );
      }
    }

    const result = await db.query(
      `INSERT INTO link_templates (
        user_id, name, slug, description, settings, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, name, slug, description, settings, is_default, created_at, updated_at`,
      [
        data.userId || null,
        data.name,
        slug,
        data.description || null,
        JSON.stringify(data.settings || {}),
        data.isDefault,
      ]
    );

    return result.rows[0];
  });

  // Update template
  fastify.put('/api/templates/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId?: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;
    const data = updateTemplateSchema.parse(request.body);

    // Verify template exists
    let existingResult;
    if (userId) {
      existingResult = await db.query(
        'SELECT id FROM link_templates WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    } else {
      existingResult = await db.query(
        'SELECT id FROM link_templates WHERE id = $1',
        [id]
      );
    }

    if (existingResult.rows.length === 0) {
      throw new Error('Template not found');
    }

    // If setting as default, unset other defaults
    if (data.isDefault) {
      if (userId) {
        await db.query(
          'UPDATE link_templates SET is_default = false WHERE user_id = $1 AND id != $2',
          [userId, id]
        );
      } else {
        await db.query(
          'UPDATE link_templates SET is_default = false WHERE id != $1',
          [id]
        );
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      values.push(data.name);
      paramIndex++;
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex}`);
      values.push(data.description);
      paramIndex++;
    }

    if (data.settings !== undefined) {
      updates.push(`settings = $${paramIndex}`);
      values.push(JSON.stringify(data.settings));
      paramIndex++;
    }

    if (data.isDefault !== undefined) {
      updates.push(`is_default = $${paramIndex}`);
      values.push(data.isDefault);
      paramIndex++;
    }

    if (updates.length === 0) {
      throw new Error('No updates provided');
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    let whereClause = `WHERE id = $${paramIndex}`;
    if (userId) {
      values.push(userId);
      whereClause += ` AND user_id = $${paramIndex + 1}`;
    }

    const result = await db.query(
      `UPDATE link_templates
       SET ${updates.join(', ')}
       ${whereClause}
       RETURNING id, user_id, name, slug, description, settings, is_default, created_at, updated_at`,
      values
    );

    return result.rows[0];
  });

  // Delete template
  fastify.delete('/api/templates/:id', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId?: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    // Check if template has any links
    const linksCount = await db.query(
      'SELECT COUNT(*) as count FROM links WHERE template_id = $1',
      [id]
    );

    if (parseInt(linksCount.rows[0].count) > 0) {
      throw new Error('Cannot delete template that has links assigned to it. Please reassign or delete the links first.');
    }

    let result;
    if (userId) {
      result = await db.query(
        'DELETE FROM link_templates WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );
    } else {
      result = await db.query(
        'DELETE FROM link_templates WHERE id = $1 RETURNING id',
        [id]
      );
    }

    if (result.rows.length === 0) {
      throw new Error('Template not found');
    }

    return { success: true };
  });

  // Set template as default
  fastify.put('/api/templates/:id/set-default', async (request: FastifyRequest<{
    Params: { id: string };
    Querystring: { userId?: string };
  }>) => {
    const { id } = request.params;
    const { userId } = request.query;

    // Verify template exists
    let existingResult;
    if (userId) {
      existingResult = await db.query(
        'SELECT id FROM link_templates WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    } else {
      existingResult = await db.query(
        'SELECT id FROM link_templates WHERE id = $1',
        [id]
      );
    }

    if (existingResult.rows.length === 0) {
      throw new Error('Template not found');
    }

    // Unset all defaults (scoped by userId if provided)
    if (userId) {
      await db.query(
        'UPDATE link_templates SET is_default = false WHERE user_id = $1',
        [userId]
      );
    } else {
      await db.query(
        'UPDATE link_templates SET is_default = false'
      );
    }

    // Set new default
    const result = await db.query(
      `UPDATE link_templates
       SET is_default = true, updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id, name, slug, description, settings, is_default, created_at, updated_at`,
      [id]
    );

    return result.rows[0];
  });
}
