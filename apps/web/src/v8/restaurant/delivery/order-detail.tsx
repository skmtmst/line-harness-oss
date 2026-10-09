'use client'

/*
 * ★V8 デリバリー受注・注文の詳細（窓 `hjdqV`）とキャンセルの確認（窓 `dgeTy`）。
 *
 * 画面は受け取った内容を出すだけにする。送信は親（delivery.tsx）が持つ。
 * 急ぎ度の判定はWorker側だけで行い、ここには結果と理由の文しか来ない（仕組みの名前は出さない）。
 * 窓の頭は絵のとおり「注文の詳細」で固定し、注文番号は中の段へ置く
 * （番号を頭に入れると長さで頭が崩れるため）。
 * キャンセルは取り消せないので、別の窓で理由を選んでから送る。自由文は扱わず符号だけを送る。
 */

import { Ban } from 'lucide-react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Notice, { type NoticeTone } from '@/components/shared/notice'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import {
  DELIVERY_SERVICE_LABELS,
  type DeliveryCancelReasonCode,
  type DeliveryOrderDetailData,
  type DeliveryOrderStatus,
  type DeliveryUrgency,
} from '@/lib/restaurant-delivery-api'
import { DialogField, DialogNote, RsDialog } from '../booking-kit/parts'
import {
  CANCEL_REASON_OPTIONS,
  DASH,
  formatClock,
  formatShortStamp,
  formatYen,
  urgencyLabel,
} from './format'
import styles from './delivery.module.css'

/* キャンセル・拒否は色で責めない（起きたことを文字で伝えるだけ）。 */
const STATUS_TONES: Record<DeliveryOrderStatus, StatusBadgeTone> = {
  new: 'info',
  cooking: 'warning',
  ready: 'success',
  handed_over: 'success',
  canceled: 'neutral',
  rejected: 'neutral',
}

const URGENCY_TONES: Record<DeliveryUrgency, StatusBadgeTone> = {
  urgent: 'danger',
  watch: 'warning',
  normal: 'neutral',
}

/* 急ぎ度の帯。「ふつう」は帯を出さない（札だけで足りる）。 */
const URGENCY_NOTICE_TONES: Record<DeliveryUrgency, NoticeTone | null> = {
  urgent: 'danger',
  watch: 'warn',
  normal: null,
}

/** 窓の寸法（絵のとおり）。詳細は中身が多いので上に寄せる。 */
const DETAIL_WIDTH = 560
const DETAIL_TOP = 120
const CANCEL_WIDTH = 480
const CANCEL_TOP = 240

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <p className={styles.factKey}>{label}</p>
      <p className={styles.factValue}>{children}</p>
    </>
  )
}

export interface OrderDetailDialogProps {
  open: boolean
  loading: boolean
  /** 日本語の案内だけを入れる（内部の文は入れない）。 */
  error: string | null
  detail: DeliveryOrderDetailData | null
  busy: boolean
  canManage: boolean
  onClose: () => void
  onRetry: () => void
  onAccept: () => void
  onReject: () => void
  onReady: () => void
  /** キャンセルの確認（`dgeTy`）を開く。 */
  onCancelOrder: () => void
}

export function OrderDetailDialog({
  open,
  loading,
  error,
  detail,
  busy,
  canManage,
  onClose,
  onRetry,
  onAccept,
  onReject,
  onReady,
  onCancelOrder,
}: OrderDetailDialogProps) {
  const order = detail?.order ?? null
  const items = detail?.items ?? []
  const serviceLabel = order
    ? order.serviceLabel || DELIVERY_SERVICE_LABELS[order.service]
    : DASH

  /* 頭の下の一文（「12:02 受信・受け取り希望 12:15」）。取れない時刻は書かない。 */
  const summaryLine = (() => {
    if (!order) return null
    const received = formatClock(order.receivedAt)
    const wanted = formatClock(order.wantedAt)
    const parts: string[] = []
    if (received !== DASH) parts.push(`${received} 受信`)
    if (wanted !== DASH) parts.push(`受け取り希望 ${wanted}`)
    return parts.length > 0 ? parts.join('・') : null
  })()

  const urgencyTone = order ? URGENCY_NOTICE_TONES[order.urgency] : null

  /*
   * 下のボタンは状態で変える。
   * 新着は絵のとおり左に「キャンセル」（押すと `dgeTy` が開く）、
   * 右に「拒否する・受け付ける」。
   * 調理中は「閉じる・注文をキャンセル・準備完了」。
   * それ以外（受け渡し済み・キャンセル・拒否）は閉じるだけにする。
   */
  const actions = (() => {
    if (!order || !canManage) {
      return <Button onClick={onClose}>閉じる</Button>
    }
    if (order.status === 'new') {
      return (
        <>
          <Button variant="danger-outline" disabled={busy} onClick={onCancelOrder}>
            <Ban size={15} aria-hidden="true" />キャンセル
          </Button>
          <span className={styles.spacer} />
          <Button disabled={busy} onClick={onReject}>拒否する</Button>
          <Button variant="primary" busy={busy} busyLabel="受付中…" onClick={onAccept}>
            受け付ける
          </Button>
        </>
      )
    }
    if (order.status === 'cooking') {
      return (
        <>
          <Button variant="danger-outline" disabled={busy} onClick={onCancelOrder}>
            <Ban size={15} aria-hidden="true" />注文をキャンセル
          </Button>
          <span className={styles.spacer} />
          <Button onClick={onClose} disabled={busy}>閉じる</Button>
          <Button variant="primary" busy={busy} busyLabel="変更中…" onClick={onReady}>
            準備完了
          </Button>
        </>
      )
    }
    return <Button onClick={onClose}>閉じる</Button>
  })()

  return (
    <RsDialog
      open={open}
      title="注文の詳細"
      width={DETAIL_WIDTH}
      top={DETAIL_TOP}
      busy={busy}
      designNode="hjdqV"
      onCancel={onClose}
      actions={actions}
    >
      {loading && !order ? (
        <ListState kind="loading" title="注文を読み込んでいます" />
      ) : null}
      {error && !order ? (
        <ListState
          kind="error"
          title="注文を表示できませんでした"
          description={error}
          onRetry={onRetry}
        />
      ) : null}
      {order ? (
        <>
          {summaryLine ? <p className={styles.muted}>{summaryLine}</p> : null}

          <div className={styles.detailHead}>
            <span className={styles.orderNumber}>#{order.orderNumber || DASH}</span>
            <StatusBadge tone="neutral" size="compact">{serviceLabel}</StatusBadge>
            <StatusBadge tone={STATUS_TONES[order.status]} size="compact">
              {order.statusLabel || DASH}
            </StatusBadge>
            <StatusBadge tone={URGENCY_TONES[order.urgency]} size="compact">
              {urgencyLabel(order.urgency)}
            </StatusBadge>
          </div>

          {urgencyTone && order.urgencyReason ? (
            <Notice
              tone={urgencyTone}
              density="compact"
              {...(order.urgency === 'urgent' ? { heading: '急ぎ対応のおすすめ' } : {})}
            >
              {order.urgencyReason}
            </Notice>
          ) : null}

          <DialogField label="注文内容">
            <ul className={styles.itemList}>
              {items.length === 0 ? (
                <li className={styles.itemRow}>
                  <span className={styles.itemName}>内容を読み取れませんでした</span>
                </li>
              ) : (
                items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className={styles.itemRow}>
                    <span className={styles.itemName}>
                      {item.name || DASH}
                      {item.note ? <span className={styles.itemNote}>{item.note}</span> : null}
                    </span>
                    <span className={styles.itemQty}>×{item.quantity}</span>
                    <span className={styles.itemAmount}>{formatYen(item.amount)}</span>
                  </li>
                ))
              )}
            </ul>
            <div className={styles.total}>
              <span className={styles.itemName}>合計（税込）</span>
              <span className={styles.itemAmount}>{formatYen(order.totalAmount)}</span>
            </div>
          </DialogField>

          <DialogField label="受け取り情報">
            <dl className={styles.detailFacts}>
              <Fact label="受け取り方法">{order.pickupMethod || DASH}</Fact>
              <Fact label="希望時刻">{formatShortStamp(order.wantedAt)}</Fact>
              {order.acceptedAt ? (
                <Fact label="受付">{formatShortStamp(order.acceptedAt)}</Fact>
              ) : null}
              {order.readyAt ? (
                <Fact label="準備完了">{formatShortStamp(order.readyAt)}</Fact>
              ) : null}
              {order.handedOverAt ? (
                <Fact label="受け渡し">{formatShortStamp(order.handedOverAt)}</Fact>
              ) : null}
              {order.canceledAt ? (
                <Fact label="キャンセル">{formatShortStamp(order.canceledAt)}</Fact>
              ) : null}
              <Fact label="お客様の備考">{order.customerNote || DASH}</Fact>
            </dl>
          </DialogField>

          {error ? <DialogNote>{error}</DialogNote> : null}
        </>
      ) : null}
    </RsDialog>
  )
}

export interface CancelOrderDialogProps {
  open: boolean
  orderNumber: string
  serviceLabel: string
  /** 画面に出す合計金額。取れていないときは `null`。 */
  totalAmount: number | null
  reasonCode: DeliveryCancelReasonCode
  busy: boolean
  error: string | null
  onReasonChange: (code: DeliveryCancelReasonCode) => void
  onClose: () => void
  onSubmit: () => void
}

/** D-3 `dgeTy`。取り消せない操作なので、理由を選んでから送る。 */
export function CancelOrderDialog({
  open,
  orderNumber,
  serviceLabel,
  totalAmount,
  reasonCode,
  busy,
  error,
  onReasonChange,
  onClose,
  onSubmit,
}: CancelOrderDialogProps) {
  /* 絵のとおり「#番号（サービス・金額）をキャンセルします。」の一文にする。 */
  const amount = formatYen(totalAmount)
  const subject = amount === DASH
    ? `#${orderNumber || DASH}（${serviceLabel}）`
    : `#${orderNumber || DASH}（${serviceLabel}・${amount}）`

  return (
    <RsDialog
      open={open}
      title="この注文をキャンセルしますか？"
      width={CANCEL_WIDTH}
      top={CANCEL_TOP}
      tone="destructive"
      busy={busy}
      designNode="dgeTy"
      onCancel={onClose}
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>← 戻る</Button>
          <Button variant="danger" busy={busy} busyLabel="送信中…" onClick={onSubmit}>
            <Ban size={15} aria-hidden="true" />キャンセルする
          </Button>
        </>
      )}
    >
      <p className={styles.factValue}>
        {subject}をキャンセルします。{serviceLabel}側のお客様にも通知され、この操作は取り消せません。
      </p>
      <DialogField label="キャンセルの理由" kind="select">
        <Select
          aria-label="キャンセルの理由"
          size="full"
          value={reasonCode}
          onChange={(value) => onReasonChange(value as DeliveryCancelReasonCode)}
          options={CANCEL_REASON_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </DialogField>
      <DialogNote>
        選んだ理由はサービスへ送る区分としてだけ使われます。
      </DialogNote>
      {error ? <DialogNote>{error}</DialogNote> : null}
    </RsDialog>
  )
}
