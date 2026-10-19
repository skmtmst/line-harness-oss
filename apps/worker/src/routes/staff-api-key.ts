import { Hono } from 'hono';
import type { Env } from '../worker-env.js';
import { getStaffById, getPlatformSetting, getActiveImpersonation, auditEventStatement } from '@line-crm/db';
import { adminSessionTokenHashFromRequest, sha256Hex } from '../middleware/auth.js';
import { consumeStepUpToken, stepUpRequiredResponse } from '../lib/step-up.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

export const staffApiKey = new Hono<Env>();
const metadataKey = (kind: string, id: string) => `auth.staff_api_key.${kind}:${id}`;
staffApiKey.use('/api/auth/api-key', async (c, next) => {
  const staff = c.get('staff');
  const member = await getStaffById(c.env.DB, staff.id);
  if (staff.credential !== 'session' || !member?.is_active || member.tenant_status !== 'active'
    || (member.tenant_id ?? DEFAULT_TENANT_ID) !== (staff.tenantId ?? DEFAULT_TENANT_ID)
    || c.get('impersonation') || await getActiveImpersonation(c.env.DB, staff.id, await adminSessionTokenHashFromRequest(c))) {
    return c.json({ success: false, code: 'SELF_SESSION_REQUIRED' }, 403);
  }
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  await next();
});
staffApiKey.get('/api/auth/api-key', async c => {
  const id = c.get('staff').id;
  const [issuedAt, lastUsedAt, revokedAt] = await Promise.all(
    ['issued_at', 'last_used_at', 'revoked_at'].map(kind => getPlatformSetting(c.env.DB, metadataKey(kind, id))));
  return c.json({ success: true, data: { issuedAt, lastUsedAt, revokedAt } });
});

staffApiKey.on(['POST', 'DELETE'], '/api/auth/api-key', async c => {
  const staff = c.get('staff');
  if (staff.readOnly) return c.json({ success: false, code: 'READ_ONLY' }, 403);
  const sessionHash = await adminSessionTokenHashFromRequest(c);
  const token = c.req.header('X-Step-Up-Token')?.trim();
  const bound = token && sessionHash && await c.env.DB.prepare(`SELECT 1 FROM auth_step_up_grants
    WHERE token_hash=? AND staff_id=? AND purpose='auth.api_key' AND session_token_hash=?`)
    .bind(await sha256Hex(token), staff.id, sessionHash).first();
  if (!bound || !await consumeStepUpToken(c, 'auth.api_key')) return stepUpRequiredResponse(c, '鍵を変更する前に本人確認してください');
  const member = await getStaffById(c.env.DB, staff.id);
  if (!member) return c.json({ success: false, code: 'SELF_SESSION_REQUIRED' }, 403);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nextKey = `lh_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
  const revoke = c.req.method === 'DELETE';
  const now = new Date().toISOString();
  const guard = 'EXISTS(SELECT 1 FROM staff_members WHERE id=? AND api_key=?)';
  const guardParams = [staff.id, nextKey];
  const statements = [
    c.env.DB.prepare(`UPDATE staff_members SET api_key=?,updated_at=? WHERE id=? AND api_key=? AND is_active=1
      AND COALESCE(access_level,'full')<>'read_only' AND COALESCE(tenant_id,?)=? AND COALESCE(policy_version,0)=?
      AND (COALESCE(tenant_id,?)=? OR EXISTS(SELECT 1 FROM tenants WHERE id=staff_members.tenant_id AND status='active'))
      AND EXISTS(SELECT 1 FROM admin_sessions WHERE token_hash=? AND staff_id=staff_members.id AND expires_at>?)
      AND NOT EXISTS(SELECT 1 FROM impersonation_sessions WHERE staff_id=staff_members.id AND ended_at IS NULL)`)
      .bind(nextKey, now, staff.id, member.api_key, DEFAULT_TENANT_ID, staff.tenantId ?? DEFAULT_TENANT_ID, member.policy_version ?? 0,
        DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, sessionHash, now),
    auditEventStatement(c.env.DB, { category: 'auth', action: revoke ? 'auth.api_key.revoke' : 'auth.api_key.rotate',
      actorPrincipalId: staff.id, actorRole: staff.role, tenantId: member.tenant_id,
      targetKind: 'staff', targetId: staff.id, riskLevel: 'high', retentionClass: 'security' }, { sql: 'changes()=1', params: [] }),
    c.env.DB.prepare(`DELETE FROM platform_settings WHERE key=? AND ${guard}`).bind(metadataKey('last_used_at', staff.id), ...guardParams),
    c.env.DB.prepare(`INSERT INTO platform_settings(key,value,updated_by,updated_at) SELECT ?,?,?,? WHERE ${guard}
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .bind(metadataKey(revoke ? 'revoked_at' : 'issued_at', staff.id), now, staff.id, now, ...guardParams),
  ];
  if (!revoke) statements.push(c.env.DB.prepare(`DELETE FROM platform_settings WHERE key=? AND ${guard}`).bind(metadataKey('revoked_at', staff.id), ...guardParams));
  // No auth-method column exists: revoke all of this person's sessions, including sessions previously issued with the old key.
  statements.push(
    c.env.DB.prepare(`DELETE FROM platform_settings WHERE key IN(SELECT 'auth.mfa.session:'||token_hash FROM admin_sessions WHERE staff_id=?) AND ${guard}`).bind(staff.id, ...guardParams),
    ...['admin_sessions', 'auth_step_up_grants', 'admin_two_factor_challenges'].map(table =>
      c.env.DB.prepare(`DELETE FROM ${table} WHERE staff_id=? AND ${guard}`).bind(staff.id, ...guardParams)),
    c.env.DB.prepare(`UPDATE impersonation_sessions SET ended_at=? WHERE staff_id=? AND ended_at IS NULL AND ${guard}`).bind(now, staff.id, ...guardParams),
  );
  const result = await c.env.DB.batch(statements);
  if (result[0].meta.changes !== 1) return c.json({ success: false, code: 'KEY_CHANGED' }, 409);
  return c.json({ success: true, data: revoke ? { revoked: true, loginRequired: true } : { apiKey: nextKey, loginRequired: true } });
});
