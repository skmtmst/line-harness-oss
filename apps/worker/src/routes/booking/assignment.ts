import { type Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { getAccountTimeZone, getAvailability, tzDateStr } from '../../services/availability.js';
import { DEFAULT_ACCOUNT_SETTINGS } from '../../features/booking/booking-types/index.js';
import { getBookingAutoAssign } from '../../features/booking/booking-channels/index.js';
import { assignBookingStaff } from '../../features/booking/booking-assignment/index.js';
import { googleCredentials, findLatestSlotForInstant } from './availability.js';

export async function needsAutoAssignment(c: Context<Env>, accountId: string, staffId: string): Promise<boolean> {
  if (!staffId) return true;
  if (!await getBookingAutoAssign(c.env.DB, accountId)) return false;
  const staff = await c.env.DB.prepare('SELECT is_designation_optional FROM staff WHERE id = ? AND line_account_id = ?').bind(staffId, accountId).first<{ is_designation_optional: number }>();
  return staff?.is_designation_optional === 1;
}

export async function autoAssignBookingStaff(c: Context<Env>, accountId: string, menuId: string, startsAtRaw: string, customerFacing: boolean,additionalDurationMinutes=0,allowedStaffIds?:string[],forceAssignment=false): Promise<string | null> {
  if (!forceAssignment&&!await getBookingAutoAssign(c.env.DB, accountId)) return null;
  const startsAt = new Date(startsAtRaw);
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() < Date.now()) return null;
  const timeZone = await getAccountTimeZone(c.env.DB, accountId);
  const date = tzDateStr(timeZone, startsAt);
  const latest = await getAvailability(c.env.DB, {
    lineAccountId: accountId, menuId, from: date, to: date, now: new Date(),
    minLeadTimeMinutes: customerFacing ? DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes : 0,
    applyStoreRules: customerFacing,additionalDurationMinutes, googleCredentials: googleCredentials(c.env),
  });
  const rows = await c.env.DB.prepare('SELECT id FROM staff WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL AND is_designation_optional = 0').bind(accountId).all<{ id: string }>();
  const actualStaff = new Set(rows.results.map((staff) => staff.id));
  const availableIds = latest.by_staff.filter((staff) => actualStaff.has(staff.staff_id)&&(!allowedStaffIds||allowedStaffIds.includes(staff.staff_id))
    && findLatestSlotForInstant(staff.slots, startsAt) !== null).map(staff => staff.staff_id);
  return assignBookingStaff(c.env.DB, accountId, startsAt.toISOString(), timeZone, availableIds);
}
