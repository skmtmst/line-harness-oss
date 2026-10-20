import { listPendingMileageGrantNotifications } from '@line-crm/db';
import {
  sendMileageNotification,
  type MileageNotificationPorts,
} from './mileage-adjustment-notification.js';

export type { MileageNotificationPorts };

export interface MileageGrantDeliveryResult {
  delivered: number;
  failed: number;
}

/**
 * m22o: 付与ルールの「通知する」で予約された通知を古い順に届ける。
 * 予約は付与の実行時(キュー消化)に載り、送るのはここ(cron)だけ。
 * 通知OFFのルールは予約自体が無いので、何も送らない。
 * 送り済みは拾わないので、二重に送らない。
 */
export async function deliverDueMileageGrantNotifications(
  ports: MileageNotificationPorts,
  options: { limit?: number } = {},
): Promise<MileageGrantDeliveryResult> {
  const pending = await listPendingMileageGrantNotifications(ports.db, { limit: options.limit ?? 20 });
  const result: MileageGrantDeliveryResult = { delivered: 0, failed: 0 };
  for (const item of pending) {
    try {
      const sent = await sendMileageNotification(ports, {
        lineAccountId: item.lineAccountId,
        friendId: item.friendId,
        ledgerEntryId: item.ledgerEntryId,
        idempotencyKey: item.idempotencyKey,
        message: item.message,
      });
      if (sent.status === 'sent') result.delivered += 1;
      else result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
