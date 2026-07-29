import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { db } from '../lib/database.js';
import { consumeInvite } from '../lib/invite.js';
import { triggerWebhooks } from '../lib/webhook.js';

const createInviteSchema = z.object({
  inviterId: z.string().min(1, 'inviterId is required'),
  inviterName: z.string().optional(),
  linkId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const consumeInviteSchema = z.object({
  inviteeUserId: z.string().min(1, 'inviteeUserId is required'),
  inviteeEmail: z.string().email().optional(),
  inviteeCreatedAt: z.string().datetime('inviteeCreatedAt must be an ISO 8601 datetime'),
  paymentAmount: z.number().positive('paymentAmount must be positive'),
  paymentCurrency: z.string().length(3, 'paymentCurrency must be a 3-letter code'),
  rewardAmount: z.number().optional(),
});

export async function inviteRoutes(fastify: FastifyInstance) {
  // Convert ZodError into a 400 response instead of Fastify's default 500.
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation failed',
        details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return reply.send(error);
  });

  // Create a new invite
  fastify.post('/api/invites', async (request: FastifyRequest) => {
    const data = createInviteSchema.parse(request.body);

    const result = await db.query(
      `INSERT INTO invites (inviter_id, inviter_name, link_id, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        data.inviterId,
        data.inviterName || null,
        data.linkId || null,
        JSON.stringify(data.metadata || {}),
      ],
    );

    const invite = result.rows[0];
    return {
      id: invite.id,
      inviterId: invite.inviter_id,
      inviterName: invite.inviter_name,
      linkId: invite.link_id,
      status: invite.status,
      metadata: invite.metadata,
      createdAt: invite.created_at,
    };
  });

  // Consume an invite on payment — runs all three guards
  fastify.post('/api/invites/:id/consume', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const { id } = request.params;
    const data = consumeInviteSchema.parse(request.body);

    const result = await consumeInvite(
      id,
      data.inviteeUserId,
      data.inviteeEmail,
      data.inviteeCreatedAt,
      data.paymentAmount,
      data.paymentCurrency,
      data.rewardAmount,
    );

    // If consumption succeeded, fire invite_consumed_event webhooks
    if (result.success) {
      try {
        // Fetch the full invite record for the webhook payload
        const inviteResult = await db.query(
          `SELECT * FROM invites WHERE id = $1`,
          [id],
        );

        if (inviteResult.rows.length > 0) {
          const invite = inviteResult.rows[0];
          const webhookPayload = {
            id: invite.id,
            inviterId: invite.inviter_id,
            inviterName: invite.inviter_name,
            inviteeUserId: invite.invitee_user_id,
            inviteeEmail: invite.invitee_email,
            paymentAmount: parseFloat(invite.payment_amount),
            paymentCurrency: invite.payment_currency,
            rewardIssued: invite.reward_issued,
            rewardAmount: invite.reward_amount ? parseFloat(invite.reward_amount) : null,
            consumedAt: invite.consumed_at,
          };

          // Look up webhooks for the inviter's user_id
          const webhooksResult = await db.query(
            `SELECT * FROM webhooks WHERE user_id = $1 AND is_active = true`,
            [invite.inviter_id],
          );

          if (webhooksResult.rows.length > 0) {
            await triggerWebhooks(
              webhooksResult.rows,
              'invite_consumed_event',
              invite.id,
              webhookPayload,
            );
          }
        }
      } catch (webhookError) {
        // Webhook delivery failure should not affect the consume result
        fastify.log.error(`Error triggering invite webhooks: ${webhookError}`);
      }
    }

    const statusCode = result.success ? 200
      : result.rejectionReason === 'not_found' ? 404
      : 403;

    return reply.status(statusCode).send(result);
  });

  // Get all invites for an inviter
  fastify.get('/api/invites/:inviterId', async (request: FastifyRequest<{
    Params: { inviterId: string };
  }>) => {
    const { inviterId } = request.params;

    const result = await db.query(
      `SELECT * FROM invites WHERE inviter_id = $1 ORDER BY created_at DESC`,
      [inviterId],
    );

    return result.rows.map(row => ({
      id: row.id,
      inviterId: row.inviter_id,
      inviterName: row.inviter_name,
      linkId: row.link_id,
      status: row.status,
      inviteeUserId: row.invitee_user_id,
      inviteeEmail: row.invitee_email,
      consumedAt: row.consumed_at,
      paymentAmount: row.payment_amount ? parseFloat(row.payment_amount) : null,
      paymentCurrency: row.payment_currency,
      rewardIssued: row.reward_issued,
      rewardAmount: row.reward_amount ? parseFloat(row.reward_amount) : null,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });

  // Get a single invite by ID
  fastify.get('/api/invites/id/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const { id } = request.params;

    const result = await db.query(
      `SELECT * FROM invites WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Invite not found' });
    }

    const row = result.rows[0];
    return {
      id: row.id,
      inviterId: row.inviter_id,
      inviterName: row.inviter_name,
      linkId: row.link_id,
      status: row.status,
      inviteeUserId: row.invitee_user_id,
      inviteeEmail: row.invitee_email,
      consumedAt: row.consumed_at,
      paymentAmount: row.payment_amount ? parseFloat(row.payment_amount) : null,
      paymentCurrency: row.payment_currency,
      rewardIssued: row.reward_issued,
      rewardAmount: row.reward_amount ? parseFloat(row.reward_amount) : null,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  // Manually expire an invite (no reward issued)
  fastify.post('/api/invites/:id/expire', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const { id } = request.params;

    const result = await db.query(
      `UPDATE invites
       SET status = 'expired', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id],
    );

    if (result.rows.length === 0) {
      // Either not found or not in pending state
      const check = await db.query(`SELECT status FROM invites WHERE id = $1`, [id]);
      if (check.rows.length === 0) {
        return reply.status(404).send({ error: 'Invite not found' });
      }
      return reply.status(409).send({
        error: 'Invite is not pending',
        status: check.rows[0].status,
      });
    }

    const row = result.rows[0];
    return {
      id: row.id,
      inviterId: row.inviter_id,
      status: row.status,
      updatedAt: row.updated_at,
    };
  });
}
