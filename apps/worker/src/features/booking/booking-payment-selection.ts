import { getBookingPaymentConfig, type BookingPaymentConfig } from '@line-crm/db';


/** 選択欄のないLIFFでは店の既定を使う。店も選択式なら決済先を保持する。 */
export async function defaultBookingPaymentSelection(
  db: D1Database, accountId: string,
): Promise<BookingPaymentConfig> {
  const store = await getBookingPaymentConfig(db, accountId);
  if (store.mode !== 'customer_choice') return store;
  return { ...store, mode: store.provider === 'stripe' ? 'online' : 'onsite' };
}
