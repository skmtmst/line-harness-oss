/** ECから受け付ける出来事。保存済みのイベントコードを正本として共有する。 */
export const EC_EVENT_TYPES = [
  'ec.order.confirmed',
  'ec.order.payment_received',
  'ec.order.bank_transfer_reminder',
  'ec.order.shipped',
  'ec.order.cancelled',
  'ec.order.refunded',
  'ec.subscription.upcoming',
  'ec.subscription.payment_failed',
  'ec.subscription.card_updated',
  'ec.subscription.cancelled',
  'ec.customer.profile_updated',
] as const;

/** WebとWorkerで同じ表示名を使うための正本。 */
export const EC_EVENT_LABELS = {
  'ec.order.confirmed': '注文完了',
  'ec.order.payment_received': '入金確認完了',
  'ec.order.bank_transfer_reminder': '銀行振込期限',
  'ec.order.shipped': '発送完了',
  'ec.order.cancelled': '注文キャンセル',
  'ec.order.refunded': '返金完了',
  'ec.subscription.upcoming': '次回定期便',
  'ec.subscription.payment_failed': '定期便の決済失敗',
  'ec.subscription.card_updated': 'カード変更・再決済結果',
  'ec.subscription.cancelled': '定期便の解約',
  'ec.customer.profile_updated': 'ペット情報更新',
  // 既存の画面履歴にだけ現れる値。受信許可はせず、表示名だけを維持する。
  'ec.subscription.started': '定期便がはじまりました',
} as const;

export type EcEventType = keyof typeof EC_EVENT_LABELS;

export function ecEventLabel(eventType: string, fallback = 'ECの出来事'): string {
  return Object.prototype.hasOwnProperty.call(EC_EVENT_LABELS, eventType)
    ? EC_EVENT_LABELS[eventType as EcEventType]
    : fallback;
}
