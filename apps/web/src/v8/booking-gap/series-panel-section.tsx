'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import type { BookingSeriesOf } from '@/lib/api-gap2'
import SeriesScopeDialog from './series-scope-dialog'
import { dayWithWeekday, hm } from './series-model'
import styles from './series-panel-section.module.css'

const TIMES = Array.from({ length: 19 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

/*
 * 予約の詳細パネルの段「繰り返し（毎週金曜 14:00・全 8 回）」と回の一覧（B4）。
 * 変える・取り消すは確かめの窓（この回だけ／この回から後ぜんぶ）を通す。閲覧のみの人には操作を出さない。
 */
export default function SeriesPanelSection({ series, accountId, customerName, menuName, bookingId, startsAt, canOperate, onChanged }: {
  series: BookingSeriesOf
  accountId: string
  customerName: string
  menuName: string
  bookingId: string
  startsAt: string
  canOperate: boolean
  onChanged: () => void
}) {
  const [picking, setPicking] = useState(false)
  const [time, setTime] = useState(hm(startsAt))
  const [mode, setMode] = useState<'change' | 'cancel' | null>(null)
  const target = { seriesId: series.seriesId, customerName, ruleText: series.ruleText, menuName, index: series.index, bookingId, startsAt, version: series.version }
  const jstDay = new Date(new Date(startsAt).getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
  const newStartsAt = `${jstDay}T${time}:00+09:00`

  return (
    <section className={styles.card} aria-label="繰り返し">
      <h3 className={styles.title}>繰り返し（{series.ruleText}・全 {series.total} 回）</h3>
      <ol className={styles.list}>
        {series.occurrences.map((o) => (
          <li key={o.bookingId} data-current={o.bookingId === bookingId || undefined}>
            <span>{o.index} 回目</span><span>{dayWithWeekday(o.startsAt)} {hm(o.startsAt)}</span>
            {o.bookingId === bookingId ? <span className={styles.here}>この予約</span> : null}
          </li>
        ))}
      </ol>
      {canOperate ? <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setPicking(true)}>この予約の時間を変える</Button>
        <Button variant="danger-outline" onClick={() => setMode('cancel')}>繰り返しを取り消す</Button>
      </div> : null}
      <Dialog open={picking} size="small" title="新しい時間を選ぶ" description={`${dayWithWeekday(startsAt)} の開始時刻を変えます。次の確かめで、この回だけか後ぜんぶかを選びます。`} confirmLabel="次へ" onConfirm={() => { setPicking(false); setMode('change') }} onCancel={() => setPicking(false)}>
        <Select aria-label="新しい開始時刻" value={time} options={TIMES.map((t) => ({ value: t, label: t }))} onChange={setTime} />
      </Dialog>
      {mode ? <SeriesScopeDialog open mode={mode} accountId={accountId} target={target} newStartsAt={mode === 'change' ? newStartsAt : undefined}
        onClose={() => setMode(null)} onDone={() => { setMode(null); onChanged() }} /> : null}
    </section>
  )
}
