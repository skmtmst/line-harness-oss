import { jstCalendar as japanCalendar } from '@/lib/jst-datetime'
import { jstDate as japanDate } from '@/lib/jst-datetime'
import { type BookingAdminDetail, type BookingAuditLog, type BookingNotificationPolicy, type BookingOperationResult } from '@/lib/api'

import { formatDateTime, formatTime } from '@/lib/format'

export type BookingAction = 'approve' | 'reject' | 'cancel' | 'complete' | 'no_show'

/** 運用者に見せる言葉。内部の値をそのまま出さない。 */
export const ACTION_LABELS: Record<BookingAction, string> = {
  approve: '承認',
  reject: 'お断り',
  cancel: 'キャンセル',
  complete: '完了',
  no_show: '来店なし',
}

export const STATUS_LABELS: Record<string, string> = {
  requested: '未承認',
  confirmed: '確定',
  rejected: 'お断り',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '来店なし',
  expired: '期限切れ',
}

export const STATUS_BADGE: Record<string, string> = {
  requested: 'bg-warning-bg text-warning',
  confirmed: 'bg-success-bg text-success',
}

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  queued: '処理中',
  succeeded: '完了',
  skipped: '設定なし',
  retry_wait: '再試行が必要',
  permanent_failed: '失敗',
  cancelled: '取消済み',
}

export const POLICY_FIELD_LABELS: Record<string, string> = {
  send_line_confirmation: '確定のお知らせ',
  day_before: '前日のお知らせ',
  hours_before: '当日のお知らせ',
}

/**
 * 通知実行台帳（operations の confirmation_line 行）に残る通知の種類。
 * renderNotificationText (worker) の NotificationKind と対応する。
 */
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
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
export const NOTIFICATION_OP_SUCCEEDED_LINES: Record<string, string> = {
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
export function notificationOpLine(op: BookingOperationResult): string {
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
export function decideDescription(
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

export function jpDateTime(iso: string): string {
  return formatDateTime(iso)
}

export function jpTime(iso: string): string {
  return formatTime(iso)
}

export function jpStamp(iso: string): string {
  return formatDateTime(iso)
}

export function jstDate(iso: string): string {
  return japanDate(new Date(iso))
}

export function jstHHMM(iso: string): string {
  const jst = japanCalendar(new Date(iso))
  return jst.toISOString().slice(11, 16)
}

/** 予約番号。id は UUID なので、そのままだと読み上げられない。 */
export function bookingNumber(id: string): string {
  return `#R-${id.replace(/[^0-9a-zA-Z]/g, '').slice(-6).toUpperCase()}`
}

/** 実送信と共通のサーバー本文だけを表示する。取得できない本文は推測しない。 */
export function approvedText(booking: Pick<BookingAdminDetail, 'confirmationPreviewText'>): string | null {
  const text = booking.confirmationPreviewText
  return typeof text === 'string' && text.trim() ? text : null
}

export const AUDIT_FIELD_LABELS: Record<string, string> = {
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
export function auditLine(log: BookingAuditLog): string {
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
    case 'v6_sync_failed':
      return `${actor}が通知の同期に失敗しました（予約の変更は保存されています。次回の保存で直します）`
    default:
      return `${actor}が${log.action}しました`
  }
}

/**
 * R318: 編集開始時の値の写し。保存の差分と、競合時に相手が変えた欄の
 * 特定に使う。
 */
export function snapshotEditBase(detail: BookingAdminDetail) {
  return {
    menuId: detail.menuId,
    staffId: detail.staffId,
    date: jstDate(detail.startsAt),
    time: jstHHMM(detail.startsAt),
    startsAt: detail.startsAt,
    price: detail.price,
    customerNote: detail.customerNote ?? '',
    internalNote: detail.internalNote ?? '',
    policy: { ...detail.notificationPolicy },
  }
}

export type EditBase = ReturnType<typeof snapshotEditBase>

/**
 * R318: 編集開始後に相手が変えた欄を運用者の言葉で列挙する。
 * 合格条件の日時・担当・メニュー・料金・通知方針をここで拾う。
 */
export function serverChangedLabels(base: EditBase, latest: BookingAdminDetail): string[] {
  const changed: string[] = []
  if (latest.menuId !== base.menuId) changed.push(AUDIT_FIELD_LABELS.menu_id)
  if (latest.staffId !== base.staffId) changed.push(AUDIT_FIELD_LABELS.staff_id)
  if (latest.startsAt !== base.startsAt) changed.push(AUDIT_FIELD_LABELS.starts_at)
  if (latest.price !== base.price) changed.push(AUDIT_FIELD_LABELS.price)
  if ((latest.customerNote ?? '') !== base.customerNote) changed.push(AUDIT_FIELD_LABELS.customer_note)
  if ((latest.internalNote ?? '') !== base.internalNote) changed.push(AUDIT_FIELD_LABELS.internal_note)
  if ((Object.keys(POLICY_FIELD_LABELS) as Array<keyof BookingNotificationPolicy>)
    .some((key) => latest.notificationPolicy[key] !== base.policy[key])) {
    changed.push(AUDIT_FIELD_LABELS.notification_policy)
  }
  return changed
}

/** A07: 送達不明は通常の失敗と分け、再送を勧めない。 */
export function notificationResultUnknown(operation: Pick<BookingOperationResult, 'errorCode'>): boolean {
  return operation.errorCode === 'delivery_unknown'
}
