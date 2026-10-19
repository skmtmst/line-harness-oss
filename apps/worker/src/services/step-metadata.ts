/**
 * Resolve metadata for a friend, merging across all UUID-linked records.
 * Falls back to the friend's own metadata if no user_id.
 */
export async function resolveMetadata(
  db: D1Database,
  friend: { user_id?: string | null; metadata?: string | null; line_account_id?: string | null },
): Promise<Record<string, unknown>> {
  // If friend has a UUID, merge metadata from all linked records
  if (friend.user_id && friend.line_account_id) {
    const { getMergedMetadataByUserId } = await import('@line-crm/db');
    return getMergedMetadataByUserId(db, friend.user_id, friend.line_account_id);
  }
  // Fallback: parse own metadata
  if (friend.metadata) {
    try { return JSON.parse(friend.metadata); } catch { return {}; }
  }
  return {};
}
