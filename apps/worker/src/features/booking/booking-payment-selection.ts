import { decidePrepayOnly, getBookingPaymentConfig, resolveBookingPaymentConfig, type BookingPaymentConfig } from '@line-crm/db';

/** 本人向けの選択肢と確定時の検査で同じ条件を使う。前払い限定の理由は公開しない。 */
export async function bookingPaymentSelection(db: D1Database, accountId: string, menuId: string, friendId: string) {
  const config = await resolveBookingPaymentConfig(db, accountId, menuId);
  const onlineOnly = config.mode === 'customer_choice' && (await decidePrepayOnly(db, accountId, friendId)).prepayOnly;
  const allowedMethods: Array<'online' | 'onsite'> = config.mode === 'customer_choice'
    ? onlineOnly ? ['online'] : ['online', 'onsite']
    : config.mode === 'online' || config.mode === 'onsite' ? [config.mode] : [];
  return { config, allowedMethods };
}


/** 選択欄のないLIFFでは店の既定を使う。店も選択式なら決済先を保持する。 */
export async function defaultBookingPaymentSelection(
  db: D1Database, accountId: string,
): Promise<BookingPaymentConfig> {
  const store = await getBookingPaymentConfig(db, accountId);
  if (store.mode !== 'customer_choice') return store;
  return { ...store, mode: store.provider === 'stripe' ? 'online' : 'onsite' };
}
