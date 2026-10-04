import { getLineAccountById } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { FOLLOWER_IMPORT_STATE_KEY, processFollowerImportStep, type FollowerImportClient } from './follower-import.js';

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
  for (const row of pending.results) {
    try {
      const account=await getLineAccountById(db,row.id,options.credentialKey);
      if (!account?.is_active || account.archived_at) continue;
      const client=options.client?.(row.id,account.channel_access_token) ?? new LineClient(account.channel_access_token);
      const step=await processFollowerImportStep(db,client,row.id);
      if (step.busy) result.busy++; else if (step.state.lastError) result.failed++; else result.processed++;
    } catch { result.failed++; }
  }
  return result;
}
