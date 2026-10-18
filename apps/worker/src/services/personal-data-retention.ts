import { logger } from '@line-crm/shared/server';
import { getAccountSetting, recordAuditEvent } from '@line-crm/db';
import { deleteCustomerData } from './customer-data-deletion.js';
import { parseRetentionPolicy, RETENTION_POLICY_KEY, retentionCutoff, type RetentionPolicy } from './retention-policy.js';

export { parseRetentionPolicy, RETENTION_POLICY_KEY, RETENTION_PROPOSAL, retentionCutoff, type RetentionPolicy } from './retention-policy.js';

type RetentionEnvironment = { DB: D1Database; IMAGES?: Pick<R2Bucket, 'delete'> };
type RetentionResult = { deleted: number; failed: number; held: number };

async function readRetentionPolicy(db: D1Database, accountId: string): Promise<RetentionPolicy> {
  return parseRetentionPolicy(await getAccountSetting(db, accountId, RETENTION_POLICY_KEY));
}

export async function processPersonalDataRetention(env: RetentionEnvironment, now = new Date()): Promise<RetentionResult> {
  const accounts = await env.DB.prepare('SELECT id,tenant_id FROM line_accounts WHERE is_active=1')
    .all<{ id: string; tenant_id: string }>();
  let deleted = 0, failed = 0, held = 0;
  // Bound the work per invocation across stores; failures remain eligible for retry.
  let budget = 20;
  accounts: for (const account of accounts.results) {
    if (budget <= 0) break;
    try {
      const policy = await readRetentionPolicy(env.DB, account.id);
      if (!policy.enabled) continue;
      if (policy.hold) { held++; continue; }
      const beforeDeleted = deleted, beforeFailed = failed;
      // A shared form belongs to a store only via its answering friend. Never
      // delete an unassigned response by guessing its store from the form.
      const responses = await env.DB.prepare(`SELECT s.id,s.friend_id,s.form_id FROM form_submissions s JOIN friends f ON f.id=s.friend_id
        WHERE f.line_account_id=? AND julianday(s.created_at)<julianday(?) ORDER BY s.created_at,s.id LIMIT ?`)
        .bind(account.id, retentionCutoff(now, policy.responseDays), budget)
        .all<{ id: string; friend_id: string; form_id: string }>();
      for (const row of responses.results) {
        const current = await readRetentionPolicy(env.DB, account.id);
        if (JSON.stringify(current)!==JSON.stringify(policy)) { held++; continue accounts; }
        budget--;
        try {
          await deleteCustomerData(env, {
            kind: 'form_response', id: row.id, accountId: account.id, friendId: row.friend_id, formId: row.form_id,
          }, 'system:retention');
          deleted++;
        } catch { failed++; }
      }
      if (budget <= 0) continue;
      // Only people who have blocked the account. Active customers never age
      // out just because they haven't edited their profile recently.
      const friends = await env.DB.prepare(`SELECT id,line_user_id FROM friends WHERE line_account_id=? AND is_following=0
        AND last_unfollowed_at IS NOT NULL AND julianday(last_unfollowed_at)<julianday(?) ORDER BY last_unfollowed_at,id LIMIT ?`)
        .bind(account.id, retentionCutoff(now, policy.blockedFriendDays), budget)
        .all<{ id: string; line_user_id: string }>();
      for (const row of friends.results) {
        const current = await readRetentionPolicy(env.DB, account.id);
        if (JSON.stringify(current)!==JSON.stringify(policy)) { held++; continue accounts; }
        budget--;
        try {
          await deleteCustomerData(env, {
            kind: 'friend_data', id: row.id, accountId: account.id, friendId: row.id, lineUserId: row.line_user_id,
          }, 'system:retention');
          deleted++;
        } catch { failed++; }
      }
      // Counts only; security/financial/review histories remain protected by
      // the existing deletion service, never bypass its schema/hold checks.
      await recordAuditEvent(env.DB, {
        category: 'business', action: 'privacy.retention', tenantId: account.tenant_id, lineAccountId: account.id,
        actorPrincipalId: 'system:retention', targetKind: 'retention', result: failed > beforeFailed ? 'failed' : 'success',
        after: { deleted: deleted - beforeDeleted, failed: failed - beforeFailed }, retentionClass: 'security',
      });
    } catch {
      failed++;
      logger.error("personal_data_retention_failed");
    }
  }
  return { deleted, failed, held };
}
