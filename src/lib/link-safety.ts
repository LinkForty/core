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
 *   - `block` — behave as if the link does not exist.
 *
 * `block` deliberately produces the same response as an unknown short code. A
 * distinct "this link was disabled" response would confirm to whoever is probing
 * that the code was real, and would leak that its owner is under a restriction.
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
}

/**
 * Decide what to do with a link that was found.
 *
 * Order matters: owner restriction and inactivity both beat `warn`. A link whose
 * owner is restricted must be unreachable even if it was only flagged to warn.
 */
export function evaluateLinkSafety(input: LinkSafetyInput): LinkSafetyOutcome {
  if (input.ownerSuspendedAt != null) return 'block';
  if (input.isActive === false) return 'block';
  if (input.warnAt != null) return 'warn';
  return 'allow';
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
