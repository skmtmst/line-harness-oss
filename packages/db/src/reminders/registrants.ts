import { snapshotReminderTemplateVersions } from '../reminder-template-snapshot.js';
import { jstNow } from '../utils.js';
import { type V6WriteGuard, type FriendReminderRow, type ReminderRowScope, type ReminderRegistrantRow, type ReminderRegistrantMutation, type ResumeExpectedRun } from './types.js';
import { getReminderById, reminderRowScopePredicate } from './definitions.js';
import { ensureReminderPublishedVersion, getReminderVersionSteps } from './versions.js';
import { chunkPlaceholders } from './source-changes.js';


export async function enrollFriendInReminder(
  db: D1Database,
  input: {
    friendId: string;
    reminderId: string;
    targetDate: string;
    sourceKind?: string;
    sourceId?: string | null;
    sourceEventId?: string | null;
    timezone?: string;
    /** 指定時は親の版が動いていたら書かず V6_WRITE_GUARDED を投げる。 */
    writeGuard?: V6WriteGuard;
  },
): Promise<FriendReminderRow> {
  // 起点日は日付として読める値だけ。空欄や存在しない日の登録予定は、
  // 届くものが無いまま残るだけなので入口で止める。フォーム回答の
  // 'YYYY-MM-DD' と、既存の友だち情報起点が渡す日時文字列の両方を
  // 受け付ける（日付だけの形は Date が翌月へ丸めるため、分解して見る）。
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.targetDate);
  if (dateOnly) {
    const parsed = new Date(`${input.targetDate}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== Number(dateOnly[1]) ||
      parsed.getUTCMonth() + 1 !== Number(dateOnly[2]) ||
      parsed.getUTCDate() !== Number(dateOnly[3])
    ) {
      throw new Error('REMINDER_INVALID_TARGET_DATE');
    }
  } else if (
    !input.targetDate ||
    Number.isNaN(new Date(input.targetDate).getTime())
  ) {
    throw new Error('REMINDER_INVALID_TARGET_DATE');
  }
  const reminder = await getReminderById(db, input.reminderId);
  if (!reminder || reminder.lifecycle_status !== 'published') {
    throw new Error('REMINDER_NOT_PUBLISHED');
  }
  // 友だちとルールの所属が両方分かる不一致は書かずに落とす (別店舗への混入防止)。
  // 片方が未所属のときは運用者の明示選択として許す (所属不明は配信側で止める)。
  const friendAccount = await db.prepare(
    `SELECT line_account_id FROM friends WHERE id = ?`,
  ).bind(input.friendId).first<{ line_account_id: string | null }>();
  const ruleAccount = reminder.line_account_id ?? null;
  const friendAcc = friendAccount?.line_account_id ?? null;
  if (ruleAccount !== null && friendAcc !== null && ruleAccount !== friendAcc) {
    throw new Error('REMINDER_ACCOUNT_MISMATCH');
  }
  const versionId = await ensureReminderPublishedVersion(db, reminder);
  const id = crypto.randomUUID();
  const now = jstNow();
  // R346: この登録が使うテンプレートの公開版を写す。新しい版にするのは
  // 登録し直した時だけ。版履歴に無い分は送るときに今の版を読む。
  const versionSteps = await getReminderVersionSteps(db, versionId);
  const templateSnapshot = await snapshotReminderTemplateVersions(
    db,
    versionSteps.map((step) => step.template_id),
  );
  const guard = input.writeGuard;
  const inserted = await db.prepare(
    guard
      ? `INSERT INTO friend_reminders
           (id, friend_id, reminder_id, reminder_version_id, template_version_snapshot, target_date,
            source_kind, source_id, source_event_id, timezone, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`
      : `INSERT INTO friend_reminders
           (id, friend_id, reminder_id, reminder_version_id, template_version_snapshot, target_date,
            source_kind, source_id, source_event_id, timezone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    input.friendId,
    input.reminderId,
    versionId,
    templateSnapshot,
    input.targetDate,
    input.sourceKind ?? 'manual',
    input.sourceId ?? null,
    input.sourceEventId ?? null,
    input.timezone ?? 'Asia/Tokyo',
    now,
    now,
    ...(guard ? guard.binds : []),
  ).run();
  // ガードで止められたら書いていない。呼び出し側は stale として扱う。
  if (guard && Number(inserted.meta?.changes ?? 0) === 0) {
    throw new Error('V6_WRITE_GUARDED');
  }
  return (await db.prepare(`SELECT * FROM friend_reminders WHERE id = ?`).bind(id).first<FriendReminderRow>())!;
}

export async function getFriendReminders(db: D1Database, friendId: string): Promise<FriendReminderRow[]> {
  const result = await db.prepare(`SELECT * FROM friend_reminders WHERE friend_id = ? ORDER BY target_date ASC`)
    .bind(friendId).all<FriendReminderRow>();
  return result.results;
}

/**
 * R348: リマインダの登録者一覧。親ルールの今の所属ではなく、友だちの
 * 所属（＝送信元アカウント）が見える担当に出す。所属を変えても旧登録が
 * 一覧から消えず、取消・日時変更の対象に残る。担当外の友だちの行は出さない。
 * scope 未指定の内部呼び出しは従来どおり親子の所属一致だけを通す。
 */
export async function listReminderRegistrants(
  db: D1Database,
  reminderId: string,
  scope?: ReminderRowScope,
): Promise<ReminderRegistrantRow[]> {
  const bindings: unknown[] = [reminderId];
  const scopePredicate = reminderRowScopePredicate('f.line_account_id', scope, bindings);
  const predicate = scopePredicate ?? '(r.line_account_id IS NULL OR f.line_account_id IS NULL OR r.line_account_id = f.line_account_id)';
  const result = await db.prepare(
    `SELECT fr.*, f.display_name AS friend_name, f.line_account_id AS friend_line_account_id
       FROM friend_reminders fr
       JOIN friends f ON f.id = fr.friend_id
       JOIN reminders r ON r.id = fr.reminder_id
      WHERE fr.reminder_id = ?
        AND ${predicate}
      ORDER BY fr.target_date ASC, fr.created_at ASC, fr.id ASC`,
  ).bind(...bindings).all<ReminderRegistrantRow>();
  return result.results;
}

/**
 * R348: 一覧操作の対象行を、友だちの所属が見える担当にだけ読む。
 * scope 未指定の内部呼び出しは従来どおり親子の所属一致だけを通す。
 */
export async function getReminderRegistrantById(
  db: D1Database,
  reminderId: string,
  enrollmentId: string,
  scope?: ReminderRowScope,
): Promise<FriendReminderRow | null> {
  const bindings: unknown[] = [enrollmentId, reminderId];
  const scopePredicate = reminderRowScopePredicate('f.line_account_id', scope, bindings);
  const predicate = scopePredicate ?? '(r.line_account_id IS NULL OR f.line_account_id IS NULL OR r.line_account_id = f.line_account_id)';
  return db.prepare(
    `SELECT fr.*
       FROM friend_reminders fr
       JOIN friends f ON f.id = fr.friend_id
       JOIN reminders r ON r.id = fr.reminder_id
      WHERE fr.id = ? AND fr.reminder_id = ?
        AND ${predicate}`,
  ).bind(...bindings).first<FriendReminderRow>();
}

export function replayOrConflict(
  row: FriendReminderRow | null,
  expectedLockVersion: number,
  expectedStatus: string,
  expectedTargetDate?: string,
): ReminderRegistrantMutation {
  if (!row) return { state: 'not_found' };
  // 同じ操作の応答だけ失った場合は、直後の版（+1）だけを replay とする。
  // さらに別の操作が入った行を古い画面が成功扱いにすることはない。
  const isExpected = row.status === expectedStatus
    && (expectedTargetDate === undefined || row.target_date === expectedTargetDate)
    && (row.lock_version === expectedLockVersion || row.lock_version === expectedLockVersion + 1);
  return isExpected ? { state: 'replayed', row } : { state: 'conflict' };
}

/**
 * 基準日を変える。送信済み履歴は残し、旧基準日の未送信実行だけを同じ batch で止める。
 * 次の cron は保存済み reminder_version_id と未送信履歴から新しい予定だけを作り直す。
 */
export async function moveReminderRegistrantTargetDate(
  db: D1Database,
  input: { reminderId: string; enrollmentId: string; targetDate: string; expectedLockVersion: number; now?: string; scope?: ReminderRowScope },
): Promise<ReminderRegistrantMutation> {
  const current = await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope);
  if (!current) return { state: 'not_found' };
  if (current.status !== 'active' || current.lock_version !== input.expectedLockVersion || current.target_date === input.targetDate) {
    return replayOrConflict(current, input.expectedLockVersion, 'active', input.targetDate);
  }
  const now = input.now ?? jstNow();
  const results = await db.batch([
    db.prepare(
      `UPDATE friend_reminders
          SET target_date = ?, updated_at = ?, lock_version = lock_version + 1
        WHERE id = ? AND reminder_id = ? AND status = 'active' AND lock_version = ?`,
    ).bind(input.targetDate, now, input.enrollmentId, input.reminderId, input.expectedLockVersion),
    db.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'cancelled', completed_at = ?, updated_at = ?
        WHERE friend_reminder_id = ?
          AND status IN ('queued', 'retry_wait', 'claimed')
          AND EXISTS (
            SELECT 1 FROM friend_reminders fr
             WHERE fr.id = reminder_delivery_runs.friend_reminder_id
               AND fr.reminder_id = ? AND fr.status = 'active'
               AND fr.target_date = ? AND fr.lock_version = ?
          )`,
    ).bind(now, now, input.enrollmentId, input.reminderId, input.targetDate, input.expectedLockVersion + 1),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    return replayOrConflict(
      await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope),
      input.expectedLockVersion,
      'active',
      input.targetDate,
    );
  }
  return { state: 'updated', row: (await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope))! };
}

/** 手動取消。外部送信済み・送信履歴は消さず、未送信の実行だけを止める。 */
export async function cancelReminderRegistrant(
  db: D1Database,
  input: { reminderId: string; enrollmentId: string; expectedLockVersion: number; cancelReason: string; now?: string; scope?: ReminderRowScope },
): Promise<ReminderRegistrantMutation> {
  const current = await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope);
  if (!current) return { state: 'not_found' };
  if (current.status !== 'active' || current.lock_version !== input.expectedLockVersion) {
    return replayOrConflict(current, input.expectedLockVersion, 'cancelled');
  }
  const now = input.now ?? jstNow();
  const results = await db.batch([
    db.prepare(
      `UPDATE friend_reminders
          SET status = 'cancelled', cancel_reason = ?, updated_at = ?, lock_version = lock_version + 1
        WHERE id = ? AND reminder_id = ? AND status = 'active' AND lock_version = ?`,
    ).bind(input.cancelReason, now, input.enrollmentId, input.reminderId, input.expectedLockVersion),
    db.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'cancelled', completed_at = ?, updated_at = ?
        WHERE friend_reminder_id = ?
          AND status IN ('queued', 'retry_wait', 'claimed')
          AND EXISTS (
            SELECT 1 FROM friend_reminders fr
             WHERE fr.id = reminder_delivery_runs.friend_reminder_id
               AND fr.reminder_id = ? AND fr.status = 'cancelled'
               AND fr.lock_version = ?
          )`,
    ).bind(now, now, input.enrollmentId, input.reminderId, input.expectedLockVersion + 1),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    return replayOrConflict(await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope), input.expectedLockVersion, 'cancelled');
  }
  return { state: 'updated', row: (await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope))! };
}

/**
 * R341: 再開で取消の記録を外して予定を作り直す。
 *
 * 取消時に止めた未来の実行行は cancelled のまま残り、一意制約が新しい
 * 行の作成を塞ぐ。そのままでは再開後に送られない。未来の予定時刻に
 * 対応する cancelled 行だけ queued へ戻し、行が無い通は新しく作る。
 * 送信ずみ・過去時刻の通には触らない (再送・遅延 blast を起こさない)。
 */
export async function reopenCancelledDeliveryRuns(
  db: D1Database,
  input: {
    friendReminderId: string;
    reminderId: string;
    friendId: string;
    lineAccountId: string | null;
    runs: ResumeExpectedRun[];
    now: string;
  },
): Promise<{ reopened: number; created: number }> {
  let reopened = 0;
  let created = 0;
  const statements: D1PreparedStatement[] = [];
  for (const run of input.runs) {
    const existing = await db.prepare(
      `SELECT id, status FROM reminder_delivery_runs
        WHERE friend_reminder_id = ? AND reminder_step_id = ? AND scheduled_at = ?`,
    ).bind(input.friendReminderId, run.reminderStepId, run.scheduledAt)
      .all<{ id: string; status: string }>();
    const rows = existing.results ?? [];
    if (rows.some((row) => row.status !== 'cancelled')) continue;
    const cancelled = rows.filter((row) => row.status === 'cancelled');
    if (cancelled.length > 0) {
      const placeholders = chunkPlaceholders(cancelled.map((row) => row.id));
      statements.push(
        db.prepare(
          `UPDATE reminder_delivery_runs
              SET status = 'queued', completed_at = NULL,
                  lease_expires_at = NULL, next_retry_at = NULL,
                  retry_cycle_attempt_count = 0,
                  last_error_code = NULL, last_error_message = NULL,
                  updated_at = ?
            WHERE id IN (${placeholders}) AND status = 'cancelled'`,
        ).bind(input.now, ...cancelled.map((row) => row.id)),
      );
      reopened += cancelled.length;
    } else {
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO reminder_delivery_runs
             (id, line_account_id, reminder_id, friend_reminder_id, friend_id,
              reminder_step_id, scheduled_at, idempotency_key, line_retry_key,
              status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          input.lineAccountId,
          input.reminderId,
          input.friendReminderId,
          input.friendId,
          run.reminderStepId,
          run.scheduledAt,
          crypto.randomUUID(),
          crypto.randomUUID(),
          input.now,
          input.now,
        ),
      );
      created += 1;
    }
  }
  if (statements.length > 0) await db.batch(statements);
  return { reopened, created };
}

/**
 * 取消済み登録を再開する。未送信の未来予定は expectedRuns から作り直す
 * (R341)。保存済み版と送信済み履歴には触れない。
 */
export async function resumeReminderRegistrant(
  db: D1Database,
  input: {
    reminderId: string;
    enrollmentId: string;
    expectedLockVersion: number;
    now?: string;
    /** 再開後に送るべき未来の通。未指定なら登録の有効化だけ行う。 */
    expectedRuns?: ResumeExpectedRun[];
    scope?: ReminderRowScope;
  },
): Promise<ReminderRegistrantMutation> {
  const current = await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope);
  if (!current) return { state: 'not_found' };
  if (current.status !== 'cancelled' || current.lock_version !== input.expectedLockVersion) {
    return replayOrConflict(current, input.expectedLockVersion, 'active');
  }
  const now = input.now ?? jstNow();
  // 予定の作り直しを先に行う。登録が cancelled の間の queued 行は
  // runner が拾わないため、この順序でも送信は起きない。登録の有効化が
  // 失敗しても再開の再試行で回復できる。
  if (input.expectedRuns && input.expectedRuns.length > 0) {
    const friend = await db.prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
      .bind(current.friend_id).first<{ line_account_id: string | null }>();
    await reopenCancelledDeliveryRuns(db, {
      friendReminderId: input.enrollmentId,
      reminderId: input.reminderId,
      friendId: current.friend_id,
      lineAccountId: friend?.line_account_id ?? null,
      runs: input.expectedRuns,
      now,
    });
  }
  const result = await db.prepare(
    `UPDATE friend_reminders
        SET status = 'active', cancel_reason = NULL, completed_at = NULL, updated_at = ?, lock_version = lock_version + 1
      WHERE id = ? AND reminder_id = ? AND status = 'cancelled' AND lock_version = ?`,
  ).bind(now, input.enrollmentId, input.reminderId, input.expectedLockVersion).run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    return replayOrConflict(await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope), input.expectedLockVersion, 'active');
  }
  return { state: 'updated', row: (await getReminderRegistrantById(db, input.reminderId, input.enrollmentId, input.scope))! };
}

export async function cancelFriendReminder(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE friend_reminders SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .bind(jstNow(), id).run();
}

/**
 * 外部送信直前の再確認用: 登録が active のままかを見る。
 *
 * 取消と配信 cron が競合すると、claimed 済みの実行行が残る。送る直前に
 * ここで active を確かめ、取消済みなら送らず実行行を止める。
 */
export async function getFriendReminderStatus(
  db: D1Database,
  id: string,
): Promise<string | null> {
  const row = await db.prepare(`SELECT status FROM friend_reminders WHERE id = ?`)
    .bind(id).first<{ status: string }>();
  return row?.status ?? null;
}
