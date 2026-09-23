/*
 * 一覧取得などの画面要求が「応答なし」のまま固まらないための上限（#625）。
 *
 * 検索語が長すぎてサーバーが落ちたり、経路のどこかで要求が沈黙したりすると、
 * 画面は「読み込んでいます」を出したまま戻らなかった。失敗にも空結果にも
 * ならない無限待機を残さないため、この秒数を超えた要求は失敗として
 * 再試行の導線を出す。
 */
export const LIST_REQUEST_TIMEOUT_MS = 30_000

/**
 * 応答しない Promise を時間切れの失敗にする。
 *
 * 元の Promise は止めない（通信そのものを切りたいときは、呼び出し側が
 * fetch へ signal を渡す）。時間切れのあとに元の Promise が成功・失敗しても、
 * この Promise は失敗のまま変わらない。
 */
export function withRequestTimeout<T>(
  promise: Promise<T>,
  ms: number = LIST_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('リクエストが時間切れになりました')), ms)
  })
  /*
   * race に渡した Promise には race 自身が常に結果を購読しているので、
   * 負けた側（時間切れ）の reject が未処理エラーになることはない。
   * 先に決着した時点でタイマーは止める。
   */
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
