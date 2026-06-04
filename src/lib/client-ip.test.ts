import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getClientIp } from './client-ip';

declare global {
  var __capturedInstallFingerprint: { ipAddress: string } | null;
}

describe('getClientIp', () => {
  it('returns request.ip when set', () => {
    const request = { ip: '192.168.1.1' } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('192.168.1.1');
  });

  it('returns raw.socket.remoteAddress when request.ip is undefined', () => {
    const request = {
      ip: undefined,
      raw: { socket: { remoteAddress: '10.0.0.2' } },
    } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('10.0.0.2');
  });

  it('unwraps IPv6-mapped IPv4', () => {
    const request = { ip: '::ffff:192.168.1.1' } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('192.168.1.1');
  });

  it('returns empty string when neither ip nor socket.remoteAddress is available', () => {
    const request = { ip: undefined, raw: { socket: {} } } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('');
  });

  it('returns empty string when request.raw has no socket', () => {
    const request = { ip: undefined, raw: {} } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('');
  });
});

describe('getClientIp with TRUSTED_CLIENT_IP_HEADER', () => {
  const ORIGINAL = process.env.TRUSTED_CLIENT_IP_HEADER;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = ORIGINAL;
  });

  it('prefers the configured header over request.ip', () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip';
    const request = {
      ip: '162.158.23.75', // a Cloudflare edge IP
      headers: { 'cf-connecting-ip': '203.0.113.50' },
    } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('203.0.113.50');
  });

  it('falls back to request.ip when the configured header is absent', () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'cf-connecting-ip';
    const request = { ip: '203.0.113.50', headers: {} } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('203.0.113.50');
  });

  it('takes the first entry of a comma-separated header value', () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'true-client-ip';
    const request = {
      ip: '10.0.0.1',
      headers: { 'true-client-ip': '203.0.113.50, 70.0.0.1' },
    } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('203.0.113.50');
  });

  it('ignores the header when the env var is unset (default behavior)', () => {
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    const request = {
      ip: '203.0.113.50',
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    } as unknown as FastifyRequest;
    expect(getClientIp(request)).toBe('203.0.113.50');
  });
});

describe('getClientIp with Fastify trustProxy (proxied request)', () => {
  it('uses X-Forwarded-For when trustProxy is true', async () => {
    const Fastify = (await import('fastify')).default;
    const { getClientIp: getIp } = await import('./client-ip.js');
    const app = Fastify({ trustProxy: true });
    app.get('/ip', async (request, reply) => {
      return reply.send({ ip: getIp(request) });
    });
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '203.0.113.50' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ip: string };
    expect(body.ip).toBe('203.0.113.50');
  });
});

vi.mock('./fingerprint.js', async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    recordInstallEvent: vi.fn().mockImplementation(async (data: { ipAddress: string }) => {
      globalThis.__capturedInstallFingerprint = data;
      return { installId: 'test-id', match: null, deepLinkData: null };
    }),
  };
});

describe('SDK install does not trust client-provided ipAddress', () => {
  it('uses connection/proxy IP for attribution, not body ipAddress', async () => {
    globalThis.__capturedInstallFingerprint = null;
    const Fastify = (await import('fastify')).default;
    const { sdkRoutes } = await import('../routes/sdk.js');
    const app = Fastify({ trustProxy: true });
    await app.register(sdkRoutes);
    const res = await app.inject({
      method: 'POST',
      url: '/api/sdk/v1/install',
      payload: { ipAddress: '1.2.3.4', userAgent: 'Mozilla/5.0 Test' },
      headers: { 'x-forwarded-for': '203.0.113.50', 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    expect(globalThis.__capturedInstallFingerprint).not.toBeNull();
    expect(globalThis.__capturedInstallFingerprint!.ipAddress).toBe('203.0.113.50');
    const body = res.json() as { clientReportedIp?: string };
    expect(body.clientReportedIp).toBe('1.2.3.4');
  });
});
