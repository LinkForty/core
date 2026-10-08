import { describe, it, expect } from 'vitest';
import {
  defaultLaunchpadContent,
  launchpadContentSecurityPolicy,
  readLaunchpadLinkMode,
  readLaunchpadSettings,
  renderLaunchpadPage,
  shouldServeLaunchpadOnDesktop,
  shouldServeLaunchpadOnMobile,
  type LaunchpadPageContext,
} from './launchpad.js';
import { APP_STORE_BADGE_DATA_URI, GOOGLE_PLAY_BADGE_DATA_URI } from './store-badges.js';

describe('shouldServeLaunchpadOnDesktop', () => {
  /** The full decision table: link mode × workspace mode × whether a destination exists. */
  const table: Array<[string, Parameters<typeof shouldServeLaunchpadOnDesktop>[0], boolean]> = [
    ['defaults, no destination → page', { hasWebDestination: false }, true],
    ['defaults, destination → redirect', { hasWebDestination: true }, false],
    ['org always, destination → page', { hasWebDestination: true, orgMode: 'always' }, true],
    ['org off, no destination → plain page', { hasWebDestination: false, orgMode: 'off' }, false],
    ['org no-destination, destination → redirect', { hasWebDestination: true, orgMode: 'no-destination' }, false],
    ['link on beats org default', { hasWebDestination: true, linkMode: 'on' }, true],
    ['link on beats org off', { hasWebDestination: false, orgMode: 'off', linkMode: 'on' }, true],
    ['link off beats org always', { hasWebDestination: true, orgMode: 'always', linkMode: 'off' }, false],
    ['link off beats no destination', { hasWebDestination: false, linkMode: 'off' }, false],
    ['link inherit follows org', { hasWebDestination: true, orgMode: 'always', linkMode: 'inherit' }, true],
  ];
  for (const [name, input, expected] of table) {
    it(name, () => expect(shouldServeLaunchpadOnDesktop(input)).toBe(expected));
  }
});

describe('shouldServeLaunchpadOnMobile', () => {
  const table: Array<[string, Parameters<typeof shouldServeLaunchpadOnMobile>[0], boolean]> = [
    ['defaults → store', { hasAppOpenPath: false }, false],
    ['store explicitly → store', { hasAppOpenPath: false, mobileMode: 'store' }, false],
    ['page → page', { hasAppOpenPath: false, mobileMode: 'page' }, true],
    ['page, but a Universal Link / App Link → the OS handles it', { hasAppOpenPath: true, mobileMode: 'page' }, false],
    ['page, link off → store', { hasAppOpenPath: false, mobileMode: 'page', linkMode: 'off' }, false],
    ['page, link on → page', { hasAppOpenPath: false, mobileMode: 'page', linkMode: 'on' }, true],
    ['store, link on → still store (on never forces a hop)', { hasAppOpenPath: false, mobileMode: 'store', linkMode: 'on' }, false],
  ];
  for (const [name, input, expected] of table) {
    it(name, () => expect(shouldServeLaunchpadOnMobile(input)).toBe(expected));
  }
});

describe('readLaunchpadSettings', () => {
  it('returns {} for anything that is not a settings object', () => {
    expect(readLaunchpadSettings(null)).toEqual({});
    expect(readLaunchpadSettings({})).toEqual({});
    expect(readLaunchpadSettings({ launchpad: 'always' })).toEqual({});
  });

  it('keeps known values and drops the rest', () => {
    expect(
      readLaunchpadSettings({
        launchpad: {
          desktop: 'always',
          mobile: 'page',
          appName: '  Demo App  ',
          appIconUrl: 'https://cdn.example/icon.png',
          accentColor: '#ff8800',
          backgroundColor: '#101418',
          templateId: 'hero',
          extra: 'ignored',
        },
      })
    ).toEqual({
      desktop: 'always',
      mobile: 'page',
      appName: 'Demo App',
      appIconUrl: 'https://cdn.example/icon.png',
      accentColor: '#ff8800',
      backgroundColor: '#101418',
      templateId: 'hero',
    });
  });

  it('rejects an unknown mode, a non-hex colour and a non-http icon', () => {
    expect(
      readLaunchpadSettings({
        launchpad: { desktop: 'sometimes', mobile: 42, accentColor: 'red', backgroundColor: 'white', appIconUrl: 'javascript:alert(1)' },
      })
    ).toEqual({});
  });
});

describe('readLaunchpadLinkMode', () => {
  it('normalises anything unexpected to inherit', () => {
    expect(readLaunchpadLinkMode('on')).toBe('on');
    expect(readLaunchpadLinkMode('off')).toBe('off');
    expect(readLaunchpadLinkMode(undefined)).toBe('inherit');
    expect(readLaunchpadLinkMode('always')).toBe('inherit');
  });
});

describe('defaultLaunchpadContent', () => {
  it('prefers og fields, then plain fields, then the app name, then a constant', () => {
    expect(defaultLaunchpadContent({ og_title: 'OG', title: 'T' }, {}).title).toBe('OG');
    expect(defaultLaunchpadContent({ title: 'T' }, {}).title).toBe('T');
    expect(defaultLaunchpadContent({}, { appName: 'Demo' }).title).toBe('Demo');
    expect(defaultLaunchpadContent({}, {}).title).toBe('Open in the app');
    expect(defaultLaunchpadContent({ og_description: 'D1', description: 'D2' }, {}).description).toBe('D1');
  });

  it('drops a non-http image', () => {
    expect(defaultLaunchpadContent({ og_image_url: 'data:image/png;base64,AAAA' }, {}).imageUrl).toBeNull();
    expect(defaultLaunchpadContent({ og_image_url: 'https://cdn.example/a.png' }, {}).imageUrl).toBe('https://cdn.example/a.png');
  });
});

describe('launchpadContentSecurityPolicy', () => {
  it('nonces scripts, allows inline styles, and forbids everything else by default', () => {
    const csp = launchpadContentSecurityPolicy('abc');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-abc'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it('admits an absolute beacon origin in connect-src', () => {
    expect(launchpadContentSecurityPolicy('abc', 'https://events.example/v1/lp')).toContain(
      "connect-src 'self' https://events.example"
    );
    expect(launchpadContentSecurityPolicy('abc', '/api/lp/event')).toContain("connect-src 'self';");
  });
});

describe('renderLaunchpadPage', () => {
  const base: LaunchpadPageContext = {
    content: {
      title: 'A title',
      description: 'A description',
      imageUrl: 'https://cdn.example/hero.png',
      theme: { appName: 'Demo App', appIconUrl: 'https://cdn.example/icon.png', accentColor: '#ff8800' },
    },
    linkId: 'link-1',
    pageUrl: 'https://go.example/abc',
    iosUrl: 'https://apps.apple.com/app/id1',
    androidUrl: 'https://play.google.com/store/apps/details?id=demo',
    schemeUrl: null,
    showQr: true,
    nonce: 'n0nce',
  };

  it('renders the head, the hero, both store buttons and the QR block', () => {
    const html = renderLaunchpadPage(base);
    expect(html).toContain('<title>A title</title>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta property="og:image" content="https://cdn.example/hero.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<h1>A title</h1>');
    expect(html).toContain('Download on the App Store');
    expect(html).toContain('Get it on Google Play');
    expect(html).toContain('/api/links/link-1/qr?format=svg&amp;size=264&amp;url=');
    expect(html).toContain('<span>Demo App</span>');
    expect(html).toContain('--lp-accent: #ff8800; --lp-accent-ink: #ffffff;');
  });

  it('ships no script when there is nothing for one to do', () => {
    expect(renderLaunchpadPage(base)).not.toContain('<script');
  });

  it('renders the Open in app button with the scheme URL and the fragment-preserving script', () => {
    const html = renderLaunchpadPage({ ...base, schemeUrl: 'demo://product/1?x=1' });
    expect(html).toContain('id="lp-open"');
    expect(html).toContain('data-scheme="demo://product/1?x=1"');
    expect(html).toContain('href="demo://product/1?x=1"');
    expect(html).toContain('<script nonce="n0nce">');
    expect(html).toContain('window.location.hash');
    expect(html).not.toContain('setTimeout');
    expect(html).not.toContain('location.replace');
  });

  it('adds the beacon attributes and markers only when a beacon URL is set', () => {
    const without = renderLaunchpadPage(base);
    expect(without).not.toContain('data-beacon');
    expect(without).not.toContain('sendBeacon');

    const html = renderLaunchpadPage({ ...base, beaconUrl: '/api/lp/event' });
    expect(html).toContain('data-beacon="/api/lp/event"');
    expect(html.match(/navigator\.sendBeacon\(/g)).toHaveLength(1);
    expect(html).toContain('data-lp-cta="cta_ios"');
    expect(html).toContain('data-lp-cta="cta_android"');
    expect(html).not.toContain('data-lp-cta="cta_open"');
  });

  it('escapes every value that reaches the document', () => {
    const html = renderLaunchpadPage({
      ...base,
      content: {
        title: `<script>alert("xss")</script> & 'q'`,
        description: '"><img src=x onerror=alert(1)>',
        imageUrl: 'https://cdn.example/a.png?x="y"',
        theme: { appName: '<b>App</b>' },
      },
      iosUrl: 'https://apps.apple.com/app?a=1&b=2',
      pageUrl: 'https://go.example/abc?"',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;q&#39;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('content="https://cdn.example/a.png?x=&quot;y&quot;"');
    expect(html).toContain('href="https://apps.apple.com/app?a=1&amp;b=2"');
    expect(html).toContain('&lt;b&gt;App&lt;/b&gt;');
    expect(html).toContain('og:url" content="https://go.example/abc?&quot;"');
  });

  it('drops non-http URLs rather than rendering them', () => {
    const html = renderLaunchpadPage({
      ...base,
      content: { ...base.content, imageUrl: 'javascript:alert(1)', theme: { appIconUrl: 'data:text/html,x' } },
      iosUrl: 'javascript:alert(2)',
      androidUrl: null,
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).not.toContain('Download on the App Store');
  });

  it('inserts heroHtml verbatim in place of the default hero', () => {
    const html = renderLaunchpadPage({
      ...base,
      content: { ...base.content, heroHtml: '<div class="custom-hero"><em>rendered by host</em></div>' },
    });
    expect(html).toContain('<div class="custom-hero"><em>rendered by host</em></div>');
    expect(html).not.toContain('<h1>A title</h1>');
    // The head still carries the escaped title for the tab and the unfurl.
    expect(html).toContain('<title>A title</title>');
  });

  it('omits the QR block, the icon row and the description when there is nothing to show', () => {
    const html = renderLaunchpadPage({
      ...base,
      showQr: false,
      content: { title: 'T', description: '', imageUrl: null, theme: {} },
    });
    expect(html).not.toContain('class="lp-qr"');
    expect(html).not.toContain('class="lp-app"');
    expect(html).not.toContain('meta name="description"');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('offers the web destination as a link only when given one that is http(s)', () => {
    expect(renderLaunchpadPage(base)).not.toContain('Continue on the web');
    const html = renderLaunchpadPage({ ...base, webUrl: 'https://example.com/page?a=1&b=2' });
    expect(html).toContain('<a data-lp-cta="cta_web" href="https://example.com/page?a=1&amp;b=2">Continue on the web</a>');
    expect(renderLaunchpadPage({ ...base, webUrl: 'javascript:alert(1)' })).not.toContain('Continue on the web');
  });

  it('the web link takes the accent, so a page with no buttons still shows the colour', () => {
    const html = renderLaunchpadPage({ ...base, iosUrl: null, androidUrl: null, webUrl: 'https://example.com/p' });
    expect(html).not.toContain('class="lp-btn');
    expect(html).toContain('.lp-web a { color: var(--lp-accent);');
    expect(html).toContain('--lp-accent: #ff8800;');
  });

  it('uses dark button text on a light accent', () => {
    const html = renderLaunchpadPage({ ...base, content: { ...base.content, theme: { accentColor: '#ffe066' } } });
    expect(html).toContain('--lp-accent: #ffe066; --lp-accent-ink: #16181d;');
  });

  it('lays out one centered column that also centers vertically on a tall viewport', () => {
    const html = renderLaunchpadPage(base);
    expect(html).toContain('body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;');
    expect(html).toContain('.lp { width: 100%; max-width: 48rem; margin: auto;');
  });

  it('follows the visitor\'s theme unless a background is set', () => {
    // Only the base light/dark declarations, no fixed override after them.
    expect(renderLaunchpadPage(base)).not.toMatch(/}\s*:root \{ --lp-bg:/);
    expect(renderLaunchpadPage(base)).toContain('@media (prefers-color-scheme: dark)');
  });

  it('a dark background gets light ink; a light one gets dark ink; surfaces lean toward the ink', () => {
    const dark = renderLaunchpadPage({ ...base, content: { ...base.content, theme: { backgroundColor: '#101418' } } });
    expect(dark).toContain(':root { --lp-bg: #101418; --lp-ink: #eef0f3; --lp-muted: #a3abb8; --lp-surface: #1d2125; --lp-line: #2f3337; }');

    const light = renderLaunchpadPage({ ...base, content: { ...base.content, theme: { backgroundColor: '#fff7e6' } } });
    expect(light).toContain(':root { --lp-bg: #fff7e6; --lp-ink: #16181d; --lp-muted: #5f6673; --lp-surface: #f1eada; --lp-line: #ded8ca; }');
  });

  it('ignores a background that is not #rrggbb', () => {
    const html = renderLaunchpadPage({ ...base, content: { ...base.content, theme: { backgroundColor: 'url(x)' } } });
    expect(html).not.toContain('--lp-bg: url');
  });
});

describe('renderLaunchpadPage — store badges', () => {
  const base: LaunchpadPageContext = {
    content: { title: 'A title', description: '', imageUrl: null, theme: {} },
    linkId: 'link-1',
    pageUrl: 'https://go.example/abc',
    iosUrl: 'https://apps.apple.com/app/id1',
    androidUrl: 'https://play.google.com/store/apps/details?id=demo',
    schemeUrl: null,
    showQr: false,
    nonce: 'n0nce',
  };

  it('links each official badge to its own store, keeping the click events', () => {
    const html = renderLaunchpadPage(base);
    expect(html).toContain(
      `<a class="lp-badge" data-lp-cta="cta_ios" href="https://apps.apple.com/app/id1"><img src="${APP_STORE_BADGE_DATA_URI}" alt="Download on the App Store"`
    );
    expect(html).toContain(
      `<a class="lp-badge lp-badge-play" data-lp-cta="cta_android" href="https://play.google.com/store/apps/details?id=demo"><img src="${GOOGLE_PLAY_BADGE_DATA_URI}" alt="Get it on Google Play"`
    );
    // No text button for a store any more.
    expect(html).not.toMatch(/class="lp-btn[^"]*" data-lp-cta="cta_(ios|android)"/);
  });

  it('shows only the stores it was given', () => {
    const iosOnly = renderLaunchpadPage({ ...base, androidUrl: null });
    expect(iosOnly).toContain('cta_ios');
    expect(iosOnly).not.toContain('cta_android');
  });

  it('keeps "Open in app" as the one primary button beside the badges', () => {
    const html = renderLaunchpadPage({ ...base, schemeUrl: 'demo://p/1' });
    expect(html).toContain('class="lp-btn lp-btn-primary" id="lp-open"');
    expect(html).toContain('data-lp-cta="cta_ios"');
  });

  it('embeds the unmodified official artwork: Apple SVG and Google PNG', () => {
    const svg = Buffer.from(APP_STORE_BADGE_DATA_URI.split(',')[1], 'base64').toString('utf8');
    expect(APP_STORE_BADGE_DATA_URI.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 119.66407 40"');
    const png = Buffer.from(GOOGLE_PLAY_BADGE_DATA_URI.split(',')[1], 'base64');
    expect(GOOGLE_PLAY_BADGE_DATA_URI.startsWith('data:image/png;base64,')).toBe(true);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(646);
    expect(png.readUInt32BE(20)).toBe(250);
  });
});

describe('renderLaunchpadPage — the title leads to the web destination', () => {
  const base: LaunchpadPageContext = {
    content: { title: 'Spring Classic', description: '', imageUrl: null, theme: {} },
    linkId: 'link-1',
    pageUrl: 'https://go.example/abc',
    iosUrl: null,
    androidUrl: null,
    schemeUrl: null,
    showQr: false,
    nonce: 'n0nce',
  };

  it('links the title and keeps "Continue on the web" beside it', () => {
    const html = renderLaunchpadPage({ ...base, webUrl: 'https://example.com/e?id=1&r=2' });
    expect(html).toContain('<h1><a data-lp-cta="cta_web" href="https://example.com/e?id=1&amp;r=2">Spring Classic</a></h1>');
    expect(html).toContain('Continue on the web');
  });

  it('leaves the title plain when there is no web destination, or an unsafe one', () => {
    expect(renderLaunchpadPage(base)).toContain('<h1>Spring Classic</h1>');
    expect(renderLaunchpadPage({ ...base, webUrl: 'javascript:alert(1)' })).toContain('<h1>Spring Classic</h1>');
  });

  it('leaves a host-drawn hero alone: the host links its own title', () => {
    const html = renderLaunchpadPage({
      ...base,
      webUrl: 'https://example.com/e',
      content: { ...base.content, heroHtml: '<div class="host-hero">Spring Classic</div>' },
    });
    expect(html).toContain('<div class="host-hero">Spring Classic</div>');
    expect(html).not.toContain('<h1>');
    expect(html).toContain('Continue on the web');
  });
});

describe('renderLaunchpadPage — header links to the app website', () => {
  const base: LaunchpadPageContext = {
    content: { title: 't', description: '', imageUrl: null, theme: { appName: 'Demo App', appIconUrl: 'https://cdn.example/icon.png' } },
    linkId: 'link-1',
    pageUrl: 'https://go.example/abc',
    iosUrl: null,
    androidUrl: null,
    schemeUrl: null,
    showQr: false,
    nonce: 'n0nce',
  };

  it('wraps the icon and name in a link when a website is set', () => {
    const html = renderLaunchpadPage({ ...base, appWebsiteUrl: 'https://demo.example' });
    expect(html).toContain(
      '<header class="lp-app"><a class="lp-app-link" data-lp-cta="cta_app_website" href="https://demo.example"><img src="https://cdn.example/icon.png"'
    );
    expect(html).toContain('<span>Demo App</span></a></header>');
  });

  it('leaves the header unlinked when no website is set, or an unsafe one', () => {
    expect(renderLaunchpadPage(base)).not.toContain('class="lp-app-link"');
    expect(renderLaunchpadPage({ ...base, appWebsiteUrl: 'javascript:alert(1)' })).not.toContain('class="lp-app-link"');
  });

  it('readLaunchpadSettings keeps an http(s) website and drops anything else', () => {
    expect(readLaunchpadSettings({ launchpad: { appWebsiteUrl: 'https://demo.example' } }).appWebsiteUrl).toBe('https://demo.example');
    expect(readLaunchpadSettings({ launchpad: { appWebsiteUrl: 'javascript:alert(1)' } }).appWebsiteUrl).toBeUndefined();
    expect(readLaunchpadSettings({ launchpad: { appWebsiteUrl: '' } }).appWebsiteUrl).toBeUndefined();
  });
});
