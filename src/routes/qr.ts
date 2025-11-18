import { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { db } from '../lib/database.js';

/**
 * QR Code Routes - Generate QR codes for links
 */
export async function qrRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/links/:id/qr
   * Generate QR code for a link
   *
   * Query parameters:
   * - format: 'png' | 'svg' (default: 'png')
   * - size: number 128-2048 (default: 512)
   * - color: hex color for foreground (default: '#000000')
   * - bgcolor: hex color for background (default: '#ffffff')
   *
   * Returns: QR code image (PNG or SVG)
   */
  fastify.get('/api/links/:id/qr', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;

    const format = (query.format || 'png') as 'png' | 'svg';
    const size = Math.min(Math.max(parseInt(query.size || '512', 10), 128), 2048);
    const color = query.color || '#000000';
    const bgcolor = query.bgcolor || '#ffffff';

    // Validate format
    if (!['png', 'svg'].includes(format)) {
      return reply.status(400).send({ error: 'Invalid format. Use "png" or "svg".' });
    }

    // Build cache key
    const cacheKey = `qr:${id}:${format}:${size}:${color}:${bgcolor}`;

    // Try to get from cache
    if (fastify.redis) {
      try {
        const cached = await fastify.redis.get(cacheKey);
        if (cached) {
          fastify.log.info(`QR code cache hit: ${cacheKey}`);

          if (format === 'png') {
            // Cached PNG is base64
            const buffer = Buffer.from(cached, 'base64');
            return reply
              .type('image/png')
              .header('Cache-Control', 'public, max-age=86400') // 24 hours
              .send(buffer);
          } else {
            // Cached SVG is text
            return reply
              .type('image/svg+xml')
              .header('Cache-Control', 'public, max-age=86400')
              .send(cached);
          }
        }
      } catch (error) {
        fastify.log.warn('Redis QR cache lookup failed');
      }
    }

    // Get link from database
    const result = await db.query(
      'SELECT short_code, original_url FROM links WHERE id = $1 AND is_active = true',
      [id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Link not found' });
    }

    const link = result.rows[0];

    // Build short URL (use original_url as fallback if short_code not available)
    // In production, you'd want to use your actual domain
    const shortUrl = link.short_code
      ? `${request.protocol}://${request.hostname}/${link.short_code}`
      : link.original_url;

    try {
      // QR code options
      const options = {
        errorCorrectionLevel: 'M' as const, // Medium error correction
        margin: 1, // Quiet zone margin
        width: size,
        color: {
          dark: color,
          light: bgcolor,
        },
      };

      if (format === 'png') {
        // Generate PNG as buffer
        const buffer = await QRCode.toBuffer(shortUrl, options);

        // Cache as base64
        if (fastify.redis) {
          try {
            await fastify.redis.setex(cacheKey, 86400, buffer.toString('base64')); // 24 hour TTL
          } catch (error) {
            fastify.log.warn('Failed to cache QR code');
          }
        }

        return reply
          .type('image/png')
          .header('Cache-Control', 'public, max-age=86400')
          .header('Content-Disposition', `inline; filename="qr-${link.short_code || 'code'}.png"`)
          .send(buffer);
      } else {
        // Generate SVG as string
        const svg = await QRCode.toString(shortUrl, {
          ...options,
          type: 'svg',
        });

        // Cache SVG text
        if (fastify.redis) {
          try {
            await fastify.redis.setex(cacheKey, 86400, svg);
          } catch (error) {
            fastify.log.warn('Failed to cache QR code');
          }
        }

        return reply
          .type('image/svg+xml')
          .header('Cache-Control', 'public, max-age=86400')
          .header('Content-Disposition', `inline; filename="qr-${link.short_code || 'code'}.svg"`)
          .send(svg);
      }
    } catch (error: any) {
      fastify.log.error(`QR code generation failed: ${error.message}`);
      return reply.status(500).send({
        error: 'Failed to generate QR code',
        message: error.message
      });
    }
  });
}
