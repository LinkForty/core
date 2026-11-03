import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  configureScannerDetection,
  isEmailScanner,
  isScannerDetectionEnabled,
  loadScannerDetection,
  type AsnLookup,
} from './scanner-detection.js';
import { classifyBot } from './bot-detection.js';

// Documentation ranges (RFC 5737 / RFC 3849) standing in for real networks.
const CLOUD_IP = '192.0.2.10';
const CLOUD_IPV6 = '2001:db8::10';
const RESIDENTIAL_IP = '198.51.100.20';
const UNKNOWN_IP = '203.0.113.30';

const ASNS: Record<string, number> = {
  [CLOUD_IP]: 8075,
  [CLOUD_IPV6]: 15169,
  [RESIDENTIAL_IP]: 7922,
};
const lookup: AsnLookup = (ip) => ASNS[ip] ?? null;

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const APP_CFNETWORK = 'ExampleApp/1 CFNetwork/1410.0.3 Darwin/22.6.0';

afterEach(() => {
  configureScannerDetection({ lookup: null });
});

describe('isEmailScanner', () => {
  it('is off until configured', () => {
    expect(isScannerDetectionEnabled()).toBe(false);
    expect(isEmailScanner(WINDOWS_CHROME, CLOUD_IP)).toBe(false);
  });

  it('flags desktop browsers on a scanner network', () => {
    configureScannerDetection({ lookup });
    expect(isEmailScanner(WINDOWS_CHROME, CLOUD_IP)).toBe(true);
    expect(isEmailScanner(MAC_CHROME, CLOUD_IP)).toBe(true);
    expect(isEmailScanner(LINUX_FIREFOX, CLOUD_IP)).toBe(true);
    expect(isEmailScanner(WINDOWS_CHROME, CLOUD_IPV6)).toBe(true);
  });

  it('does not flag mobile browsers or app HTTP clients on a scanner network', () => {
    configureScannerDetection({ lookup });
    expect(isEmailScanner(IPHONE_SAFARI, CLOUD_IP)).toBe(false);
    expect(isEmailScanner(ANDROID_CHROME, CLOUD_IP)).toBe(false);
    expect(isEmailScanner(APP_CFNETWORK, CLOUD_IP)).toBe(false);
    expect(isEmailScanner('okhttp/4.12.0', CLOUD_IP)).toBe(false);
  });

  it('does not flag desktop browsers on other networks or unknown IPs', () => {
    configureScannerDetection({ lookup });
    expect(isEmailScanner(WINDOWS_CHROME, RESIDENTIAL_IP)).toBe(false);
    expect(isEmailScanner(WINDOWS_CHROME, UNKNOWN_IP)).toBe(false);
    expect(isEmailScanner(WINDOWS_CHROME, '')).toBe(false);
    expect(isEmailScanner(WINDOWS_CHROME, undefined)).toBe(false);
    expect(isEmailScanner(undefined, CLOUD_IP)).toBe(false);
  });

  it('covers both Microsoft networks seen scanning', () => {
    configureScannerDetection({ lookup: () => 8070 });
    expect(isEmailScanner(WINDOWS_CHROME, CLOUD_IP)).toBe(true);
  });

  it('uses a configured ASN list in place of the defaults', () => {
    configureScannerDetection({ lookup, asns: [7922] });
    expect(isEmailScanner(WINDOWS_CHROME, RESIDENTIAL_IP)).toBe(true);
    expect(isEmailScanner(WINDOWS_CHROME, CLOUD_IP)).toBe(false);
  });

  it('is off with an empty ASN list', () => {
    configureScannerDetection({ lookup, asns: [] });
    expect(isScannerDetectionEnabled()).toBe(false);
    expect(isEmailScanner(WINDOWS_CHROME, CLOUD_IP)).toBe(false);
  });
});

describe('classifyBot with scanner detection', () => {
  it('classifies a scanner as email_scanner', () => {
    configureScannerDetection({ lookup });
    expect(classifyBot(WINDOWS_CHROME, 'GET', undefined, false, CLOUD_IP)).toEqual({
      isBot: true,
      reason: 'email_scanner',
    });
    expect(classifyBot(WINDOWS_CHROME, 'GET', undefined, false, RESIDENTIAL_IP)).toEqual({ isBot: false, reason: null });
  });

  it('keeps the earlier signals ahead of it', () => {
    configureScannerDetection({ lookup });
    expect(classifyBot(WINDOWS_CHROME, 'GET', true, false, CLOUD_IP).reason).toBe('edge');
    expect(classifyBot(WINDOWS_CHROME, 'HEAD', undefined, false, CLOUD_IP).reason).toBe('method');
    expect(classifyBot('Googlebot/2.1 (+http://www.google.com/bot.html)', 'GET', undefined, false, CLOUD_IP).reason).toBe('ua');
  });

  it('does not apply to SDK requests', () => {
    configureScannerDetection({ lookup });
    expect(classifyBot(WINDOWS_CHROME, 'GET', undefined, true, CLOUD_IP)).toEqual({ isBot: false, reason: null });
  });

  it('classifies as before when no IP is passed', () => {
    configureScannerDetection({ lookup });
    expect(classifyBot(WINDOWS_CHROME, 'GET')).toEqual({ isBot: false, reason: null });
  });
});

describe('loadScannerDetection', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('stays off without a path, silently', () => {
    const log = vi.fn();
    expect(loadScannerDetection(undefined, { log })).toBe(false);
    expect(isScannerDetectionEnabled()).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('stays off and logs when the file is missing', () => {
    const log = vi.fn();
    expect(loadScannerDetection('/nonexistent/asn.mmdb', { log })).toBe(false);
    expect(isScannerDetectionEnabled()).toBe(false);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('/nonexistent/asn.mmdb');
  });

  it('stays off and logs when the file is not an MMDB database', () => {
    dir = mkdtempSync(join(tmpdir(), 'linkforty-asn-'));
    const path = join(dir, 'not-a-db.mmdb');
    writeFileSync(path, 'not a database');
    const log = vi.fn();
    expect(loadScannerDetection(path, { log })).toBe(false);
    expect(isScannerDetectionEnabled()).toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });

  it('turns a previously configured rule off when the new file fails', () => {
    configureScannerDetection({ lookup });
    loadScannerDetection('/nonexistent/asn.mmdb', { log: () => {} });
    expect(isScannerDetectionEnabled()).toBe(false);
  });
});
