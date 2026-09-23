'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  api,
  ApiError,
  bookingApi,
  type BookingAdminDetail,
  type BookingAvailabilitySlot,
  type BookingAuditLog,
  type BookingMenu,
  type BookingMenuStaff,
  type BookingNotificationPolicy,
  type BookingOperationResult,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { canOperateBookings } from '../../lib/booking-permissions'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import SelectField from '@/components/shared/select-field'
import { usePageTitle } from '@/components/shell/page-chrome'

type BookingAction = 'approve' | 'reject' | 'cancel' | 'complete' | 'no_show'

/** 運用者に見せる言葉。内部の値をそのまま出さない。 */
const ACTION_LABELS: Record<BookingAction, string> = {
  approve: '承認',
  reject: 'お断り',
  cancel: 'キャンセル',
  complete: '完了',
  no_show: '来店なし',
}

const STATUS_LABELS: Record<string, string> = {
  requested: '未承認',
  confirmed: '確定',
  rejected: 'お断り',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '来店なし',
  expired: '期限切れ',
}

const STATUS_BADGE: Record<string, string> = {
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
}

const OPERATION_STATUS_LABELS: Record<string, string> = {
  queued: '処理中',
  succeeded: '完了',
  skipped: '設定なし',
  retry_wait: '再試行が必要',
  permanent_failed: '失敗',
  cancelled: '取消済み',
}

const POLICY_FIELD_LABELS: Record<string, string> = {
  send_line_confirmation: '確定のお知らせ',
  day_before: '前日のお知らせ',
  hours_before: '当日のお知らせ',
}

/**
 * 通知実行台帳（operations の confirmation_line 行）に残る通知の種類。
 * renderNotificationText (worker) の NotificationKind と対応する。
 */
const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  requested: '受付のお知らせ',
  approved: '確定のお知らせ',
  rejected: 'お断りのお知らせ',
  expired: '期限切れのお知らせ',
  changed: '変更のお知らせ',
  day_before: '前日のお知らせ',
  hours_before: '当日のお知らせ',
}

/**
 * 送信済みのときに出す言い回し（設計 27-1-A の記録欄の語と対応）。
 * 台帳に succeeded の行があるときだけ使う。推測では書かない。
 */
const NOTIFICATION_OP_SUCCEEDED_LINES: Record<string, string> = {
  requested: '受付のお知らせを自動送信しました',
  approved: '確定のお知らせを送信しました',
  rejected: 'お断りのお知らせを送信しました',
  expired: '期限切れのお知らせを送信しました',
  changed: '変更のお知らせを送信しました',
  day_before: '前日のお知らせを送信しました',
  hours_before: '当日のお知らせを送信しました',
}

/**
 * DEEP-19: 「通知を送信しました」は台帳の事実だけから作る。
 * LINE連携の有無や通知設定から推測して書かない。
 */
function notificationOpLine(op: BookingOperationResult): string {
  const kind = typeof op.result?.notificationKind === 'string' ? op.result.notificationKind : ''
  const label = NOTIFICATION_KIND_LABELS[kind] ?? 'お知らせ'
  switch (op.status) {
    case 'succeeded':
      return NOTIFICATION_OP_SUCCEEDED_LINES[kind] ?? `${label}を送信しました`
    case 'queued':
      return `${label}の送信待ちです`
    case 'skipped':
      return `${label}は送信しませんでした`
    case 'cancelled':
      return `${label}の送信を取りやめました`
    case 'retry_wait':
      return `${label}の送信に失敗しました（再試行待ち）`
    default:
      return `${label}の送信に失敗しました`
  }
}

/**
 * DEEP-20: 確認窓の説明を、実際に起きる副作用に合わせる。
 * Worker の実処理 (booking.ts の decide 分岐) と対応:
 *   - 承認: 友だち連携済みかつ send_line_confirmation が ON のときだけ
 *     確定のお知らせを送る。確定へは戻れるが未承認へは戻れない。
 *   - お断り: 連携済みなら方針に関係なくお断りのお知らせを送る。終端。
 *   - キャンセル・完了・来店なし: お客様への自動連絡はしない。終端。
 */
function decideDescription(
  action: BookingAction,
  isLineLinked: boolean,
  policy: BookingNotificationPolicy | undefined,
): string {
  switch (action) {
    case 'approve': {
      const notify = !isLineLinked
        ? 'LINEと結びついていないため、お客様への自動連絡はありません。'
        : policy?.send_line_confirmation
          ? '確定のお知らせがお客様のLINEへ届きます。'
          : 'この予約は確定のお知らせを送らない設定です。承認してもLINEには届きません。'
      return `${notify}承認した予約は「未承認」には戻せません。取りやめるときはキャンセルにしてください。`
    }
    case 'reject':
      return `${
        isLineLinked
          ? 'お断りのお知らせがお客様のLINEへ届きます。'
          : 'LINEと結びついていないため、お客様への自動連絡はありません。'
      }お断りにした予約は元に戻せません。受け直すには新しい予約が必要です。`
    case 'cancel':
      return 'キャンセルしてもお客様への自動連絡はありません。必要なら個別にご連絡ください。キャンセルした予約は元に戻せず、受け直すには新しい予約が必要です。'
    case 'complete':
    case 'no_show':
      return 'この操作ではお客様への自動連絡はありません。一度変更すると、この画面から元の状態には戻せません。'
  }
}

function jpDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function jpTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function jpStamp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

function jstDate(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return jst.toISOString().slice(0, 10)
}

function jstHHMM(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return jst.toISOString().slice(11, 16)
}

/** 予約番号。id は UUID なので、そのままだと読み上げられない。 */
function bookingNumber(id: string): string {
  return `#R-${id.replace(/[^0-9a-zA-Z]/g, '').slice(-6).toUpperCase()}`
}

/**
 * 承認したときにお客様へ届く文面。
 *
 * 実際に送っているのは apps/worker/src/services/booking-notifier.ts の
 * renderNotificationText('approved', ...)。ここは同じ形をなぞっている。
 * 向こうを変えたらここも直すこと。
 */
function approvedText(b: { menu_name: string; staff_name: string; starts_at: string }): string {
  const jst = new Date(new Date(b.starts_at).getTime() + 9 * 3600_000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
  return [
    '予約が確定しました。',
    `メニュー: ${b.menu_name}`,
    `担当: ${b.staff_name}`,
    `日時: ${jst}`,
    '',
    '変更・キャンセルはお店に直接ご連絡ください。',
  ].join('\n')
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  starts_at: '日時',
  staff_id: '担当',
  menu_id: 'メニュー',
  price: '料金',
  customer_note: 'お客様からの要望',
  internal_note: '店内メモ',
  notification_policy: 'お知らせの送り方',
  status: '状態',
}

/** 監査行を運用者向けの1行にする。 */
function auditLine(log: BookingAuditLog): string {
  const actor = log.actorType === 'customer'
    ? 'お客様'
    : log.actorType === 'system'
      ? 'システム'
      : (log.actorName ? `${log.actorName}` : 'スタッフ')
  const changed = Object.keys(log.after ?? {})
    .map((key) => AUDIT_FIELD_LABELS[key] ?? key)
  switch (log.action) {
    case 'created':
      return log.actorType === 'customer'
        ? 'お客様が予約を申し込みました'
        : `${actor}が予約を記録しました`
    case 'updated':
      return changed.length > 0
        ? `${actor}が${changed.join('・')}を変更しました`
        : `${actor}が予約を変更しました`
    case 'status_changed': {
      const next = typeof log.after?.status === 'string' ? log.after.status : ''
      return `${actor}が状態を「${STATUS_LABELS[next] ?? next}」にしました`
    }
    case 'sync_retried':
      return `${actor}がGoogleカレンダーへの反映を再試行しました`
    case 'notification_retried':
      return `${actor}がLINE通知を再試行しました`
    default:
      return `${actor}が${log.action}しました`
  }
}

export default function BookingDetailPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <BookingDetailInner />
    </Suspense>
  )
}

function BookingDetailInner() {
  const { selectedAccountId } = useAccount()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  /**
   * DEEP-18: 詳細は「どのアカウントの・どの予約の応答か」を鍵付きで持つ。
   * 表示・操作に使う detail は、URLの予約IDと選択中アカウントに
   * 一致するものだけ（下の detail 定義でピン留めする）。
   */
  const [detailState, setDetailState] = useState<{
    key: { accountId: string; bookingId: string }
    booking: BookingAdminDetail
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [decideTarget, setDecideTarget] = useState<BookingAction | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /**
   * 表示・操作に使うのは、URLの予約IDと選択中アカウントに一致する
   * 詳細だけ。鍵が合わない（切替直後・古い応答）ものは null として
   * 扱い、変更操作を出さない（DEEP-18）。
   */
  const detail = detailState
    && detailState.key.accountId === selectedAccountId
    && detailState.key.bookingId === id
    ? detailState.booking
    : null
  usePageTitle(detail ? `${detail.customer.displayName} ／ ${detail.menuName}` : '予約の詳細')

  // ---- 変更モード (N-389) ----
  const [editing, setEditing] = useState(false)
  const [editMenus, setEditMenus] = useState<BookingMenu[]>([])
  const [editStaff, setEditStaff] = useState<BookingMenuStaff[]>([])
  const [editMenuId, setEditMenuId] = useState('')
  const [editStaffId, setEditStaffId] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editSlots, setEditSlots] = useState<BookingAvailabilitySlot[]>([])
  const [editSlotsLoading, setEditSlotsLoading] = useState(false)
  const [editPrice, setEditPrice] = useState('')
  const [editCustomerNote, setEditCustomerNote] = useState('')
  const [editInternalNote, setEditInternalNote] = useState('')
  const [editPolicy, setEditPolicy] = useState<BookingNotificationPolicy>({
    send_line_confirmation: true,
    day_before: true,
    hours_before: true,
  })
  const [editSendNotice, setEditSendNotice] = useState(true)
  const [editReason, setEditReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  /**
   * IDEA-27: 変更履歴の初回応答は要点分だけ。残りは「あとN件を読み込む」で
   * audit-logs 口から追加取得し、詳細の要点分と id で重複を潰して繋げる。
   */
  const [extraAuditLogs, setExtraAuditLogs] = useState<BookingAuditLog[] | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  /** これまでの予約の内訳。初期表示は件数だけ（要点）にし、開いてから一覧を見せる。 */
  const [historyOpen, setHistoryOpen] = useState(false)
  const slotRequest = useRef(0)
  /** DEEP-18: 遅れて返った古い取得が、今の対象を上書きしないよう要求の世代を数える。 */
  const loadGeneration = useRef(0)
  // N-401: 閲覧のみの人には承認・変更・再試行のボタンを見せない。
  // 読み込めるまでは隠す。最終の可否はサーバ側の403が決める。
  const [canOperate, setCanOperate] = useState(false)
  // 権限を読み終わるまで「閲覧のみ」の案内も出さない（操作できる人へ一瞬見せない）。
  const [staffResolved, setStaffResolved] = useState(false)
  useEffect(() => {
    let active = true
    void api.staff.me()
      .then((response) => { if (active) setCanOperate(response.success && canOperateBookings(response.data)) })
      .catch(() => { if (active) setCanOperate(false) })
      .finally(() => { if (active) setStaffResolved(true) })
    return () => { active = false }
  }, [])

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    const accountId = selectedAccountId
    const bookingId = id
    // DEEP-18: 対象が変わった瞬間に前の予約を残さない。古い詳細が
    // 表示・操作に使われ続ける事故を防ぐ。
    setDetailState((current) =>
      current == null
      || (current.key.accountId === accountId && current.key.bookingId === bookingId)
        ? current
        : null,
    )
    if (!bookingId || !accountId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await bookingApi.getBooking(accountId, bookingId)
      // あとから始めた取得が先に返っている場合、この応答は古い。
      // 遅い応答で今の対象を上書きしない（世代の確認）。
      if (loadGeneration.current !== generation) return
      setDetailState({ key: { accountId, bookingId }, booking: res.booking })
    } catch {
      if (loadGeneration.current !== generation) return
      // 失敗時は前の予約を「今の予約」として残さない。
      setDetailState(null)
      setError('読み込みに失敗しました。もう一度読み込んでください。')
    } finally {
      if (loadGeneration.current === generation) setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  // DEEP-18: 対象（アカウント×予約ID）が切り替わったら、変更モードや
  // 確認窓・メッセージも前の対象のものを残さない。
  useEffect(() => {
    setEditing(false)
    setDecideTarget(null)
    setError('')
    setNotice('')
    // IDEA-27: 追加取得した履歴・開いた内訳も前の対象のものを残さない。
    setExtraAuditLogs(null)
    setAuditLoading(false)
    setAuditError('')
    setHistoryOpen(false)
  }, [id, selectedAccountId])

  const status = detail?.status ?? ''
  const editable = status === 'requested' || status === 'confirmed'
  const isLineLinked = detail?.customer.isLineLinked === true

  // 失敗した外部処理（台帳行から拾う）。
  const failedCalendarOps = useMemo(
    () => (detail?.operations ?? []).filter(
      (op) => op.kind === 'google_calendar' && (op.status === 'retry_wait' || op.status === 'permanent_failed'),
    ),
    [detail],
  )
  const failedNotificationOps = useMemo(
    () => (detail?.operations ?? []).filter(
      (op) => op.kind === 'confirmation_line' && (op.status === 'retry_wait' || op.status === 'permanent_failed'),
    ),
    [detail],
  )
  const queuedCalendar = useMemo(
    () => (detail?.operations ?? []).some((op) => op.kind === 'google_calendar' && op.status === 'queued'),
    [detail],
  )
  // DEEP-19: 通知履歴は実行台帳（operations）だけから作る。
  const notificationOps = useMemo(
    () => (detail?.operations ?? []).filter((op) => op.kind === 'confirmation_line'),
    [detail],
  )

  /**
   * IDEA-27: 変更履歴は「詳細の要点分（直近）＋追加取得分」を id で重複排除して
   * 新しい順に繋ぐ。操作後の再読み込みで要点分が新しくなっても、
   * 追加取得済みの古い記録はそのまま残る。
   */
  const shownAuditLogs = useMemo(() => {
    if (!detail) return [] as BookingAuditLog[]
    const byId = new Map<string, BookingAuditLog>()
    for (const log of [...(extraAuditLogs ?? []), ...detail.auditLogs]) {
      if (!byId.has(log.id)) byId.set(log.id, log)
    }
    return [...byId.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  }, [detail, extraAuditLogs])
  const auditTotal = detail?.auditLogTotal ?? shownAuditLogs.length
  const auditRemaining = Math.max(0, auditTotal - shownAuditLogs.length)
  // audit-logs 口は最大200件。取り切っても残るなら「古い記録は省略」と伝える。
  const auditTruncated = extraAuditLogs !== null && auditRemaining > 0

  /**
   * IDEA-27: 未確認・要対応のまとめ。予約・カレンダー・通知・顧客の
   * 「まだ確認していない／失敗している」ことを1か所に集める。
   */
  const attentionItems = useMemo(() => {
    if (!detail) return [] as Array<{ key: string; text: string; href?: string }>
    const items: Array<{ key: string; text: string; href?: string }> = []
    if (detail.status === 'requested') {
      items.push({
        key: 'pending',
        text: 'まだ承認・お断りの判断をしていません',
        href: '#sec-actions',
      })
      if (detail.customerNote?.trim()) {
        items.push({
          key: 'customer-note',
          text: 'お客様からの要望があります。確認してから判断してください',
          href: '#sec-answer',
        })
      }
    }
    if (detail.previousHandover?.trim()) {
      items.push({
        key: 'handover',
        text: '前回の来店時の申し送りがあります',
        href: '#sec-customer',
      })
    }
    if (detail.calendarSync === 'failed') {
      items.push({
        key: 'calendar',
        text: 'Googleカレンダーに反映できていません',
        href: '#sec-failures',
      })
    }
    if (failedNotificationOps.length > 0) {
      items.push({
        key: 'notification',
        text: `届いていないお知らせが${failedNotificationOps.length}件あります`,
        href: '#sec-failures',
      })
    }
    const failedReminders = detail.reminders.filter(
      (reminder) => reminder.status === 'failed' || reminder.status === 'failed_permanent',
    )
    if (failedReminders.length > 0) {
      items.push({
        key: 'reminder',
        text: `送信に失敗したお知らせ予定が${failedReminders.length}件あります`,
        href: isLineLinked ? '#sec-reminders' : undefined,
      })
    }
    return items
  }, [detail, failedNotificationOps, isLineLinked])

  const loadMoreAudit = async () => {
    if (!selectedAccountId || !detail) return
    // 対象の切替で始まる load() と同じ世代番号で、遅れて返った
    // 別予約の履歴が今の画面へ混ざらないようにする（DEEP-18 と同じ仕組み）。
    const generation = loadGeneration.current
    setAuditLoading(true)
    setAuditError('')
    try {
      const res = await bookingApi.getAuditLogs(selectedAccountId, detail.id, 200)
      if (loadGeneration.current !== generation) return
      setExtraAuditLogs(res.audit_logs)
    } catch {
      if (loadGeneration.current !== generation) return
      setAuditError('記録を読み込めませんでした。もう一度お試しください。')
    } finally {
      if (loadGeneration.current === generation) setAuditLoading(false)
    }
  }

  const decide = async (action: BookingAction) => {
    if (!selectedAccountId) return
    setActing(true)
    setError('')
    try {
      await bookingApi.decideRequest(selectedAccountId, id, action)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '変更に失敗しました。通信を確かめて、もう一度お試しください。')
    } finally {
      setActing(false)
    }
  }

  // ---- 変更モードのデータ読み込み ----

  const startEdit = useCallback(() => {
    if (!detail) return
    setEditMenuId(detail.menuId)
    setEditStaffId(detail.staffId)
    setEditDate(jstDate(detail.startsAt))
    setEditTime(jstHHMM(detail.startsAt))
    setEditPrice(String(detail.price))
    setEditCustomerNote(detail.customerNote ?? '')
    setEditInternalNote(detail.internalNote ?? '')
    setEditPolicy(detail.notificationPolicy)
    setEditSendNotice(true)
    setEditReason('')
    setError('')
    setEditing(true)
  }, [detail])

  useEffect(() => {
    if (!editing || !selectedAccountId) return
    let active = true
    void bookingApi.listMenus(selectedAccountId)
      .then((response) => {
        if (active) setEditMenus(response.menus.filter((item) => item.is_active === 1))
      })
      .catch(() => { if (active) setError('予約メニューを読み込めませんでした') })
    return () => { active = false }
  }, [editing, selectedAccountId])

  useEffect(() => {
    if (!editing || !selectedAccountId || !editMenuId) {
      setEditStaff([])
      return
    }
    let active = true
    void bookingApi.listMenuStaff(selectedAccountId, editMenuId)
      .then((response) => { if (active) setEditStaff(response.staff) })
      .catch(() => { if (active) setError('担当者を読み込めませんでした') })
    return () => { active = false }
  }, [editing, selectedAccountId, editMenuId])

  // 空き枠の取得。変更対象の予約は重なり判定から外す（excludeBookingId）。
  // 外さないと「今の日時のまま」も衝突扱いになって保存できない。
  useEffect(() => {
    const requestId = ++slotRequest.current
    if (!editing || !selectedAccountId || !editMenuId || !editStaffId || !editDate) {
      setEditSlots([])
      return
    }
    setEditSlotsLoading(true)
    void bookingApi.getAvailability(selectedAccountId, {
      menuId: editMenuId,
      staffId: editStaffId,
      from: editDate,
      to: editDate,
      excludeBookingId: id,
    })
      .then((response) => {
        if (requestId !== slotRequest.current) return
        setEditSlots(response.by_staff.find((item) => item.staff_id === editStaffId)?.slots ?? [])
      })
      .catch(() => {
        if (requestId !== slotRequest.current) return
        setEditSlots([])
        setError('空き時間を確認できませんでした')
      })
      .finally(() => {
        if (requestId === slotRequest.current) setEditSlotsLoading(false)
      })
  }, [editing, selectedAccountId, editMenuId, editStaffId, editDate, id])

  const saveEdit = async () => {
    if (!selectedAccountId || !detail) return
    const patch: Parameters<typeof bookingApi.updateBooking>[2] = {
      lock_version: detail.lockVersion,
    }
    if (editMenuId !== detail.menuId) patch.menu_id = editMenuId
    if (editStaffId !== detail.staffId) patch.staff_id = editStaffId
    const chosenSlot = editSlots.find((slot) => slot.date === editDate && slot.start === editTime)
    if (chosenSlot?.startUtc) {
      const iso = new Date(chosenSlot.startUtc).toISOString()
      if (iso !== detail.startsAt) patch.starts_at = iso
    }
    // 日時を変えようとして枠が取れないまま保存すると、日時だけが
    // 静かに無変更になる。それを防ぐため、ここで止める。
    const dateOrTimeChanged = editDate !== jstDate(detail.startsAt) || editTime !== jstHHMM(detail.startsAt)
    if (dateOrTimeChanged && !chosenSlot) {
      setError(editTime === '' ? '変更後の時間を選択してください' : '選んだ時間は空いていません。別の時間を選んでください。')
      return
    }
    const priceNum = Number(editPrice)
    if (editPrice.trim() !== '' && (!Number.isInteger(priceNum) || priceNum < 0)) {
      setError('料金は0以上の整数で入力してください')
      return
    }
    if (editPrice.trim() !== '' && Number.isInteger(priceNum) && priceNum >= 0 && priceNum !== detail.price) {
      patch.price = priceNum
    }
    if (editCustomerNote !== (detail.customerNote ?? '')) patch.customer_note = editCustomerNote || null
    if (editInternalNote !== (detail.internalNote ?? '')) patch.internal_note = editInternalNote || null
    const policyPatch: Partial<BookingNotificationPolicy> = {}
    for (const key of Object.keys(POLICY_FIELD_LABELS) as Array<keyof BookingNotificationPolicy>) {
      if (editPolicy[key] !== detail.notificationPolicy[key]) policyPatch[key] = editPolicy[key]
    }
    if (Object.keys(policyPatch).length > 0) patch.notification_policy = policyPatch
    if (!editSendNotice) patch.send_change_notification = false
    if (editReason.trim()) patch.reason = editReason.trim()

    if (Object.keys(patch).length === 1) {
      setError('変更する項目がありません')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const updated = await bookingApi.updateBooking(selectedAccountId, id, patch)
      setEditing(false)
      /* IDEA-07: 変更と一緒に動いた通知も応答から言う。
         「組み直した/送る」が見えないと、古い通知が残ったままか、
         新しい通知が組まれたかを画面から確かめられない。 */
      const effects: string[] = []
      if (updated.change_notification === 'queued') {
        effects.push('変更のお知らせをお客様へ送ります')
      }
      if (updated.reminders_created > 0) {
        effects.push('今後のお知らせを新しい日時で組み直しました')
      }
      setNotice(`${['予約を変更しました', ...effects].join('。')}。`)
      await load()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'version_conflict') {
        setError('ほかの人が先にこの予約を変更しました。最新の状態を読み直してから、もう一度変更してください。')
        await load()
      } else if (cause instanceof ApiError && (cause.code === 'slot_conflict' || cause.code === 'slot_not_available')) {
        setError('選んだ時間はほかの予約で埋まっています。別の時間を選んでください。')
      } else if (cause instanceof ApiError && cause.code === 'line_notification_unavailable') {
        setError('LINEと結びついていないお客様へは、LINEのお知らせを送れません。')
      } else {
        setError('予約を変更できませんでした。内容を確認して、もう一度お試しください。')
      }
    } finally {
      setSaving(false)
    }
  }

  // ---- 再試行 (N-392 / N-393) ----

  const retryCalendar = async () => {
    if (!selectedAccountId) return
    setRetrying('calendar')
    setError('')
    setNotice('')
    try {
      const result = await bookingApi.retryCalendarSync(selectedAccountId, id)
      setNotice(result.status === 'succeeded' ? 'Googleカレンダーへ反映しました' : '反映を再試行しました（まだ失敗している場合は時間をおいて再度お試しください）')
      await load()
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'no_retryable_operation'
        ? '再試行できる失敗はありません'
        : '再試行できませんでした')
      await load()
    } finally {
      setRetrying(null)
    }
  }

  const retryNotification = async (runId: string) => {
    if (!selectedAccountId) return
    setRetrying(runId)
    setError('')
    setNotice('')
    try {
      const result = await bookingApi.retryNotification(selectedAccountId, id, runId)
      setNotice(result.status === 'succeeded' ? 'お知らせを送りました' : 'お知らせの送信に失敗しました。通信を確かめて、もう一度お試しください。')
      await load()
    } catch {
      setError('お知らせを再送できませんでした')
      await load()
    } finally {
      setRetrying(null)
    }
  }

  if (!id) {
    return (
      <div>
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          予約が指定されていません。
          <Link href="/booking/bookings" className="text-accent-deep ml-1 hover:underline">
            一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <nav className="text-ink-faint mb-2 text-xs" aria-label="パンくず">
        <Link href="/booking/bookings" className="hover:underline">
          予約管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>予約の詳細</span>
      </nav>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-success-bg text-success mb-4 rounded-lg border border-transparent p-4 text-sm">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : !detail ? (
        // DEEP-18: 取得失敗を「存在しない予約」と混ぜない。失敗時は
        // 前の予約も出さず、読み直す導線だけを置く。
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          {error ? '予約を読み込めませんでした。' : 'この予約は見つかりませんでした。'}
          {error ? (
            <button
              type="button"
              onClick={() => void load()}
              className="text-accent-deep ml-2 underline"
            >
              もう一度読み込む
            </button>
          ) : null}
        </p>
      ) : (
        <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
          <div data-design="Left" className="min-w-0 flex-1 space-y-4">
            <section data-design="Sum" className="bg-canvas rounded-card border-hairline border p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-ink text-base font-semibold">{detail.menuName}</h2>
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs ${STATUS_BADGE[status] ?? 'bg-canvas-sunken text-ink-secondary'}`}
                >
                  {STATUS_LABELS[status] ?? status}
                </span>
                <span className="text-ink-faint font-mono text-xs">
                  予約番号 {bookingNumber(detail.id)}
                </span>
              </div>
              <Row label="日時">
                {jpDateTime(detail.startsAt)}〜{jpTime(detail.endsAt)}
              </Row>
              <Row label="担当">{detail.staffName}</Row>
              <Row label="料金">
                <span className="tabular-nums">
                  ¥{detail.price.toLocaleString()}（税込）
                </span>
              </Row>
              <Row label="申込日時">{jpStamp(detail.requestedAt)}</Row>
              <Row label="Googleカレンダー">
                {detail.calendarSync === 'synced' ? '反映済み'
                  : detail.calendarSync === 'failed' ? (
                    <span className="text-danger">
                      反映に失敗しています
                      {canOperate ? (
                        <button
                          type="button"
                          onClick={() => void retryCalendar()}
                          disabled={retrying !== null || queuedCalendar}
                          className="text-accent-deep ml-2 underline disabled:opacity-40"
                        >
                          {retrying === 'calendar' ? '再試行中...' : 'もう一度反映する'}
                        </button>
                      ) : null}
                    </span>
                  ) : detail.calendarSync === 'pending' ? '反映処理中' : '未設定'}
              </Row>
            </section>

            {/* ---- 予約内容の変更 (N-389) ---- */}
            {editing ? (
              <section className="bg-canvas rounded-card border-hairline border p-5">
                <h2 className="text-ink mb-3 text-sm font-semibold">予約内容を変更する</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  <EditField label="予約メニュー">
                    <SelectField
                      value={editMenuId}
                      onChange={(event) => { setEditMenuId(event.target.value); setEditTime('') }}
                      className="w-full"
                      options={editMenus.map((item) => ({ value: item.id, label: item.name }))}
                    />
                  </EditField>
                  <EditField label="担当者">
                    <SelectField
                      value={editStaffId}
                      onChange={(event) => { setEditStaffId(event.target.value); setEditTime('') }}
                      className="w-full"
                      options={editStaff.map((item) => ({ value: item.id, label: item.display_name }))}
                    />
                  </EditField>
                  <EditField label="日付">
                    <input
                      type="date"
                      value={editDate}
                      onChange={(event) => { setEditDate(event.target.value); setEditTime('') }}
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    />
                  </EditField>
                  <EditField label="時間">
                    <SelectField
                      value={editTime}
                      onChange={(event) => setEditTime(event.target.value)}
                      disabled={editSlotsLoading}
                      className="w-full"
                      options={[
                        { value: '', label: editSlotsLoading ? '確認中です' : '選択してください' },
                        ...editSlots.map((slot) => ({
                          value: slot.start,
                          label: `${slot.start}〜${slot.end}${
                            slot.date === jstDate(detail.startsAt) && slot.start === jstHHMM(detail.startsAt)
                              ? '（現在）'
                              : ''
                          }`,
                        })),
                      ]}
                    />
                  </EditField>
                  <EditField label="料金（円・税込）">
                    <input
                      type="number"
                      min={0}
                      value={editPrice}
                      onChange={(event) => setEditPrice(event.target.value)}
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    />
                  </EditField>
                  <EditField label="変更理由（記録に残ります・任意）">
                    <input
                      type="text"
                      value={editReason}
                      onChange={(event) => setEditReason(event.target.value)}
                      placeholder="例: お客様の都合で時間変更"
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    />
                  </EditField>
                </div>
                <div className="mt-3 grid gap-3">
                  <EditField label="お客様からの要望">
                    <textarea
                      value={editCustomerNote}
                      onChange={(event) => setEditCustomerNote(event.target.value)}
                      rows={3}
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    />
                  </EditField>
                  <EditField label="店内メモ（お客様には見えません）">
                    <textarea
                      value={editInternalNote}
                      onChange={(event) => setEditInternalNote(event.target.value)}
                      rows={2}
                      className="border-hairline rounded-control w-full border px-3 py-2 text-sm"
                    />
                  </EditField>
                </div>
                {isLineLinked ? (
                  <div className="border-hairline mt-4 border-t pt-4">
                    <p className="text-ink mb-2 text-xs font-medium">お知らせの送り方（この予約だけの設定）</p>
                    <div className="space-y-2">
                      {(Object.keys(POLICY_FIELD_LABELS) as Array<keyof BookingNotificationPolicy>).map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={editPolicy[key]}
                            onChange={(event) => setEditPolicy((prev) => ({ ...prev, [key]: event.target.checked }))}
                            className="accent-accent-deep h-4 w-4"
                          />
                          <span className="text-ink">{POLICY_FIELD_LABELS[key]}を送る</span>
                        </label>
                      ))}
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editSendNotice}
                          onChange={(event) => setEditSendNotice(event.target.checked)}
                          className="accent-accent-deep h-4 w-4"
                        />
                        <span className="text-ink">今回の変更をお客様のLINEに知らせる</span>
                      </label>
                    </div>
                  </div>
                ) : (
                  <p className="text-ink-faint border-hairline mt-4 border-t pt-4 text-xs">
                    LINEと結びついていないため、お知らせは届きません。
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="primary"
                    type="button"
                    onClick={() => void saveEdit()}
                    disabled={saving}
                  >
                    {saving ? '保存しています' : 'この内容で変更する'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => { setEditing(false); setError('') }}
                    disabled={saving}
                  >
                    やめる
                  </Button>
                </div>
              </section>
            ) : (
              <section id="sec-answer" className="bg-canvas rounded-card border-hairline border p-5">
                <h2 className="text-ink mb-3 text-sm font-semibold">申込時にいただいた回答</h2>
                {detail.customerNote ? (
                  <>
                    <p className="text-ink-faint text-xs">気になっていること</p>
                    <p className="text-ink mt-1 text-sm whitespace-pre-wrap">
                      {detail.customerNote}
                    </p>
                  </>
                ) : (
                  <p className="text-ink-faint text-sm">記入はありませんでした。</p>
                )}
                {detail.internalNote ? (
                  <div className="mt-3">
                    <p className="text-ink-faint text-xs">店内メモ</p>
                    <p className="text-ink mt-1 text-sm whitespace-pre-wrap">{detail.internalNote}</p>
                  </div>
                ) : null}
              </section>
            )}

            <section id="sec-customer" className="bg-canvas rounded-card border-hairline border p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-ink text-sm font-semibold">お客さま</h2>
                {detail.customer.friendId ? (
                  <Link
                    href={`/friends/detail?id=${encodeURIComponent(detail.customer.friendId)}`}
                    className="text-accent-deep text-xs hover:underline"
                  >
                    友だち詳細を見る
                  </Link>
                ) : null}
              </div>
              <Row label="お名前">
                {detail.customer.displayName ? `${detail.customer.displayName} さま` : '未設定'}
              </Row>
              {isLineLinked ? (
                <Row label="LINEの表示名">{detail.customer.displayName ?? '未設定'}</Row>
              ) : (
                <Row label="LINEとの結びつき">
                  <span className="text-ink-faint">結びついていません（電話でのご予約）</span>
                </Row>
              )}
              <Row label="連絡先">
                {detail.customer.phone ?? '登録なし'}
              </Row>
              {detail.customer.petName ? (
                <Row label="ペットの名前">{detail.customer.petName}</Row>
              ) : null}
              {detail.customer.tags.length > 0 ? (
                <Row label="タグ">
                  <span className="flex flex-wrap gap-1">
                    {detail.customer.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-xs"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </span>
                </Row>
              ) : null}
              {detail.customer.mileageBalance !== null
              && detail.customer.mileageBalance !== undefined ? (
                <Row label="マイル">
                  <span className="tabular-nums">{detail.customer.mileageBalance.toLocaleString()}</span>
                </Row>
              ) : null}
              {detail.previousHandover?.trim() ? (
                <Row label="前回の申し送り">
                  <span className="whitespace-pre-wrap">{detail.previousHandover}</span>
                </Row>
              ) : null}
              <Row label="これまでの予約">
                {detail.history.length === 0 ? (
                  <span className="text-ink-faint">この予約がはじめてです</span>
                ) : (
                  <>
                    {detail.history.length}件
                    <button
                      type="button"
                      onClick={() => setHistoryOpen((open) => !open)}
                      className="text-accent-deep ml-2 text-xs underline"
                      aria-expanded={historyOpen}
                    >
                      {historyOpen ? '内訳を閉じる' : '内訳を見る'}
                    </button>
                  </>
                )}
              </Row>
              {historyOpen && detail.history.length > 0 ? (
                <ol className="border-hairline mt-1 space-y-1.5 border-t pt-3">
                  {detail.history.map((item) => (
                    <li key={item.id} className="text-ink-secondary flex flex-wrap gap-x-3 text-xs">
                      <span className="tabular-nums">{jpStamp(item.startsAt)}</span>
                      <span className="min-w-0">
                        {item.menuName}／{item.staffName}
                      </span>
                      <span>{STATUS_LABELS[item.status] ?? item.status}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          </div>

          <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-96">
            {/* ---- 確認が必要なことのまとめ (IDEA-27) ---- */}
            <section className="bg-canvas rounded-card border-hairline border p-5">
              <h2 className="text-ink mb-3 text-sm font-semibold">確認が必要なこと</h2>
              {attentionItems.length === 0 ? (
                <p className="text-ink-faint text-xs">確認が必要なことはありません。</p>
              ) : (
                <ul className="space-y-2">
                  {attentionItems.map((item) => (
                    <li key={item.key} className="text-ink-secondary text-xs">
                      {item.href ? (
                        <a href={item.href} className="hover:text-accent-deep hover:underline">
                          {item.text}
                        </a>
                      ) : (
                        item.text
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              id="sec-actions"
              data-design="sec この予約をどうするか"
              className="bg-canvas rounded-card border-hairline border p-5"
            >
              <h2 className="text-ink mb-1 text-sm font-semibold">この予約をどうするか</h2>
              <p className="text-ink-faint mb-3 text-xs">
                {/* DEEP-20: 実際の副作用に合わせる。承認は方針ONの連携済み
                    予約だけLINEを送り、完了・来店なし・キャンセルは送らない。 */}
                {!isLineLinked
                  ? 'LINEと結びついていないため、お客様への自動連絡はありません。'
                  : status === 'requested'
                    ? (detail.notificationPolicy.send_line_confirmation
                      ? '承認するとお客様のLINEに確定のお知らせが届きます。'
                      : 'この予約は確定のお知らせを送らない設定です。承認してもLINEには届きません。')
                    : '完了・来店なし・キャンセルの操作では、お客様への自動連絡はありません。'}
              </p>
              <div className="flex flex-col gap-2">
                {/* N-401: 閲覧のみの人には状態を変える操作を出さない */}
                {staffResolved && !canOperate && editable && (
                  <p className="text-ink-faint text-sm">
                    閲覧のみの権限のため、状態の変更はできません。
                  </p>
                )}
                {canOperate && status === 'requested' && (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => setDecideTarget('approve')}
                      disabled={acting}
                    >
                      承認する
                    </Button>
                    <Button
                      onClick={() => void startEdit()}
                      disabled={acting}
                    >
                      内容を変更する
                    </Button>
                    <button
                      onClick={() => setDecideTarget('reject')}
                      disabled={acting}
                      className="text-danger hover:bg-danger-bg rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      拒否する
                    </button>
                  </>
                )}
                {canOperate && status === 'confirmed' && (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => setDecideTarget('complete')}
                      disabled={acting}
                    >
                      完了にする
                    </Button>
                    <Button
                      onClick={() => void startEdit()}
                      disabled={acting}
                    >
                      内容を変更する
                    </Button>
                    <Button
                      onClick={() => setDecideTarget('no_show')}
                      disabled={acting}
                    >
                      来店なし
                    </Button>
                    <button
                      onClick={() => setDecideTarget('cancel')}
                      disabled={acting}
                      className="text-danger hover:bg-danger-bg rounded-control px-4 py-2 text-sm font-medium disabled:opacity-40"
                    >
                      キャンセル
                    </button>
                  </>
                )}
                {!editable && (
                  <p className="text-ink-faint text-sm">
                    この状態からは変えられません。新しく予約を取り直してください。
                  </p>
                )}
              </div>
            </section>

            {/* ---- 送信状況と再試行 (N-393) ---- */}
            {(failedNotificationOps.length > 0 || failedCalendarOps.length > 0) && (
              <section id="sec-failures" className="bg-canvas rounded-card border-hairline border p-5">
                <h2 className="text-ink mb-3 text-sm font-semibold">届かなかった処理</h2>
                <ul className="space-y-3">
                  {failedNotificationOps.map((op) => (
                    <li key={op.id} className="text-sm">
                      <p className="text-ink">
                        LINEのお知らせ（{OPERATION_STATUS_LABELS[op.status] ?? op.status}）
                      </p>
                      {op.errorCode ? (
                        <p className="text-ink-faint text-xs">原因: {op.errorCode}</p>
                      ) : null}
                      {isLineLinked && canOperate ? (
                        <button
                          type="button"
                          onClick={() => void retryNotification(op.id)}
                          disabled={retrying !== null}
                          className="text-accent-deep mt-1 text-xs underline disabled:opacity-40"
                        >
                          {retrying === op.id ? '再送中...' : 'もう一度送る'}
                        </button>
                      ) : null}
                    </li>
                  ))}
                  {failedCalendarOps.map((op) => (
                    <li key={op.id} className="text-sm">
                      <p className="text-ink">
                        Googleカレンダーへの反映（{OPERATION_STATUS_LABELS[op.status] ?? op.status}）
                      </p>
                      {op.errorCode ? (
                        <p className="text-ink-faint text-xs">原因: {op.errorCode}</p>
                      ) : null}
                      {canOperate ? (
                        <button
                          type="button"
                          onClick={() => void retryCalendar()}
                          disabled={retrying !== null || queuedCalendar}
                          className="text-accent-deep mt-1 text-xs underline disabled:opacity-40"
                        >
                          {retrying === 'calendar' ? '再試行中...' : 'もう一度反映する'}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {isLineLinked && detail.notificationPolicy.send_line_confirmation ? (
              <section className="bg-canvas rounded-card border-hairline border p-5">
                <h2 className="text-ink mb-1 text-sm font-semibold">承認したときの通知</h2>
                <p className="text-ink-faint mb-3 text-xs">お客様に届く内容</p>
                <div className="bg-canvas-sunken rounded-card p-3">
                  <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
                  <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
                    {approvedText({ menu_name: detail.menuName, staff_name: detail.staffName, starts_at: detail.startsAt })}
                  </p>
                </div>
              </section>
            ) : null}

            {isLineLinked ? (
              <section id="sec-reminders" className="bg-canvas rounded-card border-hairline border p-5">
                <h2 className="text-ink mb-3 text-sm font-semibold">お知らせの予定</h2>
                {detail.reminders.length === 0 ? (
                  <p className="text-ink-faint text-xs">今後のお知らせはありません。</p>
                ) : (
                  <ol className="space-y-2">
                    {detail.reminders.map((reminder) => (
                      <li key={reminder.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-ink">
                          {POLICY_FIELD_LABELS[reminder.kind] ?? reminder.kind}　{jpStamp(reminder.scheduledAt)}
                        </span>
                        <span className="text-ink-faint">
                          {reminder.status === 'pending' ? '送信予定'
                            : reminder.status === 'sent' ? '送信済み'
                            : reminder.status === 'cancelled' ? '停止済み'
                            : '失敗'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ) : null}

            {/* ---- 変更履歴 (N-394 / IDEA-27) ---- */}
            <section id="sec-history" className="bg-canvas rounded-card border-hairline border p-5">
              <h2 className="text-ink mb-3 text-sm font-semibold">この予約の記録</h2>
              {shownAuditLogs.length === 0 ? (
                // DEEP-19: 監査行のない予約（記録開始前のデータなど）に、
                // LINE連携の有無から「送信しました」を推測して書かない。
                // 出せるのは申込経路と通知実行台帳の事実だけ。
                <div className="space-y-3">
                  <ol className="space-y-3">
                    <LogRow
                      at={jpStamp(detail.requestedAt)}
                      text={detail.source === 'liff'
                        ? 'お客様が予約を申し込みました'
                        : 'スタッフが予約を記録しました'}
                    />
                    {notificationOps.map((op) => (
                      <LogRow
                        key={op.id}
                        at={jpStamp(op.completedAt ?? op.scheduledAt ?? detail.requestedAt)}
                        text={notificationOpLine(op)}
                      />
                    ))}
                  </ol>
                  {notificationOps.length === 0 && (
                    <p className="text-ink-faint text-xs">通知履歴はありません。</p>
                  )}
                </div>
              ) : (
                <>
                  <ol className="space-y-3">
                    {shownAuditLogs.map((log) => (
                      <LogRow key={log.id} at={jpStamp(log.occurredAt)} text={auditLine(log)} />
                    ))}
                  </ol>
                  {/* IDEA-27: 初期表示は要点分だけ。残りは audit-logs 口から追加取得する。
                      取り損ねても前の一覧は消さず、再試行できるようにする。 */}
                  {auditError ? (
                    <p className="text-danger mt-3 text-xs">{auditError}</p>
                  ) : null}
                  {auditTruncated ? (
                    <p className="text-ink-faint mt-3 text-xs">
                      これより古い記録は省略しています。
                    </p>
                  ) : null}
                  {auditRemaining > 0 && !auditTruncated ? (
                    <button
                      type="button"
                      onClick={() => void loadMoreAudit()}
                      disabled={auditLoading}
                      className="text-accent-deep mt-3 text-xs underline disabled:opacity-40"
                    >
                      {auditLoading ? '読み込み中...' : `あと${auditRemaining}件の記録を読み込む`}
                    </button>
                  ) : null}
                </>
              )}
            </section>
          </div>
        </div>
      )}

      {/* DEEP-18: 対象の詳細が確定していない間は確認窓を開かない。
          DEEP-20: 説明は操作と通知方針ごとの実処理に合わせる。 */}
      <ConfirmDialog
        open={decideTarget !== null && detail !== null}
        title={`この予約を「${decideTarget ? ACTION_LABELS[decideTarget] : ''}」にしますか？`}
        description={decideTarget && detail
          ? decideDescription(decideTarget, isLineLinked, detail.notificationPolicy)
          : ''}
        confirmLabel={decideTarget ? ACTION_LABELS[decideTarget] : '実行する'}
        destructive={decideTarget === 'reject' || decideTarget === 'cancel' || decideTarget === 'no_show'}
        busy={acting}
        onCancel={() => setDecideTarget(null)}
        onConfirm={() => { const a = decideTarget; setDecideTarget(null); if (a) void decide(a) }}
      />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline flex gap-4 border-b py-2.5 last:border-b-0">
      <span className="text-ink-faint w-28 shrink-0 pt-0.5 text-xs font-medium">{label}</span>
      <div className="text-ink flex-1 text-sm break-words">{children}</div>
    </div>
  )
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-ink-secondary block text-xs">
      <span className="mb-1.5 block font-medium">{label}</span>
      {children}
    </label>
  )
}

function LogRow({ at, text }: { at: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="text-ink-faint w-32 shrink-0 text-xs tabular-nums">{at}</span>
      <span className="text-ink-secondary text-xs">{text}</span>
    </li>
  )
}
