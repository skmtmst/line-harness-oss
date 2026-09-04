import type { Webinar, WebinarAnalytics } from '@/lib/api'

/**
 * ウェビナー編集の段（設計 4-8 / `PV1Vh` `d3rFGD` `Xjk8q` `Ho8z4` `D6yO7e`）。
 *
 * 設計は「基本設定 → 動画 → CTA・フォーム → 通知 → 確認」の5段で、
 * **いま何段目で、あと何が残っているか**を上に出す。実装は横並びのタブで、
 * 押した先が設定なのか結果なのかも、まだ足りない段があるのかも言えていなかった。
 */

export type StepKey = 'basic' | 'video' | 'cta' | 'notifications' | 'review'

/**
 * `mark` は撮影が押すための目印（`data-qa-open`）。
 *
 * **設計Nodeがある段だけ、そのNodeを目印にする。** 基本設定は編集画面ぶんの
 * 設計面が無く（`lvaY5` は作成画面 `/webinars/new` の面）、Nodeを流用すると
 * 別のルートの絵をこの画面から撮ってしまう。
 */
export const STEPS: ReadonlyArray<{
  key: StepKey
  no: number
  title: string
  mark: string
  node?: string
  /** 口がまだ無い段。**押せるのに何も起きない形で置かない。** */
  notConnected?: string
}> = [
  { key: 'basic', no: 1, title: '基本設定', mark: 'webinar-step-basic' },
  { key: 'video', no: 2, title: '動画', mark: 'PV1Vh', node: 'PV1Vh' },
  { key: 'cta', no: 3, title: 'CTA・フォーム', mark: 'd3rFGD', node: 'd3rFGD' },
  { key: 'notifications', no: 4, title: '通知', mark: 'Ho8z4', node: 'Ho8z4' },
  { key: 'review', no: 5, title: '確認', mark: 'D6yO7e', node: 'D6yO7e' },
]

export type StepState = 'done' | 'current' | 'todo'

/**
 * 段の印。**「済み」は入力があるときだけ。**
 *
 * 通り過ぎただけで済みにすると、空のまま公開へ進める。
 * 設計の緑のチェックは「その段の入力が入っている」という意味で使う。
 */
export function stepStateOf(key: StepKey, current: StepKey, webinar: Webinar | null): StepState {
  if (key === current) return 'current'
  if (!webinar) return 'todo'
  switch (key) {
    case 'basic':
      return webinar.title.trim() && webinar.slug.trim() ? 'done' : 'todo'
    case 'video':
      return webinar.videoPrefix && webinar.durationSeconds > 0 && webinar.schedule.length > 0
        ? 'done'
        : 'todo'
    case 'cta':
      return webinar.cta ? 'done' : 'todo'
    /*
      通知と確認は、この画面が持っている値だけでは「済み」と言えない。
      通知の設定は別の口にあり、確認は人が読んで決めること。
      **分からないものを済みにしない。**
    */
    default:
      return 'todo'
  }
}

export function nextStepOf(key: StepKey): StepKey | null {
  const index = STEPS.findIndex((step) => step.key === key)
  return index >= 0 && index < STEPS.length - 1 ? STEPS[index + 1].key : null
}

/** 次へ進む押し口の文言。設計は行き先の名前で書く（「CTA設定へ」「確認へ」）。 */
export function nextLabelOf(key: StepKey): string | null {
  const next = nextStepOf(key)
  if (!next) return null
  return `${STEPS.find((step) => step.key === next)?.title}へ`
}

export const NOT_AVAILABLE = '—'

export type SummaryRow = { label: string; value: string; note?: string }

/**
 * 右の設定サマリー。**取得元のない値を設計の数字で作らない。**
 *
 * 設計は「申込 184人」を出しているが、その数は1本ぶんの集計
 * （`WebinarAnalytics`）から来る。まだ読めていないときは `—`。
 * **0件と未取得を同じ見た目にしない。**
 */
export function summaryRows(
  webinar: Webinar,
  analytics: WebinarAnalytics | null,
): SummaryRow[] {
  return [
    {
      label: '動画',
      value: webinar.videoPrefix ? 'アップロード済み' : '未設定',
      note: webinar.videoPrefix ? undefined : '動画が無いままでは友だちが視聴できません',
    },
    {
      label: '公開',
      value: webinar.status === 'active' ? '公開中' : webinar.status === 'draft' ? '下書き' : 'アーカイブ',
    },
    {
      label: '配信枠',
      value: `${webinar.schedule.length}件`,
      note: webinar.schedule.length === 0 ? '枠が無いと「次の回」が出ません' : undefined,
    },
    {
      label: '申込',
      value: analytics ? `${analytics.summary.reservations}人` : NOT_AVAILABLE,
      note: analytics ? undefined : 'まだ読み込んでいません',
    },
  ]
}

/**
 * 公開してよいか。**設計の STEP 5 で人が読む内容と同じものを使う。**
 * ここで足りないものを言えないと、公開してから友だちの画面で気づくことになる。
 */
export function publishBlockers(webinar: Webinar): string[] {
  const blockers: string[] = []
  if (!webinar.title.trim()) blockers.push('タイトルが入っていません')
  if (!webinar.videoPrefix) blockers.push('動画が設定されていません')
  if (webinar.durationSeconds <= 0) blockers.push('動画の長さが入っていません')
  if (webinar.schedule.length === 0) blockers.push('配信枠が1件もありません')
  return blockers
}
