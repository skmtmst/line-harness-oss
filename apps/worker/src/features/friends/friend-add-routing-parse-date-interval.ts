import { type FriendAddRuleDefinition } from '@line-crm/db';

import { buildSegmentWhere, parseCondition } from '../../services/segment-query.js';
import { type SegmentCondition, type SegmentRule } from '@line-crm/shared';
import { asRuleRecord, type FriendAddRuleShape, sortRecordKeys, asStringList, parseScoreInterval, parseRuleShape, conditionDnf, isEmptyFriendAddCondition, normalizeFriendAddCondition } from './friend-add-routing-pick-string.js';

/**
 * 日付の区間。to が日付だけ（YYYY-MM-DD）のときはその日の終わりまでを
 * 含める（buildDateRange と同じ）。from・to の空文字は開放端。
 */
export function parseDateInterval(value: unknown): { lo: string | null; hi: string | null } | null {
  const record = asRuleRecord(value);
  if (!record) return null;
  const from = typeof record.from === 'string' && record.from !== '' ? record.from : null;
  let to = typeof record.to === 'string' && record.to !== '' ? record.to : null;
  if (to != null && /^\d{4}-\d{2}-\d{2}$/.test(to)) to = `${to}T23:59:59.999`;
  if (from == null && to == null) return null;
  return { lo: from, hi: to };
}

/** 同じ欄の数値比較（gte/gt/lte/lt）の下限・上限。読めない値は開放端に寄せる。 */
export function friendFieldNumberBound(
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

export function friendFieldContradicts(
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
export function friendAddRulesContradict(first: FriendAddRuleShape, second: FriendAddRuleShape): boolean {
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
export function friendAddConjunctionSatisfiable(atoms: Array<string | null>): boolean {
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
export function friendAddConditionsShareAudience(first: SegmentCondition, second: SegmentCondition): boolean {
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
 * 条件で使える公開ルール種別。内部専用の `friend_id_in` と
 * `analytics_audience` は、友だち追加時の条件として保存させない。
 * イベント申込者・分析対象者へ送る固定snapshotを別の導線から
 * 作れてしまうと、条件ビルダーの権限境界を迂回するためである。
 * `chat_status` / `operator_id` は友だち一覧→配信の引継ぎ専用で、
 * 友だち追加時の条件としては保存させない（条件ビルダーにも出ない）。
 * `broadcast_link_clicked` は配信詳細からの追送導線専用で、友だち追加の
 * 時点ではクリック履歴が存在し得ないため条件として意味を持たない。
 */
export type FriendAddSegmentRuleType = Exclude<
  SegmentRule['type'],
  | 'friend_id_in'
  | 'analytics_audience'
  | 'chat_status'
  | 'operator_id'
  | 'broadcast_link_clicked'
>;

export const SEGMENT_RULE_TYPE_MAP: Record<FriendAddSegmentRuleType, true> = {
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

export const SEGMENT_RULE_TYPES = new Set<string>(Object.keys(SEGMENT_RULE_TYPE_MAP));

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

export function checkConditionNode(
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
    if (type === 'friend_id_in' || typeof type !== 'string' || !SEGMENT_RULE_TYPES.has(type)) return 'bad_rule';
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
  /** F9: 共通情報は var_key で指す。 */
  commonVarKeys: string[];
}

export function pushId(into: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.trim()) into.add(value.trim());
}

export function collectConditionReferences(
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
  const vars = new Set<string>();
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
      // F9: 4つの操作の参照先も持ち物検査に載せる。
      else if (type === 'set_friend_field') pushId(fields, targetId);
      else if (type === 'add_support_mark') pushId(marks, targetId);
      else if (type === 'use_common_var') pushId(vars, targetId);
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
    commonVarKeys: [...vars],
  };
}

export async function selectIds(
  db: D1Database,
  ids: string[],
  build: (placeholders: string) => { sql: string; bindings: unknown[] },
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { sql, bindings } = build(ids.map(() => '?').join(','));
  const rows = await db.prepare(sql).bind(...bindings).all<{ id: string }>();
  return new Set((rows.results ?? []).map((row) => row.id));
}
