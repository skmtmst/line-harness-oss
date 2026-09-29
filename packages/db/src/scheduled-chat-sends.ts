// N-025 (#927): 1対1トークの送信予約の状態機械を DB で持つ。
// 時系列: scheduled -> sending(lease付きclaim) -> sent / failed / cancelled。
// retryableな失敗はscheduledへ戻し、scheduled_atをずらして再送する。

export const SCHEDULED_CHAT_SEND_MAX_ATTEMPTS = 3;

/** claimしたWorkerが止まった場合に送り直せるようになるまでの時間。 */
export const SCHEDULED_CHAT_SEND_LEASE_MS = 60_000;

export type ScheduledChatSendStatus =
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type ScheduledChatSendRow = {
  id: string;
  friend_id: string;
  line_account_id: string | null;
  staff_id: string;
  message_type: string;
  content: string;
  quoted_message_id: string | null;
  idempotency_key: string;
  /** UTCのISO8601('Z')。due判定の文字列比較が成立するよう正規化して保存する。 */
  scheduled_at: string;
  status: ScheduledChatSendStatus;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  last_error_code: string | null;
  last_error: string | null;
  sent_message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  cancelled_by_staff_id: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 予約時刻の入力をUTCのISO8601('Z')へ正規化する。
 * '+09:00'などオフセット付きのまま保存すると、due判定の文字列比較で
 * 順序が崩れるため、書き込み境界で必ずここを通す。
 */
export function normalizeScheduledAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error('scheduled_at must be an ISO 8601 datetime');
  }
  return new Date(time).toISOString();
}

/**
 * 予約の新規作成。idempotency_keyの一意制約で、同じ作成要求の再送は
 * 新しい行を作らず既存の予約を返す(replay)。
 *
 * さらに「対象(friend×LINEアカウント)・内容(種別・本文・引用)・送信予定時刻」が
 * 一致する処理中(scheduled/sending)の予約があれば、別キーの要求も新しい行を
 * 作らずその既存行を返す(#977)。読み込み直しでクライアントの操作キーが
 * 新規発行されても、同じ版の予約はサーバー側で最大1件に保つ。
 *
 * 挿入は単一の INSERT ... SELECT ... WHERE NOT EXISTS なので、並行する
 * 2要求が同時に走っても後着側は重複を検出して挿入しない(TOCTOUなし)。
 * 終了済み(sent/failed/cancelled)の行は照合対象に含めないため、
 * 同じ内容の予約をあらためて立て直すことはできる。
 */
export async function createScheduledChatSend(
  db: D1Database,
  input: {
    id: string;
    friendId: string;
    lineAccountId: string | null;
    staffId: string;
    messageType: string;
    content: string;
    quotedMessageId: string | null;
    idempotencyKey: string;
    scheduledAt: string;
    now?: string;
  },
): Promise<{ row: ScheduledChatSendRow; created: boolean }> {
  const now = input.now ?? new Date().toISOString();
  const scheduledAt = normalizeScheduledAt(input.scheduledAt);
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO scheduled_chat_sends
         (id, friend_id, line_account_id, staff_id, message_type, content,
          quoted_message_id, idempotency_key, scheduled_at, status,
          attempt_count, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM scheduled_chat_sends
          WHERE friend_id = ?
            AND line_account_id IS ?
            AND message_type = ?
            AND content = ?
            AND quoted_message_id IS ?
            AND scheduled_at = ?
            AND status IN ('scheduled', 'sending')
       )`,
    )
    .bind(
      input.id,
      input.friendId,
      input.lineAccountId,
      input.staffId,
      input.messageType,
      input.content,
      input.quotedMessageId,
      input.idempotencyKey,
      scheduledAt,
      now,
      now,
      input.friendId,
      input.lineAccountId,
      input.messageType,
      input.content,
      input.quotedMessageId,
      scheduledAt,
    )
    .run();
  if ((result.meta?.changes ?? 0) === 1) {
    const row = await getScheduledChatSend(db, input.id);
    if (!row) throw new Error('scheduled send record unavailable');
    return { row, created: true };
  }
  // 同一キーの再送(replay)を先に返す。
  const byKey = await getScheduledChatSendByKey(db, input.idempotencyKey);
  if (byKey) return { row: byKey, created: false };
  // 別キーだが同じ版の処理中予約がある → その行を再利用する。
  const existing = await findInFlightScheduledChatSend(db, {
    friendId: input.friendId,
    lineAccountId: input.lineAccountId,
    messageType: input.messageType,
    content: input.content,
    quotedMessageId: input.quotedMessageId,
    scheduledAt,
  });
  if (!existing) throw new Error('scheduled send record unavailable');
  return { row: existing, created: false };
}

/**
 * 「対象・内容・送信予定時刻」が一致する処理中(scheduled/sending)の予約を1件引く。
 * 並行登録の後着側が再利用する行を探す照合口。複数あれば一番古い行を返す。
 */
export async function findInFlightScheduledChatSend(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId: string | null;
    messageType: string;
    content: string;
    quotedMessageId: string | null;
    scheduledAt: string;
  },
): Promise<ScheduledChatSendRow | null> {
  return db
    .prepare(
      `SELECT * FROM scheduled_chat_sends
        WHERE friend_id = ?
          AND line_account_id IS ?
          AND message_type = ?
          AND content = ?
          AND quoted_message_id IS ?
          AND scheduled_at = ?
          AND status IN ('scheduled', 'sending')
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
    )
    .bind(
      input.friendId,
      input.lineAccountId,
      input.messageType,
      input.content,
      input.quotedMessageId,
      normalizeScheduledAt(input.scheduledAt),
    )
    .first<ScheduledChatSendRow>();
}

export async function getScheduledChatSendByKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<ScheduledChatSendRow | null> {
  return db
    .prepare(`SELECT * FROM scheduled_chat_sends WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<ScheduledChatSendRow>();
}

export async function getScheduledChatSend(
  db: D1Database,
  id: string,
): Promise<ScheduledChatSendRow | null> {
  return db
    .prepare(`SELECT * FROM scheduled_chat_sends WHERE id = ?`)
    .bind(id)
    .first<ScheduledChatSendRow>();
}

/** 会話の待機中・送信中の予約一覧。送信済みや取消済みは出さない。 */
export async function listPendingScheduledChatSends(
  db: D1Database,
  friendId: string,
): Promise<ScheduledChatSendRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM scheduled_chat_sends
        WHERE friend_id = ? AND status IN ('scheduled', 'sending')
        ORDER BY scheduled_at ASC, id ASC`,
    )
    .bind(friendId)
    .all<ScheduledChatSendRow>();
  return result.results;
}

export type ScheduledSendMutationResult = 'updated' | 'not_found' | 'locked';

/**
 * 予約の取消。status='scheduled'の行だけをCASで書き換える。
 * sending以降へ進んだ行は0件更新になり、'locked'を返す。
 */
export async function cancelScheduledChatSend(
  db: D1Database,
  input: { id: string; friendId: string; staffId: string; now?: string },
): Promise<ScheduledSendMutationResult> {
  const now = input.now ?? new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE scheduled_chat_sends
          SET status = 'cancelled',
              cancelled_by_staff_id = ?,
              cancelled_at = ?,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = ?
        WHERE id = ? AND friend_id = ? AND status = 'scheduled'`,
    )
    .bind(input.staffId, now, now, input.id, input.friendId)
    .run();
  if ((result.meta?.changes ?? 0) === 1) return 'updated';
  const row = await getScheduledChatSend(db, input.id);
  return !row || row.friend_id !== input.friendId ? 'not_found' : 'locked';
}

/**
 * 予約時刻・本文の変更。取消と同じくscheduledの行だけCASで書き換える。
 * scheduled_atだけ・contentだけの部分更新も受け付ける。
 */
export async function updateScheduledChatSend(
  db: D1Database,
  input: {
    id: string;
    friendId: string;
    scheduledAt?: string;
    content?: string;
    now?: string;
  },
): Promise<ScheduledSendMutationResult> {
  const now = input.now ?? new Date().toISOString();
  const scheduledAt =
    input.scheduledAt != null ? normalizeScheduledAt(input.scheduledAt) : null;
  const result = await db
    .prepare(
      `UPDATE scheduled_chat_sends
          SET scheduled_at = COALESCE(?, scheduled_at),
              content = COALESCE(?, content),
              updated_at = ?
        WHERE id = ? AND friend_id = ? AND status = 'scheduled'`,
    )
    .bind(scheduledAt, input.content ?? null, now, input.id, input.friendId)
    .run();
  if ((result.meta?.changes ?? 0) === 1) return 'updated';
  const row = await getScheduledChatSend(db, input.id);
  return !row || row.friend_id !== input.friendId ? 'not_found' : 'locked';
}

/**
 * 期限が来た予約をlease付きでsendingへclaimする。
 * 先にlease切れのsendingをscheduledへ戻して滞留を回収してからclaimする。
 */
export async function claimDueScheduledChatSends(
  db: D1Database,
  input: {
    now: string;
    leaseToken: string;
    limit?: number;
    leaseMs?: number;
  },
): Promise<ScheduledChatSendRow[]> {
  const leaseMs = input.leaseMs ?? SCHEDULED_CHAT_SEND_LEASE_MS;
  const limit = input.limit ?? 20;
  const leaseExpiresAt = new Date(
    Date.parse(input.now) + leaseMs,
  ).toISOString();

  // 前のclaimが返ってこなかった分を回収する。
  await db
    .prepare(
      `UPDATE scheduled_chat_sends
          SET status = 'scheduled', lease_token = NULL, lease_expires_at = NULL,
              updated_at = ?
        WHERE status = 'sending' AND lease_expires_at < ?`,
    )
    .bind(input.now, input.now)
    .run();

  const due = await db
    .prepare(
      `SELECT id FROM scheduled_chat_sends
        WHERE status = 'scheduled' AND scheduled_at <= ?
        ORDER BY scheduled_at ASC, id ASC LIMIT ?`,
    )
    .bind(input.now, limit)
    .all<{ id: string }>();

  const claimed: ScheduledChatSendRow[] = [];
  for (const { id } of due.results) {
    const result = await db
      .prepare(
        `UPDATE scheduled_chat_sends
            SET status = 'sending', lease_token = ?, lease_expires_at = ?,
                attempt_count = attempt_count + 1, updated_at = ?
          WHERE id = ? AND status = 'scheduled'`,
      )
      .bind(input.leaseToken, leaseExpiresAt, input.now, id)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) continue;
    const row = await getScheduledChatSend(db, id);
    if (row) claimed.push(row);
  }
  return claimed;
}

/** LINEへ届いた予約をsentへ確定する。claimしたlease持ちだけが通る。 */
export async function markScheduledChatSendSent(
  db: D1Database,
  input: {
    id: string;
    leaseToken: string;
    messageId: string;
    now?: string;
  },
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE scheduled_chat_sends
          SET status = 'sent', sent_message_id = ?, sent_at = ?,
              lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND lease_token = ? AND status = 'sending'`,
    )
    .bind(input.messageId, now, now, input.id, input.leaseToken)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/**
 * 送信失敗の記録。retryableなら予定をずらしてscheduledへ戻し、
 * 恒久的ならfailedへ確定する。claimしたlease持ちだけが通る。
 */
export async function markScheduledChatSendFailed(
  db: D1Database,
  input: {
    id: string;
    leaseToken: string;
    errorCode: string;
    error: string;
    retryable: boolean;
    nextScheduledAt?: string;
    now?: string;
  },
): Promise<boolean> {
  const now = input.now ?? new Date().toISOString();
  if (input.retryable) {
    const nextAt = input.nextScheduledAt
      ? normalizeScheduledAt(input.nextScheduledAt)
      : input.now ?? new Date().toISOString();
    const result = await db
      .prepare(
        `UPDATE scheduled_chat_sends
            SET status = 'scheduled', scheduled_at = ?,
                last_error_code = ?, last_error = ?,
                lease_token = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND lease_token = ? AND status = 'sending'`,
      )
      .bind(nextAt, input.errorCode, input.error, now, input.id, input.leaseToken)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }
  const result = await db
    .prepare(
      `UPDATE scheduled_chat_sends
          SET status = 'failed', failed_at = ?,
              last_error_code = ?, last_error = ?,
              lease_token = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND lease_token = ? AND status = 'sending'`,
    )
    .bind(now, input.errorCode, input.error, now, input.id, input.leaseToken)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}
