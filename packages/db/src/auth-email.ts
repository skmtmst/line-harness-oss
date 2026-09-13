import { jstNow, toJstString } from './utils.js';
import type { StaffMember } from './staff.js';

/**
 * メールで送る URL（会員登録の本登録・パスワード再設定）と、回数制限。★V6 36-4。
 *
 * URL に入れた値は保存せず SHA-256 のハッシュだけを持つ（migration 292）。
 */

export type AuthEmailTokenPurpose = 'signup' | 'password_reset';

export interface AuthEmailToken {
  id: string;
  purpose: AuthEmailTokenPurpose;
  token_hash: string;
  email: string;
  staff_id: string | null;
  ip_hash: string | null;
  device_marker: string | null;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface CreateAuthEmailTokenInput {
  purpose: AuthEmailTokenPurpose;
  tokenHash: string;
  email: string;
  staffId?: string | null;
  ipHash?: string | null;
  deviceMarker?: string | null;
  expiresAt: string;
}

export async function createAuthEmailToken(db: D1Database, input: CreateAuthEmailTokenInput): Promise<AuthEmailToken> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO auth_email_tokens (id, purpose, token_hash, email, staff_id, ip_hash, device_marker, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.purpose,
      input.tokenHash,
      input.email,
      input.staffId ?? null,
      input.ipHash ?? null,
      input.deviceMarker ?? null,
      input.expiresAt,
      jstNow(),
    )
    .run();
  return (await db.prepare('SELECT * FROM auth_email_tokens WHERE id = ?').bind(id).first<AuthEmailToken>())!;
}

export async function getAuthEmailToken(
  db: D1Database,
  purpose: AuthEmailTokenPurpose,
  tokenHash: string,
): Promise<AuthEmailToken | null> {
  return db
    .prepare('SELECT * FROM auth_email_tokens WHERE purpose = ? AND token_hash = ?')
    .bind(purpose, tokenHash)
    .first<AuthEmailToken>();
}

/** 1 回だけ使えるようにする。すでに使われていたら false。 */
export async function consumeAuthEmailToken(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE auth_email_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
    .bind(jstNow(), id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 同じ用途で、ある時刻以降に作った件数（メール・接続元ごとの上限に使う）。 */
export async function countAuthEmailTokensSince(
  db: D1Database,
  purpose: AuthEmailTokenPurpose,
  by: { email?: string; ipHash?: string },
  since: Date,
): Promise<number> {
  const sinceText = toJstString(since);
  if (by.email !== undefined) {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM auth_email_tokens WHERE purpose = ? AND email = ? AND created_at >= ?')
      .bind(purpose, by.email, sinceText)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
  if (by.ipHash !== undefined) {
    const row = await db
      .prepare('SELECT COUNT(*) AS n FROM auth_email_tokens WHERE purpose = ? AND ip_hash = ? AND created_at >= ?')
      .bind(purpose, by.ipHash, sinceText)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
  return 0;
}

export async function deleteExpiredAuthEmailTokens(db: D1Database, before: Date): Promise<void> {
  await db.prepare('DELETE FROM auth_email_tokens WHERE expires_at < ?').bind(toJstString(before)).run();
}

/**
 * 回数制限。window 内の回数を 1 増やして返す。window を過ぎていたら 1 から数え直す。
 * 例: bumpAuthThrottle(db, 'login:mail:<hash>', 15 * 60_000)
 */
export async function bumpAuthThrottle(db: D1Database, key: string, windowMs: number, now = new Date()): Promise<number> {
  const nowText = toJstString(now);
  const windowStartCutoff = toJstString(new Date(now.getTime() - windowMs));
  const existing = await db
    .prepare('SELECT count, window_start FROM auth_throttles WHERE key = ?')
    .bind(key)
    .first<{ count: number; window_start: string }>();
  if (!existing || existing.window_start < windowStartCutoff) {
    await db
      .prepare(
        `INSERT INTO auth_throttles (key, count, window_start, updated_at) VALUES (?, 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start, updated_at = excluded.updated_at`,
      )
      .bind(key, nowText, nowText)
      .run();
    return 1;
  }
  await db.prepare('UPDATE auth_throttles SET count = count + 1, updated_at = ? WHERE key = ?').bind(nowText, key).run();
  return existing.count + 1;
}

/** window 内の回数を読むだけ（増やさない）。 */
export async function readAuthThrottle(db: D1Database, key: string, windowMs: number, now = new Date()): Promise<number> {
  const windowStartCutoff = toJstString(new Date(now.getTime() - windowMs));
  const existing = await db
    .prepare('SELECT count, window_start FROM auth_throttles WHERE key = ?')
    .bind(key)
    .first<{ count: number; window_start: string }>();
  if (!existing || existing.window_start < windowStartCutoff) return 0;
  return existing.count;
}

export async function clearAuthThrottle(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM auth_throttles WHERE key = ?').bind(key).run();
}

/** メール（大文字小文字を区別しない）で有効な権限者を探す。同じメールが複数の統括にいることがある。 */
export async function getActiveStaffByEmail(db: D1Database, email: string): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members WHERE lower(email) = lower(?) AND is_active = 1 ORDER BY created_at ASC')
    .bind(email)
    .all<StaffMember>();
  return result.results ?? [];
}

/** メールとパスワードでログインできる権限者（パスワードを持つ人は 1 メール 1 人）。 */
export async function getStaffWithPasswordByEmail(db: D1Database, email: string): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE lower(email) = lower(?) AND password_hash IS NOT NULL')
    .bind(email)
    .first<StaffMember>();
}

/** 同じメールで登録済みの権限者がいるか（有効・無効を問わず）。 */
export async function hasStaffWithEmail(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS one FROM staff_members WHERE lower(email) = lower(?) LIMIT 1')
    .bind(email)
    .first<{ one: number }>();
  return !!row;
}

export interface CreateTrialTenantInput {
  name: string;
  trialEndsAt: string;
  deviceMarker?: string | null;
}

/** 会員登録で作る統括。無料トライアルで始まる。 */
export async function createTrialTenant(db: D1Database, input: CreateTrialTenantInput): Promise<string> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO tenants (id, name, status, plan_status, trial_ends_at, plan_updated_at, signup_device_marker, created_at, updated_at)
       VALUES (?, ?, 'active', 'trialing', ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.trialEndsAt, now, input.deviceMarker ?? null, now, now)
    .run();
  return id;
}

/** このブラウザの印で登録された統括があるか。 */
export async function hasTenantWithDeviceMarker(db: D1Database, marker: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS one FROM tenants WHERE signup_device_marker = ? LIMIT 1')
    .bind(marker)
    .first<{ one: number }>();
  return !!row;
}
