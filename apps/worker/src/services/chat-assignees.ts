import { getStaffById, type StaffMember } from '@line-crm/db';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { canAccessAllLineAccounts } from './account-access.js';
import { toAuthenticatedStaff } from '../middleware/auth/principal/auth.js';

/** 新規担当は有効な利用者で、対象アカウントのトークを操作できる人に限る。 */
export async function canAssignChatTo(db: D1Database, staffId: string, accountId: string | null, allowSharedInbox = false): Promise<boolean> {
  if ((!accountId && !allowSharedInbox) || staffId.startsWith('staff:')) return false;
  const member = await getStaffById(db, staffId);
  if (!member || !member.is_active || member.invite_status !== 'active' || member.access_level === 'read_only' || member.tenant_status !== 'active') return false;
  const principal = toAuthenticatedStaff(member);
  if (principal.role === 'staff' && !principal.permissionKeys?.includes('/chats')) return false;
  return canAccessAllLineAccounts(db, principal, [accountId]);
}

export async function listChatAssignees(db: D1Database, tenantId: string, accountIds: readonly string[], sharedInbox: boolean): Promise<Array<{id:string;name:string}>> {
  const [rows, scopes] = await Promise.all([
    db.prepare(`SELECT sm.*, CASE WHEN COALESCE(sm.tenant_id, ?) = ? THEN 'active'
      WHEN t.status IN ('active','suspended','archived') THEN t.status ELSE 'archived' END AS tenant_status
      FROM staff_members sm LEFT JOIN tenants t ON t.id = COALESCE(sm.tenant_id, ?)
      WHERE COALESCE(sm.tenant_id, ?) = ? AND sm.is_active = 1 ORDER BY sm.name, sm.id`)
      .bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, tenantId).all<StaffMember>(),
    db.prepare(`SELECT sas.staff_id, sas.line_account_id FROM staff_account_scopes sas
      JOIN staff_members sm ON sm.id = sas.staff_id WHERE COALESCE(sm.tenant_id, ?) = ?`)
      .bind(DEFAULT_TENANT_ID, tenantId).all<{staff_id:string;line_account_id:string}>(),
  ]);
  const allowedAccounts = new Set(accountIds);
  const scopedStaff = new Set(scopes.results.filter(row => allowedAccounts.has(row.line_account_id)).map(row => row.staff_id));
  return rows.results.filter(member => {
    if (!member.is_active || member.invite_status !== 'active' || member.access_level === 'read_only' || member.tenant_status !== 'active') return false;
    const principal = toAuthenticatedStaff(member);
    if (principal.role === 'staff' && !principal.permissionKeys?.includes('/chats')) return false;
    if (sharedInbox) return tenantId === DEFAULT_TENANT_ID && member.account_scope !== 'accounts';
    return allowedAccounts.size > 0 && (member.account_scope !== 'accounts' || scopedStaff.has(member.id));
  }).map(member => ({ id: `staff:${member.id}`, name: member.name }));
}

/** 旧名簿とユーザーのIDが同じでも別人として扱う。 */
export function chatAssigneeId(chat: {operator_id: string | null; assignee_staff_id?: string | null}): string | null {
  return chat.assignee_staff_id ? `staff:${chat.assignee_staff_id}` : chat.operator_id;
}

export function staffIdFromChatAssignee(value: string): string | null { return value.startsWith('staff:') && value.length > 6 ? value.slice(6) : null; }

/** 担当列をそのまま比較し、索引を使える形にする。 */
export function assigneeFilter(alias: string, value: string, allowUnassigned = false): { sql: string; binds: string[] } {
  if (allowUnassigned && value === 'unassigned') return { sql: `(${alias}.assignee_staff_id IS NULL AND ${alias}.operator_id IS NULL)`, binds: [] };
  if (value.startsWith('staff:')) return { sql: `${alias}.assignee_staff_id = ?`, binds: [value.slice(6)] };
  return { sql: `(${alias}.assignee_staff_id IS NULL AND ${alias}.operator_id = ?)`, binds: [value] };
}
