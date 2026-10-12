/** 決済と予約の状態を同じ取引でそろえ、旧版の途中失敗も補完する。外部送信はしない。 */
export async function reconcilePaidBookingPayment(
  db: D1Database,
  paymentId: string,
  now = new Date(),
  applyPaid = false,
): Promise<{ duplicate: boolean } | null> {
  const row = await db.prepare(`SELECT id, line_account_id, booking_id, status
    FROM booking_payments WHERE id = ?`).bind(paymentId).first<{
      id: string; line_account_id: string; booking_id: string | null; status: string;
    }>();
  if (!row) return null;
  if (row.status !== 'paid' && (!applyPaid || !['unpaid', 'pending'].includes(row.status))) {
    return { duplicate: true };
  }
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (applyPaid) {
    statements.push(db.prepare(`UPDATE booking_payments
      SET status = 'paid', paid_at = COALESCE(paid_at, ?), updated_at = ?
      WHERE id = ? AND status IN ('unpaid', 'pending')`).bind(nowIso, nowIso, paymentId));
  }
  if (row.booking_id !== null) {
    statements.push(db.prepare(`UPDATE bookings
      SET status = 'confirmed', decided_at = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND status = 'requested'
        AND EXISTS (SELECT 1 FROM booking_payments p WHERE p.id = ? AND p.status = 'paid'
          AND p.booking_id = bookings.id AND p.line_account_id = bookings.line_account_id)
        AND COALESCE((SELECT approval_mode FROM booking_settings
          WHERE line_account_id = bookings.line_account_id), 'automatic') = 'automatic'`)
      .bind(nowIso, nowIso, row.booking_id, row.line_account_id, paymentId));
    // changes() は直前の予約更新だけを見る。並走・重複通知でも履歴を重ねない。
    statements.push(db.prepare(`INSERT INTO booking_audit_logs
      (id, booking_id, line_account_id, action, after_json, actor_type, occurred_at)
      SELECT ?, ?, ?, 'confirmed', '{"status":"confirmed","payment":"paid"}', 'system', ?
      WHERE changes() = 1`).bind(crypto.randomUUID(), row.booking_id, row.line_account_id, nowIso));
  }
  const result = statements.length ? await db.batch(statements) : [];
  return { duplicate: !applyPaid || (result[0]?.meta?.changes ?? 0) === 0 };
}

/** requested の不整合だけを有限数で回収する。承認待ちの支払い済みは期限切れにしない。 */
export async function recoverPaidBookingPayments(db: D1Database, now: Date): Promise<void> {
  const rows = await db.prepare(`SELECT p.id FROM booking_payments p
    JOIN bookings b ON b.id = p.booking_id AND b.line_account_id = p.line_account_id
    WHERE p.status = 'paid' AND b.status = 'requested'
      AND COALESCE((SELECT approval_mode FROM booking_settings
        WHERE line_account_id = b.line_account_id), 'automatic') = 'automatic'
    ORDER BY p.id LIMIT 200`).all<{ id: string }>();
  for (const row of rows.results ?? []) await reconcilePaidBookingPayment(db, row.id, now);
}

export async function reconcileExpiredBookingPayment(
  db: D1Database, paymentId: string, now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  await db.batch([
    db.prepare(`UPDATE booking_payments SET status = 'expired', updated_at = ?
      WHERE id = ? AND status IN ('unpaid', 'pending') AND hold_until <= ?`)
      .bind(nowIso, paymentId, nowIso),
    db.prepare(`UPDATE bookings SET status = 'expired', decided_at = ?, updated_at = ?
      WHERE status = 'requested' AND EXISTS (
        SELECT 1 FROM booking_payments p WHERE p.id = ? AND p.status = 'expired'
          AND p.booking_id = bookings.id AND p.line_account_id = bookings.line_account_id)`)
      .bind(nowIso, nowIso, paymentId),
    db.prepare(`INSERT INTO booking_audit_logs
      (id, booking_id, line_account_id, action, after_json, reason, actor_type, occurred_at)
      SELECT ?, booking_id, line_account_id, 'expired', '{"status":"expired"}',
        'payment_hold_expired', 'system', ? FROM booking_payments
      WHERE id = ? AND booking_id IS NOT NULL AND changes() = 1`)
      .bind(crypto.randomUUID(), nowIso, paymentId),
  ]);
}

/** 10分等の支払い期限は24時間の承認期限とは別に回収する。 */
export async function recoverExpiredBookingPayments(db: D1Database, now: Date): Promise<void> {
  const rows = await db.prepare(`SELECT p.id FROM booking_payments p
    LEFT JOIN bookings b ON b.id = p.booking_id AND b.line_account_id = p.line_account_id
    WHERE (p.status IN ('unpaid', 'pending') AND p.hold_until <= ?)
      OR (p.status = 'expired' AND b.status = 'requested')
    ORDER BY p.id LIMIT 200`).bind(now.toISOString()).all<{ id: string }>();
  for (const row of rows.results ?? []) await reconcileExpiredBookingPayment(db, row.id, now);
}
