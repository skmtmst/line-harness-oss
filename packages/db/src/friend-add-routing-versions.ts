import { jstNow } from './utils';

export type FriendAddRoutingVersionStatus = 'draft' | 'published' | 'retired';
export type FriendAddRoutingTestStatus = 'succeeded' | 'failed';

export interface FriendAddRoutingVersionRow {
  id: string;
  line_account_id: string;
  version_number: number;
  definition_snapshot: string;
  status: FriendAddRoutingVersionStatus;
  last_test_status: FriendAddRoutingTestStatus | null;
  last_tested_at: string | null;
  last_tested_by_staff_id: string | null;
  published_at: string | null;
  published_by_staff_id: string | null;
  publish_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export async function getFriendAddRoutingDraftVersion(
  db: D1Database,
  lineAccountId: string,
): Promise<FriendAddRoutingVersionRow | null> {
  return db.prepare(
    `SELECT * FROM friend_add_routing_versions
      WHERE line_account_id = ? AND status = 'draft'
      ORDER BY version_number DESC LIMIT 1`,
  ).bind(lineAccountId).first<FriendAddRoutingVersionRow>();
}

export async function saveFriendAddRoutingDraftVersion(
  db: D1Database,
  lineAccountId: string,
  definition: unknown,
): Promise<FriendAddRoutingVersionRow> {
  const now = jstNow();
  const snapshot = JSON.stringify(definition);
  let draft = await getFriendAddRoutingDraftVersion(db, lineAccountId);
  if (draft) {
    await db.prepare(
      `UPDATE friend_add_routing_versions
          SET definition_snapshot = ?, last_test_status = NULL,
              last_tested_at = NULL, last_tested_by_staff_id = NULL, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    ).bind(snapshot, now, draft.id).run();
  } else {
    const next = await db.prepare(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS version_number
         FROM friend_add_routing_versions WHERE line_account_id = ?`,
    ).bind(lineAccountId).first<{ version_number: number }>();
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO friend_add_routing_versions
         (id, line_account_id, version_number, definition_snapshot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
    ).bind(id, lineAccountId, Number(next?.version_number ?? 1), snapshot, now, now).run();
    draft = await getFriendAddRoutingDraftVersion(db, lineAccountId);
  }
  if (!draft) throw new Error('FRIEND_ADD_ROUTING_DRAFT_NOT_SAVED');
  return draft;
}

export async function recordFriendAddRoutingDraftTest(
  db: D1Database,
  versionId: string,
  input: { succeeded: boolean; staffId: string },
): Promise<void> {
  const now = jstNow();
  await db.prepare(
    `UPDATE friend_add_routing_versions
        SET last_test_status = ?, last_tested_at = ?, last_tested_by_staff_id = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`,
  ).bind(input.succeeded ? 'succeeded' : 'failed', now, input.staffId, now, versionId).run();
}

export async function publishFriendAddRoutingDraftVersion(
  db: D1Database,
  lineAccountId: string,
  input: { idempotencyKey: string; staffId: string },
): Promise<FriendAddRoutingVersionRow> {
  const replay = await db.prepare(
    `SELECT * FROM friend_add_routing_versions
      WHERE line_account_id = ? AND publish_idempotency_key = ?`,
  ).bind(lineAccountId, input.idempotencyKey).first<FriendAddRoutingVersionRow>();
  if (replay) return replay;

  const draft = await getFriendAddRoutingDraftVersion(db, lineAccountId);
  if (!draft) throw new Error('FRIEND_ADD_ROUTING_DRAFT_NOT_FOUND');
  if (draft.last_test_status !== 'succeeded') {
    throw new Error('FRIEND_ADD_ROUTING_DRAFT_NOT_TESTED');
  }

  const now = jstNow();
  await db.batch([
    db.prepare(
      `UPDATE friend_add_routing_versions SET status = 'retired', updated_at = ?
        WHERE line_account_id = ? AND status = 'published'`,
    ).bind(now, lineAccountId),
    db.prepare(
      `UPDATE friend_add_routing_versions
          SET status = 'published', published_at = ?, published_by_staff_id = ?,
              publish_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    ).bind(now, input.staffId, input.idempotencyKey, now, draft.id),
    db.prepare(
      `INSERT INTO account_settings (line_account_id, key, value, created_at, updated_at)
       VALUES (?, 'friend_add_routing', ?, ?, ?)
       ON CONFLICT(line_account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(lineAccountId, draft.definition_snapshot, now, now),
  ]);

  const published = await db.prepare(
    `SELECT * FROM friend_add_routing_versions WHERE id = ?`,
  ).bind(draft.id).first<FriendAddRoutingVersionRow>();
  if (!published || published.status !== 'published') {
    throw new Error('FRIEND_ADD_ROUTING_DRAFT_NOT_PUBLISHED');
  }
  return published;
}
