import { describe, it, expect } from 'vitest';
import { evaluateLinkSafety, generateWarningLinkHTML, escapeHtml } from './link-safety.js';

describe('evaluateLinkSafety', () => {
  it('allows a plain healthy link', () => {
    expect(evaluateLinkSafety({ isActive: true })).toBe('allow');
    expect(evaluateLinkSafety({})).toBe('allow');
  });

  it('treats an absent isActive as active, so existing rows are unaffected', () => {
    expect(evaluateLinkSafety({ isActive: undefined })).toBe('allow');
    expect(evaluateLinkSafety({ isActive: null })).toBe('allow');
  });

  it('blocks an inactive link', () => {
    expect(evaluateLinkSafety({ isActive: false })).toBe('block');
  });

  it('warns when warn_at is set', () => {
    expect(evaluateLinkSafety({ isActive: true, warnAt: new Date() })).toBe('warn');
    expect(evaluateLinkSafety({ isActive: true, warnAt: '2026-08-10T00:00:00Z' })).toBe('warn');
  });

  it('blocks when the owner is restricted, even if the link itself is fine', () => {
    expect(evaluateLinkSafety({ isActive: true, ownerSuspendedAt: new Date() })).toBe('block');
  });

  it('prefers block over warn — a restricted owner outranks a mere warning', () => {
    expect(
      evaluateLinkSafety({ isActive: true, warnAt: new Date(), ownerSuspendedAt: new Date() })
    ).toBe('block');
  });

  it('ignores owner restriction when it is not modelled at all', () => {
    // Deployments without an owner table never pass the field.
    expect(evaluateLinkSafety({ isActive: true, ownerSuspendedAt: null })).toBe('allow');
    expect(evaluateLinkSafety({ isActive: true, ownerSuspendedAt: undefined })).toBe('allow');
  });
});

describe('escapeHtml', () => {
  it('neutralises markup and quote characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("it's & more")).toBe('it&#39;s &amp; more');
  });
});

describe('generateWarningLinkHTML', () => {
  it('shows the destination so the visitor can judge it', () => {
    const html = generateWarningLinkHTML('https://example.com/login');
    expect(html).toContain('https://example.com/login');
    expect(html).toContain('Check this link before continuing');
  });

  it('escapes a hostile destination rather than injecting it', () => {
    const html = generateWarningLinkHTML('https://evil.test/"><script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('asks search engines not to index it', () => {
    expect(generateWarningLinkHTML('https://example.com')).toContain('noindex');
  });

  it('carries no JavaScript, so it survives a strict CSP', () => {
    const html = generateWarningLinkHTML('https://example.com');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('marks the outbound link nofollow/noopener so we pass no reputation to it', () => {
    const html = generateWarningLinkHTML('https://example.com');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
  });

  it('includes a report link only when one is configured', () => {
    expect(generateWarningLinkHTML('https://example.com')).not.toContain('Report this link');
    const withReport = generateWarningLinkHTML('https://example.com', {
      reportUrl: 'https://example.org/abuse',
    });
    expect(withReport).toContain('Report this link');
    expect(withReport).toContain('https://example.org/abuse');
  });
});
