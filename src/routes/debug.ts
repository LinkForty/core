import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../lib/database.js';
import { detectDevice } from '../lib/utils.js';
import { subscribeToClickEvents, ClickEventData } from '../lib/event-emitter.js';

/**
 * Device simulation request schema
 */
const simulateRequestSchema = z.object({
  linkId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  deviceType: z.enum(['ios', 'android', 'web']).optional(),
  userAgent: z.string().optional(),
  country: z.string().length(2).optional(), // ISO country code
  language: z.string().optional(), // e.g., "en", "es", "fr"
  ipAddress: z.string().ip().optional(),
});

type SimulateRequest = z.infer<typeof simulateRequestSchema>;

/**
 * Debugging routes for testing and validation
 * Premium Cloud-only feature
 */
export async function debugRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/debug/simulate
   * Simulate a link click with custom device parameters
   * Returns detailed information about redirect decision without logging
   */
  fastify.post('/api/debug/simulate', async (request: FastifyRequest) => {
    const data = simulateRequestSchema.parse(request.body);

    // Fetch the link
    let linkResult;
    if (data.userId) {
      linkResult = await db.query(
        `SELECT * FROM links WHERE id = $1 AND user_id = $2`,
        [data.linkId, data.userId]
      );
    } else {
      linkResult = await db.query(
        `SELECT * FROM links WHERE id = $1`,
        [data.linkId]
      );
    }

    if (linkResult.rows.length === 0) {
      throw new Error('Link not found');
    }

    const link = linkResult.rows[0];

    // Determine device type
    let deviceType: 'ios' | 'android' | 'web';
    if (data.deviceType) {
      deviceType = data.deviceType;
    } else if (data.userAgent) {
      deviceType = detectDevice(data.userAgent);
    } else {
      deviceType = 'web'; // Default
    }

    // Simulate targeting rules evaluation
    const targetingRules = link.targeting_rules || {};
    const simulatedCountry = data.country || 'US';
    const simulatedLanguage = data.language || 'en';

    let targetingMatched = true;
    const targetingDetails: {
      countryMatch: boolean | null;
      deviceMatch: boolean | null;
      languageMatch: boolean | null;
    } = {
      countryMatch: null,
      deviceMatch: null,
      languageMatch: null,
    };

    // Check country targeting
    if (targetingRules.countries && targetingRules.countries.length > 0) {
      targetingDetails.countryMatch = targetingRules.countries.includes(simulatedCountry);
      if (!targetingDetails.countryMatch) {
        targetingMatched = false;
      }
    }

    // Check device targeting
    if (targetingRules.devices && targetingRules.devices.length > 0) {
      targetingDetails.deviceMatch = targetingRules.devices.includes(deviceType);
      if (!targetingDetails.deviceMatch) {
        targetingMatched = false;
      }
    }

    // Check language targeting
    if (targetingRules.languages && targetingRules.languages.length > 0) {
      const primaryLang = simulatedLanguage.split('-')[0];
      targetingDetails.languageMatch = targetingRules.languages.some(
        (lang: string) => lang.toLowerCase().startsWith(primaryLang.toLowerCase())
      );
      if (!targetingDetails.languageMatch) {
        targetingMatched = false;
      }
    }

    // Determine redirect URL based on device type
    let redirectUrl = link.original_url;
    let redirectReason = 'original_url (default)';

    if (deviceType === 'ios' && link.ios_url) {
      redirectUrl = link.ios_url;
      redirectReason = 'ios_url (iOS device detected)';
    } else if (deviceType === 'android' && link.android_url) {
      redirectUrl = link.android_url;
      redirectReason = 'android_url (Android device detected)';
    } else if (deviceType === 'web' && link.web_fallback_url) {
      redirectUrl = link.web_fallback_url;
      redirectReason = 'web_fallback_url (Web device detected)';
    }

    // Add UTM parameters if present
    let finalUrl = redirectUrl;
    const utmParameters = link.utm_parameters || {};
    if (Object.keys(utmParameters).length > 0) {
      const url = new URL(redirectUrl);
      if (utmParameters.source) url.searchParams.set('utm_source', utmParameters.source);
      if (utmParameters.medium) url.searchParams.set('utm_medium', utmParameters.medium);
      if (utmParameters.campaign) url.searchParams.set('utm_campaign', utmParameters.campaign);
      if (utmParameters.term) url.searchParams.set('utm_term', utmParameters.term);
      if (utmParameters.content) url.searchParams.set('utm_content', utmParameters.content);
      finalUrl = url.toString();
    }

    // Return detailed simulation results
    return {
      simulation: {
        linkId: link.id,
        shortCode: link.short_code,
        title: link.title,
        isActive: link.is_active,
        expiresAt: link.expires_at,
      },
      input: {
        deviceType: data.deviceType || 'auto-detected',
        userAgent: data.userAgent || 'Not provided',
        country: simulatedCountry,
        language: simulatedLanguage,
        ipAddress: data.ipAddress || 'Not provided',
      },
      detection: {
        detectedDevice: deviceType,
        detectionMethod: data.deviceType
          ? 'manual (provided in request)'
          : data.userAgent
          ? 'user-agent parsing'
          : 'default (web)',
      },
      targeting: {
        hasRules: Object.keys(targetingRules).length > 0,
        rules: targetingRules,
        matched: targetingMatched,
        details: targetingDetails,
      },
      redirect: {
        wouldRedirect: link.is_active && targetingMatched,
        finalUrl: targetingMatched ? finalUrl : null,
        redirectReason: targetingMatched ? redirectReason : 'Targeting rules not matched',
        utmParametersAdded: Object.keys(utmParameters).length > 0,
        utmParameters: utmParameters,
      },
      warnings: [
        ...(!link.is_active ? ['Link is inactive - would return 404'] : []),
        ...(link.expires_at && new Date(link.expires_at) < new Date()
          ? ['Link has expired - would return 404']
          : []),
        ...(!targetingMatched ? ['Targeting rules not matched - would return 404'] : []),
      ],
    };
  });

  /**
   * GET /api/debug/user-agents
   * Get a list of common User-Agent strings for testing
   */
  fastify.get('/api/debug/user-agents', async () => {
    return {
      ios: [
        {
          name: 'iPhone 15 Pro - iOS 17 - Safari',
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          device: 'ios',
        },
        {
          name: 'iPhone 14 - iOS 16 - Safari',
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          device: 'ios',
        },
        {
          name: 'iPad Pro - iOS 17 - Safari',
          userAgent:
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          device: 'ios',
        },
      ],
      android: [
        {
          name: 'Samsung Galaxy S23 - Android 13 - Chrome',
          userAgent:
            'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
          device: 'android',
        },
        {
          name: 'Google Pixel 8 - Android 14 - Chrome',
          userAgent:
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
          device: 'android',
        },
        {
          name: 'OnePlus 11 - Android 13 - Chrome',
          userAgent:
            'Mozilla/5.0 (Linux; Android 13; CPH2449) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
          device: 'android',
        },
      ],
      web: [
        {
          name: 'Chrome on Windows',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
          device: 'web',
        },
        {
          name: 'Safari on macOS',
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          device: 'web',
        },
        {
          name: 'Firefox on Linux',
          userAgent:
            'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
          device: 'web',
        },
      ],
    };
  });

  /**
   * GET /api/debug/countries
   * Get a list of common countries for testing
   */
  fastify.get('/api/debug/countries', async () => {
    return {
      countries: [
        { code: 'US', name: 'United States' },
        { code: 'GB', name: 'United Kingdom' },
        { code: 'CA', name: 'Canada' },
        { code: 'AU', name: 'Australia' },
        { code: 'DE', name: 'Germany' },
        { code: 'FR', name: 'France' },
        { code: 'ES', name: 'Spain' },
        { code: 'IT', name: 'Italy' },
        { code: 'JP', name: 'Japan' },
        { code: 'CN', name: 'China' },
        { code: 'IN', name: 'India' },
        { code: 'BR', name: 'Brazil' },
        { code: 'MX', name: 'Mexico' },
        { code: 'KR', name: 'South Korea' },
        { code: 'SG', name: 'Singapore' },
      ],
    };
  });

  /**
   * GET /api/debug/languages
   * Get a list of common languages for testing
   */
  fastify.get('/api/debug/languages', async () => {
    return {
      languages: [
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' },
        { code: 'de', name: 'German' },
        { code: 'it', name: 'Italian' },
        { code: 'pt', name: 'Portuguese' },
        { code: 'ja', name: 'Japanese' },
        { code: 'zh', name: 'Chinese' },
        { code: 'ko', name: 'Korean' },
        { code: 'ar', name: 'Arabic' },
        { code: 'ru', name: 'Russian' },
        { code: 'hi', name: 'Hindi' },
      ],
    };
  });

  /**
   * WebSocket: /api/debug/live
   * Real-time click event streaming
   * Clients can subscribe to live click events filtered by userId and optionally linkId
   */
  (fastify as any).get(
    '/api/debug/live',
    { websocket: true },
    (connection: any, request: FastifyRequest<{
      Querystring: { userId?: string; linkId?: string };
    }>) => {
      const { userId, linkId } = request.query;

      // Send welcome message
      connection.socket.send(
        JSON.stringify({
          type: 'connected',
          message: 'Connected to live request inspector',
          filters: {
            userId: userId || 'all',
            linkId: linkId || 'all',
          },
        })
      );

      // Subscribe to click events
      const unsubscribe = subscribeToClickEvents((eventData: ClickEventData) => {
        // Filter by userId if provided
        if (userId && eventData.userId !== userId) {
          return;
        }

        // Filter by linkId if provided
        if (linkId && eventData.linkId !== linkId) {
          return;
        }

        // Send event to client
        try {
          connection.socket.send(
            JSON.stringify({
              type: 'click_event',
              data: eventData,
            })
          );
        } catch (error: any) {
          console.error('Failed to send WebSocket message:', error);
        }
      });

      // Handle client disconnect
      connection.socket.on('close', () => {
        unsubscribe();
      });

      // Handle errors
      connection.socket.on('error', (error: any) => {
        console.error('WebSocket error:', error);
        unsubscribe();
      });
    }
  );
}
