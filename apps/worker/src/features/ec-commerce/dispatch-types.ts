
/*
 * EC イベント1件の取り込み後処理（受付口と再試行で共用）。
 *
 * 受付口（webhook）は署名・台帳・読み取りモデルまで済ませてから呼ぶ。
 * 再試行（sweeper）は保存済み payload を起こして同じ入口から回す。
 * どちらも claim（received/failed → processing）で1回だけ進み、
 * 送信の冪等キー（X-Line-Retry-Key・dispatch 台帳）で二重送信を防ぐ。
 */

export type EcDispatchSubscriber = 'notification' | 'v6';
