import { auditEventStatement, getAccountSetting } from '@line-crm/db';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { parseRetentionPolicy, RETENTION_POLICY_KEY, type RetentionPolicy } from './retention-policy.js';

/** Read policy and version from the same row snapshot. Invalid policies still throw. */
export async function readRetentionSetting(db: D1Database, accountId: string) {
  const raw = await getAccountSetting(db, accountId, RETENTION_POLICY_KEY);
  const policy = parseRetentionPolicy(raw);
  const parsed: unknown = raw ? JSON.parse(raw) : null;
  const version = parsed && typeof parsed === 'object' && 'version' in parsed && 'data' in parsed
    && Number.isInteger(parsed.version) && Number(parsed.version) >= 1 && parsed.data !== undefined
    ? Number(parsed.version) : 0;
  return { version, policy };
}

/** Caller checks scope and step-up first. The policy and its audit commit together. */
export async function saveRetentionSetting(
  db: D1Database,
  input: { accountId: string; expectedVersion: number; policy: RetentionPolicy; actor: Pick<AuthenticatedStaff, 'id' | 'tenantId'> },
): Promise<boolean> {
  const { accountId, expectedVersion: version, policy, actor } = input;
  const value = JSON.stringify({ version: version + 1, data: policy });
  const now = new Date().toISOString();
  const saved = await db.batch([
    db.prepare(`INSERT INTO account_settings(id,line_account_id,key,value,created_at,updated_at)
      SELECT ?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM account_settings WHERE line_account_id=? AND key=? AND json_valid(value) AND json_extract(value,'$.version')=?)
      ON CONFLICT(line_account_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
      WHERE json_valid(account_settings.value) AND json_extract(account_settings.value,'$.version')=?`)
      .bind(crypto.randomUUID(), accountId, RETENTION_POLICY_KEY, value, now, now, version, accountId, RETENTION_POLICY_KEY, version, version),
    auditEventStatement(db, {
      category: 'business', action: 'privacy.retention.policy', tenantId: actor.tenantId, lineAccountId: accountId,
      actorPrincipalId: actor.id, targetKind: 'retention', result: 'success', after: policy,
      riskLevel: 'high', retentionClass: 'security',
    }, { sql: 'changes()=1', params: [] }),
  ]);
  return saved[0].meta.changes === 1;
}
