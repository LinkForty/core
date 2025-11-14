import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { parseUserAgent, getLocationFromIP, buildRedirectUrl, detectDevice } from '../lib/utils.js';

export async function redirectRoutes(fastify: FastifyInstance) {
  // Handle short link redirects
  fastify.get('/:shortCode', async (request, reply) => {
    const { shortCode } = request.params as { shortCode: string };

    let linkData: string | null = null;

    // Try to get link from cache if Redis is available
    const cacheKey = `link:${shortCode}`;
    if (fastify.redis) {
      try {
        linkData = await fastify.redis.get(cacheKey);
      } catch (error) {
        fastify.log.warn('Redis cache lookup failed, falling back to database');
      }
    }

    if (!linkData) {
      // Get from database
      const result = await db.query(
        `SELECT * FROM links
         WHERE short_code = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [shortCode]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Link not found' });
      }

      linkData = JSON.stringify(result.rows[0]);

      // Cache for 5 minutes if Redis is available
      if (fastify.redis) {
        try {
          await fastify.redis.setex(cacheKey, 300, linkData);
        } catch (error) {
          fastify.log.warn('Redis cache set failed');
        }
      }
    }

    const link = JSON.parse(linkData);

    // Check targeting rules BEFORE redirecting
    if (link.targeting_rules) {
      const userAgent = request.headers['user-agent'] || '';
      const ip = request.ip;
      const acceptLanguage = request.headers['accept-language'] || '';

      // Get user's actual data for targeting checks
      const device = detectDevice(userAgent);
      const { countryCode } = getLocationFromIP(ip);

      // Extract primary language from accept-language header (e.g., "en-US,en;q=0.9" -> "en")
      const primaryLanguage = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase();

      const rules = link.targeting_rules;
      let isTargeted = true;

      // Check country targeting
      if (rules.countries && rules.countries.length > 0) {
        const targetCountries = rules.countries.map((c: string) => c.toUpperCase());
        if (!countryCode || !targetCountries.includes(countryCode.toUpperCase())) {
          isTargeted = false;
        }
      }

      // Check device targeting
      if (rules.devices && rules.devices.length > 0) {
        if (!rules.devices.includes(device)) {
          isTargeted = false;
        }
      }

      // Check language targeting
      if (rules.languages && rules.languages.length > 0) {
        const targetLanguages = rules.languages.map((l: string) => l.toLowerCase());
        if (!primaryLanguage || !targetLanguages.includes(primaryLanguage)) {
          isTargeted = false;
        }
      }

      // If targeting rules exist but user doesn't match, return 404
      if (!isTargeted) {
        return reply.status(404).send({ error: 'Link not found' });
      }
    }

    // Track click asynchronously
    setImmediate(async () => {
      try {
        const userAgent = request.headers['user-agent'] || '';
        const ip = request.ip;
        const referrer = request.headers.referer || null;

        const { deviceType, platform } = parseUserAgent(userAgent);
        const { countryCode, countryName, region, city, latitude, longitude, timezone } = getLocationFromIP(ip);

        // Extract UTM parameters from query string
        const query = request.query as Record<string, string | undefined>;
        const utmSource = query?.utm_source;
        const utmMedium = query?.utm_medium;
        const utmCampaign = query?.utm_campaign;

        await db.query(
          `INSERT INTO click_events (
            link_id, ip_address, user_agent, device_type, platform,
            country_code, country_name, region, city, latitude, longitude, timezone,
            utm_source, utm_medium, utm_campaign, referrer
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            link.id,
            ip,
            userAgent,
            deviceType,
            platform,
            countryCode,
            countryName,
            region,
            city,
            latitude,
            longitude,
            timezone,
            utmSource,
            utmMedium,
            utmCampaign,
            referrer,
          ]
        );
      } catch (error) {
        fastify.log.error(`Error tracking click: ${error}`);
      }
    });

    // Determine redirect URL based on device
    const userAgent = request.headers['user-agent'] || '';
    const device = detectDevice(userAgent);

    let redirectUrl = link.original_url;

    // Check for device-specific URLs
    if (device === 'ios' && link.ios_url) {
      redirectUrl = link.ios_url;
    } else if (device === 'android' && link.android_url) {
      redirectUrl = link.android_url;
    } else if (link.web_fallback_url && device === 'web') {
      redirectUrl = link.web_fallback_url;
    }

    // Add UTM parameters
    const finalUrl = buildRedirectUrl(redirectUrl, link.utm_parameters);

    // Redirect
    return reply.redirect(302, finalUrl);
  });
}
