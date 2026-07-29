import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock the database module so tests don't require a real Postgres connection.
vi.mock('./database', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { isSelfInvite, isAlreadyOnPlatform, isConsumable, consumeInvite } from './invite';
import { db } from './database';

const mockDbQuery = db.query as Mock;

const INVITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITER_ID = 'user-surya';
const INVITEE_ID = 'user-bob';
const INVITE_CREATED_AT = '2026-07-01T10:00:00.000Z';

describe('isSelfInvite', () => {
  it('returns true when inviterId equals inviteeUserId', () => {
    expect(isSelfInvite('user-1', 'user-1')).toBe(true);
  });

  it('returns false when inviterId differs from inviteeUserId', () => {
    expect(isSelfInvite('user-1', 'user-2')).toBe(false);
  });

  it('is case-sensitive (different case = different user)', () => {
    expect(isSelfInvite('User-1', 'user-1')).toBe(false);
  });

  it('rejects empty string self-invite (both empty = same identity)', () => {
    expect(isSelfInvite('', '')).toBe(true);
  });
});

describe('isAlreadyOnPlatform', () => {
  it('returns true when invitee account was created BEFORE the invite', () => {
    // Invitee signed up on June 1, invite created on July 1 → already on platform
    expect(isAlreadyOnPlatform('2026-06-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z')).toBe(true);
  });

  it('returns false when invitee account was created AFTER the invite', () => {
    // Invitee signed up on August 1, invite created on July 1 → new user
    expect(isAlreadyOnPlatform('2026-08-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z')).toBe(false);
  });

  it('returns false when timestamps are exactly equal (boundary: allow)', () => {
    expect(isAlreadyOnPlatform('2026-07-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z')).toBe(false);
  });

  it('returns false when invitee is 1ms after invite (new user)', () => {
    expect(isAlreadyOnPlatform('2026-07-01T10:00:00.001Z', '2026-07-01T10:00:00.000Z')).toBe(false);
  });

  it('returns true when invitee is 1ms before invite (already on platform)', () => {
    expect(isAlreadyOnPlatform('2026-07-01T09:59:59.999Z', '2026-07-01T10:00:00.000Z')).toBe(true);
  });

  it('accepts Date objects as well as ISO strings', () => {
    expect(isAlreadyOnPlatform(new Date('2026-06-01'), new Date('2026-07-01'))).toBe(true);
  });
});

describe('isConsumable', () => {
  it('returns true for pending status', () => {
    expect(isConsumable('pending')).toBe(true);
  });

  it('returns false for consumed status', () => {
    expect(isConsumable('consumed')).toBe(false);
  });

  it('returns false for expired status', () => {
    expect(isConsumable('expired')).toBe(false);
  });
});

describe('consumeInvite — guard integration', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
  });

  it('rejects with not_found when invite does not exist', async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await consumeInvite(
      INVITE_ID, INVITEE_ID, 'bob@test.com',
      '2026-08-01T10:00:00.000Z', 99.99, 'USD', 50,
    );

    expect(result.success).toBe(false);
    expect(result.rejectionReason).toBe('not_found');
    expect(result.rewardIssued).toBe(false);
  });

  it('rejects with not_pending when invite is already consumed', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'consumed', created_at: INVITE_CREATED_AT }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITEE_ID, 'bob@test.com',
      '2026-08-01T10:00:00.000Z', 99.99, 'USD', 50,
    );

    expect(result.success).toBe(false);
    expect(result.rejectionReason).toBe('not_pending');
    expect(result.status).toBe('consumed');
  });

  it('rejects with not_pending when invite is expired', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'expired', created_at: INVITE_CREATED_AT }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITEE_ID, 'bob@test.com',
      '2026-08-01T10:00:00.000Z', 99.99, 'USD', 50,
    );

    expect(result.success).toBe(false);
    expect(result.rejectionReason).toBe('not_pending');
    expect(result.status).toBe('expired');
  });

  it('rejects with self_invite when inviterId equals inviteeUserId', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITER_ID, 'surya@test.com',  // invitee = inviter
      '2026-08-01T10:00:00.000Z', 99.99, 'USD', 50,
    );

    expect(result.success).toBe(false);
    expect(result.rejectionReason).toBe('self_invite');
    expect(result.rewardIssued).toBe(false);
  });

  it('rejects with already_on_platform when invitee existed before invite', async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITEE_ID, 'bob@test.com',
      '2026-06-01T10:00:00.000Z',  // before invite (July 1)
      99.99, 'USD', 50,
    );

    expect(result.success).toBe(false);
    expect(result.rejectionReason).toBe('already_on_platform');
    expect(result.rewardIssued).toBe(false);
  });

  it('succeeds and issues reward when all guards pass', async () => {
    // 1. Fetch invite (pending, inviter != invitee, invitee created after invite)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });
    // 2. UPDATE consume
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: INVITE_ID,
        inviter_id: INVITER_ID,
        status: 'consumed',
        invitee_user_id: INVITEE_ID,
        reward_issued: true,
        reward_amount: 50,
      }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITEE_ID, 'bob@test.com',
      '2026-08-01T10:00:00.000Z',  // after invite
      99.99, 'USD', 50,
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('consumed');
    expect(result.rewardIssued).toBe(true);

    // Verify the UPDATE query includes the WHERE status = 'pending' guard
    const updateCall = mockDbQuery.mock.calls[1];
    expect(updateCall[0]).toMatch(/WHERE id = .* AND status = 'pending'/);
  });

  it('rejects on race condition: concurrent consume between read and write', async () => {
    // 1. Fetch invite (pending)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });
    // 2. UPDATE returns 0 rows (another request consumed it first)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await consumeInvite(
      INVITE_ID, INVITEE_ID, 'bob@test.com',
      '2026-08-01T10:00:00.000Z', 99.99, 'USD', 50,
    );

    expect(result.success).toBe(false);
    expect(result.rejectionReason).toBe('not_pending');
    expect(result.rejectionDetail).toMatch(/concurrent/);
  });

  it('guard ordering: status check happens before self-invite check', async () => {
    // Invite is consumed AND inviter === invitee — should reject on status, not self-invite
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'consumed', created_at: INVITE_CREATED_AT }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITER_ID, 'surya@test.com',
      '2026-08-01T10:00:00.000Z', 99.99, 'USD', 50,
    );

    // Should be not_pending, NOT self_invite (status checked first)
    expect(result.rejectionReason).toBe('not_pending');
  });

  it('guard ordering: self-invite check happens before already-on-platform check', async () => {
    // Self-invite AND already on platform — should reject on self_invite
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: INVITE_ID, inviter_id: INVITER_ID, status: 'pending', created_at: INVITE_CREATED_AT }],
    });

    const result = await consumeInvite(
      INVITE_ID, INVITER_ID, 'surya@test.com',
      '2026-06-01T10:00:00.000Z',  // before invite
      99.99, 'USD', 50,
    );

    // Should be self_invite, NOT already_on_platform (self checked first)
    expect(result.rejectionReason).toBe('self_invite');
  });
});
