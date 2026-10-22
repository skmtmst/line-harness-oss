import { formatYen } from '@line-crm/shared';
/** 管理画面の見本と同じ料金表記。お問い合わせを無料にしない。 */
export function bookingPriceText(amount: number, mode?: 'fixed' | 'free' | 'inquiry'): string {
  if (mode === 'inquiry') return 'お問い合わせ';
  if (mode === 'free' || (mode === undefined && amount === 0)) return '無料';
  return formatYen(amount);
}

/** 担当別料金と指名料はAPIで別の値。上書き料金との差から推測しない。 */
export function staffNominationFee(staff: { is_designation_optional: number; nomination_fee?: number }): number {
  return staff.is_designation_optional === 1 ? 0 : staff.nomination_fee ?? 0;
}

export function staffBookingPrice(staff: { price: number; is_designation_optional: number; nomination_fee?: number }): number {
  return staff.price + staffNominationFee(staff);
}
