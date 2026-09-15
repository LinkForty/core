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
 * its owner is under a restriction. That reasoning does not survive contact with
 * who is actually on the other end.
 *
 * The person following a link that was disabled for abuse is the intended victim of
 * whatever the link was doing. They received a message imitating a bank, an
 * employer or a government service, and they clicked it — often having already
 * entered something on the page before it was taken down. A response that says
 * nothing reads as "broken, try again later", and the next thing they do is go
 * looking for the real site, or for the message again.
 *
 * The secrecy it bought was close to nil. Whoever created the links already knows
 * their own short codes, and a working link answers 302 while a dead one does not,
 * so the ability to tell "real but stopped" from "never existed" was already there
 * for the only party it was meant to be hidden from.
 *
 * So a block caused by an explicit abuse decision now serves a notice instead —
 * `blockCauseIsAbuse()` and `generateBlockedLinkHTML()` below.
 *
 * **The carve-out is deliberately narrow, and must stay narrow.** It applies only
 * to an explicit disable or an owner restriction. A link that is merely inactive —
 * expired, or switched off by the person who made it — keeps the old opaque
 * response, because its cause is ambiguous and telling that link's visitors they
 * may have been phished would be false, and damaging to whoever made it.
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
 * Copy for the notice, separated from the markup.
 *
 * A structure rather than inline strings so a translation is a data addition and
 * not a rewrite. That matters more than usual here: this page exists for someone
 * who has just been targeted, and advice in a language they do not read is
 * decoration. Only English ships today; the shape is what makes adding to it cheap.
 */
const BLOCKED_COPY = {
  title: 'This link has been removed',
  heading: 'This link has been removed',
  lede:
    'It was reported as a page designed to trick people into giving away passwords, ' +
    'payment details, or personal information, so it no longer works.',
  actionHeading: 'If you entered anything after following this link',
  actions: [
    'Change that password now, and anywhere else you use the same one.',
    'If you entered card or bank details, contact your bank straight away.',
    'If you entered a verification or one-time code, assume someone tried to use it.',
  ],
  warning:
    'Contact the organisation using a phone number or web address you already have — ' +
    'from a statement, a card, or a site you typed yourself. Do not use any contact ' +
    'details from the message or page that sent you here; they may belong to the ' +
    'same people.',
  reassurance: 'If you did not enter anything, there is nothing you need to do.',
} as const;

/**
 * Notice served when a link was blocked by an abuse decision.
 *
 * Three things are deliberately absent, and each was a decision rather than an
 * omission:
 *
 *  - **No way to continue.** The warning interstitial offers one because a `warn`
 *    link is only suspected. Here there is nowhere safe to send anyone, and an
 *    escape hatch would defeat the block for the exact person it protects.
 *  - **No destination, workspace, or account holder.** The visitor is not entitled
 *    to another party's details, and naming the destination would put the hostile
 *    URL back in front of the one person already proven to click it.
 *  - **Next to no branding.** Whoever reads this has no relationship with whatever
 *    is hosting the link. A prominent unfamiliar name on a page about fraud invites
 *    the reasonable suspicion that the page is itself the fraud.
 *
 * No JavaScript and no external assets, so it renders on a bare redirect host and
 * under a strict content-security policy. Nothing is interpolated from the link, so
 * unlike the warning page there is no untrusted value to escape — keep it that way.
 */
export function generateBlockedLinkHTML(): string {
  const actions = BLOCKED_COPY.actions.map((a) => `      <li>${a}</li>`).join('\n');

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
  .card { max-width:34rem; width:100%; background:#fff; border:1px solid #e3e6ea;
          border-radius:10px; padding:28px; }
  h1 { margin:0 0 12px; font-size:1.35rem; line-height:1.25; }
  h2 { margin:22px 0 10px; font-size:1rem; }
  p { margin:0 0 14px; }
  ul { margin:0 0 14px; padding-left:20px; }
  li { margin:0 0 7px; }
  .warn { background:#fdf3f2; border:1px solid #f3d6d2; border-radius:6px;
          padding:12px 14px; margin:0 0 14px; }
  .calm { font-size:.9rem; color:#5b636d; margin:0; }
  @media (prefers-color-scheme: dark) {
    body { background:#14171a; color:#e8eaed; }
    .card { background:#1d2126; border-color:#2c3238; }
    .warn { background:#2a1e1e; border-color:#4a2f2c; }
    .calm { color:#98a1ab; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>${BLOCKED_COPY.heading}</h1>
    <p>${BLOCKED_COPY.lede}</p>
    <h2>${BLOCKED_COPY.actionHeading}</h2>
    <ul>
${actions}
    </ul>
    <p class="warn">${BLOCKED_COPY.warning}</p>
    <p class="calm">${BLOCKED_COPY.reassurance}</p>
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
