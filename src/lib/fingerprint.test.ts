import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock the database module so tests don't require a real Postgres connection.
vi.mock('./database', () => ({
  db: {
    query: vi.fn(),
  },
}));

import * as fingerprint from './fingerprint';
import { db } from './database';

const mockDbQuery = db.query as Mock;

const baseFingerprint = {
  ipAddress: '24.5.10.100',
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
      ipAddress: '24.5.10.250',
      timezone: 'Africa/Cairo',
      language: 'fr-FR',
      screenWidth: 800,
      screenHeight: 600,
      platform: 'Linux',
    };

    const install = {
      ...baseFingerprint,
      ipAddress: '24.5.10.123',
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

describe('isAttributableIp', () => {
  it('treats public IPv4 as attributable', () => {
    expect(fingerprint.isAttributableIp('24.5.10.100')).toBe(true);
    expect(fingerprint.isAttributableIp('8.8.8.8')).toBe(true);
  });

  it('rejects CGNAT (100.64.0.0/10) — the Marriage365 case', () => {
    expect(fingerprint.isAttributableIp('100.64.0.5')).toBe(false);
    expect(fingerprint.isAttributableIp('100.127.255.254')).toBe(false);
  });

  it('rejects RFC1918 private, loopback and link-local', () => {
    expect(fingerprint.isAttributableIp('10.0.0.1')).toBe(false);
    expect(fingerprint.isAttributableIp('172.16.0.1')).toBe(false);
    expect(fingerprint.isAttributableIp('192.168.1.1')).toBe(false);
    expect(fingerprint.isAttributableIp('127.0.0.1')).toBe(false);
    expect(fingerprint.isAttributableIp('169.254.1.1')).toBe(false);
  });

  it('handles IPv6: public attributable, ULA/link-local/loopback not', () => {
    expect(fingerprint.isAttributableIp('2600:1700:6508:8040::1')).toBe(true);
    expect(fingerprint.isAttributableIp('fd00::1')).toBe(false); // ULA
    expect(fingerprint.isAttributableIp('fe80::1')).toBe(false); // link-local
    expect(fingerprint.isAttributableIp('::1')).toBe(false); // loopback
  });

  it('unwraps IPv4-mapped IPv6 before classifying', () => {
    expect(fingerprint.isAttributableIp('::ffff:100.64.0.5')).toBe(false);
    expect(fingerprint.isAttributableIp('::ffff:24.5.10.100')).toBe(true);
  });

  it('returns false for empty/garbage input', () => {
    expect(fingerprint.isAttributableIp('')).toBe(false);
    expect(fingerprint.isAttributableIp('not-an-ip')).toBe(false);
  });
});

describe('calculateConfidenceScore — shared-IP filter', () => {
  it('does NOT award the IP score for two devices sharing a CGNAT /24', () => {
    // Exactly the Marriage365 leak: unrelated installs collapsing onto 100.64.0.x.
    const click = { ...baseFingerprint, ipAddress: '100.64.0.5' };
    const install = { ...baseFingerprint, ipAddress: '100.64.0.9' };

    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(click, install);

    expect(matchedFactors).not.toContain('ip');
    // UA(30)+TZ(10)+lang(10)+screen(10) = 60, below the 70 threshold → no match.
    expect(score).toBe(60);
    expect(score).toBeLessThan(fingerprint.CONFIDENCE_THRESHOLD);
  });

  it('still awards the IP score for two devices sharing a public /24', () => {
    const click = { ...baseFingerprint, ipAddress: '24.5.10.5' };
    const install = { ...baseFingerprint, ipAddress: '24.5.10.9' };

    const { matchedFactors } = fingerprint.calculateConfidenceScore(click, install);
    expect(matchedFactors).toContain('ip');
  });
});

describe('calculateConfidenceScore - deferred install (SDK vs browser)', () => {
  // A real deferred install: the click carries a Safari user agent, the install
  // carries the string FingerprintCollector builds. Same device, same wifi.
  const safariClick = {
    ipAddress: '103.28.14.77',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    timezone: 'Asia/Jakarta',
    language: 'en-US',
    screenWidth: 393, // CSS pixels
    screenHeight: 852,
    platform: 'ios', // detectDevice()
    platformVersion: '17.5',
  };

  const sdkInstall = {
    ipAddress: '103.28.14.77',
    userAgent: 'MNC Play/1.0.0 iOS/17.5', // generateUserAgent()
    timezone: 'Asia/Jakarta',
    language: 'en_US', // Locale.current.identifier
    screenWidth: 1179, // native pixels (bounds * scale)
    screenHeight: 2556,
    platform: 'iOS',
    platformVersion: '17.5',
  };

  it('attributes an iOS install that matches its click', () => {
    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(
      sdkInstall,
      safariClick
    );

    expect(score).toBeGreaterThanOrEqual(fingerprint.CONFIDENCE_THRESHOLD);
    expect(matchedFactors).toEqual(
      expect.arrayContaining(['ip', 'platform', 'platform_version', 'timezone', 'language'])
    );
  });

  it('matches native-pixel screens against CSS-pixel screens', () => {
    const { matchedFactors } = fingerprint.calculateConfidenceScore(sdkInstall, safariClick);
    expect(matchedFactors).toContain('screen');
  });

  it('attributes an Android install that matches its click', () => {
    const chromeClick = {
      ...safariClick,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      platform: 'android',
      platformVersion: '14',
      screenWidth: 412,
      screenHeight: 915,
    };
    const androidInstall = {
      ...sdkInstall,
      userAgent: 'MNC Play/1.0.0 Android/14',
      platform: 'Android',
      platformVersion: '14',
      screenWidth: 1080,
      screenHeight: 2400,
    };

    const { score } = fingerprint.calculateConfidenceScore(androidInstall, chromeClick);
    expect(score).toBeGreaterThanOrEqual(fingerprint.CONFIDENCE_THRESHOLD);
  });

  it('still attributes when the click carries no screen dimensions', () => {
    const noScreen = { ...safariClick, screenWidth: undefined, screenHeight: undefined };

    const { score } = fingerprint.calculateConfidenceScore(sdkInstall, noScreen);
    expect(score).toBeGreaterThanOrEqual(fingerprint.CONFIDENCE_THRESHOLD);
  });

  it('disqualifies a click from a different platform', () => {
    const androidClick = {
      ...safariClick,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      platform: 'android',
      platformVersion: '14',
    };

    const { score, matchedFactors } = fingerprint.calculateConfidenceScore(
      sdkInstall,
      androidClick
    );

    expect(score).toBe(0);
    expect(matchedFactors).toEqual([]);
  });

  it('does not attribute an install seen on a different network', () => {
    const { score } = fingerprint.calculateConfidenceScore(
      { ...sdkInstall, ipAddress: '114.10.9.3' },
      safariClick
    );

    expect(score).toBeLessThan(fingerprint.CONFIDENCE_THRESHOLD);
  });

  describe('Safari on iOS 26 and later, which reports iOS 18 in its user agent', () => {
    // Safari 26 on iOS 26.2. No timezone or screen: a plain redirect click.
    const frozenClick = {
      ipAddress: '103.28.14.77',
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      language: 'en-US',
      platform: 'ios',
      platformVersion: '18.7',
    };
    const install26 = {
      ...sdkInstall,
      userAgent: 'MNC Play/1.0.0 iOS/26.2',
      platformVersion: '26.2',
      language: 'en-US',
    };

    it('matches the version of an SDK reporting iOS 26', () => {
      const { score, matchedFactors } = fingerprint.calculateConfidenceScore(install26, frozenClick);

      expect(matchedFactors).toEqual(['ip', 'platform', 'platform_version', 'language']);
      expect(score).toBe(80);
    });

    it('matches whichever side the click is on', () => {
      const { matchedFactors } = fingerprint.calculateConfidenceScore(frozenClick, install26);
      expect(matchedFactors).toContain('platform_version');
    });

    it('still matches an SDK reporting iOS 18', () => {
      const install18 = { ...install26, userAgent: 'MNC Play/1.0.0 iOS/18.7', platformVersion: '18.7' };

      const { matchedFactors } = fingerprint.calculateConfidenceScore(install18, frozenClick);
      expect(matchedFactors).toContain('platform_version');
    });

    it('does not match an SDK reporting an iOS version below 18', () => {
      const install17 = { ...install26, userAgent: 'MNC Play/1.0.0 iOS/17.5', platformVersion: '17.5' };

      const { matchedFactors } = fingerprint.calculateConfidenceScore(install17, frozenClick);
      expect(matchedFactors).not.toContain('platform_version');
    });

    it('does not let an older browser version match a newer SDK', () => {
      const click17 = {
        ...frozenClick,
        userAgent: safariClick.userAgent,
        platformVersion: '17.5',
      };

      const { matchedFactors } = fingerprint.calculateConfidenceScore(install26, click17);
      expect(matchedFactors).not.toContain('platform_version');
    });

    it('leaves Android versions compared exactly', () => {
      const chromeClick = {
        ...frozenClick,
        userAgent:
          'Mozilla/5.0 (Linux; Android 18; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        platform: 'android',
        platformVersion: '18',
      };
      const android19 = { ...install26, userAgent: 'MNC Play/1.0.0 Android/19', platform: 'Android', platformVersion: '19' };

      const { matchedFactors } = fingerprint.calculateConfidenceScore(android19, chromeClick);
      expect(matchedFactors).not.toContain('platform_version');
    });
  });

  it('still requires exact screen equality between two browsers', () => {
    const a = { ...safariClick, screenWidth: 800, screenHeight: 600 };
    const b = { ...safariClick, screenWidth: 1200, screenHeight: 900 };

    const { matchedFactors } = fingerprint.calculateConfidenceScore(a, b);
    expect(matchedFactors).not.toContain('screen');
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
      ip_address: '24.5.10.200',
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
      timezone: 'Asia/Tokyo',
      language: 'ja-JP',
      screen_width: 720,
      screen_height: 1280,
      platform: 'Macintosh',
      platform_version: '11.0',
    };

    // Second row: IP + user agent + timezone + language + screen (score 100)
    const rowB = {
      click_id: 'click-b',
      link_id: 'link-b',
      clicked_at: clickTime.toISOString(),
      attribution_window_hours: 24,
      ip_address: '24.5.10.250',
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
      ipAddress: '24.5.10.123',
      userAgent: baseFingerprint.userAgent.replace('Chrome/95.0.4638.69', 'Chrome/116.0.0.0'),
    };

    const result = await fingerprint.matchInstallToClick(installFingerprint);

    expect(result).not.toBeNull();
    expect(result?.clickId).toBe('click-b');
    expect(result?.confidenceScore).toBe(100);
    expect(result?.matchedFactors).toEqual(expect.arrayContaining(['ip', 'user_agent', 'timezone', 'language', 'screen']));
  });

  it("applies each link's window, in minutes when set, on the database clock", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await fingerprint.matchInstallToClick(baseFingerprint);

    const [sql] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/ce\.clicked_at >= NOW\(\) - make_interval\(mins => COALESCE\(\s*l\.attribution_window_minutes,/);
    expect(sql).toMatch(/COALESCE\(NULLIF\(l\.attribution_window_hours, 0\), 168\) \* 60/);
  });

  it('skips a matched click on a link that hands a click to one install only', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await fingerprint.matchInstallToClick(baseFingerprint);

    expect(mockDbQuery.mock.calls[0][0]).toMatch(/AND \(l\.one_install_per_click = false OR ce\.install_matched_at IS NULL\)/);
  });
});

describe('attributionNetwork', () => {
  it('is the /24 for IPv4', () => {
    expect(fingerprint.attributionNetwork('24.5.10.100')).toBe('24.5.10.0/24');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(fingerprint.attributionNetwork('::ffff:24.5.10.100')).toBe('24.5.10.0/24');
  });

  it('is the /64 for IPv6, however the address is spelled', () => {
    const expected = '2001:db8:0:0::/64';
    expect(fingerprint.attributionNetwork('2001:db8::1')).toBe(expected);
    expect(fingerprint.attributionNetwork('2001:0DB8:0000:0000:0000:0000:0000:0002')).toBe(expected);
    expect(fingerprint.attributionNetwork('2001:db8:0:0:abcd::7')).toBe(expected);
  });

  it('expands an embedded IPv4 tail', () => {
    expect(fingerprint.attributionNetwork('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64');
  });

  it('is null for anything unparseable', () => {
    expect(fingerprint.attributionNetwork('')).toBeNull();
    expect(fingerprint.attributionNetwork('not-an-ip')).toBeNull();
    expect(fingerprint.attributionNetwork('1.2.3')).toBeNull();
    expect(fingerprint.attributionNetwork('2001::db8::1')).toBeNull();
    expect(fingerprint.attributionNetwork('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('calculateConfidenceScore — IPv6 networks', () => {
  it('matches two spellings of addresses in the same /64', () => {
    const { matchedFactors } = fingerprint.calculateConfidenceScore(
      { ...baseFingerprint, ipAddress: '2001:db8:1:2::5' },
      { ...baseFingerprint, ipAddress: '2001:0db8:0001:0002:ffff:0:0:9' }
    );
    expect(matchedFactors).toContain('ip');
  });

  it('does not match addresses in different /64s', () => {
    const { matchedFactors } = fingerprint.calculateConfidenceScore(
      { ...baseFingerprint, ipAddress: '2001:db8:1:2::5' },
      { ...baseFingerprint, ipAddress: '2001:db8:1:3::5' }
    );
    expect(matchedFactors).not.toContain('ip');
  });
});

describe('matchInstallToClick — candidate selection', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  it('cannot reach the threshold without the IP signal, which is what makes network filtering safe', () => {
    expect(fingerprint.MAX_SCORE_WITHOUT_IP).toBeLessThan(fingerprint.CONFIDENCE_THRESHOLD);

    // A candidate matching on everything but IP, scored for real.
    const { score } = fingerprint.calculateConfidenceScore(baseFingerprint, {
      ...baseFingerprint,
      ipAddress: '31.13.64.1',
    });
    expect(score).toBe(fingerprint.MAX_SCORE_WITHOUT_IP);
  });

  it('selects only clicks from the install network, newest first', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await fingerprint.matchInstallToClick(baseFingerprint);

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/df\.ip_address <<= \$1::cidr/);
    expect(sql).toMatch(/ORDER BY ce\.clicked_at DESC/);
    expect(sql).not.toMatch(/organization_id/);
    expect(params).toEqual(['24.5.10.0/24']);
  });

  it('limits candidates to the scoped organization', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await fingerprint.matchInstallToClick(baseFingerprint, undefined, { organizationId: 'org-1' });

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/AND l\.organization_id = \$2/);
    expect(params).toEqual(['24.5.10.0/24', 'org-1']);
  });

  it('leaves out the clicks it is told to skip', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await fingerprint.matchInstallToClick(baseFingerprint, undefined, {}, ['click-1']);

    const [sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/AND ce\.id <> ALL\(\$2::uuid\[\]\)/);
    expect(params).toEqual(['24.5.10.0/24', ['click-1']]);
  });

  it('matches nothing, without querying, when the scope says so', async () => {
    expect(await fingerprint.matchInstallToClick(baseFingerprint, undefined, { matchNothing: true })).toBeNull();
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('does not query at all for an install from a shared address', async () => {
    for (const ipAddress of ['100.64.1.2', '10.0.0.5', '192.168.1.20', '', 'garbage']) {
      expect(await fingerprint.matchInstallToClick({ ...baseFingerprint, ipAddress })).toBeNull();
    }
    expect(mockDbQuery).not.toHaveBeenCalled();
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
    // Null, not `{}` — an SDK decodes this field into a model with a required
    // short code, so an empty object fails to decode the whole response.
    expect(result.deepLinkData).toBeNull();

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(mockDbQuery).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.arrayContaining([null, null, expect.any(String), null, expect.any(String), expect.any(String), null, null, null, null, null, null, null, 'device-1', null])
    );
  });

  it('forwards sdk name + version as the last two positional params of the install insert (guards column misalignment)', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // matchInstallToClick -> no match
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-456', deep_link_data: {} }] });

    await fingerprint.recordInstallEvent(baseFingerprint, 'device-1', undefined, {
      name: 'react-native',
      version: '1.4.0',
    });

    const [sql, params] = mockDbQuery.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO install_events/);
    expect(sql).toMatch(/sdk_name/);
    expect(sql).toMatch(/sdk_version/);
    // sdk_name/$16, sdk_version/$17, then attribution_method/$18, matched_factors/$19, competing_links/$20
    expect(params).toHaveLength(20);
    expect(params[15]).toBe('react-native'); // sdk_name
    expect(params[16]).toBe('1.4.0');        // sdk_version
    expect(params[17]).toBe('none');         // attribution_method (no fingerprint match)
    expect(params[18]).toBeNull();           // matched_factors (no match)
    expect(params[19]).toBeNull();           // competing_links (no match)
  });

  it('stores null sdk on the install row when the metadata is absent or empty', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-789', deep_link_data: {} }] });

    await fingerprint.recordInstallEvent(baseFingerprint, 'device-1', undefined, { name: '', version: undefined });

    const params = mockDbQuery.mock.calls[1][1];
    expect(params[15]).toBeNull(); // sdk_name '' -> null
    expect(params[16]).toBeNull(); // sdk_version undefined -> null
  });

  it('forwards the match scope to the click query', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-scope', deep_link_data: {} }] });

    await fingerprint.recordInstallEvent(baseFingerprint, undefined, undefined, undefined, {
      organizationId: 'org-9',
    });

    expect(mockDbQuery.mock.calls[0][1]).toContain('org-9');
  });
});

describe('matchInstallToClick — competing links', () => {
  const row = (clickId: string, linkId: string, overrides: Record<string, unknown> = {}) => ({
    click_id: clickId,
    link_id: linkId,
    clicked_at: new Date().toISOString(),
    link_params: null,
    one_install_per_click: false,
    ip_address: baseFingerprint.ipAddress,
    user_agent: baseFingerprint.userAgent,
    timezone: baseFingerprint.timezone,
    language: baseFingerprint.language,
    screen_width: baseFingerprint.screenWidth,
    screen_height: baseFingerprint.screenHeight,
    platform: baseFingerprint.platform,
    platform_version: baseFingerprint.platformVersion,
    ...overrides,
  });

  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  it('is 0 when only one link has a qualifying click', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [row('c1', 'link-a'), row('c2', 'link-a')] });
    expect((await fingerprint.matchInstallToClick(baseFingerprint))?.competingLinks).toBe(0);
  });

  it('counts the other links with a qualifying click', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [row('c1', 'link-a'), row('c2', 'link-b'), row('c3', 'link-c'), row('c4', 'link-b')],
    });
    const match = await fingerprint.matchInstallToClick(baseFingerprint);
    expect(match?.linkId).toBe('link-a');
    expect(match?.competingLinks).toBe(2);
  });

  it('leaves out clicks below the threshold', async () => {
    // Network only: below the threshold.
    const weak = row('c2', 'link-b', {
      user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/537.36',
      timezone: 'Asia/Tokyo',
      language: 'ja-JP',
      screen_width: 720,
      screen_height: 1280,
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [row('c1', 'link-a'), weak] });
    expect((await fingerprint.matchInstallToClick(baseFingerprint))?.competingLinks).toBe(0);
  });
});

describe('recordInstallEvent — matching a click once', () => {
  const clickRow = (clickId: string, oneInstallPerClick: boolean) => ({
    click_id: clickId,
    link_id: 'link-1',
    clicked_at: new Date().toISOString(),
    link_params: null,
    one_install_per_click: oneInstallPerClick,
    ip_address: baseFingerprint.ipAddress,
    user_agent: baseFingerprint.userAgent,
    timezone: baseFingerprint.timezone,
    language: baseFingerprint.language,
    screen_width: baseFingerprint.screenWidth,
    screen_height: baseFingerprint.screenHeight,
    platform: baseFingerprint.platform,
    platform_version: baseFingerprint.platformVersion,
  });

  beforeEach(() => {
    mockDbQuery.mockReset();
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('records the click as matched', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [clickRow('click-1', false)] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'click-1' }], rowCount: 1 });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-1', deep_link_data: {} }] });

    const result = await fingerprint.recordInstallEvent(baseFingerprint);

    expect(result.match?.clickId).toBe('click-1');
    expect(result.attributionMethod).toBe('fingerprint');
    expect(mockDbQuery.mock.calls[2][1][19]).toBe(0); // competing_links
    const [sql, params] = mockDbQuery.mock.calls[1];
    expect(sql).toMatch(/UPDATE click_events SET install_matched_at = NOW\(\)\s+WHERE id = \$1 AND install_matched_at IS NULL/);
    expect(params).toEqual(['click-1']);
  });

  it('still matches a click another install matched first, when the link allows it', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [clickRow('click-1', false)] });
    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-2', deep_link_data: {} }] });

    const result = await fingerprint.recordInstallEvent(baseFingerprint);

    expect(result.match?.clickId).toBe('click-1');
  });

  it('looks again without a one-install click that another install took first', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [clickRow('click-1', true)] });
    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-3', deep_link_data: {} }] });

    const result = await fingerprint.recordInstallEvent(baseFingerprint);

    expect(result.match).toBeNull();
    expect(result.installId).toBe('install-3');
    expect(mockDbQuery.mock.calls[2][1]).toEqual(['24.5.10.0/24', ['click-1']]);
  });
});

describe('normalizeLanguageTag', () => {
  it.each([
    ['en-US', 'en-US'],
    ['en', 'en'],
    ['EN-us', 'en-US'],
    ['es-419', 'es-419'],
    // Android toLanguageTag() with regional preferences
    ['en-ES-u-fw-mon-mu-celsius', 'en-ES'],
    ['de-DE-u-mu-fahrenhe', 'de-DE'],
    // iOS Locale.identifier
    ['en_US', 'en-US'],
    ['en_GB@rg=eszzzz', 'en-GB'],
    ['en_US@calendar=japanese', 'en-US'],
    ['en@rg=eszzzz', 'en'],
    // Script subtags
    ['zh-Hans-CN', 'zh-CN'],
    ['zh_Hant_TW', 'zh-TW'],
    ['zh-Hans', 'zh'],
    ['az-Latn-AZ', 'az-AZ'],
    // POSIX
    ['en_US.UTF-8', 'en-US'],
    // Three-letter language, variant subtag, private use
    ['fil-PH', 'fil-PH'],
    ['ca-ES-valencia', 'ca-ES'],
    ['en-x-private', 'en'],
    ['  fr-FR  ', 'fr-FR'],
  ])('%s → %s', (input, expected) => {
    expect(fingerprint.normalizeLanguageTag(input)).toBe(expected);
  });

  it.each([['*'], [''], ['1234'], ['english-US'], ['-US']])('rejects %j', (input) => {
    expect(fingerprint.normalizeLanguageTag(input)).toBeUndefined();
  });

  it('rejects non-strings', () => {
    expect(fingerprint.normalizeLanguageTag(undefined)).toBeUndefined();
    expect(fingerprint.normalizeLanguageTag(['en-US'])).toBeUndefined();
    expect(fingerprint.normalizeLanguageTag(42)).toBeUndefined();
  });

  it('never exceeds the 10-character column', () => {
    const long = 'en-ES-u-fw-mon-mu-celsius-x-' + 'a'.repeat(200);
    expect(fingerprint.normalizeLanguageTag(long)!.length).toBeLessThanOrEqual(10);
  });
});

describe('normalizeFingerprintData', () => {
  it('leaves an ordinary fingerprint unchanged', () => {
    expect(fingerprint.normalizeFingerprintData(baseFingerprint)).toEqual(baseFingerprint);
  });

  it('bounds every text field to its column and drops unusable numbers', () => {
    const result = fingerprint.normalizeFingerprintData({
      ...baseFingerprint,
      timezone: 'T'.repeat(150),
      language: 'en-ES-u-fw-mon-mu-celsius',
      platform: 'P'.repeat(80),
      platformVersion: 'V'.repeat(80),
      screenWidth: 1080.6,
      screenHeight: 99_999_999_999,
    });
    expect(result.timezone).toHaveLength(100);
    expect(result.language).toBe('en-ES');
    expect(result.platform).toHaveLength(50);
    expect(result.platformVersion).toHaveLength(50);
    expect(result.screenWidth).toBe(1081);
    expect(result.screenHeight).toBeUndefined();
  });

  it('drops query values that arrived as arrays', () => {
    const result = fingerprint.normalizeFingerprintData({
      ...baseFingerprint,
      timezone: ['UTC', 'UTC'] as unknown as string,
      language: ['en', 'fr'] as unknown as string,
    });
    expect(result.timezone).toBeUndefined();
    expect(result.language).toBeUndefined();
  });
});

describe('storage of fingerprint fields', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  it('stores a click fingerprint with the language reduced to language-region', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await fingerprint.storeFingerprintForClick('click-1', {
      ...baseFingerprint,
      language: 'en-ES-u-fw-mon-mu-celsius',
    });

    const params = mockDbQuery.mock.calls[0][1];
    expect(params[5]).toBe('en-ES'); // language/$6
    expect(params[1]).toBe(
      fingerprint.generateFingerprintHash({ ...baseFingerprint, language: 'en-ES' })
    );
  });

  it('records an install whose locale carries extensions and keywords', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // matchInstallToClick -> no match
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-locale', deep_link_data: {} }] });

    await fingerprint.recordInstallEvent(
      { ...baseFingerprint, language: 'en_GB@rg=eszzzz', screenWidth: 393.5 },
      'd'.repeat(400),
      12.4,
      { name: 'n'.repeat(80), version: ' 2.0.0 ' }
    );

    const params = mockDbQuery.mock.calls[1][1];
    expect(params[4]).toBe(12); // attribution_window_hours/$5
    expect(params[8]).toBe('en-GB'); // language/$9
    expect(params[9]).toBe(394); // screen_width/$10
    expect(params[13]).toHaveLength(255); // device_id/$14
    expect(params[15]).toHaveLength(50); // sdk_name/$16
    expect(params[16]).toBe('2.0.0'); // sdk_version/$17
  });

  it('falls back to the default window for an unusable attribution window', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 'install-window', deep_link_data: {} }] });

    await fingerprint.recordInstallEvent(baseFingerprint, undefined, -5);

    expect(mockDbQuery.mock.calls[1][1][4]).toBe(fingerprint.DEFAULT_ATTRIBUTION_WINDOW_HOURS);
  });
});

describe('clickIdFromInstallReferrer', () => {
  const CLICK = '11111111-2222-4333-8444-555555555555';

  it('reads the click id from a Play install referrer', () => {
    expect(fingerprint.clickIdFromInstallReferrer(`lf_click=${CLICK}`)).toBe(CLICK);
    expect(fingerprint.clickIdFromInstallReferrer(`utm_source=poster&lf_click=${CLICK}&utm_medium=print`)).toBe(CLICK);
  });

  it('reads a referrer passed on still encoded, or inside the Play URL', () => {
    expect(fingerprint.clickIdFromInstallReferrer(`lf_click%3D${CLICK}%26utm_source%3Dposter`)).toBe(CLICK);
    expect(fingerprint.clickIdFromInstallReferrer(`lf_click%253D${CLICK}`)).toBe(CLICK);
    expect(
      fingerprint.clickIdFromInstallReferrer(
        `https://play.google.com/store/apps/details?id=com.example.app&referrer=lf_click%3D${CLICK}`
      )
    ).toBe(CLICK);
    expect(fingerprint.clickIdFromInstallReferrer(`market://details?id=com.example.app&referrer=lf_click%3D${CLICK}`)).toBe(CLICK);
    expect(fingerprint.clickIdFromInstallReferrer(` lf_click=${CLICK} `)).toBe(CLICK);
  });

  it('returns null when there is no usable click id', () => {
    for (const referrer of [
      undefined,
      null,
      42,
      '',
      'utm_source=google-play&utm_medium=organic',
      'lf_click=not-a-uuid',
      `lf_click=${CLICK}'--`,
      `lf_click=${CLICK}&${'x'.repeat(1100)}`,
      'utm_source%3Dgoogle-play%26utm_medium%3Dorganic',
      '%E0%A4%A',
      'https://play.google.com/store/apps/details?id=com.example.app',
      'not a url: lf_click',
    ]) {
      expect(fingerprint.clickIdFromInstallReferrer(referrer)).toBeNull();
    }
  });
});
