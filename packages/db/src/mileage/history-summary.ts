export async function getMileageHistoryPeriodSummary(
  db: D1Database,
  input: { lineAccountId: string; from?: string; to?: string },
) {
  const where = [
    `(f.line_account_id = ? OR (ml.beneficiary_friend_id IS NULL AND EXISTS (
      SELECT 1 FROM friends uf WHERE uf.user_id = ml.beneficiary_user_id AND uf.line_account_id = ?
    )))`,
  ];
  const binds: unknown[] = [input.lineAccountId, input.lineAccountId];
  if (input.from) { where.push("date(ml.occurred_at, '+9 hours') >= date(?)"); binds.push(input.from); }
  if (input.to) { where.push("date(ml.occurred_at, '+9 hours') <= date(?)"); binds.push(input.to); }
  const rows = await db.prepare(
    `SELECT ml.entry_type, COUNT(*) AS count, COALESCE(SUM(ml.amount), 0) AS amount,
            SUM(CASE WHEN ml.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
            SUM(CASE WHEN ml.entry_type = 'adjustment' OR ml.source IN ('manual','admin_adjustment') THEN 1 ELSE 0 END) AS manual_count
       FROM mileage_ledger ml LEFT JOIN friends f ON f.id = ml.beneficiary_friend_id
      WHERE ${where.join(' AND ')} GROUP BY ml.entry_type ORDER BY ml.entry_type`,
  ).bind(...binds).all<{ entry_type: string; count: number; amount: number; pending_count: number; manual_count: number }>();
  return {
    from: input.from ?? null,
    to: input.to ?? null,
    byType: rows.results.map((row) => ({
      entryType: row.entry_type, count: Number(row.count), amount: Number(row.amount),
    })),
    totalAmount: rows.results.reduce((sum, row) => sum + Number(row.amount), 0),
    manualCount: rows.results.reduce((sum, row) => sum + Number(row.manual_count), 0),
    pendingCount: rows.results.reduce((sum, row) => sum + Number(row.pending_count), 0),
    measuredAt: new Date().toISOString(),
  };
}
