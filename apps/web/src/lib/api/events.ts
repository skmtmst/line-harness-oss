import type {
  EventSlot,
  EventDetail,
  EventListResponse,
  EventListItem,
  EventSlotInput,
  EventWaitlistItem,
  EventOccurrenceApplicants,
  EventWaitlistPromotionResult,
  EventLifecycleStatus,
  EventLifecycleResult,
  EventSlotChange,
  EventChangePreview,
  EventChangeApplyResult,
  EventBookingItem,
  EventBookingSummary,
} from './types/events'
import { fetchApi } from './transport/request'
import { withAccount } from './booking'
import { downloadApiFile } from './transport/download'

/**
 * 枠の一括作成が途中のチャンクで失敗したときのエラー。
 * `completed` には作成が確認できた分(失敗したチャンクより前)が入るので、
 * 画面は残りだけを再送できる(#1000 DETAIL-11)。
 */
export class EventSlotsPartialError extends Error {
  readonly completed: EventSlot[];

  constructor(message: string, completed: EventSlot[], cause?: unknown) {
    super(message, { cause });
    this.name = 'EventSlotsPartialError';
    this.completed = completed;
  }
}

export const eventsApi = {
  duplicate: (accountId: string, id: string, expectedVersion: number) => fetchApi<{ id: string; lifecycle_status: 'draft' }>(
    withAccount(`/api/events/admin/events/${encodeURIComponent(id)}/duplicate`, accountId),
    { method: 'POST', body: JSON.stringify({ expectedVersion }) },
  ),
  applicationPreview: (accountId: string, body: Partial<EventDetail> & { slot: { starts_at: string; ends_at: string; capacity: number } }) =>
    fetchApi<import('@line-crm/shared').EventApplicationPreview>(withAccount('/api/events/admin/application-preview', accountId), { method: 'POST', body: JSON.stringify(body) }),
  listEvents: (
    accountId: string,
    options: { page?: number; limit?: number; q?: string; filter?: 'all' | 'open' | 'pending' | 'full'; sort?: 'soon' | 'name' } = {},
    request?: { signal?: AbortSignal },
  ) => {
    const params = new URLSearchParams();
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('limit', String(options.limit));
    if (options.q) params.set('q', options.q);
    if (options.filter) params.set('filter', options.filter);
    if (options.sort) params.set('sort', options.sort);
    const tail = params.size > 0 ? `?${params}` : '';
    return fetchApi<EventListResponse<EventListItem>>(
      withAccount(`/api/events/admin/events${tail}`, accountId),
      { signal: request?.signal },
    );
  },
  getEvent: (accountId: string, id: string) =>
    fetchApi<EventDetail>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
    ),
  createEvent: (accountId: string, body: Partial<EventDetail>) =>
    fetchApi<EventDetail>(
      withAccount('/api/events/admin/events', accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateEvent: (accountId: string, id: string, body: Partial<EventDetail>, expectedVersion: number) =>
    fetchApi<EventDetail>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
      { method: 'PUT', body: JSON.stringify({ ...body, expected_version: expectedVersion }) },
    ),
  deleteEvent: (accountId: string, id: string) =>
    fetchApi<void>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
      { method: 'DELETE' },
    ),

  listSlots: (accountId: string, eventId: string) =>
    fetchApi<{ items: EventSlot[] }>(
      withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
    ),
  /** 申込者画面の開催回選択だけに使う最小応答。集計や予約一覧は含めない。 */
  listOccurrenceSelector: (accountId: string, eventId: string) =>
    fetchApi<{ items: EventSlot[] }>(
      withAccount(`/api/events/admin/events/${eventId}/occurrence-selector`, accountId),
    ),
  createSlots: (
    accountId: string,
    eventId: string,
    slots: EventSlotInput[],
    options?: { operationId?: string },
  ) => (async () => {
    // 誤指定で何千件も作らないよう、総数に上限を置く(点検#520の中9)。
    // 1口400件の分割は裏側の上限に合わせたままにする。
    if (slots.length > 500) {
      throw new Error('500件を超える一括作成はできません。期間や曜日を分けて追加してください')
    }
    /*
      #1000 DETAIL-11: 400+1のような分割送信が途中で失敗・応答を失っても、
      再送で成功済み分を二重登録しないよう、各枠に操作ID由来の client_key を
      付ける。サーバーは同じイベント内の既存キーを再利用して返す。
      日時の一意制約は正当な同時開催を壊すので使わない。
    */
    const keyed = slots.map((slot, index) =>
      slot.client_key != null || !options?.operationId
        ? slot
        : { ...slot, client_key: `${options.operationId}:${index}` },
    )
    const items: EventSlot[] = []
    for (let offset = 0; offset < keyed.length; offset += 400) {
      const chunk = keyed.slice(offset, offset + 400)
      try {
        const response = await fetchApi<{ items: EventSlot[] }>(
          withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
          { method: 'POST', body: JSON.stringify({ slots: chunk }) },
        )
        items.push(...response.items)
      } catch (error) {
        const detail = error instanceof Error ? `（${error.message}）` : ''
        throw new EventSlotsPartialError(
          `${items.length}件まで追加されました。残りを確認してから、もう一度追加してください${detail}`,
          [...items],
          error,
        )
      }
    }
    return { items }
  })(),
  /**
   * m26g: 枠の更新は期待版が必須。古い画面からの更新は409になり、
   * 応答の data.current に最新の枠が入る。画面は読み直して差分を見せる。
   */
  updateSlot: (accountId: string, eventId: string, slotId: string, body: Partial<EventSlot>, expectedVersion: number) =>
    fetchApi<EventSlot>(
      withAccount(`/api/events/admin/events/${eventId}/slots/${slotId}`, accountId),
      { method: 'PUT', body: JSON.stringify({ ...body, expected_version: expectedVersion }) },
    ),
  deleteSlot: (accountId: string, eventId: string, slotId: string) =>
    fetchApi<void>(
      withAccount(`/api/events/admin/events/${eventId}/slots/${slotId}`, accountId),
      { method: 'DELETE' },
    ),

  /** キャンセル待ち。空きが出たら先頭へ自動で案内し、本人の承諾で確定する。手動の案内もできる。 */
  listWaitlist: (accountId: string, eventId: string) =>
    fetchApi<{ waitlist: EventWaitlistItem[] }>(
      withAccount(`/api/events/admin/events/${eventId}/waitlist`, accountId),
    ),
  getOccurrenceApplicants: (accountId: string, occurrenceId: string) =>
    fetchApi<{ success: true; data: EventOccurrenceApplicants }>(
      withAccount(`/api/events/admin/occurrences/${encodeURIComponent(occurrenceId)}/applicants`, accountId),
    ).then((response) => response.data),
  /*
   * 申込者CSV。以前は相対パスの `<a href>` 直開きで、Cookie が届かない
   * 認証経路や API と別オリジンの配置では取れなかった。認証付きの
   * 取得からファイル保存へ揃える（TECH-03）。
   */
  downloadOccurrenceApplicantsCsv: (accountId: string, occurrenceId: string, snapshotId: string) =>
    downloadApiFile(
      withAccount(`/api/events/admin/occurrences/${encodeURIComponent(occurrenceId)}/applicants.csv?snapshot_id=${encodeURIComponent(snapshotId)}`, accountId),
      'applicants.csv',
    ),
  previewOccurrenceBroadcast: (accountId: string, occurrenceId: string, data: { title: string; messageContent: string; snapshotId: string }, idempotencyKey: string) =>
    fetchApi<{ success: true; data: { broadcastId: string; recipientCount: number } }>(
      withAccount(`/api/events/admin/occurrences/${encodeURIComponent(occurrenceId)}/applicant-broadcasts/preview`, accountId),
      { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(data) },
    ).then((response) => response.data),
  promoteOccurrenceWaitlist: (accountId: string, occurrenceId: string, expectedVersion: number, reason: string) =>
    fetchApi<{ success: true; data: EventWaitlistPromotionResult }>(
      withAccount(`/api/events/admin/occurrences/${encodeURIComponent(occurrenceId)}/waitlist/promote`, accountId),
      { method: 'POST', body: JSON.stringify({ expectedVersion, reason }) },
    ).then((response) => response.data),
  /** U: 待ち順の手動変更。理由が必須。 */
  reorderOccurrenceWaitlist: (
    accountId: string,
    occurrenceId: string,
    body: { ordered_ids: string[]; expectedVersion?: number; reason: string },
  ) =>
    fetchApi<{ success: true; occurrence_version: number; order: string[]; log_id: string }>(
      withAccount(`/api/events/admin/occurrences/${encodeURIComponent(occurrenceId)}/waitlist/reorder`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** U: 飛ばし（最後尾へ回す）。理由が必須。行は消さない。 */
  skipOccurrenceWaitlist: (
    accountId: string,
    occurrenceId: string,
    body: { waitlist_id: string; expectedVersion?: number; reason: string },
  ) =>
    fetchApi<{ success: true; occurrence_version: number; waitlist_id: string; log_id: string }>(
      withAccount(`/api/events/admin/occurrences/${encodeURIComponent(occurrenceId)}/waitlist/skip`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** U: 状態の切替（下書き・公開中・一時停止・終了・中止）。 */
  setEventLifecycle: (
    accountId: string,
    eventId: string,
    body: { to: EventLifecycleStatus; reason?: string; idempotency_key?: string },
  ) =>
    fetchApi<EventLifecycleResult>(
      withAccount(`/api/events/admin/events/${eventId}/lifecycle`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** U: 変更の事前表示（読み取り専用）。 */
  previewEventChange: (
    accountId: string,
    eventId: string,
    body: { slot_changes: EventSlotChange[]; event_changes?: { venue_name?: string | null; venue_url?: string | null } },
  ) =>
    fetchApi<EventChangePreview>(
      withAccount(`/api/events/admin/events/${eventId}/change-review`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** U: 変更確認の適用。 */
  applyEventChange: (
    accountId: string,
    eventId: string,
    body: {
      expected_version: number;
      change_reason?: string;
      idempotency_key: string;
      slot_changes: EventSlotChange[];
      event_changes?: { venue_name?: string | null; venue_url?: string | null };
    },
  ) =>
    fetchApi<EventChangeApplyResult>(
      withAccount(`/api/events/admin/events/${eventId}/change-review/apply`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  listBookings: (
    accountId: string,
    eventId: string,
    filters: { status?: string; slot_id?: string; page?: number; limit?: number } = {},
    request?: { signal?: AbortSignal },
  ) => {
    const qs: string[] = [];
    if (filters.status) qs.push(`status=${encodeURIComponent(filters.status)}`);
    if (filters.slot_id) qs.push(`slot_id=${encodeURIComponent(filters.slot_id)}`);
    if (filters.page) qs.push(`page=${filters.page}`);
    if (filters.limit) qs.push(`limit=${filters.limit}`);
    const tail = qs.length > 0 ? `?${qs.join('&')}` : '';
    return fetchApi<EventListResponse<EventBookingItem>>(
      withAccount(`/api/events/admin/events/${eventId}/bookings${tail}`, accountId),
      { signal: request?.signal },
    );
  },
  getBookingSummary: (accountId: string, eventId: string, request?: { signal?: AbortSignal }) =>
    fetchApi<EventBookingSummary>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/summary`, accountId),
      { signal: request?.signal },
    ),
  decideBooking: (
    accountId: string,
    eventId: string,
    bookingId: string,
    action: 'confirm' | 'reject',
    reason?: string,
  ) =>
    fetchApi<EventBookingItem>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}/decide`, accountId),
      { method: 'POST', body: JSON.stringify({ action, reason }) },
    ),
  adminCancelBooking: (accountId: string, eventId: string, bookingId: string) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}/cancel`, accountId),
      { method: 'POST' },
    ),
  updateBooking: (
    accountId: string,
    eventId: string,
    bookingId: string,
    body: { internal_note?: string | null; status?: 'attended' | 'no_show' },
  ) =>
    fetchApi<EventBookingItem>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  pendingCount: (accountId: string) =>
    fetchApi<{ count: number }>(
      withAccount('/api/events/admin/events/notifications/pending', accountId),
    ),
};
