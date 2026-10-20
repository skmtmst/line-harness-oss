import { finishExpiredWaitlists } from '../../features/booking/booking-waitlist/index.js';

/**
 * キャンセル待ちの登録の共通処理（管理画面・LIFF）。
 *
 * 満席の判定は空き照会の表示側で行い、登録口は受け付ける。
 * 開始時刻は UTC ISO (Z) にそろえる（取り消し時の突き合わせ用）。
 */
export async function insertWaitlistEntry(
  db: D1Database,
  input: {
    lineAccountId: string;
    staffId: string;
    menuId: string;
    startsAt: string;
    friendId: string | null;
    bookingCustomerId: string | null;
  },
): Promise<
  | { ok: true; id: string }
  | { ok: false; error: 'invalid_slot' | 'missing_customer' | 'customer_not_found' | 'invalid_starts_at' | 'starts_at_in_past' | 'already_waiting' | 'registration_closed' | 'waitlist_limit' | 'slot_not_full' }
> {
  const staffId = input.staffId.trim();
  const menuId = input.menuId.trim();
  if (!staffId || !menuId) return { ok: false, error: 'invalid_slot' };
  const startsAtMs = Date.parse(input.startsAt);
  if (Number.isNaN(startsAtMs)) return { ok: false, error: 'invalid_starts_at' };
  if (startsAtMs <= Date.now()) return { ok: false, error: 'starts_at_in_past' };
  if(startsAtMs<=Date.now()+60*60_000)return {ok:false,error:'registration_closed'};
  await finishExpiredWaitlists(db,input.lineAccountId);
  const startsAt = new Date(startsAtMs).toISOString();
  const { friendId, bookingCustomerId } = input;
  if ((!friendId && !bookingCustomerId) || (friendId && bookingCustomerId)) {
    return { ok: false, error: 'missing_customer' };
  }
  const staff = await db
    .prepare(`SELECT 1 AS ok FROM staff
      WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL AND is_active = 1`)
    .bind(staffId, input.lineAccountId)
    .first<{ ok: number }>();
  const menu = await db
    .prepare(`SELECT 1 AS ok FROM menus
      WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL AND is_active = 1`)
    .bind(menuId, input.lineAccountId)
    .first<{ ok: number }>();
  if (!staff || !menu) return { ok: false, error: 'invalid_slot' };
  const ownerTable = friendId ? 'friends' : 'booking_customers';
  const ownerId = (friendId ?? bookingCustomerId) as string;
  const owner = await db
    .prepare(`SELECT 1 AS ok FROM ${ownerTable} WHERE id = ? AND line_account_id = ?`)
    .bind(ownerId, input.lineAccountId)
    .first<{ ok: number }>();
  if (!owner) return { ok: false, error: 'customer_not_found' };
  const identityKey = friendId ? `friend:${friendId}` : `customer:${bookingCustomerId}`;
  const existing = await db
    .prepare(`SELECT id FROM booking_waitlist
      WHERE line_account_id = ? AND staff_id = ? AND starts_at = ?
        AND identity_key = ? AND status IN ('waiting', 'invited')`)
    .bind(input.lineAccountId, staffId, startsAt, identityKey)
    .first<{ id: string }>();
  if (existing) return { ok: false, error: 'already_waiting' };
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(`INSERT INTO booking_waitlist
        (id, line_account_id, staff_id, menu_id, starts_at, friend_id,
         booking_customer_id, identity_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.lineAccountId, staffId, menuId, startsAt,
        friendId, bookingCustomerId, identityKey)
      .run();
  } catch (error) {
    // 同時登録の race は部分一致キーが止める。
    if (/waitlist_limit/.test(String(error)))return {ok:false,error:'waitlist_limit'};
    if(/waitlist_registration_closed/.test(String(error)))return {ok:false,error:'registration_closed'};
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return { ok: false, error: 'already_waiting' };
    }
    throw error;
  }
  return { ok: true, id };
}

export const WAITLIST_ERROR_STATUS: Record<string, number> = {
  invalid_slot: 400,
  missing_customer: 400,
  invalid_starts_at: 400,
  starts_at_in_past: 400,
  customer_not_found: 404,
  already_waiting: 409,
  registration_closed:409,waitlist_limit:409,slot_not_full:409,
};

export interface WaitlistEntryLike {
  hold_expires_at:string|null;
  menu_id:string;
  staff_id: string;
  starts_at: string;
  friend_id: string | null;
  booking_customer_id: string | null;
  status: string;
}
