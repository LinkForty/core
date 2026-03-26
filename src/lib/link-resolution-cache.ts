/**
 * Invalidate the Redis cache entries used by the redirect and SDK resolve
 * read paths for a given link. Safe to call when Redis is not configured.
 *
 * Cache key patterns (set in redirect.ts / sdk.ts):
 *   link:${shortCode}
 *   link:${templateSlug}:${shortCode}
 */
export async function invalidateLinkResolutionCache(
  redis: { del(...keys: string[]): Promise<number> } | null | undefined,
  shortCode: string,
  templateSlug?: string | null,
): Promise<void> {
  if (!redis) return;
  try {
    const keys = [`link:${shortCode}`];
    if (templateSlug) keys.push(`link:${templateSlug}:${shortCode}`);
    await redis.del(...keys);
  } catch {
    // Swallow — a cache miss on the next read is self-healing.
  }
}
