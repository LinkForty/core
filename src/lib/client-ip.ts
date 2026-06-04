import type { FastifyRequest } from 'fastify';

function normalizeIp(ip: string): string {
  // IPv6-mapped IPv4: ::ffff:192.168.1.1 -> 192.168.1.1
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Returns the trusted client IP for the request.
 * Use this everywhere client IP is needed (targeting, attribution, fingerprinting).
 *
 * Behind a CDN/proxy that terminates the connection (e.g. Cloudflare), the
 * left-most `X-Forwarded-For` entry that Fastify exposes as `request.ip` is not
 * reliably the real client — it can be a CDN edge or NAT hop. When the proxy
 * sends an authoritative client-IP header (Cloudflare's `CF-Connecting-IP`, or
 * `True-Client-IP`), prefer it.
 *
 * Set `TRUSTED_CLIENT_IP_HEADER` to that header name to opt in (e.g.
 * `cf-connecting-ip`). IMPORTANT: only enable this when the origin is reachable
 * ONLY through that proxy — otherwise a direct client could spoof the header.
 * When unset, behavior is unchanged (uses `request.ip`).
 */
export function getClientIp(request: FastifyRequest): string {
  const headerName = process.env.TRUSTED_CLIENT_IP_HEADER?.toLowerCase().trim();
  if (headerName) {
    const raw = request.headers[headerName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && typeof value === 'string') {
      // Some proxies send a comma-separated list — take the first entry.
      const first = value.split(',')[0]?.trim();
      if (first) return normalizeIp(first);
    }
  }

  const ip = request.ip ?? request.raw.socket?.remoteAddress;
  if (ip && typeof ip === 'string') {
    return normalizeIp(ip);
  }
  return '';
}
