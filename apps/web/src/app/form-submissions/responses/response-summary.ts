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
}

export function completedDestinationWrites(summary: FormSubmissionSummary | null): number | null {
  if (!summary) return null
  return summary.destinationWrites.succeeded + summary.destinationWrites.partial
}

export function nextVisitPeople(summary: FormSubmissionSummary | null): number | null {
  if (!summary) return null
  return summary.dateFields.find((field) => field.key === 'next_visit')?.uniqueFriends
    ?? summary.dateAnsweredUniqueFriends
}

export function destinationWriteText(result: DestinationWrite | undefined): string {
  if (!result) return '—（書き込み結果を取得できませんでした）'
  const counts = result.attempted == null
    ? ''
    : `（${result.succeeded ?? 0}/${result.attempted}件を書き込み）`
  switch (result.status) {
    case 'succeeded': return `書き込み済み${counts}`
    case 'partial': return `一部を書き込み${counts}`
    case 'failed': return `書き込めませんでした${counts}`
    case 'pending': return '書き込み中'
    case 'not_requested': return '書き込み先なし'
    default: return '—（古い回答のため結果がありません）'
  }
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

export function postActionsText(postActions: SubmissionPostActions | null | undefined): string {
  if (!postActions || postActions.state === 'untracked') {
    return '—（この回答には後処理の記録がありません）'
  }
  if (postActions.pending.length > 0) {
    const names = postActions.pending.map(postActionStepLabel).join('、')
    return postActions.state === 'in_progress' ? `処理中です（未完: ${names}）` : `未完: ${names}`
  }
  return postActions.state === 'completed' ? 'すべて完了' : '中断しています'
}

/** 再実行の口を出すか。未完の工程があるときだけ出す。 */
export function postActionsNeedRetry(
  postActions: SubmissionPostActions | null | undefined,
): boolean {
  return Boolean(
    postActions
    && postActions.state !== 'completed'
    && postActions.state !== 'untracked'
    && postActions.pending.length > 0,
  )
}
