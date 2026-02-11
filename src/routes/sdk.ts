import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/database.js';
import {
  recordInstallEvent,
  generateFingerprintHash,
  storeFingerprintForClick,
  type FingerprintData,
} from '../lib/fingerprint.js';
import { triggerWebhooks } from '../lib/webhook.js';
import { parseUserAgent, getLocationFromIP, detectDevice } from '../lib/utils.js';
import { emitClickEvent } from '../lib/event-emitter.js';

/**
 * SDK Routes - Mobile SDK endpoints for deferred deep linking
 * These endpoints are used by the mobile SDKs to report installs and retrieve attribution data
 */
export async function sdkRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/sdk/v1/install
   * Report app installation and retrieve deferred deep link data
   *
   * Request body:
   * - ipAddress: Client IP (auto-detected if not provided)
   * - userAgent: Client user agent
   * - timezone: Device timezone (e.g., "America/New_York")
   * - language: Device language (e.g., "en-US")
   * - screenWidth: Screen width in pixels
   * - screenHeight: Screen height in pixels
   * - platform: Platform name (e.g., "iOS", "Android")
   * - platformVersion: Platform version (e.g., "15.0")
   * - deviceId: Optional device identifier (IDFA, GAID, etc.)
   * - attributionWindowHours: Optional custom attribution window (default: 168 = 7 days)
   *
   * Response:
   * - installId: UUID of the install event
   * - attributed: Boolean indicating if install was matched to a click
   * - confidenceScore: Confidence score (0-100) if matched
   * - matchedFactors: Array of matched fingerprint factors
   * - deepLinkData: Deep link data if matched (shortCode, URLs, UTM params, etc.)
   */
  fastify.post('/api/sdk/v1/install', async (request, reply) => {
    const schema = z.object({
      ipAddress: z.string().optional(),
      userAgent: z.string(),
      timezone: z.string().optional(),
      language: z.string().optional(),
      screenWidth: z.number().optional(),
      screenHeight: z.number().optional(),
      platform: z.string().optional(),
      platformVersion: z.string().optional(),
      deviceId: z.string().optional(),
      attributionWindowHours: z.number().optional(),
    });

    const body = schema.parse(request.body);

    // Use client-provided IP or fallback to request IP
    const ipAddress = body.ipAddress || request.ip;

    const fingerprintData: FingerprintData = {
      ipAddress,
      userAgent: body.userAgent,
      timezone: body.timezone,
      language: body.language,
      screenWidth: body.screenWidth,
      screenHeight: body.screenHeight,
      platform: body.platform,
      platformVersion: body.platformVersion,
    };

    try {
      const result = await recordInstallEvent(
        fingerprintData,
        body.deviceId,
        body.attributionWindowHours
      );

      return reply.status(200).send({
        installId: result.installId,
        attributed: result.match !== null,
        confidenceScore: result.match?.confidenceScore || 0,
        matchedFactors: result.match?.matchedFactors || [],
        deepLinkData: result.deepLinkData,
      });
    } catch (error: any) {
      fastify.log.error(`Error recording install event: ${error}`);
      return reply.status(500).send({
        error: 'Failed to record install event',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/sdk/v1/attribution/:fingerprint
   * Retrieve attribution data for a specific device fingerprint
   * Used for debugging or delayed attribution lookups
   *
   * Response:
   * - fingerprint: The fingerprint hash
   * - attributed: Boolean indicating if attributed to a click
   * - installEvent: Install event data if found
   * - clickEvent: Matched click event data if attributed
   * - linkData: Link data if attributed
   */
  fastify.get('/api/sdk/v1/attribution/:fingerprint', async (request, reply) => {
    const { fingerprint } = request.params as { fingerprint: string };

    try {
      // Look up install event by fingerprint
      const installResult = await db.query(
        `SELECT
           ie.*,
           l.short_code,
           l.original_url,
           l.ios_url,
           l.android_url,
           l.web_fallback_url,
           l.utm_parameters,
           l.deep_link_parameters
         FROM install_events ie
         LEFT JOIN links l ON ie.link_id = l.id
         WHERE ie.fingerprint_hash = $1
         ORDER BY ie.installed_at DESC
         LIMIT 1`,
        [fingerprint]
      );

      if (installResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'No install event found for this fingerprint',
        });
      }

      const install = installResult.rows[0];
      const attributed = install.link_id !== null;

      let clickData = null;
      if (install.click_id) {
        const clickResult = await db.query(
          `SELECT * FROM click_events WHERE id = $1`,
          [install.click_id]
        );
        if (clickResult.rows.length > 0) {
          clickData = clickResult.rows[0];
        }
      }

      return reply.status(200).send({
        fingerprint,
        attributed,
        installEvent: {
          id: install.id,
          installedAt: install.installed_at,
          firstOpenAt: install.first_open_at,
          confidenceScore: parseFloat(install.confidence_score || '0'),
          deepLinkRetrieved: install.deep_link_retrieved,
        },
        clickEvent: clickData
          ? {
              id: clickData.id,
              clickedAt: clickData.clicked_at,
              deviceType: clickData.device_type,
              platform: clickData.platform,
              countryCode: clickData.country_code,
              city: clickData.city,
            }
          : null,
        linkData: attributed
          ? {
              shortCode: install.short_code,
              originalUrl: install.original_url,
              iosUrl: install.ios_url,
              androidUrl: install.android_url,
              webFallbackUrl: install.web_fallback_url,
              utmParameters: install.utm_parameters,
              deepLinkParameters: install.deep_link_parameters,
            }
          : null,
      });
    } catch (error: any) {
      fastify.log.error(`Error retrieving attribution: ${error}`);
      return reply.status(500).send({
        error: 'Failed to retrieve attribution data',
        message: error.message,
      });
    }
  });

  /**
   * POST /api/sdk/v1/event
   * Track in-app events (purchases, signups, etc.)
   * Used for conversion tracking and webhook triggers
   *
   * Request body:
   * - installId: UUID of the install event
   * - eventName: Name of the event (e.g., "purchase", "signup", "level_complete")
   * - eventData: Optional JSON data associated with the event
   * - timestamp: Optional event timestamp (defaults to now)
   *
   * Response:
   * - eventId: UUID of the tracked event
   * - acknowledged: Boolean confirmation
   */
  fastify.post('/api/sdk/v1/event', async (request, reply) => {
    const schema = z.object({
      installId: z.string().uuid(),
      eventName: z.string(),
      eventData: z.record(z.any()).optional(),
      timestamp: z.string().datetime().optional(),
    });

    const body = schema.parse(request.body);

    try {
      // Verify install exists and get link_id for webhook lookup
      const installCheck = await db.query(
        `SELECT id, link_id FROM install_events WHERE id = $1`,
        [body.installId]
      );

      if (installCheck.rows.length === 0) {
        return reply.status(404).send({
          error: 'Install event not found',
        });
      }

      const install = installCheck.rows[0];
      const eventTimestamp = body.timestamp || new Date().toISOString();

      // Insert event into in_app_events table
      const eventResult = await db.query(
        `INSERT INTO in_app_events (install_id, event_name, event_data, event_timestamp)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          body.installId,
          body.eventName,
          JSON.stringify(body.eventData || {}),
          eventTimestamp,
        ]
      );

      const eventId = eventResult.rows[0].id;

      fastify.log.info({
        eventId,
        installId: body.installId,
        linkId: install.link_id,
        eventName: body.eventName,
        eventData: body.eventData,
        timestamp: eventTimestamp,
      });

      // Trigger conversion_event webhooks if install was attributed to a link
      if (install.link_id) {
        // Query webhooks for the user who owns the link
        const webhooksResult = await db.query(
          `SELECT w.*
           FROM webhooks w
           INNER JOIN links l ON l.user_id = w.user_id
           WHERE l.id = $1 AND w.is_active = true`,
          [install.link_id]
        );

        if (webhooksResult.rows.length > 0) {
          const eventData = {
            eventId,
            installId: body.installId,
            linkId: install.link_id,
            eventName: body.eventName,
            eventData: body.eventData || {},
            timestamp: eventTimestamp,
          };

          // Trigger webhooks asynchronously (fire and forget)
          setImmediate(async () => {
            // Trigger webhooks without delivery logging (basic version)
            // For delivery logging, use @linkforty/cloud premium features
            triggerWebhooks(
              webhooksResult.rows,
              'conversion_event',
              eventId,
              eventData
            ).catch((error) => {
              fastify.log.error('Failed to trigger conversion webhooks:', error);
            });
          });
        }
      }

      return reply.status(200).send({
        eventId,
        acknowledged: true,
      });
    } catch (error: any) {
      fastify.log.error(`Error tracking event: ${error}`);
      return reply.status(500).send({
        error: 'Failed to track event',
        message: error.message,
      });
    }
  });

  /**
   * GET /api/sdk/v1/resolve/:shortCode
   * GET /api/sdk/v1/resolve/:templateSlug/:shortCode
   *
   * Resolve a short link to its deep link data without triggering a redirect.
   * Used by mobile SDKs when the OS intercepts a LinkForty URL via App Links
   * or Universal Links before the server can process the redirect.
   *
   * Also records a click event and stores a device fingerprint for attribution,
   * since the normal redirect flow was bypassed.
   *
   * Query params (optional fingerprint data for click attribution):
   * - fp_tz: Device timezone
   * - fp_lang: Device language
   * - fp_sw: Screen width
   * - fp_sh: Screen height
   * - fp_platform: Platform (ios/android)
   * - fp_pv: Platform version
   *
   * Response:
   * - shortCode: The link's short code
   * - linkId: UUID of the link
   * - deepLinkPath: In-app destination path
   * - appScheme: Custom URI scheme
   * - iosUrl: iOS App Store URL
   * - androidUrl: Android Play Store URL
   * - webUrl: Web fallback URL
   * - utmParameters: UTM tracking parameters
   * - customParameters: Custom deep link parameters (key-value pairs)
   * - clickedAt: Timestamp of this resolution
   */
  async function handleResolve(request: any, reply: any, shortCode: string, templateSlug?: string) {
    let linkData: string | null = null;

    // Build cache key (same pattern as redirect.ts)
    const cacheKey = templateSlug ? `link:${templateSlug}:${shortCode}` : `link:${shortCode}`;

    // Try Redis cache first
    if (fastify.redis) {
      try {
        linkData = await fastify.redis.get(cacheKey);
      } catch (error) {
        fastify.log.warn('Redis cache lookup failed, falling back to database');
      }
    }

    if (!linkData) {
      let query: string;
      let params: any[];

      if (templateSlug) {
        query = `
          SELECT l.* FROM links l
          LEFT JOIN link_templates t ON l.template_id = t.id
          WHERE l.short_code = $1 AND t.slug = $2
          AND l.is_active = true
          AND (l.expires_at IS NULL OR l.expires_at > NOW())
        `;
        params = [shortCode, templateSlug];
      } else {
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

      // Cache for 5 minutes
      if (fastify.redis) {
        try {
          await fastify.redis.setex(cacheKey, 300, linkData);
        } catch (error) {
          fastify.log.warn('Redis cache set failed');
        }
      }
    }

    const link = JSON.parse(linkData);

    // Record click event + fingerprint asynchronously (mirrors redirect.ts pattern)
    setImmediate(async () => {
      try {
        const userAgent = request.headers['user-agent'] || '';
        const ip = request.ip;
        const referrer = request.headers.referer || null;
        const acceptLanguage = request.headers['accept-language'] || '';

        const deviceType = detectDevice(userAgent);
        const { platform, platformVersion } = parseUserAgent(userAgent);
        const { countryCode, countryName, region, city, latitude, longitude, timezone } = getLocationFromIP(ip);

        // Extract fingerprint data from query params (sent by SDK)
        const query = request.query as Record<string, string | undefined>;
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
            query?.utm_source || null,
            query?.utm_medium || null,
            query?.utm_campaign || null,
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

        // Emit click event for real-time streaming
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
          redirectUrl: '',
          redirectReason: 'sdk_resolve',
          targetingMatched: true,
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
              referrer,
            };

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
        fastify.log.error(`Error tracking click from resolve: ${error}`);
      }
    });

    // Return JSON response with deep link data
    return reply.status(200).send({
      shortCode: link.short_code,
      linkId: link.id,
      deepLinkPath: link.deep_link_path || undefined,
      appScheme: link.app_scheme || undefined,
      iosUrl: link.ios_app_store_url || undefined,
      androidUrl: link.android_app_store_url || undefined,
      webUrl: link.web_fallback_url || undefined,
      utmParameters: link.utm_parameters || undefined,
      customParameters: link.deep_link_parameters || undefined,
      clickedAt: new Date().toISOString(),
    });
  }

  fastify.get('/api/sdk/v1/resolve/:shortCode', async (request, reply) => {
    const { shortCode } = request.params as { shortCode: string };
    return handleResolve(request, reply, shortCode);
  });

  fastify.get('/api/sdk/v1/resolve/:templateSlug/:shortCode', async (request, reply) => {
    const { templateSlug, shortCode } = request.params as { templateSlug: string; shortCode: string };
    return handleResolve(request, reply, shortCode, templateSlug);
  });

  /**
   * GET /api/sdk/v1/health
   * Health check endpoint for SDK connectivity testing
   */
  fastify.get('/api/sdk/v1/health', async (request, reply) => {
    return reply.status(200).send({
      status: 'healthy',
      version: 'v1',
      timestamp: new Date().toISOString(),
    });
  });
}
