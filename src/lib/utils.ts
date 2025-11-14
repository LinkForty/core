import { nanoid } from 'nanoid';
import geoip from 'geoip-lite';
import UAParser from 'ua-parser-js';

export function generateShortCode(length: number = 8): string {
  return nanoid(length);
}

export function parseUserAgent(userAgent: string) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  return {
    deviceType: result.device.type || 'desktop',
    platform: result.os.name || 'unknown',
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
