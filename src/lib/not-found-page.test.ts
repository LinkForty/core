import { describe, it, expect } from 'vitest';
import {
  NOT_FOUND_DEFAULTS,
  notFoundContentSecurityPolicy,
  renderNotFoundPage,
  safeNotFoundRedirect,
  wantsHtml,
} from './not-found-page.js';

describe('wantsHtml', () => {
  it('is true for a browser navigation', () => {
    expect(wantsHtml('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(true);
  });
  it('is false for JSON clients, wildcards and a missing header', () => {
    expect(wantsHtml('application/json')).toBe(false);
    expect(wantsHtml('*/*')).toBe(false);
    expect(wantsHtml(undefined)).toBe(false);
  });
  it('reads a repeated header', () => {
    expect(wantsHtml(['application/json', 'text/html'])).toBe(true);
  });
});

describe('renderNotFoundPage', () => {
  it('renders the default copy with no content', () => {
    const html = renderNotFoundPage();
    expect(html).toContain(`<title>${NOT_FOUND_DEFAULTS.title}</title>`);
    expect(html).toContain('doesn&#39;t exist or is no longer available.');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<img');
  });

  it('runs no script', () => {
    expect(renderNotFoundPage({ title: 'x' })).not.toContain('<script');
    expect(notFoundContentSecurityPolicy()).not.toContain('script-src');
    expect(notFoundContentSecurityPolicy()).toContain("default-src 'none'");
  });

  it('renders host content', () => {
    const html = renderNotFoundPage({
      title: 'Nothing here',
      message: 'Try our homepage.',
      logoUrl: 'https://cdn.example.com/logo.png',
      accentColor: '#0d9488',
      backgroundColor: '#fafafa',
      ctaLabel: 'Go home',
      ctaUrl: 'https://example.com/',
    });
    expect(html).toContain('<h1>Nothing here</h1>');
    expect(html).toContain('<p>Try our homepage.</p>');
    expect(html).toContain('src="https://cdn.example.com/logo.png"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('>Go home</a>');
    expect(html).toContain('background:#0d9488');
    expect(html).toContain('background:#fafafa');
  });

  it('applies the brand background in light mode only', () => {
    const html = renderNotFoundPage({ backgroundColor: '#ecfdf5' });
    expect(html).toContain('@media (prefers-color-scheme: light) { body { background:#ecfdf5; } }');
    expect(html.match(/background:#ecfdf5/g)).toHaveLength(1);
  });

  it('escapes host copy', () => {
    const html = renderNotFoundPage({ title: '<script>alert(1)</script>', message: '"><img src=x>' });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('"><img src=x>');
  });

  it('drops non-http URLs', () => {
    const html = renderNotFoundPage({
      logoUrl: 'javascript:alert(1)',
      ctaLabel: 'Click',
      ctaUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<img');
  });

  it('needs both a label and a URL for the button', () => {
    expect(renderNotFoundPage({ ctaUrl: 'https://example.com/' })).not.toContain('<a ');
    expect(renderNotFoundPage({ ctaLabel: 'Go' })).not.toContain('<a ');
  });

  it('drops colors that are not hex', () => {
    const html = renderNotFoundPage({ accentColor: 'red;}body{display:none', backgroundColor: 'url(x)' });
    expect(html).not.toContain('display:none');
    expect(html).not.toContain('url(x)');
  });

  it('treats blank copy as absent', () => {
    expect(renderNotFoundPage({ title: '   ' })).toContain(`<h1>${NOT_FOUND_DEFAULTS.title}</h1>`);
  });

  it('caps long copy', () => {
    const html = renderNotFoundPage({ title: 'x'.repeat(1000) });
    expect(html).not.toContain('x'.repeat(121));
  });
});

describe('safeNotFoundRedirect', () => {
  it('accepts http(s)', () => {
    expect(safeNotFoundRedirect('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });
  it('rejects everything else', () => {
    expect(safeNotFoundRedirect('javascript:alert(1)')).toBeNull();
    expect(safeNotFoundRedirect('/relative')).toBeNull();
    expect(safeNotFoundRedirect(undefined)).toBeNull();
  });
});
