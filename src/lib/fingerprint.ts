import crypto from 'crypto';
import { db } from './database.js';
import { toDeepLinkPayload, type DeepLinkPayload } from './deep-link-payload.js';

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
 * How the USER_AGENT weight is split when an SDK fingerprint is compared against
 * a browser fingerprint. The two never produce comparable user agent strings, so
 * platform and OS version stand in for them. Sums to USER_AGENT.
 */
const CROSS_CONTEXT_WEIGHTS = {
  PLATFORM: 20,
  PLATFORM_VERSION: 10,
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
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function inCidr4(ipInt: number, baseIp: string, prefix: number): boolean {
  const base = ipv4ToInt(baseIp);
  if (base === null) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

// Shared / non-routable IPv4 ranges that can't identify a single device:
// carrier-grade NAT, RFC1918 private, loopback, link-local, etc. Two different
// users routinely share these (mobile carrier NAT, office Wi-Fi, VPN egress).
const NON_ATTRIBUTABLE_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT (RFC 6598)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
];

/**
 * Whether an IP is specific enough to use as an attribution signal. Returns
 * false for shared/non-routable ranges (CGNAT, RFC1918, loopback, link-local,
 * IPv6 ULA/link-local) where the IP does NOT identify a single device, so it
 * must not contribute to a fingerprint match. Public IPs return true.
 */
export function isAttributableIp(ip: string): boolean {
  if (!ip) return false;
  let addr = ip.trim();
  if (addr.startsWith('::ffff:')) addr = addr.slice(7); // IPv4-mapped IPv6

  // IPv4
  if (addr.includes('.') && !addr.includes(':')) {
    const n = ipv4ToInt(addr);
    if (n === null) return false;
    return !NON_ATTRIBUTABLE_V4.some(([base, prefix]) => inCidr4(n, base, prefix));
  }

  // IPv6
  if (addr.includes(':')) {
    const low = addr.toLowerCase();
    if (low === '::' || low === '::1') return false; // unspecified / loopback
    if (low.startsWith('fc') || low.startsWith('fd')) return false; // fc00::/7 ULA
    if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) {
      return false; // fe80::/10 link-local
    }
    return true;
  }

  // Not a recognizable IPv4 or IPv6 address.
  return false;
}

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
 * Matches the user agent the mobile SDKs generate, e.g. "MyApp/1.2.0 iOS/17.5"
 * or "MyApp/1.2.0 Android/14". Browser user agents never end this way.
 */
const SDK_USER_AGENT = /\s(iOS|Android)\/([0-9][0-9._]*)\s*$/i;

/**
 * Parse an SDK-generated user agent. Returns null for browser user agents.
 */
function parseSdkUserAgent(ua: string): { platform: string; version: string } | null {
  const match = ua.match(SDK_USER_AGENT);
  if (!match) return null;

  return { platform: match[1].toLowerCase(), version: match[2] };
}

/**
 * Reduce the spellings of a platform used by the SDKs, the redirect handler and
 * the UA parser to a single token.
 */
function normalizePlatform(value: string): string {
  const platform = value.toLowerCase();

  if (/iphone|ipad|ipod|^ios$/.test(platform)) return 'ios';
  if (platform.includes('android')) return 'android';
  if (platform.includes('macintosh') || platform.includes('mac os')) return 'macos';
  if (platform.includes('windows')) return 'windows';

  return platform;
}

/**
 * Best-effort platform for a fingerprint: the stored platform if it names one,
 * otherwise whatever the user agent reveals.
 */
function platformOf(fingerprint: FingerprintData): string {
  const stored = normalizePlatform(fingerprint.platform || '');
  if (stored && stored !== 'web' && stored !== 'unknown') {
    return stored;
  }

  const match = (fingerprint.userAgent || '').match(
    /(iPhone|iPad|iPod|Android|Windows|Macintosh|Linux)/i
  );

  return match ? normalizePlatform(match[1]) : '';
}

/**
 * Major version only. Safari reports the OS version less precisely than
 * UIDevice.systemVersion does, so comparing point releases produces false misses.
 */
function majorVersion(value?: string): string {
  return (value || '').split(/[._]/)[0] || '';
}

/**
 * Whether two screen sizes describe the same display.
 *
 * Browsers report CSS pixels while the SDKs report native pixels, so across
 * those two contexts the dimensions differ by the device pixel ratio. The ratio
 * applies equally to both axes, which is what distinguishes a scaled match from
 * two genuinely different screens.
 */
function screensMatch(
  fingerprint1: FingerprintData,
  fingerprint2: FingerprintData,
  crossContext: boolean
): boolean {
  const width1 = fingerprint1.screenWidth!;
  const height1 = fingerprint1.screenHeight!;
  const width2 = fingerprint2.screenWidth!;
  const height2 = fingerprint2.screenHeight!;

  if (width1 === width2 && height1 === height2) {
    return true;
  }

  if (!crossContext) {
    return false;
  }

  const widthRatio = width1 > width2 ? width1 / width2 : width2 / width1;
  const heightRatio = height1 > height2 ? height1 / height2 : height2 / height1;

  // Device pixel ratios run from 1x to 4x.
  return widthRatio <= 4 && Math.abs(widthRatio - heightRatio) < 0.02;
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

  // Compare IP addresses (normalized to /24 subnet for IPv4). Only count IPs
  // that actually identify a device — shared/NAT ranges (CGNAT, RFC1918, etc.)
  // are skipped so unrelated users behind the same NAT can't match on IP.
  if (
    fingerprint1.ipAddress &&
    fingerprint2.ipAddress &&
    isAttributableIp(fingerprint1.ipAddress) &&
    isAttributableIp(fingerprint2.ipAddress)
  ) {
    const ip1 = normalizeIP(fingerprint1.ipAddress);
    const ip2 = normalizeIP(fingerprint2.ipAddress);

    if (ip1 === ip2) {
      score += FINGERPRINT_WEIGHTS.IP_ADDRESS;
      matchedFactors.push('ip');
    }
  }

  // Compare user agents. A deferred install pairs an SDK user agent with the
  // browser user agent captured at click time, and those two can never be equal
  // — the SDK string carries neither a browser nor a platform token. Whenever
  // one side comes from an SDK, compare platform and OS version instead, which
  // both sides do report.
  const sdk1 = parseSdkUserAgent(fingerprint1.userAgent || '');
  const sdk2 = parseSdkUserAgent(fingerprint2.userAgent || '');
  const crossContext = Boolean(sdk1) !== Boolean(sdk2);

  if (sdk1 || sdk2) {
    const platform1 = sdk1 ? sdk1.platform : platformOf(fingerprint1);
    const platform2 = sdk2 ? sdk2.platform : platformOf(fingerprint2);

    // A device cannot have clicked the link from a different operating system,
    // so a known mismatch disqualifies the candidate outright rather than just
    // scoring zero — the remaining signals are all shared-network coincidences.
    if (platform1 && platform2 && platform1 !== platform2) {
      return { score: 0, matchedFactors: [] };
    }

    if (platform1 && platform1 === platform2) {
      score += CROSS_CONTEXT_WEIGHTS.PLATFORM;
      matchedFactors.push('platform');

      const version1 = majorVersion(sdk1 ? sdk1.version : fingerprint1.platformVersion);
      const version2 = majorVersion(sdk2 ? sdk2.version : fingerprint2.platformVersion);

      if (version1 && version1 === version2) {
        score += CROSS_CONTEXT_WEIGHTS.PLATFORM_VERSION;
        matchedFactors.push('platform_version');
      }
    }
  } else if (fingerprint1.userAgent && fingerprint2.userAgent) {
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
    if (screensMatch(fingerprint1, fingerprint2, crossContext)) {
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
  attributionWindowHours: number = DEFAULT_ATTRIBUTION_WINDOW_HOURS,
  sdk?: { name?: string | null; version?: string | null }
): Promise<{
  installId: string;
  match: FingerprintMatch | null;
  deepLinkData: DeepLinkPayload | null;
}> {
  const fingerprintHash = generateFingerprintHash(fingerprintData);

  // Attempt to match install to a click
  const match = await matchInstallToClick(fingerprintData, attributionWindowHours);

  // Attribution metadata for measurement (SIT-296): install attribution is
  // fingerprint-based, so the method is 'fingerprint' on a match and 'none'
  // (organic) otherwise; matched_factors records which signals matched.
  const attributionMethod = match ? 'fingerprint' : 'none';
  const matchedFactors = match?.matchedFactors ?? null;

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
      deep_link_data,
      sdk_name,
      sdk_version,
      attribution_method,
      matched_factors
    ) VALUES ($1, $2, $3, $4, NOW(), NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      sdk?.name || null,
      sdk?.version || null,
      attributionMethod,
      matchedFactors,
    ]
  );

  const installId = installResult.rows[0].id;

  // Organic installs carry no deep link. This is null rather than `{}` because
  // an empty object is not a deep link: SDKs decode this field into a model with
  // a required short code, so `{}` fails to decode and takes the whole install
  // response — and with it SDK initialization — down with it.
  let deepLinkData: DeepLinkPayload | null = null;

  // If we have a match, retrieve the deep link data from the original link
  if (match) {
    const linkResult = await db.query(
      `SELECT
         id,
         short_code,
         original_url,
         deep_link_path,
         app_scheme,
         ios_app_store_url,
         android_app_store_url,
         web_fallback_url,
         utm_parameters,
         targeting_rules,
         deep_link_parameters
       FROM links
       WHERE id = $1`,
      [match.linkId]
    );

    if (linkResult.rows.length > 0) {
      const link = linkResult.rows[0];
      deepLinkData = toDeepLinkPayload(link, {
        clickedAt: match.clickedAt,
        isDeferred: true,
        confidenceScore: match.confidenceScore,
        matchedFactors: match.matchedFactors,
        legacyInstallKeys: true,
      });

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
