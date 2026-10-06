/**
 * Web-only templates and the domain association files that honour them.
 *
 * A template flagged `webOnly` declares that its links are for the web: they
 * must open the website on every device, even when the app is installed. Two
 * things have to agree for that to hold:
 *
 *  1. The redirect sends the visitor to the web destination (routes/redirect.ts).
 *  2. The OS never hands the URL to the app in the first place. iOS and
 *     Android decide that from the domain's association files *before* any
 *     request reaches us, so the template's path is excluded there.
 *
 * App links stay the default: a template is web-only only when the flag is
 * exactly `true`. When no template is web-only, both files are byte-for-byte
 * what they were before this existed.
 */

/** True when a template's settings declare its links web-only. */
export function isWebOnlyTemplate(settings: unknown): boolean {
  return !!settings && typeof settings === 'object' && (settings as Record<string, unknown>).webOnly === true;
}

/**
 * Slugs safe to write into a path pattern. `*` and `?` are wildcards in both
 * Apple's and Google's matchers, so anything outside the generated slug
 * alphabet is skipped rather than escaped.
 */
const SAFE_SLUG = /^[A-Za-z0-9_-]+$/;

function excludablePaths(webOnlySlugs: readonly string[]): string[] {
  return [...new Set(webOnlySlugs)].filter((s) => SAFE_SLUG.test(s)).sort().map((s) => `/${s}/*`);
}

/**
 * Apple caps the file at 128KB, and an oversized or unparseable file stops
 * every Universal Link on the domain, not just the excluded ones. Stay well
 * under it: past this budget the exclusions are dropped and the file falls
 * back to claiming every path, which is how it behaved before.
 */
export const AASA_EXCLUSION_BUDGET_BYTES = 100 * 1024;

export interface AppleAppSiteAssociation {
  applinks: {
    apps: never[];
    details: Array<{
      appID: string;
      paths: string[];
      appIDs?: string[];
      components?: Array<Record<string, unknown>>;
    }>;
  };
}

/**
 * The AASA document for one app. `components` is read by iOS 13+; `paths`
 * (with `NOT`) by older versions, which ignore `components`. Excludes come
 * first because both matchers stop at the first pattern that matches.
 *
 * `onBudgetExceeded` is told when exclusions had to be dropped, so the caller
 * can log it — the file itself stays valid either way.
 */
export function buildAppleAppSiteAssociation(
  appId: string,
  webOnlySlugs: readonly string[] = [],
  onBudgetExceeded?: (excludedCount: number, bytes: number) => void
): AppleAppSiteAssociation {
  const claimAll: AppleAppSiteAssociation = {
    applinks: { apps: [], details: [{ appID: appId, paths: ['*'] }] },
  };
  const excluded = excludablePaths(webOnlySlugs);
  if (excluded.length === 0) return claimAll;

  const withExclusions: AppleAppSiteAssociation = {
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          paths: [...excluded.map((p) => `NOT ${p}`), '*'],
          appIDs: [appId],
          components: [
            ...excluded.map((p) => ({ '/': p, exclude: true, comment: 'Web-only template' })),
            { '/': '*' },
          ],
        },
      ],
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(withExclusions));
  if (bytes > AASA_EXCLUSION_BUDGET_BYTES) {
    onBudgetExceeded?.(excluded.length, bytes);
    return claimAll;
  }
  return withExclusions;
}

export interface AssetLinksStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
  relation_extensions?: Record<string, { dynamic_app_link_components: Array<Record<string, unknown>> }>;
}

const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

/**
 * The assetlinks.json document for one app. Exclusions are Android 15+
 * "dynamic App Links" rules: they can only narrow what the app's manifest
 * already claims, older Android ignores them, and a malformed block makes
 * Android drop the rules rather than the association.
 */
export function buildAssetLinks(
  packageName: string,
  fingerprints: string[],
  webOnlySlugs: readonly string[] = []
): AssetLinksStatement[] {
  const statement: AssetLinksStatement = {
    relation: [HANDLE_ALL_URLS],
    target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
  };
  const excluded = excludablePaths(webOnlySlugs);
  if (excluded.length > 0) {
    statement.relation_extensions = {
      [HANDLE_ALL_URLS]: {
        dynamic_app_link_components: [...excluded.map((p) => ({ '/': p, exclude: true })), { '/': '*' }],
      },
    };
  }
  return [statement];
}
