import type {
  ReminderDraftSettings,
  ApiResponse,
  ReminderDraftVersion,
  ReminderValidationResult,
  ReminderPreviewResult,
  ReminderTestRecipientStatus,
  ReminderPublishResult,
  ReminderRunReadOptions,
  Reminder,
  ReminderStep,
  ReminderTriggerType,
} from '@line-crm/shared'
import { fetchApi } from '../transport/request'
import type {
  ReminderDeliveryRunStatus,
  ReminderDeliveryRunsResponse,
  ReminderRegistrant,
  ReminderRegistrantMutation,
} from '../types/reminders'

export const remindersMethods = {
  reminders: {
    /*
      公開までの段（下書き→検査→予定の下見→試験送信→公開）。
      **口はすべて `apps/worker/src/routes/reminders.ts` に在るものを読むだけ。**
      試験送信は `Idempotency-Key` を付ける——二度押しで2通届くと、
      受け取った人には本番と見分けが付かない。
    */
    createDraft: (settings: ReminderDraftSettings) =>
      fetchApi<ApiResponse<ReminderDraftVersion>>('/api/reminders/drafts', {
        method: 'POST',
        body: JSON.stringify(settings),
      }),
    getDraft: (id: string) =>
      fetchApi<ApiResponse<ReminderDraftVersion>>(`/api/reminders/${id}/draft`),
    /**
     * `expectedVersionId` を渡すと楽観ロックになる——画面を開いたときの
     * 版とずれていれば409。別タブでの先勝ち保存を古い内容で上書きしない。
     * R148 監査：通常保存は版IDを付け替えないため、保存のたびに変わる
     * `expectedUpdatedAt`（開いたときの版時刻）も合わせて送る。
     */
    saveDraft: (id: string, settings: ReminderDraftSettings, options: { expectedVersionId?: string; expectedUpdatedAt?: string } = {}) =>
      fetchApi<ApiResponse<ReminderDraftVersion>>(`/api/reminders/${id}/draft`, {
        method: 'PUT',
        body: JSON.stringify(options.expectedVersionId
          ? { ...settings, expectedVersionId: options.expectedVersionId, ...(options.expectedUpdatedAt ? { expectedUpdatedAt: options.expectedUpdatedAt } : {}) }
          : settings),
      }),
    validateDraft: (id: string) =>
      fetchApi<ApiResponse<ReminderValidationResult>>(`/api/reminders/${id}/validate`, {
        method: 'POST',
      }),
    /**
     * 未保存の条件で人数を数え直す (R15)。条件を送らなければ保存済みの
     * まま数える。顔ぶれ (先頭20人) も同じ条件で切って返す。
     */
    audience: (id: string, condition?: unknown) =>
      fetchApi<ApiResponse<{ matched: number; excluded: number; sample: Array<{ id: string; displayName: string }> }>>(`/api/reminders/${id}/audience`, {
        method: 'POST',
        body: JSON.stringify(condition === undefined ? {} : { condition }),
      }),
    previewDraft: (id: string, targetDate?: string) =>
      fetchApi<ApiResponse<ReminderPreviewResult>>(`/api/reminders/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify(targetDate ? { targetDate } : {}),
      }),
    /** 送信前に出すテスト送信先の状態。実送信と同じ判定をWorker側で使う。 */
    getTestRecipient: (id: string) =>
      fetchApi<ApiResponse<ReminderTestRecipientStatus>>(
        `/api/reminders/${id}/test-recipient`,
      ),
    testDraft: (id: string, idempotencyKey: string) =>
      fetchApi<ApiResponse<{
        sent: number
        recipientName: string
        /** REMINDER-12: 本人宛て(self)か登録済みテスト宛先(registered)か。 */
        recipientKind: 'self' | 'registered' | null
        replayed: boolean
        requestId: string | null
        testedAt: string
      }> & { code?: string }>(
        `/api/reminders/${id}/test-send`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    publishDraft: (id: string) =>
      fetchApi<ApiResponse<ReminderPublishResult>>(`/api/reminders/${id}/publish`, {
        method: 'POST',
      }),
    /** 実行結果（設計 `GC4St`）。状態・検索・ページ送りは Worker が受ける。 */
    runs: (
      reminderId: string,
      params?: { status?: ReminderDeliveryRunStatus; search?: string; limit?: number; offset?: number } & ReminderRunReadOptions,
    ) => {
      const query = new URLSearchParams()
      if (params?.order) query.set('order', params.order)
      if (params?.executedOnly !== undefined) query.set('executedOnly', String(params.executedOnly))
      if (params?.status) query.set('status', params.status)
      if (params?.search) query.set('search', params.search)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      if (params?.offset !== undefined) query.set('offset', String(params.offset))
      const suffix = query.toString() ? `?${query}` : ''
      return fetchApi<ApiResponse<ReminderDeliveryRunsResponse>>(`/api/reminders/${reminderId}/runs${suffix}`)
    },
    /**
     * 1件を手で再試行する。**冪等キーが要る。**
     * 二度押しで二重に送らないよう、同じ実行には同じ鍵を使う。
     */
    retryRun: (runId: string, idempotencyKey: string) =>
      fetchApi<ApiResponse<{ id: string; status: ReminderDeliveryRunStatus; replayed: boolean }>>(
        `/api/reminder-runs/${runId}/retry`,
        { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } },
      ),
    /** 161: 渡した順に並べ替える。見えているものだけ送る。 */
    reorder: (ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/reminders/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      }),
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Reminder[]>>('/api/reminders' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Reminder & { steps: ReminderStep[] }>>(`/api/reminders/${id}`),
    registrants: {
      list: (reminderId: string) =>
        fetchApi<ApiResponse<ReminderRegistrant[]>>(`/api/reminders/${encodeURIComponent(reminderId)}/registrants`),
      updateTargetDate: (reminderId: string, enrollmentId: string, targetDate: string, expectedLockVersion: number) =>
        fetchApi<ApiResponse<ReminderRegistrantMutation>>(
          `/api/reminders/${encodeURIComponent(reminderId)}/registrants/${encodeURIComponent(enrollmentId)}`,
          { method: 'PATCH', body: JSON.stringify({ targetDate, expectedLockVersion }) },
        ),
      cancel: (reminderId: string, enrollmentId: string, expectedLockVersion: number) =>
        fetchApi<ApiResponse<ReminderRegistrantMutation>>(
          `/api/reminders/${encodeURIComponent(reminderId)}/registrants/${encodeURIComponent(enrollmentId)}/cancel`,
          { method: 'POST', body: JSON.stringify({ expectedLockVersion }) },
        ),
      resume: (reminderId: string, enrollmentId: string, expectedLockVersion: number) =>
        fetchApi<ApiResponse<ReminderRegistrantMutation>>(
          `/api/reminders/${encodeURIComponent(reminderId)}/registrants/${encodeURIComponent(enrollmentId)}/resume`,
          { method: 'POST', body: JSON.stringify({ expectedLockVersion }) },
        ),
    },
    /** この友だちをこのリマインダに登録する（1人ぶん）。 */
    /**
     * 友だちをリマインダに登録する。
     *
     * targetDate はゴール日時（予約日・開催日）。**これが無いと登録できない。**
     * 以前は本文を送っておらず、worker 側が「targetDate is required」の手前で
     * 落ちて 500 を返していた。画面から一度も登録できていなかった。
     */
    enroll: (reminderId: string, friendId: string, targetDate: string) =>
      fetchApi<ApiResponse<unknown>>(
        `/api/reminders/${reminderId}/enroll/${friendId}`,
        { method: 'POST', body: JSON.stringify({ targetDate }) },
      ),
    create: (data: {
      name: string
      description?: string | null
      /** 新しいリマインダを動かすLINEアカウント。 */
      lineAccountId: string
      triggerType?: ReminderTriggerType
      triggerOffsetMinutes?: number | null
      sendAtTime?: string | null
      targetTagId?: string | null
      /** 156: フォルダ。null は未分類。 */
      folderId?: string | null
      /** 153: 'time'（○日前の●時）か 'countdown'（残り時間）。**作成後は変えられない。** */
      deliveryMode?: 'time' | 'countdown'
      /** 154: 友だち情報欄の日付を起点にするとき、見る欄。 */
      triggerFieldId?: string | null
      /** 154: 毎年くり返すか（誕生日なら true）。 */
      repeatYearly?: boolean
    }) =>
      fetchApi<ApiResponse<Reminder>>('/api/reminders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<
        Pick<
          Reminder,
          | 'name'
          | 'description'
          | 'isActive'
          | 'triggerType'
          | 'triggerOffsetMinutes'
          | 'sendAtTime'
          | 'targetTagId'
        >
      > & {
        /** 156: フォルダ。null は未分類へ戻す。 */
        folderId?: string | null
      },
    ) =>
      fetchApi<ApiResponse<Reminder>>(`/api/reminders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${id}`, { method: 'DELETE' }),
    /*
     * 削除定義の復元（登録・配信予定は戻さない）。
     * 画面の Toast から呼ぶ想定（各機能の担当が配線する）。
     */
    restore: (id: string) =>
      fetchApi<ApiResponse<Reminder>>(`/api/reminders/${id}/restore`, {
        method: 'POST',
      }),
    addStep: (
      id: string,
      data: {
        offsetMinutes: number
        messageType: string
        messageContent: string
        /** 153: ゴールから何日ずらすか。配信方式が 'time' のとき使う。 */
        offsetDays?: number | null
        /** 153: その日の何時に送るか（日本時間の "HH:MM"）。 */
        sendAtTime?: string | null
        /** 153: 送る中身をテンプレートから選ぶ。 */
        templateId?: string | null
      },
    ) =>
      fetchApi<ApiResponse<ReminderStep>>(`/api/reminders/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteStep: (reminderId: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${reminderId}/steps/${stepId}`, {
        method: 'DELETE',
      }),
  },
}
