import { describe, it, expect } from 'vitest';
import {
  toDeepLinkPayload,
  CANONICAL_DEEP_LINK_KEYS,
  type DeepLinkLinkRow,
} from './deep-link-payload.js';

const link: DeepLinkLinkRow = {
  id: 'link-123',
  short_code: 'abc123',
  original_url: 'https://example.com/product/456',
  deep_link_path: '/product/456',
  app_scheme: 'myapp',
  ios_app_store_url: 'https://apps.apple.com/app/id123',
  android_app_store_url: 'https://play.google.com/store/apps/details?id=com.example',
  web_fallback_url: 'https://example.com',
  utm_parameters: { source: 'facebook', campaign: 'summer' },
  targeting_rules: { countries: ['US'] },
  deep_link_parameters: { productId: '456' },
};

const clickedAt = new Date('2026-01-15T10:30:00.000Z');

/** How the install endpoint projects a matched link. */
function installPayload(row: DeepLinkLinkRow = link) {
  return toDeepLinkPayload(row, {
    clickedAt,
    isDeferred: true,
    confidenceScore: 85,
    matchedFactors: ['userAgent', 'timezone'],
    legacyInstallKeys: true,
  });
}

/** How the resolve endpoint projects a directly opened link. */
function resolvePayload(row: DeepLinkLinkRow = link) {
  return toDeepLinkPayload(row, {
    clickedAt: clickedAt.toISOString(),
    isDeferred: false,
  });
}

describe('toDeepLinkPayload', () => {
  it('projects a link into the shape the SDK DeepLinkData model expects', () => {
    expect(resolvePayload()).toEqual({
      shortCode: 'abc123',
      linkId: 'link-123',
      deepLinkPath: '/product/456',
      appScheme: 'myapp',
      iosUrl: 'https://apps.apple.com/app/id123',
      androidUrl: 'https://play.google.com/store/apps/details?id=com.example',
      webUrl: 'https://example.com',
      utmParameters: { source: 'facebook', campaign: 'summer' },
      customParameters: { productId: '456' },
      clickedAt: '2026-01-15T10:30:00.000Z',
      isDeferred: false,
    });
  });

  it('normalizes a Date clickedAt to an ISO string', () => {
    expect(installPayload().clickedAt).toBe('2026-01-15T10:30:00.000Z');
  });

  it('omits empty canonical fields rather than sending null', () => {
    const payload = resolvePayload({ short_code: 'bare' });

    expect(payload.shortCode).toBe('bare');
    expect('deepLinkPath' in payload).toBe(false);
    expect('appScheme' in payload).toBe(false);
    expect('webUrl' in payload).toBe(false);
    expect('linkId' in payload).toBe(false);
  });

  it('carries attribution metadata on deferred opens only', () => {
    const deferred = installPayload();
    expect(deferred.isDeferred).toBe(true);
    expect(deferred.confidenceScore).toBe(85);
    expect(deferred.matchedFactors).toEqual(['userAgent', 'timezone']);

    const direct = resolvePayload();
    expect(direct.isDeferred).toBe(false);
    expect('confidenceScore' in direct).toBe(false);
    expect('matchedFactors' in direct).toBe(false);
  });

  it('reports a zero confidence score rather than dropping it', () => {
    const payload = toDeepLinkPayload(link, {
      clickedAt,
      isDeferred: true,
      confidenceScore: 0,
      matchedFactors: [],
    });

    expect(payload.confidenceScore).toBe(0);
    expect(payload.matchedFactors).toEqual([]);
  });
});

/**
 * The contract that keeps the install and resolve payloads from drifting apart
 * again. Both endpoints describe the same link to the same SDK model, so every
 * canonical field must carry the same value on both paths.
 */
describe('install and resolve payload contract', () => {
  it('agrees field for field on every canonical key', () => {
    const install = installPayload() as unknown as Record<string, unknown>;
    const resolve = resolvePayload() as unknown as Record<string, unknown>;

    for (const key of CANONICAL_DEEP_LINK_KEYS) {
      if (key === 'isDeferred') continue; // The one field that must differ.
      expect(resolve[key], `resolve.${key}`).toEqual(install[key]);
    }
  });

  it('gives the deferred payload every field an app needs to route', () => {
    const payload = installPayload();

    // The whole point of a deferred deep link: a newly installed user lands on
    // the right screen, and the first session is credited to the link.
    expect(payload.deepLinkPath).toBe('/product/456');
    expect(payload.appScheme).toBe('myapp');
    expect(payload.customParameters).toEqual({ productId: '456' });
    expect(payload.linkId).toBe('link-123');
  });
});

/**
 * Every SDK already in the field reads the pre-1.22 install keys. App updates
 * take weeks to roll out, so these must keep their exact previous values —
 * including nulls, which is why they are asserted with `toBe`/`in` rather than
 * a loose truthiness check.
 */
describe('legacy install keys', () => {
  it('emits the old aliases alongside the canonical ones', () => {
    const payload = installPayload();

    expect(payload.originalUrl).toBe('https://example.com/product/456');
    expect(payload.webFallbackUrl).toBe('https://example.com');
    expect(payload.targetingRules).toEqual({ countries: ['US'] });
    expect(payload.deepLinkParameters).toEqual({ productId: '456' });

    // The canonical spellings of the same values ship in the same payload.
    expect(payload.webUrl).toBe(payload.webFallbackUrl);
    expect(payload.customParameters).toEqual(payload.deepLinkParameters);
  });

  it('keeps null legacy values present rather than omitting the key', () => {
    const payload = installPayload({ short_code: 'bare' });

    expect(payload.originalUrl).toBeNull();
    expect(payload.webFallbackUrl).toBeNull();
    expect(payload.targetingRules).toBeNull();
    expect(payload.deepLinkParameters).toBeNull();
  });

  it('does not leak legacy keys into the resolve payload', () => {
    const payload = resolvePayload() as unknown as Record<string, unknown>;

    expect('originalUrl' in payload).toBe(false);
    expect('webFallbackUrl' in payload).toBe(false);
    expect('targetingRules' in payload).toBe(false);
    expect('deepLinkParameters' in payload).toBe(false);
  });
});
