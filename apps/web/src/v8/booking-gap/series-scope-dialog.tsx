'use client'

import { useEffect, useState } from 'react'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { notifySaved } from '@/components/shared/toast'
import { bookingSeriesApi, type SeriesScope, type SeriesScopeImpact } from '@/lib/api-gap2'
import { dayOf, dayWithWeekday, hm } from './series-model'
import styles from './series-scope-dialog.module.css'

export type SeriesTarget = {
  seriesId: string
  customerName: string
  /** 「毎週金曜 14:00」。 */
  ruleText: string
  menuName: string
  /** この回（4 回目）と日。 */
  index: number
  bookingId: string
  startsAt: string
  version: number
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/*
 * 繰り返しの予約を変える・取り消す確かめの窓（B4-2・i1NoP と YoXiY）。
 * 「この回だけ」「この回から後ぜんぶ（N 件）」を選ぶと、影響する日の表（変える：前後／取り消す：キャンセル料）を中に出す。
 * 取れない回は「埋まっています」で前のままにする（黙って一部だけにしない）。
 */
export default function SeriesScopeDialog({ open, mode, accountId, target, newStartsAt, notify = true, onClose, onDone }: {
  open: boolean
  mode: 'change' | 'cancel'
  accountId: string
  target: SeriesTarget
  /** 変えるときの新しい開始（その回）。 */
  newStartsAt?: string
  notify?: boolean
  onClose: () => void
  onDone: (result: { count: number }) => void
}) {
  const [scope, setScope] = useState<SeriesScope>('following')
  const [all, setAll] = useState<SeriesScopeImpact[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [tell, setTell] = useState(notify)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => { if (open) { setScope('following'); setTell(notify); setError(''); setAll(null) } }, [open, notify])
  useEffect(() => {
    if (!open) return
    let current = true
    setAll(null); setLoadError(false)
    /* 「この回から後ぜんぶ」の影響をいつも読み、「この回だけ」は先頭の 1 行を使う（切り替えで読み直さない）。 */
    void bookingSeriesApi.impact(accountId, target.seriesId, { scope: 'following', fromBookingId: target.bookingId, change: newStartsAt ? { startsAt: newStartsAt } : undefined })
      .then((res) => { if (current) setAll(res.data.items) })
      .catch(() => { if (current) setLoadError(true) })
    return () => { current = false }
  }, [open, accountId, target.seriesId, target.bookingId, newStartsAt, retry])
  const items = all ? (scope === 'this' ? all.slice(0, 1) : all) : null

  const changing = mode === 'change'
  const ok = (items ?? []).filter((item) => !item.blocked)
  const count = changing ? ok.length : (items ?? []).length
  const last = items?.length ? items[items.length - 1].startsAt : target.startsAt
  const newTime = newStartsAt ? hm(newStartsAt) : ''
  const feeDay = (items ?? []).find((item) => item.fee)

  async function run() {
    if (busy || !items || count === 0) return
    setBusy(true); setError('')
    try {
      if (changing && newStartsAt) {
        const res = await bookingSeriesApi.change(accountId, target.seriesId, { scope, fromBookingId: target.bookingId, change: { startsAt: newStartsAt }, expectedVersion: target.version, notify: tell })
        notifySaved(`${res.data.changed} 件を変えました`)
        onDone({ count: res.data.changed })
      } else {
        const res = await bookingSeriesApi.cancel(accountId, target.seriesId, { scope, fromBookingId: target.bookingId, notify: tell })
        notifySaved(`${res.data.cancelled} 件を取り消しました`)
        onDone({ count: res.data.cancelled })
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
            note={changing ? `${dayWithWeekday(target.startsAt)}だけ ${newTime} に変える` : `${dayWithWeekday(target.startsAt)}だけ取り消す。${all && all.length > 1 ? `${dayOf(all[all.length - 1].startsAt)} までの ${all.length - 1} 件は続く` : ''}`} />
          <RadioCard name="series-scope" value="following" checked={scope === 'following'} onChange={() => setScope('following')} title={`この回から後ぜんぶ（${all ? all.length : '…'} 件）`}
            note={changing ? `${dayOf(target.startsAt)} から ${dayOf(last)} まで ${newTime} に変える。取れない回は前のまま` : `${dayOf(target.startsAt)} から ${dayOf(last)} まで取り消す。繰り返しはここで終わる`} />
        </RadioCardGroup>
        <h3 className={styles.heading}>{changing ? `変わる日（${items?.length ?? '…'} 件のうち ${items ? ok.length : '…'} 件）` : `取り消す日（${items?.length ?? '…'} 件）`}</h3>
        {loadError ? <p className={styles.error} role="alert">影響する日を読み込めませんでした。<button type="button" className={styles.retry} onClick={() => setRetry((n) => n + 1)}>もう一度</button></p> : null}
        {!loadError ? <table className={styles.table} aria-busy={!items}>
          <thead><tr><th>日</th><th>{changing ? '前' : '時間'}</th><th>{changing ? '後' : 'キャンセル料'}</th></tr></thead>
          <tbody>
            {(items ?? []).map((item) => (
              <tr key={item.bookingId} data-blocked={(changing && item.blocked) || undefined}>
                <td>{dayWithWeekday(item.startsAt)}</td>
                <td>{hm(item.startsAt)}</td>
                <td className={(changing ? item.blocked : item.fee) ? styles.warn : undefined}>
                  {changing ? (item.blocked ? `埋まっています・${hm(item.startsAt)} のまま` : hm(item.after ?? item.startsAt))
                    : item.fee ? `${yen(item.fee.amount)}（${item.fee.percent}%・${item.fee.reason}）` : 'かかりません'}
                </td>
              </tr>
            ))}
          </tbody>
        </table> : null}
        {!changing && feeDay ? <p className={styles.note}>取り消すと元に戻せません。キャンセル料は {dayOf(feeDay.startsAt)} の分だけ見込みに入ります（請求は予約の詳細の「お支払い」から）。</p> : null}
        <Checkbox checked={tell} onCheckedChange={setTell}>{target.customerName} さんに LINE で知らせる（{changing ? '変わった日と時間' : '取り消した日'}）</Checkbox>
      </div>
    </Dialog>
  )
}
