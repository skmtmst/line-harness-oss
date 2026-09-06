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
