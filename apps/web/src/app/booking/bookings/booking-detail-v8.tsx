import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import { bookingApi, type BookingAdminDetail, type BookingRequest } from '@/lib/api'
import { formatDateTime, formatNumber, formatTime } from '@/lib/format'

/*
 * ★V8-B 予約の詳細（`AjZhH`）。台帳の行から開く小窓。
 * 中身は引き出し（`TnDbq`）と同じ予約。差し替えるのは見た目だけ。
 * 卓・人数・アレルギーは予約のデータに無いので出さない。
 * v7 の引き出しは残し、`data-theme="v8"` のときだけ使う。
 */

/** 予約経路の言葉。台帳の絞り込み（`SOURCE_FILTERS`）と同じ語彙。 */
const SOURCE_LABEL: Record<string, string> = {
  liff: 'LINE',
  phone: '電話',
  counter: '店頭',
  operator: 'スタッフ入力',
  import: '取り込み',
}

/** 不正な日時が来たら Invalid Date を出さず「—」に逃がす。 */
function safeDateTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return formatDateTime(iso)
}

function safeTime(iso: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return '—'
  return formatTime(iso)
}

export default function BookingDetailV8({
  booking: b,
  accountId,
  canOperate,
  onClose,
  onCancel,
  detailHref,
}: {
  booking: BookingRequest
  accountId: string | null
  /** N-401: 閲覧のみの人には変更・取消の入口を出さない。 */
  canOperate: boolean
  onClose: () => void
  onCancel: () => void
  detailHref: string
}) {
  const [historyTotal, setHistoryTotal] = useState<number | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const [historySeq, setHistorySeq] = useState(0)
  const name = b.friend_name ?? 'お客様'

  useEffect(() => {
    if (!accountId) return
    let active = true
    setHistoryError(false)
    void bookingApi
      .getBooking(accountId, b.id)
      .then((response: { booking: BookingAdminDetail }) => {
        if (active) setHistoryTotal(response.booking.historyTotal)
      })
      .catch(() => {
        if (active) setHistoryError(true)
      })
    return () => {
      active = false
    }
  }, [accountId, b.id, historySeq])

  return (
    <Dialog
      open
      designNode="AjZhH"
      title={`${name}さん`}
      onCancel={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
          {canOperate ? (
            <>
              <Button variant="secondary" onClick={onCancel}>
                取り消す
              </Button>
              <Button variant="primary" href={detailHref}>
                変更する
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-ink-faint text-xs">日時</dt>
          <dd className="text-ink mt-0.5">
            {safeDateTime(b.starts_at)}〜{safeTime(b.ends_at)} ・ 担当 {b.staff_name}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint text-xs">メニュー</dt>
          <dd className="text-ink mt-0.5">
            {b.menu_name} <span className="tabular-nums">¥{formatNumber(b.price_at_booking)}</span> ・
            {SOURCE_LABEL[b.source] ?? b.source}から
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint text-xs">これまでの来店</dt>
          <dd className="text-ink mt-0.5" aria-busy={historyTotal === null && !historyError}>
            {historyError ? (
              <>
                来店履歴を読み込めませんでした
                <button type="button" onClick={() => setHistorySeq((n) => n + 1)} className="text-action ml-2 font-medium underline">
                  もう一度読み込む
                </button>
              </>
            ) : (
              <DelayedSkeleton loading={historyTotal === null} skeleton={<Skeleton width={48} />}>
                {historyTotal === null ? null : `${historyTotal}回`}
              </DelayedSkeleton>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint text-xs">お客様からのご希望</dt>
          <dd className="text-ink mt-0.5">{b.customer_note ?? '記入なし'}</dd>
        </div>
      </dl>
    </Dialog>
  )
}
