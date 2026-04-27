import { describe, it, expect } from 'vitest';
import {
  isIOSInAppBrowser,
  isAndroidInAppBrowser,
  pickMobileFallbackUrl,
} from './redirect.js';

// Real-world UA strings (truncated where helpful) for use across test cases.
const UA = {
  // Regular browsers — should NOT be detected as in-app
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidFirefox:
    'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',

  // iOS in-app browsers
  iosGmail:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/322.0.616052181 Safari/604.1',
  iosFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0]',
  iosInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0',
  iosOutlook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Outlook-iOS/2.0',
  iosTwitter:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.0',

  // Android in-app browsers
  androidWebview:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0]',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Instagram 320.0.0.0',
  androidLine:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Line/13.0.0',
  androidWhatsapp:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.0',
};

const URLS = {
  iosStore: 'https://apps.apple.com/app/example/id123',
  androidStore: 'https://play.google.com/store/apps/details?id=com.example',
  webFallback: 'https://example.com/landing',
};

describe('isIOSInAppBrowser', () => {
  it('detects Gmail (GSA token)', () => {
    expect(isIOSInAppBrowser(UA.iosGmail)).toBe(true);
  });
  it('detects Facebook (FBAN/FBAV)', () => {
    expect(isIOSInAppBrowser(UA.iosFacebook)).toBe(true);
  });
  it('detects Instagram', () => {
    expect(isIOSInAppBrowser(UA.iosInstagram)).toBe(true);
  });
  it('detects Outlook', () => {
    expect(isIOSInAppBrowser(UA.iosOutlook)).toBe(true);
  });
  it('detects Twitter', () => {
    expect(isIOSInAppBrowser(UA.iosTwitter)).toBe(true);
  });
  it('does not flag Safari as in-app', () => {
    expect(isIOSInAppBrowser(UA.iosSafari)).toBe(false);
  });
  it('does not flag Chrome on iOS as in-app', () => {
    expect(isIOSInAppBrowser(UA.iosChrome)).toBe(false);
  });
});

describe('isAndroidInAppBrowser', () => {
  it('detects generic Android WebView via wv) marker', () => {
    expect(isAndroidInAppBrowser(UA.androidWebview)).toBe(true);
  });
  it('detects Facebook (FB_IAB/FBAN/FBAV)', () => {
    expect(isAndroidInAppBrowser(UA.androidFacebook)).toBe(true);
  });
  it('detects Instagram', () => {
    expect(isAndroidInAppBrowser(UA.androidInstagram)).toBe(true);
  });
  it('detects Line', () => {
    expect(isAndroidInAppBrowser(UA.androidLine)).toBe(true);
  });
  it('detects WhatsApp', () => {
    expect(isAndroidInAppBrowser(UA.androidWhatsapp)).toBe(true);
  });
  it('does not flag Chrome as in-app', () => {
    expect(isAndroidInAppBrowser(UA.androidChrome)).toBe(false);
  });
  it('does not flag Firefox as in-app', () => {
    expect(isAndroidInAppBrowser(UA.androidFirefox)).toBe(false);
  });
});

describe('pickMobileFallbackUrl — iOS regular browser (Safari/Chrome)', () => {
  it('prefers iOS store URL over web fallback', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosSafari, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r).toEqual({ url: URLS.iosStore, reason: 'ios_app_store_url' });
  });
  it('falls back to web fallback when iOS store URL is absent', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosSafari, null, URLS.androidStore, URLS.webFallback);
    expect(r).toEqual({ url: URLS.webFallback, reason: 'web_fallback_url' });
  });
  it('uses iOS store URL when web fallback is absent', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosSafari, URLS.iosStore, URLS.androidStore, null);
    expect(r).toEqual({ url: URLS.iosStore, reason: 'ios_app_store_url' });
  });
  it('returns null when both iOS store URL and web fallback are absent', () => {
    expect(pickMobileFallbackUrl('ios', UA.iosSafari, null, URLS.androidStore, null)).toBeNull();
  });
});

describe('pickMobileFallbackUrl — iOS in-app browser (Gmail/FB/Instagram/etc.)', () => {
  it('prefers web fallback over iOS store URL', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosGmail, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r).toEqual({ url: URLS.webFallback, reason: 'web_fallback_url' });
  });
  it('falls back to iOS store URL when web fallback is absent', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosGmail, URLS.iosStore, URLS.androidStore, null);
    expect(r).toEqual({ url: URLS.iosStore, reason: 'ios_app_store_url' });
  });
  it('returns null when both iOS store URL and web fallback are absent', () => {
    expect(pickMobileFallbackUrl('ios', UA.iosGmail, null, URLS.androidStore, null)).toBeNull();
  });
});

describe('pickMobileFallbackUrl — Android regular browser (Chrome/Firefox)', () => {
  it('prefers Android store URL over web fallback', () => {
    const r = pickMobileFallbackUrl('android', UA.androidChrome, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r).toEqual({ url: URLS.androidStore, reason: 'android_app_store_url' });
  });
  it('falls back to web fallback when Android store URL is absent', () => {
    const r = pickMobileFallbackUrl('android', UA.androidChrome, URLS.iosStore, null, URLS.webFallback);
    expect(r).toEqual({ url: URLS.webFallback, reason: 'web_fallback_url' });
  });
  it('uses Android store URL when web fallback is absent', () => {
    const r = pickMobileFallbackUrl('android', UA.androidChrome, URLS.iosStore, URLS.androidStore, null);
    expect(r).toEqual({ url: URLS.androidStore, reason: 'android_app_store_url' });
  });
  it('returns null when both Android store URL and web fallback are absent', () => {
    expect(pickMobileFallbackUrl('android', UA.androidChrome, URLS.iosStore, null, null)).toBeNull();
  });
});

describe('pickMobileFallbackUrl — Android in-app browser (FB/Instagram/Line/WebView)', () => {
  it('prefers web fallback over Android store URL', () => {
    const r = pickMobileFallbackUrl('android', UA.androidFacebook, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r).toEqual({ url: URLS.webFallback, reason: 'web_fallback_url' });
  });
  it('detects WebView via wv) marker and prefers web fallback', () => {
    const r = pickMobileFallbackUrl('android', UA.androidWebview, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r).toEqual({ url: URLS.webFallback, reason: 'web_fallback_url' });
  });
  it('falls back to Android store URL when web fallback is absent', () => {
    const r = pickMobileFallbackUrl('android', UA.androidFacebook, URLS.iosStore, URLS.androidStore, null);
    expect(r).toEqual({ url: URLS.androidStore, reason: 'android_app_store_url' });
  });
});

describe('pickMobileFallbackUrl — reporter scenario regression test', () => {
  // Reproduces SIT-163: user creates a link with iOS, Android, and web fallback URLs;
  // mobile visitor expects the App/Play Store; previously got the web fallback.
  it('iOS Safari → iOS App Store (was: web fallback)', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosSafari, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r?.url).toBe(URLS.iosStore);
    expect(r?.reason).toBe('ios_app_store_url');
  });
  it('Android Chrome → Play Store (was: web fallback)', () => {
    const r = pickMobileFallbackUrl('android', UA.androidChrome, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r?.url).toBe(URLS.androidStore);
    expect(r?.reason).toBe('android_app_store_url');
  });
  // And the email-marketing flow that the prior fix protected stays correct:
  it('iOS Gmail in-app → web fallback (preserves UL second-chance)', () => {
    const r = pickMobileFallbackUrl('ios', UA.iosGmail, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r?.url).toBe(URLS.webFallback);
  });
  it('Android Facebook in-app → web fallback (preserves UL second-chance)', () => {
    const r = pickMobileFallbackUrl('android', UA.androidFacebook, URLS.iosStore, URLS.androidStore, URLS.webFallback);
    expect(r?.url).toBe(URLS.webFallback);
  });
});
