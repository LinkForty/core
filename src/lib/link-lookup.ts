import type { FastifyRequest } from 'fastify';

/**
 * How a short URL is matched to a link.
 *
 * Short codes are unique per organization (links without one share a single
 * namespace), and template slugs are unique everywhere. So:
 *
 * - `/{templateSlug}/{shortCode}` names exactly one link: the slug fixes the
 *   organization and the code is unique within it.
 * - `/{shortCode}` on a host that belongs to an organization (see
 *   setLinkScopeResolver) matches only that organization's link, so one
 *   organization's host never serves another organization's link.
 * - `/{shortCode}` on a shared host can match one link per organization. The
 *   lookup prefers a link without a template (whose only URL is the bare one),
 *   then the oldest link. While every code is used by one link, that is simply
 *   the link.
 */

/**
 * Returns the organization a request belongs to, typically from its host (a
 * custom domain, an organization's own subdomain), or null when the host is
 * shared or unknown.
 */
export type LinkScopeResolver = (request: FastifyRequest) => Promise<string | null> | string | null;

let scopeResolver: LinkScopeResolver | undefined;

/**
 * Set how the redirect, SDK resolve and preview routes decide which
 * organization a request belongs to. A bare code on a request that belongs to
 * an organization resolves only that organization's links. Pass undefined to
 * clear it.
 */
export function setLinkScopeResolver(resolver: LinkScopeResolver | undefined): void {
  scopeResolver = resolver;
}

/**
 * The organization a request belongs to, or null. A resolver that throws is
 * treated as null, so it can never take a redirect down.
 */
export async function resolveLinkScope(
  request: FastifyRequest,
  onError?: (error: unknown) => void
): Promise<string | null> {
  if (!scopeResolver) return null;
  try {
    return (await scopeResolver(request)) || null;
  } catch (error) {
    onError?.(error);
    return null;
  }
}

/**
 * WHERE clause fragment for a bare `/{shortCode}` lookup over `links l`:
 * restricts the lookup to the request's organization when there is one.
 * `scopeParam` is the placeholder holding it (e.g. `$2`).
 */
export function bareCodeScopeFilter(scopeParam?: string): string {
  return scopeParam ? `AND l.organization_id = ${scopeParam}::uuid` : '';
}

/**
 * ORDER BY for a bare `/{shortCode}` lookup over `links l`. `scopeParam` is the
 * placeholder holding the request's organization (e.g. `$2`), when there is one.
 * With bareCodeScopeFilter() applied every row is already in scope, so the
 * routes call this without one.
 */
export function bareCodeOrderBy(scopeParam?: string): string {
  const preferScope = scopeParam ? `COALESCE(l.organization_id = ${scopeParam}::uuid, false) DESC, ` : '';
  return `ORDER BY ${preferScope}(l.template_id IS NULL) DESC, l.created_at ASC, l.id ASC`;
}

/**
 * Redis key for a resolved link. A bare code resolved for an organization is
 * keyed by it, so one organization's link is never served from another's entry.
 */
export function linkCacheKey(shortCode: string, templateSlug?: string | null, scope?: string | null): string {
  if (templateSlug) return `link:${templateSlug}:${shortCode}`;
  if (scope) return `link:@${scope}:${shortCode}`;
  return `link:${shortCode}`;
}

/**
 * Whether a bare-code result may be cached under its key. A link found for an
 * organization is cached only when it belongs to that organization; another
 * organization's link reached as a fallback is looked up fresh each time, so
 * invalidating a link never has to find entries under other organizations' keys.
 */
export function isCacheableResolution(
  link: { organization_id?: string | null },
  templateSlug?: string | null,
  scope?: string | null
): boolean {
  if (templateSlug || !scope) return true;
  return link.organization_id === scope;
}
