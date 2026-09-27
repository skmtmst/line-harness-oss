import { ApiError, describeSaveFailure } from '@/lib/api'

/**
 * APIの失敗を原因どおりに言い分ける（R32）。
 *
 * どの失敗も「通信を確かめて」に畳むと、権限不足の人が通信環境を
 * 調べたり同じ操作を繰り返したりする。ここでは4つに分ける。
 * - forbidden … 権限がない（403）。統括への依頼を案内する
 * - invalid … 入力の直しが要る（400/422）。欄の下の直し方と組み合わせる
 * - missing … 見つからない（404）。開き直しを案内する
 * - retryable … 通信・サーバーの失敗（ネットワーク・5xx・その他）。もう一度を案内する
 *
 * 401・409・428・429 は `describeSaveFailure` の言い方をそのまま使う
 * （二重の正本を作らない）。
 */
export type ApiFailureKind = 'forbidden' | 'invalid' | 'missing' | 'retryable'

export function classifyApiFailure(err: unknown): ApiFailureKind {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'forbidden'
    if (err.status === 400 || err.status === 422) return 'invalid'
    if (err.status === 404) return 'missing'
    return 'retryable'
  }
  return 'retryable'
}

/** 日本語の本文だけを運用者に見せる。英語の検証文は欄の直し方へ回す。 */
export function japaneseDetailOf(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^API error: /.test(err.message)
    && /[ぁ-んァ-ヶ一-龠]/u.test(err.message)) {
    return err.message
  }
  return ''
}

export function describeApiFailure(
  err: unknown,
  action: string,
  options?: { forbidden?: string },
): string {
  const kind = classifyApiFailure(err)
  if (kind === 'forbidden') {
    return options?.forbidden ?? 'この操作は統括だけができます。必要なときは統括に頼んでください。'
  }
  if (kind === 'invalid') {
    const detail = japaneseDetailOf(err)
    return detail ? `入力を直してください。${detail}` : '入力を直してください。'
  }
  if (kind === 'missing') {
    return '対象が見つかりませんでした。一覧から開き直してください。'
  }
  if (err instanceof ApiError && [401, 409, 428, 429].includes(err.status)) {
    return describeSaveFailure(err)
  }
  return `${action}に失敗しました。時間をおいて、もう一度お試しください。`
}
