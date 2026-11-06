/*
 * ★V8 集まった回答で使う型と言葉。src/v8 は src/app を import しない決まりなので、
 * src/app/form-submissions/responses/response-summary.ts から必要なものだけ写した（中身は同じ）。
 */
export type DestinationWrite = {
  status: 'pending' | 'succeeded' | 'partial' | 'failed' | 'not_requested' | 'unknown'
  attempted: number | null
  succeeded: number | null
  failed: number | null
}

export type FormSubmissionSummary = {
  startedUnique: number
  submitted: number
  completionRate: number | null
  destinationWrites: {
    pending: number
    succeeded: number
    partial: number
    failed: number
    not_requested: number
    unknown: number
  }
  dateAnsweredUniqueFriends: number
  dateFields: Array<{
    key: string
    label: string
    answered: number
    uniqueFriends: number
    minDate: string | null
    maxDate: string | null
  }>
  /** F-11：5段階評価の平均（全回答から集計。無いフォームでは空）。 */
  ratingFields?: Array<{
    key: string
    label: string
    answered: number
    average: number | null
  }>
}

/** F-11：評価の平均を「4.3」の形にする。小数第2位を四捨五入。 */
/** F-11：評価の平均を「4.3」の形にする。小数第2位を四捨五入。 */
export function ratingAverageText(average: number | null): string {
  if (average == null) return '—'
  return (Math.round(average * 10) / 10).toFixed(1)
}

/*
 * N-168: 回答の後処理(タグ付け・シナリオ登録・確認メッセージ等)は予約の
 * 工程記録に沿って進む。未完=失敗か中断した工程で、運用者へ見せて
 * 失敗分だけを再実行する口につなぐ。
 */
export type SubmissionPostActions = {
  state: 'completed' | 'failed' | 'in_progress' | 'untracked'
  pending: string[]
}

/** 工程名を運用者向けの言葉にする。知らない名前はそのまま出す。 */
export function postActionStepLabel(step: string): string {
  if (step.startsWith('layout:')) {
    const inner = step.slice('layout:'.length)
    if (inner.startsWith('destinations:')) return '登録先への書き込み'
    if (inner.startsWith('choices:')) return '選択肢の処理'
    if (inner.startsWith('reminder:')) return 'リマインダの登録'
    if (inner.startsWith('afterAction:')) return '回答後アクション'
    return 'フォームの後処理'
  }
  switch (step) {
    case 'webhook': return '送信連携の確認'
    case 'fail_message': return '失敗の通知'
    case 'answer': return '回答の保存'
    case 'submit_count': return '回答数の更新'
    case 'mileage': return 'マイルの付与'
    case 'metadata': return '回答の保存'
    case 'layout_effects': return 'フォームの後処理'
    case 'legacy_fields': return '情報欄への書き込み'
    case 'tag': return 'タグ付け'
    case 'scenario': return 'シナリオへの登録'
    case 'meet_link': return 'Meetリンクの送信'
    case 'reply': return '確認メッセージの送信'
    case 'destination_status': return '書き込み結果の記録'
    default: return step
  }
}
