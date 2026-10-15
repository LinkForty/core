/**
 * Every click is announced on the click event emitter with the link's
 * organization, the query parameters it carried and whether it was a bot, so a
 * deployment can forward it (to analytics tools, for example) per organization.
 * Follows redirect.web-link.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { redirectRoutes } from './redirect.js';
import { subscribeToClickEvents, type ClickEventData } from '../lib/event-emitter.js';

const query = vi.fn();
vi.mock('../lib/database.js', () => ({
  db: {
    query: (...args: unknown[]) => query(...args),
  },
}));

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const ROW = {
  id: '00000000-0000-0000-0000-0000000000aa',
  organization_id: '00000000-0000-0000-0000-0000000000cc',
  user_id: null,
  short_code: 'abc123',
  original_url: 'https://example.com/landing',
  web_fallback_url: 'https://example.com/landing',
  ios_app_store_url: null,
  android_app_store_url: null,
  ios_universal_link: null,
  android_app_link: null,
  app_scheme: null,
  deep_link_path: null,
  launchpad_mode: 'inherit',
  is_active: true,
  warn_at: null,
  owner_suspended_at: null,
  expires_at: null,
  targeting_rules: null,
  template_settings: null,
  org_settings: null,
  utm_parameters: null,
  deep_link_parameters: null,
  append_click_id: false,
};

let app: FastifyInstance;
let events: ClickEventData[];
let unsubscribe: () => void;

beforeEach(async () => {
  query.mockReset();
  query.mockImplementation(async (sql: string) => {
    if (/information_schema\.columns/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (/FROM links l/i.test(sql) && !/INNER JOIN webhooks/i.test(sql)) return { rows: [ROW], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  events = [];
  unsubscribe = subscribeToClickEvents((event) => events.push(event));
  app = Fastify();
  await app.register(redirectRoutes);
  await app.ready();
});

afterEach(async () => {
  unsubscribe();
  await new Promise((r) => setImmediate(r));
  await app.close();
});

describe('click events', () => {
  it("carry the link's organization and the click's query parameters", async () => {
    await app.inject({ method: 'GET', url: '/abc123?fbclid=IwAR123&utm_source=ig', headers: { 'user-agent': DESKTOP_UA } });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      linkId: ROW.id,
      organizationId: ROW.organization_id,
      linkParams: { fbclid: 'IwAR123' },
      isBot: false,
    });
  });

  it('mark bot clicks so a receiver can leave them out', async () => {
    await app.inject({ method: 'GET', url: '/abc123', headers: { 'user-agent': BOT_UA } });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ isBot: true, organizationId: ROW.organization_id });
    expect(events[0].linkParams).toBeUndefined();
  });
});
