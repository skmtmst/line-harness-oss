import type { Env } from '../index.js';

/**
 * 店舗（テナント）から使用するD1を決める。
 *
 * いまは単一DB構成なので常に env.DB を返す。将来テナントごとに
 * D1を分けるとき、この関数の中だけを直せば済むようにしてある。
 * 呼び出し側が env.DB を直接触ると、その日に全クエリの書き換えが必要になる。
 */
export function dbFor(env: Env['Bindings'], _storeId?: string | null): D1Database {
  return env.DB;
}
