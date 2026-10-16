'use client'

import { useEffect, useState } from 'react'
import Dialog from '@/components/shared/dialog'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { notifySaved } from '@/components/shared/toast'
import Checkbox from '@/components/shared/checkbox'
import { usePreparingDialog } from '@/components/shared/preparing-dialog'
import { bookingSeriesApi } from '@/lib/api-gap2'
import { seriesImpactApi, type SeriesImpactItem } from '@/lib/api-gap2-pending'
import type { Gap2Booking } from '@line-crm/shared'
import { dayOf, dayWithWeekday, hm } from './series-model'
import styles from './series-scope-dialog.module.css'

export type SeriesTarget = {
  seriesId: string
  customerName: string
  /** 「毎週金曜 14:00」。 */
  ruleText: string
  menuName: string
  /** この回（4 回目）。 */
  index: number
  bookingId: string
  startsAt: string
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/*
 * 繰り返しの予約を変える・取り消す確かめの窓（B4-2・i1NoP と YoXiY）。
 * 「この回だけ」「この回から後ぜんぶ（N 件）」を選ぶと、対象の日の表を中に出す。
 * 口は変えられなかった回（conflicts）を前のまま残して返すので、その件数は結果の知らせに出す。
 * キャンセル料は口が取り消しの結果で返す（事前の見込みの口は無い）ので、結果の知らせで金額を出す。
 */
export default function SeriesScopeDialog({ open, mode, accountId, target, newStartsAt, onClose, onDone }: {
  open: boolean
  mode: 'change' | 'cancel'
  accountId: string
  target: SeriesTarget
  /** 変えるときの新しい開始（この回）。 */
  newStartsAt?: string
  onClose: () => void
  onDone: (result: { count: number }) => void
}) {
  const [all, setAll] = useState<Gap2Booking[] | null>(null)
  /* 前もっての見込み（埋まっている回・キャンセル料）。口がまだ無い間は読めず、その列は準備中にする。 */
  const [impact, setImpact] = useState<Record<string, SeriesImpactItem> | null>(null)
  const preparing = usePreparingDialog()
  const [version, setVersion] = useState(0)
  const [scope, setScope] = useState<'this' | 'following'>('following')
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => { if (open) { setScope('following'); setError(''); setAll(null) } }, [open])
  useEffect(() => {
    if (!open) return
    let current = true
    setAll(null); setLoadError(false)
    void bookingSeriesApi.get(accountId, target.seriesId)
      .then((res) => {
        if (!current) return
        const from = res.data.bookings.find((b) => b.id === target.bookingId)?.series_index ?? target.index
        setVersion(res.data.series.version)
        void Promise.resolve().then(() => seriesImpactApi.impact(accountId, target.seriesId, { scope: 'following', fromBookingId: target.bookingId, change: newStartsAt ? { startsAt: newStartsAt } : undefined }))
          .then((r) => { if (current) setImpact(Object.fromEntries(r.data.items.map((i) => [i.bookingId, i]))) }).catch(() => { if (current) setImpact(null) })
        setAll(res.data.bookings.filter((b) => (b.series_index ?? 0) >= from && !['cancelled', 'rejected', 'expired'].includes(b.status)).sort((a, b) => (a.series_index ?? 0) - (b.series_index ?? 0)))
      })
      .catch(() => { if (current) setLoadError(true) })
    return () => { current = false }
  }, [open, accountId, target.seriesId, target.bookingId, target.index, retry])
  const items = all ? (scope === 'this' ? all.slice(0, 1) : all) : null

  const changing = mode === 'change'
  const blockedIds = new Set(Object.values(impact ?? {}).filter((i) => i.blocked).map((i) => i.bookingId))
  const count = (items ?? []).filter((i) => !blockedIds.has(i.id)).length
  const last = items?.length ? items[items.length - 1].starts_at : target.startsAt
  const newTime = newStartsAt ? hm(newStartsAt) : ''

  async function run() {
    if (busy || !items || count === 0) return
    setBusy(true); setError('')
    try {
      if (changing && newStartsAt) {
        const res = await bookingSeriesApi.change(accountId, target.seriesId, { scope, fromBookingId: target.bookingId, change: { startsAt: newStartsAt }, expectedVersion: version })
        const { changed, conflicts } = res.data
        notifySaved(conflicts.length ? `${changed.length} 件を変えました（${conflicts.length} 件は埋まっていて前のままです）` : `${changed.length} 件を変えました`)
        onDone({ count: changed.length })
      } else {
        const res = await bookingSeriesApi.cancel(accountId, target.seriesId, { scope, fromBookingId: target.bookingId, expectedVersion: version })
        const fee = res.data.fees.reduce((n, f) => n + f.feeNow, 0)
        notifySaved(fee > 0 ? `${res.data.cancelled.length} 件を取り消しました（キャンセル料の見込み ${yen(fee)}）` : `${res.data.cancelled.length} 件を取り消しました`)
        onDone({ count: res.data.cancelled.length })
      }
    } catch {
      setError(changing ? '変えられませんでした。画面を読み直してからもう一度お試しください。' : '取り消せませんでした。画面を読み直してからもう一度お試しください。')
    } finally { setBusy(false) }
  }

  return (
    <Dialog
      open={open}
      size="medium"
      designWidth={560}
      designTop={170}
      title={changing ? '繰り返しの予約を変えますか？' : '繰り返しの予約を取り消しますか？'}
      description={`${target.customerName} さん ・ ${target.ruleText} ・ ${target.menuName} ・ ${target.index} 回目 ${dayOf(target.startsAt)}`}
      tone={changing ? 'default' : 'destructive'}
      confirmation
      confirmLabel={`${count} 件を${changing ? '変える' : '取り消す'}`}
      busyLabel={changing ? '変えています…' : '取り消しています…'}
      confirmDisabled={!items || count === 0}
      footerAlign="center"
      busy={busy}
      error={error || undefined}
      onConfirm={run}
      onCancel={onClose}
    >
      <div className={styles.body}>
        <RadioCardGroup legend="どこまで" columns={2}>
          <RadioCard name="series-scope" value="this" checked={scope === 'this'} onChange={() => setScope('this')} title="この回だけ"
            note={changing ? `${dayWithWeekday(target.startsAt)}だけ ${newTime} に変える` : `${dayWithWeekday(target.startsAt)}だけ取り消す。${all && all.length > 1 ? `${dayOf(all[all.length - 1].starts_at)} までの ${all.length - 1} 件は続く` : ''}`} />
          <RadioCard name="series-scope" value="following" checked={scope === 'following'} onChange={() => setScope('following')} title={`この回から後ぜんぶ（${all ? all.length : '…'} 件）`}
            note={changing ? `${dayOf(target.startsAt)} から ${dayOf(last)} まで ${newTime} に変える。埋まっている回は前のまま` : `${dayOf(target.startsAt)} から ${dayOf(last)} まで取り消す。繰り返しはここで終わる`} />
        </RadioCardGroup>
        <h3 className={styles.heading}>{changing ? `変わる日（${items?.length ?? '…'} 件）` : `取り消す日（${items?.length ?? '…'} 件）`}</h3>
        {loadError ? <p className={styles.error} role="alert">対象の日を読み込めませんでした。<button type="button" className={styles.retry} onClick={() => setRetry((n) => n + 1)}>もう一度</button></p> : null}
        {!loadError ? <table className={styles.table} aria-busy={!items}>
          <thead><tr><th>日</th><th>{changing ? '前' : '時間'}</th><th>{changing ? '後' : 'キャンセル料'}</th></tr></thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.id} data-blocked={(changing && blockedIds.has(item.id)) || undefined}>
                <td>{dayWithWeekday(item.starts_at)}</td>
                <td>{hm(item.starts_at)}</td>
                <td className={(changing ? blockedIds.has(item.id) : impact?.[item.id]?.fee) ? styles.warn : undefined}>
                  {changing ? (blockedIds.has(item.id) ? `埋まっています・${hm(item.starts_at)} のまま` : newTime)
                    : impact ? (impact[item.id]?.fee ? `${yen(impact[item.id].fee!.amount)}（${impact[item.id].fee!.percent}%・${impact[item.id].fee!.reason}）` : 'かかりません')
                    : <button type="button" className={styles.retry} onClick={() => preparing.open('キャンセル料の前もっての見込み')}>見込みを見る</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table> : null}
        {changing || impact ? null : <p className={styles.note}>取り消すと元に戻せません。キャンセル料は期限を過ぎた回だけに掛かり、取り消しの結果の知らせに見込みの金額が出ます（請求は予約の詳細の「お支払い」から）。</p>}
        <Checkbox checked={false} onCheckedChange={() => preparing.open('LINE でのお知らせ')}>{target.customerName} さんに LINE で知らせる（{changing ? '変わった日と時間' : '取り消した日'}）</Checkbox>
        {preparing.dialog}
      </div>
    </Dialog>
  )
}
