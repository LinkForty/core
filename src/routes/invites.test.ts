import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock the database singleton so the route runs without a real Postgres.
vi.mock('../lib/database.js', () => ({
  db: { query: vi.fn() },
}));

// Mock the webhook trigger so it doesn't attempt real HTTP calls.
vi.mock('../lib/webhook.js', () => ({
  triggerWebhooks: vi.fn().mockResolvedValue(undefined),
}));

import Fastify, { type FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { triggerWebhooks } from '../lib/webhook.js';
import { inviteRoutes } from './invites.js';

const mockQuery = db.query as unknown as Mock;
const mockTriggerWebhooks = triggerWebhooks as unknown as Mock;

const INVITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITER_ID = 'user-surya';
const INVITEE_ID = 'user-bob';
const LINK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVITE_CREATED_AT = '2026-07-01T10:00:00.000Z';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(inviteRoutes);
  await app.ready();
  return app;
}

describe('POST /api/invites — create invite', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('creates a pending invite with inviterId and inviterName', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        inviter_name: 'Surya',
        link_id: null,
        status: 'pending',
        metadata: {},
        created_at: INVITE_CREATED_AT,
      }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/invites',
      payload: { inviterId: INVITER_ID, inviterName: 'Surya' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(INVITE_ID);
    expect(body.inviterId).toBe(INVITER_ID);
    expect(body.inviterName).toBe('Surya');
    expect(body.status).toBe('pending');

    // Verify INSERT was called with correct params
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toMatch(/INSERT INTO invites/);
    expect(insertCall[1]).toEqual([INVITER_ID, 'Surya', null, '{}']);

    await app.close();
  });

  it('creates an invite linked to a LinkForty link with metadata', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        inviter_name: 'Surya',
        link_id: LINK_ID,
        status: 'pending',
        metadata: { campaign: 'summer' },
        created_at: INVITE_CREATED_AT,
      }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/invites',
      payload: {
        inviterId: INVITER_ID,
        inviterName: 'Surya',
        linkId: LINK_ID,
        metadata: { campaign: 'summer' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().linkId).toBe(LINK_ID);

    await app.close();
  });

  it('rejects when inviterId is missing', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/invites',
      payload: { inviterName: 'Surya' },
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /api/invites/:id/consume — payment-gated consumption', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTriggerWebhooks.mockClear();
  });

  const validConsumePayload = {
    inviteeUserId: INVITEE_ID,
    inviteeEmail: 'bob@test.com',
    inviteeCreatedAt: '2026-08-01T10:00:00.000Z',
    paymentAmount: 99.99,
    paymentCurrency: 'USD',
    rewardAmount: 50,
  };

  it('succeeds with 200 when all guards pass and fires invite_consumed_event webhook', async () => {
    // 1. consumeInvite: fetch invite
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });
    // 2. consumeInvite: UPDATE consume
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'consumed', reward_issued: true }],
    });
    // 3. webhook: fetch full invite
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        inviter_name: 'Surya',
        invitee_user_id: INVITEE_ID,
        invitee_email: 'bob@test.com',
        payment_amount: '99.99',
        payment_currency: 'USD',
        reward_issued: true,
        reward_amount: '50',
        consumed_at: '2026-08-15T10:00:00.000Z',
      }],
    });
    // 4. webhook: fetch webhooks for inviter
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'wh-1', url: 'https://example.com/hook', secret: 's', events: ['invite_consumed_event'], is_active: true }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: validConsumePayload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.rewardIssued).toBe(true);
    expect(body.status).toBe('consumed');

    // Webhook was triggered with invite_consumed_event
    expect(mockTriggerWebhooks).toHaveBeenCalledTimes(1);
    const webhookCall = mockTriggerWebhooks.mock.calls[0];
    expect(webhookCall[1]).toBe('invite_consumed_event');

    await app.close();
  });

  it('returns 403 with self_invite when inviter === invitee', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: { ...validConsumePayload, inviteeUserId: INVITER_ID },  // self-invite
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().rejectionReason).toBe('self_invite');
    expect(mockTriggerWebhooks).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 403 with already_on_platform when invitee existed before invite', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: { ...validConsumePayload, inviteeCreatedAt: '2026-06-01T10:00:00.000Z' },  // before invite
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().rejectionReason).toBe('already_on_platform');
    expect(mockTriggerWebhooks).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 403 with not_pending when invite is already consumed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'consumed', created_at: INVITE_CREATED_AT }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: validConsumePayload,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().rejectionReason).toBe('not_pending');
    expect(mockTriggerWebhooks).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 404 when invite does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: validConsumePayload,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().rejectionReason).toBe('not_found');

    await app.close();
  });

  it('rejects with 400 when paymentAmount is missing or non-positive', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: { ...validConsumePayload, paymentAmount: 0 },
    });

    expect(res.statusCode).toBe(400);

    await app.close();
  });
});

describe('GET /api/invites/:inviterId — list invites', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns all invites for an inviter ordered by created_at DESC', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: INVITE_ID,
          inviter_id: INVITER_ID,
          inviter_name: 'Surya',
          link_id: null,
          status: 'consumed',
          invitee_user_id: INVITEE_ID,
          invitee_email: 'bob@test.com',
          consumed_at: '2026-08-15T10:00:00.000Z',
          payment_amount: '99.99',
          payment_currency: 'USD',
          reward_issued: true,
          reward_amount: '50',
          metadata: {},
          created_at: INVITE_CREATED_AT,
          updated_at: '2026-08-15T10:00:00.000Z',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          inviter_id: INVITER_ID,
          inviter_name: 'Surya',
          link_id: null,
          status: 'pending',
          invitee_user_id: null,
          invitee_email: null,
          consumed_at: null,
          payment_amount: null,
          payment_currency: null,
          reward_issued: false,
          reward_amount: null,
          metadata: {},
          created_at: '2026-07-15T10:00:00.000Z',
          updated_at: '2026-07-15T10:00:00.000Z',
        },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/invites/${INVITER_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const invites = res.json();
    expect(invites).toHaveLength(2);
    expect(invites[0].status).toBe('consumed');
    expect(invites[0].paymentAmount).toBe(99.99);  // parsed from string
    expect(invites[1].status).toBe('pending');
    expect(invites[1].paymentAmount).toBeNull();

    await app.close();
  });

  it('returns empty array when inviter has no invites', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invites/nonexistent-user',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    await app.close();
  });
});

describe('POST /api/invites/:id/expire — manual expiry', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('expires a pending invite', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        status: 'expired',
        updated_at: '2026-07-20T10:00:00.000Z',
      }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/expire`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('expired');

    await app.close();
  });

  it('returns 404 when invite does not exist', async () => {
    // UPDATE returns 0 rows
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Then the check query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/expire`,
    });

    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('returns 409 when invite is not pending (already consumed)', async () => {
    // UPDATE returns 0 rows (status != pending)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Check query returns the invite with consumed status
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'consumed' }] });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/expire`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().status).toBe('consumed');

    await app.close();
  });
});

describe('Full invite lifecycle: create → consume → verify consumed', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTriggerWebhooks.mockClear();
  });

  it('create invite, then consume on payment, then verify it shows as consumed in list', async () => {
    const app = await buildApp();

    // Step 1: Create invite
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        inviter_name: 'Surya',
        link_id: null,
        status: 'pending',
        metadata: {},
        created_at: INVITE_CREATED_AT,
      }],
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/invites',
      payload: { inviterId: INVITER_ID, inviterName: 'Surya' },
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().status).toBe('pending');

    // Step 2: Consume on payment (all guards pass)
    // 2a. fetch invite
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });
    // 2b. UPDATE consume
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'consumed', reward_issued: true }],
    });
    // 2c. webhook: fetch full invite
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        inviter_name: 'Surya',
        invitee_user_id: INVITEE_ID,
        invitee_email: 'bob@test.com',
        payment_amount: '99.99',
        payment_currency: 'USD',
        reward_issued: true,
        reward_amount: '50',
        consumed_at: '2026-08-15T10:00:00.000Z',
      }],
    });
    // 2d. webhook: fetch webhooks (none configured)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const consumeRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: {
        inviteeUserId: INVITEE_ID,
        inviteeEmail: 'bob@test.com',
        inviteeCreatedAt: '2026-08-01T10:00:00.000Z',
        paymentAmount: 99.99,
        paymentCurrency: 'USD',
        rewardAmount: 50,
      },
    });
    expect(consumeRes.statusCode).toBe(200);
    expect(consumeRes.json().success).toBe(true);
    expect(consumeRes.json().rewardIssued).toBe(true);

    // Step 3: Verify — second consume attempt is rejected (not_pending)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'consumed', created_at: INVITE_CREATED_AT }],
    });

    const secondConsumeRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${INVITE_ID}/consume`,
      payload: {
        inviteeUserId: INVITEE_ID,
        inviteeEmail: 'bob@test.com',
        inviteeCreatedAt: '2026-08-01T10:00:00.000Z',
        paymentAmount: 99.99,
        paymentCurrency: 'USD',
        rewardAmount: 50,
      },
    });
    expect(secondConsumeRes.statusCode).toBe(403);
    expect(secondConsumeRes.json().rejectionReason).toBe('not_pending');

    await app.close();
  });
});
