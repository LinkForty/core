import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { parseUserAgent, getLocationFromIP, buildRedirectUrl, detectDevice } from '../lib/utils.js';
import { storeFingerprintForClick, type FingerprintData } from '../lib/fingerprint.js';
import { emitClickEvent } from '../lib/event-emitter.js';

export async function redirectRoutes(fastify: FastifyInstance) {
  // Helper function to handle the actual redirect logic
  async function handleRedirect(request: any, reply: any, shortCode: string, templateSlug?: string) {
    let linkData: string | null = null;

    // Build cache key (include template if present)
    const cacheKey = templateSlug ? `link:${templateSlug}:${shortCode}` : `link:${shortCode}`;

    // Try to get link from cache if Redis is available
    if (fastify.redis) {
      try {
        linkData = await fastify.redis.get(cacheKey);
      } catch (error) {
        fastify.log.warn('Redis cache lookup failed, falling back to database');
      }
    }

    if (!linkData) {
      // Build query based on whether template slug is provided
      let query: string;
      let params: any[];

      if (templateSlug) {
        // Template-based URL: verify both template and link match
        query = `
          SELECT l.* FROM links l
          LEFT JOIN link_templates t ON l.template_id = t.id
          WHERE l.short_code = $1 AND t.slug = $2
          AND l.is_active = true
          AND (l.expires_at IS NULL OR l.expires_at > NOW())
        `;
        params = [shortCode, templateSlug];
      } else {
        // Legacy URL: just lookup by short code
        query = `
          SELECT * FROM links
          WHERE short_code = $1 AND is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())
        `;
        params = [shortCode];
      }

      const result = await db.query(query, params);

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
        const acceptLanguage = request.headers['accept-language'] || '';

        const deviceType = detectDevice(userAgent);
        const { platform, platformVersion } = parseUserAgent(userAgent);
        const { countryCode, countryName, region, city, latitude, longitude, timezone } = getLocationFromIP(ip);

        // Extract UTM parameters from query string
        const query = request.query as Record<string, string | undefined>;
        const utmSource = query?.utm_source;
        const utmMedium = query?.utm_medium;
        const utmCampaign = query?.utm_campaign;

        // Extract fingerprint data from query params (sent by SDK/client)
        const fpTimezone = query?.fp_tz || timezone || undefined;
        const fpLanguage = query?.fp_lang || acceptLanguage.split(',')[0]?.split(';')[0] || undefined;
        const fpScreenWidth = query?.fp_sw ? parseInt(query.fp_sw, 10) : undefined;
        const fpScreenHeight = query?.fp_sh ? parseInt(query.fp_sh, 10) : undefined;

        // Insert click event
        const clickResult = await db.query(
          `INSERT INTO click_events (
            link_id, ip_address, user_agent, device_type, platform,
            country_code, country_name, region, city, latitude, longitude, timezone,
            utm_source, utm_medium, utm_campaign, referrer
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id`,
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

        const clickId = clickResult.rows[0].id;

        // Store device fingerprint for deferred deep linking
        const fingerprintData: FingerprintData = {
          ipAddress: ip,
          userAgent,
          timezone: fpTimezone,
          language: fpLanguage,
          screenWidth: fpScreenWidth,
          screenHeight: fpScreenHeight,
          platform: deviceType,
          platformVersion,
        };

        await storeFingerprintForClick(clickId, fingerprintData);

        // Determine redirect URL for event emission (using same logic as main redirect)
        let redirectUrl = link.original_url;
        let redirectReason = 'original_url';

        if (deviceType === 'ios') {
          if (link.ios_universal_link) {
            redirectUrl = link.ios_universal_link;
            redirectReason = 'ios_universal_link';
          } else if (link.app_scheme && link.deep_link_path) {
            redirectUrl = `${link.app_scheme}://${link.deep_link_path.replace(/^\//, '')}`;
            redirectReason = 'app_scheme';
          } else if (link.ios_app_store_url) {
            redirectUrl = link.ios_app_store_url;
            redirectReason = 'ios_app_store_url';
          }
        } else if (deviceType === 'android') {
          if (link.android_app_link) {
            redirectUrl = link.android_app_link;
            redirectReason = 'android_app_link';
          } else if (link.app_scheme && link.deep_link_path) {
            redirectUrl = `${link.app_scheme}://${link.deep_link_path.replace(/^\//, '')}`;
            redirectReason = 'app_scheme';
          } else if (link.android_app_store_url) {
            redirectUrl = link.android_app_store_url;
            redirectReason = 'android_app_store_url';
          }
        } else if (deviceType === 'web' && link.web_fallback_url) {
          redirectUrl = link.web_fallback_url;
          redirectReason = 'web_fallback_url';
        }

        const finalRedirectUrl = buildRedirectUrl(redirectUrl, link.utm_parameters);

        // Emit click event for real-time streaming to WebSocket clients
        emitClickEvent({
          eventId: clickId,
          timestamp: new Date().toISOString(),
          linkId: link.id,
          shortCode: link.short_code,
          userId: link.user_id,
          ipAddress: ip,
          userAgent,
          country: countryCode || undefined,
          city: city || undefined,
          deviceType,
          platform: platform || undefined,
          redirectUrl: finalRedirectUrl,
          redirectReason,
          targetingMatched: true, // If we got here, targeting matched
          utmParameters: link.utm_parameters || undefined,
          referer: referrer || undefined,
          language: fpLanguage,
        });

        // Trigger webhooks for click_event
        try {
          const webhooksResult = await db.query(
            'SELECT * FROM webhooks WHERE user_id = $1 AND is_active = true',
            [link.user_id]
          );

          if (webhooksResult.rows.length > 0) {
            const { triggerWebhooks } = await import('../lib/webhook.js');

            const clickEventData = {
              id: clickId,
              linkId: link.id,
              clickedAt: new Date().toISOString(),
              ipAddress: ip,
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
            };

            // Trigger webhooks without delivery logging (basic version)
            // For delivery logging, use @linkforty/cloud premium features
            await triggerWebhooks(
              webhooksResult.rows,
              'click_event',
              clickId,
              clickEventData
            );
          }
        } catch (webhookError) {
          fastify.log.error(`Error triggering click webhooks: ${webhookError}`);
        }
      } catch (error) {
        fastify.log.error(`Error tracking click: ${error}`);
      }
    });

    // Determine redirect URL based on device with smart fallback chain
    const userAgent = request.headers['user-agent'] || '';
    const device = detectDevice(userAgent);

    let redirectUrl = link.original_url;
    let useSchemeUrl = false; // Track if we're using a URI scheme URL

    if (device === 'ios') {
      // iOS Priority:
      // 1. Universal Link (HTTPS URL with AASA file) - if app installed, opens app
      // 2. URI scheme (myapp://path) - fallback when Universal Links fail
      // 3. App Store URL - for users who don't have the app
      // 4. Original URL - ultimate fallback

      if (link.ios_universal_link) {
        redirectUrl = link.ios_universal_link;
      } else if (link.app_scheme && link.deep_link_path) {
        // Build URI scheme URL: myapp://product/123
        redirectUrl = `${link.app_scheme}://${link.deep_link_path.replace(/^\//, '')}`;
        useSchemeUrl = true;
      } else if (link.ios_app_store_url) {
        redirectUrl = link.ios_app_store_url;
      }

    } else if (device === 'android') {
      // Android Priority:
      // 1. App Link (HTTPS URL with Digital Asset Links) - if app installed, opens app
      // 2. URI scheme (myapp://path) - fallback when App Links fail
      // 3. Play Store URL - for users who don't have the app
      // 4. Original URL - ultimate fallback

      if (link.android_app_link) {
        redirectUrl = link.android_app_link;
      } else if (link.app_scheme && link.deep_link_path) {
        // Build URI scheme URL: myapp://product/123
        redirectUrl = `${link.app_scheme}://${link.deep_link_path.replace(/^\//, '')}`;
        useSchemeUrl = true;
      } else if (link.android_app_store_url) {
        redirectUrl = link.android_app_store_url;
      }

    } else if (device === 'web') {
      // Web fallback
      redirectUrl = link.web_fallback_url || link.original_url;
    }

    // Build final URL with parameters
    let finalUrl = redirectUrl;

    if (!useSchemeUrl) {
      // For HTTP(S) URLs, add UTM parameters
      finalUrl = buildRedirectUrl(redirectUrl, link.utm_parameters);

      // Add deep link parameters as query params
      if (link.deep_link_parameters && Object.keys(link.deep_link_parameters).length > 0) {
        try {
          const url = new URL(finalUrl);
          Object.entries(link.deep_link_parameters).forEach(([key, value]) => {
            url.searchParams.set(key, String(value));
          });
          finalUrl = url.toString();
        } catch (error) {
          // If URL parsing fails, continue without deep link parameters
          console.error('Failed to add deep link parameters:', error);
        }
      }
    } else {
      // For URI scheme URLs, append query params differently
      if (link.deep_link_parameters && Object.keys(link.deep_link_parameters).length > 0) {
        const params = new URLSearchParams(
          Object.entries(link.deep_link_parameters).map(([k, v]) => [k, String(v)])
        );
        finalUrl += `?${params.toString()}`;
      }
    }

    // Redirect
    return reply.redirect(302, finalUrl);
  }

  // Template-based shortlink route: /:templateSlug/:shortCode
  fastify.get('/:templateSlug/:shortCode', async (request, reply) => {
    const { templateSlug, shortCode } = request.params as { templateSlug: string; shortCode: string };
    return handleRedirect(request, reply, shortCode, templateSlug);
  });

  // Legacy shortlink route (no template): /:shortCode
  fastify.get('/:shortCode', async (request, reply) => {
    const { shortCode } = request.params as { shortCode: string };
    return handleRedirect(request, reply, shortCode);
  });
}
