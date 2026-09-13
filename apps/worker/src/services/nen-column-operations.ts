import { jstNow } from '@line-crm/db';

export class NenColumnOperationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'NenColumnOperationError';
  }
}

export async function previewNenColumnAudience(
  db: D1Database,
  input: { lineAccountId: string; targetMode: 'all' | 'tag'; targetTagId: string | null },
) {
  if (input.targetMode === 'tag' && !input.targetTagId) {
    throw new NenColumnOperationError('target_tag_required', '配信対象のタグを選んでください');
  }
  const row = await db.prepare(
    `SELECT COUNT(*) AS count FROM friends f
      WHERE f.line_account_id = ? AND f.is_following = 1
        AND (? != 'tag' OR EXISTS (
          SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?
        ))`,
  ).bind(input.lineAccountId, input.targetMode, input.targetTagId).first<{ count: number }>();
  return { count: Number(row?.count ?? 0), targetMode: input.targetMode, targetTagId: input.targetTagId };
}

export async function duplicateNenColumn(db: D1Database, input: { id: string; lineAccountId: string }) {
  const source = await db.prepare(
    `SELECT title, category, excerpt, intro_text, article_url, image_url, published_at,
            target_mode, target_tag_id, completion_event_name, completion_tag_id
       FROM nen_columns WHERE id = ? AND line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<Record<string, unknown>>();
  if (!source) throw new NenColumnOperationError('column_not_found', 'コラムが見つかりません', 404);
  const id = crypto.randomUUID();
  const now = jstNow();
  const slug = `copy-${input.id}-${id.slice(0, 8)}`;
  await db.prepare(
    `INSERT INTO nen_columns
      (id, external_id, slug, title, category, excerpt, intro_text, article_url, image_url,
       published_at, delivery_status, delivery_at, line_account_id, target_mode, target_tag_id,
       completion_event_name, completion_tag_id, source_column_id, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, slug, `${String(source.title).slice(0, 116)}（複製）`, source.category, source.excerpt, source.intro_text,
    source.article_url, source.image_url, source.published_at, input.lineAccountId,
    source.target_mode, source.target_tag_id, source.completion_event_name, source.completion_tag_id,
    input.id, now, now,
  ).run();
  return { id, sourceColumnId: input.id };
}

export async function recordNenColumnReadEvent(db: D1Database, input: {
  lineAccountId: string; columnId: string; friendId: string;
  eventKind: 'opened' | 'completed'; idempotencyKey: string; occurredAt?: string;
}) {
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
    throw new NenColumnOperationError('idempotency_key_invalid', '読了イベントの識別子を確認してください');
  }
  if (input.occurredAt !== undefined && !Number.isFinite(Date.parse(input.occurredAt))) {
    throw new NenColumnOperationError('occurred_at_invalid', '読了日時を確認してください');
  }
  const target = await db.prepare(
    `SELECT c.completion_tag_id
       FROM nen_columns c JOIN friends f ON f.id = ? AND f.line_account_id = c.line_account_id
      WHERE c.id = ? AND c.line_account_id = ?`,
  ).bind(input.friendId, input.columnId, input.lineAccountId).first<{ completion_tag_id: string | null }>();
  if (!target) throw new NenColumnOperationError('column_or_friend_not_found', 'コラムまたは友だちが見つかりません', 404);
  const now = jstNow();
  const result = await db.prepare(
    `INSERT OR IGNORE INTO nen_column_read_events
      (id, line_account_id, column_id, friend_id, event_kind, idempotency_key, occurred_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.lineAccountId, input.columnId, input.friendId, input.eventKind,
    input.idempotencyKey.trim(), input.occurredAt ?? now, now,
  ).run();
  if (input.eventKind === 'completed' && target.completion_tag_id) {
    await db.prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`,
    ).bind(input.friendId, target.completion_tag_id, now).run();
  }
  return { recorded: (result.meta.changes ?? 0) === 1, tagged: input.eventKind === 'completed' && Boolean(target.completion_tag_id) };
}

export async function sendPendingNenDeliveriesNow(
  db: D1Database,
  input: { lineAccountId: string; expectedCount: number },
) {
  if (!Number.isSafeInteger(input.expectedCount) || input.expectedCount < 0) {
    throw new NenColumnOperationError('expected_count_invalid', '画面に表示された配信待ち件数を確認してください');
  }
  const count = await db.prepare(
    `SELECT COUNT(*) AS count FROM nen_delivery_jobs
      WHERE line_account_id = ? AND status = 'pending' AND datetime(scheduled_at) > datetime('now')`,
  ).bind(input.lineAccountId).first<{ count: number }>();
  const actual = Number(count?.count ?? 0);
  if (actual !== input.expectedCount) {
    throw new NenColumnOperationError('pending_count_changed', '配信待ちの件数が変わりました。読み直してください', 409);
  }
  const now = jstNow();
  const result = await db.prepare(
    `UPDATE nen_delivery_jobs SET scheduled_at = ?, updated_at = ?
      WHERE line_account_id = ? AND status = 'pending' AND datetime(scheduled_at) > datetime('now')`,
  ).bind(now, now, input.lineAccountId).run();
  return { queued: Number(result.meta.changes ?? 0) };
}
