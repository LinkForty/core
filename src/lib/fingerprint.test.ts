import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module so tests don't require a real Postgres connection.
vi.mock('./database', () => ({
  db: {
    query: vi.fn(),
  },
}));

import * as fingerprint from './fingerprint';
import { db } from './database';

const mockDbQuery = db.query as unknown as ReturnType<typeof vi.fn>;

const baseFingerprint = {
  ipAddress: '192.168.1.100',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36',
  timezone: 'America/Los_Angeles',
  language: 'en-US',
  screenWidth: 1080,
  screenHeight: 1920,
  platform: 'Windows',
  platformVersion: '10',
};

describe('generateFingerprintHash', () => {
  it('produces a deterministic 64-character SHA-256 hash', () => {
    const hash1 = fingerprint.generateFingerprintHash(baseFingerprint);
    const hash2 = fingerprint.generateFingerprintHash(baseFingerprint);

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different data', () => {
    const other = { ...baseFingerprint, ipAddress: '10.0.0.1' };
    const hash1 = fingerprint.generateFingerprintHash(baseFingerprint);
    const hash2 = fingerprint.generateFingerprintHash(other);

    expect(hash1).not.toBe(hash2);
  });
});

describe('calculateConfidenceScore', () => {
  it('returns 0 score when nothing matches', () => {
    const a = { ...baseFingerprint };
    const b = {
      ...baseFingerprint,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
      timezone: 'Asia/Tokyo',
      language: 'ja-JP',
      screenWidth: 800,
      screenHeight: 600,
      platform: 'Macintosh',
      platformVersion: '11.0',
    };

    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(a, b);

    expect(score).toBe(0);
    expect(matchedFactors).toEqual([]);
  });

  it('matches IP within the same /24 subnet and normalizes user agent', () => {
    const click = {
      ...baseFingerprint,
      ipAddress: '192.168.1.250',
      timezone: 'Africa/Cairo',
      language: 'fr-FR',
      screenWidth: 800,
      screenHeight: 600,
      platform: 'Linux',
    };

    const install = {
      ...baseFingerprint,
      ipAddress: '192.168.1.123',
      userAgent: baseFingerprint.userAgent.replace('Chrome/95.0.4638.69', 'Chrome/116.0.0.0'),
      timezone: 'Europe/London',
      language: 'de-DE',
      screenWidth: 1200,
      screenHeight: 900,
      platform: 'Windows',
    };

    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(click, install);

    expect(score).toBe(70);
    expect(matchedFactors).toContain('ip');
    expect(matchedFactors).toContain('user_agent');
  });

  it('matches language by first two characters', () => {
    const a = {
      ...baseFingerprint,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
      timezone: 'Asia/Tokyo',
      screenWidth: 800,
      screenHeight: 600,
      platform: 'Macintosh',
      platformVersion: '11.0',
      language: 'en-US',
    };

    const b = {
      ...a,
      ipAddress: '172.16.0.1',
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) Chrome/91.0.4472.120 Mobile Safari/537.36',
      timezone: 'UTC',
      screenWidth: 1024,
      screenHeight: 768,
      platform: 'Linux',
      platformVersion: '10',
      language: 'en-GB',
    };

    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(a, b);

    expect(score).toBe(10);
    expect(matchedFactors).toEqual(['language']);
  });

  it('matches timezone and resolution', () => {
    const a = {
      ...baseFingerprint,
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
      language: 'ja-JP',
      platform: 'Macintosh',
      platformVersion: '11.0',
      timezone: 'UTC',
      screenWidth: 100,
      screenHeight: 200,
    };

    const b = {
      ...a,
      ipAddress: '172.16.0.1',
      userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G973F) Chrome/91.0.4472.120 Mobile Safari/537.36',
      language: 'fr-FR',
    };

    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(a, b);
    expect(score).toBe(20);
    expect(matchedFactors.sort()).toEqual(['screen', 'timezone'].sort());
  });
});

describe('matchInstallToClick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    mockDbQuery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when there are no click rows', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await fingerprint.matchInstallToClick(baseFingerprint);
    expect(result).toBeNull();
  });

  it('returns the best match above the confidence threshold', async () => {
    const clickTime = new Date('2024-12-31T23:00:00Z');

    // First row: only IP match (score 40)
    const rowA = {
      click_id: 'click-a',
      link_id: 'link-a',
      clicked_at: clickTime.toISOString(),
      attribution_window_hours: 24,
      ip_address: '192.168.1.200',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
      timezone: 'Asia/Tokyo',
      language: 'ja-JP',
      screen_width: 720,
      screen_height: 1280,
      platform: 'Macintosh',
      platform_version: '11.0',
    };

    // Second row: IP + user agent + timezone (score 80)
    const rowB = {
      click_id: 'click-b',
      link_id: 'link-b',
      clicked_at: clickTime.toISOString(),
      attribution_window_hours: 24,
      ip_address: '192.168.1.250',
      user_agent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
      timezone: 'America/Los_Angeles',
      language: 'en-US',
      screen_width: 1080,
      screen_height: 1920,
      platform: 'Windows',
      platform_version: '10',
    };

    mockDbQuery.mockResolvedValueOnce({ rows: [rowA, rowB] });

    const installFingerprint = {
      ...baseFingerprint,
      ipAddress: '192.168.1.123',
      userAgent: baseFingerprint.userAgent.replace('Chrome/95.0.4638.69', 'Chrome/116.0.0.0'),
    };

    const result = await fingerprint.matchInstallToClick(installFingerprint);

    expect(result).not.toBeNull();
    expect(result?.clickId).toBe('click-b');
    expect(result?.confidenceScore).toBe(100);
    expect(result?.matchedFactors).toEqual(expect.arrayContaining(['ip', 'user_agent', 'timezone']));
  });

  it('skips clicks that are outside the attribution window', async () => {
    const oldClickTime = new Date('2024-01-01T00:00:00Z');

    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          click_id: 'click-old',
          link_id: 'link-old',
          clicked_at: oldClickTime.toISOString(),
          attribution_window_hours: 1,
          ip_address: baseFingerprint.ipAddress,
          user_agent: baseFingerprint.userAgent,
          timezone: baseFingerprint.timezone,
          language: baseFingerprint.language,
          screen_width: baseFingerprint.screenWidth,
          screen_height: baseFingerprint.screenHeight,
          platform: baseFingerprint.platform,
          platform_version: baseFingerprint.platformVersion,
        },
      ],
    });

    const result = await fingerprint.matchInstallToClick(baseFingerprint);
    expect(result).toBeNull();
  });
});

describe('recordInstallEvent', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  it('inserts an install event and returns the install id when no match is found', async () => {
    // matchInstallToClick is invoked internally by recordInstallEvent.
    // The first db query is used to find click events. Return an empty list to force a null match.
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-123', deep_link_data: {} }] });

    const result = await fingerprint.recordInstallEvent(baseFingerprint, 'device-1');

    expect(result.installId).toBe('install-123');
    expect(result.match).toBeNull();
    expect(result.deepLinkData).toEqual({});

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining([null, null, expect.any(String), null, expect.any(String), expect.any(String), null, null, null, null, null, null, null, 'device-1', null])
    );
  });
});
