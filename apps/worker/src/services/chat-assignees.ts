import { getStaffById } from '@line-crm/db';
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

export async function listChatAssignees(db: D1Database, accountId: string | null): Promise<Array<{id:string;name:string}>> {
  const rows = await db.prepare('SELECT id, name FROM staff_members WHERE is_active = 1 ORDER BY name, id').all<{id:string;name:string}>();
  const eligible = await Promise.all(rows.results.map(row => canAssignChatTo(db, row.id, accountId, accountId === null)));
  return rows.results.filter((_, index) => eligible[index]).map(row => ({...row, id: `staff:${row.id}`}));
}

/** 旧名簿とユーザーのIDが同じでも別人として扱う。 */
export function chatAssigneeId(chat: {operator_id: string | null; assignee_staff_id?: string | null}): string | null {
  return chat.assignee_staff_id ? `staff:${chat.assignee_staff_id}` : chat.operator_id;
}

export function staffIdFromChatAssignee(value: string): string | null { return value.startsWith('staff:') && value.length > 6 ? value.slice(6) : null; }
