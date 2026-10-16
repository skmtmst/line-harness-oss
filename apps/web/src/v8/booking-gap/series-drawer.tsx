'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarX2 } from 'lucide-react'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import HelpTip from '@/components/shared/help-tip'
import SegmentedControl from '@/components/shared/segmented'
import Toggle from '@/components/shared/toggle'
import { TextField } from '@/components/shared/text-field'
import { Skeleton } from '@/components/shared/skeleton'
import { notifySaved } from '@/components/shared/toast'
import { bookingSeriesApi, type SeriesFreq, type SeriesOccurrence } from '@/lib/api-gap2'
import { createdCount, dayOf, dayWithWeekday, FREQ_OPTIONS, hm, initialPick, ruleLabel, weekdayOf, type Pick } from './series-model'
import styles from './series-drawer.module.css'

export type SeriesDrawerSummary = {
  customerName: string
  friendId: string
  menuId: string
  menuName: string
  durationMin: number
  staffId: string | null
  staffName: string
  startsAt: string
  endsAt: string
}

const MIN = 2
const MAX = 52

/*
 * 予約管理 › 予約を入れる（引き出し）の「繰り返す」段（B4-1・Oo8mZ）。
 * 保存の前に必ず「取れない回」を見せ、回ごとに［別の時間］［飛ばす］を選ばせる。取れない回を黙って作らない。
 * 保存は全部か無し：その間に埋まった回があれば何も作らず、表を出し直す（B4-03）。動きは BEHAVIOR.md。
 */
export default function SeriesBookingDrawer({ open, accountId, summary, onClose, onCreated }: {
  open: boolean
  accountId: string
  summary: SeriesDrawerSummary
  onClose: () => void
  onCreated: (result: { seriesId: string; created: number }) => void
}) {
  const [on, setOn] = useState(true)
  const [freq, setFreq] = useState<SeriesFreq>('weekly')
  const [countText, setCountText] = useState('8')
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [list, setList] = useState<SeriesOccurrence[]>([])
  const [unreadable, setUnreadable] = useState(false)
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const key = useRef(crypto.randomUUID())

  const count = /^\d+$/.test(countText) ? Number(countText) : NaN
  const countOk = Number.isInteger(count) && count >= MIN && count <= MAX

  useEffect(() => {
    if (!open) return
    setOn(true); setFreq('weekly'); setCountText('8'); setPicks({}); setConflict(false); setError(''); key.current = crypto.randomUUID()
  }, [open])

  /* 確かめ直す：入力が止まってから。古い返事は捨てる。 */
  useEffect(() => {
    if (!open || !on || !countOk) { setState('idle'); setList([]); return }
    let current = true
    setState('loading')
    const timer = setTimeout(() => {
      void bookingSeriesApi.preview(accountId, {
        menuId: summary.menuId,
        staffId: summary.staffId,
        startsAt: summary.startsAt,
        rule: { freq, weekday: weekdayOf(summary.startsAt), time: hm(summary.startsAt), count },
      }).then((res) => {
        if (!current) return
        setList(res.data.occurrences)
        setUnreadable(Boolean(res.data.unreadable))
        setPicks(Object.fromEntries(res.data.occurrences.map((o) => [o.index, initialPick(o)])))
        setState('ready')
      }).catch(() => { if (current) setState('error') })
    }, 250)
    return () => { current = false; clearTimeout(timer) }
  }, [open, on, countOk, count, freq, accountId, summary.menuId, summary.staffId, summary.startsAt, retry])

  const blocked = useMemo(() => list.filter((o) => !o.available), [list])
  const made = createdCount(list, picks)
  const skipped = list.filter((o) => !o.available && (picks[o.index] ?? 'skip') === 'skip')
  const canSave = !on ? false : state === 'ready' && made > 0 && !busy

  async function save() {
    if (!canSave) return
    setBusy(true); setError(''); setConflict(false)
    try {
      const res = await bookingSeriesApi.create(accountId, {
        menuId: summary.menuId, staffId: summary.staffId, friendId: summary.friendId, startsAt: summary.startsAt,
        rule: { freq, weekday: weekdayOf(summary.startsAt), time: hm(summary.startsAt), count },
        choices: list.map((o) => {
          const pick = picks[o.index] ?? 'skip'
          return pick === 'alternative' && o.alternatives[0] ? { index: o.index, action: 'alternative' as const, alternativeStartsAt: o.alternatives[0] } : { index: o.index, action: pick === 'skip' ? 'skip' as const : 'keep' as const }
        }),
      }, key.current)
      if ('conflicts' in res) { setConflict(true); setRetry((n) => n + 1); return }
      notifySaved(`${res.data.created} 件の予約を入れました`)
      onCreated({ seriesId: res.data.seriesId, created: res.data.created })
    } catch {
      setError('予約を入れられませんでした。もう一度お試しください。')
    } finally { setBusy(false) }
  }

  const last = list.length ? list[list.length - 1].startsAt : summary.startsAt

  return (
    <Drawer
      open={open}
      title="予約を入れる"
      description={`${summary.customerName} さん ・ ${summary.menuName} ${summary.durationMin} 分`}
      closeAppearance="box"
      width="editor"
      busy={busy}
      error={error || undefined}
      dirty={on && state !== 'idle'}
      showDirtyIndicator={false}
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>キャンセル</Button>
        <Button variant="primary" onClick={save} busy={busy} disabled={!canSave} busyLabel="入れています…">{on ? `${made} 件を入れる` : '予約を入れる'}</Button>
      </>}
    >
      <div className={styles.body}>
        <dl className={styles.summary}>
          <div><dt>日時</dt><dd>{dayWithWeekday(summary.startsAt)} {hm(summary.startsAt)}〜{hm(summary.endsAt)}</dd></div>
          <div><dt>担当</dt><dd>{summary.staffName}</dd></div>
        </dl>
        <section className={styles.card} aria-label="繰り返す">
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>繰り返す<HelpTip label="繰り返すの説明">毎週・隔週・毎月の同じ曜日・同じ時間で、まとめて予約を入れます。取れない回は保存の前に表で選びます。</HelpTip></h3>
            <Toggle label="繰り返す" checked={on} onChange={setOn} />
          </div>
          {on ? <>
            <div className={styles.controls}>
              <SegmentedControl aria-label="繰り返しの間隔" size="booking" options={FREQ_OPTIONS} value={freq} onChange={setFreq} />
              <label className={styles.count}>
                <span>回数</span>
                <TextField value={countText} onChange={(event) => setCountText(event.target.value)} inputMode="numeric" aria-label="回数" invalid={countText !== '' && !countOk} />
              </label>
            </div>
            {!countOk ? <p className={styles.fieldError} role="alert">回数は {MIN} 回から {MAX} 回までです。</p> : null}
            {countOk && state !== 'idle' ? <p className={styles.range}>{dayOf(summary.startsAt)} から {state === 'ready' ? dayOf(last) : '…'} まで、{ruleLabel(freq, summary.startsAt)}（{count} 回）</p> : null}
            {state === 'loading' ? <div className={styles.loading} aria-busy="true"><Skeleton height={48} /></div> : null}
            {state === 'error' ? <p className={styles.fieldError} role="alert">空きを確かめられませんでした。<Button variant="text" onClick={() => setRetry((n) => n + 1)}>もう一度</Button></p> : null}
            {state === 'ready' && unreadable ? <p className={styles.range}>空きを確かめられない回があります。その回は作りません。</p> : null}
            {state === 'ready' && conflict ? <p className={styles.fieldError} role="alert">その間に埋まった回があります。表を確かめ直してください。</p> : null}
            {state === 'ready' && blocked.length === 0 && !unreadable ? <p className={styles.allOk}>{list.length} 回すべて取れます</p> : null}
            {state === 'ready' && blocked.length > 0 ? <>
              <span className={styles.badge}><CalendarX2 aria-hidden="true" size={14} />取れない回 {blocked.length} 件</span>
              <table className={styles.table}>
                <thead><tr><th>日</th><th>理由</th><th>どうするか</th></tr></thead>
                <tbody>
                  {blocked.map((o) => {
                    const alt = o.alternatives[0]
                    const pick = picks[o.index] ?? 'skip'
                    return (
                      <tr key={o.index}>
                        <td>{dayWithWeekday(o.startsAt)}</td>
                        <td><span>{o.reason}</span><span className={alt ? styles.alt : styles.sub}>{alt ? `→ ${hm(alt)} にする` : 'この回は作りません'}</span></td>
                        <td>
                          <SegmentedControl aria-label={`${dayOf(o.startsAt)} の回`} size="compact" value={pick === 'skip' || !alt ? 'skip' : 'alternative'}
                            options={[{ value: 'alternative', label: '別の時間' }, { value: 'skip', label: '飛ばす' }]}
                            onChange={(next) => { if (next === 'alternative' && !alt) return; setPicks((p) => ({ ...p, [o.index]: next })) }} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </> : null}
          </> : null}
        </section>
        {on && state === 'ready' ? <p className={styles.note}>{list.length} 回のうち {made} 件を入れます{skipped.length ? `（${skipped.map((o) => dayOf(o.startsAt)).join('・')} は飛ばす）` : ''}。保存の直前に空きを確かめ直します。</p> : null}
      </div>
    </Drawer>
  )
}
