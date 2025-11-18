import { EventEmitter } from 'events';

/**
 * Global event emitter for real-time events
 * Used for broadcasting click events to WebSocket clients
 */
export const clickEventEmitter = new EventEmitter();

/**
 * Click event data structure for real-time streaming
 */
export interface ClickEventData {
  eventId: string;
  timestamp: string;
  linkId: string;
  shortCode: string;
  userId: string;
  organizationId?: string;

  // Request details
  ipAddress: string;
  userAgent: string;
  country?: string;
  city?: string;

  // Device detection
  deviceType: 'ios' | 'android' | 'web';
  platform?: string;
  browser?: string;

  // Redirect decision
  redirectUrl: string;
  redirectReason: string;
  targetingMatched: boolean;

  // UTM parameters
  utmParameters?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };

  // Additional metadata
  referer?: string;
  language?: string;
}

/**
 * Emit a click event for real-time streaming
 */
export function emitClickEvent(eventData: ClickEventData) {
  clickEventEmitter.emit('click', eventData);
}

/**
 * Subscribe to click events
 * Returns unsubscribe function
 */
export function subscribeToClickEvents(
  callback: (eventData: ClickEventData) => void
): () => void {
  clickEventEmitter.on('click', callback);

  // Return unsubscribe function
  return () => {
    clickEventEmitter.off('click', callback);
  };
}
