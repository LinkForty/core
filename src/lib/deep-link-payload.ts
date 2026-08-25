/**
 * The single place a link row becomes an SDK deep link payload.
 *
 * Two endpoints hand a deep link to an SDK: `/api/sdk/v1/resolve/:shortCode`
 * when the app is already installed, and `/api/sdk/v1/install` when a new
 * install is matched to an earlier click. Both describe the same thing to the
 * same SDK model, so both project through this function.
 *
 * They did not always. Each built its own object literal, and the two drifted:
 * the install payload spelled `webUrl` as `webFallbackUrl` and `customParameters`
 * as `deepLinkParameters`, and omitted `deepLinkPath`, `appScheme` and `linkId`
 * entirely — the fields an app needs to route a newly installed user, and the one
 * the SDKs use to credit that user's first session to the link that acquired
 * them. Renaming the keys without also collapsing the two call sites would only
 * reset the clock, so the shape lives here and the callers pass context.
 */

/** The columns of `links` this projection reads. */
export interface DeepLinkLinkRow {
  id?: string | null;
  short_code: string;
  deep_link_path?: string | null;
  app_scheme?: string | null;
  ios_app_store_url?: string | null;
  android_app_store_url?: string | null;
  web_fallback_url?: string | null;
  utm_parameters?: unknown;
  deep_link_parameters?: unknown;
  original_url?: string | null;
  targeting_rules?: unknown;
}

export interface DeepLinkPayloadOptions {
  /** When the click happened (direct opens pass the resolution time). */
  clickedAt: Date | string;
  /** True when this link is being delivered to a deferred (post-install) open. */
  isDeferred: boolean;
  /** Attribution confidence, deferred opens only. */
  confidenceScore?: number | null;
  /** Which fingerprint factors matched, deferred opens only. */
  matchedFactors?: string[] | null;
  /**
   * Emit the pre-1.22 install keys (`originalUrl`, `webFallbackUrl`,
   * `targetingRules`, `deepLinkParameters`) alongside the canonical ones.
   *
   * Every SDK in the field reads the old names, and app updates take weeks to
   * roll out, so the install payload keeps emitting them verbatim — same values,
   * nulls included — until version telemetry shows the old readers are gone.
   */
  legacyInstallKeys?: boolean;
}

export interface DeepLinkPayload {
  shortCode: string;
  linkId?: string;
  deepLinkPath?: string;
  appScheme?: string;
  iosUrl?: string;
  androidUrl?: string;
  webUrl?: string;
  utmParameters?: unknown;
  customParameters?: unknown;
  clickedAt: string;
  isDeferred: boolean;
  confidenceScore?: number;
  matchedFactors?: string[];
  // Legacy install-only aliases; see `legacyInstallKeys`.
  originalUrl?: string | null;
  webFallbackUrl?: string | null;
  targetingRules?: unknown;
  deepLinkParameters?: unknown;
}

/** The keys both endpoints must agree on. Exported so tests can assert it. */
export const CANONICAL_DEEP_LINK_KEYS = [
  'shortCode',
  'linkId',
  'deepLinkPath',
  'appScheme',
  'iosUrl',
  'androidUrl',
  'webUrl',
  'utmParameters',
  'customParameters',
  'clickedAt',
  'isDeferred',
] as const;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Projects a link row into the payload an SDK's `DeepLinkData` model expects.
 *
 * Empty canonical fields are omitted rather than sent as null, matching what
 * `/resolve` has always done; the legacy aliases keep their raw values so their
 * serialization does not change at all.
 */
export function toDeepLinkPayload(
  link: DeepLinkLinkRow,
  options: DeepLinkPayloadOptions
): DeepLinkPayload {
  const payload: DeepLinkPayload = {
    shortCode: link.short_code,
    linkId: link.id || undefined,
    deepLinkPath: link.deep_link_path || undefined,
    appScheme: link.app_scheme || undefined,
    iosUrl: link.ios_app_store_url || undefined,
    androidUrl: link.android_app_store_url || undefined,
    webUrl: link.web_fallback_url || undefined,
    utmParameters: link.utm_parameters || undefined,
    customParameters: link.deep_link_parameters || undefined,
    clickedAt: toIsoString(options.clickedAt),
    isDeferred: options.isDeferred,
  };

  // Drop the empty ones outright rather than leaving `key: undefined` behind.
  // JSON serialization would omit them anyway; deleting keeps the in-memory
  // object identical to what goes over the wire and into `deep_link_data`, so
  // anything enumerating keys sees the same shape a client does.
  for (const key of Object.keys(payload) as (keyof DeepLinkPayload)[]) {
    if (payload[key] === undefined) delete payload[key];
  }

  // Attribution metadata is meaningful only for a probabilistic (deferred)
  // match. Handing it to the app is deliberate: it can gate how confidently it
  // routes, which is not possible when a provider hides the match quality.
  if (options.confidenceScore != null) {
    payload.confidenceScore = options.confidenceScore;
  }
  if (options.matchedFactors != null) {
    payload.matchedFactors = options.matchedFactors;
  }

  if (options.legacyInstallKeys) {
    payload.originalUrl = (link.original_url ?? null) as string | null;
    payload.webFallbackUrl = (link.web_fallback_url ?? null) as string | null;
    payload.targetingRules = link.targeting_rules ?? null;
    payload.deepLinkParameters = link.deep_link_parameters ?? null;
  }

  return payload;
}
