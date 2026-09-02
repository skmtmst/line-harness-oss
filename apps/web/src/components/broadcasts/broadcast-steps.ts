/**
 * 一斉配信の作成を、設計の5段（`LMiL2`）として読む。
 *
 * 設計 `zZ9fA` / `cPk8A` / `XQfMD` / `Bw0zt` はどれも上に
 * 「STEP 1 基本設定 → STEP 2 対象者 → STEP 3 メッセージ → STEP 4 送信設定 →
 * STEP 5 確認」の帯を持つ。実装は1枚の長い画面なので、**段ごとに画面を
 * 分けるのではなく、いまどこまで埋まっているかを段として読ませる**。
 *
 * 段の状態を作る場所をここ1つにしておく理由は、画面側で書くと
 * 「埋まっている」の判定が節の描画条件とずれるから。ずれると、
 * 帯は緑なのに保存で断られる、という一番困る形になる。
 */

export type BroadcastStepKey = 'basic' | 'audience' | 'message' | 'schedule' | 'confirm'

export type BroadcastStepState = 'done' | 'current' | 'todo'

export interface BroadcastStep {
  key: BroadcastStepKey
  /** 設計の「STEP 1」。1始まり。 */
  order: number
  label: string
  /** 押したときに飛ぶ節の id。 */
  anchor: string
  state: BroadcastStepState
}

/**
 * 各段が「埋まった」と言える条件。画面側の validate と同じものを渡す。
 *
 * `confirm`（STEP 5）だけは入力を持たない。前の4つが埋まって初めて
 * 現在地になる。
 */
export interface BroadcastStepInput {
  /** 配信名が入っていて、長すぎない。 */
  basicDone: boolean
  /** 送る相手の条件が決まっている（人数が0でも条件としては決まっている）。 */
  audienceDone: boolean
  /** 送る内容が1通ぶん埋まっている。 */
  messageDone: boolean
  /** 今すぐ送るか、日時が決まっている。 */
  scheduleDone: boolean
}

const DEFINITIONS: ReadonlyArray<{ key: BroadcastStepKey; label: string; anchor: string }> = [
  { key: 'basic', label: '基本設定', anchor: 'broadcast-step-basic' },
  { key: 'audience', label: '対象者', anchor: 'broadcast-step-audience' },
  { key: 'message', label: 'メッセージ', anchor: 'broadcast-step-message' },
  { key: 'schedule', label: '送信設定', anchor: 'broadcast-step-schedule' },
  { key: 'confirm', label: '確認', anchor: 'broadcast-step-confirm' },
]

/**
 * 段の状態を作る。
 *
 * **現在地は「まだ埋まっていない最初の段」1つだけ。** 後ろの段が先に
 * 埋まっていても done にはしない。設計の帯は左から順に進むものとして
 * 描かれていて、飛び石に緑が点くと、どこまで済んだのか読めなくなる。
 */
export function broadcastSteps(input: BroadcastStepInput): BroadcastStep[] {
  const filled = [input.basicDone, input.audienceDone, input.messageDone, input.scheduleDone]
  // 先頭から連続して埋まっている数。ここまでが done。
  let progressed = 0
  while (progressed < filled.length && filled[progressed]) progressed += 1

  return DEFINITIONS.map((definition, index) => ({
    ...definition,
    order: index + 1,
    state: index < progressed ? 'done' : index === progressed ? 'current' : 'todo',
  }))
}
