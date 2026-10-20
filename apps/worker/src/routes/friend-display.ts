import type { Friend as DbFriend } from '@line-crm/db';

/**
 * Convert a D1 snake_case Friend row to the shared camelCase shape.
 *
 * Bare-row variant — emits ONLY columns that exist on the friends table.
 * Used by GET /api/friends/:id and metadata-update responses where we read
 * via plain `getFriendById` and have no JOINed columns. The list endpoint
 * uses `serializeFriendListRow` instead, which adds firstTrackedLinkName +
 * chatStatus from the JOINed query.
 */
export function serializeFriend(row: DbFriend) {
  return {
    id: row.id,
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pictureUrl: row.picture_url,
    statusMessage: row.status_message,
    isFollowing: Boolean(row.is_following),
    metadata: JSON.parse(row.metadata || '{}'),
    refCode: (row as unknown as Record<string, unknown>).ref_code as string | null,
    lineAccountId: ((row as unknown as Record<string, unknown>).line_account_id as string | null) ?? null,
    userId: row.user_id,
    // 100 で足した列。友だち詳細（設計 `友だち詳細` の「名前」）が読む。
    // LINEの表示名と、こちらで付けた本名は別物。取り違えると別人に送るので、
    // 画面で両方を並べて出せるように、ここから返す。
    realName: ((row as unknown as Record<string, unknown>).real_name as string | null) ?? null,
    systemDisplayName:
      ((row as unknown as Record<string, unknown>).system_display_name as string | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
