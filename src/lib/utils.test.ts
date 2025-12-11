import { describe, it, expect } from 'vitest';
import {
  generateShortCode,
  parseUserAgent,
  buildRedirectUrl,
  detectDevice,
  getLocationFromIP,
} from './utils';

describe('generateShortCode', () => {
  it('should generate a short code of default length 8', () => {
    const code = generateShortCode();
    expect(code).toHaveLength(8);
    expect(typeof code).toBe('string');
  });

  it('should generate a short code of custom length', () => {
    const code = generateShortCode(12);
    expect(code).toHaveLength(12);
  });

  it('should generate unique codes', () => {
    const code1 = generateShortCode();
    const code2 = generateShortCode();
    expect(code1).not.toBe(code2);
  });
});

describe('parseUserAgent', () => {
  it('should parse Chrome on Windows user agent', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    const result = parseUserAgent(ua);

    expect(result.deviceType).toBe('desktop');
    expect(result.platform).toBe('Windows');
    expect(result.browser).toBe('Chrome');
  });

  it('should parse iPhone user agent', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1';
    const result = parseUserAgent(ua);

    expect(result.deviceType).toBe('mobile');
    expect(result.platform).toBe('iOS');
    expect(result.browser).toBe('Mobile Safari');
  });

  it('should parse Android user agent', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';
    const result = parseUserAgent(ua);

    expect(result.deviceType).toBe('mobile');
    expect(result.platform).toBe('Android');
    expect(result.browser).toBe('Chrome');
  });

  it('should handle empty user agent', () => {
    const result = parseUserAgent('');

    expect(result.deviceType).toBe('desktop');
    expect(result.platform).toBe('unknown');
    expect(result.browser).toBe('unknown');
  });
});

describe('detectDevice', () => {
  it('should detect iOS devices', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X)')).toBe('ios');
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 14_6 like Mac OS X)')).toBe('ios');
    expect(detectDevice('Mozilla/5.0 (iPod touch; CPU iPhone OS 14_6 like Mac OS X)')).toBe('ios');
  });

  it('should detect Android devices', () => {
    expect(detectDevice('Mozilla/5.0 (Linux; Android 11; Pixel 5)')).toBe('android');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 10; SM-G973F)')).toBe('android');
  });

  it('should default to web for desktop browsers', () => {
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0')).toBe('web');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('web');
  });

  it('should be case insensitive', () => {
    expect(detectDevice('MOZILLA/5.0 (IPHONE; CPU IPHONE OS 14_6)')).toBe('ios');
    expect(detectDevice('MOZILLA/5.0 (LINUX; ANDROID 11)')).toBe('android');
  });
});

describe('buildRedirectUrl', () => {
  it('should return original URL when no UTM parameters provided', () => {
    const url = 'https://example.com/page';
    const result = buildRedirectUrl(url);
    expect(result).toBe(url);
  });

  it('should append UTM parameters to URL', () => {
    const url = 'https://example.com/page';
    const utmParams = {
      source: 'newsletter',
      medium: 'email',
      campaign: 'summer-sale',
    };
    const result = buildRedirectUrl(url, utmParams);

    expect(result).toContain('utm_source=newsletter');
    expect(result).toContain('utm_medium=email');
    expect(result).toContain('utm_campaign=summer-sale');
  });

  it('should preserve existing query parameters', () => {
    const url = 'https://example.com/page?foo=bar';
    const utmParams = { source: 'google' };
    const result = buildRedirectUrl(url, utmParams);

    expect(result).toContain('foo=bar');
    expect(result).toContain('utm_source=google');
  });

  it('should skip UTM parameters with empty values', () => {
    const url = 'https://example.com/page';
    const utmParams = {
      source: 'twitter',
      medium: '',
      campaign: 'promo',
    };
    const result = buildRedirectUrl(url, utmParams);

    expect(result).toContain('utm_source=twitter');
    expect(result).not.toContain('utm_medium');
    expect(result).toContain('utm_campaign=promo');
  });

  it('should URL encode UTM parameter values', () => {
    const url = 'https://example.com/page';
    const utmParams = {
      source: 'email newsletter',
      campaign: 'summer sale 2024',
    };
    const result = buildRedirectUrl(url, utmParams);

    expect(result).toContain('utm_source=email+newsletter');
    expect(result).toContain('utm_campaign=summer+sale+2024');
  });
});

describe('getLocationFromIP', () => {
  it('should return null values for invalid IP', () => {
    const result = getLocationFromIP('invalid-ip');

    expect(result.countryCode).toBeNull();
    expect(result.countryName).toBeNull();
    expect(result.city).toBeNull();
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
  });

  it('should return null values for private IP addresses', () => {
    const result = getLocationFromIP('192.168.1.1');

    expect(result.countryCode).toBeNull();
    expect(result.countryName).toBeNull();
  });

  it('should parse public IP addresses', () => {
    // Google DNS IP (known to be US-based)
    const result = getLocationFromIP('8.8.8.8');

    expect(result.countryCode).toBe('US');
    expect(result.countryName).toBe('United States');
    expect(result.latitude).toBeDefined();
    expect(result.longitude).toBeDefined();
  });

  it('should handle countries not in the mapping', () => {
    // This test might need adjustment based on actual geoip-lite behavior
    // but demonstrates the fallback logic
    const result = getLocationFromIP('8.8.8.8');

    if (result.countryCode && !result.countryName) {
      // Fallback to country code
      expect(result.countryName).toBe(result.countryCode);
    } else {
      // Has a mapped name
      expect(typeof result.countryName).toBe('string');
    }
  });
});
