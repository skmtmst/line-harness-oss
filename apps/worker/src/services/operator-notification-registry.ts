// N-327 (#663): 運用者通知ルールが自動発火できる業務イベントの登録簿。
//
// 公開済みルールは、ここに載っているきっかけ(event type)にだけ反応する。
// 載っていないきっかけは発火しない(400 unknown_event_type)。
// producer接続は1件ずつ行い、つないだら connected を true にする。
// 残りが未接続のままなのが画面・口から分かるようにするのが役目。

export interface OperatorEventProducer {
  file: string;
  route: string;
}

export interface OperatorEventTypeEntry {
  /** 通知ルールの event_type と突き合わせる名前 */
  eventType: string;
  /** 運用者に見せる名前 */
  label: string;
  /** 業務イベントを出す側。connected=false の間は触らない(司令塔の承認待ち) */
  producer: OperatorEventProducer;
  /** 実producerから自動発火するよう接続済みか */
  connected: boolean;
}

export const OPERATOR_NOTIFICATION_EVENT_TYPES: OperatorEventTypeEntry[] = [
  {
    eventType: 'booking_created',
    label: '予約の受付',
    producer: {
      file: 'apps/worker/src/routes/booking.ts',
      route: 'POST /api/liff/booking/requests',
    },
    connected: false,
  },
  {
    eventType: 'broadcast_completed',
    label: '一斉配信の完了',
    producer: {
      file: 'apps/worker/src/routes/broadcasts.ts',
      route: 'POST /api/broadcasts/:id/send',
    },
    connected: true,
  },
  {
    eventType: 'form_submitted',
    label: 'フォームの回答',
    producer: {
      file: 'apps/worker/src/routes/forms.ts',
      route: 'POST /api/forms/:id/submit',
    },
    connected: false,
  },
  {
    eventType: 'ec_order_received',
    label: 'ECの受注',
    producer: {
      file: 'apps/worker/src/routes/ec-integrations.ts',
      route: 'POST /api/integrations/eccube/events',
    },
    connected: true,
  },
];

export function isKnownOperatorEventType(eventType: string): boolean {
  return OPERATOR_NOTIFICATION_EVENT_TYPES.some((entry) => entry.eventType === eventType);
}

export function listOperatorEventTypes(): OperatorEventTypeEntry[] {
  return OPERATOR_NOTIFICATION_EVENT_TYPES.map((entry) => ({
    ...entry,
    producer: { ...entry.producer },
  }));
}
