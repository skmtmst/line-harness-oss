/*
 * タグ付与の工程別台帳(#699 / migration 376)。
 *
 * friend_tags への付与は INSERT OR IGNORE で先に確定する。そのあとに走る
 * 副作用が落ちると、次回同じ経路へ来ても changes=0 で早期 return するため、
 * 落ちた副作用は二度と走らない。付与の直後にここへ工程ごとの行を開き、
 * 「付与は済んだが未了の工程がある」状態を残す。走り直す側は completed
 * でない行だけを拾う。
 *
 * 業務の正本は friend_tags のまま。この表は工程の進み具合だけを持つ。
 */
import { jstNow } from './utils';

/** タグ付与後に走る副作用の工程。付与のたびにこの3本を開く。 */
export const FRIEND_TAG_SIDE_EFFECT_STEPS = [
  'mileage',
  'scenario_enroll',
  'event_tag_change',
] as const;

export type FriendTagSideEffectStep = (typeof FRIEND_TAG_SIDE_EFFECT_STEPS)[number];

export type FriendTagSideEffectStatus = 'pending' | 'running' | 'failed' | 'completed';

/**
 * 結末が分からない行(running)を走り直してよい工程。
 *
 * mileage は冪等キー、scenario_enroll は存在確認と部分UNIQUE索引が二重を
 * 防ぐので、もう一度走らせても増えない。event_tag_change は webhook 送信や
 * 加点を伴い冪等でないため、ここには入れない。「走ったかもしれない」を
 * 走り直すと、外部へ二重に届く。
 */
export const FRIEND_TAG_SIDE_EFFECT_IDEMPOTENT_STEPS: ReadonlySet<FriendTagSideEffectStep> =
  new Set<FriendTagSideEffectStep>(['mileage', 'scenario_enroll']);

/**
 * 走り直しの上限。落ち続ける行を無限に叩かない。
 * 超えた行は failed のまま台帳に残り、運用者の目に触れる。
 */
export const FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS = 5;

export interface FriendTagSideEffectRun {
  friend_id: string;
  tag_id: string;
  step_key: FriendTagSideEffectStep;
  /** friend_tags.assigned_at の写し。走り直しの冪等キーはこれを使う。 */
  assigned_at: string;
  status: FriendTagSideEffectStatus;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

/** last_error に残す長さの上限。理由の先頭だけで十分で、台帳を太らせない。 */
const LAST_ERROR_MAX_LENGTH = 500;

function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > LAST_ERROR_MAX_LENGTH ? text.slice(0, LAST_ERROR_MAX_LENGTH) : text;
}

/** その行を走り直してよいか。上限と、結末が分からない行の扱いをここで決める。 */
export function isFriendTagSideEffectRetryable(run: FriendTagSideEffectRun): boolean {
  if (run.status === 'completed') return false;
  if (run.attempt_count >= FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS) return false;
  if (run.status === 'running') return FRIEND_TAG_SIDE_EFFECT_IDEMPOTENT_STEPS.has(run.step_key);
  return true;
}

/**
 * 新しく付与が確定した直後に、工程の行を3本まとめて pending で開く。
 *
 * タグを外して付け直したときは同じ主キーに当たるので、新しい assigned_at へ
 * 差し替えて pending に戻す(新しい出来事なので全工程をやり直す)。
 * 前回の失敗理由と試行回数もここで消す。
 */
export async function openFriendTagSideEffectRuns(
  db: D1Database,
  input: { friendId: string; tagId: string; assignedAt: string },
): Promise<void> {
  const now = jstNow();
  for (const step of FRIEND_TAG_SIDE_EFFECT_STEPS) {
    await db
      .prepare(
        `INSERT INTO friend_tag_side_effect_runs
           (friend_id, tag_id, step_key, assigned_at, status, attempt_count,
            last_error, last_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
         ON CONFLICT (friend_id, tag_id, step_key) DO UPDATE SET
           assigned_at = excluded.assigned_at,
           status = 'pending',
           attempt_count = 0,
           last_error = NULL,
           last_attempt_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(input.friendId, input.tagId, step, input.assignedAt, now, now)
      .run();
  }
}

/**
 * この (友だち, タグ) で未了の工程を返す。走り直す側の入口。
 *
 * 台帳が無い古い付与 (376 より前に付いたタグ) は0件を返す。何が未了かを
 * 判断する材料が無いため、勝手に走り直して二重に副作用を出さない。
 */
export async function listUnfinishedFriendTagSideEffectRuns(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<FriendTagSideEffectRun[]> {
  const rows = await db
    .prepare(
      `SELECT friend_id, tag_id, step_key, assigned_at, status, attempt_count,
              last_error, last_attempt_at, created_at, updated_at
         FROM friend_tag_side_effect_runs
        WHERE friend_id = ? AND tag_id = ? AND status != 'completed'
        ORDER BY step_key ASC`,
    )
    .bind(friendId, tagId)
    .all<FriendTagSideEffectRun>();
  return rows.results ?? [];
}

/**
 * 工程を走り始める印。試した回数をここで進める。
 *
 * 副作用のひとつ手前で立てる。処理ごと消えて結末が分からなくなった行は
 * running のまま残り、冪等でない工程は走り直さない判断材料になる。
 */
export async function markFriendTagSideEffectRunning(
  db: D1Database,
  friendId: string,
  tagId: string,
  stepKey: FriendTagSideEffectStep,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_tag_side_effect_runs
          SET status = 'running',
              attempt_count = attempt_count + 1,
              last_attempt_at = ?,
              updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?
          AND status != 'completed'`,
    )
    .bind(now, now, friendId, tagId, stepKey)
    .run();
}

/** 工程が済んだ印。 */
export async function markFriendTagSideEffectCompleted(
  db: D1Database,
  friendId: string,
  tagId: string,
  stepKey: FriendTagSideEffectStep,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_tag_side_effect_runs
          SET status = 'completed',
              last_error = NULL,
              updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?`,
    )
    .bind(now, friendId, tagId, stepKey)
    .run();
}

/**
 * 工程が落ちた印。理由を last_error に残す。
 *
 * 呼び出し口は .catch で握り潰していることがあるため、ここに残る行が
 * 「何が走らなかったか」を運用者が知る唯一の手がかりになる。
 */
export async function markFriendTagSideEffectFailed(
  db: D1Database,
  friendId: string,
  tagId: string,
  stepKey: FriendTagSideEffectStep,
  error: unknown,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friend_tag_side_effect_runs
          SET status = 'failed',
              last_error = ?,
              updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?`,
    )
    .bind(describeError(error), now, friendId, tagId, stepKey)
    .run();
}

/**
 * 未了の工程を古い順に返す。運用の確認と、将来の定期的な掃除口のため。
 *
 * 「同じ経路へもう一度来る」まで待たずに拾いたい場合、ここから引いて
 * 走り直す側 (apps/worker の retryFriendTagSideEffects) を呼べばよい。
 */
export async function listPendingFriendTagSideEffectRuns(
  db: D1Database,
  options: { limit?: number } = {},
): Promise<FriendTagSideEffectRun[]> {
  const limit = Math.max(1, Math.floor(options.limit ?? 100));
  const rows = await db
    .prepare(
      `SELECT friend_id, tag_id, step_key, assigned_at, status, attempt_count,
              last_error, last_attempt_at, created_at, updated_at
         FROM friend_tag_side_effect_runs
        WHERE status != 'completed'
        ORDER BY updated_at ASC, friend_id ASC, tag_id ASC, step_key ASC
        LIMIT ?`,
    )
    .bind(limit)
    .all<FriendTagSideEffectRun>();
  return rows.results ?? [];
}
