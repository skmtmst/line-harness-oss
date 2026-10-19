/**
 * 二段階認証の失敗の扱い（R506・R508）。
 *
 * page.tsx は default 以外を export できないので、試験で使う関数は
 * このファイルに置き、画面と試験の両方から import する。
 */

/*
 * R506: 通信断の技術文言や予期しない応答本文をそのまま出さない。
 *
 * fetch の通信断は TypeError（'Failed to fetch' など）で届く。
 * 応答が JSON ではない（障害時の HTML など）と SyntaxError になる。
 * どちらも利用者には日本語の理由と再試行の案内にする。
 * サーバーが返した日本語の理由（誤コード・期限切れ・回数制限など）は
 * そのまま出す。
 */
export function twoFactorFailureMessage(caught: unknown, fallback = '認証できませんでした'): string {
  if (isNetworkFailure(caught)) return '通信が切れています。接続を確かめて、もう一度お試しください。'
  if (caught instanceof Error && caught.message) {
    if (caught instanceof SyntaxError) return fallback
    return caught.message
  }
  return fallback
}

function isNetworkFailure(caught: unknown): boolean {
  if (caught instanceof TypeError) return true
  const message = caught instanceof Error ? caught.message : ''
  return /Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)
}

/*
 * R508: 合言葉が使えなくなった確認応答（期限切れ401・回数制限429）。
 *
 * サーバーはこのとき合言葉を消しているので、再試行は通らない。
 * 入力欄を終わらせてログインへ戻す。誤コード400などは入力を直せるままにする。
 */
export function isTwoFactorChallengeGone(status: number): boolean {
  return status === 401 || status === 429
}
