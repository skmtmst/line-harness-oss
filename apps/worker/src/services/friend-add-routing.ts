/**
 * 友だち追加時の配信の振り分け（設計 V2 4-6）。
 *
 * 友だち追加の通知が来たとき、相手が「はじめての人」か「以前からの友だち・
 * ブロックを解除した人」かを見て、流すシナリオを分ける。
 *
 * **置き場は `account_settings`。新しいテーブルは作っていない。**
 * `feature-settings.ts` と同じ判断（key/value の置き場が既にある）。
 */
import {
  getAccountSetting,
  setAccountSetting,
  getScenarios,
  enrollFriendInScenario,
  resumeFriendScenario,
  postMileageEntry,
  type FriendScenario,
} from '@line-crm/db';
import {
  FRIEND_ADD_ROUTING_DEFAULT,
  type FriendAddRouting,
  type FriendAddAction,
  type FriendAddBranch,
  type FriendAddFirstTimeCriterion,
  type FriendAddReturningMode,
  type FriendAddStartPosition,
  type FriendAddTiming,
} from '@line-crm/shared';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import type { ImmediatePushContext } from './immediate-first-step.js';

export const FRIEND_ADD_ROUTING_KEY = 'friend_add_routing';

/** 振り分けの判定に使う、友だちの最低限の情報。 */
export interface FriendAddSubject {
  id: string;
  unfollow_count?: number | null;
  first_followed_at?: string | null;
}

export type FriendKind = 'first_time' | 'returning';

// ── 読み書き ────────────────────────────────────────────────────────────────

function pickString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normalizeActions(value: unknown): FriendAddAction[] {
  if (!Array.isArray(value)) return [];
  const out: FriendAddAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const kind = (item as { kind?: unknown }).kind;
    if (kind === 'tag') {
      const tagId = (item as { tagId?: unknown }).tagId;
      if (typeof tagId === 'string' && tagId) out.push({ kind: 'tag', tagId });
    } else if (kind === 'mile') {
      const amount = (item as { amount?: unknown }).amount;
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
        out.push({ kind: 'mile', amount: Math.floor(amount) });
      }
    }
  }
  return out;
}

function normalizeScenarioId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * 保存された JSON を型に落とす。**壊れた値は既定に倒す。**
 * 設定の読み込みで例外を投げると、友だち追加そのものが落ちる。
 */
export function normalizeRouting(raw: unknown): FriendAddRouting {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const first = (obj.firstTime && typeof obj.firstTime === 'object'
    ? obj.firstTime
    : {}) as Record<string, unknown>;
  const ret = (obj.returning && typeof obj.returning === 'object'
    ? obj.returning
    : {}) as Record<string, unknown>;
  const crit = (obj.criteria && typeof obj.criteria === 'object'
    ? obj.criteria
    : {}) as Record<string, unknown>;

  return {
    firstTime: {
      scenarioId: normalizeScenarioId(first.scenarioId),
      timing: pickString<FriendAddTiming>(
        first.timing,
        ['immediate', 'scenario'],
        FRIEND_ADD_ROUTING_DEFAULT.firstTime.timing,
      ),
      actions: normalizeActions(first.actions),
    },
    returning: {
      scenarioId: normalizeScenarioId(ret.scenarioId),
      mode: pickString<FriendAddReturningMode>(
        ret.mode,
        ['none', 'other', 'same'],
        FRIEND_ADD_ROUTING_DEFAULT.returning.mode,
      ),
      startPosition: pickString<FriendAddStartPosition>(
        ret.startPosition,
        ['beginning', 'resume'],
        FRIEND_ADD_ROUTING_DEFAULT.returning.startPosition,
      ),
      actions: normalizeActions(ret.actions),
    },
    criteria: {
      firstTime: pickString<FriendAddFirstTimeCriterion>(
        crit.firstTime,
        ['unfollow_count_zero', 'first_followed_at_missing'],
        FRIEND_ADD_ROUTING_DEFAULT.criteria.firstTime,
      ),
    },
  };
}

/**
 * 保存済みの設定を読む。**まだ保存されていなければ `null`。**
 *
 * `null` と既定値を区別すること。設定していないアカウントは
 * 「friend_add シナリオを全部流す」という**いままでの挙動**のままにする。
 */
export async function loadFriendAddRouting(
  db: D1Database,
  accountId: string,
): Promise<FriendAddRouting | null> {
  const raw = await getAccountSetting(db, accountId, FRIEND_ADD_ROUTING_KEY);
  if (!raw) return null;
  try {
    return normalizeRouting(JSON.parse(raw));
  } catch {
    // 壊れた JSON が入っていても配信は止めない。設定していない扱いにする。
    console.error(`[friend-add-routing] broken JSON for account=${accountId}`);
    return null;
  }
}

export async function saveFriendAddRouting(
  db: D1Database,
  accountId: string,
  routing: FriendAddRouting,
): Promise<void> {
  await setAccountSetting(
    db,
    accountId,
    FRIEND_ADD_ROUTING_KEY,
    JSON.stringify(routing),
  );
}

// ── 判定 ────────────────────────────────────────────────────────────────────

/**
 * この人は「はじめて」か「以前から」か。
 *
 * 既定は `unfollow_count_zero`。ブロックしたことが一度も無ければ「はじめて」。
 * 友だち追加の通知はブロック解除でも飛ぶので、この経路ではこれで足りる。
 *
 * 設計の絵の `first_followed_at_missing`（初回フォロー日が未記録）は選べる形に
 * してあるが、**この環境では使えない**。マイグレーション 065 が既存の行すべてに
 * 初回フォロー日を埋めたので、未記録の人がもう居ない。選ぶと全員が
 * 「以前から」になる。画面でもその旨を出している。
 */
export function classifyFriend(
  friend: FriendAddSubject,
  criterion: FriendAddFirstTimeCriterion,
): FriendKind {
  if (criterion === 'first_followed_at_missing') {
    return friend.first_followed_at ? 'returning' : 'first_time';
  }
  return (friend.unfollow_count ?? 0) === 0 ? 'first_time' : 'returning';
}

// ── 実行 ────────────────────────────────────────────────────────────────────

async function runActions(
  db: D1Database,
  friendId: string,
  actions: FriendAddAction[],
  push?: ImmediatePushContext,
): Promise<void> {
  for (const action of actions) {
    try {
      if (action.kind === 'tag') {
        await attachTagAndFireSideEffects(db, friendId, action.tagId, push);
      } else if (action.kind === 'mile') {
        // 直接台帳へ1行入れる。付与ルール（/scoring）は「こういう行動をしたら
        // 何マイル」を決めるもので、友だち追加の1回だけの付与はここで足す。
        // idempotencyKey に friend を入れているので、同じ人に二重で入らない。
        await postMileageEntry(db, {
          beneficiaryFriendId: friendId,
          entryType: 'grant',
          amount: action.amount,
          reason: '友だち追加',
          source: 'friend_add_routing',
          sourceEventId: friendId,
          idempotencyKey: `friend_add_routing:${friendId}:${action.amount}`,
        });
      }
    } catch (err) {
      // 1つ失敗しても残りは実行する。配信そのものは止めない。
      console.error(`[friend-add-routing] action ${action.kind} failed:`, err);
    }
  }
}

export interface FriendAddEnrollment {
  scenarioId: string;
  enrollment: FriendScenario;
  /**
   * 「前回読んだところから」で既にある行を生かした場合 true。
   *
   * **このときは1通目を即時に送ってはいけない。** `pushImmediateFirstStep` は
   * 名前のとおり1通目を出すので、続きから再開した人にもう一度1通目が届く。
   * 再開のぶんは `next_delivery_at` を見て cron が次の通を出す。
   */
  resumed: boolean;
}

export interface FriendAddRoutingResult {
  /** 設定が無く、いままでどおり全部流す場合は false */
  routed: boolean;
  kind: FriendKind | null;
  /** 実際に登録した行 */
  enrollments: FriendAddEnrollment[];
  /** ①の「開始のタイミング」。呼ぶ側が即時に出すかを決める */
  timing: FriendAddTiming;
  /** 「配信しない」を選んでいて何も流さなかった場合 true */
  suppressed: boolean;
}

/**
 * 設定に従って登録する。
 *
 * **設定が保存されていないアカウントでは何もしない**（`routed: false`）。
 * 呼ぶ側は、そのときだけ従来どおり全 friend_add シナリオを流す。
 */
export async function applyFriendAddRouting(
  db: D1Database,
  accountId: string | null,
  friend: FriendAddSubject,
  push?: ImmediatePushContext,
): Promise<FriendAddRoutingResult> {
  const none: FriendAddRoutingResult = {
    routed: false,
    kind: null,
    enrollments: [],
    timing: FRIEND_ADD_ROUTING_DEFAULT.firstTime.timing,
    suppressed: false,
  };
  if (!accountId) return none;

  const routing = await loadFriendAddRouting(db, accountId);
  if (!routing) return none;

  const timing = routing.firstTime.timing;
  const kind = classifyFriend(friend, routing.criteria.firstTime);

  // ② で「配信しない」を選んでいる
  if (kind === 'returning' && routing.returning.mode === 'none') {
    await runActions(db, friend.id, routing.returning.actions, push);
    return { routed: true, kind, enrollments: [], timing, suppressed: true };
  }

  // ② が「はじめての人と同じもの」なら ① の設定を使う
  const useFirst = kind === 'first_time' || routing.returning.mode === 'same';
  const branch: FriendAddBranch = useFirst ? routing.firstTime : routing.returning;

  // シナリオを決めていない＝いままでどおり全部流す
  if (!branch.scenarioId) return none;

  // 「前回読んだところから」は ② の別シナリオを選んだときだけ意味がある
  const wantResume = !useFirst && routing.returning.startPosition === 'resume';

  const enrollments: FriendAddEnrollment[] = [];
  let record: FriendScenario | null = null;
  let resumed = false;
  if (wantResume) {
    record = await resumeFriendScenario(db, friend.id, branch.scenarioId);
    resumed = record !== null;
    // 続きが無い（読み終えている・そもそも入っていない）ときは最初から
    if (!record) record = await enrollFriendInScenario(db, friend.id, branch.scenarioId);
  } else {
    record = await enrollFriendInScenario(db, friend.id, branch.scenarioId);
  }
  if (record) {
    enrollments.push({ scenarioId: branch.scenarioId, enrollment: record, resumed });
  }

  await runActions(db, friend.id, branch.actions, push);

  return { routed: true, kind, enrollments, timing, suppressed: false };
}

/**
 * 画面の「テスト実行」用。**登録も配信もしない。**
 * この人ならどちらに振り分けられるかだけを返す。
 */
export async function previewFriendAddRouting(
  db: D1Database,
  accountId: string,
  friend: FriendAddSubject,
): Promise<{ configured: boolean; kind: FriendKind; scenarioId: string | null; suppressed: boolean }> {
  const routing = (await loadFriendAddRouting(db, accountId)) ?? FRIEND_ADD_ROUTING_DEFAULT;
  const configured = (await loadFriendAddRouting(db, accountId)) !== null;
  const kind = classifyFriend(friend, routing.criteria.firstTime);
  if (kind === 'returning' && routing.returning.mode === 'none') {
    return { configured, kind, scenarioId: null, suppressed: true };
  }
  const useFirst = kind === 'first_time' || routing.returning.mode === 'same';
  const branch = useFirst ? routing.firstTime : routing.returning;
  return { configured, kind, scenarioId: branch.scenarioId, suppressed: false };
}

/** 画面が選択肢を出すための friend_add シナリオ一覧。 */
export async function listFriendAddScenarios(
  db: D1Database,
  accountId: string | null,
): Promise<{ id: string; name: string }[]> {
  const scenarios = await getScenarios(db);
  return scenarios
    .filter(
      s =>
        s.trigger_type === 'friend_add' &&
        (!s.line_account_id || !accountId || s.line_account_id === accountId),
    )
    .map(s => ({ id: s.id, name: s.name }));
}
