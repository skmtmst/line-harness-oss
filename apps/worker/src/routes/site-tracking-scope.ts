import { type Context } from 'hono';
import type { Env } from '../worker-env.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { inputError } from '../lib/input-errors.js';


export async function visibleAccountId(c: Context<Env>): Promise<string | Response> {
  /*
   * 管理画面は `account_id` で送る（rangeQuery の約束）。
   * 旧い呼び出し（`accountId`）も当面は受ける。どちらも無ければ
   * 可視アカウントが1つだけのときだけ補う。
   */
  const accountId = (c.req.query('account_id') ?? c.req.query('accountId'))?.trim();
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!accountId) {
    return scope.allowedAccountIds.length === 1
      ? scope.allowedAccountIds[0]
      : inputError(c, { success: false, error: 'accountId required' }, 400, ["account_id","accountId"]);
  }
  if (!scope.allowedAccountIds.includes(accountId)) {
    return c.json({ success: false, error: '対象が見つかりません' }, 404);
  }
  return accountId;
}
