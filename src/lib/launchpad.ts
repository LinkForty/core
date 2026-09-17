import { randomBytes } from 'crypto';
import { escapeHtml, safeHref, safeSchemeHref } from './link-safety.js';

/**
 * Launchpad: the page a visitor sees when a link cannot open the app.
 *
 * A short link to app-only content has nowhere good to send a desktop visitor,
 * and a phone without the app installed otherwise gets a bare store redirect.
 * This page is the alternative: the link's title, description and image, the
 * app's icon and name, store buttons, a QR code so a desktop visitor can finish
 * on their phone, and — when the app has a URI scheme — an "Open in app" button.
 *
 * Three rules shape everything below:
 *
 * 1. **Never add a hop to a link that already works.** The page is served by
 *    default only when a link has no web destination at any level. Serving it
 *    in front of a working destination is a per-workspace or per-link choice.
 * 2. **Never navigate on the visitor's behalf.** No timers, no automatic scheme
 *    attempts. A forced `myapp://` open with the app absent produces an OS error
 *    alert and a dead tab; a button the visitor taps produces neither.
 * 3. **Nothing on the page is authored by the visitor's target.** Every value
 *    is escaped; the one exception, `heroHtml`, is rendered by the host
 *    application from its own templates and is documented as such below.
 *
 * The page is search-engine invisible (`noindex`, and the route sends
 * `X-Robots-Tag` and `Cache-Control: no-store`), because a redirect host that
 * indexes one page per short link is a thin-content spam surface.
 */

export type LaunchpadDesktopMode = 'no-destination' | 'always' | 'off';
export type LaunchpadMobileMode = 'store' | 'page';
export type LaunchpadLinkMode = 'inherit' | 'on' | 'off';

/**
 * Per-workspace configuration, read from `organizations.settings.launchpad`.
 * Every field is optional; an absent object means "the defaults", which are
 * today's behaviour everywhere except the no-destination desktop case.
 */
export interface LaunchpadSettings {
  /** When a desktop visitor gets the page. Default `no-destination`. */
  desktop?: LaunchpadDesktopMode;
  /**
   * What a mobile visitor gets when the link has no Universal Link / App Link
   * for their platform. Default `store`: today's behaviour — a redirect to the
   * store, or the scheme interstitial when the link has a URI scheme. `page`
   * serves the launchpad page instead, with "Open in app" as a button the
   * visitor taps rather than a navigation the page performs.
   */
  mobile?: LaunchpadMobileMode;
  /** Shown in the page header, and as the `<title>` fallback. */
  appName?: string;
  /** Absolute https URL of the app icon, shown at 64×64. */
  appIconUrl?: string;
  /** `#rrggbb`. Drives the primary button, the web link and focus rings. Anything else is ignored. */
  accentColor?: string;
  /** Opaque to Core: a host application may key its own page templates on it. */
  templateId?: string;
}

export interface LaunchpadTheme {
  appName?: string;
  appIconUrl?: string;
  accentColor?: string;
}

/**
 * What the page shows. Produced by `defaultLaunchpadContent()` from the link
 * row, or by a host application's `resolveContent` hook when it has richer
 * material (a rendered share card, a template).
 */
export interface LaunchpadContent {
  title: string;
  description: string;
  /** Hero image, absolute http(s) URL. Also used for `og:image`. */
  imageUrl: string | null;
  /**
   * Pre-rendered HTML for the hero region, inserted **without escaping**.
   *
   * Trust boundary: this must be produced by the host application from its own
   * templates, never from visitor or end-user input. The page's CSP allows no
   * script without the per-response nonce, which the host does not know, so a
   * mistake here cannot execute — but it can still deface. Leave it unset unless
   * you render it yourself.
   */
  heroHtml?: string;
  theme: LaunchpadTheme;
}

/** The subset of a `links` row the default content is built from. */
export interface LaunchpadLinkFields {
  title?: string | null;
  description?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
}

const DESKTOP_MODES: readonly LaunchpadDesktopMode[] = ['no-destination', 'always', 'off'];
const MOBILE_MODES: readonly LaunchpadMobileMode[] = ['store', 'page'];
const LINK_MODES: readonly LaunchpadLinkMode[] = ['inherit', 'on', 'off'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const asString = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * Read `settings.launchpad` off a workspace settings JSON blob, tolerating any
 * shape. Settings are written by whatever administers the workspace, not by
 * this package, so nothing here is trusted: unknown modes fall back to the
 * default, a bad colour is dropped, and image URLs must be http(s).
 */
export function readLaunchpadSettings(orgSettings: unknown): LaunchpadSettings {
  const raw =
    orgSettings && typeof orgSettings === 'object' && (orgSettings as Record<string, unknown>).launchpad;
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const desktop = DESKTOP_MODES.find((m) => m === r.desktop);
  const mobile = MOBILE_MODES.find((m) => m === r.mobile);
  const accentColor = asString(r.accentColor, 7);
  const appIconUrl = asString(r.appIconUrl, 2048);
  return {
    ...(desktop ? { desktop } : {}),
    ...(mobile ? { mobile } : {}),
    ...(asString(r.appName, 60) ? { appName: asString(r.appName, 60) } : {}),
    ...(appIconUrl && safeHref(appIconUrl) ? { appIconUrl } : {}),
    ...(accentColor && HEX_COLOR.test(accentColor) ? { accentColor } : {}),
    ...(asString(r.templateId, 64) ? { templateId: asString(r.templateId, 64) } : {}),
  };
}

/** Normalise `links.launchpad_mode`, which a cached row from before the column existed may lack. */
export function readLaunchpadLinkMode(value: unknown): LaunchpadLinkMode {
  return LINK_MODES.find((m) => m === value) ?? 'inherit';
}

/**
 * Whether a desktop visitor gets the page.
 *
 * The link's own mode wins outright. Otherwise the workspace decides, and the
 * default serves the page only where the alternative is nothing at all.
 */
export function shouldServeLaunchpadOnDesktop(input: {
  hasWebDestination: boolean;
  orgMode?: LaunchpadDesktopMode;
  linkMode?: LaunchpadLinkMode;
}): boolean {
  const linkMode = input.linkMode ?? 'inherit';
  if (linkMode === 'off') return false;
  if (linkMode === 'on') return true;
  switch (input.orgMode ?? 'no-destination') {
    case 'always':
      return true;
    case 'off':
      return false;
    default:
      return !input.hasWebDestination;
  }
}

/**
 * Whether a mobile visitor gets the page.
 *
 * Only when the workspace chose `page`, and never for a platform whose link
 * carries a Universal Link / App Link: the OS resolves the installed case
 * before this server sees the click, and the 302 to that URL must stay so it
 * can. A link's `on` does not force the page onto a workspace that chose
 * `store` — that would be the extra hop other products had to add a skip flag
 * for — but `off` still opts a link out.
 */
export function shouldServeLaunchpadOnMobile(input: {
  mobileMode?: LaunchpadMobileMode;
  linkMode?: LaunchpadLinkMode;
  hasAppOpenPath: boolean;
}): boolean {
  if ((input.linkMode ?? 'inherit') === 'off') return false;
  if ((input.mobileMode ?? 'store') !== 'page') return false;
  return !input.hasAppOpenPath;
}

/** Content from the link row alone: what any deployment can show with no extra machinery. */
export function defaultLaunchpadContent(link: LaunchpadLinkFields, settings: LaunchpadSettings): LaunchpadContent {
  const image = link.og_image_url && safeHref(link.og_image_url) ? link.og_image_url : null;
  return {
    title: link.og_title || link.title || settings.appName || 'Open in the app',
    description: link.og_description || link.description || '',
    imageUrl: image,
    theme: {
      ...(settings.appName ? { appName: settings.appName } : {}),
      ...(settings.appIconUrl ? { appIconUrl: settings.appIconUrl } : {}),
      ...(settings.accentColor ? { accentColor: settings.accentColor } : {}),
    },
  };
}

/** WCAG relative luminance above ~0.5 reads better with dark text on it. */
function isLightColor(hex: string): boolean {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.5;
}

/** A fresh CSP nonce per response. */
export function createLaunchpadNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * The page's content-security policy.
 *
 * Scripts run only with this response's nonce. Inline `style` attributes are
 * allowed because a host-rendered hero region carries them, and a nonce on
 * `style-src` would make browsers ignore `'unsafe-inline'` — so the nonce
 * guards scripts alone. `connect-src` admits the beacon endpoint's origin when
 * one is configured; `sendBeacon` is governed by it.
 */
export function launchpadContentSecurityPolicy(nonce: string, beaconUrl?: string): string {
  const connect = new Set(["'self'"]);
  if (beaconUrl) {
    try {
      connect.add(new URL(beaconUrl).origin);
    } catch {
      // Relative beacon URL — 'self' covers it.
    }
  }
  return [
    "default-src 'none'",
    "img-src 'self' https: data:",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    `connect-src ${[...connect].join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export interface LaunchpadPageContext {
  content: LaunchpadContent;
  /** The link's id; the QR code is fetched from `/api/links/{id}/qr`. */
  linkId: string;
  /** Absolute URL of this page, for `og:url`. */
  pageUrl: string;
  iosUrl: string | null;
  androidUrl: string | null;
  /**
   * The link's web destination, when it has one. Rendered as a plain
   * "Continue on the web" link so the page is never a dead end: a desktop
   * visitor in `always` mode still has the destination the 302 would have
   * given them, and a phone visitor inside an in-app browser keeps the path
   * that lets a Universal Link fire on the next hop.
   */
  webUrl?: string | null;
  /**
   * The app's URI-scheme URL for this link, or null. When set, an "Open in app"
   * button is rendered whose only job is to navigate to it on tap. The URL
   * fragment of the page is appended on tap, so a key that lives only in the
   * fragment survives without ever reaching the server.
   */
  schemeUrl: string | null;
  /** Show the QR block. Meant for desktop; a phone scanning itself is no use. */
  showQr: boolean;
  nonce: string;
  /**
   * When set, the page reports `view` on load and `cta_ios` / `cta_android` /
   * `cta_open` / `cta_web` on the matching tap via `navigator.sendBeacon`, as a JSON body
   * `{ linkId, event }`. No cookies, no identifiers. Absent by default; the
   * endpoint is the host application's to provide.
   */
  beaconUrl?: string;
}

const STYLES = `
  :root { --lp-ink: #16181d; --lp-muted: #5f6673; --lp-bg: #ffffff; --lp-surface: #f4f5f7; --lp-line: #e2e5ea; --lp-accent: #2563eb; --lp-accent-ink: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --lp-ink: #eef0f3; --lp-muted: #a3abb8; --lp-bg: #121418; --lp-surface: #1c1f25; --lp-line: #2b3038; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--lp-bg); color: var(--lp-ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .lp { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; display: flex; flex-direction: column; gap: 1.5rem; }
  .lp-app { display: flex; align-items: center; gap: 0.75rem; min-height: 1rem; }
  .lp-app img { width: 48px; height: 48px; border-radius: 12px; object-fit: cover; background: var(--lp-surface); }
  .lp-app span { font-weight: 600; font-size: 1rem; }
  .lp-hero img { display: block; width: 100%; max-height: 22rem; object-fit: cover; border-radius: 14px; background: var(--lp-surface); margin-bottom: 1rem; }
  .lp-hero h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 0.5rem; text-wrap: balance; }
  .lp-hero p { margin: 0; color: var(--lp-muted); font-size: 1.05rem; }
  .lp-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }
  .lp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.8rem 1.25rem; border-radius: 10px; font-size: 0.95rem; font-weight: 600; text-decoration: none; border: 1px solid var(--lp-line); background: var(--lp-surface); color: var(--lp-ink); }
  .lp-btn-primary { background: var(--lp-accent); border-color: var(--lp-accent); color: var(--lp-accent-ink); }
  .lp-btn:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; }
  .lp-web { margin: -0.5rem 0 0; font-size: 0.95rem; }
  .lp-web a { color: var(--lp-accent); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
  .lp-web a:hover { color: var(--lp-ink); }
  .lp-qr { display: flex; align-items: center; gap: 1.25rem; padding: 1rem; border: 1px solid var(--lp-line); border-radius: 14px; background: var(--lp-surface); }
  .lp-qr img { width: 132px; height: 132px; border-radius: 8px; background: #fff; flex: none; }
  .lp-qr strong { display: block; font-size: 1rem; margin-bottom: 0.2rem; }
  .lp-qr p { margin: 0; color: var(--lp-muted); font-size: 0.9rem; }
  @media (max-width: 480px) { .lp-qr { flex-direction: column; text-align: center; } .lp-hero h1 { font-size: 1.5rem; } }
`;

/** Only shipped when a button or a beacon needs it; a page with neither has no script at all. */
const SCRIPT = `
(function () {
  var body = document.body;
  var open = document.getElementById('lp-open');
  if (open) {
    open.addEventListener('click', function () {
      open.href = open.getAttribute('data-scheme') + (window.location.hash || '');
    });
  }
  var beacon = body.getAttribute('data-beacon');
  if (beacon && navigator.sendBeacon) {
    var linkId = body.getAttribute('data-link-id');
    var send = function (event) {
      try { navigator.sendBeacon(beacon, JSON.stringify({ linkId: linkId, event: event })); } catch (e) {}
    };
    send('view');
    var ctas = document.querySelectorAll('[data-lp-cta]');
    for (var i = 0; i < ctas.length; i++) {
      ctas[i].addEventListener('click', function (e) { send(e.currentTarget.getAttribute('data-lp-cta')); });
    }
  }
})();
`;

/**
 * Render the full HTML document. Pure: same context, same output (the nonce
 * is an input). Every string from `content`, the URLs and the theme is
 * escaped; `content.heroHtml` is the documented exception.
 */
export function renderLaunchpadPage(ctx: LaunchpadPageContext): string {
  const content = ctx.content;
  const theme = content.theme;
  const title = escapeHtml(content.title);
  const description = escapeHtml(content.description);
  const imageUrl = content.imageUrl && safeHref(content.imageUrl) ? escapeHtml(content.imageUrl) : null;
  const iconUrl = theme.appIconUrl && safeHref(theme.appIconUrl) ? escapeHtml(theme.appIconUrl) : null;
  const iosUrl = ctx.iosUrl && safeHref(ctx.iosUrl) ? escapeHtml(ctx.iosUrl) : null;
  const androidUrl = ctx.androidUrl && safeHref(ctx.androidUrl) ? escapeHtml(ctx.androidUrl) : null;
  const accent = theme.accentColor && HEX_COLOR.test(theme.accentColor) ? theme.accentColor : null;
  const accentInk = accent && isLightColor(accent) ? '#16181d' : '#ffffff';
  const nonce = escapeHtml(ctx.nonce);

  const head = [
    `<title>${title}</title>`,
    description ? `<meta name="description" content="${description}">` : '',
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(ctx.pageUrl)}">`,
    `<meta property="og:title" content="${title}">`,
    description ? `<meta property="og:description" content="${description}">` : '',
    imageUrl ? `<meta property="og:image" content="${imageUrl}">` : '',
    `<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">`,
  ]
    .filter(Boolean)
    .join('\n');

  const header =
    iconUrl || theme.appName
      ? `<header class="lp-app">${iconUrl ? `<img src="${iconUrl}" alt="" width="48" height="48">` : ''}${
          theme.appName ? `<span>${escapeHtml(theme.appName)}</span>` : ''
        }</header>`
      : '';

  const hero = content.heroHtml
    ? `<section class="lp-hero">${content.heroHtml}</section>`
    : `<section class="lp-hero">${imageUrl ? `<img src="${imageUrl}" alt="">` : ''}<h1>${title}</h1>${
        description ? `<p>${description}</p>` : ''
      }</section>`;

  const schemeUrl = ctx.schemeUrl && safeSchemeHref(ctx.schemeUrl) ? escapeHtml(ctx.schemeUrl) : null;
  const buttons = [
    schemeUrl
      ? `<a class="lp-btn lp-btn-primary" id="lp-open" data-lp-cta="cta_open" data-scheme="${schemeUrl}" href="${schemeUrl}">Open in app</a>`
      : '',
    iosUrl
      ? `<a class="lp-btn${schemeUrl ? '' : ' lp-btn-primary'}" data-lp-cta="cta_ios" href="${iosUrl}">Download on the App Store</a>`
      : '',
    androidUrl
      ? `<a class="lp-btn${schemeUrl || iosUrl ? '' : ' lp-btn-primary'}" data-lp-cta="cta_android" href="${androidUrl}">Get it on Google Play</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  const webUrl = ctx.webUrl && safeHref(ctx.webUrl) ? escapeHtml(ctx.webUrl) : null;
  const actions = buttons ? `<section class="lp-actions">${buttons}</section>` : '';
  const web = webUrl
    ? `<p class="lp-web"><a data-lp-cta="cta_web" href="${webUrl}">Continue on the web</a></p>`
    : '';

  const qr = ctx.showQr
    ? `<section class="lp-qr"><img src="/api/links/${escapeHtml(ctx.linkId)}/qr?format=svg&amp;size=264" alt="QR code for this link" width="132" height="132"><div><strong>Scan to open on your phone</strong><p>Point your phone's camera at the code to open this link there.</p></div></section>`
    : '';

  const needsScript = Boolean(schemeUrl || ctx.beaconUrl);
  const bodyAttrs = [
    `data-link-id="${escapeHtml(ctx.linkId)}"`,
    ctx.beaconUrl ? `data-beacon="${escapeHtml(ctx.beaconUrl)}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${head}
<style>${STYLES}${accent ? `\n  :root { --lp-accent: ${accent}; --lp-accent-ink: ${accentInk}; }` : ''}</style>
</head>
<body ${bodyAttrs}>
<main class="lp">
${header}
${hero}
${actions}
${web}
${qr}
</main>
${needsScript ? `<script nonce="${nonce}">${SCRIPT}</script>` : ''}
</body>
</html>`;
}
