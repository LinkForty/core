import { describe, it, expect, vi } from 'vitest';
import {
  NOT_FOUND_DEFAULTS,
  NOT_FOUND_SETTINGS_TTL_MS,
  createOrganizationNotFoundSettingsLookup,
  readNotFoundSettings,
  readOrganizationNotFoundSettings,
  resolveNotFoundSettings,
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
      buttonLabel: 'Go home',
      buttonUrl: 'https://example.com/',
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
      buttonLabel: 'Click',
      buttonUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<img');
  });

  it('needs both a label and a URL for the button', () => {
    expect(renderNotFoundPage({ buttonUrl: 'https://example.com/' })).not.toContain('<a ');
    expect(renderNotFoundPage({ buttonLabel: 'Go' })).not.toContain('<a ');
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

describe('readNotFoundSettings', () => {
  it('keeps known, non-empty string fields', () => {
    expect(readNotFoundSettings({ title: ' Hi ', message: '', logoUrl: 42, extra: 'x', redirectUrl: 'https://a.example' }))
      .toEqual({ title: 'Hi', redirectUrl: 'https://a.example' });
  });
  it('is null when nothing is set', () => {
    expect(readNotFoundSettings({})).toBeNull();
    expect(readNotFoundSettings(null)).toBeNull();
    expect(readNotFoundSettings(['title'])).toBeNull();
  });
  it('reads an organization settings column', () => {
    expect(readOrganizationNotFoundSettings({ notFound: { title: 'Org' }, launchpad: {} })).toEqual({ title: 'Org' });
    expect(readOrganizationNotFoundSettings({ launchpad: {} })).toBeNull();
  });
});

describe('resolveNotFoundSettings', () => {
  it('redirects when the settings name a valid URL', () => {
    expect(resolveNotFoundSettings({ redirectUrl: 'https://example.com/', title: 'x' }))
      .toEqual({ kind: 'redirect', url: 'https://example.com/' });
  });
  it('renders the page when the redirect is not http(s)', () => {
    expect(resolveNotFoundSettings({ redirectUrl: 'javascript:alert(1)', title: 'x' }))
      .toEqual({ kind: 'page', content: { title: 'x' } });
  });
});

describe('createOrganizationNotFoundSettingsLookup', () => {
  it('holds an answer for the TTL, then reads again', async () => {
    let clock = 0;
    const query = vi.fn(async () => ({ rows: [{ settings: { notFound: { title: 'Org' } } }] }));
    const lookup = createOrganizationNotFoundSettingsLookup({ query, now: () => clock });
    expect(await lookup('org-a')).toEqual({ title: 'Org' });
    await lookup('org-a');
    expect(query).toHaveBeenCalledTimes(1);
    clock += NOT_FOUND_SETTINGS_TTL_MS + 1;
    await lookup('org-a');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('holds a "no settings" answer too', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const lookup = createOrganizationNotFoundSettingsLookup({ query });
    expect(await lookup('org-a')).toBeNull();
    await lookup('org-a');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not hold a failed read', async () => {
    const onError = vi.fn();
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ rows: [{ settings: { notFound: { title: 'Org' } } }] });
    const lookup = createOrganizationNotFoundSettingsLookup({ query, onError });
    expect(await lookup('org-a')).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    expect(await lookup('org-a')).toEqual({ title: 'Org' });
  });
});
