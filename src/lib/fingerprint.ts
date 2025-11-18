import crypto from 'crypto';
import { db } from './database.js';

/**
 * Device fingerprint data structure
 */
export interface FingerprintData {
  ipAddress: string;
  userAgent: string;
  timezone?: string;
  language?: string;
  screenWidth?: number;
  screenHeight?: number;
  platform?: string;
  platformVersion?: string;
}

/**
 * Fingerprint match result with confidence scoring
 */
export interface FingerprintMatch {
  clickId: string;
  linkId: string;
  confidenceScore: number;
  matchedFactors: string[];
  clickedAt: Date;
}

/**
 * Scoring weights for probabilistic matching
 * Total should equal 100 for percentage-based confidence
 */
const FINGERPRINT_WEIGHTS = {
  IP_ADDRESS: 40,
  USER_AGENT: 30,
  TIMEZONE: 10,
  LANGUAGE: 10,
  SCREEN_RESOLUTION: 10,
};

/**
 * Default attribution window in hours (7 days)
 */
export const DEFAULT_ATTRIBUTION_WINDOW_HOURS = 168;

/**
 * Minimum confidence threshold for attribution (70%)
 */
export const CONFIDENCE_THRESHOLD = 70;

/**
 * Generate a fingerprint hash from device data
 * Uses SHA-256 hash of concatenated device attributes
 */
export function generateFingerprintHash(data: FingerprintData): string {
  const components = [
    data.ipAddress || '',
    data.userAgent || '',
    data.timezone || '',
    data.language || '',
    data.screenWidth?.toString() || '',
    data.screenHeight?.toString() || '',
    data.platform || '',
    data.platformVersion || '',
  ];

  const concatenated = components.join('|');
  return crypto.createHash('sha256').update(concatenated).digest('hex');
}

/**
 * Normalize IP address for comparison
 * Handles IPv4 and IPv6, removes subnet variations
 */
function normalizeIP(ip: string): string {
  if (!ip) return '';

  // For IPv4, use first 3 octets (e.g., 192.168.1.x)
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts.slice(0, 3).join('.');
  }

  // For IPv6, use first 4 groups (e.g., 2001:0db8:85a3:0000:xxxx)
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':');
  }

  return ip;
}

/**
 * Normalize user agent for comparison
 * Extracts key identifiers and removes version numbers
 */
function normalizeUserAgent(ua: string): string {
  if (!ua) return '';

  // Extract platform (iOS, Android, Windows, Mac, Linux)
  const platformMatch = ua.match(/(iPhone|iPad|Android|Windows|Macintosh|Linux)/i);
  const platform = platformMatch ? platformMatch[1] : '';

  // Extract browser (Chrome, Safari, Firefox, Edge)
  const browserMatch = ua.match(/(Chrome|Safari|Firefox|Edge|Opera)/i);
  const browser = browserMatch ? browserMatch[1] : '';

  return `${platform}|${browser}`.toLowerCase();
}

/**
 * Calculate confidence score by comparing two fingerprints
 * Returns a score from 0-100 based on matched components
 */
export function calculateConfidenceScore(
  fingerprint1: FingerprintData,
  fingerprint2: FingerprintData
): { score: number; matchedFactors: string[] } {
  let score = 0;
  const matchedFactors: string[] = [];

  // Compare IP addresses (normalized to /24 subnet for IPv4)
  if (fingerprint1.ipAddress && fingerprint2.ipAddress) {
    const ip1 = normalizeIP(fingerprint1.ipAddress);
    const ip2 = normalizeIP(fingerprint2.ipAddress);

    if (ip1 === ip2) {
      score += FINGERPRINT_WEIGHTS.IP_ADDRESS;
      matchedFactors.push('ip');
    }
  }

  // Compare user agents (normalized to platform + browser)
  if (fingerprint1.userAgent && fingerprint2.userAgent) {
    const ua1 = normalizeUserAgent(fingerprint1.userAgent);
    const ua2 = normalizeUserAgent(fingerprint2.userAgent);

    if (ua1 === ua2) {
      score += FINGERPRINT_WEIGHTS.USER_AGENT;
      matchedFactors.push('user_agent');
    }
  }

  // Compare timezone
  if (fingerprint1.timezone && fingerprint2.timezone) {
    if (fingerprint1.timezone === fingerprint2.timezone) {
      score += FINGERPRINT_WEIGHTS.TIMEZONE;
      matchedFactors.push('timezone');
    }
  }

  // Compare language
  if (fingerprint1.language && fingerprint2.language) {
    // Match first 2 characters (e.g., "en-US" matches "en-GB")
    const lang1 = fingerprint1.language.substring(0, 2).toLowerCase();
    const lang2 = fingerprint2.language.substring(0, 2).toLowerCase();

    if (lang1 === lang2) {
      score += FINGERPRINT_WEIGHTS.LANGUAGE;
      matchedFactors.push('language');
    }
  }

  // Compare screen resolution
  if (
    fingerprint1.screenWidth &&
    fingerprint1.screenHeight &&
    fingerprint2.screenWidth &&
    fingerprint2.screenHeight
  ) {
    if (
      fingerprint1.screenWidth === fingerprint2.screenWidth &&
      fingerprint1.screenHeight === fingerprint2.screenHeight
    ) {
      score += FINGERPRINT_WEIGHTS.SCREEN_RESOLUTION;
      matchedFactors.push('screen');
    }
  }

  return { score, matchedFactors };
}

/**
 * Match an install event to potential click events via probabilistic fingerprinting
 * Returns the best match above confidence threshold within attribution window
 *
 * Note: Uses link-specific attribution windows - each link can have its own window
 */
export async function matchInstallToClick(
  installFingerprint: FingerprintData,
  attributionWindowHours: number = DEFAULT_ATTRIBUTION_WINDOW_HOURS
): Promise<FingerprintMatch | null> {
  // Query recent click events within maximum possible attribution window (90 days)
  // We'll validate against each link's specific window during matching
  const maxWindowHours = 2160; // 90 days
  const cutoffTime = new Date(Date.now() - maxWindowHours * 60 * 60 * 1000);

  const clicksResult = await db.query(
    `SELECT
       ce.id as click_id,
       ce.link_id,
       ce.clicked_at,
       l.attribution_window_hours,
       df.ip_address,
       df.user_agent,
       df.timezone,
       df.language,
       df.screen_width,
       df.screen_height,
       df.platform,
       df.platform_version
     FROM click_events ce
     INNER JOIN device_fingerprints df ON df.click_id = ce.id
     INNER JOIN links l ON ce.link_id = l.id
     WHERE ce.clicked_at >= $1
     ORDER BY ce.clicked_at DESC
     LIMIT 1000`,
    [cutoffTime]
  );

  if (clicksResult.rows.length === 0) {
    return null;
  }

  const installTime = new Date();

  // Calculate confidence score for each potential match
  let bestMatch: FingerprintMatch | null = null;
  let highestScore = 0;

  for (const row of clicksResult.rows) {
    // Check if click is within the link's specific attribution window
    const linkWindowHours = row.attribution_window_hours || DEFAULT_ATTRIBUTION_WINDOW_HOURS;
    const clickTime = new Date(row.clicked_at);
    const timeDiffHours = (installTime.getTime() - clickTime.getTime()) / (1000 * 60 * 60);

    if (timeDiffHours > linkWindowHours) {
      // Click is too old for this link's attribution window, skip it
      continue;
    }

    const clickFingerprint: FingerprintData = {
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      timezone: row.timezone,
      language: row.language,
      screenWidth: row.screen_width,
      screenHeight: row.screen_height,
      platform: row.platform,
      platformVersion: row.platform_version,
    };

    const { score, matchedFactors } = calculateConfidenceScore(
      installFingerprint,
      clickFingerprint
    );

    // Track the best match
    if (score > highestScore && score >= CONFIDENCE_THRESHOLD) {
      highestScore = score;
      bestMatch = {
        clickId: row.click_id,
        linkId: row.link_id,
        confidenceScore: score,
        matchedFactors,
        clickedAt: new Date(row.clicked_at),
      };
    }
  }

  return bestMatch;
}

/**
 * Store device fingerprint for a click event
 */
export async function storeFingerprintForClick(
  clickId: string,
  fingerprintData: FingerprintData
): Promise<void> {
  const fingerprintHash = generateFingerprintHash(fingerprintData);

  await db.query(
    `INSERT INTO device_fingerprints (
      click_id,
      fingerprint_hash,
      ip_address,
      user_agent,
      timezone,
      language,
      screen_width,
      screen_height,
      platform,
      platform_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      clickId,
      fingerprintHash,
      fingerprintData.ipAddress,
      fingerprintData.userAgent,
      fingerprintData.timezone || null,
      fingerprintData.language || null,
      fingerprintData.screenWidth || null,
      fingerprintData.screenHeight || null,
      fingerprintData.platform || null,
      fingerprintData.platformVersion || null,
    ]
  );
}

/**
 * Record an install event and attempt to match it to a click
 */
export async function recordInstallEvent(
  fingerprintData: FingerprintData,
  deviceId?: string,
  attributionWindowHours: number = DEFAULT_ATTRIBUTION_WINDOW_HOURS
): Promise<{
  installId: string;
  match: FingerprintMatch | null;
  deepLinkData: any;
}> {
  const fingerprintHash = generateFingerprintHash(fingerprintData);

  // Attempt to match install to a click
  const match = await matchInstallToClick(fingerprintData, attributionWindowHours);

  // Insert install event
  const installResult = await db.query(
    `INSERT INTO install_events (
      link_id,
      click_id,
      fingerprint_hash,
      confidence_score,
      installed_at,
      first_open_at,
      attribution_window_hours,
      ip_address,
      user_agent,
      timezone,
      language,
      screen_width,
      screen_height,
      platform,
      platform_version,
      device_id,
      deep_link_data
    ) VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING id, deep_link_data`,
    [
      match?.linkId || null,
      match?.clickId || null,
      fingerprintHash,
      match?.confidenceScore || null,
      attributionWindowHours,
      fingerprintData.ipAddress,
      fingerprintData.userAgent,
      fingerprintData.timezone || null,
      fingerprintData.language || null,
      fingerprintData.screenWidth || null,
      fingerprintData.screenHeight || null,
      fingerprintData.platform || null,
      fingerprintData.platformVersion || null,
      deviceId || null,
      match ? JSON.stringify({}) : JSON.stringify({}), // Will be populated from link data
    ]
  );

  const installId = installResult.rows[0].id;
  let deepLinkData = {};

  // If we have a match, retrieve the deep link data from the original link
  if (match) {
    const linkResult = await db.query(
      `SELECT
         short_code,
         original_url,
         ios_url,
         android_url,
         web_fallback_url,
         utm_parameters,
         targeting_rules
       FROM links
       WHERE id = $1`,
      [match.linkId]
    );

    if (linkResult.rows.length > 0) {
      const link = linkResult.rows[0];
      deepLinkData = {
        shortCode: link.short_code,
        originalUrl: link.original_url,
        iosUrl: link.ios_url,
        androidUrl: link.android_url,
        webFallbackUrl: link.web_fallback_url,
        utmParameters: link.utm_parameters,
        targetingRules: link.targeting_rules,
        clickedAt: match.clickedAt,
        confidenceScore: match.confidenceScore,
        matchedFactors: match.matchedFactors,
      };

      // Update the install event with deep link data
      await db.query(
        `UPDATE install_events
         SET deep_link_data = $1,
             deep_link_retrieved = true
         WHERE id = $2`,
        [JSON.stringify(deepLinkData), installId]
      );

      // Trigger webhooks for install_event (only if attributed)
      try {
        // Get the link's user_id for webhook lookup
        const linkUserResult = await db.query(
          'SELECT user_id FROM links WHERE id = $1',
          [match.linkId]
        );

        if (linkUserResult.rows.length > 0) {
          const userId = linkUserResult.rows[0].user_id;

          const webhooksResult = await db.query(
            'SELECT * FROM webhooks WHERE user_id = $1 AND is_active = true',
            [userId]
          );

          if (webhooksResult.rows.length > 0) {
            const { triggerWebhooks } = await import('./webhook.js');

            const installEventData = {
              id: installId,
              linkId: match.linkId,
              fingerprintHash,
              confidenceScore: match.confidenceScore,
              installedAt: new Date().toISOString(),
              deepLinkData,
              ipAddress: fingerprintData.ipAddress,
              userAgent: fingerprintData.userAgent,
              platform: fingerprintData.platform,
            };

            // Trigger webhooks without delivery logging (basic version)
            // For delivery logging, use @linkforty/cloud premium features
            await triggerWebhooks(
              webhooksResult.rows,
              'install_event',
              installId,
              installEventData
            );
          }
        }
      } catch (webhookError) {
        console.error(`Error triggering install webhooks: ${webhookError}`);
      }
    }
  }

  return {
    installId,
    match,
    deepLinkData,
  };
}
