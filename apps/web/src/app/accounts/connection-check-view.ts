/**
 * 保存する前の接続確認（設計 ★V6 33-2 `b2NGxk`）。
 *
 * **どこかで止まったら保存しない。** 通らないまま保存すると、
 * 「登録できたのに届かない」という一番わかりにくい壊れ方になる。
 *
 * 5 段は**順番に意味がある**。前が通らないと後ろは確かめようがない
 * （URL が合っていないのに、届くかどうかは試せない）。
 */

export type CheckState = 'passed' | 'failed' | 'skipped'

export interface CheckStep {
  /** 設計の番号（1〜5）。 */
  order: number
  message: string
  state: CheckState
}

/** 段ごとの言葉。**「確かめていません」と「直してください」を混ぜない。** */
export const CHECK_STATE_LABEL: Record<CheckState, string> = {
  passed: '通りました',
  failed: '直してください',
  skipped: '確かめていません',
}

/** 接続確認の返事。`api.lineAccounts.verifyConnection` の形。 */
export interface VerifyResult { steps: CheckStep[] }

/**
 * 返事を設計の 5 段に並べ直す。
 *
 * **止まった段より後ろは `skipped`。** `failed` にすると、直す場所が
 * 4 つあるように見えてしまう。実際に直すのは止まった 1 つだけ。
 */
export function toSteps(result: VerifyResult | null): CheckStep[] {
  const messages = [
    'チャネルIDとシークレットでアクセストークンを発行',
    '公式アカウントの名前とアイコンを取得',
    'Webhook URLを登録して、実際に届くかテスト',
    'LINE Loginチャネルを確認して、LIFFアプリを作成',
    '認証済みアカウントかを判定',
  ]
  if (!result) {
    return messages.map((message, i) => ({ order: i + 1, message, state: 'skipped' as const }))
  }
  return result.steps.map((item) => ({ ...item }))
}

/** 止まった段。通っていれば null。 */
export function stoppedAt(steps: CheckStep[]): CheckStep | null {
  return steps.find((s) => s.state === 'failed') ?? null
}

/** 保存してよいか。5段すべて通ったときだけ保存する。 */
export function canSave(steps: CheckStep[]): boolean {
  return steps.every((s) => s.state === 'passed')
}

/**
 * 上限と警告の検査。
 * **警告は上限より大きくできない。** 大きいと、警告が一度も出ない。
 */
export function capacityError(capacity: string, warnAt: string): string | null {
  if (!capacity || !warnAt) return null
  const c = Number(capacity)
  const w = Number(warnAt)
  if (!Number.isFinite(c) || !Number.isFinite(w)) return null
  return w > c ? '上限より大きい数は入れられません。' : null
}
