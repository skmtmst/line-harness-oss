import { jstNow } from './utils.js';
import { validateFriendFieldValue } from './friend-fields.js';
import type { FriendFieldScope, FriendFieldType, FriendFieldUsageTarget } from './friend-fields.js';

export type FieldMigrationItemStatus = 'convertible' | 'review' | 'invalid' | 'succeeded' | 'failed';

export interface FieldMigrationPreviewItem {
  friendId: string;
  sourceValue: string;
  convertedValue: string | null;
  status: 'convertible' | 'review' | 'invalid';
  reason: string | null;
}

export interface FieldMigrationRun {
  id: string;
  tenant_id: string;
  line_account_id: string;
  source_field_id: string;
  target_field_id: string;
  source_version: number;
  target_version: number;
  preview_token_hash: string;
  preview_snapshot_hash: string;
  preview_expires_at: string;
  idempotency_key: string | null;
  status: 'previewed' | 'queued' | 'running' | 'partial' | 'succeeded' | 'failed' | 'stale';
  usage_targets_json: string;
  total_count: number;
  convertible_count: number;
  review_count: number;
  invalid_count: number;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  error_message: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  rollback_deadline: string | null;
  updated_at: string;
}

export interface FieldMigrationItem {
  run_id: string;
  friend_id: string;
  source_value: string;
  converted_value: string | null;
  status: FieldMigrationItemStatus;
  reason: string | null;
  migrated_at: string | null;
}

const countStatus = (items: FieldMigrationPreviewItem[], status: FieldMigrationPreviewItem['status']) =>
  items.filter((item) => item.status === status).length;

export async function createFieldMigrationPreview(
  db: D1Database,
  input: {
    runId: string;
    scope: FriendFieldScope;
    sourceFieldId: string;
    targetFieldId: string;
    sourceVersion: number;
    targetVersion: number;
    previewTokenHash: string;
    snapshotHash: string;
    expiresAt: string;
    usageTargets: FriendFieldUsageTarget[];
    items: FieldMigrationPreviewItem[];
    createdBy: string;
  },
): Promise<void> {
  const now = jstNow();
  await db.prepare(
    `INSERT INTO field_migration_runs
       (id, tenant_id, line_account_id, source_field_id, target_field_id,
        source_version, target_version, preview_token_hash, preview_snapshot_hash,
        preview_expires_at, status, usage_targets_json, total_count, convertible_count,
        review_count, invalid_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'previewed', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.runId,
    input.scope.tenantId,
    input.scope.lineAccountId,
    input.sourceFieldId,
    input.targetFieldId,
    input.sourceVersion,
    input.targetVersion,
    input.previewTokenHash,
    input.snapshotHash,
    input.expiresAt,
    JSON.stringify(input.usageTargets),
    input.items.length,
    countStatus(input.items, 'convertible'),
    countStatus(input.items, 'review'),
    countStatus(input.items, 'invalid'),
    input.createdBy,
    now,
    now,
  ).run();

  /*
   * D038: 項目の書き込みで失敗したら run だけを残さない。
   * run だけ残ると誰も使わない記録がたまるため、片付けてから投げ直す。
   */
  try {
    for (let offset = 0; offset < input.items.length; offset += 80) {
      await db.batch(input.items.slice(offset, offset + 80).map((item) => db.prepare(
        `INSERT INTO field_migration_items
           (run_id, friend_id, source_value, converted_value, status, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(input.runId, item.friendId, item.sourceValue, item.convertedValue, item.status, item.reason)));
    }
  } catch (err) {
    await db.batch([
      db.prepare(`DELETE FROM field_migration_items WHERE run_id = ?`).bind(input.runId),
      db.prepare(`DELETE FROM field_migration_runs WHERE id = ?`).bind(input.runId),
    ]).catch(() => undefined);
    throw err;
  }
}

export async function getFieldMigrationRun(
  db: D1Database,
  runId: string,
  scope: FriendFieldScope,
): Promise<FieldMigrationRun | null> {
  return db.prepare(
    `SELECT * FROM field_migration_runs
      WHERE id = ? AND tenant_id = ? AND line_account_id = ?`,
  ).bind(runId, scope.tenantId, scope.lineAccountId).first<FieldMigrationRun>();
}

export async function getFieldMigrationRunByToken(
  db: D1Database,
  previewTokenHash: string,
  scope: FriendFieldScope,
): Promise<FieldMigrationRun | null> {
  return db.prepare(
    `SELECT * FROM field_migration_runs
      WHERE preview_token_hash = ? AND tenant_id = ? AND line_account_id = ?`,
  ).bind(previewTokenHash, scope.tenantId, scope.lineAccountId).first<FieldMigrationRun>();
}

export async function getFieldMigrationRunByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
  scope: FriendFieldScope,
): Promise<FieldMigrationRun | null> {
  return db.prepare(
    `SELECT * FROM field_migration_runs
      WHERE idempotency_key = ? AND tenant_id = ? AND line_account_id = ?`,
  ).bind(idempotencyKey, scope.tenantId, scope.lineAccountId).first<FieldMigrationRun>();
}

export async function getFieldMigrationItems(
  db: D1Database,
  runId: string,
  limit = 100,
): Promise<FieldMigrationItem[]> {
  const result = await db.prepare(
    `SELECT * FROM field_migration_items
      WHERE run_id = ? AND status != 'convertible'
      ORDER BY friend_id ASC LIMIT ?`,
  ).bind(runId, limit).all<FieldMigrationItem>();
  return result.results;
}

export async function queueFieldMigration(
  db: D1Database,
  runId: string,
  idempotencyKey: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE field_migration_runs
        SET idempotency_key = ?, status = 'queued', updated_at = ?
      WHERE id = ? AND status = 'previewed'`,
  ).bind(idempotencyKey, jstNow(), runId).run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function markFieldMigrationStale(db: D1Database, runId: string): Promise<void> {
  await db.prepare(
    `UPDATE field_migration_runs
        SET status = 'stale', error_message = ?, updated_at = ? WHERE id = ?`,
  ).bind('プレビュー後に対象データまたは定義が変わりました', jstNow(), runId).run();
}

function typedColumns(type: FriendFieldType, value: string): {
  text: string | null; number: number | null; date: string | null; datetime: string | null;
  json: string | null; mediaId: string | null;
} {
  const empty = { text: null, number: null, date: null, datetime: null, json: null, mediaId: null };
  if (type === 'number') return { ...empty, number: Number(value) };
  if (type === 'date') return { ...empty, date: value };
  if (type === 'datetime') return { ...empty, datetime: value };
  if (type === 'multi_select') return { ...empty, json: value };
  if (type === 'image' || type === 'pdf') return { ...empty, mediaId: value };
  return { ...empty, text: value };
}

/** キュー済みの移行を実行する。元値は30日残し、変換不能行は行別に保持する。 */
export async function executeFieldMigration(
  db: D1Database,
  runId: string,
  targetType: FriendFieldType,
  updatedBy: string,
): Promise<void> {
  const startedAt = jstNow();
  await db.prepare(
    `UPDATE field_migration_runs SET status = 'running', started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'queued'`,
  ).bind(startedAt, startedAt, runId).run();
  const result = await db.prepare(
    `SELECT * FROM field_migration_items WHERE run_id = ? AND status = 'convertible' ORDER BY friend_id`,
  ).bind(runId).all<FieldMigrationItem>();
  const run = await db.prepare(`SELECT * FROM field_migration_runs WHERE id = ?`).bind(runId).first<FieldMigrationRun>();
  if (!run) return;
  const target = await db.prepare(
    `SELECT COALESCE(type_v8, type_v6, type) AS resolved_type, options_json
       FROM friend_fields WHERE id = ?`,
  ).bind(run.target_field_id).first<{ resolved_type: string; options_json: string | null }>();
  const failItem = async (friendId: string, reason: string) => {
    await db.prepare(
      `UPDATE field_migration_items SET status = 'failed', reason = ?
        WHERE run_id = ? AND friend_id = ?`,
    ).bind(reason.slice(0, 300), runId, friendId).run();
  };
  for (const item of result.results) {
    // N-042: 変換済みでも保存前に同じ検証へ通す。通らない値は書かず失敗に倒す。
    const checked = validateFriendFieldValue(
      { type: target?.resolved_type ?? '', options_json: target?.options_json ?? null },
      item.converted_value,
    );
    if (!checked.ok || checked.value === null) {
      await failItem(item.friend_id, checked.ok ? '変換結果が空になりました' : checked.error);
      continue;
    }
    try {
      const converted = checked.value;
      const typed = typedColumns(targetType, converted);
      const now = jstNow();
      await db.batch([
        db.prepare(
          `INSERT INTO friend_field_values
             (friend_id, field_id, value, value_text, value_number, value_date, value_datetime,
              value_json, media_id, source_type, source_id, updated_by, updated_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'field_migration', ?, ?, ?, 1)
           ON CONFLICT(friend_id, field_id) DO UPDATE SET
             value = excluded.value, value_text = excluded.value_text,
             value_number = excluded.value_number, value_date = excluded.value_date,
             value_datetime = excluded.value_datetime, value_json = excluded.value_json,
             media_id = excluded.media_id, source_type = excluded.source_type,
             source_id = excluded.source_id, updated_by = excluded.updated_by,
             updated_at = excluded.updated_at, version = friend_field_values.version + 1`,
        ).bind(
          item.friend_id, run.target_field_id, converted, typed.text, typed.number, typed.date,
          typed.datetime, typed.json, typed.mediaId, runId, updatedBy, now,
        ),
        db.prepare(
          `UPDATE field_migration_items
              SET status = 'succeeded', migrated_at = ?, reason = NULL
            WHERE run_id = ? AND friend_id = ?`,
        ).bind(now, runId, item.friend_id),
      ]);
    } catch (error) {
      await db.prepare(
        `UPDATE field_migration_items SET status = 'failed', reason = ?
          WHERE run_id = ? AND friend_id = ?`,
      ).bind(error instanceof Error ? error.message.slice(0, 300) : '保存に失敗しました', runId, item.friend_id).run();
    }
  }
  /*
   * D036: 件数は手元の数えではなく表から数え直す。止まった実行を
   * 続けたときも、今ある行の状態で正しく締められる。
   */
  const tallied = await db.prepare(
    `SELECT status, COUNT(*) AS n FROM field_migration_items WHERE run_id = ? GROUP BY status`,
  ).bind(runId).all<{ status: string; n: number }>();
  const countOf = (status: string) =>
    Number(tallied.results.find((row) => row.status === status)?.n ?? 0);
  const succeeded = countOf('succeeded');
  const failed = countOf('failed');
  const remaining = countOf('convertible');
  const completedAt = jstNow();
  const rollbackDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const unresolved = run.review_count + run.invalid_count + failed + remaining;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE field_migration_runs SET status = ?, processed_count = ?, succeeded_count = ?,
         failed_count = ?, completed_at = ?, rollback_deadline = ?, updated_at = ? WHERE id = ?`,
    ).bind(unresolved > 0 ? 'partial' : 'succeeded', succeeded + failed, succeeded, unresolved,
      completedAt, rollbackDeadline, completedAt, runId),
  ];
  if (unresolved === 0) {
    statements.push(db.prepare(
      `UPDATE friend_fields SET status = 'read_only', version = version + 1, updated_at = ? WHERE id = ?`,
    ).bind(completedAt, run.source_field_id));
    /*
     * D037: 事前確認で「移行時に切り替え」と約束した使用先だけを切り替える。
     * リマインダと下書きフォームは移行先を指す。公開版と手動確認の分は触らない。
     * 全部移せたときだけ行い、残りがあるときは有効な元の項目に置いたままにする。
     */
    const promised = parseUsageTargets(run.usage_targets_json);
    const reminderIds = promised
      .filter((target) => target.switchable && target.kind === 'reminder')
      .map((target) => target.id);
    // 固定4 bindを引いた96件ずつ。全chunkは最終化と同じbatchに置く。
    for (let offset = 0; offset < reminderIds.length; offset += 96) {
      const chunk = reminderIds.slice(offset, offset + 96);
      statements.push(db.prepare(
        `UPDATE reminders SET trigger_field_id = ?, updated_at = ?
          WHERE line_account_id = ? AND trigger_field_id = ?
            AND id IN (${chunk.map(() => '?').join(', ')})`,
      ).bind(run.target_field_id, completedAt, run.line_account_id, run.source_field_id, ...chunk));
    }
    const formIds = promised
      .filter((target) => target.switchable && target.kind === 'form')
      .map((target) => target.id);
    for (let offset = 0; offset < formIds.length; offset += 100) {
      const chunk = formIds.slice(offset, offset + 100);
      const drafts = await db.prepare(
        `SELECT f.id, f.fields FROM forms f WHERE f.id IN (${chunk.map(() => '?').join(', ')})`,
      ).bind(...chunk).all<{ id: string; fields: string }>();
      for (const draft of drafts.results) {
        const switched = switchDraftFormFields(draft.fields, run.source_field_id, run.target_field_id);
        if (switched) {
          statements.push(db.prepare(
            `UPDATE forms SET fields = ?, updated_at = ? WHERE id = ?`,
          ).bind(switched, completedAt, draft.id));
        }
      }
    }
  }
  await db.batch(statements);
}

/** runに残した使用先の一覧を読む。壊れていても空として続ける。 */
function parseUsageTargets(raw: string | null): FriendFieldUsageTarget[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FriendFieldUsageTarget[]) : [];
  } catch {
    return [];
  }
}

/**
 * 下書きフォームの項目の登録先を移行元から移行先へ付け替える。
 * 変わらなければ null（壊れた定義は触らず残す）。
 */
function switchDraftFormFields(raw: string | null, sourceFieldId: string, targetFieldId: string): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  let changed = false;
  for (const field of parsed) {
    if (field && typeof field === 'object'
      && (field as { friendFieldId?: unknown }).friendFieldId === sourceFieldId) {
      (field as { friendFieldId?: unknown }).friendFieldId = targetFieldId;
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : null;
}
