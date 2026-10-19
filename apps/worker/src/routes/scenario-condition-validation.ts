import { buildSegmentWhere } from '../services/segment-query.js';
import { type SegmentCondition } from '@line-crm/shared';

/**
 * 条件ビルダーの結果を保存してよいか見る。
 *
 * 組み立てを実際に走らせて、例外が出なければ通す。形だけ見る検証を別に書くと、
 * 保存はできるのに配信時に落ちる条件が作れてしまう。**保存時と配信時で同じ
 * 関数を通す**のがここの要点。
 *
 * @returns 保存する JSON 文字列。条件なしなら null。
 */
export function validateConditionForStorage(
  value: unknown,
  label: string,
): { ok: true; json: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, json: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${label}の条件の形が不正です。` };
  }
  const condition = value as SegmentCondition;
  if (condition.operator !== 'AND' && condition.operator !== 'OR') {
    return { ok: false, error: `${label}の条件は operator に AND / OR が要ります。` };
  }
  if (!Array.isArray(condition.rules)) {
    return { ok: false, error: `${label}の条件は rules の配列が要ります。` };
  }
  // 中身が空なら「条件なし」として保存する。空の条件を持たせておくと、
  // 画面上は絞り込んでいるように見えて全員に届く。
  const empty = condition.rules.length === 0 && (condition.groups?.length ?? 0) === 0;
  if (empty) return { ok: true, json: null };
  try {
    buildSegmentWhere(condition);
  } catch (err) {
    return { ok: false, error: `${label}の条件を読めません: ${(err as Error).message}` };
  }
  return { ok: true, json: JSON.stringify(condition) };
}
