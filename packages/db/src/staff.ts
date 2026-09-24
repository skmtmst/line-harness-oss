import { jstNow } from './utils.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';

export type TenantStatus = 'active' | 'suspended' | 'archived';

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
  password_hash?: string | null;
  password_updated_at?: string | null;
  assigned_line_account_id?: string | null;
  can_access_descendant_accounts?: number;
  account_scope?: 'all' | 'accounts';
  policy_version?: number;
  /** N-424: 明示保存された役割bundle。NULL は従来どおり role+access_level から導出。 */
  role_bundle?: string | null;
  /** N-424: 「見えるだけ」の permission key(JSON配列)。GET系だけを許可する。 */
  view_permission_keys?: string | null;
  /** N-424: スタッフのメール表示。'full'|'masked'|'none'、NULL は従来判定。 */
  email_mask?: string | null;
  /** N-433: 確認待ちの新しいメールアドレス。確認するまで email は変えない。 */
  email_change_new?: string | null;
  email_change_token_hash?: string | null;
  email_change_expires_at?: string | null;
  tenant_id: string | null;
  /** 認証用 JOIN でだけ付く所属統括の実効状態。既定の運営会社は常に active。 */
  tenant_status?: TenantStatus;
  created_at: string;
  updated_at: string;
}

/**
 * 認証用 staff 取得の共通射影。
 *
 * 既定の運営会社は契約先の停止対象ではないため常に active とする。
 * それ以外で統括行が失われている場合は安全側の archived に倒す。
 */
const STAFF_WITH_TENANT_STATUS = `SELECT sm.*,
  CASE
    WHEN COALESCE(sm.tenant_id, ?) = ? THEN 'active'
    WHEN t.status IN ('active', 'suspended', 'archived') THEN t.status
    ELSE 'archived'
  END AS tenant_status
  FROM staff_members sm
  LEFT JOIN tenants t ON t.id = COALESCE(sm.tenant_id, ?)`;

function tenantStatusBindings(): [string, string, string] {
  return [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID];
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
  account_scope?: 'all' | 'accounts';
  role_bundle?: string | null;
  view_permission_keys?: string[];
  email_mask?: string | null;
  tenant_id?: string | null;
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
  password_hash?: string | null;
  password_updated_at?: string | null;
  assigned_line_account_id?: string | null;
  can_access_descendant_accounts?: boolean;
  account_scope?: 'all' | 'accounts';
  role_bundle?: string | null;
  view_permission_keys?: string[];
  email_mask?: string | null;
  email_change_new?: string | null;
  email_change_token_hash?: string | null;
  email_change_expires_at?: string | null;
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
    .prepare(`${STAFF_WITH_TENANT_STATUS} WHERE sm.api_key = ? AND sm.is_active = 1`)
    .bind(...tenantStatusBindings(), apiKey)
    .first<StaffMember>();
}

export async function getStaffByLineUserId(
  db: D1Database,
  lineUserId: string,
): Promise<StaffMember | null> {
  return db
    .prepare(`${STAFF_WITH_TENANT_STATUS} WHERE sm.line_user_id = ? AND sm.is_active = 1`)
    .bind(...tenantStatusBindings(), lineUserId)
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
    .prepare(`${STAFF_WITH_TENANT_STATUS} WHERE sm.line_user_id = ?`)
    .bind(...tenantStatusBindings(), lineUserId)
    .first<StaffMember>();
}

export async function getStaffMembers(db: D1Database, tenantId: string): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members WHERE COALESCE(tenant_id, ?) = ? ORDER BY created_at ASC')
    .bind(DEFAULT_TENANT_ID, tenantId)
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare(`${STAFF_WITH_TENANT_STATUS} WHERE sm.id = ?`)
    .bind(...tenantStatusBindings(), id)
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
        account_scope, role_bundle, view_permission_keys, email_mask,
        tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.name, input.email ?? null, input.role, input.access_level ?? 'full', apiKey,
      input.line_user_id ?? null, input.is_active ?? 1,
      JSON.stringify(input.permission_keys ?? []), JSON.stringify(input.notification_preferences ?? {}),
      input.invite_status ?? 'active', input.invite_token_hash ?? null,
      input.invite_expires_at ?? null, input.assigned_line_account_id ?? null,
      input.can_access_descendant_accounts ? 1 : 0,
      input.account_scope ?? 'all',
      input.role_bundle ?? null,
      input.view_permission_keys ? JSON.stringify(input.view_permission_keys) : null,
      input.email_mask ?? null,
      input.tenant_id ?? DEFAULT_TENANT_ID, now, now,
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
  const sets: string[] = ['updated_at = ?', 'policy_version = policy_version + 1'];
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
  if (input.password_hash !== undefined) { sets.push('password_hash = ?'); values.push(input.password_hash); }
  if (input.password_updated_at !== undefined) { sets.push('password_updated_at = ?'); values.push(input.password_updated_at); }
  if (input.assigned_line_account_id !== undefined) { sets.push('assigned_line_account_id = ?'); values.push(input.assigned_line_account_id); }
  if (input.can_access_descendant_accounts !== undefined) { sets.push('can_access_descendant_accounts = ?'); values.push(input.can_access_descendant_accounts ? 1 : 0); }
  if (input.account_scope !== undefined) { sets.push('account_scope = ?'); values.push(input.account_scope); }
  if (input.role_bundle !== undefined) { sets.push('role_bundle = ?'); values.push(input.role_bundle); }
  if (input.view_permission_keys !== undefined) { sets.push('view_permission_keys = ?'); values.push(JSON.stringify(input.view_permission_keys)); }
  if (input.email_mask !== undefined) { sets.push('email_mask = ?'); values.push(input.email_mask); }
  if (input.email_change_new !== undefined) { sets.push('email_change_new = ?'); values.push(input.email_change_new); }
  if (input.email_change_token_hash !== undefined) { sets.push('email_change_token_hash = ?'); values.push(input.email_change_token_hash); }
  if (input.email_change_expires_at !== undefined) { sets.push('email_change_expires_at = ?'); values.push(input.email_change_expires_at); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function getStaffAccountScopeIds(db: D1Database, staffId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT line_account_id FROM staff_account_scopes WHERE staff_id = ? ORDER BY line_account_id')
    .bind(staffId)
    .all<{ line_account_id: string }>();
  return result.results.map((row) => row.line_account_id);
}

/*
 * 一覧の N+1 対策。1人ずつ getStaffAccountScopeIds を叩くと
 * 人数分の往復になるので、一覧では IN で一括取得して振り分ける。
 */
export async function getStaffAccountScopeMap(
  db: D1Database,
  staffIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const ids = [...new Set(staffIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return map;
  const result = await db
    .prepare(`SELECT staff_id, line_account_id FROM staff_account_scopes WHERE staff_id IN (${ids.map(() => '?').join(',')}) ORDER BY staff_id, line_account_id`)
    .bind(...ids)
    .all<{ staff_id: string; line_account_id: string }>();
  for (const row of result.results) {
    const list = map.get(row.staff_id) ?? [];
    list.push(row.line_account_id);
    map.set(row.staff_id, list);
  }
  return map;
}

export async function replaceStaffAccountScopes(
  db: D1Database,
  staffId: string,
  lineAccountIds: string[],
): Promise<void> {
  const now = jstNow();
  await db.batch([
    db.prepare('DELETE FROM staff_account_scopes WHERE staff_id = ?').bind(staffId),
    ...lineAccountIds.map((lineAccountId) => db
      .prepare('INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES (?, ?, ?)')
      .bind(staffId, lineAccountId, now)),
  ]);
}

export async function getStaffByInviteTokenHash(db: D1Database, tokenHash: string): Promise<StaffMember | null> {
  return db
    .prepare(`${STAFF_WITH_TENANT_STATUS} WHERE sm.invite_token_hash = ?`)
    .bind(...tenantStatusBindings(), tokenHash)
    .first<StaffMember>();
}

/** N-433: メール変更の確認リンクから本人の行を引く。トークンは指紋で照合する。 */
export async function getStaffByEmailChangeTokenHash(db: D1Database, tokenHash: string): Promise<StaffMember | null> {
  return db.prepare('SELECT * FROM staff_members WHERE email_change_token_hash = ?').bind(tokenHash).first<StaffMember>();
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
  device: { userAgent?: string | null; ipPrefix?: string | null } = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_sessions (token_hash, staff_id, expires_at, user_agent, ip_prefix)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(tokenHash, staffId, expiresAt, device.userAgent ?? null, device.ipPrefix ?? null)
    .run();
}

/** 本人のセッション一覧用。token_hash は漏れても認証に使えない指紋として返す。 */
export interface AdminSessionSummary {
  token_hash: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_prefix: string | null;
}

export async function listAdminSessionsByStaff(
  db: D1Database,
  staffId: string,
  now: string,
): Promise<AdminSessionSummary[]> {
  const result = await db
    .prepare(
      `SELECT token_hash, created_at, expires_at, user_agent, ip_prefix
       FROM admin_sessions
       WHERE staff_id = ? AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .bind(staffId, now)
    .all<AdminSessionSummary>();
  return result.results ?? [];
}

/** 本人のセッションだけを消す。他人の token_hash を指定しても削除しない。 */
export async function deleteAdminSessionForStaff(
  db: D1Database,
  staffId: string,
  tokenHash: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM admin_sessions WHERE staff_id = ? AND token_hash = ?')
    .bind(staffId, tokenHash)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** 今のセッション以外をまとめて失効させる。消した件数を返す。 */
export async function deleteOtherAdminSessions(
  db: D1Database,
  staffId: string,
  keepTokenHash: string,
): Promise<number> {
  const result = await db
    .prepare('DELETE FROM admin_sessions WHERE staff_id = ? AND token_hash <> ?')
    .bind(staffId, keepTokenHash)
    .run();
  return result.meta.changes ?? 0;
}

export async function getStaffByAdminSession(
  db: D1Database,
  tokenHash: string,
  now: string,
): Promise<StaffMember | null> {
  return db
    .prepare(
      `SELECT sm.*,
              CASE
                WHEN COALESCE(sm.tenant_id, ?) = ? THEN 'active'
                WHEN t.status IN ('active', 'suspended', 'archived') THEN t.status
                ELSE 'archived'
              END AS tenant_status
       FROM admin_sessions s
       JOIN staff_members sm ON sm.id = s.staff_id
       LEFT JOIN tenants t ON t.id = COALESCE(sm.tenant_id, ?)
       WHERE s.token_hash = ? AND s.expires_at > ? AND sm.is_active = 1`,
    )
    .bind(...tenantStatusBindings(), tokenHash, now)
    .first<StaffMember>();
}

export async function deleteAdminSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function deleteExpiredAdminSessions(db: D1Database, now: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(now).run();
}

/**
 * 権限・利用状態・MFAの変更後に、対象者が古い認証状態を使い続けないようにする。
 *
 * staff_members は毎リクエスト読み直すため権限そのものは即時反映されるが、
 * 変更前に発行したセッションと二段階認証の途中状態は残る。両方を同じ処理で
 * 消し、次の操作では必ず新しい設定でログインし直してもらう。
 */
export async function revokeStaffAuthentication(db: D1Database, staffId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE staff_id = ?').bind(staffId),
    db.prepare('DELETE FROM admin_two_factor_challenges WHERE staff_id = ?').bind(staffId),
  ]);
}

export type TwoFactorChallengePurpose = 'verify' | 'setup';

export interface TwoFactorChallenge {
  token_hash: string;
  staff_id: string;
  expires_at: string;
  attempts: number;
  created_at: string;
  /** 'verify' は登録済みの確認用、'setup' は未登録者の初回設定用。混ぜて使えない。 */
  purpose: TwoFactorChallengePurpose;
  /** 1 なら確認後に発行するセッションを 7 日、0 なら既定の 8 時間にする。 */
  remember: number;
}

export async function createTwoFactorChallenge(
  db: D1Database,
  tokenHash: string,
  staffId: string,
  expiresAt: string,
  options: { purpose?: TwoFactorChallengePurpose; remember?: boolean } = {},
): Promise<void> {
  await db.prepare('DELETE FROM admin_two_factor_challenges WHERE staff_id = ?').bind(staffId).run();
  await db.prepare(
    'INSERT INTO admin_two_factor_challenges (token_hash, staff_id, expires_at, purpose, remember) VALUES (?, ?, ?, ?, ?)',
  ).bind(tokenHash, staffId, expiresAt, options.purpose ?? 'verify', options.remember ? 1 : 0).run();
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
