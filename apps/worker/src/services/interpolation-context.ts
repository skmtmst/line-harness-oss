import { getFriendFieldMap, getCommonVarMap } from '@line-crm/db';

/**
 * 差し込みに使う値をまとめて用意する。
 *
 * 友だち情報欄と共通情報の2つを引く。送信の経路が4か所（シナリオ・
 * 自動応答・フォームの返信・初回配信）あるので、それぞれで2本ずつ
 * クエリを書くと必ずどこかがずれる。
 *
 * 本文に差し込みが1つも書かれていなければ引かない。差し込みを使わない
 * テンプレートの送信で、毎回2クエリ増えるのは無駄。
 */
export interface InterpolationExtra {
  fields?: Record<string, string>;
  vars?: Record<string, string>;
}

const FIELD_PATTERN = /\{\{(#if_)?field\./;
const VAR_PATTERN = /\{\{var\./;

export async function resolveInterpolationExtra(
  db: D1Database,
  friendId: string,
  content: string,
): Promise<InterpolationExtra> {
  const needsFields = FIELD_PATTERN.test(content);
  const needsVars = VAR_PATTERN.test(content);
  if (!needsFields && !needsVars) return {};

  const account = needsVars
    ? await db.prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
      .bind(friendId)
      .first<{ line_account_id: string | null }>()
    : null;

  const [fields, vars] = await Promise.all([
    needsFields ? getFriendFieldMap(db, friendId) : Promise.resolve(undefined),
    needsVars ? getCommonVarMap(db, account?.line_account_id) : Promise.resolve(undefined),
  ]);
  return { fields, vars };
}

/**
 * 本文に書かれている差し込み名のうち、どこにも定義が無いものを拾う。
 *
 * 保存は止めない。テンプレートを先に書いて項目を後から足す、という
 * 順序は普通にあるので、そこで保存できないと作業が進まない。
 * 画面には注意として出す。
 */
export function findUnknownPlaceholders(
  content: string,
  known: { fields: Set<string>; vars: Set<string> },
): string[] {
  const unknown = new Set<string>();
  for (const match of content.matchAll(/\{\{(?:#if_)?field\.([a-z][a-z0-9_]*)\}\}/g)) {
    if (!known.fields.has(match[1])) unknown.add(`field.${match[1]}`);
  }
  for (const match of content.matchAll(/\{\{var\.([a-z][a-z0-9_]*)\}\}/g)) {
    if (!known.vars.has(match[1])) unknown.add(`var.${match[1]}`);
  }
  return [...unknown];
}
