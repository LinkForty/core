import { describe, it, expect, afterEach } from 'vitest';
import { classifyBot, edgeBotSignal } from './bot-detection.js';

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

  it('handles a missing/empty user-agent', () => {
    expect(classifyBot(undefined, 'GET')).toEqual({ isBot: false, reason: null });
    expect(classifyBot('', 'GET').isBot).toBe(false);
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
