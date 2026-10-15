import { linkCacheKey } from './link-lookup.js';

/**
 * Invalidate the Redis cache entries used by the redirect and SDK resolve
 * read paths for a given link. Safe to call when Redis is not configured.
 *
 * Cache keys come from linkCacheKey() (lib/link-lookup.ts): the bare code, the
 * code under its template slug, and the code under its organization.
 */
export async function invalidateLinkResolutionCache(
  redis: { del(...keys: string[]): Promise<number> } | null | undefined,
  shortCode: string,
  templateSlug?: string | null,
  organizationId?: string | null,
): Promise<void> {
  if (!redis) return;
  try {
    const keys = [linkCacheKey(shortCode)];
    if (templateSlug) keys.push(linkCacheKey(shortCode, templateSlug));
    if (organizationId) keys.push(linkCacheKey(shortCode, null, organizationId));
    await redis.del(...keys);
  } catch {
    // Swallow — a cache miss on the next read is self-healing.
  }
}
