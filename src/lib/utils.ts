import { nanoid } from 'nanoid';
import geoip from 'geoip-lite';
import UAParser from 'ua-parser-js';

/**
 * Generate a URL-safe random short code using nanoid.
 *
 * @param length - Number of characters in the generated code. Defaults to 8.
 * @returns A random URL-safe string of the specified length.
 */
export function generateShortCode(length: number = 8): string {
  return nanoid(length);
}

/**
 * Parse a User-Agent string into structured device and browser information.
 *
 * @param userAgent - Raw User-Agent header value from an HTTP request.
 * @returns An object containing `deviceType`, `platform`, `platformVersion`, and `browser`.
 */
export function parseUserAgent(userAgent: string) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  return {
    deviceType: result.device.type || 'desktop',
    platform: result.os.name || 'unknown',
    platformVersion: result.os.version || undefined,
    browser: result.browser.name || 'unknown',
  };
}

// Country code to name mapping (common countries)
const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  PL: 'Poland',
  BR: 'Brazil',
  MX: 'Mexico',
  AR: 'Argentina',
  IN: 'India',
  CN: 'China',
  JP: 'Japan',
  KR: 'South Korea',
  SG: 'Singapore',
  MY: 'Malaysia',
  TH: 'Thailand',
  ID: 'Indonesia',
  PH: 'Philippines',
  VN: 'Vietnam',
  ZA: 'South Africa',
  EG: 'Egypt',
  NG: 'Nigeria',
  KE: 'Kenya',
  RU: 'Russia',
  TR: 'Turkey',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  IL: 'Israel',
  NZ: 'New Zealand',
  IE: 'Ireland',
  CH: 'Switzerland',
  AT: 'Austria',
  BE: 'Belgium',
  PT: 'Portugal',
  GR: 'Greece',
  CZ: 'Czech Republic',
  HU: 'Hungary',
  RO: 'Romania',
};

/**
 * Look up geographic location data for an IP address using geoip-lite.
 *
 * @param ip - IPv4 or IPv6 address to look up.
 * @returns An object with `countryCode`, `countryName`, `region`, `city`,
 *   `latitude`, `longitude`, and `timezone`. All fields are `null` when the
 *   IP address is not found in the GeoIP database.
 */
export function getLocationFromIP(ip: string) {
  const geo = geoip.lookup(ip);

  if (!geo) {
    return {
      countryCode: null,
      countryName: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
    };
  }

  return {
    countryCode: geo.country,
    countryName: COUNTRY_NAMES[geo.country] || geo.country,
    region: geo.region,
    city: geo.city,
    latitude: geo.ll?.[0] || null,
    longitude: geo.ll?.[1] || null,
    timezone: geo.timezone,
  };
}

/**
 * Append UTM tracking parameters to a URL.
 *
 * Each key in `utmParameters` is prefixed with `utm_` before being added as a
 * query parameter (e.g., `{ source: 'email' }` → `?utm_source=email`).
 * Empty values are skipped.
 *
 * @param originalUrl - The destination URL to append parameters to.
 * @param utmParameters - Optional map of UTM parameter names (without the `utm_` prefix) to values.
 * @returns The URL string with UTM parameters appended.
 */
export function buildRedirectUrl(
  originalUrl: string,
  utmParameters?: Record<string, string>
): string {
  const url = new URL(originalUrl);

  if (utmParameters) {
    Object.entries(utmParameters).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(`utm_${key}`, value);
      }
    });
  }

  return url.toString();
}

/**
 * Detect the device platform from a User-Agent string.
 *
 * Uses simple substring matching to identify iOS and Android devices.
 * Anything that does not match is classified as `'web'`.
 *
 * @param userAgent - Raw User-Agent header value from an HTTP request.
 * @returns `'ios'`, `'android'`, or `'web'`.
 */
export function detectDevice(userAgent: string): 'ios' | 'android' | 'web' {
  const ua = userAgent.toLowerCase();

  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    return 'ios';
  }

  if (ua.includes('android')) {
    return 'android';
  }

  return 'web';
}
