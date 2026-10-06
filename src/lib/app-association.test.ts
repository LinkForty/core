import { describe, it, expect, vi } from 'vitest';
import {
  AASA_EXCLUSION_BUDGET_BYTES,
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  isWebOnlyTemplate,
} from './app-association.js';

const APP = 'TEAM123456.com.acme.app';

describe('isWebOnlyTemplate', () => {
  it('is true only for an explicit true: app links are the default', () => {
    expect(isWebOnlyTemplate({ webOnly: true })).toBe(true);
    for (const settings of [null, undefined, {}, { webOnly: false }, { webOnly: 'true' }, 'webOnly']) {
      expect(isWebOnlyTemplate(settings), JSON.stringify(settings)).toBe(false);
    }
  });
});

describe('buildAppleAppSiteAssociation', () => {
  it('is exactly the claim-everything file when no template is web-only', () => {
    expect(buildAppleAppSiteAssociation(APP)).toEqual({
      applinks: { apps: [], details: [{ appID: APP, paths: ['*'] }] },
    });
  });

  it('excludes each web-only template path ahead of the catch-all, for old and new iOS', () => {
    const detail = buildAppleAppSiteAssociation(APP, ['news2024', 'abc123']).applinks.details[0];
    expect(detail.paths).toEqual(['NOT /abc123/*', 'NOT /news2024/*', '*']);
    expect(detail.appIDs).toEqual([APP]);
    expect(detail.components).toEqual([
      { '/': '/abc123/*', exclude: true, comment: 'Web-only template' },
      { '/': '/news2024/*', exclude: true, comment: 'Web-only template' },
      { '/': '*' },
    ]);
  });

  it('never writes a slug that a matcher would read as a wildcard, and de-duplicates', () => {
    const detail = buildAppleAppSiteAssociation(APP, ['ok', 'ok', 'bad*', 'q?', 'a/b']).applinks.details[0];
    expect(detail.paths).toEqual(['NOT /ok/*', '*']);
  });

  it('falls back to claiming every path, and says so, rather than serve a file iOS would reject', () => {
    const onBudgetExceeded = vi.fn();
    const slugs = Array.from({ length: 3000 }, (_, i) => `t${String(i).padStart(7, '0')}`);
    const aasa = buildAppleAppSiteAssociation(APP, slugs, onBudgetExceeded);
    expect(aasa.applinks.details[0]).toEqual({ appID: APP, paths: ['*'] });
    expect(onBudgetExceeded).toHaveBeenCalledWith(3000, expect.any(Number));
    expect(onBudgetExceeded.mock.calls[0][1]).toBeGreaterThan(AASA_EXCLUSION_BUDGET_BYTES);
  });
});

describe('buildAssetLinks', () => {
  it('is the plain statement when no template is web-only', () => {
    expect(buildAssetLinks('com.acme.app', ['AA:BB'])).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.acme.app', sha256_cert_fingerprints: ['AA:BB'] },
      },
    ]);
  });

  it('adds Android 15+ dynamic exclusions ahead of the catch-all', () => {
    const [statement] = buildAssetLinks('com.acme.app', ['AA:BB'], ['news2024']);
    expect(statement.relation_extensions).toEqual({
      'delegate_permission/common.handle_all_urls': {
        dynamic_app_link_components: [{ '/': '/news2024/*', exclude: true }, { '/': '*' }],
      },
    });
  });
});
