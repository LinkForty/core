/**
 * One-time backfill of click_events.is_bot for rows recorded before bot
 * classification existed (SIT-298). Historical rows only have the stored
 * user-agent, so this classifies UA-only (method/edge signals aren't available
 * retroactively) and flags matches as is_bot=true, bot_reason='ua'.
 *
 * Keyset-paginated over the primary key so it scales to large tables and visits
 * every row once. Idempotent: re-running re-checks and leaves already-correct
 * rows unchanged.
 *
 * Run: `npm run backfill:bot-flags` (needs DATABASE_URL).
 */
import { db, initializeDatabase } from '../lib/database.js';
import { classifyBot } from '../lib/bot-detection.js';

const BATCH = 5000;

async function backfill() {
  await initializeDatabase();
  let cursor = '00000000-0000-0000-0000-000000000000';
  let scanned = 0;
  let flagged = 0;

  for (;;) {
    const { rows } = await db.query(
      `SELECT id, user_agent FROM click_events WHERE id > $1 ORDER BY id LIMIT $2`,
      [cursor, BATCH]
    );
    if (rows.length === 0) break;

    const botIds: string[] = [];
    for (const r of rows) {
      if (classifyBot(r.user_agent ?? undefined, undefined, undefined).isBot) botIds.push(r.id);
    }
    if (botIds.length > 0) {
      await db.query(
        `UPDATE click_events SET is_bot = true, bot_reason = 'ua' WHERE id = ANY($1::uuid[])`,
        [botIds]
      );
      flagged += botIds.length;
    }

    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`[backfill-bot-flags] scanned ${scanned}, flagged ${flagged}`);
  }

  console.log(`[backfill-bot-flags] done: scanned ${scanned}, flagged ${flagged} as bots`);
  process.exit(0);
}

backfill().catch((error) => {
  console.error('[backfill-bot-flags] failed:', error);
  process.exit(1);
});
