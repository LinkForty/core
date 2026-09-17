/**
 * Link safety states for the redirect path.
 *
 * Three outcomes are possible for a link that exists:
 *
 *   - `allow` — resolve normally.
 *   - `warn`  — serve an interstitial that shows the destination and requires an
 *               explicit click. For a link that is *suspected* unsafe rather than
 *               confirmed, this is strictly better than a hard block: a false
 *               positive still lets the visitor through, while a true positive
 *               still breaks the one-click flow a malicious link depends on.
 *   - `block` — do not resolve.
 *
 * A `block` used to be indistinguishable from an unknown short code, on the
 * reasoning that a distinct response would confirm the code was real and leak that
 * its owner is under a restriction.
 *
 * Two things were wrong with that. The secrecy was close to nil — whoever created
 * the links already knows their own short codes, and a live link answers 302 while
 * a dead one does not, so "real but withdrawn" was already distinguishable by the
 * only party it was meant to be hidden from. And the response it produced was a raw
 * JSON error, rendered on whatever branded domain the short link was served from.
 *
 * So a block caused by an explicit decision now answers 410 with a plain page —
 * `blockCauseIsAbuse()` and `generateBlockedLinkHTML()` below. 410 rather than 404
 * because the code existed and was withdrawn, which is a different fact from never
 * having existed and is worth stating to anything reading the status.
 *
 * **The page says nothing about why.** It makes no claim about the link, its
 * destination, or whoever created it. That is deliberate: a page on a short-link
 * domain is not the place to characterise a user's content, and any claim made
 * there would be wrong — and hard to withdraw — the first time a link is disabled
 * in error.
 *
 * **The carve-out is deliberately narrow, and must stay narrow.** It applies only
 * to an explicit disable or an owner restriction. A link that is merely inactive —
 * expired, or switched off by the person who made it — keeps the old opaque
 * response. Its cause is ambiguous, nobody decided anything about it, and there is
 * nothing to say.
 */
export type LinkSafetyOutcome = 'allow' | 'warn' | 'block';

export interface LinkSafetyInput {
  /** Whether the link is active. Absent/undefined is treated as active. */
  isActive?: boolean | null;
  /** Set when the link should serve a warning instead of resolving. */
  warnAt?: Date | string | null;
  /**
   * Set when the link's owner is restricted. Optional because the owning table is
   * not part of this package's schema — deployments that do not model owner
   * restriction simply never pass it.
   */
  ownerSuspendedAt?: Date | string | null;
  /**
   * Set when the link was explicitly taken out of resolution.
   *
   * This is the field that separates "someone decided to stop this link" from
   * "this link is off", and the distinction carries the whole notice below. An
   * expiry sweep sets `isActive` and leaves this null; so does a person switching
   * their own link off. Only a deliberate removal sets it.
   *
   * Never infer the cause from `isActive` instead. The two disagree far more often
   * than they agree — most inactive links in a mature deployment expired or were
   * switched off, and none of those visitors should be told they were phished.
   */
  disabledAt?: Date | string | null;
}

/** Why a link was blocked. Only the first two are an abuse decision. */
export type LinkBlockCause = 'owner_suspended' | 'disabled' | 'inactive';

export interface LinkSafetyDecision {
  outcome: LinkSafetyOutcome;
  /** Present only when `outcome` is `block`. */
  cause?: LinkBlockCause;
}

/**
 * Whether a block cause represents a decision someone made about abuse, as opposed
 * to a link that is simply not live.
 *
 * The gate for the notice. Kept as a named predicate rather than an inline
 * comparison so there is exactly one place to look when asking "who sees this
 * page", and so widening it is a visible edit rather than an incidental one.
 */
export function blockCauseIsAbuse(cause: LinkBlockCause | undefined): boolean {
  return cause === 'owner_suspended' || cause === 'disabled';
}

/**
 * Decide what to do with a link that was found, and say why.
 *
 * Order matters, and it is not the same as the order of severity. Owner
 * restriction and an explicit disable both beat `warn`: a link whose owner is
 * restricted must be unreachable even if it was only flagged to warn.
 *
 * `disabled` is tested before the bare `isActive` check so that an abuse disable
 * keeps its cause. Both set `isActive` to false in practice, and whichever is
 * tested first wins — putting `isActive` first would silently collapse every
 * abuse disable into `inactive` and the notice would never be served. There is a
 * test for exactly that ordering.
 */
export function evaluateLinkSafetyDecision(input: LinkSafetyInput): LinkSafetyDecision {
  if (input.ownerSuspendedAt != null) return { outcome: 'block', cause: 'owner_suspended' };
  if (input.disabledAt != null) return { outcome: 'block', cause: 'disabled' };
  if (input.isActive === false) return { outcome: 'block', cause: 'inactive' };
  if (input.warnAt != null) return { outcome: 'warn' };
  return { outcome: 'allow' };
}

/**
 * The outcome alone.
 *
 * Retained with its original signature because it is part of this package's public
 * surface; callers that only branch on allow/warn/block need no change.
 */
export function evaluateLinkSafety(input: LinkSafetyInput): LinkSafetyOutcome {
  return evaluateLinkSafetyDecision(input).outcome;
}

/**
 * A destination is only safe to put in an `href` if it is http(s).
 *
 * `escapeHtml` is not sufficient on its own: a URL scheme contains none of the
 * characters it neutralises, so `javascript:alert(1)` passes through untouched and
 * becomes executable on click. That matters here more than almost anywhere else —
 * this page is shown *only* for links already flagged as suspicious, so the
 * destinations reaching it are the most likely in the system to be hostile.
 *
 * Reachable in practice, not just in theory: zod's `.url()` accepts `javascript:`
 * and `data:` URLs, so a stored destination can already hold one. Tightening
 * validation at write time is worth doing separately, but this page must not
 * depend on that having happened.
 *
 * Returns null when there is nothing safe to link to — including a bare deep-link
 * path, which would otherwise render as a relative link to the redirect host
 * rather than the real destination. Callers render that as inert text.
 */
export function safeHref(destination: string): string | null {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? destination : null;
}

/**
 * Schemes a browser will execute or treat as local content rather than hand to
 * another application. A URI-scheme link exists to open a native app; nothing on
 * this list is one.
 */
const EXECUTABLE_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about']);

/**
 * Accept a URI-scheme URL (`myapp://…`, `com.example.app://…`) for an href that
 * is meant to open a native app, rejecting the schemes a browser would execute
 * instead. `safeHref` is the wrong tool here — it admits only http(s), which is
 * the one family a scheme link is not.
 *
 * Returns null when the value has no scheme, or a scheme on the executable list.
 * The check is on the raw string, not `new URL()`: WHATWG parsing of unknown
 * schemes is permissive about whitespace and case, and this must not be.
 */
export function safeSchemeHref(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!match) return null;
  return EXECUTABLE_SCHEMES.has(match[1].toLowerCase()) ? null : url;
}

/** Minimal HTML escaping for interpolating a URL into markup and an href. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Interstitial shown for a `warn` outcome.
 *
 * Shows the destination in full — the point is to hand back the information the
 * short link hid, so the visitor can judge for themselves. Continuing takes a
 * deliberate click, which is what breaks the one-click flow.
 *
 * Contains no JavaScript and no external assets: it must render on a bare
 * redirect host and under a strict content-security policy.
 */
export function generateWarningLinkHTML(
  destination: string,
  options: { reportUrl?: string } = {}
): string {
  const shown = destination && destination.trim() ? escapeHtml(destination) : '(no destination recorded)';
  const href = destination ? safeHref(destination) : null;
  // No anchor at all when there is nothing safe to link to. An href="" would
  // re-request the warning page, so "Continue anyway" would just reload it.
  const continueButton = href
    ? `<a class="go" href="${escapeHtml(href)}" rel="nofollow noopener noreferrer">Continue anyway</a>`
    : `<p class="inert">This link has no usable web destination, so there is nothing to continue to.</p>`;
  const reportLink = options.reportUrl
    ? `<p class="report"><a href="${escapeHtml(options.reportUrl)}" rel="nofollow noopener">Report this link</a></p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Check this link before continuing</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f6f7f8; color:#16191d; padding:24px;
         font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:34rem; width:100%; background:#fff; border:1px solid #e3e6ea;
          border-radius:10px; padding:28px; }
  h1 { margin:0 0 12px; font-size:1.35rem; line-height:1.25; }
  p { margin:0 0 14px; }
  .dest { display:block; word-break:break-all; background:#f0f2f4; border-radius:6px;
          padding:10px 12px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          font-size:.9rem; margin-bottom:18px; }
  a.go { display:inline-block; text-decoration:none; border:1px solid #c9ced4; color:#16191d;
         border-radius:6px; padding:9px 15px; font-size:.95rem; font-weight:600; }
  .inert { margin:0; font-size:.9rem; color:#5b636d; }
  .report { margin:16px 0 0; font-size:.85rem; }
  .report a { color:#5b636d; }
  @media (prefers-color-scheme: dark) {
    body { background:#14171a; color:#e8eaed; }
    .card { background:#1d2126; border-color:#2c3238; }
    .dest { background:#14171a; }
    a.go { border-color:#3a4149; color:#e8eaed; }
    .report a { color:#98a1ab; }
    .inert { color:#98a1ab; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Check this link before continuing</h1>
    <p>This short link has been flagged as possibly unsafe, so we have not sent you
       straight there. It leads to:</p>
    <span class="dest">${shown}</span>
    <p>If you were not expecting this link, or it claims to be from a bank, a government
       service, or a company you do business with, close this page. Do not enter any
       password or personal details.</p>
    ${continueButton}
    ${reportLink}
  </main>
</body>
</html>`;
}

/**
 * Copy for the page, separated from the markup.
 *
 * A structure rather than inline strings so a translation is a data addition and
 * not a rewrite.
 *
 * Deliberately states only that the link is gone. Earlier drafts explained why and
 * told the visitor what to do if they had entered a password — useful to someone
 * who followed a hostile link, but it puts an accusation about a user's content on
 * a page we serve, and makes a claim that would be false the first time a link is
 * disabled in error. Nothing here is a claim about anything.
 */
const BLOCKED_COPY = {
  title: 'This link is no longer available',
  heading: 'This link is no longer available',
  body: 'It was removed and no longer goes anywhere.',
} as const;

/**
 * Page served when a link was blocked by an explicit decision.
 *
 * Four things are deliberately absent, and each was a decision rather than an
 * omission:
 *
 *  - **Any statement of why.** See BLOCKED_COPY above.
 *  - **No way to continue.** The warning interstitial offers one because a `warn`
 *    link is only suspected. Here there is nowhere to send anyone, and an escape
 *    hatch would defeat the block.
 *  - **No destination, owner, or other link detail.** The visitor is not entitled
 *    to another party's details, and a withheld destination cannot be re-followed.
 *  - **Next to no branding.** Whoever reads this has no relationship with whatever
 *    is hosting the link.
 *
 * Takes no arguments, so nothing from the link can reach it. That is the property
 * worth preserving: adding a parameter here is how a destination or an owner ends
 * up rendered to a stranger. There is a test asserting the arity stays zero.
 *
 * No JavaScript and no external assets, so it renders on a bare redirect host and
 * under a strict content-security policy.
 */
export function generateBlockedLinkHTML(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${BLOCKED_COPY.title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f6f7f8; color:#16191d; padding:24px;
         font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:30rem; width:100%; background:#fff; border:1px solid #e3e6ea;
          border-radius:10px; padding:28px; text-align:center; }
  h1 { margin:0 0 10px; font-size:1.25rem; line-height:1.3; }
  p { margin:0; color:#5b636d; }
  @media (prefers-color-scheme: dark) {
    body { background:#14171a; color:#e8eaed; }
    .card { background:#1d2126; border-color:#2c3238; }
    p { color:#98a1ab; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>${BLOCKED_COPY.heading}</h1>
    <p>${BLOCKED_COPY.body}</p>
  </main>
</body>
</html>`;
}

/**
 * Build a memoised probe for owner-restriction support.
 *
 * A factory rather than module state: each registration gets its own, so two servers
 * in one process pointed at different databases cannot share an answer, and no
 * test-only reset has to be exported.
 *
 * Shared by every path that resolves a link and caches the result, and that sharing
 * is the whole point. The redirect and the SDK resolve endpoint write the SAME Redis
 * key, so if one selects `owner_suspended_at` and the other does not, the second
 * silently caches a row that makes the first one's gate pass. Keeping the SELECT
 * fragment in one place is what stops them drifting apart again.
 *
 * The in-flight promise is memoised, not just the result, so concurrent cold requests
 * issue one probe. A failure resolves to "unsupported", so a probe error can never
 * take a resolution path down.
 */
export function createOwnerSuspensionSelect(deps: {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
  onSupported?: () => void;
}): () => Promise<string> {
  let probe: Promise<string> | null = null;
  return () => {
    if (!probe) {
      probe = deps
        .query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name = 'organizations' AND column_name = 'suspended_at'`
        )
        .then((r) => {
          const supported = r.rows.length > 0;
          if (supported) deps.onSupported?.();
          return supported ? ', o.suspended_at AS owner_suspended_at' : '';
        })
        .catch(() => '');
    }
    return probe;
  };
}
