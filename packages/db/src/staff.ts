import { jstNow } from './utils.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  access_level: 'full' | 'read_only';
  api_key: string;
  line_user_id: string | null;
  is_active: number;
  permission_keys: string;
  notification_preferences: string;
  invite_status: 'pending_email' | 'pending_line' | 'active' | 'expired';
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  email_verified_at: string | null;
  line_linked_at: string | null;
  totp_secret_enc: string | null;
  totp_pending_secret_enc: string | null;
  totp_enabled_at: string | null;
  totp_last_used_step: number | null;
  assigned_line_account_id?: string | null;
  can_access_descendant_accounts?: number;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStaffInput {
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff';
  access_level?: 'full' | 'read_only';
  line_user_id?: string | null;
  is_active?: number;
  permission_keys?: string[];
  notification_preferences?: Record<string, { email: boolean; line: boolean }>;
  invite_status?: StaffMember['invite_status'];
  invite_token_hash?: string | null;
  invite_expires_at?: string | null;
  assigned_line_account_id?: string | null;
  can_access_descendant_accounts?: boolean;
}

export interface UpdateStaffInput {
  name?: string;
  email?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  access_level?: 'full' | 'read_only';
  is_active?: number;
  line_user_id?: string | null;
  permission_keys?: string[];
  notification_preferences?: Record<string, { email: boolean; line: boolean }>;
  invite_status?: StaffMember['invite_status'];
  invite_token_hash?: string | null;
  invite_expires_at?: string | null;
  email_verified_at?: string | null;
  line_linked_at?: string | null;
  totp_secret_enc?: string | null;
  totp_pending_secret_enc?: string | null;
  totp_enabled_at?: string | null;
  totp_last_used_step?: number | null;
  assigned_line_account_id?: string | null;
  can_access_descendant_accounts?: boolean;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `lh_${hex}`;
}

export async function getStaffByApiKey(
  db: D1Database,
  apiKey: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey)
    .first<StaffMember>();
}

export async function getStaffByLineUserId(
  db: D1Database,
  lineUserId: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE line_user_id = ? AND is_active = 1')
    .bind(lineUserId)
    .first<StaffMember>();
}

/**
 * 無効な人も含めて LINE ユーザーIDで引く。
 *
 * 招待からの連携では、無効化された古い行が同じLINEアカウントを握ったまま
 * 残っていることがある。line_user_id にはユニーク制約があるので、先に
 * 見つけて外さないと連携そのものが失敗する。ログイン判定には使わない。
 */
export async function getStaffByLineUserIdIncludingInactive(
  db: D1Database,
  lineUserId: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<StaffMember>();
}

export async function getStaffMembers(db: D1Database): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at ASC')
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>();
}

export async function createStaffMember(
  db: D1Database,
  input: CreateStaffInput,
): Promise<StaffMember> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();

  await db
    .prepare(
      `INSERT INTO staff_members
       (id, name, email, role, access_level, api_key, line_user_id, is_active,
        permission_keys, notification_preferences, invite_status, invite_token_hash,
        invite_expires_at, assigned_line_account_id, can_access_descendant_accounts,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.name, input.email ?? null, input.role, input.access_level ?? 'full', apiKey,
      input.line_user_id ?? null, input.is_active ?? 1,
      JSON.stringify(input.permission_keys ?? []), JSON.stringify(input.notification_preferences ?? {}),
      input.invite_status ?? 'active', input.invite_token_hash ?? null,
      input.invite_expires_at ?? null, input.assigned_line_account_id ?? null,
      input.can_access_descendant_accounts ? 1 : 0, now, now,
    )
    .run();

  return (await db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>())!;
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { sets.push('email = ?'); values.push(input.email ?? null); }
  if (input.role !== undefined) { sets.push('role = ?'); values.push(input.role); }
  if (input.access_level !== undefined) { sets.push('access_level = ?'); values.push(input.access_level); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }
  if (input.line_user_id !== undefined) { sets.push('line_user_id = ?'); values.push(input.line_user_id); }
  if (input.permission_keys !== undefined) { sets.push('permission_keys = ?'); values.push(JSON.stringify(input.permission_keys)); }
  if (input.notification_preferences !== undefined) { sets.push('notification_preferences = ?'); values.push(JSON.stringify(input.notification_preferences)); }
  if (input.invite_status !== undefined) { sets.push('invite_status = ?'); values.push(input.invite_status); }
  if (input.invite_token_hash !== undefined) { sets.push('invite_token_hash = ?'); values.push(input.invite_token_hash); }
  if (input.invite_expires_at !== undefined) { sets.push('invite_expires_at = ?'); values.push(input.invite_expires_at); }
  if (input.email_verified_at !== undefined) { sets.push('email_verified_at = ?'); values.push(input.email_verified_at); }
  if (input.line_linked_at !== undefined) { sets.push('line_linked_at = ?'); values.push(input.line_linked_at); }
  if (input.totp_secret_enc !== undefined) { sets.push('totp_secret_enc = ?'); values.push(input.totp_secret_enc); }
  if (input.totp_pending_secret_enc !== undefined) { sets.push('totp_pending_secret_enc = ?'); values.push(input.totp_pending_secret_enc); }
  if (input.totp_enabled_at !== undefined) { sets.push('totp_enabled_at = ?'); values.push(input.totp_enabled_at); }
  if (input.totp_last_used_step !== undefined) { sets.push('totp_last_used_step = ?'); values.push(input.totp_last_used_step); }
  if (input.assigned_line_account_id !== undefined) { sets.push('assigned_line_account_id = ?'); values.push(input.assigned_line_account_id); }
  if (input.can_access_descendant_accounts !== undefined) { sets.push('can_access_descendant_accounts = ?'); values.push(input.can_access_descendant_accounts ? 1 : 0); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function getStaffByInviteTokenHash(db: D1Database, tokenHash: string): Promise<StaffMember | null> {
  return db.prepare('SELECT * FROM staff_members WHERE invite_token_hash = ?').bind(tokenHash).first<StaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function regenerateStaffApiKey(db: D1Database, id: string): Promise<string> {
  const newKey = generateApiKey();
  const now = jstNow();
  const result = await db
    .prepare('UPDATE staff_members SET api_key = ?, updated_at = ? WHERE id = ?')
    .bind(newKey, now, id)
    .run();
  if (result.meta.changes === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return newKey;
}

export async function countStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ?')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countActiveStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ? AND is_active = 1')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function createAdminSession(
  db: D1Database,
  tokenHash: string,
  staffId: string,
  expiresAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_sessions (token_hash, staff_id, expires_at)
       VALUES (?, ?, ?)`,
    )
    .bind(tokenHash, staffId, expiresAt)
    .run();
}

export async function getStaffByAdminSession(
  db: D1Database,
  tokenHash: string,
  now: string,
): Promise<StaffMember | null> {
  return db
    .prepare(
      `SELECT sm.*
       FROM admin_sessions s
       JOIN staff_members sm ON sm.id = s.staff_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND sm.is_active = 1`,
    )
    .bind(tokenHash, now)
    .first<StaffMember>();
}

export async function deleteAdminSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteExpiredAdminSessions(db: D1Database, now: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run();
}

export interface TwoFactorChallenge {
  token_hash: string;
  staff_id: string;
  expires_at: string;
  attempts: number;
  created_at: string;
}

export async function createTwoFactorChallenge(
  db: D1Database,
  tokenHash: string,
  staffId: string,
  expiresAt: string,
): Promise<void> {
  await db.prepare('DELETE FROM admin_two_factor_challenges WHERE staff_id = ?').bind(staffId).run();
  await db.prepare(
    'INSERT INTO admin_two_factor_challenges (token_hash, staff_id, expires_at) VALUES (?, ?, ?)',
  ).bind(tokenHash, staffId, expiresAt).run();
}

export async function getTwoFactorChallenge(
  db: D1Database,
  tokenHash: string,
): Promise<TwoFactorChallenge | null> {
  return db.prepare('SELECT * FROM admin_two_factor_challenges WHERE token_hash = ?')
    .bind(tokenHash).first<TwoFactorChallenge>();
}

export async function incrementTwoFactorChallengeAttempts(
  db: D1Database,
  tokenHash: string,
): Promise<void> {
  await db.prepare('UPDATE admin_two_factor_challenges SET attempts = attempts + 1 WHERE token_hash = ?')
    .bind(tokenHash).run();
}

export async function deleteTwoFactorChallenge(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_two_factor_challenges WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteExpiredTwoFactorChallenges(db: D1Database, now: string): Promise<void> {
  await db.prepare('DELETE FROM admin_two_factor_challenges WHERE expires_at <= ?').bind(now).run();
}

/** Atomically claims a TOTP time step so the same code cannot create two sessions. */
export async function claimStaffTotpStep(db: D1Database, staffId: string, step: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE staff_members
     SET totp_last_used_step = ?, updated_at = ?
     WHERE id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)`,
  ).bind(step, jstNow(), staffId, step).run();
  return result.meta.changes === 1;
}
