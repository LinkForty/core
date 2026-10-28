/**
 * The page a browser gets when a short link can't be served.
 *
 * Several different things end here: a code that never existed, one that expired
 * or was switched off, a link on another organization's host, a visitor outside
 * the link's targeting rules, and a link with nowhere to send this device. They
 * all render the SAME page. An expired or switched-off link must not be told
 * apart from a code that never existed (see the safety gate in
 * routes/redirect.ts), and a page that varied its copy by reason would do exactly
 * that. The reason decides whose settings apply, never what the page says.
 *
 * What the page says, or where the visitor is sent instead, comes from the first
 * of these that answers:
 *
 *   1. the `notFound` hook, for a deployment that needs logic;
 *   2. the organization's `settings.notFound`, read by Core itself;
 *   3. the instance's `notFoundDefaults` — on the Docker image, the NOT_FOUND_*
 *      environment variables (notFoundSettingsFromEnv);
 *   4. the built-in page.
 *
 * The organization is the one the request's host belongs to. Failing that, for a
 * live link that just has nothing for this visitor (a targeting miss, no
 * destination), it is the link's own organization. An unknown, expired or
 * switched-off code on a shared host has no organization to speak for it and gets
 * the instance's page.
 *
 * A link withdrawn for abuse is not a not-found: it keeps its own 410 notice
 * (generateBlockedLinkHTML in link-safety.ts) and never reaches this module.
 *
 * Clients that don't ask for HTML — API callers, scripts, health checks — keep
 * the JSON body they have always had.
 */
import { escapeHtml, safeHref } from './link-safety.js';

/** Why the link couldn't be served. For the host's hook; the page never shows it. */
export type NotFoundReason =
  /** No such code, an expired or switched-off link, or another organization's link on this host. */
  | 'unknown'
  /** Switched off by a decision that isn't about abuse. */
  | 'disabled'
  /** The visitor is outside the link's country, device or language rules. */
  | 'not_targeted'
  /** The link has no destination for this visitor's device. */
  | 'no_destination';

/** Everything optional: an empty object renders the default page. */
export interface NotFoundContent {
  title?: string;
  message?: string;
  /** http(s) only; anything else is dropped. */
  logoUrl?: string;
  /** `#rgb`, `#rrggbb` or with alpha; anything else is dropped. */
  accentColor?: string;
  backgroundColor?: string;
  /** The button is shown only when both label and a valid http(s) URL are present. */
  buttonLabel?: string;
  buttonUrl?: string;
}

/**
 * Not-found settings, as an organization stores them in `settings.notFound` and
 * as an instance passes them in `notFoundDefaults`. With `redirectUrl`, browsers
 * are sent there (302) and the rest is ignored; without it, the rest is the page.
 */
export interface NotFoundSettings extends NotFoundContent {
  /** http(s) only. */
  redirectUrl?: string;
}

export type NotFoundResolution =
  | { kind: 'page'; content: NotFoundContent }
  | { kind: 'redirect'; url: string };

export interface NotFoundContext {
  reason: NotFoundReason;
  /**
   * The resolved link row, when there is one. Null for `unknown`, including a
   * link that belongs to another organization: that row is not this host's to
   * hand out.
   */
  link: Record<string, any> | null;
  /** The organization the request's host belongs to (lib/link-lookup.ts), if any. */
  scope: string | null;
}

export const NOT_FOUND_DEFAULTS = {
  title: 'Link not found',
  message: "This link doesn't exist or is no longer available.",
} as const;

/** JSON bodies kept for clients that don't accept HTML. */
export const NOT_FOUND_JSON = {
  default: { error: 'Link not found' },
  no_destination: { error: 'No destination URL configured for this link' },
} as const;

const TITLE_MAX = 120;
const MESSAGE_MAX = 500;
const BUTTON_LABEL_MAX = 60;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** True when the request will render HTML — a browser navigation. */
export function wantsHtml(accept: string | string[] | undefined): boolean {
  const value = Array.isArray(accept) ? accept.join(',') : accept ?? '';
  return value.toLowerCase().includes('text/html');
}

/**
 * The page's content-security policy. It runs no script at all, so none is
 * allowed; images may come from any https origin because the logo is the host's.
 */
export function notFoundContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "img-src https: data:",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** A redirect target from the host's hook, or null when it isn't http(s). */
export function safeNotFoundRedirect(url: unknown): string | null {
  return typeof url === 'string' ? safeHref(url) : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function color(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : null;
}

const SETTING_KEYS = [
  'redirectUrl',
  'title',
  'message',
  'logoUrl',
  'accentColor',
  'backgroundColor',
  'buttonLabel',
  'buttonUrl',
] as const;

/**
 * Settings from untrusted JSON (an organization's `settings`, a config file):
 * keeps the known string fields, and returns null when none is set.
 * Values are checked again where they are used.
 */
export function readNotFoundSettings(raw: unknown): NotFoundSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const settings: NotFoundSettings = {};
  for (const key of SETTING_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) settings[key] = value.trim();
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

/** An organization's not-found settings, from its `settings` column. */
export function readOrganizationNotFoundSettings(orgSettings: unknown): NotFoundSettings | null {
  if (!orgSettings || typeof orgSettings !== 'object') return null;
  return readNotFoundSettings((orgSettings as Record<string, unknown>).notFound);
}

/** Environment variable for each setting. */
export const NOT_FOUND_ENV = {
  redirectUrl: 'NOT_FOUND_REDIRECT_URL',
  title: 'NOT_FOUND_TITLE',
  message: 'NOT_FOUND_MESSAGE',
  logoUrl: 'NOT_FOUND_LOGO_URL',
  accentColor: 'NOT_FOUND_ACCENT_COLOR',
  backgroundColor: 'NOT_FOUND_BACKGROUND_COLOR',
  buttonLabel: 'NOT_FOUND_BUTTON_LABEL',
  buttonUrl: 'NOT_FOUND_BUTTON_URL',
} as const satisfies Record<(typeof SETTING_KEYS)[number], string>;

/**
 * Instance settings from NOT_FOUND_* environment variables, for `notFoundDefaults`.
 * Undefined when none is set.
 */
export function notFoundSettingsFromEnv(
  env: Record<string, string | undefined> = process.env
): NotFoundSettings | undefined {
  const raw: Record<string, string | undefined> = {};
  for (const key of SETTING_KEYS) raw[key] = env[NOT_FOUND_ENV[key]];
  return readNotFoundSettings(raw) ?? undefined;
}

/** How long an organization's settings are reused before being read again. */
export const NOT_FOUND_SETTINGS_TTL_MS = 60_000;
const NOT_FOUND_SETTINGS_MAX_ENTRIES = 1000;

/**
 * Read an organization's not-found settings, reusing each answer for a minute.
 *
 * Only an unknown code on an organization's host needs this: every other case
 * already has the link row, which carries its organization's settings. Unknown
 * codes are what scanners hit, so the answer is held rather than read per
 * request. A change to the settings shows within NOT_FOUND_SETTINGS_TTL_MS.
 *
 * A factory rather than module state, so each registration (and each test) has
 * its own. A failed read resolves to null and is not held.
 */
export function createOrganizationNotFoundSettingsLookup(deps: {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  onError?: (error: unknown) => void;
  now?: () => number;
}): (organizationId: string) => Promise<NotFoundSettings | null> {
  const held = new Map<string, { settings: NotFoundSettings | null; until: number }>();
  const now = deps.now ?? Date.now;
  return async (organizationId) => {
    const hit = held.get(organizationId);
    if (hit && hit.until > now()) return hit.settings;
    try {
      const result = await deps.query('SELECT settings FROM organizations WHERE id = $1', [organizationId]);
      const settings = readOrganizationNotFoundSettings(result.rows[0]?.settings);
      if (held.size >= NOT_FOUND_SETTINGS_MAX_ENTRIES) held.clear();
      held.set(organizationId, { settings, until: now() + NOT_FOUND_SETTINGS_TTL_MS });
      return settings;
    } catch (error) {
      deps.onError?.(error);
      return null;
    }
  };
}

/** What settings ask for: a redirect when they name a valid URL, otherwise the page. */
export function resolveNotFoundSettings(settings: NotFoundSettings): NotFoundResolution {
  const target = settings.redirectUrl ? safeNotFoundRedirect(settings.redirectUrl) : null;
  if (target) return { kind: 'redirect', url: target };
  const { redirectUrl: _ignored, ...content } = settings;
  return { kind: 'page', content };
}

export function renderNotFoundPage(content: NotFoundContent = {}): string {
  const title = escapeHtml(text(content.title, TITLE_MAX) ?? NOT_FOUND_DEFAULTS.title);
  const message = escapeHtml(text(content.message, MESSAGE_MAX) ?? NOT_FOUND_DEFAULTS.message);
  const logoUrl = typeof content.logoUrl === 'string' ? safeHref(content.logoUrl.trim()) : null;
  const buttonUrl = typeof content.buttonUrl === 'string' ? safeHref(content.buttonUrl.trim()) : null;
  const buttonLabel = text(content.buttonLabel, BUTTON_LABEL_MAX);
  const accent = color(content.accentColor);
  const background = color(content.backgroundColor);

  // Written after the dark-mode block so the accent wins in both schemes. The
  // background applies in light mode only: a brand background is almost always
  // light, and behind the dark-mode card it would show as a bright frame.
  const brandStyles = [
    accent ? `.button { background:${accent}; color:#fff; }` : '',
    background ? `@media (prefers-color-scheme: light) { body { background:${background}; } }` : '',
  ].join('\n  ');

  const logo = logoUrl
    ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="" referrerpolicy="no-referrer">\n    `
    : '';
  const button =
    buttonUrl && buttonLabel
      ? `\n    <a class="button" href="${escapeHtml(buttonUrl)}" rel="noopener noreferrer">${escapeHtml(buttonLabel)}</a>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f6f7f8; color:#16191d; padding:24px; box-sizing:border-box;
         font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:30rem; width:100%; background:#fff; border:1px solid #e3e6ea;
          border-radius:10px; padding:28px; text-align:center; box-sizing:border-box; }
  .logo { display:block; max-height:48px; max-width:60%; margin:0 auto 18px; }
  h1 { margin:0 0 10px; font-size:1.25rem; line-height:1.3; }
  p { margin:0; color:#5b636d; }
  .button { display:inline-block; margin-top:20px; padding:10px 18px; border-radius:8px;
         background:#16191d; color:#fff; text-decoration:none; font-weight:600; }
  @media (prefers-color-scheme: dark) {
    body { background:#14171a; color:#e8eaed; }
    .card { background:#1d2126; border-color:#2c3238; }
    p { color:#98a1ab; }
    .button { background:#e8eaed; color:#14171a; }
  }
  ${brandStyles}
</style>
</head>
<body>
  <main class="card">
    ${logo}<h1>${title}</h1>
    <p>${message}</p>${button}
  </main>
</body>
</html>`;
}
