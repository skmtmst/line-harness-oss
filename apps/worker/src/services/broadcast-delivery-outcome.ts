/**
 * 送信が失敗したとき、それが「確かに届いていない」のか
 * 「届いたかどうか分からない」のかを分ける（#662 / N-059）。
 *
 * ここを分けないと、失敗したものが全部「送達不明」になる。この現場の既定は
 * at-most-once——外へ出たかもしれない分は再送しない——なので、全部を
 * 送達不明に倒すと**再送できる相手がいなくなり、機能そのものが空になる**。
 * 逆に全部を「失敗」に倒すと、届いた相手へ2通目が出る。
 *
 * 分け方は LINE から返った HTTP の状態番号を見る。
 *
 *   4xx（429 を含む）… 要求は LINE に届き、**LINE が受け取らなかった**。
 *                       誰にも配られていないので送り直してよい
 *   5xx            … LINE の中で落ちた。受け取った後かもしれない → 送達不明
 *   状態番号なし     … 網の途中で切れた／応答が返らなかった → 送達不明
 *
 * 状態番号は line-sdk の request() が `Object.assign(error, { status })` で
 * 付けている。付いていないものを「4xx だろう」と推測しない。
 */
export type BroadcastDeliveryOutcome = 'failed' | 'unknown';

export function classifyDeliveryFailure(error: unknown): BroadcastDeliveryOutcome {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'unknown';
  if (status >= 400 && status < 500) return 'failed';
  return 'unknown';
}

/** 台帳に残す理由。状態番号が読めれば残す（何が起きたか運用者が追えるように）。 */
export function deliveryErrorCode(error: unknown): string {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number' && Number.isFinite(status)) return `line_http_${status}`;
  return 'line_no_response';
}
