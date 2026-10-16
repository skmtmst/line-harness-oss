export type WebhookInteractionFailureReason =
  | 'connection_failed'
  | 'response_4xx'
  | 'response_429'
  | 'response_5xx'
  | 'processing_failed'
  | 'unknown'
  /**
   * d23b R415: こちら側の署名用の合言葉が読めず、外部へ一度も送れて
   * いない失敗。「相手から返事がない」(connection_failed)と区別する。
   */
  | 'secret_unavailable';
