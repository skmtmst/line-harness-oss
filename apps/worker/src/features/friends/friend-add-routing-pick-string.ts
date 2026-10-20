import { logger } from '@line-crm/shared/server';
import { getAccountSetting, setAccountSetting, type FriendAddRuleDefinition } from '@line-crm/db';

import { FRIEND_ADD_ROUTING_DEFAULT, toJstParts, type FriendAddRouting, type FriendAddAction, type FriendAddFirstTimeCriterion, type FriendAddReturningMode, type FriendAddRowActionType, type FriendAddStartPosition, type FriendAddTiming } from '@line-crm/shared';


import { parseCondition } from '../../services/segment-query.js';

export const FRIEND_ADD_ROUTING_KEY = 'friend_add_routing';

/** 振り分けの判定に使う、友だちの最低限の情報。 */
export interface FriendAddSubject {
  id: string;
  unfollow_count?: number | null;
  first_followed_at?: string | null;
}

export type FriendKind = 'first_time' | 'returning';

// ── 読み書き ────────────────────────────────────────────────────────────────

export function pickString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export const ROW_ACTION_TYPES = ['tag', 'friend_field', 'support_mark', 'scenario', 'common_var'] as const;

export function normalizeActions(value: unknown): FriendAddAction[] {
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

export function normalizeScenarioId(value: unknown): string | null {
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
    logger.error("services_friend_add_routing_failed");
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

export function parseHhMmToMinutes(value: unknown): number | null {
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
export function windowImpliedFriendAddWeekday(at: Date, window: FriendAddTimeWindow, nowMinutes: number): number {
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

export function splitFriendAddWindow(window: FriendAddTimeWindow): Array<{ start: number; end: number }> {
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

export function sortRecordKeys(value: unknown): unknown {
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
 * 条件ツリーを再帰的に正規化する。各階層の rules / groups 配列を
 * 正規化後の字面で並べ替え、入れ子の並び違いも吸収する。
 */
export function canonicalizeConditionNode(node: unknown): unknown {
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

export function matchesEmptyCondition(raw: string): boolean {
  const condition = parseCondition(raw);
  if (!condition) return false;
  return (condition.rules?.length ?? 0) === 0 && (condition.groups?.length ?? 0) === 0;
}

/** 条件が実質「絞り込みなし」か。空文字と、空の構造化JSONを同じ扱いにする。 */
export function isEmptyFriendAddCondition(value: unknown): boolean {
  const raw = normalizeFriendAddCondition(value);
  if (!raw) return true;
  const canonical = canonicalizeFriendAddCondition(value);
  if (canonical == null) return false;
  return parseCondition(raw) != null && matchesEmptyCondition(raw);
}

/**
 * 原子ルール1つの正規形。実行時の SQL 組み立て（segment-query.ts の
 * buildSegmentWhere）と同じ読み方で充足可能性を見るための材料。
 * オブジェクトでないゴミは null（実行時は例外→抑止＝誰にも一致しない）。
 */
export function ruleAtom(rule: unknown): string | null {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  return JSON.stringify(sortRecordKeys(rule));
}

export interface FriendAddRuleShape {
  type?: unknown;
  value?: unknown;
}

export function parseRuleShape(atom: string): FriendAddRuleShape | null {
  try {
    const parsed: unknown = JSON.parse(atom);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as FriendAddRuleShape;
  } catch {
    return null;
  }
}

/** DNF が大きくなりすぎたら調べ切れない。Condition Builder の条件は小さい想定。 */
export const FRIEND_ADD_DNF_CAP = 128;

export interface FriendAddDnf {
  conjunctions: Array<Array<string | null>>;
  overflow: boolean;
}

/**
 * 条件を選言標準形（OR of ANDs）にほぐす。空グループの扱いは
 * buildSegmentWhere と同じ（中身が空のグループは足さない）。
 * operator が 'AND' でない階層は OR として読む（実行時と同じ）。
 */
export function conditionDnf(node: { operator?: unknown; rules?: unknown; groups?: unknown }): FriendAddDnf {
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

export function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value as string[];
}

export function asRuleRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** スコア・数値の区間。下が上より大きければ空（実行時も例外→抑止）。 */
export function parseScoreInterval(value: unknown): { lo: number; hi: number } | null {
  const record = asRuleRecord(value);
  if (!record) return null;
  const min = typeof record.min === 'number' && Number.isInteger(record.min) ? record.min : null;
  const max = typeof record.max === 'number' && Number.isInteger(record.max) ? record.max : null;
  if (min == null && max == null) return null;
  return { lo: min ?? Number.NEGATIVE_INFINITY, hi: max ?? Number.POSITIVE_INFINITY };
}
