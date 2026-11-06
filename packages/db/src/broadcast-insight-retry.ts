

export async function markInsightFailed(
  db: D1Database,
  insightId: string,
  retryCount: number,
): Promise<void> {
  const newStatus = retryCount >= 2 ? 'failed' : 'pending';
  await db
    .prepare(
      `UPDATE broadcast_insights SET retry_count = ?, status = ? WHERE id = ?`,
    )
    .bind(retryCount + 1, newStatus, insightId)
    .run();
}
