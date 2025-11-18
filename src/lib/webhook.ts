import crypto from 'crypto';
import type { Webhook, WebhookPayload, WebhookDeliveryResult, WebhookEvent } from '../types/index.js';

/**
 * Generate HMAC SHA-256 signature for webhook payload
 */
export function generateWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Generate a secure random secret for webhook signing
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt a single webhook delivery
 */
async function attemptWebhookDelivery(
  webhook: Webhook,
  payload: WebhookPayload,
  attemptNumber: number
): Promise<WebhookDeliveryResult> {
  const payloadString = JSON.stringify(payload);
  const signature = generateWebhookSignature(payloadString, webhook.secret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-LinkForty-Signature': `sha256=${signature}`,
    'X-LinkForty-Event': payload.event,
    'X-LinkForty-Event-ID': payload.event_id,
    'User-Agent': 'LinkForty-Webhook/1.0',
    ...webhook.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), webhook.timeout_ms);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseBody = await response.text().catch(() => '');

    const result: WebhookDeliveryResult = {
      success: response.ok,
      webhookId: webhook.id,
      eventType: payload.event,
      eventId: payload.event_id,
      responseStatus: response.status,
      responseBody: responseBody.substring(0, 1000), // Limit response body size
      attemptNumber,
      deliveredAt: response.ok ? new Date().toISOString() : undefined,
    };

    if (!response.ok) {
      result.errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    }

    return result;
  } catch (error: any) {
    clearTimeout(timeoutId);

    return {
      success: false,
      webhookId: webhook.id,
      eventType: payload.event,
      eventId: payload.event_id,
      errorMessage: error.name === 'AbortError'
        ? `Timeout after ${webhook.timeout_ms}ms`
        : error.message || 'Unknown error',
      attemptNumber,
    };
  }
}

/**
 * Deliver webhook with retry logic and exponential backoff
 */
export async function deliverWebhook(
  webhook: Webhook,
  payload: WebhookPayload,
  logDelivery?: (result: WebhookDeliveryResult) => Promise<void>
): Promise<WebhookDeliveryResult> {
  const maxRetries = webhook.retry_count || 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await attemptWebhookDelivery(webhook, payload, attempt);

    // Log delivery attempt if logging function provided
    if (logDelivery) {
      await logDelivery(result).catch(err => {
        console.error('Failed to log webhook delivery:', err);
      });
    }

    // If successful, return immediately
    if (result.success) {
      return result;
    }

    // If not the last attempt, wait before retrying with exponential backoff
    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped at 30s)
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      await sleep(delayMs);
    }
  }

  // Return the last failed result
  return {
    success: false,
    webhookId: webhook.id,
    eventType: payload.event,
    eventId: payload.event_id,
    errorMessage: `Failed after ${maxRetries} attempts`,
    attemptNumber: maxRetries,
  };
}

/**
 * Trigger webhooks for a specific event (fire and forget)
 */
export async function triggerWebhooks(
  webhooks: Webhook[],
  event: WebhookEvent,
  eventId: string,
  data: any,
  logDelivery?: (webhookId: string, result: WebhookDeliveryResult) => Promise<void>
): Promise<void> {
  // Create webhook payload
  const payload: WebhookPayload = {
    event,
    event_id: eventId,
    timestamp: new Date().toISOString(),
    data,
  };

  // Filter webhooks that should receive this event
  const relevantWebhooks = webhooks.filter(
    webhook => webhook.is_active && webhook.events.includes(event)
  );

  if (relevantWebhooks.length === 0) {
    return; // No webhooks to trigger
  }

  // Fire and forget - don't await these deliveries
  const deliveryPromises = relevantWebhooks.map(async (webhook) => {
    try {
      const result = await deliverWebhook(
        webhook,
        payload,
        logDelivery ? (result) => logDelivery(webhook.id, result) : undefined
      );

      if (!result.success) {
        console.error(`Webhook ${webhook.id} delivery failed:`, result.errorMessage);
      }
    } catch (error) {
      console.error(`Webhook ${webhook.id} delivery error:`, error);
    }
  });

  // Fire and forget - log errors but don't block
  Promise.all(deliveryPromises).catch(err => {
    console.error('Webhook delivery batch error:', err);
  });
}
