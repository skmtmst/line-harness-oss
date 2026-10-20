import { sqlIdSet } from '../id-queries.js';
import { jstNow } from '../utils.js';
import { type V6SourceMatcher, type V6WriteGuard, type CancelV6RemindersResult, type V6TargetDateMove, type RescheduleV6RemindersResult } from './types.js';


/**
 * 条件と束縛値を SQL の出現順に積む。順番がずれると別列へ束縛されるため、
 * 条件文の追加と bindings.push は必ず同じ順で行う。
 */
export function v6BaseConditions(matcher: V6SourceMatcher, bindings: unknown[]): string[] {
  const conditions = [`fr.status = 'active'`];
  if (matcher.lineAccountId != null) {
    conditions.push(
      `EXISTS (SELECT 1 FROM friends f WHERE f.id = fr.friend_id AND f.line_account_id = ?)`,
    );
    bindings.push(matcher.lineAccountId);
  }
  return conditions;
}

/** source 連動 (source_id / source_event_id) の条件を作る。鍵が無ければ null。 */
export function v6SourceCondition(matcher: V6SourceMatcher, bindings: unknown[]): string | null {
  const keys: string[] = [];
  if (matcher.sourceId != null) keys.push(`fr.source_id = ?`);
  if (matcher.sourceEventId != null) keys.push(`fr.source_event_id = ?`);
  if (keys.length === 0) return null;
  const either = keys.length === 1 ? keys[0] : `(${keys.join(' OR ')})`;
  // 束縛は SQL の出現順 (kind → 鍵) に積む。kind 無しでも鍵の束縛は要る
  // (積まないと placeholder 不足で落ちる)。
  if (matcher.sourceKind != null) bindings.push(matcher.sourceKind);
  if (matcher.sourceId != null) bindings.push(matcher.sourceId);
  if (matcher.sourceEventId != null) bindings.push(matcher.sourceEventId);
  if (matcher.sourceKind == null) return either;
  return `(fr.source_kind = ? AND ${either})`;
}

export async function selectV6ActiveIds(
  db: D1Database,
  matcher: V6SourceMatcher,
  extra: string,
  extraBindings: unknown[],
): Promise<string[]> {
  const bindings: unknown[] = [];
  // source 経路は店舗で絞らない。source 鍵は全体で一意であり、登録時に
  // 友だちと店舗の一致を検証ずみのため、鍵だけで正確に特定できる。
  // 店舗跨ぎの友だち変更の失敗後に取消すとき、相談行は新店舗を向くが
  // 旧店舗の行を止める必要があり、店舗絞り込みは残留を起こす。
  // 店舗境界は source 未記録の legacy 経路でだけ見る。
  const conditions = [`fr.status = 'active'`];
  const source = v6SourceCondition(matcher, bindings);
  if (!source) return [];
  conditions.push(source, `(${extra})`);
  const rows = await db.prepare(
    `SELECT fr.id AS id FROM friend_reminders fr WHERE ${conditions.join(' AND ')}`,
  ).bind(...bindings, ...extraBindings).all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

export async function selectV6LegacyIds(
  db: D1Database,
  matcher: V6SourceMatcher,
  extra: string,
  extraBindings: unknown[],
): Promise<string[]> {
  if (matcher.friendId == null || !matcher.targetDates?.length) return [];
  const bindings: unknown[] = [];
  const conditions = v6BaseConditions(matcher, bindings);
  conditions.push(`fr.friend_id = ?`);
  bindings.push(matcher.friendId);
  const placeholders = sqlIdSet(matcher.targetDates).sql;
  conditions.push(`fr.target_date IN (${placeholders})`);
  bindings.push(...(matcher.targetDates.length ? sqlIdSet(matcher.targetDates).binds : []));
  // 同時刻の別予約・手動登録を巻き込まない。source を持つ行 (別予約の現行行や
  // 手動で作り直した行) は source 連動側でだけ触り、ここでは見ない。
  // 移行前のきっかけ登録は source_kind が 'manual' のまま残っているため、
  // 種別の絞り込みは登録先ルールの trigger_type で行う。
  conditions.push(`fr.source_id IS NULL AND fr.source_event_id IS NULL`);
  const legacyTrigger = matcher.sourceKind === 'meet' ? 'booking' : matcher.sourceKind;
  if (legacyTrigger != null) {
    conditions.push(
      `EXISTS (SELECT 1 FROM reminders r WHERE r.id = fr.reminder_id AND r.trigger_type = ?)`,
    );
    bindings.push(legacyTrigger);
  }
  // 店舗が分かるときはその店舗のルールの行だけ見る。別店舗のルールに載った
  // 行まで止めない (店舗境界)。所属不明の古いルールは従来どおり対象にする。
  if (matcher.lineAccountId != null) {
    conditions.push(
      `EXISTS (SELECT 1 FROM reminders r WHERE r.id = fr.reminder_id
         AND (r.line_account_id = ? OR r.line_account_id IS NULL))`,
    );
    bindings.push(matcher.lineAccountId);
  }
  conditions.push(`(${extra})`);
  // 移行前の行に予約の手がかりは無い。呼び出し側で候補が1件のときだけ扱い、
  // 複数あるときは対象を特定できないため触らない (fail closed)。
  // 日時順・id順に並べ、同じ入力では同じ順で返す (決定的)。
  const rows = await db.prepare(
    `SELECT fr.id AS id FROM friend_reminders fr WHERE ${conditions.join(' AND ')}
     ORDER BY fr.created_at ASC, fr.id ASC`,
  ).bind(...bindings, ...extraBindings).all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

export function chunkPlaceholders(ids: string[]): string {
  return ids.map(() => '?').join(',');
}

/**
 * 取消: 未送信の 登録だけを原子的に止める。
 *
 * source 連動の行を先に探し、1件も無ければ移行前の行 (friend + target_date)
 * を探す。両方に触れると、同時刻の別予約の行まで止めてしまう。
 */
export async function cancelV6RemindersForSource(
  db: D1Database,
  input: V6SourceMatcher & {
    cancelReason: string;
    now?: string;
    /**
     * true のとき、送信権の貸出中 (claimed + lease 有効) の登録があると
     * 何も書かず REMINDER_SEND_IN_FLIGHT を投げる。利用者操作の取消で使い、
     * 取消確定後の外部送信を起こさない。呼び出し側は 409 で再試行させる。
     * 未指定時は従来どおり最善努力で止める (貸出中は残し、cron 等の次回で収束)。
     */
    failOnSendInFlight?: boolean;
    /**
     * 指定時は各取消文に AND で結び付ける。親が動いていたらその文は
     * 0 件になり、古い操作が新版の通知予定を変えない。省略時は従来どおり。
     */
    writeGuard?: V6WriteGuard;
  },
): Promise<CancelV6RemindersResult> {
  const now = input.now ?? jstNow();
  const ids = await selectV6ActiveIds(db, input, '1 = 1', []);
  if (ids.length === 0 && input.allowLegacyFallback !== false) {
    // 起点ごとに候補が1件のときだけ止める。1予約が複数ルールで複数行を
    // 持つときは起点が違うため各行が止まる。同時刻の別予約が2件以上ある
    // ときはどれが対象か分からないため止めない (fail closed: 誤取消しより残存)。
    for (const targetDate of new Set(input.targetDates ?? [])) {
      const legacy = await selectV6LegacyIds(db, { ...input, targetDates: [targetDate] }, '1 = 1', []);
      if (legacy.length === 1) ids.push(legacy[0]);
    }
  }
  if (ids.length === 0) return { cancelledEnrollments: 0, cancelledRuns: 0 };

  // D1/SQLite のbind上限に左右されず、選んだ全IDを1文で扱う。
  // 取消と送信権claimの境界を1つのUPDATEに置くため、分割しない。
  const idsJson = JSON.stringify(ids);

  // 送信権の貸出中は取消を確定させない。貸出 (claim/再検証) と取消確定の
  // 順序はこの確認と各1文で直列化される: 貸出が先なら取消は拒否・残置し、
  // 取消が先なら貸出側の active 確認が失敗して送らない。
  // lease 無し (NULL) は貸出取得前の行のため対象にする。
  const countLiveClaims = async (): Promise<number> => {
    // lease (UTC Z 書き) と now (+09:00 書き) を TEXT 比較すると、実時間で
    // live でも偽になり fence を抜ける。UTC epoch で比べる。
    const live = await db.prepare(
      `SELECT COUNT(*) AS c FROM reminder_delivery_runs
        WHERE friend_reminder_id IN (SELECT value FROM json_each(?))
          AND status = 'claimed'
          AND lease_expires_at IS NOT NULL
          AND strftime('%s', lease_expires_at) > strftime('%s', ?)`,
    ).bind(idsJson, now).first<{ c: number }>();
    return live?.c ?? 0;
  };
  if (input.failOnSendInFlight && (await countLiveClaims()) > 0) {
    throw new Error('REMINDER_SEND_IN_FLIGHT');
  }

  if (input.failOnSendInFlight) {
    // strict fence: 「最終送信権が1件も無い」と「対象全件を取消」を
    // 1つのSQL文で直列化する。COUNT後に claim/verify が割り込んでも、
    // 取消UPDATEが先ならclaim側のactive確認が失敗し、claimが先なら
    // NOT EXISTSが全件の書き換えを拒否する。json_eachで分割UPDATEを避け、
    // 複数登録もall-or-noneにする。
    const guard = input.writeGuard;
    const cancelled = await db.prepare(
      `UPDATE friend_reminders
          SET status = 'cancelled', cancel_reason = ?, updated_at = ?
        WHERE status = 'active'
          AND id IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (
            SELECT 1 FROM reminder_delivery_runs r
             WHERE r.friend_reminder_id IN (SELECT value FROM json_each(?))
               AND r.status = 'claimed'
               AND r.lease_expires_at IS NOT NULL
               AND strftime('%s', r.lease_expires_at) > strftime('%s', ?))
          ${guard ? `AND (${guard.sql})` : ''}`,
    ).bind(input.cancelReason, now, idsJson, idsJson, now, ...(guard ? guard.binds : [])).run();

    const remaining = await db.prepare(
      `SELECT COUNT(*) AS c FROM friend_reminders
        WHERE status = 'active' AND id IN (SELECT value FROM json_each(?))`,
    ).bind(idsJson).first<{ c: number }>();
    if ((remaining?.c ?? 0) > 0) throw new Error('REMINDER_SEND_IN_FLIGHT');

    // 登録が全件非activeになった後だけ実行行を止める。
    // 送信側は登録activeを再確認するため、この2文の間に停止しても
    // 外部送信は起きない。
    const cancelledRuns = await db.prepare(
      `UPDATE reminder_delivery_runs
          SET status = 'cancelled', completed_at = ?, updated_at = ?
        WHERE status IN ('queued', 'retry_wait', 'claimed')
          AND friend_reminder_id IN (SELECT value FROM json_each(?))
          AND NOT EXISTS (
            SELECT 1 FROM friend_reminders fr
             WHERE fr.id = reminder_delivery_runs.friend_reminder_id AND fr.status = 'active')
          ${guard ? `AND (${guard.sql})` : ''}`,
    ).bind(now, now, idsJson, ...(guard ? guard.binds : [])).run();
    return {
      cancelledEnrollments: Number(cancelled.meta?.changes ?? 0),
      cancelledRuns: Number(cancelledRuns.meta?.changes ?? 0),
    };
  }

  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50);
    const placeholders = chunkPlaceholders(chunk);
    // 最善努力 (cron 等) は従来どおり貸出中を残し、次回で収束させる。
    const liveGuard = `AND NOT EXISTS (
           SELECT 1 FROM reminder_delivery_runs r
            WHERE r.friend_reminder_id = friend_reminders.id
              AND r.status = 'claimed'
              AND r.lease_expires_at IS NOT NULL
              AND strftime('%s', r.lease_expires_at) > strftime('%s', ?))`;
    const enrollmentBindings = [input.cancelReason, now, ...chunk, now];
    statements.push(
      db.prepare(
        `UPDATE friend_reminders
            SET status = 'cancelled', cancel_reason = ?, updated_at = ?
          WHERE status = 'active' AND id IN (${placeholders})
          ${liveGuard}`,
      ).bind(...enrollmentBindings),
      // 送信済みは残す。止めるのは active でなくなった登録の行だけ。
      db.prepare(
        `UPDATE reminder_delivery_runs
            SET status = 'cancelled', completed_at = ?, updated_at = ?
          WHERE status IN ('queued', 'retry_wait', 'claimed') AND friend_reminder_id IN (${placeholders})
            AND NOT EXISTS (
              SELECT 1 FROM friend_reminders fr
               WHERE fr.id = reminder_delivery_runs.friend_reminder_id AND fr.status = 'active')`,
      ).bind(now, now, ...chunk),
    );
  }
  const results = await db.batch(statements);
  // 文は (登録 UPDATE, 実行行 UPDATE) の対で積んである。偶数番目が登録側。
  const cancelledEnrollments = results.reduce(
    (sum, result, index) => (index % 2 === 0 ? sum + Number(result.meta?.changes ?? 0) : sum),
    0,
  );
  const cancelledRuns = results.reduce(
    (sum, result, index) => (index % 2 === 1 ? sum + Number(result.meta?.changes ?? 0) : sum),
    0,
  );
  return { cancelledEnrollments, cancelledRuns };
}

/**
 * 日程変更: 送信済みを残し、未来予定 (active な登録) だけ新しい基準日へ移す。
 *
 * moves の from と to が同じものは触らない。同じ変更通知の再送は、
 * 既に移し終えた行が from に無いため 0 件で返す。
 */
export async function rescheduleV6RemindersForSource(
  db: D1Database,
  input: V6SourceMatcher & { moves: V6TargetDateMove[]; now?: string },
): Promise<RescheduleV6RemindersResult> {
  const now = input.now ?? jstNow();
  const effective = input.moves.filter((move) => move.fromTargetDate !== move.toTargetDate);
  if (effective.length === 0) return { movedEnrollments: 0, cancelledRuns: 0 };

  // 取消と同じく source 連動を優先し、無ければ移行前の行を見る。
  const sourceProbe = await selectV6ActiveIds(db, input, '1 = 1', []);
  const useLegacy = sourceProbe.length === 0 && input.allowLegacyFallback !== false;

  const movedIds: string[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const move of effective) {
    const extra = move.reminderId != null ? 'fr.reminder_id = ?' : '1 = 1';
    const extraBindings = move.reminderId != null ? [move.reminderId] : [];
    // 移行前の行は候補1件のときだけ移す。複数は対象不明のため置いていく。
    const legacyIds = useLegacy
      ? await selectV6LegacyIds(db, { ...input, targetDates: [move.fromTargetDate] }, extra, extraBindings)
      : [];
    if (useLegacy && legacyIds.length !== 1) continue;
    const ids = useLegacy
      ? legacyIds
      : await selectV6ActiveIds(
        db,
        input,
        `fr.target_date = ? AND (${extra})`,
        [move.fromTargetDate, ...extraBindings],
      );
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50);
      const placeholders = chunkPlaceholders(chunk);
      statements.push(
        db.prepare(
          `UPDATE friend_reminders
              SET target_date = ?, updated_at = ?
            WHERE status = 'active' AND target_date = ? AND id IN (${placeholders})`,
        ).bind(move.toTargetDate, now, move.fromTargetDate, ...chunk),
      );
      movedIds.push(...chunk);
    }
  }
  if (statements.length === 0) return { movedEnrollments: 0, cancelledRuns: 0 };
  // 旧基準日で積んだ未来の実行行は時刻がずれているので止める。
  // 次の cron が新基準日で作り直す。送信済みは残し、claimed も止める。
  // 登録の移動と実行行の停止は同じ batch (原子的) に入れる。途中で落ちても
  // 「登録だけ新日・実行行だけ旧日」の半端な状態を残さない。
  const enrollmentStatementCount = statements.length;
  for (let offset = 0; offset < movedIds.length; offset += 50) {
    const chunk = movedIds.slice(offset, offset + 50);
    const placeholders = chunkPlaceholders(chunk);
    statements.push(
      db.prepare(
        `UPDATE reminder_delivery_runs
            SET status = 'cancelled', completed_at = ?, updated_at = ?
          WHERE status IN ('queued', 'retry_wait', 'claimed') AND friend_reminder_id IN (${placeholders})`,
      ).bind(now, now, ...chunk),
    );
  }
  const results = await db.batch(statements);
  let movedEnrollments = 0;
  let cancelledRuns = 0;
  results.forEach((result, index) => {
    const changes = Number(result.meta?.changes ?? 0);
    if (index < enrollmentStatementCount) movedEnrollments += changes;
    else cancelledRuns += changes;
  });
  return { movedEnrollments, cancelledRuns };
}
