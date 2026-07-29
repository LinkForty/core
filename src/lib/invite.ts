import { db } from './database.js';
import type { ConsumeInviteResult, InviteStatus } from '../types/index.js';

/**
 * Guard 1: Self-invite detection.
 *
 * The inviter cannot be the same user as the invitee. This is a strict
 * identity comparison — if the inviter created the invite link, their
 * inviterId is baked into the invite record. When the invitee pays, their
 * userId (from the caller's auth system) is compared against inviterId.
 *
 * This is deterministic and unbeatable: the attacker cannot make their own
 * userId differ from the inviterId they chose when creating the invite.
 *
 * @returns true if this is a self-invite (should be rejected)
 */
export function isSelfInvite(inviterId: string, inviteeUserId: string): boolean {
  return inviterId === inviteeUserId;
}

/**
 * Guard 2: Already-on-platform detection.
 *
 * If the invitee's account was created BEFORE the invite was created, the
 * invitee already existed on the platform. The invite is meant to acquire
 * NEW users, not credit existing ones. We compare timestamps:
 *
 *   inviteeCreatedAt < inviteCreatedAt  → already on platform → reject
 *   inviteeCreatedAt >= inviteCreatedAt → new user (or same instant) → allow
 *
 * The boundary case (equal timestamps) is allowed because a user who signed
 * up at the exact moment the invite was created is ambiguous, and the
 * payment gate already prevents farming.
 *
 * @returns true if the invitee was already on the platform (should be rejected)
 */
export function isAlreadyOnPlatform(
  inviteeCreatedAt: string | Date,
  inviteCreatedAt: string | Date
): boolean {
  const inviteeTime = new Date(inviteeCreatedAt).getTime();
  const inviteTime = new Date(inviteCreatedAt).getTime();
  return inviteeTime < inviteTime;
}

/**
 * Guard 3: Invite status check.
 *
 * Only `pending` invites can be consumed. An invite that is already
 * `consumed` (invitee already paid and reward was issued) or `expired`
 * (manually invalidated) cannot be consumed again.
 *
 * This is the "invitation expired once consumed" rule: once the invitee
 * pays, the invite transitions to `consumed` and all future consume
 * attempts are rejected — even from the same device reinstalling.
 *
 * @returns true if the invite is in a consumable state (pending)
 */
export function isConsumable(status: InviteStatus): boolean {
  return status === 'pending';
}

/**
 * Consume an invite on payment. Runs all three guards in order and, if
 * all pass, atomically transitions the invite to `consumed` and marks
 * the reward as issued.
 *
 * Guard ordering (fail fast, cheapest first):
 *   1. Status check (DB read, no comparison needed)
 *   2. Self-invite (string comparison, no I/O)
 *   3. Already-on-platform (timestamp comparison, no I/O)
 *
 * @param inviteId - UUID of the invite to consume
 * @param inviteeUserId - The paying user's ID (from caller's auth system)
 * @param inviteeEmail - Optional email for audit trail
 * @param inviteeCreatedAt - ISO timestamp of when the invitee's account was created
 * @param paymentAmount - The payment amount that triggered consumption
 * @param paymentCurrency - 3-letter currency code
 * @param rewardAmount - Optional reward amount to record (e.g. 50 for -50%)
 * @returns ConsumeInviteResult with success/failure + rejection reason
 */
export async function consumeInvite(
  inviteId: string,
  inviteeUserId: string,
  inviteeEmail: string | undefined,
  inviteeCreatedAt: string,
  paymentAmount: number,
  paymentCurrency: string,
  rewardAmount?: number,
): Promise<ConsumeInviteResult> {
  // Fetch the invite
  const result = await db.query(
    `SELECT id, inviter_id, status, created_at FROM invites WHERE id = $1`,
    [inviteId],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      inviteId,
      status: 'pending',
      rewardIssued: false,
      rejectionReason: 'not_found',
      rejectionDetail: `Invite ${inviteId} does not exist`,
    };
  }

  const invite = result.rows[0];

  // Guard 3: Status must be pending
  if (!isConsumable(invite.status as InviteStatus)) {
    return {
      success: false,
      inviteId,
      status: invite.status as InviteStatus,
      rewardIssued: false,
      rejectionReason: 'not_pending',
      rejectionDetail: `Invite is ${invite.status}, not pending`,
    };
  }

  // Guard 1: Self-invite
  if (isSelfInvite(invite.inviter_id as string, inviteeUserId)) {
    return {
      success: false,
      inviteId,
      status: 'pending',
      rewardIssued: false,
      rejectionReason: 'self_invite',
      rejectionDetail: `Inviter ${invite.inviter_id} cannot invite themselves`,
    };
  }

  // Guard 2: Already on platform
  if (isAlreadyOnPlatform(inviteeCreatedAt, invite.created_at as string)) {
    return {
      success: false,
      inviteId,
      status: 'pending',
      rewardIssued: false,
      rejectionReason: 'already_on_platform',
      rejectionDetail: `Invitee account created before invite — already on platform`,
    };
  }

  // All guards passed — consume the invite atomically
  const consumeResult = await db.query(
    `UPDATE invites
     SET status = 'consumed',
         invitee_user_id = $1,
         invitee_email = $2,
         consumed_at = NOW(),
         payment_amount = $3,
         payment_currency = $4,
         reward_issued = true,
         reward_amount = $5,
         updated_at = NOW()
     WHERE id = $6 AND status = 'pending'
     RETURNING *`,
    [
      inviteeUserId,
      inviteeEmail || null,
      paymentAmount,
      paymentCurrency,
      rewardAmount || null,
      inviteId,
    ],
  );

  if (consumeResult.rows.length === 0) {
    // Race condition: another request consumed it between our read and write.
    // The WHERE status = 'pending' guard in the UPDATE prevented a double-consume.
    return {
      success: false,
      inviteId,
      status: 'consumed',
      rewardIssued: false,
      rejectionReason: 'not_pending',
      rejectionDetail: `Invite was consumed by a concurrent request`,
    };
  }

  return {
    success: true,
    inviteId,
    status: 'consumed',
    rewardIssued: true,
  };
}
