import type { FastifyRequest } from 'fastify';

/**
 * Returns the trusted client IP for the request.
 * Use this everywhere client IP is needed (targeting, attribution, fingerprinting).
 * When the server is behind a reverse proxy, set Fastify's trustProxy option
 * so that request.ip is populated from X-Forwarded-For; this helper then
 * returns that trusted value.
 */
export function getClientIp(request: FastifyRequest): string {
  const ip = request.ip ?? request.raw.socket?.remoteAddress;
  if (ip && typeof ip === 'string') {
    // IPv6-mapped IPv4: ::ffff:192.168.1.1 -> 192.168.1.1
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    return ip;
  }
  return '';
}
