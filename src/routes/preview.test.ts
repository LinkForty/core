import { describe, it, expect } from 'vitest';
import { isSocialScraper, SCRAPER_PATTERNS } from './preview.js';

/**
 * The gate that decides whether a request gets the Open Graph preview page or a
 * redirect. Both directions matter, and they fail differently:
 *
 *   - a missed scraper renders the destination's metadata in the share card
 *   - a matched human gets a meta-refresh interstitial instead of their
 *     redirect, which is the worse of the two
 *
 * Kept in sync with the same suite in Cloud
 * (`cloud/backend/src/lib/social-preview-hook.test.ts`). Cloud's hook registers
 * ahead of these routes, so this list governs self-hosted deployments.
 */

/** Real server-side fetchers. Each must be served the preview page. */
const SCRAPERS: Array<[string, string]> = [
  ['Facebook', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['Facebot', 'Facebot/1.0'],
  ['X', 'Twitterbot/1.0'],
  ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; +https://www.linkedin.com)'],
  ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
  ['Telegram', 'TelegramBot (like TwitterBot)'],
  ['Pinterest', 'Mozilla/5.0 (compatible; PinterestBot/1.0; +http://www.pinterest.com/bot.html)'],
  ['Skype', 'SkypeUriPreview Preview/0.5'],
  ['Google', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['Bing', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['Alexa', 'ia_archiver (+http://www.alexa.com/site/help/webmasters)'],

  // Added by SIT-359, matching Cloud. All three were verified in production
  // falling through to a 302 before the Cloud fix.
  [
    'Apple / iMessage',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  ],
  ['Reddit', 'Mozilla/5.0 (compatible; redditbot/1.0; +https://www.reddit.com/robots.txt)'],
  // CardyB masquerades as Chrome; "Cardyb" is the only non-browser token in it.
  [
    'Bluesky',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app) Chrome/120.0.0.0 Safari/537.36',
  ],

  ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.2.1; +https://mastodon.social/)'],
  ['VK', 'Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)'],
  ['Embedly', 'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)'],
  ['Iframely', 'Iframely/1.3.1 (+https://iframely.com/docs/about)'],
  ['opengraph.xyz', 'Mozilla/5.0 (compatible; opengraph.xyz/1.0)'],
  ['MetaInspector', 'MetaInspector/5.11.0 (+https://github.com/jaimeiniesta/metainspector)'],
  ['PreviewBot', 'Mozilla/5.0 (compatible; PreviewBot/1.0)'],
  ['LinkPreview', 'Mozilla/5.0 (compatible; LinkPreview/1.0; +https://www.linkpreview.net)'],
];

/**
 * Real people. Serving any of these the preview page is a regression.
 *
 * The in-app browser entries are the point of this block: each carries its
 * platform's name, so a bare-name pattern would match a human. That is why
 * those patterns are absent, and this is the guard that keeps someone from
 * "helpfully" adding them back.
 */
const HUMANS: Array<[string, string]> = [
  [
    'Desktop Chrome',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
  [
    'Desktop Firefox',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  ],
  [
    'Mobile Safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ],
  [
    'Android Chrome',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  ],
  [
    'Instagram in-app browser',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.29.110',
  ],
  [
    'Threads in-app browser',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 300.0.0.29.110 Threads',
  ],
  [
    'Snapchat in-app browser',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.80.0.42',
  ],
  [
    'Tumblr in-app browser',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Tumblr/23.9.1.100',
  ],
  [
    'Reddit app (not the scraper)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Reddit/Version 2024.1.0/Build 1234',
  ],
  ['Empty', ''],
];

describe('isSocialScraper', () => {
  it.each(SCRAPERS)('serves the preview to %s', (_name, ua) => {
    expect(isSocialScraper(ua)).toBe(true);
  });

  it.each(HUMANS)('redirects %s', (_name, ua) => {
    expect(isSocialScraper(ua)).toBe(false);
  });

  it('does not carry a bare-name pattern for a platform with an in-app browser', () => {
    const banned = ['Instagram', 'Threads', 'Snapchat', 'Tumblr'];
    const sources = SCRAPER_PATTERNS.map((p) => p.source);

    for (const name of banned) {
      expect(sources, `${name} matches its own in-app browser UA`).not.toContain(name);
    }
  });
});
