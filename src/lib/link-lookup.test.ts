import { describe, it, expect, afterEach } from 'vitest';
import {
  setLinkScopeResolver,
  resolveLinkScope,
  bareCodeOrderBy,
  bareCodeScopeFilter,
  linkCacheKey,
  isCacheableResolution,
} from './link-lookup.js';

const request = { headers: { host: 'links.example.com' } } as any;

afterEach(() => setLinkScopeResolver(undefined));

describe('resolveLinkScope', () => {
  it('is null without a resolver', async () => {
    expect(await resolveLinkScope(request)).toBeNull();
  });

  it("returns the resolver's organization", async () => {
    setLinkScopeResolver((req) => (req.headers.host === 'links.example.com' ? 'org-1' : null));
    expect(await resolveLinkScope(request)).toBe('org-1');
  });

  it('treats a throwing resolver as no scope and reports the error', async () => {
    const errors: unknown[] = [];
    setLinkScopeResolver(async () => {
      throw new Error('lookup failed');
    });
    expect(await resolveLinkScope(request, (e) => errors.push(e))).toBeNull();
    expect(errors).toHaveLength(1);
  });
});

describe('bareCodeOrderBy', () => {
  it('prefers a link without a template, then the oldest', () => {
    expect(bareCodeOrderBy()).toBe('ORDER BY (l.template_id IS NULL) DESC, l.created_at ASC, l.id ASC');
  });

  it("puts the request's organization first when there is one", () => {
    expect(bareCodeOrderBy('$2')).toBe(
      'ORDER BY COALESCE(l.organization_id = $2::uuid, false) DESC, (l.template_id IS NULL) DESC, l.created_at ASC, l.id ASC'
    );
  });
});

describe('bareCodeScopeFilter', () => {
  it("limits the lookup to the request's organization", () => {
    expect(bareCodeScopeFilter('$2')).toBe('AND l.organization_id = $2::uuid');
  });

  it('adds nothing without an organization', () => {
    expect(bareCodeScopeFilter()).toBe('');
  });
});

describe('linkCacheKey', () => {
  it('keys a template URL by slug and code', () => {
    expect(linkCacheKey('promo', 'abc123')).toBe('link:abc123:promo');
    expect(linkCacheKey('promo', 'abc123', 'org-1')).toBe('link:abc123:promo');
  });

  it('keys a bare code by organization when resolved for one', () => {
    expect(linkCacheKey('promo', null, 'org-1')).toBe('link:@org-1:promo');
  });

  it('keys an unscoped bare code by the code alone', () => {
    expect(linkCacheKey('promo')).toBe('link:promo');
  });
});

describe('isCacheableResolution', () => {
  it("caches a scoped bare code only when the link is the organization's own", () => {
    expect(isCacheableResolution({ organization_id: 'org-1' }, null, 'org-1')).toBe(true);
    expect(isCacheableResolution({ organization_id: 'org-2' }, null, 'org-1')).toBe(false);
    expect(isCacheableResolution({ organization_id: null }, null, 'org-1')).toBe(false);
  });

  it('always caches template URLs and unscoped codes', () => {
    expect(isCacheableResolution({ organization_id: 'org-2' }, 'abc123', 'org-1')).toBe(true);
    expect(isCacheableResolution({ organization_id: 'org-2' }, null, null)).toBe(true);
  });
});
