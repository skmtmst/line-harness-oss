/*
 * 機械の失敗文を、人の言葉へ置き換える（動きの点検 7 番・2026-10-07）。
 *
 * 画面が `caught.message` をそのまま知らせ・帯へ渡すと、「API error: 500」
 * 「Failed to fetch」「Internal error」のような文が運用者に出ていた。
 * 知らせ（toast）と帯（Notice）が表示の直前にここを通すので、画面ごとに
 * 書き忘れても機械の文は出ない。日本語の文（画面が書いた案内）はそのまま。
 *
 * 文の型は「何が起きた」＋「どうすればよい」。回答フォームの編集の文が見本。
 */

const NETWORK = /^(?:TypeError: )?(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed|network error)$/i
const SERVER = /^(?:Internal(?: Server)? Error|Bad Gateway|Service Unavailable|Gateway Timeout|Unexpected server error)\.?$/i
const TIMEOUT = /^(?:The operation was aborted\.?|AbortError|signal is aborted without reason|Request timed out|timeout)$/i

export function describeStatus(status: number): string {
  if (status === 401) return 'ログインの期限が切れました。もう一度ログインしてから、やり直してください。'
  if (status === 403) return 'この操作をする権限がありません。必要なときは統括に頼んでください。'
  if (status === 404) return '対象が見つかりませんでした。消されたかもしれません。一覧から開き直してください。'
  if (status === 409 || status === 412 || status === 428) return 'ほかの人が先に変更しました。最新を読み込んでから、もう一度お試しください。'
  if (status === 413) return 'ファイルや内容が大きすぎて受け付けられませんでした。小さくしてから、もう一度お試しください。'
  if (status === 400 || status === 422) return '入力の中に受け付けられない所がありました。内容を確かめて、直してからもう一度お試しください。'
  if (status === 429) return '混み合っています。少し待ってから、もう一度お試しください。'
  if (status >= 500) return 'サーバーで問題が起きて、処理できませんでした。時間をおいて、もう一度お試しください。'
  return '処理できませんでした。時間をおいて、もう一度お試しください。'
}

/** 機械の文なら人の文に置き換える。それ以外（画面が書いた日本語など）はそのまま返す。 */
export function humanizeErrorText(message: string): string {
  const text = message.trim()
  if (!text) return message
  const status = text.match(/^API error:?\s*(\d{3})\b/i)
  if (status) return describeStatus(Number(status[1]))
  if (/^HTTP\s*(\d{3})\b/i.test(text)) return describeStatus(Number(text.match(/(\d{3})/)?.[1]))
  if (NETWORK.test(text)) return '通信できませんでした。インターネットの接続を確かめて、もう一度お試しください。'
  if (TIMEOUT.test(text)) return '時間内に応答がありませんでした。少し待ってから、もう一度お試しください。'
  if (SERVER.test(text)) return describeStatus(500)
  return message
}
