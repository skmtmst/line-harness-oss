import type { Env } from '../worker-env.js';

/**
 * 店舗（テナント）から使用するD1を決める。
 *
 * いまは単一DB構成なので常に env.DB を返す。これは分割済みのルーターではない。
 * env.DB を直接使う経路と全社JOINが残っており、この関数だけを変更しても
 * テナント分割は完了しない。移行条件は docs/multi-tenant-scale.md を参照。
 */
export function dbFor(env: Env['Bindings'], _storeId?: string | null): D1Database {
  return env.DB;
}
