/**
 * 予約画面の操作権限 (N-401 #933)。
 *
 * サーバ側は `/api/booking/admin/*` の変更系口を認可で403にするが、
 * 閲覧のみの人にも操作ボタンが見えていた。画面側も同じ判断で
 * 「押せる形」を出す/出さないを決める。最終の可否は常にサーバが決める。
 *
 * 判定の語彙は /api/staff/me の StaffMember（role は表示用の
 * 'owner'|'admin'|'staff'|'viewer'、viewer は readOnly の利用者）。
 */

/** 予約の編集系 permission key（middleware の permissionForApiPath が立てる語彙）。 */
export const BOOKING_EDIT_KEY = '/booking/bookings'

type StaffPermissionLike = {
  role?: string | null
  permissionKeys?: string[] | null
} | null | undefined

/**
 * 予約を「入れる・変える・状態を変える」を押せる人。
 * owner/admin は常に可。staff は編集キー /booking/bookings を持つ人だけ。
 * viewer（閲覧のみ）と未判定(null)は不可。
 */
export function canOperateBookings(staff: StaffPermissionLike): boolean {
  if (!staff) return false
  if (staff.role === 'owner' || staff.role === 'admin') return true
  if (staff.role === 'staff') return (staff.permissionKeys ?? []).includes(BOOKING_EDIT_KEY)
  return false
}
