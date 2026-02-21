// Template types
export interface LinkTemplateSettings {
  defaultIosUrl?: string;
  defaultAndroidUrl?: string;
  defaultWebFallbackUrl?: string;
  defaultAttributionWindowHours?: number;
  utmParameters?: UTMParameters;
  targetingRules?: TargetingRules;
  expiresAfterDays?: number;
}

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

export interface UTMParameters {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface TargetingRules {
  countries?: string[];
  devices?: ('ios' | 'android' | 'web')[];
  languages?: string[];
}

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
export type WebhookEvent = 'click_event' | 'install_event' | 'conversion_event';

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

export interface WebhookPayload {
  event: WebhookEvent;
  event_id: string;
  timestamp: string;
  data: ClickEvent | InstallEvent | ConversionEvent;
}

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

export interface ConversionEvent {
  id: string;
  installId: string;
  eventName: string;
  eventProperties: Record<string, any>;
  revenue?: number;
  currency?: string;
  timestamp: string;
}

