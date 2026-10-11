'use client'

/*
 * ★V8 デリバリー受注・注文の詳細（窓 `hjdqV`）とキャンセルの確認（窓 `dgeTy`）。
 *
 * 画面は受け取った内容を出すだけにする。送信は親（delivery.tsx）が持つ。
 * 急ぎ度の判定はWorker側だけで行い、ここには結果と理由の文しか来ない（仕組みの名前は出さない）。
 * 窓の頭は絵のとおり「注文の詳細」で固定し、注文番号は中の段へ置く
 * （番号を頭に入れると長さで頭が崩れるため）。
 * キャンセルは取り消せないので、別の窓で理由を選んでから送る。自由文は扱わず符号だけを送る。
 * キャンセルの窓の頭は絵のとおり白地で、題の左に赤い丸の注意三角を置く（桃色の帯で囲まない）。
 */

import { AlertTriangle, Ban, Check, X } from 'lucide-react'
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
  SERVICE_TONES,
  formatClock,
  formatOrderNumber,
  formatShortStamp,
  formatYen,
} from './format'
import { UrgencyBadge } from './orders'
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

/* 急ぎ度の帯。「ふつう」は帯を出さない（札だけで足りる）。 */
const URGENCY_NOTICE_TONES: Record<DeliveryUrgency, NoticeTone | null> = {
  urgent: 'danger',
  watch: 'warn',
  normal: null,
}

/*
 * 窓の寸法（絵のとおり）。詳細は中身が多いので上に寄せる。
 * 絵（hjdqV）は窓が y100〜710（高さ 610）で、題の段が 77
 * （上 20＋題 27＋間 4＋補足 18＋下 8）。中身は y177 から始まる。
 */
const DETAIL_WIDTH = 560
const DETAIL_TOP = 100
const DETAIL_HEAD_H = 77
/*
 * 中身の余白。共通の中身（RsDialog の .dialogBody）は上に -14 引いてから 14 の間で並べるので、
 * 1つめの段は「題の段のあと＋この上の余白－14」に来る。
 * 2026-10-10 に 1440 で測ったら、12 では番号の段が y175（絵 179）・「注文内容」が y302（絵 305）
 * と上にずれていた。共通の注意書き（Notice）の高さが絵より 5 低いぶんを 15 で吸収する。
 * 下は絵のボタンの下 20（y690→710）。
 */
const DETAIL_CONTENT_PAD = '15px 24px 20px'
/* 絵のボタンの段に上の線は無く、1つ上の段からの間は 14（y626→654 のうち段の間 14＋14）。 */
const DETAIL_FOOT_GAP = 14
/*
 * キャンセルの確認（dgeTy）。上からの位置は絵のとおり 330。
 * 幅は絵が 460 だが、窓の幅は正本で 480／560／720／960 の4段に決まっている
 * （docs/v8-design-rules.md §8・B-177 の `DIALOG_WIDTHS`）。460 は4段に無いので
 * 共通部品の `dialogWidth()` が 480 へ寄せる。暗に寄せられるのに任せず、
 * 実際に出る 480 をここに書く。中身は真ん中に並ぶので絵より左右 10 内へ入る
 * （この差は「絵と正本の食い違いを正本で解いた分」として記録する）。
 */
const CANCEL_WIDTH = 480
const CANCEL_TOP = 330
/*
 * 絵（dgeTy）の段の間。絵は段ごとに下の余白を持つので、
 * 一文の下 4＋欄の上 8＝12 を段の間に、欄の下 8＋ボタンの上 14＝22 のうち
 * 12 を段の間に、残り 10 をボタンの段の上の間にする。
 */
const CANCEL_BODY_GAP = 12
const CANCEL_FOOT_GAP = 10
/** 絵（dgeTy `i3pvl`→選ぶ欄）の題と中身の間は 6。共通の欄の `contentGap` で渡す。 */
const CANCEL_FIELD_GAP = 6

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
   *
   * 足のボタンは絵（hjdqV）の余白14・印15・間6に合わせる。板の頭（kDQHr）と同じ値なので
   * 共通のボタンの `size="delivery-head"` を渡す（画面CSSから共通部品を上書きしない）。
   */
  const actions = (() => {
    if (!order || !canManage) {
      return <Button size="delivery-head" onClick={onClose}>閉じる</Button>
    }
    if (order.status === 'new') {
      return (
        <>
          <Button size="delivery-head" variant="danger-outline" disabled={busy} onClick={onCancelOrder}>
            <Ban size={15} aria-hidden="true" />キャンセル
          </Button>
          <span className={styles.spacer} />
          <Button size="delivery-head" disabled={busy} onClick={onReject}>
            <X size={15} aria-hidden="true" />拒否する
          </Button>
          {/* 絵（hjdqV）の足は幅114。結果の文字の分は控えないよう共通の任意引数で頼む。 */}
          <Button size="delivery-head" variant="primary" busy={busy} busyLabel="受付中…" widthReserve="idle" onClick={onAccept}>
            <Check size={15} aria-hidden="true" />受け付ける
          </Button>
        </>
      )
    }
    if (order.status === 'cooking') {
      return (
        <>
          <Button size="delivery-head" variant="danger-outline" disabled={busy} onClick={onCancelOrder}>
            <Ban size={15} aria-hidden="true" />注文をキャンセル
          </Button>
          <span className={styles.spacer} />
          <Button size="delivery-head" onClick={onClose} disabled={busy}>閉じる</Button>
          <Button size="delivery-head" variant="primary" busy={busy} busyLabel="変更中…" widthReserve="idle" onClick={onReady}>
            準備完了
          </Button>
        </>
      )
    }
    return <Button size="delivery-head" onClick={onClose}>閉じる</Button>
  })()

  return (
    <RsDialog
      open={open}
      title="注文の詳細"
      /* 絵の頭は題＋「12:02 受信・受け取り希望 12:15」の1行。共通の窓の任意の引数で出す。 */
      titleNote={summaryLine}
      width={DETAIL_WIDTH}
      top={DETAIL_TOP}
      headerHeight={DETAIL_HEAD_H}
      contentPadding={DETAIL_CONTENT_PAD}
      footerPlain
      footerGap={DETAIL_FOOT_GAP}
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
          <div className={styles.detailHead}>
            <span className={styles.orderNumber}>{formatOrderNumber(order.orderNumber)}</span>
            {/*
              * 絵（hjdqV）を 1440 で測った結果（2026-10-11）：サービス札は点なし、状態札は点あり、
              * 急ぎ札は点ではなく12pxの印＋字（一覧 kDQHr と同じ形）。印の札は一覧と共用する。
              */}
            <StatusBadge tone={SERVICE_TONES[order.service]} size="delivery" dot={false}>{serviceLabel}</StatusBadge>
            <StatusBadge tone={STATUS_TONES[order.status]} size="delivery">
              {order.statusLabel || DASH}
            </StatusBadge>
            <UrgencyBadge urgency={order.urgency} />
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

          {/* 絵の「注文内容」「受け取り情報」の題は 12/600（共通の窓の選ぶ欄の題と同じ形）。
            * 絵には「任意」の札がない（読むだけの見出しで入力欄ではない）。共通の欄の任意の引数
            * optional={false} で消す。画面CSSで隠さない。
            *
            * 題と中身の間は絵のとおり（題の行 20 を引いて「注文内容」8・「受け取り情報」5）。
            * 共通の 14 とは違うので共通の欄の任意の引数 contentGap で渡す。画面CSSで足さない。 */}
          <DialogField label="注文内容" kind="select" optional={false} contentGap={8}>
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

          <DialogField label="受け取り情報" kind="select" optional={false} contentGap={5}>
            <dl className={styles.detailFacts}>
              <Fact label="受け取り方法">{order.pickupMethod || DASH}</Fact>
              {/* 絵（hjdqV）は同じ日の受け取りなので時刻だけを出す。 */}
              <Fact label="希望時刻">{formatClock(order.wantedAt)}</Fact>
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
  const number = formatOrderNumber(orderNumber)
  const subject = amount === DASH
    ? `${number}（${serviceLabel}）`
    : `${number}（${serviceLabel}・${amount}）`

  return (
    <RsDialog
      open={open}
      title="この注文をキャンセルしますか？"
      width={CANCEL_WIDTH}
      top={CANCEL_TOP}
      tone="destructive"
      busy={busy}
      designNode="dgeTy"
      /* 絵の頭は白地＋注意三角。帯で囲まず、題の左に丸い印を置く。 */
      titleIcon={(
        <span className={styles.warnMark}>
          <AlertTriangle size={18} aria-hidden="true" />
        </span>
      )}
      titleRow="mark"
      plainTitle
      contentPadding="18px 24px 20px"
      /* 絵は段ごとに下の余白を持つ。一文のあと 12（4＋8）、欄のあと 22（8＋14）。 */
      bodyGap={CANCEL_BODY_GAP}
      footerPlain
      footerGap={CANCEL_FOOT_GAP}
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
      <p className={styles.dialogLead}>
        {subject}をキャンセルします。{serviceLabel}側のお客様にも通知され、この操作は取り消せません。
      </p>
      {/* 絵（dgeTy）の題に「任意」の札はない。理由は必ず選ばれている（既定あり）ので共通の
        * 欄の任意の引数で消す。 */}
      <DialogField label="キャンセルの理由" kind="select" optional={false} contentGap={CANCEL_FIELD_GAP}>
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
      {error ? <DialogNote>{error}</DialogNote> : null}
    </RsDialog>
  )
}
