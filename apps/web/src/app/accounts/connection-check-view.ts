/**
 * 保存する前の接続確認（設計 ★V6 33-2 `b2NGxk`）。
 *
 * **どこかで止まったら保存しない。** 通らないまま保存すると、
 * 「登録できたのに届かない」という一番わかりにくい壊れ方になる。
 *
 * 4 段は**順番に意味がある**。前が通らないと後ろは確かめようがない
 * （URL が合っていないのに、届くかどうかは試せない）。
 */

export type CheckState = 'passed' | 'failed' | 'skipped'

export interface CheckStep {
  /** 設計の番号（1〜4）。 */
  order: number
  label: string
  state: CheckState
}

/** 段ごとの言葉。**「確かめていません」と「直してください」を混ぜない。** */
export const CHECK_STATE_LABEL: Record<CheckState, string> = {
  passed: '通りました',
  failed: '直してください',
  skipped: '確かめていません',
}

/** 接続確認の返事。`api.lineAccounts.verifyConnection` の形。 */
export interface VerifyResult {
  messagingApi: boolean
  webhook: boolean
  lineLogin: boolean
  liff: boolean
  webhookUrl: string | null
  errors: string[]
}

/**
 * 返事を設計の 4 段に並べ直す。
 *
 * **止まった段より後ろは `skipped`。** `failed` にすると、直す場所が
 * 4 つあるように見えてしまう。実際に直すのは止まった 1 つだけ。
 */
export function toSteps(result: VerifyResult | null): CheckStep[] {
  const labels = [
    'LoginチャネルID・シークレット・LIFF IDの形',
    'アクセストークンが使えるか',
    'LINE側に登録したWebhookのURLと、利用する設定',
    'Webhookに実際に届くかのテスト',
  ]
  if (!result) {
    return labels.map((label, i) => ({ order: i + 1, label, state: 'skipped' as const }))
  }
  const passes = [
    result.lineLogin && result.liff,
    result.messagingApi,
    result.webhook,
    // 4 段目は 3 段目が通って初めて意味を持つ。口はまだ返さないので
    // 通ったとは書かない。
    false,
  ]
  const steps: CheckStep[] = []
  let stopped = false
  labels.forEach((label, i) => {
    if (stopped) {
      steps.push({ order: i + 1, label, state: 'skipped' })
      return
    }
    if (passes[i]) {
      steps.push({ order: i + 1, label, state: 'passed' })
      return
    }
    // 4 段目は「まだ確かめる口が無い」ので、止まったとは言わない。
    if (i === 3) {
      steps.push({ order: i + 1, label, state: 'skipped' })
      return
    }
    steps.push({ order: i + 1, label, state: 'failed' })
    stopped = true
  })
  return steps
}

/** 止まった段。通っていれば null。 */
export function stoppedAt(steps: CheckStep[]): CheckStep | null {
  return steps.find((s) => s.state === 'failed') ?? null
}

/** 保存してよいか。**4 段目は口が無いので、3 段目まで通れば保存できる。** */
export function canSave(steps: CheckStep[]): boolean {
  return steps.slice(0, 3).every((s) => s.state === 'passed')
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
