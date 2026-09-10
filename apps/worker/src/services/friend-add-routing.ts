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
import {
  buildSegmentWhere,
  matchesCondition,
  parseCondition,
  type SegmentCondition,
  type SegmentRule,
} from './segment-query.js';

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
  | 'invalid_time_window'
  | 'friend_condition_not_met'
  | 'friend_condition_unreadable'
  | 'resend_suppressed'
  | 'delivery_disabled'
  | 'duplicate_in_flight'
  | 'send_claim_unavailable'
  /** 条件木が読めない・組み立てられない（入れ子まで再帰検証して弾いた）。 */
  | 'friend_condition_invalid'
  /** 設定が別アカウントのタグ・シナリオ・友だち情報欄を指している。 */
  | 'reference_out_of_account'
  /** 送信権を回収された古い持ち主。勝った側が送るのでここでは送らない。 */
  | 'send_right_revoked'
  /**
   * 送ったかどうか分からない。前の持ち主が送信を始めたまま消えた、
   * あるいは送信の結末を確かめられなかった。自動では送り直さない。
   */
  | 'delivery_unknown';

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

/** "HH:MM"（00:00〜23:59）として読めるか。保存側の入力拒否と実行時の検査で共有する。 */
export function isValidFriendAddHhmm(value: unknown): boolean {
  return parseHhMmToMinutes(value) != null;
}

/**
 * 読めない時間帯が混ざっているか。不正な帯は「制限なし」に読み替えず、
 * 送らない側（fail-closed）に倒すため、判定の前にこれを見る。
 */
export function hasInvalidFriendAddTimeWindows(value: unknown): boolean {
  // 欄自体がない（昔の設定）は制限なし。あるのに配列でない壊れた値は不正。
  if (value == null) return false;
  if (!Array.isArray(value)) return true;
  return value.some((item) => {
    if (!item || typeof item !== 'object') return true;
    const { start, end } = item as { start?: unknown; end?: unknown };
    return !isValidFriendAddHhmm(start) || !isValidFriendAddHhmm(end);
  });
}

/** 読める時間帯だけ残す。読めない帯の扱いは hasInvalidFriendAddTimeWindows が決める。 */
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

/**
 * その帯の「いま」が属する曜日を返す。日跨ぎの帯の翌日側
 * （金曜22:00〜02:00の土曜01:00）は始まった側（金曜）で見る。
 * 帯ごとに判定するため、複数帯があっても別の帯の判定をずらさない。
 */
function windowImpliedFriendAddWeekday(at: Date, window: FriendAddTimeWindow, nowMinutes: number): number {
  const start = parseHhMmToMinutes(window.start);
  const end = parseHhMmToMinutes(window.end);
  if (start != null && end != null && start > end && nowMinutes < end) {
    return toJstParts(new Date(at.getTime() - 24 * 60 * 60 * 1000)).weekday;
  }
  return toJstParts(at).weekday;
}

/** 曜日・時間帯の両方を見る。曜日を先に報告する（Issueの完了条件の順番）。 */
export function evaluateFriendAddSchedule(
  definition: Pick<FriendAddRuleDefinition, 'weekdays' | 'timeWindows'>,
  at: Date,
): { matched: boolean; reason: Extract<FriendAddSuppressReason, 'outside_weekday' | 'outside_time_window' | 'invalid_time_window'> | null } {
  // 不正な時間帯が混ざった設定は送らない（fail-closed）。保存側で弾くのが
  // 本筋だが、既に入った値はここで止める。「制限なし」には読み替えない。
  if (hasInvalidFriendAddTimeWindows(definition.timeWindows)) {
    return { matched: false, reason: 'invalid_time_window' };
  }
  const windows = normalizeFriendAddTimeWindows(definition.timeWindows);
  const days = normalizeFriendAddWeekdays(definition.weekdays);
  const nowMinutes = toJstParts(at).minutes;
  const timeHit = (window: FriendAddTimeWindow): boolean => isTimeInFriendAddWindow(nowMinutes, window);
  if (days.length > 0) {
    const dayHit = windows.length === 0
      ? days.includes(toJstParts(at).weekday)
      : windows.some((window) => timeHit(window) && days.includes(windowImpliedFriendAddWeekday(at, window, nowMinutes)));
    if (!dayHit) return { matched: false, reason: 'outside_weekday' };
  }
  if (windows.length > 0 && !windows.some(timeHit)) {
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

function sortRecordKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecordKeys);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortRecordKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * 友だち条件JSONを意味で比べられる形に直す。整形・キー順の違いを吸収する。
 * rules / groups の並びは AND・OR のどちらでも意味を変えないため、
 * 入れ子グループの中まで再帰的に並べ替えてから比べる。
 * ルール値の中の配列（IDの一覧など）は順番に意味がある場合があるため並べ替えない。
 * 読めない値は null を返す。
 */
export function canonicalizeFriendAddCondition(value: unknown): string | null {
  const raw = normalizeFriendAddCondition(value);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { rules?: unknown[]; groups?: unknown[] } & Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return JSON.stringify(canonicalizeConditionNode(parsed));
  } catch {
    return null;
  }
}

/**
 * 条件ツリーを再帰的に正規化する。各階層の rules / groups 配列を
 * 正規化後の字面で並べ替え、入れ子の並び違いも吸収する。
 */
function canonicalizeConditionNode(node: unknown): unknown {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const record = node as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if ((key === 'rules' || key === 'groups') && Array.isArray(child)) {
        sorted[key] = child
          .map((item) => JSON.stringify(canonicalizeConditionNode(item)))
          .sort()
          .map((item) => JSON.parse(item) as unknown);
      } else {
        sorted[key] = sortRecordKeys(child);
      }
    }
    return sorted;
  }
  return sortRecordKeys(node);
}

/** 条件が実質「絞り込みなし」か。空文字と、空の構造化JSONを同じ扱いにする。 */
export function isEmptyFriendAddCondition(value: unknown): boolean {
  const raw = normalizeFriendAddCondition(value);
  if (!raw) return true;
  const canonical = canonicalizeFriendAddCondition(value);
  if (canonical == null) return false;
  return parseCondition(raw) != null && matchesEmptyCondition(raw);
}

function matchesEmptyCondition(raw: string): boolean {
  const condition = parseCondition(raw);
  if (!condition) return false;
  return (condition.rules?.length ?? 0) === 0 && (condition.groups?.length ?? 0) === 0;
}

/**
 * 原子ルール1つの正規形。実行時の SQL 組み立て（segment-query.ts の
 * buildSegmentWhere）と同じ読み方で充足可能性を見るための材料。
 * オブジェクトでないゴミは null（実行時は例外→抑止＝誰にも一致しない）。
 */
function ruleAtom(rule: unknown): string | null {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  return JSON.stringify(sortRecordKeys(rule));
}

interface FriendAddRuleShape {
  type?: unknown;
  value?: unknown;
}

function parseRuleShape(atom: string): FriendAddRuleShape | null {
  try {
    const parsed: unknown = JSON.parse(atom);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as FriendAddRuleShape;
  } catch {
    return null;
  }
}

/** DNF が大きくなりすぎたら調べ切れない。Condition Builder の条件は小さい想定。 */
const FRIEND_ADD_DNF_CAP = 128;

interface FriendAddDnf {
  conjunctions: Array<Array<string | null>>;
  overflow: boolean;
}

/**
 * 条件を選言標準形（OR of ANDs）にほぐす。空グループの扱いは
 * buildSegmentWhere と同じ（中身が空のグループは足さない）。
 * operator が 'AND' でない階層は OR として読む（実行時と同じ）。
 */
function conditionDnf(node: { operator?: unknown; rules?: unknown; groups?: unknown }): FriendAddDnf {
  const parts: Array<Array<Array<string | null>>> = [];
  const rules = Array.isArray(node.rules) ? node.rules : [];
  for (const rule of rules) parts.push([[ruleAtom(rule)]]);
  const groups = Array.isArray(node.groups) ? node.groups : [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      parts.push([[null]]);
      continue;
    }
    const g = group as { operator?: unknown; rules?: unknown; groups?: unknown };
    const gRules = Array.isArray(g.rules) ? g.rules : [];
    const gGroups = Array.isArray(g.groups) ? g.groups : [];
    if (gRules.length === 0 && gGroups.length === 0) continue;
    const sub = conditionDnf({ operator: g.operator, rules: gRules, groups: gGroups });
    if (sub.overflow) return { conjunctions: [], overflow: true };
    parts.push(sub.conjunctions);
  }
  if (node.operator !== 'AND') {
    const out = parts.flat();
    if (out.length > FRIEND_ADD_DNF_CAP) return { conjunctions: [], overflow: true };
    return { conjunctions: out.length > 0 ? out : [[]], overflow: false };
  }
  let acc: Array<Array<string | null>> = [[]];
  for (const part of parts) {
    const next: Array<Array<string | null>> = [];
    for (const left of acc) {
      for (const right of part) {
        next.push([...left, ...right]);
        if (next.length > FRIEND_ADD_DNF_CAP) return { conjunctions: [], overflow: true };
      }
    }
    acc = next;
  }
  return { conjunctions: acc, overflow: false };
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value as string[];
}

function asRuleRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** スコア・数値の区間。下が上より大きければ空（実行時も例外→抑止）。 */
function parseScoreInterval(value: unknown): { lo: number; hi: number } | null {
  const record = asRuleRecord(value);
  if (!record) return null;
  const min = typeof record.min === 'number' && Number.isInteger(record.min) ? record.min : null;
  const max = typeof record.max === 'number' && Number.isInteger(record.max) ? record.max : null;
  if (min == null && max == null) return null;
  return { lo: min ?? Number.NEGATIVE_INFINITY, hi: max ?? Number.POSITIVE_INFINITY };
}

/**
 * 日付の区間。to が日付だけ（YYYY-MM-DD）のときはその日の終わりまでを
 * 含める（buildDateRange と同じ）。from・to の空文字は開放端。
 */
function parseDateInterval(value: unknown): { lo: string | null; hi: string | null } | null {
  const record = asRuleRecord(value);
  if (!record) return null;
  const from = typeof record.from === 'string' && record.from !== '' ? record.from : null;
  let to = typeof record.to === 'string' && record.to !== '' ? record.to : null;
  if (to != null && /^\d{4}-\d{2}-\d{2}$/.test(to)) to = `${to}T23:59:59.999`;
  if (from == null && to == null) return null;
  return { lo: from, hi: to };
}

/** 同じ欄の数値比較（gte/gt/lte/lt）の下限・上限。読めない値は開放端に寄せる。 */
function friendFieldNumberBound(
  op: string,
  text: string,
): { lo: number; loOpen: boolean; hi: number; hiOpen: boolean } | null {
  const num = Number(text);
  if (!Number.isFinite(num)) return null;
  const bound = { lo: Number.NEGATIVE_INFINITY, loOpen: false, hi: Number.POSITIVE_INFINITY, hiOpen: false };
  if (op === 'gte') bound.lo = num;
  else if (op === 'gt') { bound.lo = num; bound.loOpen = true; }
  else if (op === 'lte') bound.hi = num;
  else if (op === 'lt') { bound.hi = num; bound.hiOpen = true; }
  else return null;
  return bound;
}

function friendFieldContradicts(
  first: { op: string; text: string },
  second: { op: string; text: string },
): boolean {
  const ops = [first.op, second.op];
  if (ops.includes('not_exists')) {
    const other = first.op === 'not_exists' ? second : first;
    // not_exists（空でない値の行が無い）と両立しないのは「空でない値が要る」条件。
    // not_equals / not_contains は空（NULL）でも成り立つので両立する。
    return other.op !== 'not_exists' && other.op !== 'not_equals' && other.op !== 'not_contains';
  }
  if (first.op === 'equals' && second.op === 'equals') return first.text !== second.text;
  if (first.op === 'equals' && second.op === 'not_equals') return first.text === second.text;
  if (second.op === 'equals' && first.op === 'not_equals') return first.text === second.text;
  if (first.op === 'equals' && second.op === 'contains') return !first.text.includes(second.text);
  if (second.op === 'equals' && first.op === 'contains') return !second.text.includes(first.text);
  if (first.op === 'equals' && second.op === 'not_contains') return first.text.includes(second.text);
  if (second.op === 'equals' && first.op === 'not_contains') return second.text.includes(first.text);
  if (first.op === 'contains' && second.op === 'not_contains') return first.text === second.text;
  if (first.op === 'equals' && (second.op === 'gte' || second.op === 'gt' || second.op === 'lte' || second.op === 'lt')) {
    const bound = friendFieldNumberBound(second.op, second.text);
    if (!bound) return false;
    const num = Number(first.text);
    if (!Number.isFinite(num)) return false;
    if (num < bound.lo || (num === bound.lo && bound.loOpen)) return true;
    if (num > bound.hi || (num === bound.hi && bound.hiOpen)) return true;
    return false;
  }
  if (second.op === 'equals' && (first.op === 'gte' || first.op === 'gt' || first.op === 'lte' || first.op === 'lt')) {
    return friendFieldContradicts(second, first);
  }
  const firstBound = friendFieldNumberBound(first.op, first.text);
  const secondBound = friendFieldNumberBound(second.op, second.text);
  if (firstBound && secondBound) {
    const lo = Math.max(firstBound.lo, secondBound.lo);
    const hi = Math.min(firstBound.hi, secondBound.hi);
    if (lo > hi) return true;
    if (lo === hi) {
      const open = (lo === firstBound.lo && firstBound.loOpen) || (lo === secondBound.lo && secondBound.loOpen)
        || (hi === firstBound.hi && firstBound.hiOpen) || (hi === secondBound.hi && secondBound.hiOpen);
      if (open) return true;
    }
  }
  return false;
}

/**
 * 2つの原子ルールが両立し得ないか。実行時の SQL の意味で見る。
 * 迷ったら両立扱い（false）にする。見逃し（警告しすぎ）は無害だが、
 * 誤って矛盾扱いすると本当の競合を見逃すため。
 */
function friendAddRulesContradict(first: FriendAddRuleShape, second: FriendAddRuleShape): boolean {
  if (typeof first.type !== 'string' || typeof second.type !== 'string') return false;
  if (first.type === second.type) {
    const type = first.type;
    const a = first.value;
    const b = second.value;
    if (JSON.stringify(sortRecordKeys(a)) === JSON.stringify(sortRecordKeys(b))) return false;
    switch (type) {
      case 'is_following':
      case 'is_hidden':
        // 真偽が割れたら両立しない。真偽でないゴミは実行時に例外→抑止だが、
        // ここでは警告側に倒して両立扱いにする。
        return typeof a === 'boolean' && typeof b === 'boolean' && a !== b;
      case 'ref_code':
        return typeof a === 'string' && typeof b === 'string';
      case 'tag_exists':
      case 'tag_not_exists':
      case 'scenario_subscribed':
      case 'name':
      case 'private_memo':
      case 'status_message':
      case 'form_answered':
        // タグは複数持てるし、名前・メモ・回答は重ねられる。同じ値なら上で両立。
        return false;
      case 'tag_all':
      case 'tag_not_all': {
        // tag_all A（Aを全部持つ）と tag_not_all B（Bを全部は持たない）。
        // B が A に含まれるときだけ両立しない。
        const leftIds = asStringList(a);
        const rightIds = asStringList(b);
        if (!leftIds || !rightIds) return false;
        if (type === 'tag_all' && second.type === 'tag_all') return false;
        if (type === 'tag_not_all' && second.type === 'tag_not_all') return false;
        const required = type === 'tag_all' ? leftIds : rightIds;
        const forbidden = type === 'tag_all' ? rightIds : leftIds;
        return forbidden.every((id) => required.includes(id));
      }
      case 'score_range': {
        const left = parseScoreInterval(a);
        const right = parseScoreInterval(b);
        if (!left || !right) return false;
        return left.hi < right.lo || right.hi < left.lo;
      }
      case 'registered_at':
      case 'last_reaction_at': {
        const left = parseDateInterval(a);
        const right = parseDateInterval(b);
        if (!left || !right) return false;
        if (left.hi != null && right.lo != null && left.hi < right.lo) return true;
        if (right.hi != null && left.lo != null && right.hi < left.lo) return true;
        return false;
      }
      case 'reaction_state': {
        // 'any' は 1=1（何も縛らない）なので何とでも両立する。
        if (a === 'any' || b === 'any') return false;
        if (a === 'none' || b === 'none') return true;
        // reply（返信あり）と postback（postback のみ＝返信なし）は両立しない。
        return (a === 'reply' && b === 'postback') || (a === 'postback' && b === 'reply');
      }
      case 'metadata_equals':
      case 'metadata_not_equals': {
        const left = asRuleRecord(a);
        const right = asRuleRecord(b);
        if (!left || !right || left.key !== right.key) return false;
        if (type === 'metadata_equals' && second.type === 'metadata_equals') {
          return left.value !== right.value;
        }
        if (type === 'metadata_not_equals' && second.type === 'metadata_not_equals') return false;
        return left.value === right.value;
      }
      case 'scenario_state': {
        const left = asRuleRecord(a);
        const right = asRuleRecord(b);
        if (!left || !right || left.scenarioId !== right.scenarioId) return false;
        return (left.state === 'subscribed' && right.state === 'not_subscribed')
          || (left.state === 'not_subscribed' && right.state === 'subscribed');
      }
      case 'support_mark': {
        const left = asRuleRecord(a);
        const right = asRuleRecord(b);
        if (!left || !right) return false;
        const leftIds = asStringList(left.markIds);
        const rightIds = asStringList(right.markIds);
        if (!leftIds || !rightIds) return false;
        const leftPositive = left.exclude !== true;
        const rightPositive = right.exclude !== true;
        if (leftPositive && rightPositive) {
          return !leftIds.some((id) => rightIds.includes(id));
        }
        if (!leftPositive && !rightPositive) return false;
        const positive = leftPositive ? leftIds : rightIds;
        const excluded = leftPositive ? rightIds : leftIds;
        return !positive.some((id) => !excluded.includes(id));
      }
      case 'friend_field': {
        const left = asRuleRecord(a);
        const right = asRuleRecord(b);
        if (!left || !right || left.fieldId !== right.fieldId) return false;
        return friendFieldContradicts(
          { op: typeof left.op === 'string' ? left.op : 'contains', text: typeof left.text === 'string' ? left.text : '' },
          { op: typeof right.op === 'string' ? right.op : 'contains', text: typeof right.text === 'string' ? right.text : '' },
        );
      }
      default:
        return false;
    }
  }
  // 型が違う肯定同士は基本的に両立する。否定との組み合わせだけ見る。
  if (first.type === 'tag_exists' && second.type === 'tag_not_exists') return first.value === second.value;
  if (first.type === 'tag_not_exists' && second.type === 'tag_exists') return first.value === second.value;
  if (first.type === 'tag_all' && second.type === 'tag_not_exists') {
    const ids = asStringList(first.value);
    return ids != null && typeof second.value === 'string' && ids.includes(second.value);
  }
  if (first.type === 'tag_not_exists' && second.type === 'tag_all') {
    const ids = asStringList(second.value);
    return ids != null && typeof first.value === 'string' && ids.includes(first.value);
  }
  if (first.type === 'tag_exists' && second.type === 'tag_not_all') {
    const forbidden = asStringList(second.value);
    // [A] だけを持たない条件と A を持つ条件は両立しない。
    // [A, B] のように2つ以上あるときは B を持たずに両立する。
    return forbidden != null && forbidden.length === 1 && forbidden[0] === first.value;
  }
  if (first.type === 'tag_not_all' && second.type === 'tag_exists') {
    return friendAddRulesContradict(second, first);
  }
  if ((first.type === 'metadata_equals' && second.type === 'metadata_not_equals')
    || (first.type === 'metadata_not_equals' && second.type === 'metadata_equals')) {
    const left = asRuleRecord(first.value);
    const right = asRuleRecord(second.value);
    if (!left || !right || left.key !== right.key) return false;
    return left.value === right.value;
  }
  if (first.type === 'scenario_subscribed' && second.type === 'scenario_state') {
    const state = asRuleRecord(second.value);
    return typeof first.value === 'string' && first.value !== ''
      && !!state && state.scenarioId === first.value && state.state === 'not_subscribed';
  }
  if (first.type === 'scenario_state' && second.type === 'scenario_subscribed') {
    return friendAddRulesContradict(second, first);
  }
  return false;
}

/** 連言（AND の塊）が成り立つ人がいるか。矛盾ペアが1つでもあればいない。 */
function friendAddConjunctionSatisfiable(atoms: Array<string | null>): boolean {
  const rules: FriendAddRuleShape[] = [];
  for (const atom of atoms) {
    if (atom == null) return false;
    const rule = parseRuleShape(atom);
    if (!rule) return false;
    rules.push(rule);
  }
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      if (friendAddRulesContradict(rules[i], rules[j])) return false;
    }
  }
  return true;
}

/**
 * 2つの条件を両方満たす人がいるか。DNF 同士を総当たりし、矛盾のない
 * 組み合わせが1つでもあれば重なる。大きすぎて調べ切れないときは
 * 警告側（重なる）に倒す。
 */
function friendAddConditionsShareAudience(first: SegmentCondition, second: SegmentCondition): boolean {
  const left = conditionDnf({ operator: first.operator, rules: first.rules, groups: first.groups });
  const right = conditionDnf({ operator: second.operator, rules: second.rules, groups: second.groups });
  if (left.overflow || right.overflow) return true;
  for (const leftBranch of left.conjunctions) {
    for (const rightBranch of right.conjunctions) {
      if (friendAddConjunctionSatisfiable([...leftBranch, ...rightBranch])) return true;
    }
  }
  return false;
}

/**
 * 友だち条件の重なり（競合確認用）。どちらかが空なら報告しない。
 * 構造化JSONは「両方を満たす人がいるか」（充足可能性）で判定する。
 * 本番は友だち1人ずつ条件を評価するため、同じ人に届き得る条件同士を
 * 競合にする。完全一致・ANDの包含・ORの共有枝・入れ子の部分重複は
 * すべてこの1つの意味に含まれる。tag-1 対 tag-2 のように違う絞りでも、
 * 両方持つ人にはどちらも届くので競合にする。逆に両立しない絞りの
 * 組み合わせ（矛盾AND）は誰にも届かないので競合にしない。
 * JSONでない旧形式・壊れたJSONは実行時も評価しないため字面の一致だけで見る。
 */
export function areFriendAddConditionsOverlapping(a: unknown, b: unknown): boolean {
  if (isEmptyFriendAddCondition(a) || isEmptyFriendAddCondition(b)) return false;
  const first = parseCondition(normalizeFriendAddCondition(a));
  const second = parseCondition(normalizeFriendAddCondition(b));
  if (first && second) return friendAddConditionsShareAudience(first, second);
  const left = normalizeFriendAddCondition(a);
  const right = normalizeFriendAddCondition(b);
  return Boolean(left) && left === right;
}

/*
 * 条件木（AST）の再帰検証と、参照しているIDの所属確認。
 *
 * `parseCondition` は**いちばん外側しか見ない**。入れ子グループの
 * `operator` は見ないため、`"and"`（小文字）や欠落のような値がそのまま
 * 通り、`buildSegmentWhere` の既定で **OR** に読み替わる。「AとBの両方」で
 * 絞ったつもりの設定が「AまたはB」になり、送ってはいけない相手へ届く。
 * ここで木の全段を検証し、読めないものは配信を止める。
 */

/** 検証で許す入れ子の深さ。Condition Builder が作る木はこれより浅い。 */
export const FRIEND_ADD_CONDITION_MAX_DEPTH = 8;
/** 検証で許すノード数。壊れた巨大JSONで実行時間を使い切らせない。 */
export const FRIEND_ADD_CONDITION_MAX_NODES = 200;

/**
 * 条件で使えるルール種別。segment-query の `SegmentRule['type']` と
 * 1対1で持つ。片方だけ増えたら型検査で落ちる（下の網羅チェック）。
 */
const SEGMENT_RULE_TYPE_MAP: Record<SegmentRule['type'], true> = {
  tag_exists: true,
  tag_not_exists: true,
  tag_all: true,
  tag_not_all: true,
  metadata_equals: true,
  metadata_not_equals: true,
  ref_code: true,
  is_following: true,
  scenario_subscribed: true,
  name: true,
  private_memo: true,
  status_message: true,
  registered_at: true,
  support_mark: true,
  is_hidden: true,
  friend_field: true,
  scenario_state: true,
  form_answered: true,
  last_reaction_at: true,
  reaction_state: true,
  score_range: true,
};
const SEGMENT_RULE_TYPES = new Set<string>(Object.keys(SEGMENT_RULE_TYPE_MAP));

export type FriendAddConditionAstError =
  /** JSONを書こうとした形跡がない自由文。旧形式の社内メモ混じり。 */
  | 'legacy_text'
  | 'not_json'
  | 'not_object'
  | 'bad_operator'
  | 'bad_rules'
  | 'bad_rule'
  | 'bad_groups'
  | 'too_deep'
  | 'too_large'
  | 'unbuildable';

function checkConditionNode(
  node: unknown,
  depth: number,
  counter: { n: number },
): FriendAddConditionAstError | null {
  if (depth > FRIEND_ADD_CONDITION_MAX_DEPTH) return 'too_deep';
  if (!node || typeof node !== 'object' || Array.isArray(node)) return 'not_object';
  const record = node as Record<string, unknown>;
  // 入れ子でも operator を必ず見る。既定の OR へ落とすと絞り込みが緩む。
  if (record.operator !== 'AND' && record.operator !== 'OR') return 'bad_operator';
  if (!Array.isArray(record.rules)) return 'bad_rules';
  for (const rule of record.rules) {
    counter.n += 1;
    if (counter.n > FRIEND_ADD_CONDITION_MAX_NODES) return 'too_large';
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return 'bad_rule';
    const type = (rule as { type?: unknown }).type;
    if (typeof type !== 'string' || !SEGMENT_RULE_TYPES.has(type)) return 'bad_rule';
  }
  if (record.groups !== undefined) {
    if (!Array.isArray(record.groups)) return 'bad_groups';
    for (const group of record.groups) {
      counter.n += 1;
      if (counter.n > FRIEND_ADD_CONDITION_MAX_NODES) return 'too_large';
      const error = checkConditionNode(group, depth + 1, counter);
      if (error) return error;
    }
  }
  return null;
}

/**
 * 条件JSONを木の全段まで検証して読む。
 * 空（絞り込みなし）は `{ ok: true, condition: null }`。
 * 読めないものは理由つきで断る。保存側は400、実行側は抑止に使う。
 */
export function parseFriendAddConditionAst(
  value: unknown,
): { ok: true; condition: SegmentCondition | null } | { ok: false; error: FriendAddConditionAstError } {
  const raw = normalizeFriendAddCondition(value);
  if (!raw) return { ok: true, condition: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /*
     * `{` `[` で始まらない値は、条件を書こうとしたものではなく旧形式の
     * 自由文（社内メモ）。**保存は止めない**（止めると、条件以外の項目も
     * 直せなくなる）。実行時に抑止し、画面で作り直しを促す。
     * 書こうとして壊れている値は保存時に断る。
     */
    return { ok: false, error: /^[{[]/.test(raw) ? 'not_json' : 'legacy_text' };
  }
  const structural = checkConditionNode(parsed, 1, { n: 0 });
  if (structural) return { ok: false, error: structural };
  const condition = parsed as SegmentCondition;
  // 値の形（タグIDが空、期間が両方未指定など）は WHERE を組み立てて確かめる。
  // 実行時と同じ組み立て器を通すので、判定と実行の意味がずれない。
  try {
    buildSegmentWhere(condition);
  } catch {
    return { ok: false, error: 'unbuildable' };
  }
  return { ok: true, condition };
}

/** 設定が参照しているID。アカウントの持ち物かを確かめるために集める。 */
export interface FriendAddReferenceIds {
  tagIds: string[];
  scenarioIds: string[];
  friendFieldIds: string[];
  routeIds: string[];
  formIds: string[];
  supportMarkIds: string[];
}

function pushId(into: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) into.add(value.trim());
}

function collectConditionReferences(
  node: unknown,
  depth: number,
  acc: {
    tags: Set<string>; scenarios: Set<string>; fields: Set<string>;
    forms: Set<string>; marks: Set<string>;
  },
): void {
  if (depth > FRIEND_ADD_CONDITION_MAX_DEPTH) return;
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.rules)) {
    for (const rule of record.rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
      const { type, value } = rule as { type?: unknown; value?: unknown };
      if (type === 'tag_exists' || type === 'tag_not_exists') pushId(acc.tags, value);
      else if (type === 'tag_all' || type === 'tag_not_all') {
        if (Array.isArray(value)) for (const id of value) pushId(acc.tags, id);
      } else if (type === 'scenario_subscribed') pushId(acc.scenarios, value);
      else if (type === 'scenario_state') {
        pushId(acc.scenarios, (value as { scenarioId?: unknown } | null)?.scenarioId);
      } else if (type === 'friend_field') {
        pushId(acc.fields, (value as { fieldId?: unknown } | null)?.fieldId);
      } else if (type === 'form_answered') {
        // 空文字は「どれか1つでも回答があれば」の意味。IDではない。
        pushId(acc.forms, value);
      } else if (type === 'support_mark') {
        const markIds = (value as { markIds?: unknown } | null)?.markIds;
        if (Array.isArray(markIds)) for (const id of markIds) pushId(acc.marks, id);
      }
    }
  }
  if (Array.isArray(record.groups)) {
    for (const group of record.groups) collectConditionReferences(group, depth + 1, acc);
  }
}

/**
 * 設定が指しているIDを全部集める。配信するシナリオ・流入リンク・
 * アクションの対象・友だち条件の中のタグ／シナリオ／友だち情報欄まで。
 */
export function collectFriendAddReferences(
  definition: Pick<FriendAddRuleDefinition, 'scenarioId' | 'routeIds' | 'actions' | 'friendCondition'>,
): FriendAddReferenceIds {
  const tags = new Set<string>();
  const scenarios = new Set<string>();
  const fields = new Set<string>();
  const routes = new Set<string>();
  const forms = new Set<string>();
  const marks = new Set<string>();
  pushId(scenarios, definition.scenarioId);
  if (Array.isArray(definition.routeIds)) for (const id of definition.routeIds) pushId(routes, id);
  if (Array.isArray(definition.actions)) {
    for (const action of definition.actions) {
      if (!action || typeof action !== 'object') continue;
      const { type, targetId, config } = action as {
        type?: unknown; targetId?: unknown; config?: unknown;
      };
      if (type === 'add_tag' || type === 'remove_tag') pushId(tags, targetId);
      else if (type === 'start_scenario' || type === 'stop_scenario') pushId(scenarios, targetId);
      // 行アクション（保存形が config を持つ形）も同じ持ち物検査に載せる。
      const rowConfig = (config && typeof config === 'object' ? config : null) as
        | Record<string, unknown>
        | null;
      if (rowConfig) {
        if (Array.isArray(rowConfig.tagIds)) for (const id of rowConfig.tagIds) pushId(tags, id);
        pushId(scenarios, rowConfig.scenarioId);
        pushId(fields, rowConfig.fieldId);
      }
    }
  }
  const parsedCondition = (() => {
    const raw = normalizeFriendAddCondition(definition.friendCondition);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  })();
  if (parsedCondition) {
    collectConditionReferences(parsedCondition, 1, { tags, scenarios, fields, forms, marks });
  }
  return {
    tagIds: [...tags],
    scenarioIds: [...scenarios],
    friendFieldIds: [...fields],
    routeIds: [...routes],
    formIds: [...forms],
    supportMarkIds: [...marks],
  };
}

async function selectIds(
  db: D1Database,
  ids: string[],
  build: (placeholders: string) => { sql: string; bindings: unknown[] },
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { sql, bindings } = build(ids.map(() => '?').join(','));
  const rows = await db.prepare(sql).bind(...bindings).all<{ id: string }>();
  return new Set((rows.results ?? []).map((row) => row.id));
}

/**
 * 参照しているIDのうち、**このアカウントで使えないもの**を返す。
 *
 * 使えない＝「消えている」か「別アカウント・別テナントの持ち物」。
 * 公開版のスナップショットは保存後もそのまま動くので、保存時に正しくても
 * 実行時には消えている・移っていることがある。どちらの場合も配信しない。
 *
 * 所有者が未設定（NULL）のタグ・シナリオも**使えない扱い**にする。
 * どのアカウントの持ち物か言い切れないものを、このアカウントの配信条件と
 * して読むと、他店の友だちを数える形になりうる。
 * 流入リンクだけは、保存時の契約（未設定＋同一テナントは可）にそろえる。
 * 友だち情報欄・フォーム・対応マークは所有列が無いので、存在だけを確かめる。
 */
export async function findFriendAddUnusableReferences(
  db: D1Database,
  accountId: string,
  refs: FriendAddReferenceIds,
): Promise<string[]> {
  const tenantOfAccount = '(SELECT tenant_id FROM line_accounts WHERE id = ?)';
  const [tags, scenarios, fields, routes, forms, marks] = await Promise.all([
    selectIds(db, refs.tagIds, (p) => ({
      sql: `SELECT id FROM tags WHERE id IN (${p}) AND line_account_id = ?`,
      bindings: [...refs.tagIds, accountId],
    })),
    selectIds(db, refs.scenarioIds, (p) => ({
      sql: `SELECT id FROM scenarios WHERE id IN (${p}) AND line_account_id = ?`,
      bindings: [...refs.scenarioIds, accountId],
    })),
    // 友だち情報欄はフォーム・対応マークと同じく所有アカウントの列を持たない
    // （テナント共通）。存在だけを確かめる。
    selectIds(db, refs.friendFieldIds, (p) => ({
      sql: `SELECT id FROM friend_fields WHERE id IN (${p})`,
      bindings: [...refs.friendFieldIds],
    })),
    selectIds(db, refs.routeIds, (p) => ({
      sql: `SELECT id FROM entry_routes
             WHERE id IN (${p})
               AND (line_account_id = ?
                    OR (line_account_id IS NULL AND tenant_id = ${tenantOfAccount}))`,
      bindings: [...refs.routeIds, accountId, accountId],
    })),
    selectIds(db, refs.formIds, (p) => ({
      sql: `SELECT id FROM forms WHERE id IN (${p})`,
      bindings: [...refs.formIds],
    })),
    selectIds(db, refs.supportMarkIds, (p) => ({
      sql: `SELECT id FROM support_marks WHERE id IN (${p})`,
      bindings: [...refs.supportMarkIds],
    })),
  ]);
  return [
    ...refs.tagIds.filter((id) => !tags.has(id)),
    ...refs.scenarioIds.filter((id) => !scenarios.has(id)),
    ...refs.friendFieldIds.filter((id) => !fields.has(id)),
    ...refs.routeIds.filter((id) => !routes.has(id)),
    ...refs.formIds.filter((id) => !forms.has(id)),
    ...refs.supportMarkIds.filter((id) => !marks.has(id)),
  ];
}

/**
 * 友だち条件を実データで評価する。
 *
 * - 空は制限なし（通す）。
 * - Segment条件JSONは**入れ子まで再帰検証**してから実データで評価する。
 * - JSON以外の自由文（旧形式の社内メモ混じり）は安全側に抑止する。
 *   通すと「絞ったつもりが全員に届く」事故になる。社内メモは
 *   `internalMemo` へ分離し、画面で再設定を促す。
 * - 入れ子グループの operator 欠落のように、通すと絞り込みが緩む形も抑止する。
 */
export async function evaluateFriendAddFriendCondition(
  db: D1Database,
  definition: Pick<FriendAddRuleDefinition, 'friendCondition'>,
  friendId: string,
): Promise<{
  matched: boolean;
  reason: Extract<
    FriendAddSuppressReason,
    'friend_condition_not_met' | 'friend_condition_unreadable' | 'friend_condition_invalid'
  > | null;
}> {
  const ast = parseFriendAddConditionAst(definition.friendCondition);
  if (!ast.ok) {
    console.error(`[friend-add-routing] friendCondition rejected (${ast.error}) — skipped the rule`);
    // 旧形式の自由文は「作り直してほしい」を画面へ出すため従来の理由のまま。
    // 木の形が壊れているものは別の理由で分ける。
    return {
      matched: false,
      reason: ast.error === 'legacy_text' || ast.error === 'not_json'
        ? 'friend_condition_unreadable'
        : 'friend_condition_invalid',
    };
  }
  if (!ast.condition) return { matched: true, reason: null };
  try {
    const matches = await matchesCondition(db, friendId, ast.condition);
    return matches
      ? { matched: true, reason: null }
      : { matched: false, reason: 'friend_condition_not_met' };
  } catch {
    console.error('[friend-add-routing] friendCondition evaluation failed — skipped the rule');
    return { matched: false, reason: 'friend_condition_invalid' };
  }
}

/**
 * 再送制限にかかっているか。
 *
 * 数えるのは「**届いた形跡がある実行**」だけ。
 *   - `completed`（送った印）
 *   - 送信の記録が残っている行（delivery_count > 0 / first_delivery_sent_at あり）
 *   - 送達不明（`delivery_unknown`）— 送ったかもしれない実行。
 *     自動で送り直すと二重に届くため、ここで止めて人の確認に回す。
 *
 * 逆に、送っていないことがはっきりしている実行（`send_failed`・抑止・
 * 処理中）は数えない。数えると、送れなかった人が永久に送れなくなる。
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
          AND occurred_at >= ?
          AND (
            routing_status = 'completed'
            OR COALESCE(delivery_count, 0) > 0
            OR first_delivery_sent_at IS NOT NULL
            OR error_code = 'delivery_unknown'
          )
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
 * 1つの公開版が「いま・この人」に動くか。安い順（曜日・時間帯→参照の
 * 持ち物確認→友だち条件→再送制限）に見て、最初に止めた理由だけを返す。
 * 競合確認の表示と本番の判定で意味がずれないよう、どちらもこの関数群を通す。
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
  /*
   * 条件木の形は DB を見ずに確かめられるので先に見る。壊れた木から
   * 参照IDを拾っても意味が無いし、理由も「条件が読めない」が正しい。
   */
  const ast = parseFriendAddConditionAst(input.definition.friendCondition);
  if (!ast.ok) {
    console.error(`[friend-add-routing] friendCondition rejected (${ast.error}) — skipped the rule`);
    return {
      matched: false,
      reason: ast.error === 'legacy_text' || ast.error === 'not_json'
        ? 'friend_condition_unreadable'
        : 'friend_condition_invalid',
    };
  }
  /*
   * 保存時に確かめていても、実行時にもう一度確かめる。タグやシナリオは
   * 保存のあとで消せる・別アカウントへ移せるため、公開版のスナップショットが
   * 使えない参照を抱えたまま動くことがある。消えた参照で絞ると
   * 「誰にも当たらない」ではなく「絞れていない」に化けることもあるため、
   * 消えている場合も配信しない（fail-closed）。
   */
  const unusable = await findFriendAddUnusableReferences(
    db,
    input.lineAccountId,
    collectFriendAddReferences(input.definition),
  );
  if (unusable.length > 0) {
    console.error(
      `[friend-add-routing] rule references ids this account cannot use — skipped: ${unusable.join(', ')}`,
    );
    return { matched: false, reason: 'reference_out_of_account' };
  }
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
  /**
   * 外部効果の直前に通す関門。アクションはタグ付けの副作用で外へ送ることが
   * あるため、**ひとつ手前で毎回**持ち主かを確かめる。まとめて1回では、
   * 前のアクションに時間がかかった間に奪われたことに気づけない。
   */
  fence?: () => Promise<boolean>,
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
  if (rows.length > 0 && (!fence || await fence())) {
    try {
      const { runActionRows } = await import('./scenario-actions.js');
      await runActionRows(db, rows as never, friendId);
    } catch (err) {
      // 1つ失敗しても配信は止めない。
      console.error('[friend-add-routing] row actions failed:', err);
    }
  }

  for (const action of actions) {
    if (fence && !(await fence())) break;
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
  routingContext?: {
    entryRouteId?: string | null;
    now?: Date;
    sendRight?: boolean;
    claimError?: boolean;
    /**
     * 奪い直した予約に、前の持ち主の「送り始めた」印が残っていた。
     * 送ったかもしれないので送らず、理由を送達不明として残す。
     */
    dispatchUnknown?: boolean;
    /**
     * 送信権の持ち主かを確かめる関数（fencing）。登録・アクション・送信の
     * どれかを始める直前に呼ぶ。false なら回収されているので何もしない。
     * 渡さないときは確かめない（画面のテスト実行など、副作用が無い呼び出し）。
     */
    fence?: () => Promise<boolean>;
  },
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
  /*
   * 送信権を取れなかった実行は、選ぶだけ選んで登録も送信もしない。
   * 並行する勝った側が送るため、ここで enrollment を作ると cron が
   * 拾って二重に届いてしまう。追跡用に抑止として残す。
   */
  if (routingContext?.sendRight === false && selection.evaluated) {
    return {
      routed: true,
      kind,
      enrollments: [],
      timing: selection.evaluated.definition.timing,
      suppressed: true,
      suppressReason: routingContext?.claimError === true
        ? 'send_claim_unavailable'
        : (routingContext?.dispatchUnknown === true ? 'delivery_unknown' : 'duplicate_in_flight'),
      ruleId: selection.evaluated.ruleId,
      ruleVersionId: selection.evaluated.versionId,
    };
  }
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

  /*
   * ここから先は登録・アクション・送信の副作用に入る。**外部送信と同じ
   * fence をくぐらせる。** 条件の評価に時間がかかった間に予約を回収されて
   * いたら、勝った側が送るのでこちらは何もしない。アクションだけ実行して
   * 送信はしない、という食い違いを作らない。
   */
  if (routingContext?.fence && !(await routingContext.fence())) {
    return {
      routed: true,
      kind,
      enrollments: [],
      timing: matchedRule?.definition.timing ?? routing.firstTime.timing,
      suppressed: true,
      suppressReason: 'send_right_revoked',
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
    };
  }

  const timing = routing.firstTime.timing;
  const classifiedKind = matchedRule ? kind : classifyFriend(friend, routing.criteria.firstTime);

  // ② で「配信しない」を選んでいる
  if (classifiedKind === 'returning' && routing.returning.mode === 'none') {
    await runActions(db, friend.id, routing.returning.actions, push, routingContext?.fence);
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
      await runActions(db, friend.id, branch.actions, push, routingContext?.fence);
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
      await runActions(db, friend.id, routing.returning.actions, push, routingContext?.fence);
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
  // 登録は cron の配信につながる外部効果。書く直前にもう一度確かめる。
  if (routingContext?.fence && !(await routingContext.fence())) {
    return {
      routed: true,
      kind: classifiedKind,
      enrollments: [],
      timing,
      suppressed: true,
      suppressReason: 'send_right_revoked',
      ruleId: matchedRule?.ruleId ?? null,
      ruleVersionId: matchedRule?.versionId ?? null,
    };
  }
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

  await runActions(db, friend.id, branch.actions, push, routingContext?.fence);

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
