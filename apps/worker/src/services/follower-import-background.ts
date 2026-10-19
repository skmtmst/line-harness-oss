import { getLineAccountById } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { FOLLOWER_IMPORT_STATE_KEY, processFollowerImportStep } from './follower-import.js';
import { type FollowerImportClient } from './follower-import-state.js';

// 以下の 3 つはレーン 1 回の実行で使い切ってよい量。
// 1 invocation で出せるサブリクエストは 10,000 回までで、D1 の呼び出しも
// ここに数えられる。ページ読み出しと書き戻しの分を空けて 9,000 人を
// 待っているアカウントで分け合う。
const LANE_PROFILE_BUDGET = 9_000;
// cron の 1 回は実時間 15 分まで動ける。余裕を残して 10 分で切り上げる。
// 待ち時間は CPU 時間（30 秒）に数えられないので、ここは実時間で見る。
const LANE_BUDGET_MS = 10 * 60_000;
// 1 アカウントが続けて使える時間。後ろで待っているアカウントがあるときに
// 先頭の 1 件がレーンを占め続けないようにするための区切り。
const PER_ACCOUNT_BUDGET_MS = 150_000;

/** Bounded cron lane; settings are the durable queue, not the browser. */
export async function processPendingFollowerImports(db: D1Database, options: {
  credentialKey?: string;
  client?: (accountId: string, token: string) => FollowerImportClient;
} = {}) {
  const pending = await db.prepare(`SELECT s.line_account_id AS id FROM account_settings s
    JOIN line_accounts a ON a.id=s.line_account_id
    WHERE s.key=? AND a.is_active=1 AND a.archived_at IS NULL
      AND json_valid(s.value) AND json_extract(s.value,'$.phase') IN ('importing_ids','hydrating_profiles')
    ORDER BY s.updated_at,s.line_account_id LIMIT 5`).bind(FOLLOWER_IMPORT_STATE_KEY).all<{id:string}>();
  const result = { processed:0, busy:0, failed:0 };
  const accounts = pending.results ?? [];
  const laneDeadline = Date.now() + LANE_BUDGET_MS;
  let profilesLeft = LANE_PROFILE_BUDGET;
  let waiting = accounts.length;
  for (const row of accounts) {
    const timeLeft = laneDeadline - Date.now();
    // レーンの時間か人数を使い切ったら残りは次の実行に回す。
    // 進み具合は D1 のカーソルに残っているので取りこぼしにはならない。
    if (timeLeft <= 0 || profilesLeft <= 0) break;
    // 前のアカウントが取り分を使い切らなかった分は、ここで後続に回る。
    const share = Math.max(1, Math.floor(profilesLeft / Math.max(1, waiting)));
    waiting -= 1;
    try {
      const account=await getLineAccountById(db,row.id,options.credentialKey);
      if (!account?.is_active || account.archived_at) continue;
      const client=options.client?.(row.id,account.channel_access_token) ?? new LineClient(account.channel_access_token);
      const step=await processFollowerImportStep(db,client,row.id,{
        budgetMs: Math.min(PER_ACCOUNT_BUDGET_MS, timeLeft),
        maxProfiles: Math.min(share, profilesLeft),
      });
      profilesLeft -= step.profilesFetched;
      if (step.busy) result.busy++; else if (step.state.lastError) result.failed++; else result.processed++;
    } catch { result.failed++; }
  }
  return result;
}
