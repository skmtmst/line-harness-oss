import type { FriendScenario } from './friend-scenario-types.js';
import { accountFeatureOffExclusionSql } from './account-settings.js';
import { jstNow } from './utils.js';
import { computeNextDeliveryAt } from './scenario-schedule.js';
import { buildFriendScenariosDueForDeliveryQuery, normalizeScenarioDeliveryTimestamp, SCENARIO_DELIVERY_BATCH_LIMIT } from './scenario-delivery-timestamps.js';
import { type ScenarioDeliverySource, type ScenarioVersion, type DeliveryMode } from './scenarios-types.js';
import { parseScenarioVersionSteps, parseScenarioVersionActions, getScenarioPublishedVersion } from './scenarios-snapshots.js';


/**
 * 配信が読む通と条件を1箇所で決める。購読に固定された公開版だけを読む。
 *
 * 版が無い（未公開）・版の行が見つからない（欠損参照）ときは null を返す。
 * live の下書き表へは戻らない。呼ぶ側は送らずに止める（購読の一時停止・
 * 再開の見送り）。下書きの編集中身が配信へ混入しないための安全停止。
 */
export async function getStepsForDelivery(
  db: D1Database,
  scenarioId: string,
  publishedVersionId: string | null,
): Promise<ScenarioDeliverySource | null> {
  if (!publishedVersionId) return null;
  const version = await db.prepare(
    `SELECT * FROM scenario_versions WHERE id = ? AND scenario_id = ?`,
  ).bind(publishedVersionId, scenarioId).first<ScenarioVersion>();
  if (!version) return null;
  return {
    deliveryMode: (version.delivery_mode ?? 'relative') as DeliveryMode,
    audienceConditionJson: version.audience_condition_json ?? null,
    onCompleteMode: version.on_complete_mode ?? null,
    onCompleteScenarioId: version.on_complete_scenario_id ?? null,
    steps: parseScenarioVersionSteps(version),
    actions: parseScenarioVersionActions(version),
    pinnedVersionId: version.id,
  };
}

/**
 * live の通がまだ残っているか。配信ログの scenario_step_id には、残って
 * いるときだけ live の通IDを入れ、消されたあとは NULL にする（外部キー
 * を壊さない）。ダッシュボードの集計は残っている分だけ付く。
 */
export async function scenarioStepExists(db: D1Database, stepId: string | null): Promise<boolean> {
  if (!stepId) return false;
  const row = await db.prepare(`SELECT 1 AS ok FROM scenario_steps WHERE id = ?`)
    .bind(stepId)
    .first<{ ok: number }>();
  return row !== null;
}

// ============================================================
// Friend Scenario Enrollments
// ============================================================

export async function enrollFriendInScenario(
  db: D1Database,
  friendId: string,
  scenarioId: string,
  sourceEnrollmentId?: string,
  options: { replacingScenarioId?: string | null } = {},
): Promise<FriendScenario | null> {
  const id = sourceEnrollmentId ?? crypto.randomUUID();
  if (sourceEnrollmentId) {
    const previous = await db.prepare(`SELECT * FROM friend_scenarios WHERE id=? AND friend_id=? AND scenario_id=?`)
      .bind(id, friendId, scenarioId).first<FriendScenario>();
    if (previous) return previous;
  }
  const now = jstNow();

  // delivery_mode を取得（migration 037 適用前の DB では 'relative' が DEFAULT で既に入っている）
  const scenarioRow = await db
    .prepare(`SELECT delivery_mode, allow_concurrent, is_active FROM scenarios WHERE id = ?`)
    .bind(scenarioId)
    .first<{ delivery_mode: DeliveryMode; allow_concurrent: number | null; is_active: number }>();
  if (!scenarioRow) return null;

  // 止めているシナリオは受け付けない。cron も止めたシナリオには配らないので、
  // ここで購読だけ作ると「入ったのに届かない」行が残る。
  if (scenarioRow.is_active === 0) return null;

  // 重複は副作用の前に弾く。版の読み・予定計算の前に返すので、重複登録の
  // たびに公開側の状態を触らない。
  //
  // null を返す。例外にしないのは、呼び出し口が「友だち追加」や
  // 「タグが付いた」といった副作用の中にあり、そこで throw すると
  // 本来の処理まで巻き添えで失敗するため。
  const duplicate = await db
    .prepare(
      `SELECT id FROM friend_scenarios
        WHERE friend_id = ? AND scenario_id = ? AND status != 'completed'
        LIMIT 1`,
    )
    .bind(friendId, scenarioId)
    .first<{ id: string }>();
  if (duplicate) return null;

  // 並行を許さないシナリオは、他のシナリオが動いている人には登録しない。
  //
  // 既定は「許す」（104 で既存の行を 1 に寄せ、作成時も 1 を渡す）。
  // ここを既定で塞ぐと、いま複数のシナリオに入っている人への配信が
  // 止まってしまう。止めたい人だけが画面から 0 にする。
  //
  // 同じシナリオへの二重登録は、上の重複検査と部分UNIQUE索引が防いでいる
  // （idx_friend_scenarios_unique）。ここで見るのは「他のシナリオ」だけ。
  if (scenarioRow.allow_concurrent === 0) {
    const other = await db
      .prepare(
        `SELECT 1 FROM friend_scenarios
          WHERE friend_id = ? AND scenario_id != ? AND status = 'active'
            AND (? IS NULL OR scenario_id != ?)
          LIMIT 1`,
      )
      .bind(friendId, scenarioId, options.replacingScenarioId ?? null, options.replacingScenarioId ?? null)
      .first<{ 1: number }>();
    if (other) return null;
  }

  // 開始時の公開版へ固定する（351）。明示公開された版だけを選び、未公開の
  // 下書きを自動公開しない。未公開のときは受け付けない（null）。
  const version = await getScenarioPublishedVersion(db, scenarioId);
  if (!version) return null;
  const pinnedSteps = parseScenarioVersionSteps(version).filter((s) => (s.is_draft ?? 0) === 0);
  const firstStep = pinnedSteps.length > 0 ? pinnedSteps[0] : null;

  // A scenario with no steps is immediately completed — no stuck active enrollment.
  if (!firstStep) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, published_version_id, updated_at)
         VALUES (?, ?, ?, 0, 'completed', ?, NULL, ?, ?)`,
      )
      .bind(id, friendId, scenarioId, now, version.id, now)
      .run();

    if (!result.meta.changes || result.meta.changes === 0) return null;

    return (await db
      .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
      .bind(id)
      .first<FriendScenario>())!;
  }

  const enrolledAtDate = new Date(Date.now() + 9 * 60 * 60_000);
  // 予定の組み立ては固定した版の値で行う。開始後に配信方式を変えても、
  // 既存の購読の予定は変わらない。
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: (version.delivery_mode ?? 'relative') as DeliveryMode },
    firstStep,
    { enrolledAt: enrolledAtDate, previousDeliveredAt: enrolledAtDate, now: enrolledAtDate },
  );
  const nextDeliveryAt = nextDeliveryDate.toISOString().slice(0, -1) + '+09:00';

  // current_step_order is initialized to -1 (NOT 0) so that the step-delivery
  // service's `steps.find(s => s.step_order > fs.current_step_order)` lookup
  // matches the very first step (step_order=0).
  // If we initialize to 0, scenarios that only have a step_order=0 step are
  // silently completed without delivering anything (because no step has
  // step_order > 0). This was observed in production on 2026-04-27 where
  // ~10 friend_scenarios silently completed for a 46-hour window.
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, published_version_id, updated_at)
       VALUES (?, ?, ?, -1, 'active', ?, ?, ?, ?)`,
    )
    .bind(id, friendId, scenarioId, now, nextDeliveryAt, version.id, now)
    .run();

  if (!result.meta.changes || result.meta.changes === 0) return null;

  return (await db
    .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
    .bind(id)
    .first<FriendScenario>())!;
}

/**
 * 購読を別のシナリオへ移す（#949 N-054 / 機能05「友だちごとの移動」）。
 *
 * いまの購読を completed に閉じ、移し先へ新しい購読を作る。先に移し先へ
 * 登録してから元を閉じるので、移し先が受け付けない（停止中・未公開・
 * すでに入っている・並行を許さない）ときは元の購読はそのまま残る。
 *
 * 送信中（delivering）の行はここでは動かさない。claim 済みの配信が
 * 走っている最中に閉じると結果の書き戻しとぶつかるため、呼び出し側で
 * delivering を断ってから呼ぶこと。
 *
 * @returns 移し先で新しくできた購読。条件に合わないときは null。
 */
export async function moveFriendScenarioTo(
  db: D1Database,
  id: string,
  targetScenarioId: string,
): Promise<FriendScenario | null> {
  const current = await getFriendScenarioById(db, id);
  if (!current) return null;
  if (current.status === 'completed' || current.status === 'delivering') return null;
  if (current.scenario_id === targetScenarioId) return null;

  // 移し先が受け付けないなら元は残す（null）。理由の区別は呼び出し側で
  // 移し先シナリオの状態を見て返す。
  const moved = await enrollFriendInScenario(db, current.friend_id, targetScenarioId);
  if (!moved) return null;
  await completeFriendScenario(db, id);
  return moved;
}

export async function getFriendScenariosDueForDelivery(
  db: D1Database,
  now: string,
  limit = SCENARIO_DELIVERY_BATCH_LIMIT,
  scenarioId?: string,
): Promise<FriendScenario[]> {
  const dueBefore = normalizeScenarioDeliveryTimestamp(now);
  if (dueBefore === null) throw new Error(`Invalid due-delivery timestamp: ${now}`);
  const batchLimit = Math.max(1, Math.floor(limit));
  const query = buildFriendScenariosDueForDeliveryQuery(scenarioId !== undefined);
  const result = await db
    .prepare(query)
    .bind(...(scenarioId === undefined
      ? [dueBefore, batchLimit]
      : [dueBefore, scenarioId, batchLimit]))
    .all<FriendScenario>();
  return result.results;
}

/**
 * Optimistic lock: claim a friend_scenario for delivery.
 * Only succeeds if status='active' and current_step_order matches.
 * Returns true if claimed, false if another worker already processed it.
 */
export async function claimFriendScenarioForDelivery(
  db: D1Database,
  id: string,
  expectedStepOrder: number,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'delivering', updated_at = ?
       WHERE id = ? AND status = 'active' AND current_step_order = ?`,
    )
    .bind(now, id, expectedStepOrder)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Crash recovery: reset friend_scenarios stuck in 'delivering' for over 5 minutes back to 'active'.
 */
export async function recoverStuckDeliveries(db: D1Database): Promise<number> {
  const fiveMinAgo = new Date(Date.now() + 9 * 60 * 60_000 - 5 * 60_000);
  const threshold = fiveMinAgo.toISOString().slice(0, -1) + '+09:00';
  // 機能オフ中のアカウントの行は回収しない。OFF中は status も updated_at も
  // 動かさず delivering のまま残し、再オンの tick で回収する。
  const result = await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
       WHERE status = 'delivering' AND updated_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM scenarios s
            WHERE s.id = friend_scenarios.scenario_id
              AND ${accountFeatureOffExclusionSql('s.line_account_id', 'scenarios')}
         )`,
    )
    .bind(jstNow(), threshold)
    .run();
  return result.meta.changes ?? 0;
}

/**
 * Stop a claimed delivery without losing its enrollment state.
 * Used for permanent recipient/payload failures and for account-bound
 * scenarios that do not have a safe destination friend for that account.
 *
 * pause_reason='delivery_failed' を残す。画面はこれを見て「再開」ではなく
 * 「失敗を再送」を出す（432 / #949 N-054）。
 */
export async function pauseFriendScenarioDelivery(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE friend_scenarios
          SET status = 'paused', pause_reason = 'delivery_failed', updated_at = ?
       WHERE id = ? AND status = 'delivering'`,
    )
    .bind(jstNow(), id)
    .run();
}

export async function advanceFriendScenario(
  db: D1Database,
  id: string,
  nextStepOrder: number,
  nextDeliveryAt?: string | null,
): Promise<void> {
  const now = jstNow();
  const normalizedNextDeliveryAt = nextDeliveryAt
    ? normalizeScenarioDeliveryTimestamp(nextDeliveryAt)
    : null;
  if (nextDeliveryAt && normalizedNextDeliveryAt === null) {
    throw new Error(`Invalid scenario delivery timestamp: ${nextDeliveryAt}`);
  }
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET current_step_order = ?,
           next_delivery_at = ?,
           status = 'active',
           pause_reason = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(nextStepOrder, normalizedNextDeliveryAt, now, id)
    .run();
}

/**
 * 送ったところで止める。
 *
 * 「送信後 一時停止」が付いた通を送ったあとに呼ぶ。次の配信日時を消して
 * status を paused にするので、時間が来ても勝手には進まない。人が再開すると
 * 止まった続きから流れる（current_step_order はそのまま残す）。
 */
export async function pauseFriendScenario(
  db: D1Database,
  id: string,
  atStepOrder: number,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'paused',
           pause_reason = 'after_send',
           current_step_order = ?,
           next_delivery_at = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(atStepOrder, now, id)
    .run();
}

export async function completeFriendScenario(
  db: D1Database,
  id: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_scenarios
       SET status = 'completed',
           next_delivery_at = NULL,
           pause_reason = NULL,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}

/**
 * 前回読んだところから、同じシナリオを再開する（設計 V2 4-6「開始位置」）。
 *
 * `enrollFriendInScenario` は必ず `current_step_order = -1` の新しい行を作るので、
 * ブロックを解除した人にもう一度1通目から流れてしまう。ここは既にある行を
 * 生かして、続きから配信する。
 *
 * 進める先が無い（最後まで読み終えている）ときは `null` を返す。呼ぶ側で
 * 「送るものが無い」として扱う。既にある行が `active` のときも `null`
 * （もう流れているので、触ると二重配信になる）。
 */
export async function resumeFriendScenario(
  db: D1Database,
  friendId: string,
  scenarioId: string,
): Promise<FriendScenario | null> {
  const existing = await db
    .prepare(
      `SELECT * FROM friend_scenarios
        WHERE friend_id = ? AND scenario_id = ?
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .bind(friendId, scenarioId)
    .first<FriendScenario>();
  if (!existing) return null;
  return resumeExistingFriendScenario(db, existing);
}

/**
 * 既にある購読行を続きから動かす共通部品。
 *
 * active / delivering の行は null（もう流れている・送信中なので、触ると
 * 二重配信になる）。止まっているシナリオ・版が読めない購読・進める先が
 * 無い購読も null。
 */
export async function resumeExistingFriendScenario(
  db: D1Database,
  existing: FriendScenario,
): Promise<FriendScenario | null> {
  if (existing.status === 'active' || existing.status === 'delivering') return null;

  // 止めているシナリオは再開しない。起こすと cron が拾って配り始める。
  const scenarioState = await db.prepare(`SELECT is_active FROM scenarios WHERE id = ?`)
    .bind(existing.scenario_id)
    .first<{ is_active: number }>();
  if (!scenarioState || scenarioState.is_active === 0) return null;

  // 固定した版だけから次を探す（351）。版が無い・欠損しているときは
  // live の表へ戻らず見送る（null）。
  const source = await getStepsForDelivery(db, existing.scenario_id, existing.published_version_id ?? null);
  if (!source) return null;
  const nextStep = source.steps.find(s => s.step_order > existing.current_step_order);
  if (!nextStep) return null;

  const nowDate = new Date(Date.now() + 9 * 60 * 60_000);
  const nextDeliveryDate = computeNextDeliveryAt(
    { delivery_mode: source.deliveryMode },
    nextStep,
    { enrolledAt: nowDate, previousDeliveredAt: nowDate, now: nowDate },
  );
  const nextDeliveryAt = nextDeliveryDate.toISOString().slice(0, -1) + '+09:00';
  const now = jstNow();

  await db
    .prepare(
      `UPDATE friend_scenarios
          SET status = 'active', next_delivery_at = ?, pause_reason = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(nextDeliveryAt, now, existing.id)
    .run();

  return (await db
    .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
    .bind(existing.id)
    .first<FriendScenario>())!;
}

/** 購読1件を ID で読む。友だち単位の操作（#949 N-054）の入口。 */
export async function getFriendScenarioById(
  db: D1Database,
  id: string,
): Promise<FriendScenario | null> {
  return db
    .prepare(`SELECT * FROM friend_scenarios WHERE id = ?`)
    .bind(id)
    .first<FriendScenario>();
}

/**
 * 画面からの手動停止（#949 N-054）。
 *
 * 進行中（active）の購読だけを止める。送信中（delivering）はここでは
 * 触らない。直前に claim した配信が走っている最中に書き換えると、
 * advanceFriendScenario が paused を active へ戻して「止めたのに動く」
 * になるため、呼び出し側で delivering を断ってから呼ぶこと。
 *
 * @returns 状態を paused に変えられたら true。
 */
export async function pauseFriendScenarioManual(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE friend_scenarios
          SET status = 'paused',
              pause_reason = 'manual',
              next_delivery_at = NULL,
              updated_at = ?
        WHERE id = ? AND status = 'active'`,
    )
    .bind(jstNow(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 止まっている購読1件を ID 指定で再開する（#949 N-054）。
 *
 * 画面は友だちではなく購読行を指して操作するため、friend_id + scenario_id
 * で「いちばん新しい行」を探す resumeFriendScenario とは別の入口が要る。
 * paused の行だけを受け付ける。active / delivering / completed は null。
 */
export async function resumeFriendScenarioById(
  db: D1Database,
  id: string,
): Promise<FriendScenario | null> {
  const existing = await getFriendScenarioById(db, id);
  if (!existing || existing.status !== 'paused') return null;
  return resumeExistingFriendScenario(db, existing);
}

/**
 * 配信失敗で止まった購読を、失敗した通からすぐ送り直す（#949 N-054）。
 *
 * pause_reason='delivery_failed' の paused 行だけを受け付ける。
 * 再開と違い、版の予定を計算し直さず next_delivery_at を「いま」に
 * 置く。cron が次の tick で拾い、失敗した通をもう一度組み立てて送る。
 *
 * @returns 再送待ちにできた購読。条件に合わない行は null。
 */
export async function retryFailedFriendScenario(
  db: D1Database,
  id: string,
): Promise<FriendScenario | null> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE friend_scenarios
          SET status = 'active',
              next_delivery_at = ?,
              pause_reason = NULL,
              updated_at = ?
        WHERE id = ? AND status = 'paused' AND pause_reason = 'delivery_failed'`,
    )
    .bind(now, now, id)
    .run();
  if ((result.meta.changes ?? 0) === 0) return null;
  return getFriendScenarioById(db, id);
}
