export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Link {
  id: string;
  userId: string;
  short_code: string;
  original_url: string;
  title?: string;
  ios_url?: string;
  android_url?: string;
  web_fallback_url?: string;
  utmParameters?: UTMParameters;
  targeting_rules?: TargetingRules;
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
  originalUrl: string;
  title?: string;
  iosUrl?: string;
  androidUrl?: string;
  webFallbackUrl?: string;
  utmParameters?: UTMParameters;
  targetingRules?: TargetingRules;
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
  data: any; // ClickEvent, InstallEvent, or ConversionEvent
}

export interface WebhookDeliveryResult {
  success: boolean;
  webhookId: string;
  eventType: WebhookEvent;
  eventId: string;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  attemptNumber: number;
  deliveredAt?: string;
}
