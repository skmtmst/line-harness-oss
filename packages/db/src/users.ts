import { jstNow } from './utils.js';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
// =============================================================================
// Users — Internal UUID Cross-Account System
// =============================================================================

export interface User {
  id: string;
  tenant_id: string | null;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  email?: string | null;
  phone?: string | null;
  externalId?: string | null;
  displayName?: string | null;
  tenantId?: string | null;
  createdBy?: string | null;
}

export interface UserAccessScope {
  tenantId: string;
  allowedAccountIds: string[];
  includeUnlinked: boolean;
}

const ACCESSIBLE_USER_PREDICATE = `
  (
    u.tenant_id = ?
    OR (
      u.tenant_id IS NULL
      AND EXISTS (
        SELECT 1
          FROM friends tenant_friend
          JOIN line_accounts tenant_account ON tenant_account.id = tenant_friend.line_account_id
         WHERE tenant_friend.user_id = u.id
           AND COALESCE(tenant_account.tenant_id, '${DEFAULT_TENANT_ID}') = ?
      )
      AND NOT EXISTS (
        SELECT 1
          FROM friends foreign_friend
          JOIN line_accounts foreign_account ON foreign_account.id = foreign_friend.line_account_id
         WHERE foreign_friend.user_id = u.id
           AND COALESCE(foreign_account.tenant_id, '${DEFAULT_TENANT_ID}') <> ?
      )
    )
  )
  AND (
    (
      ? = 1
      AND u.tenant_id = ?
      AND NOT EXISTS (SELECT 1 FROM friends unlinked_friend WHERE unlinked_friend.user_id = u.id)
    )
    OR (
      EXISTS (SELECT 1 FROM friends linked_friend WHERE linked_friend.user_id = u.id)
      AND NOT EXISTS (
        SELECT 1
          FROM friends scoped_friend
          LEFT JOIN line_accounts scoped_account ON scoped_account.id = scoped_friend.line_account_id
         WHERE scoped_friend.user_id = u.id
           AND (
             COALESCE(scoped_account.tenant_id, '${DEFAULT_TENANT_ID}') <> ?
             OR scoped_friend.line_account_id NOT IN (SELECT value FROM json_each(?))
           )
      )
    )
  )`;

function accessBindings(scope: UserAccessScope): unknown[] {
  return [
    scope.tenantId,
    scope.tenantId,
    scope.tenantId,
    scope.includeUnlinked ? 1 : 0,
    scope.tenantId,
    scope.tenantId,
    JSON.stringify(scope.allowedAccountIds),
  ];
}

export async function createUser(
  db: D1Database,
  input: CreateUserInput,
): Promise<User> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO users (
         id, email, phone, external_id, display_name, tenant_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.email ?? null,
      input.phone ?? null,
      input.externalId ?? null,
      input.displayName ?? null,
      input.tenantId ?? null,
      input.createdBy ?? null,
      now,
      now,
    )
    .run();

  return (await getUserById(db, id))!;
}

export async function getUserByIdForAccess(
  db: D1Database,
  id: string,
  scope: UserAccessScope,
): Promise<User | null> {
  return db.prepare(
    `SELECT u.* FROM users u WHERE u.id = ? AND ${ACCESSIBLE_USER_PREDICATE}`,
  ).bind(id, ...accessBindings(scope)).first<User>();
}

export async function getUsersForAccess(
  db: D1Database,
  scope: UserAccessScope,
): Promise<User[]> {
  const result = await db.prepare(
    `SELECT u.* FROM users u WHERE ${ACCESSIBLE_USER_PREDICATE} ORDER BY u.created_at DESC`,
  ).bind(...accessBindings(scope)).all<User>();
  return result.results;
}

export async function getUserByEmailForAccess(
  db: D1Database,
  email: string,
  scope: UserAccessScope,
): Promise<User | null> {
  return db.prepare(
    `SELECT u.* FROM users u WHERE u.email = ? AND ${ACCESSIBLE_USER_PREDICATE}`,
  ).bind(email, ...accessBindings(scope)).first<User>();
}

export async function getUserByPhoneForAccess(
  db: D1Database,
  phone: string,
  scope: UserAccessScope,
): Promise<User | null> {
  return db.prepare(
    `SELECT u.* FROM users u WHERE u.phone = ? AND ${ACCESSIBLE_USER_PREDICATE}`,
  ).bind(phone, ...accessBindings(scope)).first<User>();
}

export async function getUserById(
  db: D1Database,
  id: string,
): Promise<User | null> {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<User>();
}

export async function getUsers(db: D1Database): Promise<User[]> {
  const result = await db
    .prepare(`SELECT * FROM users ORDER BY created_at DESC`)
    .all<User>();
  return result.results;
}

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<User | null> {
  return db
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<User>();
}

export async function getUserByPhone(
  db: D1Database,
  phone: string,
): Promise<User | null> {
  return db
    .prepare(`SELECT * FROM users WHERE phone = ?`)
    .bind(phone)
    .first<User>();
}

export type UpdateUserInput = Partial<
  Pick<User, 'email' | 'phone' | 'external_id' | 'display_name'>
>;

export async function updateUser(
  db: D1Database,
  id: string,
  updates: UpdateUserInput,
): Promise<User | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.phone !== undefined) {
    fields.push('phone = ?');
    values.push(updates.phone);
  }
  if (updates.external_id !== undefined) {
    fields.push('external_id = ?');
    values.push(updates.external_id);
  }
  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }

  if (fields.length === 0) return getUserById(db, id);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db
    .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getUserById(db, id);
}

export async function deleteUser(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
}

export async function linkFriendToUser(
  db: D1Database,
  friendId: string,
  userId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE friends SET user_id = ?, updated_at = ? WHERE id = ?`)
    .bind(userId, jstNow(), friendId)
    .run();
}

export async function getUserFriends(
  db: D1Database,
  userId: string,
): Promise<{ id: string; line_user_id: string; display_name: string | null; is_following: number }[]> {
  const result = await db
    .prepare(`SELECT id, line_user_id, display_name, is_following FROM friends WHERE user_id = ?`)
    .bind(userId)
    .all<{ id: string; line_user_id: string; display_name: string | null; is_following: number }>();
  return result.results;
}
