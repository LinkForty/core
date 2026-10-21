/**
 * What a LinkForty bundle carries, column by column.
 *
 * Every column of every table Core creates is classified here, and the schema
 * test (registry.schema.test.ts) fails when a column exists that isn't, or a
 * classified column no longer exists. So adding a column means deciding,
 * in the same change, whether a bundle carries it.
 *
 * - `portable`: exported under `field` and restored on import.
 * - `remap`: an owner reference (organization or user). Exported as is, and
 *   replaceable on import, so a bundle can be imported into a different
 *   organization or for a different user.
 * - `excluded`: never exported; `reason` says why.
 *
 * JSONB columns whose keys belong to different features list the keys a bundle
 * carries in `keys`; any other key is left out, so a key added later is not
 * exported until it is listed here.
 */

export type ColumnRule =
  | { class: 'portable'; field: string; keys?: readonly string[] }
  | { class: 'remap'; field: string; owner: 'organization' | 'user' }
  | { class: 'excluded'; reason: string };

export interface TableRule {
  /** Record type in the bundle. */
  record: string;
  /** Primary key column; rows are read in its order. */
  key: string;
  columns: Readonly<Record<string, ColumnRule>>;
}

const p = (field: string, keys?: readonly string[]): ColumnRule =>
  keys ? { class: 'portable', field, keys } : { class: 'portable', field };
const org = (field: string): ColumnRule => ({ class: 'remap', field, owner: 'organization' });
const user = (field: string): ColumnRule => ({ class: 'remap', field, owner: 'user' });
const excluded = (reason: string): ColumnRule => ({ class: 'excluded', reason });

const ENFORCEMENT = 'Abuse enforcement state belongs to the server that applied it';

/**
 * Tables in the order rows are written and restored: every table after the
 * ones it references.
 */
export const BUNDLE_TABLES: Readonly<Record<string, TableRule>> = {
  organizations: {
    record: 'organization',
    key: 'id',
    columns: {
      id: p('id'),
      name: p('name'),
      settings: p('settings', ['appConfig', 'launchpad']),
      suspended_at: excluded(ENFORCEMENT),
      created_at: p('createdAt'),
      updated_at: p('updatedAt'),
    },
  },
  link_templates: {
    record: 'template',
    key: 'id',
    columns: {
      id: p('id'),
      user_id: user('userId'),
      name: p('name'),
      slug: p('slug'),
      description: p('description'),
      settings: p('settings'),
      is_default: p('isDefault'),
      created_at: p('createdAt'),
      updated_at: p('updatedAt'),
    },
  },
  links: {
    record: 'link',
    key: 'id',
    columns: {
      id: p('id'),
      user_id: user('userId'),
      organization_id: org('organizationId'),
      template_id: p('templateId'),
      short_code: p('shortCode'),
      original_url: p('originalUrl'),
      title: p('title'),
      description: p('description'),
      ios_app_store_url: p('iosAppStoreUrl'),
      android_app_store_url: p('androidAppStoreUrl'),
      web_fallback_url: p('webFallbackUrl'),
      app_scheme: p('appScheme'),
      ios_universal_link: p('iosUniversalLink'),
      android_app_link: p('androidAppLink'),
      deep_link_path: p('deepLinkPath'),
      deep_link_parameters: p('deepLinkParameters'),
      utm_parameters: p('utmParameters'),
      targeting_rules: p('targetingRules'),
      attribution_window_hours: p('attributionWindowHours'),
      attribution_window_minutes: p('attributionWindowMinutes'),
      one_install_per_click: p('oneInstallPerClick'),
      append_click_id: p('appendClickId'),
      og_title: p('ogTitle'),
      og_description: p('ogDescription'),
      og_image_url: p('ogImageUrl'),
      og_type: p('ogType'),
      launchpad_mode: p('launchpadMode'),
      is_active: p('isActive'),
      expires_at: p('expiresAt'),
      warn_at: excluded(ENFORCEMENT),
      disabled_at: excluded(ENFORCEMENT),
      disabled_reason: excluded(ENFORCEMENT),
      created_at: p('createdAt'),
      updated_at: p('updatedAt'),
    },
  },
  click_events: {
    record: 'click',
    key: 'id',
    columns: {
      id: p('id'),
      link_id: p('linkId'),
      clicked_at: p('clickedAt'),
      ip_address: p('ipAddress'),
      user_agent: p('userAgent'),
      device_type: p('deviceType'),
      platform: p('platform'),
      country_code: p('countryCode'),
      country_name: p('countryName'),
      region: p('region'),
      city: p('city'),
      latitude: p('latitude'),
      longitude: p('longitude'),
      timezone: p('timezone'),
      utm_source: p('utmSource'),
      utm_medium: p('utmMedium'),
      utm_campaign: p('utmCampaign'),
      referrer: p('referrer'),
      link_params: p('linkParams'),
      is_bot: p('isBot'),
      bot_reason: p('botReason'),
      install_matched_at: p('installMatchedAt'),
    },
  },
  device_fingerprints: {
    record: 'fingerprint',
    key: 'id',
    columns: {
      id: p('id'),
      click_id: p('clickId'),
      fingerprint_hash: p('fingerprintHash'),
      ip_address: p('ipAddress'),
      user_agent: p('userAgent'),
      timezone: p('timezone'),
      language: p('language'),
      screen_width: p('screenWidth'),
      screen_height: p('screenHeight'),
      platform: p('platform'),
      platform_version: p('platformVersion'),
      created_at: p('createdAt'),
    },
  },
  install_events: {
    record: 'install',
    key: 'id',
    columns: {
      id: p('id'),
      link_id: p('linkId'),
      click_id: p('clickId'),
      fingerprint_hash: p('fingerprintHash'),
      confidence_score: p('confidenceScore'),
      attribution_method: p('attributionMethod'),
      matched_factors: p('matchedFactors'),
      installed_at: p('installedAt'),
      first_open_at: p('firstOpenAt'),
      deep_link_retrieved: p('deepLinkRetrieved'),
      deep_link_data: p('deepLinkData'),
      attribution_window_hours: p('attributionWindowHours'),
      ip_address: p('ipAddress'),
      user_agent: p('userAgent'),
      timezone: p('timezone'),
      language: p('language'),
      screen_width: p('screenWidth'),
      screen_height: p('screenHeight'),
      platform: p('platform'),
      platform_version: p('platformVersion'),
      device_id: p('deviceId'),
      sdk_name: p('sdkName'),
      sdk_version: p('sdkVersion'),
      created_at: p('createdAt'),
    },
  },
  in_app_events: {
    record: 'event',
    key: 'id',
    columns: {
      id: p('id'),
      install_id: p('installId'),
      event_name: p('eventName'),
      event_data: p('eventData'),
      event_timestamp: p('eventTimestamp'),
      attributed_link_id: p('attributedLinkId'),
      attributed_click_id: p('attributedClickId'),
      attributed_at: p('attributedAt'),
      session_id: p('sessionId'),
      sdk_name: p('sdkName'),
      sdk_version: p('sdkVersion'),
      client_event_id: p('clientEventId'),
      created_at: p('createdAt'),
    },
  },
  webhooks: {
    record: 'webhook',
    key: 'id',
    columns: {
      id: p('id'),
      user_id: user('userId'),
      organization_id: org('organizationId'),
      name: p('name'),
      url: p('url'),
      secret: excluded('A signing secret is a credential; import issues a new one'),
      events: p('events'),
      is_active: p('isActive'),
      retry_count: p('retryCount'),
      timeout_ms: p('timeoutMs'),
      headers: p('headers'),
      created_at: p('createdAt'),
      updated_at: p('updatedAt'),
    },
  },
};

/** Columns a bundle carries for a table, in registry order. */
export function exportedColumns(table: string): Array<[column: string, rule: Exclude<ColumnRule, { class: 'excluded' }>]> {
  return Object.entries(BUNDLE_TABLES[table].columns).filter(
    (entry): entry is [string, Exclude<ColumnRule, { class: 'excluded' }>] => entry[1].class !== 'excluded'
  );
}
