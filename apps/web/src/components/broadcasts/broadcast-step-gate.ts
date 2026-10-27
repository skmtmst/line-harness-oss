import type { BroadcastStepKey } from './broadcast-steps'

/**
 * 一斉配信の作成の、段ごとの確かめ。
 *
 * 帯の ✓・［次へ］・保存の検査は、どれもこの1つの結果を読む。別々に書くと
 * 「帯は ✓ なのに保存で断られる」「保存は通るのに次へ進めない理由が帯と違う」
 * 形になる。
 *
 * 不備には2つの重さがある。
 * - 保存も止める不備（`blocksSave`）：配信名・宛先・吹き出し・ボタン・予約日時の未入力。
 *   今の保存・自動保存・テスト送信の検査と同じ文・同じ順。
 * - 先へ進むのだけ止める不備：文字数の超え・過ぎた予約日時・送信枠の不足。
 *   書きかけを下書きに残せるよう、保存は止めない。
 */
export type BroadcastGateStep = Exclude<BroadcastStepKey, 'confirm'>

export interface BroadcastStepProblem {
  message: string
  blocksSave: boolean
}

export type BroadcastStepProblems = Readonly<Record<BroadcastGateStep, BroadcastStepProblem | null>>

export interface BroadcastStepCheckInput {
  title: string
  titleMax: number
  /** `audienceError` の結果。空文字なら宛先は決まっている。 */
  audienceProblem: string
  /** `bubblesError` の結果。 */
  bubbleProblem: string
  /** `messageButtonsError` の結果。 */
  buttonProblem: string
  /** 文字数の上限を超えているときの理由（`messageLengthNotice` の error）。 */
  lengthProblem: string | null
  sendMode: 'now' | 'scheduled' | 'optimal'
  scheduledDate: string
  scheduledTime: string
  /** 予約日時を UTC に直したもの。予約でなければ null。 */
  scheduledAt: string | null
  /** 今の時刻（ミリ秒）。 */
  now: number
  /** 配信前チェックで送信枠が足りないと分かったとき。分からない間は false。 */
  quotaInsufficient: boolean
  /** 段ごとの画面のとき。予約日時の未入力は段ごとの画面でだけ保存を止める（今の検査のまま）。 */
  stepped: boolean
}

export const BROADCAST_GATE_ORDER: ReadonlyArray<BroadcastGateStep> = ['basic', 'audience', 'message', 'schedule']

export const SCHEDULE_PAST_MESSAGE = '予約の日時が過ぎています。今より後の日時にしてください'
export const QUOTA_SHORT_MESSAGE = '今月の送信枠が足りません。配信する人数を減らしてください'
export const SEND_TIME_MISSING_MESSAGE = '送る時間を選んでください'

export function broadcastStepProblems(input: BroadcastStepCheckInput): BroadcastStepProblems {
  const title = input.title.trim()
  const basic: BroadcastStepProblem | null = !title
    ? { message: '配信名を入力してください', blocksSave: true }
    : title.length > input.titleMax
      ? { message: `配信名は${input.titleMax}文字までにしてください`, blocksSave: true }
      : null
  // 宛先が空のまま進めると、絞ったつもりで全員に届く。
  const audience: BroadcastStepProblem | null = input.audienceProblem
    ? { message: input.audienceProblem, blocksSave: true }
    : null
  const message: BroadcastStepProblem | null = input.bubbleProblem
    ? { message: input.bubbleProblem, blocksSave: true }
    : input.buttonProblem
      ? { message: input.buttonProblem, blocksSave: true }
      : input.lengthProblem
        ? { message: input.lengthProblem, blocksSave: false }
        : null
  return { basic, audience, message, schedule: scheduleProblem(input) }
}

function scheduleProblem(input: BroadcastStepCheckInput): BroadcastStepProblem | null {
  if (input.sendMode === 'optimal') return { message: SEND_TIME_MISSING_MESSAGE, blocksSave: false }
  if (input.sendMode === 'scheduled') {
    if (!input.scheduledDate || !input.scheduledTime) {
      return { message: '予約する日付と時刻を入力してください', blocksSave: input.stepped }
    }
    const at = input.scheduledAt ? Date.parse(input.scheduledAt) : Number.NaN
    if (!Number.isFinite(at) || at <= input.now) return { message: SCHEDULE_PAST_MESSAGE, blocksSave: false }
  }
  if (input.quotaInsufficient) return { message: QUOTA_SHORT_MESSAGE, blocksSave: false }
  return null
}

/** 保存の検査。保存も止める不備の最初の1つ（段の順）。無ければ空文字。 */
export function broadcastSaveProblem(problems: BroadcastStepProblems): string {
  return saveProblemEntry(problems)?.problem.message ?? ''
}

/** 保存の検査で落ちたのがどの段か。 */
export function broadcastSaveProblemStep(problems: BroadcastStepProblems): BroadcastGateStep | null {
  return saveProblemEntry(problems)?.step ?? null
}

function saveProblemEntry(problems: BroadcastStepProblems) {
  for (const step of BROADCAST_GATE_ORDER) {
    const problem = problems[step]
    if (problem?.blocksSave) return { step, problem }
  }
  return null
}

/** その段の確かめが通っているか（帯の ✓）。 */
export function broadcastStepPassed(problems: BroadcastStepProblems, step: BroadcastGateStep): boolean {
  return problems[step] === null
}

/**
 * その段から［次へ］を押せない理由。押せるときは null。
 * 最終確認の段は［次へ］を持たない（送る前の確かめは最終確認の段の決まりのまま）。
 */
export function broadcastNextBlockReason(problems: BroadcastStepProblems, step: BroadcastStepKey): string | null {
  if (step === 'confirm') return null
  return problems[step]?.message ?? null
}
