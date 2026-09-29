import { ApiError, describeSaveFailure } from '@/lib/api'

/**
 * APIの失敗を原因どおりに言い分ける（R32・m23mで429を分離）。
 *
 * どの失敗も「通信を確かめて」に畳むと、権限不足の人が通信環境を
 * 調べたり同じ操作を繰り返したりする。ここでは5つに分ける。
 * - forbidden … 権限がない（403）。統括への依頼を案内する
 * - invalid … 入力の直しが要る（400/422）。欄の下の直し方と組み合わせる
 * - missing … 見つからない（404）。開き直しを案内する
 * - rateLimited … 混み合っている（429）。待ち秒数を添えて待つ案内にする
 * - retryable … 通信・サーバーの失敗（ネットワーク・5xx・その他）。もう一度を案内する
 *
 * 401・409・428 は `describeSaveFailure` の言い方をそのまま使う
 * （二重の正本を作らない）。
 */
export type ApiFailureKind = 'forbidden' | 'invalid' | 'missing' | 'rateLimited' | 'retryable'

export function classifyApiFailure(err: unknown): ApiFailureKind {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'forbidden'
    if (err.status === 400 || err.status === 422) return 'invalid'
    if (err.status === 404) return 'missing'
    if (err.status === 429) return 'rateLimited'
    return 'retryable'
  }
  return 'retryable'
}

/**
 * 429の待ち秒数。`Retry-After` 応答ヘッダ由来（`ApiError.retryAfterSeconds`）
 * を先に見て、無ければ運び屋（`data.retryAfterSeconds`）を見る。どちらも
 * 無い応答では `undefined`——画面は秒数なしの待ち案内にするだけ。
 */
export function retryAfterSecondsOf(err: unknown): number | undefined {
  if (!(err instanceof ApiError) || err.status !== 429) return undefined
  if (typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0) {
    return Math.ceil(err.retryAfterSeconds)
  }
  const data = err.data as { retryAfterSeconds?: unknown } | null | undefined
  if (data && typeof data.retryAfterSeconds === 'number' && data.retryAfterSeconds > 0) {
    return Math.ceil(data.retryAfterSeconds)
  }
  return undefined
}

/** 429の待ち案内。秒数があれば「○秒ほど待って」と添える。 */
export function describeRateLimited(seconds: number | undefined): string {
  return seconds !== undefined
    ? `混み合っています。${seconds}秒ほど待ってから、もう一度お試しください。`
    : '混み合っています。少し待ってから、もう一度お試しください。'
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
  if (kind === 'rateLimited') {
    return describeRateLimited(retryAfterSecondsOf(err))
  }
  if (err instanceof ApiError && [401, 409, 428].includes(err.status)) {
    return describeSaveFailure(err)
  }
  return `${action}に失敗しました。時間をおいて、もう一度お試しください。`
}

/**
 * 読み込み失敗の1枚（m23m）。
 *
 * 画面は捕まえた失敗をそのまま渡すだけで、403 と 429 を言い分けた
 * 見出し・案内・再試行の有無が返る。
 * - 403 … 押しても直らないので再試行は出さない（`retryable: false`）。
 *   見る権限の案内にする。
 * - 429 … 待ち秒数（`Retry-After` があれば使う）を添え、再試行は残す。
 * - それ以外 … 今までどおりの1枚。再試行は残す。
 */
export function loadFailureCopy(
  err: unknown,
  target: string,
): { title: string; description: string; retryable: boolean } {
  const kind = classifyApiFailure(err)
  if (kind === 'forbidden') {
    return {
      title: `${target}を見る権限がありません`,
      description: '見るには権限が要ります。オーナーか管理者に追加を依頼してください。',
      retryable: false,
    }
  }
  if (kind === 'rateLimited') {
    return {
      title: '混み合っています',
      description: retryAfterSecondsOf(err) !== undefined
        ? `${retryAfterSecondsOf(err)}秒ほど待ってから、もう一度読み込んでください。`
        : '少し待ってから、もう一度読み込んでください。',
      retryable: true,
    }
  }
  return {
    title: '表示できませんでした',
    description: '再読み込みしても直らない場合はエラー報告へ。',
    retryable: true,
  }
}
