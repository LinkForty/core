import { describe, it, expect, afterEach } from 'vitest';
import { classifyBot, edgeBotSignal, isSdkRequest } from './bot-detection.js';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('classifyBot', () => {
  it('flags known crawlers/scrapers by user-agent', () => {
    expect(classifyBot('Googlebot/2.1 (+http://www.google.com/bot.html)', 'GET')).toEqual({ isBot: true, reason: 'ua' });
    expect(classifyBot('facebookexternalhit/1.1', 'GET').isBot).toBe(true);
    expect(classifyBot('curl/8.4.0', 'GET').isBot).toBe(true);
  });

  it('does not flag a normal browser', () => {
    expect(classifyBot(CHROME, 'GET')).toEqual({ isBot: false, reason: null });
  });

  it('flags HEAD/OPTIONS as non-human, case-insensitively', () => {
    expect(classifyBot(CHROME, 'HEAD')).toEqual({ isBot: true, reason: 'method' });
    expect(classifyBot(CHROME, 'options')).toEqual({ isBot: true, reason: 'method' });
  });

  it('honors the edge signal with highest authority', () => {
    // Edge wins even for a normal browser UA on a GET.
    expect(classifyBot(CHROME, 'GET', true)).toEqual({ isBot: true, reason: 'edge' });
    // An explicit false edge signal does not override real UA/method detection.
    expect(classifyBot('Googlebot/2.1', 'GET', false)).toEqual({ isBot: true, reason: 'ua' });
  });

  it('does not flag an SDK request by its HTTP library user-agent', () => {
    expect(classifyBot('okhttp/4.12.0', 'GET')).toEqual({ isBot: true, reason: 'ua' });
    expect(classifyBot('okhttp/4.12.0', 'GET', undefined, true)).toEqual({ isBot: false, reason: null });
    expect(classifyBot('okhttp/5.5.0', 'GET', undefined, true).isBot).toBe(false);
  });

  it('still applies the method and edge signals to SDK requests', () => {
    expect(classifyBot('okhttp/4.12.0', 'HEAD', undefined, true)).toEqual({ isBot: true, reason: 'method' });
    expect(classifyBot('okhttp/4.12.0', 'GET', true, true)).toEqual({ isBot: true, reason: 'edge' });
  });

  it('handles a missing/empty user-agent', () => {
    expect(classifyBot(undefined, 'GET')).toEqual({ isBot: false, reason: null });
    expect(classifyBot('', 'GET').isBot).toBe(false);
  });
});

describe('isSdkRequest', () => {
  it('is true when X-LinkForty-SDK names an SDK', () => {
    expect(isSdkRequest({ 'x-linkforty-sdk': 'android/1.4.0' })).toBe(true);
    expect(isSdkRequest({ 'x-linkforty-sdk': ['react-native/1.6.2'] })).toBe(true);
  });

  it('is false when the header is missing or empty', () => {
    expect(isSdkRequest({})).toBe(false);
    expect(isSdkRequest({ 'x-linkforty-sdk': '' })).toBe(false);
    expect(isSdkRequest({ 'x-linkforty-sdk': '  ' })).toBe(false);
  });
});

describe('edgeBotSignal', () => {
  afterEach(() => {
    delete process.env.TRUST_EDGE_BOT_HEADER;
  });

  it('is ignored unless TRUST_EDGE_BOT_HEADER=true', () => {
    expect(edgeBotSignal('1')).toBeUndefined();
  });

  it('parses the header only when trusted', () => {
    process.env.TRUST_EDGE_BOT_HEADER = 'true';
    expect(edgeBotSignal('1')).toBe(true);
    expect(edgeBotSignal('true')).toBe(true);
    expect(edgeBotSignal('TRUE')).toBe(true);
    expect(edgeBotSignal('0')).toBe(false);
    expect(edgeBotSignal(['1'])).toBe(true);
    expect(edgeBotSignal(undefined)).toBeUndefined();
  });
});
