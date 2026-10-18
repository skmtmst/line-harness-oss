import type { ReminderStopConditions, ReminderScheduleMetrics } from '@line-crm/shared'

/**
 * リマインダの実行結果（設計 `GC4St` 7-1-H、要件 §3-7）。
 *
 * **状態の名前は公開 API と同じにする。** DB内部の `queued` は Worker が
 * `planned` に変換するため、画面へ漏らさない。見せる言葉は画面側で当てる。
 */
export type ReminderDeliveryRunStatus =
  | 'planned'
  | 'claimed'
  | 'succeeded'
  | 'skipped'
  | 'retry_wait'
  | 'permanent_failed'
  | 'cancelled'

/**
 * 7機能で共有する実行台帳の状態。**機能ごとの状態名とは別。**
 * リマインダの `planned` `claimed` `retry_wait` は、共通では `pending` に寄せる。
 */
export type RunRecordStatus =
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'skipped'
  | 'pending'
  | 'cancelled'

/**
 * 実行台帳の共通9項目。**7機能で同じ形にする。**
 * 機能ごとの細かい値（`domainStatus` など）は各機能の型が足す。
 */
export type RunRecord = {
  occurredAt: string
  /** 誰に対しての実行か。リマインダなら友だち名。 */
  subject: string | null
  /** どのLINEアカウントから送ったか。 */
  accountLabel: string | null
  /** 何がきっかけか。リマインダならリマインダ名。 */
  triggerLabel: string | null
  /** 送った先の記録などへの参照。無ければ null。 */
  reference: string | null
  status: RunRecordStatus
  /** 1行で言う結果。失敗なら理由。 */
  detail: string | null
  /** かかった時間。始まりか終わりが無ければ null（0にしない）。 */
  durationMs: number | null
  /** 再試行できるか。**画面で条件を作らない**——Worker が決める。 */
  canRetry: boolean
}

export type ReminderDeliveryRun = RunRecord & {
  id: string
  friendId: string
  friendName: string | null
  stepNumber: number
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  domainStatus: ReminderDeliveryRunStatus
  attemptCount: number
  nextRetryAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  lineRequestId: string | null
  /** どの通か。通ごとに絞るときに使う。 */
  reminderStepId: string
  /** どのLINEアカウントから送ったか。複数アカウントを見る人には要る。 */
  accountLabel: string | null
}

export type ReminderDeliveryRunsResponse = {
  reminder: {
    id: string
    name: string
    isActive: boolean
    /** 公開版スナップショットのライフサイクル。 */
    lifecycleStatus: 'draft' | 'published' | 'stopped'
    /** 公開版の停止条件。公開版が無いときは null（未取得と区別する）。 */
    stopConditions: ReminderStopConditions | null
    /**
     * 公開版があるか（R146 監査）。無い下書きは「停止中」ではなく
     * 「下書き」と出し、再開はさせない。
     */
    hasPublishedVersion: boolean
  }
  summary: {
    sent: number
    scheduled: number
    stopped: number
    errors: number
    targetCount: number
    nextScheduledAt: string | null
    /** 日本時間の当月に送信済みの件数。 */
    sentThisMonth: number
    /** 今後7日以内（期限切れの未送分を含む）に送る予定の件数。 */
    scheduledNext7Days: number
  } & ReminderScheduleMetrics
  steps: Array<{
    id: string
    stepNumber: number
    offsetMinutes: number
    messageType: string
    messageContent: string
    sent: number
    /** LINEは友だち単位の開封を返さない。**0%を作らない。** */
    openRate: null
    errors: number
  }>
  items: ReminderDeliveryRun[]
  pagination: { total: number; limit: number; offset: number }
}

/** リマインダごとの登録者。画面はこの版番号で競合を検知する。 */
export type ReminderRegistrant = {
  id: string
  friendId: string
  friendName: string | null
  targetDate: string
  status: 'active' | 'cancelled' | string
  reminderVersionId: string | null
  sourceKind: string
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  lockVersion: number
}

export type ReminderRegistrantMutation = {
  id: string
  friendId: string
  targetDate: string
  status: string
  reminderVersionId: string | null
  lockVersion: number
  replayed: boolean
}
