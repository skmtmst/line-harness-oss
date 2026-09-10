/*
 * タグ付与の工程別台帳(#699 / migration 376)。
 *
 * friend_tags への付与は INSERT OR IGNORE で先に確定する。そのあとに走る
 * 副作用が落ちると、次回同じ経路へ来ても changes=0 で早期 return するため、
 * 落ちた副作用は二度と走らない。付与の直後にここへ工程ごとの行を開き、
 * 「付与は済んだが未了の工程がある」状態を残す。
 *
 * 業務の正本は friend_tags のまま。この表は工程の進み具合だけを持つ。
 *
 * ## status は「何が起きたか」の記録でしかない
 *
 * 走り始めの印 (running) は副作用のひとつ手前で立つ。だから running と
 * failed の違いは「例外が呼び出し口まで届いたかどうか」だけで、**どこまで
 * 外へ出たかについては同じ情報量しか持たない**。
 *
 * 例: fireEvent('tag_change') は Phase 1 (送信 webhook + 加点) を
 * Promise.allSettled で済ませたあと、その先で落ちることがある。このとき
 * 加点も webhook も外へ出ているのに status は failed になる。failed を
 * 「走らなかった」と読むと、走り直しで二重に外へ出る。
 *
 * そこで **走り直してよいかは status ではなく工程で決める**
 * (FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM)。外へ出る工程は、結末が不明なら
 * 走り直さない。migration 375 の needs_reconcile・358 の dispatched_at と
 * 同じ既定。
 */
import { jstNow } from './utils';

/** タグ付与後に走る副作用の工程。付与のたびにこの3本を、この順に走らせる。 */
export const FRIEND_TAG_SIDE_EFFECT_STEPS = [
  'mileage',
  'scenario_enroll',
  'event_tag_change',
] as const;

export type FriendTagSideEffectStep = (typeof FRIEND_TAG_SIDE_EFFECT_STEPS)[number];

export type FriendTagSideEffectStatus = 'pending' | 'running' | 'failed' | 'completed';

/**
 * 工程ごとに、自動で走り直してよい遷移元。
 *
 * - `pending` … running の印が一度も立っていない = **副作用に入る前に終わった**。
 *   予約 (claimFriendTagSideEffectRun) が pending → running を1回の条件付き
 *   UPDATE で行うので、pending のまま残った行は確実に一度も走っていない。
 *   どの工程もここからは安全に走り直せる。
 * - `mileage` … 冪等キー `${friendId}:${tagId}:${assignedAt}` を
 *   recordEngagementEvent が弾く。走り直しは台帳の assigned_at を使うので
 *   キーが変わらない。running / failed からでも安全。
 * - `scenario_enroll` … ループ冒頭の存在確認 + idx_friend_scenarios_unique
 *   (部分UNIQUE索引) で二重登録にならない。running / failed からでも安全。
 * - `event_tag_change` … **外へ出る** (送信 webhook・加点)。running も failed も
 *   「出たかもしれない」なので走り直さない。人が「出ていない」と確かめた
 *   ときだけ reopenFriendTagSideEffectRun で pending へ戻す。
 */
export const FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM: Record<
  FriendTagSideEffectStep,
  readonly FriendTagSideEffectStatus[]
> = {
  mileage: ['pending', 'running', 'failed'],
  scenario_enroll: ['pending', 'running', 'failed'],
  event_tag_change: ['pending'],
};

/**
 * 走り直しの上限。落ち続ける行を無限に叩かない。
 * 超えた行は台帳に残り、止まっている行として数えられる。
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

/** 予約の結果。 */
export type FriendTagSideEffectClaim =
  /** 取れた。この呼び出しだけが走らせてよい。 */
  | 'claimed'
  /** 行はあるが取れない。済んでいる／他方が走っている／走り直してよい状態でない／上限。 */
  | 'not_claimable'
  /** 行が無い。台帳を開けなかったか、376 より前に付いたタグ。 */
  | 'missing';

/** last_error に残す長さの上限。理由の先頭だけで十分で、台帳を太らせない。 */
const LAST_ERROR_MAX_LENGTH = 500;

const RUN_COLUMNS = `friend_id, tag_id, step_key, assigned_at, status, attempt_count,
              last_error, last_attempt_at, created_at, updated_at`;

function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > LAST_ERROR_MAX_LENGTH ? text.slice(0, LAST_ERROR_MAX_LENGTH) : text;
}

/**
 * 「その工程が、その status から自動で走り直してよい」を SQL で表す断片。
 *
 * 上の表から組み立てる。SQL 側に集合を書き写すと表と SQL がずれるので、
 * 正本は TypeScript の表ひとつに置く。
 */
function retryableFromSql(): { sql: string; binds: string[] } {
  const parts: string[] = [];
  const binds: string[] = [];
  for (const step of FRIEND_TAG_SIDE_EFFECT_STEPS) {
    const from = FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM[step];
    parts.push(`(step_key = ? AND status IN (${from.map(() => '?').join(', ')}))`);
    binds.push(step, ...from);
  }
  return { sql: `(${parts.join(' OR ')})`, binds };
}

/** 工程の宣言順に並べる。初回と走り直しで順が逆転しないように。 */
function stepOrderSql(): { sql: string; binds: string[] } {
  const whens = FRIEND_TAG_SIDE_EFFECT_STEPS.map(() => 'WHEN ? THEN ?').join(' ');
  const binds: string[] = [];
  FRIEND_TAG_SIDE_EFFECT_STEPS.forEach((step, index) => binds.push(step, String(index)));
  return { sql: `CASE step_key ${whens} ELSE ? END`, binds: [...binds, String(99)] };
}

/** 自動で走り直してよい行か。安いふるい。**守りの正本は予約の SQL**。 */
export function canAutoRetryFriendTagSideEffect(run: FriendTagSideEffectRun): boolean {
  if (run.status === 'completed') return false;
  if (run.attempt_count >= FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS) return false;
  return FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM[run.step_key].includes(run.status);
}

/**
 * 止まっている行か。未了なのに自動では動かない = 人が見ないと進まない。
 *
 * at-most-once に倒したぶん、この判定に当たる行は放っておくと永久に欠けた
 * ままになる。countStuckFriendTagSideEffectRuns で数えられるようにしてある。
 */
export function isFriendTagSideEffectStuck(run: FriendTagSideEffectRun): boolean {
  return run.status !== 'completed' && !canAutoRetryFriendTagSideEffect(run);
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
 * 工程を**予約**する。取れた者だけが副作用を走らせてよい。
 *
 * 遷移条件 (工程ごとの遷移元) と上限を、status を running へ進める1回の
 * 条件付き UPDATE の WHERE に入れている。判断(読み)と占有(書き)を分けると、
 * 読んだ時点の状態が走る時点でも同じとは限らず、同時に来た2本が同じ工程を
 * 走らせる。migration 358・375 と同じ形。
 *
 * 取れなかったときに「行が無い」と「取れない」を分けるのは、呼び出し口で
 * 扱いが違うため。新規付与では台帳が開けていないだけのことがあり、そこで
 * 止めると付与だけが残って以前より悪くなる。
 */
export async function claimFriendTagSideEffectRun(
  db: D1Database,
  friendId: string,
  tagId: string,
  stepKey: FriendTagSideEffectStep,
): Promise<FriendTagSideEffectClaim> {
  const now = jstNow();
  const from = FRIEND_TAG_SIDE_EFFECT_RETRYABLE_FROM[stepKey];
  const result = await db
    .prepare(
      `UPDATE friend_tag_side_effect_runs
          SET status = 'running',
              attempt_count = attempt_count + 1,
              last_attempt_at = ?,
              updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?
          AND status IN (${from.map(() => '?').join(', ')})
          AND attempt_count < ?`,
    )
    .bind(
      now,
      now,
      friendId,
      tagId,
      stepKey,
      ...from,
      FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS,
    )
    .run();
  if ((result.meta?.changes ?? 0) > 0) return 'claimed';
  const existing = await getFriendTagSideEffectRun(db, friendId, tagId, stepKey);
  return existing ? 'not_claimable' : 'missing';
}

export async function getFriendTagSideEffectRun(
  db: D1Database,
  friendId: string,
  tagId: string,
  stepKey: FriendTagSideEffectStep,
): Promise<FriendTagSideEffectRun | null> {
  return await db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM friend_tag_side_effect_runs
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?`,
    )
    .bind(friendId, tagId, stepKey)
    .first<FriendTagSideEffectRun>();
}

/**
 * この (友だち, タグ) で未了の工程を、工程の宣言順に返す。走り直す側の入口。
 *
 * 台帳が無い古い付与 (376 より前に付いたタグ) は0件を返す。何が未了かを
 * 判断する材料が無いため、勝手に走り直して二重に副作用を出さない。
 */
export async function listUnfinishedFriendTagSideEffectRuns(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<FriendTagSideEffectRun[]> {
  const order = stepOrderSql();
  const rows = await db
    .prepare(
      `SELECT ${RUN_COLUMNS}
         FROM friend_tag_side_effect_runs
        WHERE friend_id = ? AND tag_id = ? AND status != 'completed'
        ORDER BY ${order.sql} ASC`,
    )
    .bind(friendId, tagId, ...order.binds)
    .all<FriendTagSideEffectRun>();
  return rows.results ?? [];
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
          SET status = 'completed', last_error = NULL, updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?`,
    )
    .bind(now, friendId, tagId, stepKey)
    .run();
}

/**
 * 工程が落ちた印。理由を last_error に残す。
 *
 * 呼び出し口は .catch で握り潰していることがあるため、ここに残る行が
 * 「何が走らなかったか」を知る手がかりになる。
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
          SET status = 'failed', last_error = ?, updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?`,
    )
    .bind(describeError(error), now, friendId, tagId, stepKey)
    .run();
}

/**
 * 止まっている行を pending へ戻す。**人が「外へ出ていない」と確かめたときだけ**
 * 使う口。非冪等な工程 (event_tag_change) を走り直す唯一の経路。
 *
 * attempt_count と last_error は消さない。上限が効いたまま、何が起きたかの
 * 履歴も残る。completed の行は戻さない(済んだものを走り直す口ではない)。
 */
export async function reopenFriendTagSideEffectRun(
  db: D1Database,
  friendId: string,
  tagId: string,
  stepKey: FriendTagSideEffectStep,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE friend_tag_side_effect_runs
          SET status = 'pending', updated_at = ?
        WHERE friend_id = ? AND tag_id = ? AND step_key = ?
          AND status != 'completed'`,
    )
    .bind(now, friendId, tagId, stepKey)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * 未了の工程を古い順に返す。タグが外された行は出さない(もう直せないので
 * 運用の導線を濁らせるだけ)。
 */
export async function listPendingFriendTagSideEffectRuns(
  db: D1Database,
  options: { limit?: number } = {},
): Promise<FriendTagSideEffectRun[]> {
  const limit = Math.max(1, Math.floor(options.limit ?? 100));
  const rows = await db
    .prepare(
      `SELECT ${RUN_COLUMNS}
         FROM friend_tag_side_effect_runs r
        WHERE r.status != 'completed'
          AND EXISTS (
                SELECT 1 FROM friend_tags ft
                 WHERE ft.friend_id = r.friend_id AND ft.tag_id = r.tag_id
              )
        ORDER BY r.updated_at ASC, r.friend_id ASC, r.tag_id ASC, r.step_key ASC
        LIMIT ?`,
    )
    .bind(limit)
    .all<FriendTagSideEffectRun>();
  return rows.results ?? [];
}

/**
 * **止まっている行**だけを古い順に返す。自動では動かないので、人が見ないと
 * 永久に欠けたままになる行。
 *
 * 判定は canAutoRetryFriendTagSideEffect と同じものを SQL で書いたもので、
 * 遷移元の表から組み立てている(表ひとつが正本)。
 */
export async function listStuckFriendTagSideEffectRuns(
  db: D1Database,
  options: { limit?: number } = {},
): Promise<FriendTagSideEffectRun[]> {
  const limit = Math.max(1, Math.floor(options.limit ?? 100));
  const retryable = retryableFromSql();
  const rows = await db
    .prepare(
      `SELECT ${RUN_COLUMNS}
         FROM friend_tag_side_effect_runs r
        WHERE r.status != 'completed'
          AND NOT (r.attempt_count < ? AND ${retryable.sql})
          AND EXISTS (
                SELECT 1 FROM friend_tags ft
                 WHERE ft.friend_id = r.friend_id AND ft.tag_id = r.tag_id
              )
        ORDER BY r.updated_at ASC, r.friend_id ASC, r.tag_id ASC, r.step_key ASC
        LIMIT ?`,
    )
    .bind(FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS, ...retryable.binds, limit)
    .all<FriendTagSideEffectRun>();
  return rows.results ?? [];
}

/**
 * 「いま止まっているものはあるか」を一問で返す口。
 *
 * at-most-once に倒したので、running / failed の行は自動では動かない。
 * それが「台帳に残っているが誰も見ない」で終わると、この票が直そうとした
 * 「タグは付いているのに副作用だけが黙って永久に欠ける」に戻る。
 */
export async function countStuckFriendTagSideEffectRuns(db: D1Database): Promise<number> {
  const retryable = retryableFromSql();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS stuck
         FROM friend_tag_side_effect_runs r
        WHERE r.status != 'completed'
          AND NOT (r.attempt_count < ? AND ${retryable.sql})
          AND EXISTS (
                SELECT 1 FROM friend_tags ft
                 WHERE ft.friend_id = r.friend_id AND ft.tag_id = r.tag_id
              )`,
    )
    .bind(FRIEND_TAG_SIDE_EFFECT_MAX_ATTEMPTS, ...retryable.binds)
    .first<{ stuck: number }>();
  return row?.stuck ?? 0;
}
