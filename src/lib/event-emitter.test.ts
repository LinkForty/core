import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clickEventEmitter,
  emitClickEvent,
  subscribeToClickEvents,
  ClickEventData,
} from './event-emitter';

const mockClickEvent: ClickEventData = {
  eventId: 'evt-123',
  timestamp: '2026-03-10T00:00:00.000Z',
  linkId: 'link-abc',
  shortCode: 'abc123',
  userId: 'user-1',
  organizationId: 'org-1',
  ipAddress: '1.2.3.4',
  userAgent: 'Mozilla/5.0',
  country: 'US',
  city: 'New York',
  deviceType: 'web',
  platform: 'Windows',
  browser: 'Chrome',
  redirectUrl: 'https://example.com',
  redirectReason: 'web_fallback',
  targetingMatched: true,
  utmParameters: {
    source: 'newsletter',
    medium: 'email',
    campaign: 'spring',
  },
  referer: 'https://google.com',
  language: 'en-US',
};

describe('clickEventEmitter', () => {
  it('should be an EventEmitter instance', () => {
    expect(clickEventEmitter).toBeDefined();
    expect(typeof clickEventEmitter.on).toBe('function');
    expect(typeof clickEventEmitter.emit).toBe('function');
    expect(typeof clickEventEmitter.off).toBe('function');
  });
});

describe('emitClickEvent', () => {
  beforeEach(() => {
    clickEventEmitter.removeAllListeners('click');
  });

  it('should emit a click event with the provided data', () => {
    const handler = vi.fn();
    clickEventEmitter.on('click', handler);

    emitClickEvent(mockClickEvent);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(mockClickEvent);
  });

  it('should emit to all registered listeners', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    clickEventEmitter.on('click', handler1);
    clickEventEmitter.on('click', handler2);

    emitClickEvent(mockClickEvent);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should emit multiple times when called multiple times', () => {
    const handler = vi.fn();
    clickEventEmitter.on('click', handler);

    emitClickEvent(mockClickEvent);
    emitClickEvent({ ...mockClickEvent, eventId: 'evt-456' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should pass the exact event data to the handler', () => {
    const handler = vi.fn();
    clickEventEmitter.on('click', handler);

    const eventData: ClickEventData = {
      ...mockClickEvent,
      deviceType: 'ios',
      country: 'CA',
      targetingMatched: false,
    };

    emitClickEvent(eventData);

    expect(handler).toHaveBeenCalledWith(eventData);
  });

  it('should work with minimal required fields', () => {
    const handler = vi.fn();
    clickEventEmitter.on('click', handler);

    const minimalEvent: ClickEventData = {
      eventId: 'evt-min',
      timestamp: '2026-03-10T00:00:00.000Z',
      linkId: 'link-min',
      shortCode: 'min',
      ipAddress: '0.0.0.0',
      userAgent: '',
      deviceType: 'web',
      redirectUrl: 'https://example.com',
      redirectReason: 'default',
      targetingMatched: true,
    };

    emitClickEvent(minimalEvent);

    expect(handler).toHaveBeenCalledWith(minimalEvent);
  });
});

describe('subscribeToClickEvents', () => {
  beforeEach(() => {
    clickEventEmitter.removeAllListeners('click');
  });

  it('should call the callback when a click event is emitted', () => {
    const callback = vi.fn();
    subscribeToClickEvents(callback);

    emitClickEvent(mockClickEvent);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(mockClickEvent);
  });

  it('should return an unsubscribe function', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToClickEvents(callback);

    expect(typeof unsubscribe).toBe('function');
  });

  it('should stop receiving events after unsubscribing', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToClickEvents(callback);

    emitClickEvent(mockClickEvent);
    expect(callback).toHaveBeenCalledOnce();

    unsubscribe();
    emitClickEvent(mockClickEvent);

    expect(callback).toHaveBeenCalledOnce(); // still only once
  });

  it('should allow multiple subscribers independently', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const unsubscribe1 = subscribeToClickEvents(callback1);
    subscribeToClickEvents(callback2);

    emitClickEvent(mockClickEvent);
    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).toHaveBeenCalledOnce();

    unsubscribe1();
    emitClickEvent(mockClickEvent);

    expect(callback1).toHaveBeenCalledOnce(); // no new calls
    expect(callback2).toHaveBeenCalledTimes(2);
  });

  it('should not affect other subscribers when one unsubscribes', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const unsubscribe1 = subscribeToClickEvents(callback1);
    subscribeToClickEvents(callback2);

    unsubscribe1();
    emitClickEvent(mockClickEvent);

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledOnce();
  });

  it('should handle unsubscribe called multiple times without error', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToClickEvents(callback);

    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  it('should pass event data correctly to callback', () => {
    const received: ClickEventData[] = [];
    subscribeToClickEvents((data) => received.push(data));

    const event1 = { ...mockClickEvent, eventId: 'e1', deviceType: 'ios' as const };
    const event2 = { ...mockClickEvent, eventId: 'e2', deviceType: 'android' as const };

    emitClickEvent(event1);
    emitClickEvent(event2);

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(event1);
    expect(received[1]).toEqual(event2);
  });
});
