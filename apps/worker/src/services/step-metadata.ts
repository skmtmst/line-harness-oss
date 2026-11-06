/** 同じ UUID の友だち情報を結合し、user_id がなければ本人の metadata だけを使う。 */
export async function resolveMetadata(
  db: D1Database,
  friend: { user_id?: string | null; metadata?: string | null; line_account_id?: string | null },
): Promise<Record<string, unknown>> {
  // 同じ UUID の全レコードから metadata を結合する。
  if (friend.user_id && friend.line_account_id) {
    const { getMergedMetadataByUserId } = await import('@line-crm/db');
    return getMergedMetadataByUserId(db, friend.user_id, friend.line_account_id);
  }
  // UUID がなければ、この友だち自身の metadata を読む。
  if (friend.metadata) {
    try { return JSON.parse(friend.metadata); } catch { return {}; }
  }
  return {};
}
