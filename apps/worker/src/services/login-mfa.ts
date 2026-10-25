import { logger } from '@line-crm/shared/server';
import type { Context } from 'hono';
import { getPlatformSetting, getStaffById, recordAuditEvent, type StaffMember } from '@line-crm/db';

import type { Env } from '../worker-env.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { startTwoFactorChallenge, twoFactorRequired } from './admin-session.js';

import { mfaEncryptionConfigured, MFA_KEY_NOTICE } from '../lib/mfa-config.js';

// 店舗管理者が組織ログインを弱められないよう、MFA 方針はアカウントの機能設定でなく組織別の既存 KV に保存する。
export function mfaPolicyKey(tenantId?: string | null): string {
  return `auth.mfa.required:${tenantId ?? DEFAULT_TENANT_ID}`;
}

export async function loginMfaRequired(db: D1Database, tenantId?: string | null, key?: string): Promise<boolean> {
  return mfaEncryptionConfigured(key) && (await getPlatformSetting(db, mfaPolicyKey(tenantId))) !== 'false';
}

export async function loginMfaChallenge(c: Context<Env>, staff: StaffMember, remember: boolean, force = false) {
  const registered = twoFactorRequired(staff);
  if (!mfaEncryptionConfigured(c.env.TOTP_ENCRYPTION_KEY)) {
    logger.warn("mfa_key_unavailable");
    // 本人の登録済み MFA や運用者の強制設定を迂回しない。
    if (!registered && !force) return null;
  }
  if (!force && !registered && !await loginMfaRequired(c.env.DB, staff.tenant_id, c.env.TOTP_ENCRYPTION_KEY)) return null;
  if (!mfaEncryptionConfigured(c.env.TOTP_ENCRYPTION_KEY)) {
    throw new Error('MFA encryption is not configured');
  }
  return {
    twoFactor: registered,
    twoFactorSetup: !registered,
    challengeToken: await startTwoFactorChallenge(c, staff.id, { purpose: registered ? 'verify' : 'setup', remember }),
  };
}

export async function mfaAudit(c: Context<Env>, staffId: string | null, action: string, result: 'success' | 'failed' | 'denied') {
  c.set('mfaAuditRecorded', true);
  const staff = staffId ? await getStaffById(c.env.DB, staffId) : null;
  await recordAuditEvent(c.env.DB, {
    tenantId: staff?.tenant_id, actorRole: staff?.role, category: 'auth', action, actorPrincipalId: staffId, targetKind: 'staff', targetId: staffId,
    result, riskLevel: action === 'auth.mfa.policy' || action === 'auth.mfa.recovery' || result !== 'success' ? 'high' : 'normal', retentionClass: 'security',
  });
}

// 同時要求も含め、コード検証前に原子的に計数する。新しい確認課題や IP 変更でも本人の制限を共有する。
export async function reserveMfaAttempt(c: Context<Env>, tokenHash: string, staffId: string): Promise<boolean> {
  const { bumpAuthThrottle } = await import('@line-crm/db');
  if (await bumpAuthThrottle(c.env.DB, `mfa:${staffId}`, 15 * 60_000) > 5) return false;
  const row = await c.env.DB.prepare(`UPDATE admin_two_factor_challenges SET attempts=attempts+1
    WHERE token_hash=? AND attempts<5 AND julianday(expires_at)>julianday('now') RETURNING token_hash`)
    .bind(tokenHash).first();
  return Boolean(row);
}

export async function consumeMfaChallenge(db: D1Database, tokenHash: string): Promise<boolean> {
  return Boolean(await db.prepare(`DELETE FROM admin_two_factor_challenges
    WHERE token_hash=? AND julianday(expires_at)>julianday('now') RETURNING token_hash`).bind(tokenHash).first());
}
