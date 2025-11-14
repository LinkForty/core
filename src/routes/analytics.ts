import { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../lib/database.js';

export async function analyticsRoutes(fastify: FastifyInstance) {
  // Get overall analytics for a user
  fastify.get('/api/analytics/overview', async (request: FastifyRequest<{
    Querystring: { userId: string; days?: number }
  }>) => {
    const { userId, days = 30 } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    // Get total and unique clicks
    const clicksResult = await db.query(
      `SELECT
         COUNT(*) as total_clicks,
         COUNT(DISTINCT ip_address) as unique_clicks
       FROM click_events ce
              JOIN links l ON ce.link_id = l.id
       WHERE l.user_id = $1 AND ce.clicked_at >= NOW() - INTERVAL '${days} days'`,
      [userId]
    );

    // Get clicks by date
    const dateResult = await db.query(
      `SELECT
         DATE(ce.clicked_at) as date,
         COUNT(*) as clicks
       FROM click_events ce
         JOIN links l ON ce.link_id = l.id
       WHERE l.user_id = $1 AND ce.clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(ce.clicked_at)
       ORDER BY date`,
      [userId]
    );

    // Get clicks by country
    const countryResult = await db.query(
      `SELECT
         COALESCE(ce.country_code, 'Unknown') as country_code,
         COALESCE(ce.country_name, ce.country_code, 'Unknown') as country,
         COUNT(*) as clicks
       FROM click_events ce
              JOIN links l ON ce.link_id = l.id
       WHERE l.user_id = $1 AND ce.clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY ce.country_code, ce.country_name
       ORDER BY clicks DESC`,
      [userId]
    );

    // Get clicks by device
    const deviceResult = await db.query(
      `SELECT
         COALESCE(ce.device_type, 'Unknown') as device,
         COUNT(*) as clicks
       FROM click_events ce
              JOIN links l ON ce.link_id = l.id
       WHERE l.user_id = $1 AND ce.clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY ce.device_type
       ORDER BY clicks DESC`,
      [userId]
    );

    // Get clicks by platform
    const platformResult = await db.query(
      `SELECT
         COALESCE(ce.platform, 'Unknown') as platform,
         COUNT(*) as clicks
       FROM click_events ce
              JOIN links l ON ce.link_id = l.id
       WHERE l.user_id = $1 AND ce.clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY ce.platform
       ORDER BY clicks DESC`,
      [userId]
    );

    // Get top performing links
    const topLinksResult = await db.query(
      `SELECT
         l.id,
         l.short_code,
         l.title,
         l.original_url,
         COUNT(ce.id) as total_clicks,
         COUNT(DISTINCT ce.ip_address) as unique_clicks
       FROM links l
              LEFT JOIN click_events ce ON l.id = ce.link_id
         AND ce.clicked_at >= NOW() - INTERVAL '${days} days'
       WHERE l.user_id = $1
       GROUP BY l.id
       ORDER BY total_clicks DESC
         LIMIT 10`,
      [userId]
    );

    return {
      totalClicks: parseInt(clicksResult.rows[0]?.total_clicks || '0'),
      uniqueClicks: parseInt(clicksResult.rows[0]?.unique_clicks || '0'),
      clicksByDate: dateResult.rows.map(row => ({
        date: row.date,
        clicks: parseInt(row.clicks),
      })),
      clicksByCountry: countryResult.rows.map(row => ({
        countryCode: row.country_code,
        country: row.country,
        clicks: parseInt(row.clicks),
      })),
      clicksByDevice: deviceResult.rows.map(row => ({
        device: row.device,
        clicks: parseInt(row.clicks),
      })),
      clicksByPlatform: platformResult.rows.map(row => ({
        platform: row.platform,
        clicks: parseInt(row.clicks),
      })),
      topLinks: topLinksResult.rows.map(row => ({
        id: row.id,
        shortCode: row.short_code,
        title: row.title,
        originalUrl: row.original_url,
        totalClicks: parseInt(row.total_clicks),
        uniqueClicks: parseInt(row.unique_clicks),
      })),
    };
  });

  // Get link-specific analytics
  fastify.get('/api/analytics/links/:linkId', async (request: FastifyRequest<{
    Params: { linkId: string };
    Querystring: { userId: string; days?: number };
  }>) => {
    const { linkId } = request.params;
    const { userId, days = 30 } = request.query;

    if (!userId) {
      throw new Error('userId query parameter is required');
    }

    // Verify link ownership
    const linkResult = await db.query(
      'SELECT id FROM links WHERE id = $1 AND user_id = $2',
      [linkId, userId]
    );

    if (linkResult.rows.length === 0) {
      throw new Error('Link not found');
    }

    // Get analytics for specific link
    const clicksResult = await db.query(
      `SELECT
         COUNT(*) as total_clicks,
         COUNT(DISTINCT ip_address) as unique_clicks
       FROM click_events
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '${days} days'`,
      [linkId]
    );

    const dateResult = await db.query(
      `SELECT
         DATE(clicked_at) as date,
         COUNT(*) as clicks
       FROM click_events
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(clicked_at)
       ORDER BY date`,
      [linkId]
    );

    const countryResult = await db.query(
      `SELECT
         COALESCE(country_code, 'Unknown') as country_code,
         COALESCE(country_name, country_code, 'Unknown') as country,
         COUNT(*) as clicks
       FROM click_events
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY country_code, country_name
       ORDER BY clicks DESC`,
      [linkId]
    );

    const deviceResult = await db.query(
      `SELECT
         COALESCE(device_type, 'Unknown') as device,
         COUNT(*) as clicks
       FROM click_events
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY device_type
       ORDER BY clicks DESC`,
      [linkId]
    );

    const platformResult = await db.query(
      `SELECT
         COALESCE(platform, 'Unknown') as platform,
         COUNT(*) as clicks
       FROM click_events
       WHERE link_id = $1 AND clicked_at >= NOW() - INTERVAL '${days} days'
       GROUP BY platform
       ORDER BY clicks DESC`,
      [linkId]
    );

    return {
      totalClicks: parseInt(clicksResult.rows[0]?.total_clicks || '0'),
      uniqueClicks: parseInt(clicksResult.rows[0]?.unique_clicks || '0'),
      clicksByDate: dateResult.rows.map(row => ({
        date: row.date,
        clicks: parseInt(row.clicks),
      })),
      clicksByCountry: countryResult.rows.map(row => ({
        countryCode: row.country_code,
        country: row.country,
        clicks: parseInt(row.clicks),
      })),
      clicksByDevice: deviceResult.rows.map(row => ({
        device: row.device,
        clicks: parseInt(row.clicks),
      })),
      clicksByPlatform: platformResult.rows.map(row => ({
        platform: row.platform,
        clicks: parseInt(row.clicks),
      })),
    };
  });
}
