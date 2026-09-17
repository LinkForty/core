import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { getClientIp } from '../lib/client-ip.js';
import { parseUserAgent, getLocationFromIP, buildRedirectUrl, detectDevice, resolveClickUtms, extractLinkParams } from '../lib/utils.js';
import { storeFingerprintForClick, type FingerprintData } from '../lib/fingerprint.js';
import { emitClickEvent } from '../lib/event-emitter.js';
import { classifyBot, edgeBotSignal } from '../lib/bot-detection.js';
import {
  evaluateLinkSafetyDecision,
  blockCauseIsAbuse,
  generateWarningLinkHTML,
  generateBlockedLinkHTML,
  createOwnerSuspensionSelect,
  escapeHtml,
  safeSchemeHref,
} from '../lib/link-safety.js';
import {
  createLaunchpadNonce,
  defaultLaunchpadContent,
  launchpadContentSecurityPolicy,
  readLaunchpadLinkMode,
  readLaunchpadSettings,
  renderLaunchpadPage,
  shouldServeLaunchpadOnDesktop,
  shouldServeLaunchpadOnMobile,
  type LaunchpadContent,
  type LaunchpadSettings,
} from '../lib/launchpad.js';

/** Longest query string the Launchpad page carries into its QR code and og:url. */
const MAX_PAGE_URL_SEARCH = 512;

/**
 * Detect iOS in-app browsers where Universal Links don't fire.
 * These browsers use WKWebView which bypasses the Universal Links mechanism.
 */
export function isIOSInAppBrowser(userAgent: string): boolean {
  const inAppPatterns = [
    /GSA\//i,              // Google Search App (Gmail in-app browser)
    /Gmail\//i,            // Gmail
    /FBAN|FBAV/i,          // Facebook
    /Instagram/i,          // Instagram
    /Twitter/i,            // Twitter/X
    /LinkedIn/i,           // LinkedIn
    /MicroMessenger/i,     // WeChat
    /Outlook/i,            // Outlook
    /YahooMobile/i,        // Yahoo Mail
  ];
  return inAppPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Detect Android in-app browsers where App Links don't fire.
 * These browsers use Android WebView (or app-specific webviews) that bypass
 * the App Link / Digital Asset Link mechanism.
 */
export function isAndroidInAppBrowser(userAgent: string): boolean {
  const inAppPatterns = [
    /FB_IAB|FBAN|FBAV/i,   // Facebook in-app browser
    /Instagram/i,
    /Line\//i,
    /KAKAOTALK/i,
    /Twitter/i,
    /LinkedIn/i,
    /MicroMessenger/i,     // WeChat
    /Outlook-Android/i,
    /WhatsApp/i,
    /Pinterest/i,
    /Telegram/i,
    /Snapchat/i,
    /\swv\)/,              // Generic Android WebView marker (e.g. "Mobile Safari/537.36; wv)")
  ];
  return inAppPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Pick the destination URL for a mobile click that has fallen through the
 * Universal Link / App Link / app_scheme priority steps. The choice depends on
 * whether the click is from an in-app browser:
 *
 * - Regular browser (Safari, Chrome): the OS-level UL/App Link check ran and
 *   didn't fire, so the app must not be installed → prefer the App/Play Store URL.
 *
 * - In-app browser (Gmail, GSA, FB, Instagram, Outlook, etc.): UL is bypassed
 *   regardless of install state, so we don't know if the app is installed →
 *   prefer the web fallback URL, which gives the OS another chance to fire UL
 *   if the fallback is on the app's UL/App-Link domain.
 *
 * Returns null if no URL is available (caller should fall back to original_url).
 */
export function pickMobileFallbackUrl(
  device: 'ios' | 'android',
  userAgent: string,
  iosUrl: string | null,
  androidUrl: string | null,
  webFallbackUrl: string | null,
): { url: string; reason: string } | null {
  const inApp = device === 'ios'
    ? isIOSInAppBrowser(userAgent)
    : isAndroidInAppBrowser(userAgent);
  const storeUrl = device === 'ios' ? iosUrl : androidUrl;
  const storeReason = device === 'ios' ? 'ios_app_store_url' : 'android_app_store_url';

  if (inApp) {
    if (webFallbackUrl) return { url: webFallbackUrl, reason: 'web_fallback_url' };
    if (storeUrl)       return { url: storeUrl,       reason: storeReason };
  } else {
    if (storeUrl)       return { url: storeUrl,       reason: storeReason };
    if (webFallbackUrl) return { url: webFallbackUrl, reason: 'web_fallback_url' };
  }
  return null;
}

/**
 * The URI-scheme URL that opens this link's content in the app, with the
 * link's deep-link parameters appended as a query string. Shared by the
 * scheme interstitial and the launchpad page's "Open in app" button so the two
 * can never disagree about where the app is sent.
 */
function buildAppSchemeUrl(link: {
  app_scheme: string;
  deep_link_path?: string | null;
  custom_scheme_url?: string | null;
  deep_link_parameters?: Record<string, unknown> | null;
}): string {
  const deepPath = link.deep_link_path ? link.deep_link_path.replace(/^\//, '') : '';
  let schemeUrl = link.custom_scheme_url || `${link.app_scheme}://${deepPath}`;
  if (link.deep_link_parameters && Object.keys(link.deep_link_parameters).length > 0) {
    const params = new URLSearchParams(
      Object.entries(link.deep_link_parameters).map(([k, v]) => [k, String(v)] as [string, string])
    );
    schemeUrl += (schemeUrl.includes('?') ? '&' : '?') + params.toString();
  }
  return schemeUrl;
}

/**
 * Generate an interstitial HTML page that tries to open the app via custom scheme,
 * then falls back to the App Store / Play Store.
 *
 * The JavaScript reads the URL fragment (window.location.hash) and appends it
 * to the scheme URL. This preserves the E2E encryption key, which lives only
 * in the fragment and is never sent to the server.
 */
function generateInterstitialHTML(schemeUrl: string, fallbackUrl: string, title?: string): string {
  // Both URLs reach the document only as attribute values; the script reads
  // them back from the DOM rather than having them interpolated into JavaScript
  // source, where a quote, backslash or line terminator in a configured value
  // would end the string literal.
  const safeSchemeUrl = escapeHtml(schemeUrl);
  const safeFallbackUrl = escapeHtml(fallbackUrl);
  const safeTitle = escapeHtml(title || 'the app');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opening ${safeTitle}...</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; text-align: center; }
  .container { padding: 2rem; }
  .spinner { width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1.5rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.875rem; color: #6b7280; margin: 0 0 2rem; }
  .btn { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; text-decoration: none; margin: 0.25rem; }
  .btn-primary { background: #3b82f6; color: #fff; }
  .btn-secondary { background: #e5e7eb; color: #374151; }
</style>
</head><body>
<div class="container">
  <div class="spinner"></div>
  <h1>Opening ${safeTitle}...</h1>
  <p>If the app doesn't open automatically:</p>
  <a class="btn btn-primary" id="open-btn" href="${safeSchemeUrl}">Open App</a>
  <a class="btn btn-secondary" id="store-btn" href="${safeFallbackUrl}">Download App</a>
</div>
<script>
  // Preserve URL fragment (E2E encryption key) through the scheme redirect
  var openBtn = document.getElementById('open-btn');
  var storeBtn = document.getElementById('store-btn');
  var hash = window.location.hash || '';
  var schemeUrl = openBtn.getAttribute('href') + hash;
  openBtn.href = schemeUrl;
  window.location = schemeUrl;
  setTimeout(function() { window.location.replace(storeBtn.getAttribute('href')); }, 1500);
</script>
</body></html>`;
}

/**
 * Page shown to a desktop visitor when a link has no web destination at any level
 * of the chain (link, template, workspace) **and** the launchpad page is switched
 * off for the workspace or the link.
 *
 * This is the expected configuration for an app-only product, not a mistake — an
 * app with no website has nothing to put in a web fallback. Until this page
 * existed the visitor got `{"error":"No destination URL configured for this link"}`
 * as a raw 404 body, rendered on the link owner's own branded short-link domain.
 *
 * Deliberately plain. It is served from the link owner's domain, so it should read
 * as a neutral system page rather than as LinkForty's design. The configurable
 * version is the launchpad page (lib/launchpad.ts), which is the default; this
 * one remains for deployments that opt out.
 *
 * Nothing about the link is disclosed beyond what the visitor already has: a
 * title, and store links when the link carries them. No destination URL, no
 * workspace name.
 */
function generateNoWebDestinationHTML(opts: {
  title?: string | null;
  iosUrl?: string | null;
  androidUrl?: string | null;
}): string {
  const heading = opts.title ? escapeHtml(opts.title) : 'This link opens in an app';
  const buttons = [
    opts.iosUrl ? `<a class="btn" href="${escapeHtml(opts.iosUrl)}">Download for iOS</a>` : '',
    opts.androidUrl ? `<a class="btn" href="${escapeHtml(opts.androidUrl)}">Download for Android</a>` : '',
  ].join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${heading}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #111827; text-align: center; }
  .container { padding: 2rem; max-width: 32rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
  p { font-size: 0.875rem; color: #6b7280; margin: 0 0 1.5rem; line-height: 1.5; }
  .btn { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; text-decoration: none; margin: 0.25rem; background: #e5e7eb; color: #374151; }
</style>
</head><body>
<div class="container">
  <h1>${heading}</h1>
  <p>This link opens content inside a mobile app. Open it on your phone, or install the app below.</p>
  ${buttons}
</div>
</body></html>`;
}

export interface RedirectRouteOptions {
  /**
   * Absolute URL of an abuse-reporting page. When set, the interstitial warning
   * page links to it. Optional — deployments without one simply omit the link.
   */
  abuseReportUrl?: string;
  /**
   * Launchpad page hooks (see lib/launchpad.ts). Both optional: without them
   * the page is built from the link row alone and reports nothing.
   */
  launchpad?: {
    /**
     * Supply richer page content than the link row carries — a rendered share
     * image, a templated hero. Return null to use the default. A hook that
     * throws is logged and treated as null; the page never fails because of it.
     */
    resolveContent?: (
      link: Record<string, any>,
      settings: LaunchpadSettings
    ) => Promise<LaunchpadContent | null> | LaunchpadContent | null;
    /**
     * Endpoint that receives `{ linkId, event }` beacons from the page
     * (`view`, `cta_ios`, `cta_android`, `cta_open`). Relative or absolute.
     * Unset means the page sends nothing.
     */
    beaconUrl?: string;
  };
}

export async function redirectRoutes(
  fastify: FastifyInstance,
  options: RedirectRouteOptions = {}
) {
  /**
   * Owner-restriction support is detected rather than assumed.
   *
   * The redirect query joins `organizations` for settings, and that table is now
   * created by this package (#35) — before that fix a stock self-hosted install
   * 500'd on every redirect with 42P01, which made this probe's guarantee hollow:
   * it guarded the column while the table itself was missing.
   *
   * The column still needs probing separately, because `suspended_at` is added by
   * downstream consumers that model owner restriction rather than by this package.
   * Probing once and building the SELECT accordingly avoids failing every redirect
   * on a missing column.
   *
   * Scoped to this registration rather than the module: module-level state would
   * be shared by every createServer() in the process, so two servers pointed at
   * different databases would share whichever answer landed first — and it forced
   * a test-only reset export onto the package's public API.
   *
   * The in-flight promise is memoised, not just its result, so N concurrent cold
   * requests issue one probe rather than N.
   *
   * Probed lazily because the database may not be reachable at registration time.
   * A probe failure is treated as "unsupported", so it can never take the redirect
   * path down.
   */
  const resolveOwnerSuspensionSelect = createOwnerSuspensionSelect({
    query: (sql) => db.query(sql),
    onSupported: () =>
      fastify.log.info('Redirect: owner restriction supported (organizations.suspended_at present)'),
  });
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

      const ownerSuspensionColumn = await resolveOwnerSuspensionSelect();

      if (templateSlug) {
        // Template-based URL: verify both template and link match
        // Also fetch template settings and org settings for URL fallback chain
        query = `
          SELECT l.*, t.settings AS template_settings, o.settings AS org_settings
                 ${ownerSuspensionColumn}
          FROM links l
          LEFT JOIN link_templates t ON l.template_id = t.id
          LEFT JOIN organizations o ON l.organization_id = o.id
          WHERE l.short_code = $1 AND t.slug = $2
          AND (l.is_active = true OR l.disabled_at IS NOT NULL)
          AND (l.expires_at IS NULL OR l.expires_at > NOW())
        `;
        params = [shortCode, templateSlug];
      } else {
        // Legacy URL: just lookup by short code
        // Also fetch template settings and org settings for URL fallback chain
        query = `
          SELECT l.*, t.settings AS template_settings, o.settings AS org_settings
                 ${ownerSuspensionColumn}
          FROM links l
          LEFT JOIN link_templates t ON l.template_id = t.id
          LEFT JOIN organizations o ON l.organization_id = o.id
          WHERE l.short_code = $1
          AND (l.is_active = true OR l.disabled_at IS NOT NULL)
          AND (l.expires_at IS NULL OR l.expires_at > NOW())
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

    // Safety gate, applied after the cache read so it covers cached rows too.
    //
    // It does NOT close the stale-cache window on its own, and an earlier version
    // of this comment wrongly claimed it did: a cached row carries the value of
    // `is_active` as at cache time, so reading it here sees the same stale `true`
    // the old code did. Staleness is handled by invalidateLinkResolutionCache(),
    // called when a link is updated or deleted.
    //
    // The WHERE clause admits a row that is inactive *only* when `disabled_at` is
    // set, because an explicitly disabled link has a notice to serve and therefore
    // needs fetching. Everything else inactive — expired, or switched off by its
    // owner — is still excluded in SQL and never reaches here, which is what keeps
    // those visitors on the opaque response they should get.
    //
    // `warn_at` remains the case that cannot be expressed in the WHERE clause at
    // all, since it needs the row in hand to choose between redirecting and serving
    // an interstitial.
    const safety = evaluateLinkSafetyDecision({
      isActive: link.is_active,
      warnAt: link.warn_at,
      disabledAt: link.disabled_at,
      ownerSuspendedAt: link.owner_suspended_at,
    });

    if (safety.outcome === 'block') {
      // An abuse decision earns an explanation; anything else stays opaque. See the
      // module comment in link-safety.ts for why that split, and why it stays narrow.
      if (blockCauseIsAbuse(safety.cause)) {
        // 410, not 404: this code existed and was withdrawn. No click is recorded,
        // for the same reason the warning page records none — nobody reached the
        // destination, and counting it would put phantom traffic on the link.
        return reply
          .status(410)
          .header('X-Robots-Tag', 'noindex, nofollow')
          .header('Cache-Control', 'no-store')
          .type('text/html')
          .send(generateBlockedLinkHTML());
      }
      return reply.status(404).send({ error: 'Link not found' });
    }

    if (safety.outcome === 'warn') {
      // No click is recorded here. A warning view is not a click on the link, and
      // counting it would silently inflate the owner's analytics.
      const destination =
        link.original_url || link.web_fallback_url || link.deep_link_path || '';
      return reply
        .status(200)
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Cache-Control', 'no-store')
        .type('text/html')
        .send(generateWarningLinkHTML(destination, { reportUrl: options?.abuseReportUrl }));
    }

    // Check targeting rules BEFORE redirecting
    if (link.targeting_rules) {
      const userAgent = request.headers['user-agent'] || '';
      const ip = getClientIp(request);
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

    // Generate the click id up front (rather than letting the DB default it on
    // insert) so the synchronous redirect below can carry it on the destination
    // URL while the click row is still written asynchronously with the same id.
    const clickId = randomUUID();

    // Track click asynchronously
    setImmediate(async () => {
      try {
        const userAgent = request.headers['user-agent'] || '';
        const ip = getClientIp(request);
        const referrer = request.headers.referer || null;
        const acceptLanguage = request.headers['accept-language'] || '';

        const deviceType = detectDevice(userAgent);
        const { platform, platformVersion } = parseUserAgent(userAgent);
        const { countryCode, countryName, region, city, latitude, longitude, timezone } = getLocationFromIP(ip);

        // Classify bots at ingestion — persisted on the row so
        // analytics reads a consistent flag instead of re-detecting from the
        // stored user-agent.
        const { isBot, reason: botReason } = classifyBot(
          userAgent,
          request.method,
          edgeBotSignal(request.headers['x-lf-bot'])
        );

        // Resolve the UTMs recorded on the click row. Inbound query-string
        // values win per key; the link's configured UTMs (the same ones
        // buildRedirectUrl puts on the destination) fill anything left blank,
        // so link-tagged campaigns show up in analytics instead of NULLs.
        const query = request.query as Record<string, string | undefined>;
        const { utmSource, utmMedium, utmCampaign } = resolveClickUtms(query, link.utm_parameters);

        // Extract fingerprint data from query params (sent by SDK/client)
        const fpTimezone = query?.fp_tz || timezone || undefined;
        const fpLanguage = query?.fp_lang || acceptLanguage.split(',')[0]?.split(';')[0] || undefined;
        const fpScreenWidth = query?.fp_sw ? parseInt(query.fp_sw, 10) : undefined;
        const fpScreenHeight = query?.fp_sh ? parseInt(query.fp_sh, 10) : undefined;

        // Non-reserved query params, persisted so a deferred install can be
        // handed them. Skipped entirely for bots: crawlers fuzz query
        // strings, this is the highest-volume table in the product, and bot rows
        // are already excluded from analytics — so storing theirs buys nothing
        // and costs storage on every row they touch.
        const linkParams = isBot ? {} : extractLinkParams(query);

        // Insert click event with the pre-generated id (see above) so the row
        // matches the lf_click value already placed on the redirect URL.
        await db.query(
          `INSERT INTO click_events (
            id, link_id, ip_address, user_agent, device_type, platform,
            country_code, country_name, region, city, latitude, longitude, timezone,
            utm_source, utm_medium, utm_campaign, referrer, is_bot, bot_reason, link_params
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            clickId,
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
            isBot,
            botReason,
            // NULL rather than '{}' when there is nothing to store, so the
            // column stays empty for the overwhelming majority of rows.
            Object.keys(linkParams).length > 0 ? JSON.stringify(linkParams) : null,
          ]
        );

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
        // Use the same fallback chain: link → template → workspace
        const tplSettings = link.template_settings || {};
        const oSettings = link.org_settings || {};
        const oAppConfig = oSettings.appConfig || {};
        const iosStoreUrl = link.ios_app_store_url || tplSettings.defaultIosUrl || oAppConfig.iosAppStoreUrl || null;
        const androidStoreUrl = link.android_app_store_url || tplSettings.defaultAndroidUrl || oAppConfig.androidAppStoreUrl || null;
        const webFallback = link.web_fallback_url || tplSettings.defaultWebFallbackUrl || oAppConfig.webFallbackUrl || null;

        let redirectUrl = link.original_url;
        let redirectReason = 'original_url';

        if (deviceType === 'ios') {
          if (link.ios_universal_link) {
            redirectUrl = link.ios_universal_link;
            redirectReason = 'ios_universal_link';
          } else if (link.app_scheme && link.deep_link_path) {
            redirectUrl = `${link.app_scheme}://${link.deep_link_path.replace(/^\//, '')}`;
            redirectReason = 'app_scheme';
          } else {
            const fb = pickMobileFallbackUrl('ios', userAgent, iosStoreUrl, androidStoreUrl, webFallback);
            if (fb) {
              redirectUrl = fb.url;
              redirectReason = fb.reason;
            }
          }
        } else if (deviceType === 'android') {
          if (link.android_app_link) {
            redirectUrl = link.android_app_link;
            redirectReason = 'android_app_link';
          } else if (link.app_scheme && link.deep_link_path) {
            redirectUrl = `${link.app_scheme}://${link.deep_link_path.replace(/^\//, '')}`;
            redirectReason = 'app_scheme';
          } else {
            const fb = pickMobileFallbackUrl('android', userAgent, iosStoreUrl, androidStoreUrl, webFallback);
            if (fb) {
              redirectUrl = fb.url;
              redirectReason = fb.reason;
            }
          }
        } else if (deviceType === 'web' && webFallback) {
          redirectUrl = webFallback;
          redirectReason = 'web_fallback_url';
        }

        const finalRedirectUrl = buildRedirectUrl(redirectUrl, link.utm_parameters) || redirectUrl;

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
    // Fallback chain: link URLs → template default URLs → workspace settings URLs
    const userAgent = request.headers['user-agent'] || '';
    const device = detectDevice(userAgent);

    // Extract fallback URLs from template settings and org settings
    const templateSettings = link.template_settings || {};
    const orgSettings = link.org_settings || {};
    const orgAppConfig = orgSettings.appConfig || {};

    // Resolve platform URLs with fallback chain: link → template → workspace
    const iosUrl = link.ios_app_store_url || templateSettings.defaultIosUrl || orgAppConfig.iosAppStoreUrl || null;
    const androidUrl = link.android_app_store_url || templateSettings.defaultAndroidUrl || orgAppConfig.androidAppStoreUrl || null;
    const webFallbackUrl = link.web_fallback_url || templateSettings.defaultWebFallbackUrl || orgAppConfig.webFallbackUrl || null;

    /**
     * Everything the redirect adds to an http(s) destination before sending a
     * visitor there: the link's UTM parameters, its deep-link parameters as a
     * query string, and — when the link opted in — the originating click id.
     * Used for the 302, and for the "Continue on the web" link on the
     * launchpad page, so a visitor who goes via the page lands on the same
     * URL as one who was redirected.
     */
    const decorateWebDestination = (destination: string): string => {
      // For HTTP(S) URLs, add UTM parameters
      let url = buildRedirectUrl(destination, link.utm_parameters) || destination;

      // Add deep link parameters as query params
      if (link.deep_link_parameters && Object.keys(link.deep_link_parameters).length > 0) {
        try {
          const parsed = new URL(url);
          Object.entries(link.deep_link_parameters).forEach(([key, value]) => {
            parsed.searchParams.set(key, String(value));
          });
          url = parsed.toString();
        } catch (error) {
          // If URL parsing fails, continue without deep link parameters
          console.error('Failed to add deep link parameters:', error);
        }
      }

      // When opted in per link (append_click_id), append the originating click id
      // so a downstream analytics tool on the landing page can correlate the
      // landing visit to this exact click. Opt-in (default off), web/HTTPS only —
      // an absent/false flag (incl. stale cache) leaves the destination untouched.
      if (link.append_click_id === true) {
        try {
          const parsed = new URL(url);
          parsed.searchParams.set('lf_click', clickId);
          url = parsed.toString();
        } catch {
          // Non-absolute / unparseable URL — skip the correlation param.
        }
      }
      return url;
    };

    /**
     * The link's URI scheme, or null when it names something a browser would
     * execute rather than hand to an app (javascript:, data:, …). On the
     * response path such a link is treated as having no scheme at all: it
     * takes the store / web-fallback route like any other link without one.
     * `app_scheme` is validated as a scheme *token* at write time, which does
     * not exclude these names.
     */
    const appScheme: string | null =
      link.app_scheme && safeSchemeHref(`${link.app_scheme}:`) ? link.app_scheme : null;

    /**
     * Render and send the launchpad page (lib/launchpad.ts). Shared by the
     * desktop and mobile decisions below; the caller decides the two things
     * that differ between them — whether there is a scheme to offer a button
     * for, and whether a QR code makes sense.
     */
    const serveLaunchpad = async (
      launchpadSettings: LaunchpadSettings,
      opts: {
        schemeUrl: string | null;
        showQr: boolean;
        webUrl: string | null;
        storeUrls?: { iosUrl: string | null; androidUrl: string | null };
      }
    ) => {
      let content: LaunchpadContent | null = null;
      try {
        content = (await options.launchpad?.resolveContent?.(link, launchpadSettings)) ?? null;
      } catch (err) {
        fastify.log.error({ err, shortCode }, 'Launchpad resolveContent threw; using default content');
      }
      content ??= defaultLaunchpadContent(link, launchpadSettings);

      const nonce = createLaunchpadNonce();
      const beaconUrl = options.launchpad?.beaconUrl;
      const host = request.headers.host || request.hostname;
      const pagePath = templateSlug ? `${templateSlug}/${shortCode}` : shortCode;
      // The page's own URL — host, template path and the visitor's query string —
      // is what the QR code hands to the phone, so nothing is lost in the hop.
      // A query string too long to fit a scannable code is dropped, not truncated.
      const rawSearch = new URL(request.url, 'http://x').search;
      const search = rawSearch.length <= MAX_PAGE_URL_SEARCH ? rawSearch : '';
      return reply
        .status(200)
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Cache-Control', 'no-store')
        .header('Content-Security-Policy', launchpadContentSecurityPolicy(nonce, beaconUrl))
        .type('text/html')
        .send(
          renderLaunchpadPage({
            content,
            linkId: link.id,
            pageUrl: `${request.protocol}://${host}/${pagePath}${search}`,
            iosUrl: opts.storeUrls ? opts.storeUrls.iosUrl : iosUrl,
            androidUrl: opts.storeUrls ? opts.storeUrls.androidUrl : androidUrl,
            webUrl: opts.webUrl,
            schemeUrl: opts.schemeUrl,
            showQr: opts.showQr,
            nonce,
            beaconUrl,
          })
        );
    };

    let redirectUrl = link.original_url;
    let useSchemeUrl = false; // Track if we're using a URI scheme URL

    if (device === 'ios') {
      // iOS Priority:
      // 1. Universal Link (HTTPS URL with AASA file) — if app installed, OS opens app
      //    (this branch only runs when UL didn't fire upstream, e.g. in-app browser)
      // 2. URI scheme (myapp://path) — explicit deep link
      // 3. Mobile fallback (browser-aware):
      //    - regular browser: App Store URL > web fallback URL
      //      (UL would have fired if app installed, so app is not installed)
      //    - in-app browser: web fallback URL > App Store URL
      //      (UL was bypassed; web fallback gives UL a second chance to fire)
      // 4. Original URL — ultimate fallback
      if (link.ios_universal_link) {
        redirectUrl = link.ios_universal_link;
      } else if (appScheme && link.deep_link_path) {
        // Build URI scheme URL: myapp://product/123
        redirectUrl = `${appScheme}://${link.deep_link_path.replace(/^\//, '')}`;
        useSchemeUrl = true;
      } else {
        const fb = pickMobileFallbackUrl('ios', userAgent, iosUrl, androidUrl, webFallbackUrl);
        if (fb) redirectUrl = fb.url;
      }

    } else if (device === 'android') {
      // Android Priority — same logic as iOS, with android_app_link in place of UL
      if (link.android_app_link) {
        redirectUrl = link.android_app_link;
      } else if (appScheme && link.deep_link_path) {
        // Build URI scheme URL: myapp://product/123
        redirectUrl = `${appScheme}://${link.deep_link_path.replace(/^\//, '')}`;
        useSchemeUrl = true;
      } else {
        const fb = pickMobileFallbackUrl('android', userAgent, iosUrl, androidUrl, webFallbackUrl);
        if (fb) redirectUrl = fb.url;
      }

    } else if (device === 'web') {
      // Web fallback
      redirectUrl = webFallbackUrl || link.original_url;

      /**
       * Launchpad page for desktop visitors (lib/launchpad.ts).
       *
       * By default it replaces the plain no-destination page below, i.e. it
       * is served only when the chain resolved nothing. A workspace can widen
       * that to every desktop visit (`launchpad.desktop = 'always'`), narrow
       * it to nothing (`'off'`), and a link can override either way with
       * `launchpad_mode`. A link that resolves to a destination and has not
       * opted in still gets its 302 — the page must never add a hop to a link
       * that works.
       *
       * The click has already been recorded above; this is a genuine visit.
       */
      const launchpadSettings = readLaunchpadSettings(orgSettings);
      const shouldServe = shouldServeLaunchpadOnDesktop({
        hasWebDestination: Boolean(redirectUrl),
        orgMode: launchpadSettings.desktop,
        linkMode: readLaunchpadLinkMode(link.launchpad_mode),
      });
      if (shouldServe) {
        // Desktop never attempts the URI scheme: there is no app to open. The
        // web destination, when there is one, is offered as a link so `always`
        // mode never traps a visitor who would otherwise have been redirected.
        return serveLaunchpad(launchpadSettings, {
          schemeUrl: null,
          showQr: true,
          webUrl: redirectUrl ? decorateWebDestination(redirectUrl) : null,
        });
      }
    }

    /**
     * Launchpad page for mobile visitors, when the workspace asked for it
     * (`launchpad.mobile = 'page'`). Sits in front of the store redirect and
     * the scheme interstitial below, never in front of a Universal Link / App
     * Link 302 — the OS handles the installed case there, and only there.
     * The page's "Open in app" is a button; the interstitial's scheme attempt
     * is a navigation. That difference is the whole reason the mode exists.
     */
    if (device === 'ios' || device === 'android') {
      const launchpadSettings = readLaunchpadSettings(orgSettings);
      const hasAppOpenPath = device === 'ios' ? Boolean(link.ios_universal_link) : Boolean(link.android_app_link);
      if (
        shouldServeLaunchpadOnMobile({
          mobileMode: launchpadSettings.mobile,
          linkMode: readLaunchpadLinkMode(link.launchpad_mode),
          hasAppOpenPath,
        })
      ) {
        // Only this platform's store: a Google Play button on an iPhone is noise.
        // The web fallback stays reachable as a link — inside an in-app browser
        // it is the hop that gives a Universal Link / App Link its second chance
        // to open an installed app, the same reason pickMobileFallbackUrl()
        // prefers it there.
        return serveLaunchpad(launchpadSettings, {
          schemeUrl: appScheme ? buildAppSchemeUrl(link) : null,
          showQr: false,
          webUrl: webFallbackUrl || link.original_url ? decorateWebDestination(webFallbackUrl || link.original_url) : null,
          storeUrls: device === 'ios' ? { iosUrl, androidUrl: null } : { iosUrl: null, androidUrl },
        });
      }
    }

    /**
     * No destination at any level of the chain.
     *
     * On desktop this is a real person who clicked a real link, so serve a page
     * rather than a JSON error body. Mobile keeps the 404: the branches above
     * already offer a store URL to a device that could install the app, so
     * reaching here means the link has nothing at all.
     *
     * Unlike the warning page earlier in this handler, this does NOT suppress
     * click recording — the click was already written by the setImmediate block,
     * and this is a genuine visit to a working link rather than an enforcement
     * action. Do not "make them consistent".
     */
    if (!redirectUrl) {
      if (device === 'web') {
        return reply
          .status(200)
          .header('X-Robots-Tag', 'noindex, nofollow')
          .header('Cache-Control', 'no-store')
          .type('text/html')
          .send(
            generateNoWebDestinationHTML({
              title: link.og_title || link.title,
              iosUrl,
              androidUrl,
            })
          );
      }
      return reply.status(404).send({ error: 'No destination URL configured for this link' });
    }

    // Build final URL with parameters
    let finalUrl = redirectUrl;

    if (!useSchemeUrl) {
      finalUrl = decorateWebDestination(redirectUrl);
    } else {
      // For URI scheme URLs, append query params differently
      if (link.deep_link_parameters && Object.keys(link.deep_link_parameters).length > 0) {
        const params = new URLSearchParams(
          Object.entries(link.deep_link_parameters).map(([k, v]) => [k, String(v)] as [string, string])
        );
        finalUrl += `?${params.toString()}`;
      }
    }

    // Serve an interstitial page for mobile requests when a custom scheme is available.
    // The interstitial tries to open the app via URI scheme, then falls back to the store.
    // This works for both in-app browsers (where Universal Links don't fire) and regular
    // browsers (where a 302 to a custom scheme fails silently if the app isn't installed).
    // The interstitial JavaScript preserves the URL fragment (E2E encryption key).
    if ((device === 'ios' || device === 'android') && appScheme) {
      // The interstitial JS tries the scheme first; storeFallback is what we
      // navigate to if the scheme doesn't open the app within ~1.5s. Pick it
      // browser-aware: regular browsers prefer the store URL, in-app browsers
      // prefer the web fallback (gives UL a second chance to fire).
      const fb = pickMobileFallbackUrl(device, userAgent, iosUrl, androidUrl, webFallbackUrl);
      const storeFallback = fb?.url || link.original_url;

      // `appScheme` is already vetted; this re-checks the assembled URL so a
      // custom scheme URL naming an executable scheme is refused too.
      const schemeUrl = safeSchemeHref(buildAppSchemeUrl(link));
      if (storeFallback && schemeUrl) {
        return reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .send(generateInterstitialHTML(schemeUrl, storeFallback, link.title || link.og_title));
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
