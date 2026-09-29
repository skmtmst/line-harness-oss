import { jstNow } from './utils.js';

/**
 * 一斉配信の操作の記録（#816 / migration 459）。
 *
 * 作成・編集・予約・送信の開始・停止・再開・再送・予約の取消を残す。
 * 承認の依頼・承認・差し戻し・期限切れは broadcast_approval_events（455）に
 * あるので、ここには書かない。一覧で合わせて読む（listBroadcastActivity）。
 *
 * 記録は消さない。取り消しは逆向きの記録を足す。この表への UPDATE・DELETE
 * は書かない。
 */
export type BroadcastLifecycleAction =
  | 'created'
  | 'updated'
  | 'scheduled'
  | 'send_started'
  | 'stopped'
  | 'resumed'
  | 'retried'
  | 'cancelled';

export const BROADCAST_LIFECYCLE_ACTION_LABELS: Record<BroadcastLifecycleAction, string> = {
  created: '下書きを作った',
  updated: '内容を変えた',
  scheduled: '予約した',
  send_started: '送信を始めた',
  stopped: '送信を止めた',
  resumed: '送信を再開した',
  retried: '一時的な失敗を送り直した',
  cancelled: '予約を取り消した',
};

const APPROVAL_ACTION_LABELS: Record<string, string> = {
  requested: '承認を依頼した',
  approved: '承認した',
  rejected: '差し戻した',
  cancelled: '承認の依頼を取り消した',
  expired: '承認の期限が切れた',
  reminded: '承認をもう一度知らせた',
};

export interface RecordLifecycleInput {
  broadcastId: string;
  actorStaffId?: string | null;
  action: BroadcastLifecycleAction;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
  id?: string;
  at?: string;
}

/**
 * 1件だけ残す。記録に失敗しても本処理を止めないよう、呼び出し側で
 * try/catch して続ける（監査の取りこぼしより送信の停止を優先しない——
 * 逆。記録が書けなくても送信は止めない。エラーを握りつぶさず console に出す）。
 */
export async function recordBroadcastLifecycleEvent(
  db: D1Database,
  input: RecordLifecycleInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO broadcast_lifecycle_events
         (id, broadcast_id, actor_staff_id, action, reason, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id ?? crypto.randomUUID(),
      input.broadcastId,
      input.actorStaffId ?? null,
      input.action,
      input.reason ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
      input.at ?? jstNow(),
    )
    .run();
}

export interface BroadcastActivityEntry {
  kind: 'lifecycle' | 'approval';
  action: string;
  label: string;
  actorStaffId: string | null;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}

/**
 * 記録の一覧。操作の記録と承認の記録を時刻順（新しい順）に混ぜて返す。
 * 承認側の actor が空（期限切れの自動処理）のときは名前を「自動」とする。
 */
export async function listBroadcastActivity(
  db: D1Database,
  broadcastId: string,
  options: { limit?: number; cursor?: number } = {},
): Promise<{ entries: BroadcastActivityEntry[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const cursor = Math.max(0, options.cursor ?? 0);
  const rows = await db
    .prepare(
      `SELECT kind, action, actor_staff_id, reason, created_at FROM (
         SELECT 'lifecycle' AS kind, action, actor_staff_id, reason, created_at
           FROM broadcast_lifecycle_events WHERE broadcast_id = ?
         UNION ALL
         SELECT 'approval' AS kind, action, actor_staff_id, reason, created_at
           FROM broadcast_approval_events WHERE broadcast_id = ?
       ) ORDER BY created_at DESC, kind ASC LIMIT ? OFFSET ?`,
    )
    .bind(broadcastId, broadcastId, limit + 1, cursor)
    .all<{
      kind: 'lifecycle' | 'approval';
      action: string;
      actor_staff_id: string | null;
      reason: string | null;
      created_at: string;
    }>();
  const page = (rows.results ?? []).slice(0, limit);
  const actorIds = [...new Set(page.map((row) => row.actor_staff_id).filter((id) => id))];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const placeholders = actorIds.map(() => '?').join(', ');
    const staffRows = await db
      .prepare(`SELECT id, name FROM staff_members WHERE id IN (${placeholders})`)
      .bind(...actorIds)
      .all<{ id: string; name: string }>();
    for (const staff of staffRows.results ?? []) names.set(staff.id, staff.name);
  }
  const entries: BroadcastActivityEntry[] = page.map((row) => {
    const label =
      row.kind === 'lifecycle'
        ? (BROADCAST_LIFECYCLE_ACTION_LABELS[row.action as BroadcastLifecycleAction] ?? row.action)
        : (APPROVAL_ACTION_LABELS[row.action] ?? row.action);
    const actorStaffId = row.actor_staff_id || null;
    return {
      kind: row.kind,
      action: row.action,
      label,
      actorStaffId,
      actorName: actorStaffId ? (names.get(actorStaffId) ?? '不明') : '自動',
      reason: row.reason,
      createdAt: row.created_at,
    };
  });
  return {
    entries,
    nextCursor: (rows.results ?? []).length > limit ? String(cursor + limit) : null,
  };
}
