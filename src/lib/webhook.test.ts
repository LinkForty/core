import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateWebhookSignature,
  generateWebhookSecret,
  deliverWebhook,
  triggerWebhooks,
} from './webhook.js';
import type { Webhook, WebhookPayload } from '../types/index.js';

// Helper to build a Webhook fixture
function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh-1',
    user_id: 'user-1',
    name: 'Test Webhook',
    url: 'https://example.com/hook',
    secret: 'test-secret',
    events: ['click_event'],
    is_active: true,
    retry_count: 1,
    timeout_ms: 5000,
    headers: {},
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Helper to build a WebhookPayload fixture
function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: 'click_event',
    event_id: 'evt-1',
    timestamp: '2024-01-01T00:00:00.000Z',
    data: { id: 'data-1' } as any,
    ...overrides,
  };
}

// Helper to make a minimal Response-like mock
function mockResponse(
  ok: boolean,
  status: number,
  statusText: string,
  body = ''
): Response {
  return {
    ok,
    status,
    statusText,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('generateWebhookSignature', () => {
  it('returns a hex string', () => {
    const sig = generateWebhookSignature('payload', 'secret');
    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const sig1 = generateWebhookSignature('hello', 'key');
    const sig2 = generateWebhookSignature('hello', 'key');
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different payloads', () => {
    const sig1 = generateWebhookSignature('payload-a', 'secret');
    const sig2 = generateWebhookSignature('payload-b', 'secret');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different secrets', () => {
    const sig1 = generateWebhookSignature('payload', 'secret-a');
    const sig2 = generateWebhookSignature('payload', 'secret-b');
    expect(sig1).not.toBe(sig2);
  });
});

describe('generateWebhookSecret', () => {
  it('returns a 64-character hex string (32 random bytes)', () => {
    const secret = generateWebhookSecret();
    expect(typeof secret).toBe('string');
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns unique values on each call', () => {
    const s1 = generateWebhookSecret();
    const s2 = generateWebhookSecret();
    expect(s1).not.toBe(s2);
  });
});

describe('deliverWebhook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns a success result on HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK', 'received')));

    const webhook = makeWebhook();
    const payload = makePayload();

    const result = await deliverWebhook(webhook, payload);

    expect(result.success).toBe(true);
    expect(result.webhookId).toBe(webhook.id);
    expect(result.eventType).toBe(payload.event);
    expect(result.eventId).toBe(payload.event_id);
    expect(result.responseStatus).toBe(200);
    expect(result.responseBody).toBe('received');
    expect(result.attemptNumber).toBe(1);
    expect(result.deliveredAt).toBeDefined();
    expect(result.errorMessage).toBeUndefined();
  });

  it('returns a failure result on HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(false, 500, 'Internal Server Error', 'error body')));

    // Use logDelivery to capture per-attempt details (the final return is a
    // generic "Failed after N attempts" object once retries are exhausted).
    const logDelivery = vi.fn().mockResolvedValue(undefined);
    const webhook = makeWebhook({ retry_count: 1 });
    const payload = makePayload();

    const result = await deliverWebhook(webhook, payload, logDelivery);

    // Per-attempt result captured via logDelivery
    const attemptResult = logDelivery.mock.calls[0][0];
    expect(attemptResult.responseStatus).toBe(500);
    expect(attemptResult.errorMessage).toBe('HTTP 500: Internal Server Error');
    expect(attemptResult.responseBody).toBe('error body');

    // Final returned result after retries exhausted
    expect(result.success).toBe(false);
    expect(result.deliveredAt).toBeUndefined();
  });

  it('sets correct request headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const webhook = makeWebhook({ headers: { 'X-Custom': 'value' } });
    const payload = makePayload();

    await deliverWebhook(webhook, payload);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(webhook.url);
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-LinkForty-Event']).toBe(payload.event);
    expect(headers['X-LinkForty-Event-ID']).toBe(payload.event_id);
    expect(headers['X-LinkForty-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['User-Agent']).toBe('LinkForty-Webhook/1.0');
    expect(headers['X-Custom']).toBe('value');
  });

  it('sends the correct JSON body', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const webhook = makeWebhook();
    const payload = makePayload();

    await deliverWebhook(webhook, payload);

    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('truncates response body to 1000 characters', async () => {
    const longBody = 'x'.repeat(2000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK', longBody)));

    const result = await deliverWebhook(makeWebhook(), makePayload());

    expect(result.responseBody).toHaveLength(1000);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(false, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const webhook = makeWebhook({ retry_count: 2 });
    const payload = makePayload();

    const promise = deliverWebhook(webhook, payload);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.attemptNumber).toBe(2);
  });

  it('exhausts all retries and returns final failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(false, 500, 'Error')));

    const webhook = makeWebhook({ retry_count: 3 });
    const payload = makePayload();

    const promise = deliverWebhook(webhook, payload);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Failed after 3 attempts');
    expect(result.attemptNumber).toBe(3);
  });

  it('calls logDelivery for each attempt', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(mockResponse(false, 500, 'Error'))
      .mockResolvedValueOnce(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const logDelivery = vi.fn().mockResolvedValue(undefined);
    const webhook = makeWebhook({ retry_count: 2 });
    const payload = makePayload();

    const promise = deliverWebhook(webhook, payload, logDelivery);
    await vi.runAllTimersAsync();
    await promise;

    expect(logDelivery).toHaveBeenCalledTimes(2);
    expect(logDelivery.mock.calls[0][0].success).toBe(false);
    expect(logDelivery.mock.calls[1][0].success).toBe(true);
  });

  it('continues even if logDelivery throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK')));
    const logDelivery = vi.fn().mockRejectedValue(new Error('log failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await deliverWebhook(makeWebhook(), makePayload(), logDelivery);

    expect(result.success).toBe(true);
    consoleSpy.mockRestore();
  });

  it('captures timeout error in logDelivery when fetch exceeds timeout_ms', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const logDelivery = vi.fn().mockResolvedValue(undefined);
    const webhook = makeWebhook({ timeout_ms: 1000, retry_count: 1 });
    const result = await deliverWebhook(webhook, makePayload(), logDelivery);

    // Per-attempt error is exposed via logDelivery
    const attemptResult = logDelivery.mock.calls[0][0];
    expect(attemptResult.success).toBe(false);
    expect(attemptResult.errorMessage).toBe('Timeout after 1000ms');

    // Final result reflects exhausted retries
    expect(result.success).toBe(false);
  });

  it('captures network error message in logDelivery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const logDelivery = vi.fn().mockResolvedValue(undefined);
    const webhook = makeWebhook({ retry_count: 1 });
    const result = await deliverWebhook(webhook, makePayload(), logDelivery);

    const attemptResult = logDelivery.mock.calls[0][0];
    expect(attemptResult.success).toBe(false);
    expect(attemptResult.errorMessage).toBe('ECONNREFUSED');

    expect(result.success).toBe(false);
  });
});

describe('triggerWebhooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does nothing when no webhooks provided', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await triggerWebhooks([], 'click_event', 'evt-1', {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips inactive webhooks', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const inactive = makeWebhook({ is_active: false });
    await triggerWebhooks([inactive], 'click_event', 'evt-1', {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips webhooks not subscribed to the event', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const webhook = makeWebhook({ events: ['install_event'] });
    await triggerWebhooks([webhook], 'click_event', 'evt-1', {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('delivers to matching active webhooks', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const webhook = makeWebhook({ events: ['click_event', 'install_event'] });
    triggerWebhooks([webhook], 'click_event', 'evt-1', { foo: 'bar' });

    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('click_event');
    expect(body.event_id).toBe('evt-1');
    expect(body.data).toEqual({ foo: 'bar' });
  });

  it('delivers to multiple matching webhooks', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const wh1 = makeWebhook({ id: 'wh-1', url: 'https://a.com/hook' });
    const wh2 = makeWebhook({ id: 'wh-2', url: 'https://b.com/hook' });
    triggerWebhooks([wh1, wh2], 'click_event', 'evt-2', {});

    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('calls logDelivery with webhookId and result', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    const logDelivery = vi.fn().mockResolvedValue(undefined);
    const webhook = makeWebhook({ id: 'wh-log' });

    triggerWebhooks([webhook], 'click_event', 'evt-3', {}, logDelivery);
    await vi.runAllTimersAsync();

    expect(logDelivery).toHaveBeenCalledWith('wh-log', expect.objectContaining({ success: true }));
  });

  it('includes the timestamp in the payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockResponse(true, 200, 'OK'));
    vi.stubGlobal('fetch', mockFetch);

    triggerWebhooks([makeWebhook()], 'click_event', 'evt-4', {});
    await vi.runAllTimersAsync();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
