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
        invite_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.name, input.email ?? null, input.role, input.access_level ?? 'full', apiKey,
      input.line_user_id ?? null, input.is_active ?? 1,
      JSON.stringify(input.permission_keys ?? []), JSON.stringify(input.notification_preferences ?? {}),
      input.invite_status ?? 'active', input.invite_token_hash ?? null,
      input.invite_expires_at ?? null, now, now,
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
