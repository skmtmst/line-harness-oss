export interface EventPayload {
  /** 再配達されても同じ出来事と判定できる、発生元の不変ID。 */
  sourceEventId?: string;
  /** 発生元の台帳名。分析の冪等キーに使う。 */
  sourceKind?: string;
  /** 推測せず、発生元が持つタイムゾーン付き時刻を渡す。 */
  occurredAt?: string;
  friendId?: string;
  eventData?: Record<string, unknown>;
  conversionEventName?: string;
  conversionValue?: number;
  /** ISO通貨(例 USD)。無いときは円扱い。 */
  conversionCurrency?: string;
  /** 金額が補助単位(セント等)のとき true。通貨不明のときは換算しない。 */
  conversionAmountInMinorUnit?: boolean;
  replyToken?: string;
  /** Recovery must never turn a missing reply token into a billable push. */
  recoveryWithoutReply?: boolean;
  onRecoveryReview?: (code: 'reply_input_unavailable' | 'delivery_unknown') => void;
}

/** Event dispatch supplied by the composition root, including nested tag changes. */
export type EventDispatcher = (db: D1Database, eventType: string, payload: EventPayload, lineAccessToken?: string, lineAccountId?: string | null) => Promise<void>;
