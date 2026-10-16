
/** F-22: 同じ出来事の目印を維持した広告送信のやり直し結果。 */
export interface AdConversionRetryResult {
  logId: string;
  outboxId: string;
  providerEventId: string;
  status: 'sent' | 'failed' | 'pending';
  /** 送信済みの結果を返した場合はtrue。 */
  replayed: boolean;
}
