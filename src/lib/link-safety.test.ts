import { describe, it, expect } from 'vitest';
import { evaluateLinkSafety, generateWarningLinkHTML, escapeHtml, safeHref } from './link-safety.js';

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

  it('carries no JavaScript of its own, so it survives a strict CSP', () => {
    const html = generateWarningLinkHTML('https://example.com');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  // The CSP case above used a benign destination, so it could never have failed for
  // the reason it appeared to cover. These pass the hostile input instead.
  describe('hostile destinations', () => {
    it('never emits a javascript: href', () => {
      const html = generateWarningLinkHTML('javascript:alert(document.domain)');
      expect(html).not.toMatch(/href="javascript:/i);
    });

    it('never emits a data: href', () => {
      const html = generateWarningLinkHTML('data:text/html,<script>alert(1)</script>');
      expect(html).not.toMatch(/href="data:/i);
    });

    it('offers no continue button when the scheme is not http(s)', () => {
      const html = generateWarningLinkHTML('javascript:alert(1)');
      expect(html).not.toContain('class="go"');
      expect(html).toContain('nothing to continue to');
    });

    it('still shows the destination as inert text so the visitor can see it', () => {
      const html = generateWarningLinkHTML('javascript:alert(1)');
      expect(html).toContain('javascript:alert(1)');
    });

    it('emits no empty href for a bare path or an absent destination', () => {
      for (const d of ['/deep/link/path', '']) {
        const html = generateWarningLinkHTML(d);
        expect(html).not.toContain('href=""');
        expect(html).not.toContain('class="go"');
      }
    });

    it('still links a legitimate http(s) destination', () => {
      const html = generateWarningLinkHTML('https://example.com/x');
      expect(html).toContain('class="go"');
      expect(html).toContain('href="https://example.com/x"');
    });
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


describe('safeHref', () => {
  it('allows http and https', () => {
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
  });

  it('rejects every other scheme', () => {
    for (const d of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x']) {
      expect(safeHref(d), d).toBeNull();
    }
  });

  it('rejects a relative path, which would point at the redirect host', () => {
    expect(safeHref('/deep/link/path')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});
