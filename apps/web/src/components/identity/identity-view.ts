import type {
  IdentityCandidateDecision,
  IdentityCandidateImpactMetric,
  IdentityCandidateStatus,
  IdentityConfidenceLabel,
  IdentityEvidenceStrength,
  IdentityReprocessMode,
} from '@line-crm/shared'

/**
 * 本人照合の候補（設計 `InCDe` 3-2-A ／ `ELayY` 23-1-A）が読む言い換え。
 *
 * 2画面が同じ判断を別々に書くと、片方だけ直った状態に必ずなる。
 * 「未取得」と「実値0」の言い分け、失敗時に候補の中身を伏せる判断、
 * 版が競合したときの読み直しは、どれも画面ごとに揺れてはいけない。
 * だから React を通さない形でここに集め、テストから直接呼ぶ。
 */

/** 取得元が無い値。実値の 0 とは別。 */
export const NOT_AVAILABLE = '—（未取得）'

/**
 * 影響の1項目を読める形にする。
 *
 * `value === null` は「取得元がまだ繋がっていない」。0 は「数えた結果が0」。
 * この2つを同じ「0」にすると、結び付けても何も起きないように見える。
 */
export function impactText(metric: IdentityCandidateImpactMetric): string {
  if (metric.value === null) return NOT_AVAILABLE
  return `${metric.value.toLocaleString('ja-JP')}${metric.unit}`
}

/** マスク済みの補足。無ければ「—（未取得）」。平文の値はここへ来ない。 */
export function maskedText(valuePreview: string | null): string {
  return valuePreview ?? NOT_AVAILABLE
}

const CONFIDENCE: Record<IdentityConfidenceLabel, string> = {
  very_high: 'とても高い',
  high: '高い',
  medium: 'ふつう',
  low: '低い',
}

/** 設計 `ELayY` の「確からしさ」列と `InCDe` の「確信度」札。 */
export function confidenceText(label: IdentityConfidenceLabel): string {
  return CONFIDENCE[label]
}

const STRENGTH: Record<IdentityEvidenceStrength, string> = {
  strong: '決め手になる',
  medium: '手がかり',
  weak: '参考',
}

/**
 * 根拠の強さ。
 *
 * 設計 `InCDe` は「プロフィール画像だけの一致は、確定根拠に使いません」と
 * 注意している。強さを出さないと、参考どまりの根拠が決め手に見える。
 */
export function strengthText(strength: IdentityEvidenceStrength): string {
  return STRENGTH[strength]
}

const STATUS: Record<IdentityCandidateStatus, string> = {
  pending: '未判定',
  linked: '同じ人',
  different: '別人',
  deferred: '保留',
  invalidated: '取り下げ',
}

export function statusText(status: IdentityCandidateStatus): string {
  return STATUS[status]
}

const DECISION: Record<IdentityCandidateDecision, string> = {
  linked: '同じ人として結び付ける',
  different: '別人として記録する',
  deferred: '保留にする',
}

export function decisionText(decision: IdentityCandidateDecision): string {
  return DECISION[decision]
}

/**
 * 判定を選んだときに、その場で何が起きるかを言う。
 *
 * `different` は「今回は結び付けない」ではない。**根拠が変わるまで候補へ
 * 戻さない**ので、放っておくと二度と出てこない。ここを書かないと
 * 「あとで見直せる」と思って押される。
 */
const DECISION_NOTE: Record<IdentityCandidateDecision, string> = {
  linked: '2件を同じ人として結び付けます。元の友だち・注文は消えません。',
  different: '別人として記録し、根拠が変わるまで候補へ戻しません。',
  deferred: '判断を保留にします。候補は一覧に残ります。',
}

export function decisionNote(decision: IdentityCandidateDecision): string {
  return DECISION_NOTE[decision]
}

const REPROCESS: Record<IdentityReprocessMode, string> = {
  future_only: '今後の注文だけ結び付ける（過去のLINE送信は再送しません）',
  analytics_snapshot: '分析の集計だけ過去にさかのぼる（LINE送信はしません）',
  non_delivery_actions: '配信以外の処理だけ過去にさかのぼる',
}

/** ECの照合だけで選ぶ。既定は `future_only`（過去へ副作用を出さない）。 */
export function reprocessText(mode: IdentityReprocessMode): string {
  return REPROCESS[mode]
}

export const REPROCESS_MODES: IdentityReprocessMode[] = [
  'future_only',
  'analytics_snapshot',
  'non_delivery_actions',
]

/** 判定窓と一覧の両方に出す、取り消しの効き方。 */
export const UNDO_NOTE = '判定を取り消しても、元の友だち・注文と判断の履歴は残ります。'

export type IdentityFailure = {
  /** 一覧・詳細をまるごと差し替える（候補の中身は出さない）。 */
  kind: 'forbidden' | 'error' | 'stale'
  title: string
  description: string
}

type FailureInput = { status?: number; code?: string | null } | null | undefined

/**
 * 失敗を、画面に出してよい形へ落とす。
 *
 * **候補の名前・マスク値・内部IDはここを通らない。** 権限が無い人や
 * 読み込みに失敗した人へ、伏せるべき中身が断片的に見えるのを防ぐ。
 * Worker の `code` はそのまま出さず、対応が分かれるものだけ言い分ける。
 */
export function failureOf(input: FailureInput): IdentityFailure {
  if (input?.status === 403) {
    return {
      kind: 'forbidden',
      title: 'この候補を見る権限がありません',
      description: '見るには権限が要ります。オーナーか管理者に追加を依頼してください。',
    }
  }
  /*
   * **`code` では見分けられない。** `extractApiErrorCode` は本文の `error` が
   * 英小文字のsnake_caseのときだけコードとして拾う。Workerは `error` に
   * 日本語の文、`code` に `STALE_CANDIDATE` などを入れるので、画面へ届く
   * `ApiError.code` は常に `undefined` になる。コードで見分ける書き方だと、
   * ここが黙って「表示できませんでした」に落ちる。
   *
   * この読み口の409は種類がいくつかある（先を越された／すでに判定済み／
   * 別の結び付けが先にある）が、**運用する人がすることは同じ**——
   * 最新を読み直して見直す。だから状態番号だけで1つに寄せる。
   */
  if (input?.status === 409) {
    return {
      kind: 'stale',
      title: '先に別の判定が入っています',
      description: '最新の状態を読み直してから、もう一度判断してください。',
    }
  }
  return {
    kind: 'error',
    title: '本人照合の候補を表示できませんでした',
    description: '時間をおいて読み直してください。直らない場合はエラー報告へ。',
  }
}

/**
 * 判定を送ってよいか。
 *
 * 理由は必ず要る（Worker も `reason` を必須にしている）。空のまま押せると、
 * あとから履歴を見ても誰が何を見て決めたのか分からない。
 */
export function canSubmitDecision(input: {
  canDecide: boolean
  reason: string
  busy: boolean
}): boolean {
  return input.canDecide && !input.busy && input.reason.trim().length > 0
}
