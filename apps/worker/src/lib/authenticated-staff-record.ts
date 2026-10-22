import type { StaffMember } from '@line-crm/db';
import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';

// 認証で作るオブジェクトを鍵にし、別要求・別DBへ本人行を持ち越さない。
// 秘密列を含む行はstaff文脈へ載せず、JSON応答にも混ぜない。
const records = new WeakMap<AuthenticatedStaff, { db: D1Database; member: StaffMember }>();

export function rememberAuthenticatedStaffRecord(db: D1Database, staff: AuthenticatedStaff, member: StaffMember): AuthenticatedStaff {
  // 担当範囲を含まない部分行をallとして使わず、その場合は従来どおり再取得する。
  if (member.account_scope !== undefined && member.is_active !== undefined) records.set(staff, { db, member });
  return staff;
}

export function readAuthenticatedStaffRecord(db: D1Database, staff: AuthenticatedStaff): StaffMember | undefined {
  const entry = records.get(staff);
  return entry?.db === db && entry.member.id === staff.id ? entry.member : undefined;
}
