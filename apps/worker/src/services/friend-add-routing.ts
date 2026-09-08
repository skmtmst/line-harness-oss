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
  type FriendAddRuleDefinition,
  ensureFriendAddFallbackRules,
} from '@line-crm/db';
import {
  FRIEND_ADD_ROUTING_DEFAULT,
  toJstParts,
  type FriendAddRouting,
  type FriendAddAction,
  type FriendAddBranch,
  type FriendAddFirstTimeCriterion,
  type FriendAddReturningMode,
  type FriendAddRowActionType,
  type FriendAddStartPosition,
  type FriendAddTiming,
} from '@line-crm/shared';
import { toJstString } from '@line-crm/db';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import type { ImmediatePushContext } from './immediate-first-step.js';
import { matchesCondition, parseCondition } from './segment-query.js';

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

const ROW_ACTION_TYPES = ['tag', 'friend_field', 'support_mark', 'scenario', 'common_var'] as const;

function normalizeActions(value: unknown): FriendAddAction[] {
  if (!Array.isArray(value)) return [];
  const out: FriendAddAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const kind = (item as { kind?: unknown }).kind;
    if (kind === 'tag') {
      /*
       * 古い形。**読むときに新しい形へ直す。**
       *
       * 以前は「タグを1つ付ける」しかできなかった。外すこともフォルダを
       * 指定することもできない。シナリオ側には同じことをする仕組みが
       * あるので、そちらへ寄せた。既に保存されている設定を読めなくすると
       * 「設定が消えた」ことになるので、ここで直す。
       */
      const tagId = (item as { tagId?: unknown }).tagId;
      if (typeof tagId === 'string' && tagId) {
        out.push({ kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [tagId] } });
      }
    } else if (kind === 'mile') {
      const amount = (item as { amount?: unknown }).amount;
      if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
        out.push({ kind: 'mile', amount: Math.floor(amount) });
      }
    } else if (kind === 'row') {
      const actionType = (item as { actionType?: unknown }).actionType;
      if (typeof actionType === 'string' && (ROW_ACTION_TYPES as readonly string[]).includes(actionType)) {
        out.push({
          kind: 'row',
          actionType: actionType as FriendAddRowActionType,
          config: (item as { config?: unknown }).config ?? {},
        });
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

// ── 実行時条件（曜日・時間帯・友だち条件・再送制限） ─────────────────────────
// N-101: 公開版に保存できる曜日・時間帯・友だち条件・再送制限を、
// 本番の振り分けでも実際に効かせる。競合確認（routes/friend-add-rules.ts）
// と同じ関数・同じ意味で判定する。

/** 配信しなかった理由。実行結果（friend_add_events.error_code）へ載せる想定。 */
export type FriendAddSuppressReason =
  | 'outside_weekday'
  | 'outside_time_window'
  | 'friend_condition_not_met'
  | 'friend_condition_unreadable'
  | 'resend_suppressed'
  | 'delivery_disabled';

/** JSTの現在時刻を "HH:MM" で返す。WorkersはUTCで動くので自前でずらす。 */
export function friendAddJstHhmm(at: Date): string {
  const { minutes } = toJstParts(at);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 曜日指定を正規化する。空は「すべての曜日」。 */
export function normalizeFriendAddWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter((day): day is number => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6),
  )];
}

function parseHhMmToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const matched = /^(\d{2}):(\d{2})$/.exec(value);
  if (!matched) return null;
  const hours = Number(matched[1]);
  const mins = Number(matched[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

export interface FriendAddTimeWindow {
  start: string;
  end: string;
}

/** 読める時間帯だけ残す。読めない帯は無いものとして飛ばす（保存側で弾くのが本筋）。 */
export function normalizeFriendAddTimeWindows(value: unknown): FriendAddTimeWindow[] {
  if (!Array.isArray(value)) return [];
  const out: FriendAddTimeWindow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { start, end } = item as { start?: unknown; end?: unknown };
    if (parseHhMmToMinutes(start) == null || parseHhMmToMinutes(end) == null) continue;
    out.push({ start: start as string, end: end as string });
  }
  return out;
}

/**
 * 1つの時間帯の中かどうか。終わりは含まない（自動応答と同じ規則）。
 * 開始と終了が同じ（09:00〜09:00）は24時間と読む。日跨ぎ（22:00〜02:00）は
 * 夜から翌朝までと読む。どちらも自動応答の判定とそろえてある。
 */
export function isTimeInFriendAddWindow(nowMinutes: number, window: FriendAddTimeWindow): boolean {
  const start = parseHhMmToMinutes(window.start);
  const end = parseHhMmToMinutes(window.end);
  if (start == null || end == null) return true;
  if (start === end) return true;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

/** いずれかの時間帯の中かどうか。帯が無ければいつでもよい。 */
export function isInFriendAddTimeWindows(nowHhmm: string, windows: FriendAddTimeWindow[]): boolean {
  const valid = normalizeFriendAddTimeWindows(windows);
  if (valid.length === 0) return true;
  const now = parseHhMmToMinutes(nowHhmm);
  if (now == null) return true;
  return valid.some((window) => isTimeInFriendAddWindow(now, window));
}

/**
 * 判定に使う曜日。日跨ぎの帯の「翌日側」（金曜22:00〜02:00の土曜01:00）に
 * いるときは、始まった側（金曜）で見る。店主の頭の中の「金曜の夜」に合わせる。
 * 自動応答の isOnRespondingDay と同じ考え。
 */
export function effectiveFriendAddWeekday(at: Date, windows: FriendAddTimeWindow[]): number {
  const { weekday } = toJstParts(at);
  const now = toJstParts(at).minutes;
  const inCarryOver = normalizeFriendAddTimeWindows(windows).some((window) => {
    const start = parseHhMmToMinutes(window.start);
    const end = parseHhMmToMinutes(window.end);
    return start != null && end != null && start > end && now < end;
  });
  if (!inCarryOver) return weekday;
  return toJstParts(new Date(at.getTime() - 24 * 60 * 60 * 1000)).weekday;
}

/** 応答する曜日かどうか。指定が無ければいつでもよい。 */
export function isOnFriendAddWeekday(at: Date, weekdays: unknown, windows: FriendAddTimeWindow[]): boolean {
  const days = normalizeFriendAddWeekdays(weekdays);
  if (days.length === 0) return true;
  return days.includes(effectiveFriendAddWeekday(at, windows));
}

/** 曜日・時間帯の両方を見る。曜日を先に報告する（Issueの完了条件の順番）。 */
export function evaluateFriendAddSchedule(
  definition: Pick<FriendAddRuleDefinition, 'weekdays' | 'timeWindows'>,
  at: Date,
): { matched: boolean; reason: Extract<FriendAddSuppressReason, 'outside_weekday' | 'outside_time_window'> | null } {
  const windows = normalizeFriendAddTimeWindows(definition.timeWindows);
  if (!isOnFriendAddWeekday(at, definition.weekdays, windows)) {
    return { matched: false, reason: 'outside_weekday' };
  }
  if (!isInFriendAddTimeWindows(friendAddJstHhmm(at), windows)) {
    return { matched: false, reason: 'outside_time_window' };
  }
  return { matched: true, reason: null };
}

function splitFriendAddWindow(window: FriendAddTimeWindow): Array<{ start: number; end: number }> {
  const start = parseHhMmToMinutes(window.start);
  const end = parseHhMmToMinutes(window.end);
  if (start == null || end == null) return [];
  if (start === end) return [{ start: 0, end: 24 * 60 }];
  if (start < end) return [{ start, end }];
  return [{ start, end: 24 * 60 }, { start: 0, end }];
}

/**
 * 2つの時間帯リストが重なるか（競合確認用）。終わりを含まない半開区間で見て、
 * 日跨ぎは2つに割ってから突き合わせる。どちらかが空なら重なりは報告しない
 * （絞っていないもの同士・片方だけの絞りは競合ではない）。
 */
export function doFriendAddTimeWindowsOverlap(
  a: unknown,
  b: unknown,
): boolean {
  const left = normalizeFriendAddTimeWindows(a).flatMap(splitFriendAddWindow);
  const right = normalizeFriendAddTimeWindows(b).flatMap(splitFriendAddWindow);
  if (left.length === 0 || right.length === 0) return false;
  return left.some((l) => right.some((r) => l.start < r.end && r.start < l.end));
}

/** 曜日の重なり（競合確認用）。どちらかが空なら報告しない。 */
export function doFriendAddWeekdaySetsOverlap(a: unknown, b: unknown): boolean {
  const left = normalizeFriendAddWeekdays(a);
  const right = normalizeFriendAddWeekdays(b);
  if (left.length === 0 || right.length === 0) return false;
  return right.some((day) => left.includes(day));
}

/** 友だち条件の字面をそろえる。前後の空白だけ落とし、中身の意味は変えない。 */
export function normalizeFriendAddCondition(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 友だち条件の重なり（競合確認用）。どちらかが空なら報告しない。
 * 本番と同じく字面の一致で見る。構造化JSONと自由文を区別しない。
 */
export function areFriendAddConditionsOverlapping(a: unknown, b: unknown): boolean {
  const left = normalizeFriendAddCondition(a);
  const right = normalizeFriendAddCondition(b);
  return Boolean(left) && left === right;
}

/**
 * 友だち条件を実データで評価する。
 *
 * - 空は制限なし（通す）。
 * - Segment条件JSONとして読める値は friends 実データで評価する。
 *   読めないJSON（`{` `[` で始まるのに壊れている）は通さない。
 *   絞ったつもりが全員に届くほうが、届かないより取り返しがつかない
 *   （自動応答の友だち条件と同じ倒し方）。
 * - JSON以外の自由文は社内メモとして通す。ここで止めると、メモを書いた
 *   既存ルールがすべて止まる。構造化したい場合は別Issueで入力欄の分離と
 *   移行が必要（残した点としてIssueへ報告する）。
 */
export async function evaluateFriendAddFriendCondition(
  db: D1Database,
  definition: Pick<FriendAddRuleDefinition, 'friendCondition'>,
  friendId: string,
): Promise<{
  matched: boolean;
  reason: Extract<FriendAddSuppressReason, 'friend_condition_not_met' | 'friend_condition_unreadable'> | null;
}> {
  const raw = normalizeFriendAddCondition(definition.friendCondition);
  if (!raw) return { matched: true, reason: null };
  const condition = parseCondition(raw);
  if (!condition) {
    if (raw.startsWith('{') || raw.startsWith('[')) {
      console.error('[friend-add-routing] unreadable friendCondition — skipped the rule');
      return { matched: false, reason: 'friend_condition_unreadable' };
    }
    return { matched: true, reason: null };
  }
  const matches = await matchesCondition(db, friendId, condition);
  return matches
    ? { matched: true, reason: null }
    : { matched: false, reason: 'friend_condition_not_met' };
}

/**
 * 再送制限にかかっているか。直近に「送信済み（completed）」の実行があれば抑止する。
 * 抑止された実行（suppressed）・失敗・処理中は数えない。送っていないものを
 * 数えると、送れなかった人が永久に送れなくなる。
 * 時間数は公開版の値を使い、未設定は24時間（保存側の既定と同じ）に倒す。
 */
export async function isFriendAddResendSuppressed(
  db: D1Database,
  input: { lineAccountId: string; friendId: string; resendSuppressionHours: unknown; now: Date },
): Promise<boolean> {
  const hours = input.resendSuppressionHours == null
    ? 24
    : Math.max(0, Math.min(720, Math.floor(Number(input.resendSuppressionHours))));
  if (!Number.isFinite(hours) || hours <= 0) return false;
  // 文字列比較が崩れないよう、DBのJST書式（+09:00無し）にそろえる。
  const threshold = toJstString(new Date(input.now.getTime() - hours * 60 * 60 * 1000)).slice(0, 23);
  try {
    const row = await db.prepare(
      `SELECT 1 AS ok FROM friend_add_events
        WHERE line_account_id = ? AND friend_id = ?
          AND occurred_at >= ? AND routing_status = 'completed'
        LIMIT 1`,
    ).bind(input.lineAccountId, input.friendId, threshold).first<{ ok: number }>();
    return row != null;
  } catch (error) {
    // DB更新より先にWorkerだけが切り替わった短い時間は、旧設定へ安全に戻す。
    if (error instanceof Error && error.message.includes('no such table: friend_add_events')) return false;
    throw error;
  }
}

/**
 * 1つの公開版が「いま・この人」に動くか。安い順（曜日・時間帯→友だち条件→
 * 再送制限）に見て、最初に止めた理由だけを返す。競合確認の表示と本番の
 * 判定で意味がずれないよう、どちらもこの関数群を通す。
 */
export async function evaluateFriendAddRuleConditions(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    definition: FriendAddRuleDefinition;
    now: Date;
  },
): Promise<{ matched: boolean; reason: FriendAddSuppressReason | null }> {
  const schedule = evaluateFriendAddSchedule(input.definition, input.now);
  if (!schedule.matched) return { matched: false, reason: schedule.reason };
  const condition = await evaluateFriendAddFriendCondition(db, input.definition, input.friendId);
  if (!condition.matched) return { matched: false, reason: condition.reason };
  const suppressed = await isFriendAddResendSuppressed(db, {
    lineAccountId: input.lineAccountId,
    friendId: input.friendId,
    resendSuppressionHours: input.definition.resendSuppressionHours,
    now: input.now,
  });
  if (suppressed) return { matched: false, reason: 'resend_suppressed' };
  return { matched: true, reason: null };
}

// ── 実行 ────────────────────────────────────────────────────────────────────

async function runActions(
  db: D1Database,
  friendId: string,
  actions: FriendAddAction[],
  push?: ImmediatePushContext,
): Promise<void> {
  /*
   * シナリオと同じアクションは、シナリオと同じところで実行する。
   *
   * 自前で書くと、条件付き実行・順次実行・失敗の切り離しを2か所で
   * 保つことになり、必ずどちらかがずれる。行の形だけ合わせて渡す。
   * `scenario_id` などはシナリオ側の都合の列なので、ここでは空で埋める。
   */
  const rows = actions
    .filter((a): a is Extract<FriendAddAction, { kind: 'row' }> => a.kind === 'row')
    .map((a, i) => ({
      id: `friend-add-${i}`,
      scenario_id: '',
      hook: 'on_enroll' as const,
      step_id: null,
      choice_index: null,
      sort_order: i,
      action_type: a.actionType,
      config_json: JSON.stringify(a.config ?? {}),
      condition_json: null,
      repeat_on_refire: 1,
    }));
  if (rows.length > 0) {
    try {
      const { runActionRows } = await import('./scenario-actions.js');
      await runActionRows(db, rows as never, friendId);
    } catch (err) {
      // 1つ失敗しても配信は止めない。
      console.error('[friend-add-routing] row actions failed:', err);
    }
  }

  for (const action of actions) {
    try {
      if (action.kind === 'tag') {
        // 読み込みで row へ直しているので、ここへは来ない。古い保存を
        // そのまま渡された場合の保険として残す。
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
  /**
   * 抑止した理由。送信したとき・設定が無いときは null。
   * 呼ぶ側は実行結果（friend_add_events.error_code）へ載せて追跡できる。
   */
  suppressReason: FriendAddSuppressReason | null;
  /** V6の複数ルールで選ばれた設定と公開版。旧設定ではどちらもnull。 */
  ruleId: string | null;
  ruleVersionId: string | null;
}

function ruleActions(value: unknown[]): FriendAddAction[] {
  const actions: FriendAddAction[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const action = item as {
      type?: unknown;
      targetId?: unknown;
      tagId?: unknown;
      amount?: unknown;
      kind?: unknown;
      actionType?: unknown;
      config?: Record<string, unknown>;
    };
    // migration 290で旧JSONの共通アクションをそのまま固定した公開版も読める。
    if (action.kind === 'row' && typeof action.actionType === 'string') {
      actions.push({ kind: 'row', actionType: action.actionType as FriendAddRowActionType, config: action.config ?? {} });
      continue;
    }
    if (action.kind === 'tag' && typeof action.tagId === 'string' && action.tagId) {
      actions.push({ kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [action.tagId] } });
      continue;
    }
    if (action.kind === 'mile' && typeof action.amount === 'number' && action.amount > 0) {
      actions.push({ kind: 'mile', amount: Math.floor(action.amount) });
      continue;
    }
    const targetId = typeof action.targetId === 'string' ? action.targetId : '';
    if (action.type === 'add_tag' && targetId) {
      actions.push({ kind: 'row', actionType: 'tag', config: { op: 'add', tagIds: [targetId] } });
    } else if (action.type === 'remove_tag' && targetId) {
      actions.push({ kind: 'row', actionType: 'tag', config: { op: 'remove', tagIds: [targetId] } });
    } else if (action.type === 'start_scenario' && targetId) {
      actions.push({ kind: 'row', actionType: 'scenario', config: { op: 'start', scenarioId: targetId, restart: 'from_start' } });
    }
  }
  return actions;
}

interface PublishedFriendAddCandidate {
  ruleId: string;
  versionId: string;
  isFallback: boolean;
  definition: FriendAddRuleDefinition;
}

async function loadPublishedFriendAddCandidates(
  db: D1Database,
  input: { accountId: string; kind: FriendKind; entryRouteId: string | null },
): Promise<PublishedFriendAddCandidate[]> {
  try {
    const result = await db.prepare(
      `SELECT r.id AS rule_id, v.id AS version_id, r.is_unknown_route_fallback AS is_fallback,
              v.definition_snapshot
         FROM friend_add_rules r
         JOIN friend_add_rule_versions v ON v.id = r.current_version_id AND v.status = 'published'
        WHERE r.line_account_id = ? AND r.friend_kind = ?
          AND r.status = 'published' AND r.archived_at IS NULL
          AND (
            (r.is_unknown_route_fallback = 0 AND ? IS NOT NULL AND EXISTS (
              SELECT 1 FROM json_each(v.definition_snapshot, '$.routeIds') WHERE value = ?
            ))
            OR r.is_unknown_route_fallback = 1
          )
          AND (json_extract(v.definition_snapshot, '$.activeFrom') IS NULL
               OR json_extract(v.definition_snapshot, '$.activeFrom') <= strftime('%Y-%m-%dT%H:%M', 'now', '+9 hours'))
          AND (json_extract(v.definition_snapshot, '$.activeUntil') IS NULL
               OR json_extract(v.definition_snapshot, '$.activeUntil') >= strftime('%Y-%m-%dT%H:%M', 'now', '+9 hours'))
        ORDER BY r.is_unknown_route_fallback ASC, r.priority ASC, r.created_at ASC`,
    ).bind(input.accountId, input.kind, input.entryRouteId, input.entryRouteId).all<{
      rule_id: string;
      version_id: string;
      is_fallback: number;
      definition_snapshot: string;
    }>();
    return (result.results ?? []).map((row) => ({
      ruleId: row.rule_id,
      versionId: row.version_id,
      isFallback: row.is_fallback === 1,
      definition: JSON.parse(row.definition_snapshot) as FriendAddRuleDefinition,
    }));
  } catch (error) {
    // DB更新より先にWorkerだけが切り替わった短い時間は、旧設定へ安全に戻す。
    if (error instanceof Error && error.message.includes('no such table: friend_add_rules')) return [];
    throw error;
  }
}

interface PublishedFriendAddSelection {
  /** 条件をすべて通った公開版。無ければ null。 */
  selected: PublishedFriendAddCandidate | null;
  /** 抑止したときに評価していた公開版（理由の追跡用）。送信時・設定無しは null。 */
  evaluated: PublishedFriendAddCandidate | null;
  reason: FriendAddSuppressReason | null;
}

/**
 * 優先順位どおりに公開版を選び、曜日・時間帯・友だち条件・再送制限も見る。
 *
 * 2段階で選ぶ。受け皿は「経路が分からなかった人」のためだけに残す。
 *
 * 1. 流入経路に合う通常ルールを優先順位順に見る。条件をすべて通った最初の
 *    1件が勝ち。経路は合うが条件に合わないものしか無いときは、受け皿へ
 *    落とさず抑止する（経路が分かっている人に「経路不明の人用」を届けない）。
 * 2. 通常ルールが経路に1件も合わないときだけ、受け皿を見る。
 *
 * 再送制限で止まったときは下の順位を試さない。送ったばかりの人に別の
 * シナリオを送ると、制限を付けた意味が無くなる。
 */
async function selectPublishedFriendAddRule(
  db: D1Database,
  input: {
    accountId: string;
    friendId: string;
    kind: FriendKind;
    entryRouteId: string | null;
    now: Date;
  },
): Promise<PublishedFriendAddSelection> {
  const none = { selected: null, evaluated: null, reason: null } as PublishedFriendAddSelection;
  const candidates = await loadPublishedFriendAddCandidates(db, input);
  if (candidates.length === 0) return none;
  const check = async (
    candidate: PublishedFriendAddCandidate,
  ): Promise<{ matched: boolean; reason: FriendAddSuppressReason | null }> =>
    evaluateFriendAddRuleConditions(db, {
      lineAccountId: input.accountId,
      friendId: input.friendId,
      definition: candidate.definition,
      now: input.now,
    });

  const routed = candidates.filter((candidate) => !candidate.isFallback);
  let firstFailure: { candidate: PublishedFriendAddCandidate; reason: FriendAddSuppressReason } | null = null;
  for (const candidate of routed) {
    const result = await check(candidate);
    if (result.matched) return { selected: candidate, evaluated: candidate, reason: null };
    if (result.reason === 'resend_suppressed') {
      return { selected: null, evaluated: candidate, reason: result.reason };
    }
    firstFailure ??= { candidate, reason: result.reason ?? 'outside_time_window' };
  }
  if (firstFailure) {
    return { selected: null, evaluated: firstFailure.candidate, reason: firstFailure.reason };
  }
  for (const candidate of candidates.filter((candidate) => candidate.isFallback)) {
    const result = await check(candidate);
    if (result.matched) return { selected: candidate, evaluated: candidate, reason: null };
    if (result.reason === 'resend_suppressed') {
      return { selected: null, evaluated: candidate, reason: result.reason };
    }
    firstFailure ??= { candidate, reason: result.reason ?? 'outside_time_window' };
  }
  if (firstFailure) {
    return { selected: null, evaluated: firstFailure.candidate, reason: firstFailure.reason };
  }
  return none;
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
  routingContext?: { entryRouteId?: string | null; now?: Date },
): Promise<FriendAddRoutingResult> {
  const none: FriendAddRoutingResult = {
    routed: false,
    kind: null,
    enrollments: [],
    timing: FRIEND_ADD_ROUTING_DEFAULT.firstTime.timing,
    suppressed: false,
    suppressReason: null,
    ruleId: null,
    ruleVersionId: null,
  };
  if (!accountId) return none;

  const now = routingContext?.now ?? new Date();
  const kind = classifyFriend(friend, FRIEND_ADD_ROUTING_DEFAULT.criteria.firstTime);
  await ensureFriendAddFallbackRules(db, accountId);
  const selection = await selectPublishedFriendAddRule(db, {
    accountId,
    friendId: friend.id,
    kind,
    entryRouteId: routingContext?.entryRouteId ?? null,
    now,
  });
  const matchedRule = selection.selected;
  /*
   * 経路は合うが曜日・時間帯・友だち条件・再送制限に止まった。
   * 送らず、どの公開版のどの理由かだけ残す。送信済みにはしない
   * （enrollment を作らず deliveryCount も上げないのは呼ぶ側の仕事）。
   */
  if (!matchedRule && selection.evaluated && selection.reason) {
    return {
      routed: true,
      kind,
      enrollments: [],
      timing: selection.evaluated.definition.timing,
      suppressed: true,
      suppressReason: selection.reason,
      ruleId: selection.evaluated.ruleId,
      ruleVersionId: selection.evaluated.versionId,
    };
  }
  const routing = matchedRule
    ? {
        firstTime: {
          scenarioId: matchedRule.definition.scenarioId,
          timing: matchedRule.definition.timing,
          actions: ruleActions(matchedRule.definition.actions),
        },
        returning: {
          scenarioId: matchedRule.definition.scenarioId,
          mode: matchedRule.definition.returningMode ?? 'other',
          startPosition: matchedRule.definition.startPosition ?? 'beginning',
          actions: ruleActions(matchedRule.definition.actions),
        },
        criteria: FRIEND_ADD_ROUTING_DEFAULT.criteria,
      } satisfies FriendAddRouting
    : await loadFriendAddRouting(db, accountId);
  if (!routing) return none;

  const timing = routing.firstTime.timing;
  const classifiedKind = matchedRule ? kind : classifyFriend(friend, routing.criteria.firstTime);

  // ② で「配信しない」を選んでいる
  if (classifiedKind === 'returning' && routing.returning.mode === 'none') {
    await runActions(db, friend.id, routing.returning.actions, push);
    return {
      routed: true,
      kind: classifiedKind,
      enrollments: [],
      timing,
      suppressed: true,
      suppressReason: 'delivery_disabled',
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
    };
  }

  // ② が「はじめての人と同じもの」なら ① の設定を使う
  const useFirst = classifiedKind === 'first_time' || routing.returning.mode === 'same';
  const branch: FriendAddBranch = useFirst ? routing.firstTime : routing.returning;

  /*
   * シナリオを決めていない。
   *
   * ①（はじめての人）で決めていないのは**意図した設定**。画面にも
   * 「決めていない（有効なシナリオを全部流す）」と書いてある。従来どおり流す。
   *
   * ②で「別のシナリオを配信する」を選んでシナリオが空なのは**書きかけ**。
   * ここで従来どおりに落とすと、**有効な友だち追加シナリオが全部流れる**。
   * この画面は「以前からのお客さまに『はじめまして』を届けない」ために
   * あるのに、書きかけの設定がいちばん困る結果（全部届く）になる。
   *
   * 送らないほうへ倒す。「別のシナリオ」と決めた人が、そのシナリオを
   * 選び忘れただけで全部届くよりは、何も届かないほうがまだ直せる。
   * 画面側でも保存させないようにしてある。
   */
  if (!branch.scenarioId) {
    if (matchedRule) {
      await runActions(db, friend.id, branch.actions, push);
      return {
        routed: true,
        kind: classifiedKind,
        enrollments: [],
        timing,
        suppressed: true,
        suppressReason: 'delivery_disabled',
        ruleId: matchedRule.ruleId,
        ruleVersionId: matchedRule.versionId,
      };
    }
    if (classifiedKind === 'returning' && routing.returning.mode === 'other') {
      console.warn(
        `[friend-add-routing] ②で「別のシナリオ」を選んでシナリオが未設定のため配信しません`
        + `（friend=${friend.id}）。画面の設定を見直してください。`,
      );
      await runActions(db, friend.id, routing.returning.actions, push);
      return {
        routed: true,
        kind: classifiedKind,
        enrollments: [],
        timing,
        suppressed: true,
        suppressReason: 'delivery_disabled',
        ruleId: null,
        ruleVersionId: null,
      };
    }
    return none;
  }

  /*
   * 「前回読んだところから」は、**②に当たる人すべて**で意味がある。
   *
   * 以前は「別のシナリオを選んだとき」だけに絞っていたが、
   * 「はじめての人と同じものを配信する」を選んでいるアカウントで、
   * **ブロックを解除した人に何も届かない**という壊れ方をしていた。
   *
   * ブロック中に購読が止まっている（status='paused'）と、
   * `enrollFriendInScenario` は部分UNIQUE索引（status != 'completed'）に
   * 弾かれて null を返す。resume も呼ばれないので、止まったまま何も起きない。
   * 解除した本人にも、設定した人にも、何が起きていないのか分からない。
   *
   * ①（はじめての人）では効かせない。履歴が無いので resume は必ず空振りし、
   * 呼ぶだけ1クエリ増える。
   */
  const wantResume = classifiedKind === 'returning' && routing.returning.startPosition === 'resume';

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

  return {
    routed: true,
    kind: classifiedKind,
    enrollments,
    timing,
    suppressed: false,
    suppressReason: null,
    ruleId: matchedRule?.ruleId ?? null,
    ruleVersionId: matchedRule?.versionId ?? null,
  };
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
  const savedRouting = await loadFriendAddRouting(db, accountId);
  const routing = savedRouting ?? FRIEND_ADD_ROUTING_DEFAULT;
  const configured = savedRouting !== null;
  return { configured, ...previewFriendAddRoutingDefinition(routing, friend) };
}

/**
 * 下書きのdry-runと本番前確認が共有する判定器。
 * DBへの登録・配信・タグ付けは行わず、実行時と同じ分岐だけを返す。
 */
export function previewFriendAddRoutingDefinition(
  routing: FriendAddRouting,
  friend: FriendAddSubject,
): { kind: FriendKind; scenarioId: string | null; suppressed: boolean; actionCount: number } {
  const kind = classifyFriend(friend, routing.criteria.firstTime);
  if (kind === 'returning' && routing.returning.mode === 'none') {
    return {
      kind,
      scenarioId: null,
      suppressed: true,
      actionCount: routing.returning.actions.length,
    };
  }
  const useFirst = kind === 'first_time' || routing.returning.mode === 'same';
  const branch = useFirst ? routing.firstTime : routing.returning;
  return {
    kind,
    scenarioId: branch.scenarioId,
    suppressed: false,
    actionCount: branch.actions.length,
  };
}

/** 画面が選択肢を出すための friend_add シナリオ一覧。 */
export async function listFriendAddScenarios(
  db: D1Database,
  accountId: string | null,
): Promise<{ id: string; name: string }[]> {
  /*
   * 候補は**すべてのシナリオ**にする。
   *
   * これまで trigger_type === 'friend_add' のものだけを出していたので、
   * 「このシナリオを友だち追加で流したい」と思っても、シナリオ側の設定を
   * 先に変えないと選べなかった。呼ぶ側で選ぶのが自然なので、ここで絞らない。
   *
   * アカウント違いだけは外す。他のアカウントのシナリオを選んでも配れない。
   */
  const scenarios = await getScenarios(db);
  return scenarios
    .filter(s => !s.line_account_id || !accountId || s.line_account_id === accountId)
    .map(s => ({ id: s.id, name: s.name }));
}
