// Template types

/**
 * Default settings applied to links created from a template.
 */
export interface LinkTemplateSettings {
  defaultIosUrl?: string;
  defaultAndroidUrl?: string;
  defaultWebFallbackUrl?: string;
  defaultAttributionWindowHours?: number;
  utmParameters?: UTMParameters;
  targetingRules?: TargetingRules;
  expiresAfterDays?: number;
}

/**
 * A reusable link template that pre-populates settings when creating new links.
 */
export interface LinkTemplate {
  id: string;
  userId?: string;
  name: string;
  slug: string;
  description?: string;
  settings: LinkTemplateSettings;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  settings?: LinkTemplateSettings;
  isDefault?: boolean;
}

export interface UpdateTemplateRequest extends Partial<CreateTemplateRequest> {}

/**
 * A short link with routing, deep-linking, UTM, targeting, and Open Graph metadata.
 */
export interface Link {
  id: string;
  userId?: string;
  template_id?: string;
  template_slug?: string;
  short_code: string;
  original_url: string;
  title?: string;
  description?: string;
  // App store URLs (renamed from ios_url/android_url for clarity)
  ios_app_store_url?: string;
  android_app_store_url?: string;
  web_fallback_url?: string;
  // App deep linking configuration
  app_scheme?: string;              // URI scheme (e.g., "myapp" or "com.company.app")
  ios_universal_link?: string;       // iOS Universal Link URL (HTTPS)
  android_app_link?: string;         // Android App Link URL (HTTPS)
  deep_link_path?: string;           // In-app destination path (e.g., "/product/123")
  deep_link_parameters?: Record<string, any>; // Custom app parameters
  // Existing fields
  utmParameters?: UTMParameters;
  targeting_rules?: TargetingRules;
  og_title?: string;
  og_description?: string;
  og_image_url?: string;
  og_type?: string;
  attribution_window_hours?: number;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  click_count?: number;
}

/**
 * Standard UTM tracking parameters appended to redirect URLs for campaign attribution.
 */
export interface UTMParameters {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

/**
 * Rules that control which redirect URL a visitor receives based on their
 * country, device type, or browser language.
 */
export interface TargetingRules {
  countries?: string[];
  devices?: ('ios' | 'android' | 'web')[];
  languages?: string[];
}

/**
 * A recorded click event on a short link, including device, location, and UTM data.
 */
export interface ClickEvent {
  id: string;
  linkId: string;
  clickedAt: string;
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  platform?: string;
  countryCode?: string;
  countryName?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
}

export interface CreateLinkRequest {
  templateId?: string;
  originalUrl: string;
  title?: string;
  description?: string;
  // App store URLs (renamed from iosUrl/androidUrl for clarity)
  iosAppStoreUrl?: string;
  androidAppStoreUrl?: string;
  webFallbackUrl?: string;
  // App deep linking configuration
  appScheme?: string;                // URI scheme (e.g., "myapp" or "com.company.app")
  iosUniversalLink?: string;          // iOS Universal Link URL (HTTPS)
  androidAppLink?: string;            // Android App Link URL (HTTPS)
  deepLinkPath?: string;              // In-app destination path (e.g., "/product/123")
  deepLinkParameters?: Record<string, any>; // Custom app parameters
  // Existing fields
  utmParameters?: UTMParameters;
  targetingRules?: TargetingRules;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  ogType?: string;
  attributionWindowHours?: number;
  customCode?: string;
  expiresAt?: string;
}

export interface UpdateLinkRequest extends Partial<CreateLinkRequest> {
  isActive?: boolean;
}

/**
 * Aggregated analytics for one or more links over a time period, broken down
 * by date, geography, device, browser, UTM parameters, and referrer.
 */
export interface AnalyticsData {
  totalClicks: number;
  uniqueClicks: number;
  clicksByDate: Array<{ date: string; clicks: number }>;
  clicksByCountry: Array<{ country: string; countryCode: string; clicks: number }>;
  clicksByCity: Array<{ city: string; countryCode: string; region: string; clicks: number }>;
  clicksByRegion: Array<{ region: string; countryCode: string; clicks: number }>;
  clicksByTimezone: Array<{ timezone: string; clicks: number }>;
  clicksByDevice: Array<{ device: string; clicks: number }>;
  clicksByPlatform: Array<{ platform: string; clicks: number }>;
  clicksByBrowser: Array<{ browser: string; clicks: number }>;
  clicksByHour: Array<{ hour: number; clicks: number }>;
  clicksByUtmSource: Array<{ source: string; clicks: number }>;
  clicksByUtmMedium: Array<{ medium: string; clicks: number }>;
  clicksByUtmCampaign: Array<{ campaign: string; clicks: number }>;
  clicksByReferrer: Array<{ source: string; clicks: number }>;
  topLinks: Array<{
    id: string;
    shortCode: string;
    title: string | null;
    originalUrl: string;
    totalClicks: number;
    uniqueClicks: number;
  }>;
}

// Webhook types

/**
 * Discriminated event type sent in webhook payloads.
 * Consumers should filter webhooks by subscribing to specific event types.
 */
export type WebhookEvent = 'click_event' | 'install_event' | 'conversion_event' | 'sdk_event' | 'invite_consumed_event';

/**
 * A registered webhook endpoint that receives event notifications from LinkForty.
 */
export interface Webhook {
  id: string;
  user_id: string;
  name: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
  is_active: boolean;
  retry_count: number;
  timeout_ms: number;
  headers: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface CreateWebhookRequest {
  name: string;
  url: string;
  events: WebhookEvent[];
  headers?: Record<string, string>;
  retryCount?: number;
  timeoutMs?: number;
}

export interface UpdateWebhookRequest {
  name?: string;
  url?: string;
  events?: WebhookEvent[];
  isActive?: boolean;
  headers?: Record<string, string>;
  retryCount?: number;
  timeoutMs?: number;
}

/**
 * The JSON body delivered to a webhook endpoint for every event.
 */
export interface WebhookPayload {
  event: WebhookEvent;
  event_id: string;
  timestamp: string;
  data: ClickEvent | InstallEvent | ConversionEvent;
}

/**
 * Outcome of a single webhook delivery attempt, including HTTP status and retry info.
 */
export interface WebhookDeliveryResult {
  success: boolean;
  webhookId: string;
  eventType: WebhookEvent;
  eventId: string;
  responseStatus?: number;
  responseBody?: string;
  attemptNumber: number;
  deliveredAt?: string;
  errorMessage?: string;
}

/**
 * An app install event, optionally attributed to a prior click via device fingerprinting.
 */
export interface InstallEvent {
  id: string;
  linkId?: string;
  fingerprintHash: string;
  confidenceScore?: number;
  installedAt: string;
  deepLinkData?: any;
  ipAddress?: string;
  userAgent?: string;
  platform?: string;
}

/**
 * A post-install in-app conversion event (e.g., purchase, sign-up) tied to an install.
 */
export interface ConversionEvent {
  id: string;
  installId: string;
  eventName: string;
  eventProperties: Record<string, any>;
  revenue?: number;
  currency?: string;
  timestamp: string;
}

// Invite types

/**
 * Lifecycle status of a referral invite.
 * - `pending`: invite created, invitee has not yet paid.
 * - `consumed`: invitee paid, reward issued to inviter.
 * - `expired`: manually expired by the inviter or admin (no reward).
 */
export type InviteStatus = 'pending' | 'consumed' | 'expired';

/**
 * A referral invite record. Created when a user shares an invite link,
 * consumed when the invitee makes a payment. The reward is gated on
 * payment, not signup, to prevent fake-account farming.
 */
export interface Invite {
  id: string;
  inviterId: string;
  inviterName?: string;
  linkId?: string;
  status: InviteStatus;
  inviteeUserId?: string;
  inviteeEmail?: string;
  consumedAt?: string;
  paymentAmount?: number;
  paymentCurrency?: string;
  rewardIssued: boolean;
  rewardAmount?: number;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request body for creating a new invite.
 */
export interface CreateInviteRequest {
  inviterId: string;
  inviterName?: string;
  linkId?: string;
  metadata?: Record<string, any>;
}

/**
 * Request body for consuming an invite on payment.
 *
 * The `inviteeCreatedAt` timestamp is the invitee's account creation time
 * from the caller's auth system. It is compared against the invite's
 * `createdAt` to reject users who already existed on the platform before
 * the invite was created (already-on-platform guard).
 */
export interface ConsumeInviteRequest {
  inviteeUserId: string;
  inviteeEmail?: string;
  inviteeCreatedAt: string;
  paymentAmount: number;
  paymentCurrency: string;
  rewardAmount?: number;
}

/**
 * Result of a consume attempt, with a machine-readable rejection reason
 * when guards fail.
 */
export interface ConsumeInviteResult {
  success: boolean;
  inviteId: string;
  status: InviteStatus;
  rewardIssued: boolean;
  rejectionReason?: 'self_invite' | 'already_on_platform' | 'not_pending' | 'not_found';
  rejectionDetail?: string;
}

