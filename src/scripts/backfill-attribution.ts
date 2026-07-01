/**
 * One-time backfill of install_events.attribution_method for rows recorded
 * before attribution metadata existed (SIT-296). Historical rows only tell us
 * whether they were attributed (link_id present), so this sets:
 *   - 'fingerprint' when link_id IS NOT NULL (current attribution is fingerprint-based)
 *   - 'none'        otherwise (organic)
 * `matched_factors` is left NULL for history — the matched signals weren't
 * stored and can't be reconstructed; new installs record it going forward.
 *
 * Keyset-paginated over the primary key; idempotent (only touches NULL rows).
 * Run: `npm run backfill:attribution` (needs DATABASE_URL).
 */
import { db, initializeDatabase } from '../lib/database.js';

const BATCH = 5000;

async function backfill() {
  await initializeDatabase();
  let cursor = '00000000-0000-0000-0000-000000000000';
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const { rows } = await db.query(
      `SELECT id FROM install_events WHERE id > $1 ORDER BY id LIMIT $2`,
      [cursor, BATCH]
    );
    if (rows.length === 0) break;

    const ids = rows.map((r: { id: string }) => r.id);
    const res = await db.query(
      `UPDATE install_events
       SET attribution_method = CASE WHEN link_id IS NOT NULL THEN 'fingerprint' ELSE 'none' END
       WHERE id = ANY($1::uuid[]) AND attribution_method IS NULL`,
      [ids]
    );
    updated += res.rowCount ?? 0;
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    console.log(`[backfill-attribution] scanned ${scanned}, set ${updated}`);
  }

  console.log(`[backfill-attribution] done: scanned ${scanned}, set attribution_method on ${updated}`);
  process.exit(0);
}

backfill().catch((error) => {
  console.error('[backfill-attribution] failed:', error);
  process.exit(1);
});
