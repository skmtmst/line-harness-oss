import {
  buildSegmentWhere,
  matchesCondition,
  type SegmentCondition,
  type SegmentRule,
} from './segment-conditions.js';

/**
 * 成果地点の「数えない条件」(R40)。
 *
 * 以前は自由文の `excludedCondition` 文字列だけを保存し、記録・試算の
 * どちらにも効いていなかった。いまは分ける。
 * - `exclusion`: 実効する除外条件。友だち絞り込みの共通部品
 *   (ConditionBuilder / SegmentCondition)と同じ形。条件に当てはまる
 *   友だちの成果は記録しないし、試算の過去集計からも除く。
 * - `exclusionMemo`: 自由文のメモ。数え方には影響しない。
 * - 旧 `excludedCondition` 文字列: 読むときにメモへ移す。条件としては
 *   効かせない(効いていなかったものを勝手に効かせると、保存済みの
 *   地点の数字が変わってしまう)。
 *
 * DBの列は増やさない。`conversion_points.source_config_json` の中の
 * 3つの鍵だけで持つ。
 */

export interface ConversionExclusionRead {
  /** 実効する除外条件。無い・空・壊れているときは null。 */
  condition: SegmentCondition | null;
  /** 自由文のメモ。数え方に影響しない。 */
  memo: string | null;
  /** exclusion が壊れていて読めなかった。 */
  invalid: boolean;
  /** 旧 excludedCondition 文字列をメモへ移した。 */
  legacyMemoMigrated: boolean;
}

function memoText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

function hasRuleValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      entry !== null && entry !== undefined && entry !== ''
      && !(Array.isArray(entry) && entry.length === 0));
  }
  return false;
}

function isRuleShape(rule: unknown): rule is SegmentRule {
  if (!rule || typeof rule !== 'object') return false;
  const candidate = rule as { type?: unknown; value?: unknown };
  // friend_id_in は内部 snapshot 用。一般の保存口では受け付けない
  // (segment-query の buildPublicSegmentQuery と同じ境界)。
  if (candidate.type === 'friend_id_in') return false;
  return typeof candidate.type === 'string'
    && candidate.type.length > 0
    && hasRuleValue(candidate.value);
}

function isConditionShape(value: unknown): value is SegmentCondition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { operator?: unknown; rules?: unknown; groups?: unknown };
  if (candidate.operator !== 'AND' && candidate.operator !== 'OR') return false;
  if (!Array.isArray(candidate.rules)) return false;
  if (!candidate.rules.every(isRuleShape)) return false;
  if (candidate.groups !== undefined) {
    if (!Array.isArray(candidate.groups)) return false;
    if (!candidate.groups.every(isConditionShape)) return false;
  }
  return true;
}

function isEmptyConditionValue(condition: SegmentCondition): boolean {
  const groupCount = (condition.groups ?? []).filter(
    (group) => group.rules.length > 0 || (group.groups?.length ?? 0) > 0,
  ).length;
  return condition.rules.length === 0 && groupCount === 0;
}

/**
 * source_config の読み取り。壊れた exclusion は例外にせず
 * `invalid: true` で返す(呼び出し側が試算の注意・記録の継続を決める)。
 */
export function readConversionExclusion(sourceConfig: unknown): ConversionExclusionRead {
  const empty: ConversionExclusionRead = {
    condition: null, memo: null, invalid: false, legacyMemoMigrated: false,
  };
  if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
    return empty;
  }
  const config = sourceConfig as Record<string, unknown>;
  const memo = memoText(config.exclusionMemo);
  const legacy = memoText(config.excludedCondition);
  const merged: ConversionExclusionRead = {
    ...empty,
    memo: memo ?? legacy,
    legacyMemoMigrated: memo === null && legacy !== null,
  };
  const raw = config.exclusion;
  if (raw === undefined || raw === null) return merged;
  if (!isConditionShape(raw)) return { ...merged, invalid: true };
  if (isEmptyConditionValue(raw)) return merged;
  return {
    ...merged,
    condition: {
      operator: raw.operator,
      rules: raw.rules,
      ...(raw.groups ? { groups: raw.groups } : {}),
    },
  };
}

/**
 * 保存前の検査。保存口(create/revise)・試算口で使い、不正な条件を
 * 400 で断るために `false` を返す。壊れた条件を保存すると、記録が
 * 止まるか全件数えるかのどちらかに倒れてしまう。
 */
export function isExclusionSavable(sourceConfig: unknown): boolean {
  if (!sourceConfig || typeof sourceConfig !== 'object' || Array.isArray(sourceConfig)) {
    return true;
  }
  const raw = (sourceConfig as Record<string, unknown>).exclusion;
  if (raw === undefined || raw === null) return true;
  if (!isConditionShape(raw)) return false;
  return true;
}

/**
 * 1人が除外条件に当てはまるか。条件が無いときは誰も除外しない。
 * 友だち行が無いときも数えない側へ倒す(fail-closed)。
 */
export async function isFriendExcludedByConversion(
  db: D1Database,
  friendId: string,
  condition: SegmentCondition | null,
): Promise<boolean> {
  if (!condition) return false;
  // 条件そのものが「数えない人」を指す。当てはまったら除外。
  return await matchesCondition(db, friendId, condition);
}

/**
 * 過去集計(SQL)用の除外断片。`friends` を `f` で JOIN して使う。
 * negate=false のときは「当てはまる行」だけを数える(除外件数の表示用)。
 */
export function exclusionWhere(
  condition: SegmentCondition,
  options: { negate?: boolean } = {},
): { sql: string; bindings: unknown[] } {
  const where = buildSegmentWhere(condition);
  const negate = options.negate !== false;
  return {
    sql: negate ? `NOT (${where.sql})` : `(${where.sql})`,
    bindings: where.bindings,
  };
}
