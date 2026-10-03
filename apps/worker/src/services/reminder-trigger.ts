/**
 * リマインダを自動で登録する。
 *
 * これまで対象の登録は POST /api/reminders/:id/enroll/:friendId の手動だけで、
 * 「予約の前日に送る」を表すには、予約が入るたびに人が登録する必要があった。
 *
 * 送る時刻そのものは reminder_steps.offset_minutes が持っている。ここで決めるのは
 * その起点（friend_reminders.target_date）だけ。二重に時間の計算を持たせると、
 * どちらが効いているのか読めなくなる。
 */

import {
  cancelV6RemindersForSource,
  enrollFriendInReminder,
  getReminderPublishedVersion,
  getReminderVersionById,
  parseReminderVersionSettings,
  rescheduleV6RemindersForSource,
  type CancelV6RemindersResult,
  type RescheduleV6RemindersResult,
  type V6WriteGuard,
} from '@line-crm/db';
import { matchesCondition, parseCondition } from './segment-query.js';

export type ReminderTriggerType = 'manual' | 'booking' | 'event';

export interface ReminderTriggerRow {
  id: string;
  trigger_type: string;
  trigger_offset_minutes: number | null;
  send_at_time: string | null;
  target_tag_id: string | null;
  /** 418: イベント起点を特定イベントへ絞る列。NULL は全イベント対象。 */
  trigger_event_id: string | null;
  current_published_version_id: string | null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 公開版の対象条件を読む。無い・読めないときは null を返す。
 *
 * 読めない条件で登録を止めると、壊れた1件のためにそのリマインダ全体が
 * 黙って止まる。保存時に組み立て検査を通しているので、ここでは
 * 「無いもの」として従来どおり登録する。数え直し・公開前検査は
 * 別口で壊れた条件を止める。
 */
export async function getReminderTargetCondition(
  db: D1Database,
  reminderId: string,
): Promise<ReturnType<typeof parseCondition>> {
  try {
    const published = await getReminderPublishedVersion(db, reminderId);
    if (!published) return null;
    const settings = parseReminderVersionSettings(published);
    const raw = settings.targetCondition;
    if (!raw || typeof raw !== 'object') return null;
    return parseCondition(JSON.stringify(raw));
  } catch {
    return null;
  }
}

/**
 * 公開版の対象条件に友だちが当てはまるか。
 *
 * 条件が無いときは true (従来どおり登録する)。組み立て・判定で
 * 例外が出たときは false にしてその1件だけ登録しない。例外を
 * 投げると、その予約に結びつく全リマインダの登録が止まる。
 * 予約そのものは呼び出し側が続ける。
 */
export async function matchesReminderTargetCondition(
  db: D1Database,
  reminderId: string,
  friendId: string,
): Promise<boolean> {
  const condition = await getReminderTargetCondition(db, reminderId);
  if (!condition) return true;
  try {
    return await matchesCondition(db, friendId, condition);
  } catch (err) {
    console.error(`[reminder-trigger] target condition failed for reminder ${reminderId}`, err);
    return false;
  }
}

/**
 * 起点の時刻を決める。
 *
 * 1. 予約・イベントの開始時刻を基準にする
 * 2. trigger_offset_minutes があればずらす（施術後の追客なら終了時刻へ寄せる、など）
 * 3. send_at_time があれば、その日のその時刻に合わせる
 *
 * 3 を入れているのは、「前日の18時に送る」が予約時刻に左右されないようにするため。
 * これが無いと、10時の予約は前日10時、20時の予約は前日20時に届き、
 * 送る側からは何時に届くのか読めない。
 *
 * 日付は JST で見る。UTC で日付を切ると、日本の朝9時より前が前日になる。
 */
export function resolveAnchor(rule: ReminderTriggerRow, startsAtIso: string): string | null {
  const start = new Date(startsAtIso);
  if (Number.isNaN(start.getTime())) return null;

  const shifted = new Date(start.getTime() + (rule.trigger_offset_minutes ?? 0) * 60_000);
  if (!rule.send_at_time) return shifted.toISOString();

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(rule.send_at_time);
  // 壊れた時刻はずらさずに使う。設定が読めないからといって送らない、では
  // リマインダそのものが黙って消える。
  if (!match) return shifted.toISOString();

  const jst = new Date(shifted.getTime() + JST_OFFSET_MS);
  jst.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);
  return new Date(jst.getTime() - JST_OFFSET_MS).toISOString();
}

/**
 * このきっかけで動くリマインダを探して、友だちを登録する。
 *
 * 同じ発生元 (source_kind + source_id + source_event_id) の行が
 * friend + reminder + target_date で既に active なら何もしない。
 * 予約の状態が何度か変わっても、そのたびに登録が増えないようにするため。
 * 同時刻の別予約は発生元が違うため別行で共存する。
 *
 * 失敗しても呼び出し側は止めない。リマインダが登録できなかったからといって
 * 予約そのものを失敗させるのは筋が違う。
 */
export async function enrollByTrigger(
  db: D1Database,
  input: {
    triggerType: Exclude<ReminderTriggerType, 'manual'>;
    friendId: string;
    startsAtIso: string;
    sourceId?: string | null;
    sourceEventId?: string | null;
    /** 追跡用の発生元区分。未指定なら triggerType (個別相談は 'meet' を渡す)。 */
    sourceKind?: string | null;
    /**
     * 418: 起こったイベント定義のid (triggerType==='event' のとき)。
     * trigger_event_id を持つルールは、このidと一致するときだけ登録する。
     * 未指定ならイベント限定ルールはどれにも登録しない（取り違え防止）。
     */
    eventId?: string | null;
    /** 必須。ルールと友だちがこの店舗のもの一致するときだけ登録する。 */
    lineAccountId: string;
    /**
     * 指定時は各書込みに AND で結び付ける。親が動いていたらその文は
     * 0 件 (登録は V6_WRITE_GUARDED を投げて数えない)。省略時は従来どおり。
     */
    writeGuard?: V6WriteGuard;
  },
): Promise<number> {
  // 自動登録はテナント境界を越えない。友だちの所属と呼出元の店舗が違う
  // ときは書かずに落とす (別店舗名義の誤送信を防ぐ)。
  const friendAccount = await db
    .prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
    .bind(input.friendId)
    .first<{ line_account_id: string | null }>();
  if (friendAccount?.line_account_id !== input.lineAccountId) {
    throw new Error('REMINDER_ACCOUNT_MISMATCH');
  }
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              trigger_event_id, current_published_version_id
         FROM reminders
        WHERE is_active = 1 AND lifecycle_status = 'published'
          AND deleted_at IS NULL AND trigger_type = ? AND line_account_id = ?`,
    )
    .bind(input.triggerType, input.lineAccountId)
    .all<ReminderTriggerRow>();
  if (!rules.results.length) return 0;

  let enrolled = 0;
  for (const rule of rules.results) {
    // 418: イベント限定ルールは、起こったイベントと一致するときだけ動く。
    if (rule.trigger_event_id && rule.trigger_event_id !== (input.eventId ?? null)) continue;
    if (rule.target_tag_id) {
      const tagged = await db
        .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ? LIMIT 1`)
        .bind(input.friendId, rule.target_tag_id)
        .first<{ 1: number }>();
      if (!tagged) continue;
    }
    // 公開版の対象条件。条件に外れる友だちのきっかけでは登録しない。
    if (!await matchesReminderTargetCondition(db, rule.id, input.friendId)) continue;

    const anchor = resolveAnchor(rule, input.startsAtIso);
    if (!anchor) continue;

    // 同じ発生元の再通知だけ重複排除する。source を見ないと、同時刻の
    // 別予約の2件目を作らず捨ててしまう (別予約は共存させる)。
    const existing = await db
      .prepare(
        `SELECT 1 FROM friend_reminders
          WHERE friend_id = ? AND reminder_id = ? AND target_date = ? AND status = 'active'
            AND source_kind IS ? AND source_id IS ? AND source_event_id IS ?
          LIMIT 1`,
      )
      .bind(
        input.friendId,
        rule.id,
        anchor,
        input.sourceKind ?? input.triggerType,
        input.sourceId ?? null,
        input.sourceEventId ?? null,
      )
      .first<{ 1: number }>();
    if (existing) continue;

    const guard = input.writeGuard;
    try {
      await enrollFriendInReminder(db, {
        friendId: input.friendId,
        reminderId: rule.id,
        targetDate: anchor,
        sourceKind: input.sourceKind ?? input.triggerType,
        sourceId: input.sourceId ?? null,
        sourceEventId: input.sourceEventId ?? null,
        writeGuard: guard,
      });
    } catch (error) {
      // ガードで止められたらこのルールは数えず次へ (敗者は何も残さない)。
      if (error instanceof Error && error.message === 'V6_WRITE_GUARDED') continue;
      // 取消後に同じ発生元で作り直したとき、cancelled の行が一意鍵
      // (reminder_id, friend_id, source_event_id) を塞いでいる。
      // その行を起こして新しい起点へ移す。再送の重なりでも1行のまま。
      if (!isUniqueViolation(error) || input.sourceEventId == null) throw error;
      const revived = await db
        .prepare(
          `UPDATE friend_reminders
              SET status = 'active', target_date = ?, cancel_reason = NULL,
                  completed_at = NULL, updated_at = ?
            WHERE reminder_id = ? AND friend_id = ? AND source_event_id = ?
              AND status = 'cancelled'
              ${guard ? `AND (${guard.sql})` : ''}`,
        )
        .bind(
          anchor, new Date().toISOString(), rule.id, input.friendId, input.sourceEventId,
          ...(guard ? guard.binds : []),
        )
        .run();
      // ガードつきで 0 件なら親が動いた敗者。起こさず次へ。
      if ((revived.meta?.changes ?? 0) === 0 && guard) continue;
      if ((revived.meta?.changes ?? 0) === 0) throw error;
    }
    enrolled++;
  }
  return enrolled;
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed/i.test(message);
}

export interface CancelByTriggerInput {
  triggerType: Exclude<ReminderTriggerType, 'manual'>;
  /** 追跡用の発生元区分。未指定なら triggerType。 */
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceEventId?: string | null;
  friendId?: string | null;
  /** 移行前の行を探すための旧開始時刻。source 連動が無いときの予備鍵。 */
  startsAtIso?: string | null;
  lineAccountId?: string | null;
  /** 取消理由・元イベントID・実行者を残す (例: booking_cancel:bk-1:by:staff-9)。 */
  cancelReason: string;
  allowLegacyFallback?: boolean;
  now?: Date;
  /**
   * true のとき送信権の貸出中は REMINDER_SEND_IN_FLIGHT を投げる
   * (利用者操作の取消用。呼び出し側は 409 で再試行させる)。
   */
  failOnSendInFlight?: boolean;
  /**
   * 指定時は cancelV6RemindersForSource の各書込みに AND で結び付ける。
   * 親が動いていたらその文は 0 件になる。省略時は従来どおり。
   */
  writeGuard?: V6WriteGuard;
}

/**
 * 取消を V6 へ連動する。未送信だけを止め、送信済み履歴は残す。
 *
 * 同じ取消通知の再送は active が無いため 0 件で返す。
 * 失敗は呼び出し側へ投げる。黙って握ると取消漏れ (N-065 そのもの) になる。
 */
export async function cancelByTrigger(
  db: D1Database,
  input: CancelByTriggerInput,
): Promise<CancelV6RemindersResult> {
  const targetDates = await anchorsForStartsAt(db, input.triggerType, input.friendId, input.startsAtIso);
  return cancelV6RemindersForSource(db, {
    sourceKind: input.sourceKind ?? input.triggerType,
    sourceId: input.sourceId,
    sourceEventId: input.sourceEventId,
    friendId: input.friendId,
    targetDates,
    lineAccountId: input.lineAccountId,
    cancelReason: input.cancelReason,
    allowLegacyFallback: input.allowLegacyFallback,
    now: input.now?.toISOString(),
    failOnSendInFlight: input.failOnSendInFlight,
    writeGuard: input.writeGuard,
  });
}

export interface RescheduleByTriggerInput {
  triggerType: Exclude<ReminderTriggerType, 'manual'>;
  /** 追跡用の発生元区分。未指定なら triggerType。 */
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceEventId?: string | null;
  friendId?: string | null;
  oldStartsAtIso: string;
  newStartsAtIso: string;
  lineAccountId?: string | null;
  allowLegacyFallback?: boolean;
  now?: Date;
}

/**
 * 日程変更を V6 へ連動する。送信済みを残し、未来予定だけ新基準日へ移す。
 *
 * 同じ変更通知の再送は from の起点が既に無いため 0 件で返す。
 *
 * R334: 既存登録の移動条件は、新規登録の条件と分ける。ルールの公開版が
 * 変わったり停止中でも、予約に紐づく既存登録は現在の予約日時へ追随させる。
 * タグ・対象条件の絞り込みは新規登録のためのもので、既にある登録の
 * 移動には使わない。旧起点の計算は、登録が固定する公開版の設定からも
 * 行う (現行版の起点だけでは版ずれの登録に一致しない)。
 */
export async function rescheduleByTrigger(
  db: D1Database,
  input: RescheduleByTriggerInput,
): Promise<RescheduleV6RemindersResult> {
  const empty = { movedEnrollments: 0, cancelledRuns: 0 };
  // 停止中のルールの登録も日時対応を保持するため、公開中だけに絞らない。
  // 削ったルールの行は対象外 (起点を計算できない)。
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              trigger_event_id, current_published_version_id
         FROM reminders
        WHERE deleted_at IS NULL AND trigger_type = ?`,
    )
    .bind(input.triggerType)
    .all<ReminderTriggerRow>();
  const ruleById = new Map<string, ReminderTriggerRow>();
  for (const rule of rules.results ?? []) ruleById.set(rule.id, rule);
  if (ruleById.size === 0) return empty;

  // 予約に紐づく既存の active 登録を source 鍵で拾う (友だち問わず)。
  const kind = input.sourceKind ?? input.triggerType;
  const keyConds: string[] = [];
  const keyBindings: unknown[] = [];
  if (input.sourceId != null) {
    keyConds.push(`fr.source_id = ?`);
    keyBindings.push(input.sourceId);
  }
  if (input.sourceEventId != null) {
    keyConds.push(`fr.source_event_id = ?`);
    keyBindings.push(input.sourceEventId);
  }
  if (keyConds.length === 0) return empty;
  const found = await db.prepare(
    `SELECT fr.id AS id, fr.reminder_id AS reminderId,
            fr.target_date AS targetDate, fr.reminder_version_id AS reminderVersionId
       FROM friend_reminders fr
      WHERE fr.status = 'active' AND fr.source_kind = ?
        AND (${keyConds.join(' OR ')})`,
  ).bind(kind, ...keyBindings).all<{
    id: string;
    reminderId: string;
    targetDate: string;
    reminderVersionId: string | null;
  }>();
  const rows = (found.results ?? []).filter((row) => ruleById.has(row.reminderId));
  // source 行が無くても移行前の行の移動が残るため、ここでは帰らない。

  // 固定版の設定は1回だけ読む。読めない版は現行起点だけで探す。
  const pinnedCache = new Map<string, ReminderTriggerRow | null>();
  const pinnedRule = async (versionId: string | null): Promise<ReminderTriggerRow | null> => {
    if (!versionId) return null;
    if (!pinnedCache.has(versionId)) {
      let pinned: ReminderTriggerRow | null = null;
      try {
        const version = await getReminderVersionById(db, versionId);
        const settings = version ? parseReminderVersionSettings(version) : null;
        if (settings) {
          pinned = {
            id: '',
            trigger_type: '',
            trigger_offset_minutes: settings.triggerOffsetMinutes ?? null,
            send_at_time: settings.sendAtTime ?? null,
            target_tag_id: null,
            trigger_event_id: null,
            current_published_version_id: versionId,
          };
        }
      } catch {
        pinned = null;
      }
      pinnedCache.set(versionId, pinned);
    }
    return pinnedCache.get(versionId) ?? null;
  };

  const moves: Array<{ reminderId: string; fromTargetDate: string; toTargetDate: string }> = [];
  const seen = new Set<string>();
  const addMove = (reminderId: string, fromTargetDate: string, toTargetDate: string): void => {
    const key = `${reminderId}\u0000${fromTargetDate}\u0000${toTargetDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    moves.push({ reminderId, fromTargetDate, toTargetDate });
  };
  // 従来の現行起点の移動。source 鍵の行と移行前の行 (DB 側の
  // legacy 検索) の両方に効く。無くすと移行前の行が残る。
  for (const rule of ruleById.values()) {
    const fromCurrent = resolveAnchor(rule, input.oldStartsAtIso);
    const to = resolveAnchor(rule, input.newStartsAtIso);
    if (!fromCurrent || !to || fromCurrent === to) continue;
    addMove(rule.id, fromCurrent, to);
  }
  // R334: 版ずれの source 行は、登録が固定する公開版の起点で探す。
  // 現行起点では一致しないため、上の移動だけでは残る。
  for (const row of rows) {
    const rule = ruleById.get(row.reminderId);
    if (!rule) continue;
    const to = resolveAnchor(rule, input.newStartsAtIso);
    if (!to || to === row.targetDate) continue;
    const fromCurrent = resolveAnchor(rule, input.oldStartsAtIso);
    if (row.targetDate === fromCurrent) continue;
    const pinned = await pinnedRule(row.reminderVersionId);
    const fromPinned = pinned ? resolveAnchor(pinned, input.oldStartsAtIso) : null;
    if (row.targetDate !== fromPinned) continue;
    addMove(row.reminderId, row.targetDate, to);
  }
  if (!moves.length) return empty;
  return rescheduleV6RemindersForSource(db, {
    sourceKind: input.sourceKind ?? input.triggerType,
    sourceId: input.sourceId,
    sourceEventId: input.sourceEventId,
    friendId: input.friendId,
    targetDates: undefined,
    lineAccountId: input.lineAccountId,
    allowLegacyFallback: input.allowLegacyFallback,
    moves,
    now: input.now?.toISOString(),
  });
}

export interface ReconcileV6Input {
  triggerType: Exclude<ReminderTriggerType, 'manual'>;
  /** 追跡用の発生元区分。未指定なら triggerType。 */
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceEventId?: string | null;
  /** 現在の担当友だち。これ以外の友だちに残った active 行は置き忘れとして止める。 */
  friendId: string;
  /** 現在の業務開始時刻。この起点に合う target_date へ直す。 */
  startsAtIso: string;
  now?: Date;
  /**
   * true のとき他友だちの行を止めず、現担当の起点直しだけ行う。
   * 友だち変更で「新規成功後に旧取消」の順序を作るための前段に使う。
   */
  leaveOtherFriends?: boolean;
  /**
   * 指定時は各書込みに AND で結び付ける。親が動いていたらその文は
   * 0 件になり、古い操作が新版の通知予定を変えない。省略時は従来どおり。
   */
  writeGuard?: V6WriteGuard;
}

export interface ReconcileV6Result {
  healedEnrollments: number;
  cancelledStale: number;
  cancelledRuns: number;
}

/**
 * 日程変更の途中失敗や友だち変更の取りこぼしを、再送で回復させる。
 *
 * 業務予定の更新は先に終わっていることがある (再送時は旧起点が分からない)。
 * そのため旧起点ではなく、現在の業務開始時刻から期待される target_date を
 * 求め、ずれている active 行を直す。友だちが変わった後に旧友だちへ残った
 * 行もここで止める。何もずれていなければ 0 件で返す (冪等)。
 */
export async function reconcileV6ToStartsAt(
  db: D1Database,
  input: ReconcileV6Input,
): Promise<ReconcileV6Result> {
  const empty = { healedEnrollments: 0, cancelledStale: 0, cancelledRuns: 0 };
  const kind = input.sourceKind ?? input.triggerType;
  if (input.sourceId == null && input.sourceEventId == null) return empty;
  const nowIso = (input.now ?? new Date()).toISOString();

  // source 連動の active 行を友だち問わず拾う。友だち変更の置き忘れはここで見つかる。
  const keyConds: string[] = [];
  const keyBindings: unknown[] = [];
  if (input.sourceId != null) {
    keyConds.push(`fr.source_id = ?`);
    keyBindings.push(input.sourceId);
  }
  if (input.sourceEventId != null) {
    keyConds.push(`fr.source_event_id = ?`);
    keyBindings.push(input.sourceEventId);
  }
  const found = await db.prepare(
    `SELECT fr.id AS id, fr.friend_id AS friendId, fr.reminder_id AS reminderId,
            fr.target_date AS targetDate
       FROM friend_reminders fr
      WHERE fr.status = 'active' AND fr.source_kind = ?
        AND (${keyConds.join(' OR ')})`,
  ).bind(kind, ...keyBindings).all<{
    id: string;
    friendId: string;
    reminderId: string;
    targetDate: string;
  }>();
  const rows = found.results ?? [];
  if (rows.length === 0) return empty;

  // 現起点で期待される target_date をルールごとに求める (タグ絞り込みあり)。
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              trigger_event_id, current_published_version_id
         FROM reminders
        WHERE is_active = 1 AND lifecycle_status = 'published'
          AND deleted_at IS NULL AND trigger_type = ?`,
    )
    .bind(input.triggerType)
    .all<ReminderTriggerRow>();
  const expected = new Map<string, string>();
  for (const rule of rules.results ?? []) {
    if (rule.target_tag_id) {
      const tagged = await db
        .prepare(`SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ? LIMIT 1`)
        .bind(input.friendId, rule.target_tag_id)
        .first<{ 1: number }>();
      if (!tagged) continue;
    }
    const anchor = resolveAnchor(rule, input.startsAtIso);
    if (anchor) expected.set(rule.id, anchor);
  }

  const statements: D1PreparedStatement[] = [];
  const healReason = `${kind}_heal:${input.sourceEventId ?? input.sourceId}:by:system`;
  const guard = input.writeGuard;
  const guardSql = guard ? `AND (${guard.sql})` : '';
  const guardBinds = guard ? guard.binds : [];
  const staleIds = input.leaveOtherFriends
    ? []
    : rows.filter((row) => row.friendId !== input.friendId).map((row) => row.id);
  for (let offset = 0; offset < staleIds.length; offset += 50) {
    const chunk = staleIds.slice(offset, offset + 50);
    const placeholders = chunk.map(() => '?').join(',');
    statements.push(
      db.prepare(
        `UPDATE friend_reminders
            SET status = 'cancelled', cancel_reason = ?, updated_at = ?
          WHERE status = 'active' AND id IN (${placeholders})
          ${guardSql}`,
      ).bind(healReason, nowIso, ...chunk, ...guardBinds),
    );
  }
  const movedIds: string[] = [];
  for (const row of rows) {
    if (row.friendId !== input.friendId) continue;
    const to = expected.get(row.reminderId);
    if (!to || to === row.targetDate) continue;
    statements.push(
      db.prepare(
        `UPDATE friend_reminders
            SET target_date = ?, updated_at = ?
          WHERE status = 'active' AND id = ?
          ${guardSql}`,
      ).bind(to, nowIso, row.id, ...guardBinds),
    );
    movedIds.push(row.id);
  }
  const enrollmentStatementCount = statements.length;
  const cancelIds = [...staleIds, ...movedIds];
  for (let offset = 0; offset < cancelIds.length; offset += 50) {
    const chunk = cancelIds.slice(offset, offset + 50);
    const placeholders = chunk.map(() => '?').join(',');
    statements.push(
      db.prepare(
        `UPDATE reminder_delivery_runs
            SET status = 'cancelled', completed_at = ?, updated_at = ?
          WHERE status IN ('queued', 'retry_wait', 'claimed') AND friend_reminder_id IN (${placeholders})
          ${guardSql}`,
      ).bind(nowIso, nowIso, ...chunk, ...guardBinds),
    );
  }
  if (statements.length === 0) return empty;
  const results = await db.batch(statements);
  let healedEnrollments = 0;
  let cancelledStale = 0;
  let cancelledRuns = 0;
  const staleStatementCount = Math.ceil(staleIds.length / 50);
  results.forEach((result, index) => {
    const changes = Number(result.meta?.changes ?? 0);
    if (index < staleStatementCount) cancelledStale += changes;
    else if (index < enrollmentStatementCount) healedEnrollments += changes;
    else cancelledRuns += changes;
  });
  return { healedEnrollments, cancelledStale, cancelledRuns };
}

/** 移行前の行を探すため、全ルールの起点候補を列挙する (タグ絞り込みなし)。 */
async function anchorsForStartsAt(
  db: D1Database,
  triggerType: Exclude<ReminderTriggerType, 'manual'>,
  friendId: string | null | undefined,
  startsAtIso: string | null | undefined,
): Promise<string[]> {
  if (!friendId || !startsAtIso) return [];
  const rules = await db
    .prepare(
      `SELECT id, trigger_type, trigger_offset_minutes, send_at_time, target_tag_id,
              trigger_event_id, current_published_version_id
         FROM reminders
        WHERE is_active = 1 AND lifecycle_status = 'published'
          AND deleted_at IS NULL AND trigger_type = ?`,
    )
    .bind(triggerType)
    .all<ReminderTriggerRow>();
  const anchors: string[] = [];
  for (const rule of rules.results ?? []) {
    const anchor = resolveAnchor(rule, startsAtIso);
    if (anchor && !anchors.includes(anchor)) anchors.push(anchor);
  }
  return anchors;
}
