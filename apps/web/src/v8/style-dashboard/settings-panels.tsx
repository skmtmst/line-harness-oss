'use client'
import { ArrowDown, ArrowUp, Info, Lock, RotateCcw, Scissors, CalendarX2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import Dialog from '@/components/shared/dialog'
import Drawer from '@/components/shared/drawer'
import FilterChip from '@/components/shared/filter-chip'
import { Field } from '@/components/shared/form-controls'
import HelpTip from '@/components/shared/help-tip'
import IconButton from '@/components/shared/icon-button'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import TimeFieldV8 from '@/components/shared/time-field-v8'
import Toggle from '@/components/shared/toggle'
import type { StyleClosureInput, StyleLayout, StyleLayoutItem } from './model'
import styles from './style-dashboard.module.css'

/*
 * ［表示を変える］の引き出し（wFmQa・B-294 追記 7・8・B-309 の 7）：
 * 数の帯（5 つまで）と横のカードの出し入れ・上下の入れ替え・型に戻す・カードを足す。
 * 接続の異常の帯は隠せない（必ず出る）。
 */
export function ViewDrawer({ open, layout, busy, onClose, onSave, onReset }: {
  open: boolean
  layout: StyleLayout | null
  busy: boolean
  onClose: () => void
  onSave: (next: StyleLayoutItem[]) => void
  onReset: () => void
}) {
  const [cards, setCards] = useState<StyleLayoutItem[]>([])
  useEffect(() => { if (open && layout) setCards(layout.cards) }, [open, layout])
  const dirty = Boolean(layout) && JSON.stringify(cards) !== JSON.stringify(layout?.cards)
  const move = (index: number, step: -1 | 1) => setCards((list) => { const next = [...list]; const [item] = next.splice(index, 1); next.splice(index + step, 0, item); return next })
  const shown = cards.filter((c) => !c.locked)
  return (
    <Drawer open={open} title="表示を変える" titleAccessory={<HelpTip label="表示を変えるの説明">ダッシュボードに出すカードを選び、上下を入れ替えます。業種の型は初期の組みです。いつでも型に戻せます。</HelpTip>} closeAppearance="box" dirty={dirty} busy={busy} onClose={onClose}
      footer={<div className={styles.drawerFoot}><Button onClick={onClose}>キャンセル</Button><Button variant="primary" busy={busy} busyLabel="保存しています" disabled={!dirty} onClick={() => onSave(cards)}>保存する</Button></div>}>
      {layout ? (
        <div className={styles.drawerBody}>
          <div className={styles.drawerBase}>
            <Scissors size={16} aria-hidden="true" />
            <span className={styles.drawerBaseText}><strong>いまの型：{layout.base}</strong><span className={styles.cellMuted}>{layout.changed}か所を変えています</span></span>
            <span className={styles.grow} />
            <Button size="compact" onClick={onReset} disabled={busy}><RotateCcw size={16} aria-hidden="true" />型に戻す</Button>
          </div>
          <section className={styles.drawerSection} aria-label="カード">
            <div className={styles.drawerSectionHead}><h3>カード</h3><HelpTip label="カードの説明">ダッシュボードのタブとカードです。上下だけ入れ替えられます。</HelpTip><span className={styles.grow} /><span className={styles.cellMuted}>上下だけ入れ替え</span></div>
            {shown.map((item) => {
              const i = cards.indexOf(item)
              return (
                <div key={item.id} className={styles.drawerRow}>
                  <Toggle checked={item.on} label={item.label} onChange={(on) => setCards((list) => list.map((x) => (x.id === item.id ? { ...x, on } : x)))} />
                  <span className={styles.drawerLabel}>{item.label}</span>
                  <span className={styles.grow} />
                  <IconButton size="row" aria-label={`${item.label}を上へ`} disabled={i <= 0 || cards[i - 1]?.locked} onClick={() => move(i, -1)}><ArrowUp size={16} /></IconButton>
                  <IconButton size="row" aria-label={`${item.label}を下へ`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></IconButton>
                </div>
              )
            })}
          </section>
          {cards.filter((c) => c.locked).map((c) => (
            <div key={c.id} className={styles.drawerLocked}><Lock size={16} aria-hidden="true" /><span className={styles.drawerBaseText}><strong>{c.label}</strong><span className={styles.cellMuted}>異常・知らせがある時だけ必ず出ます（隠せません）</span></span></div>
          ))}
        </div>
      ) : null}
    </Drawer>
  )
}

/*
 * ［休みを入れる］の窓（wXOm6・B-309 の 4・飲食店の臨時休業と同じ決まり）。
 * 日付・時間帯（終日／時間を決める）・対象（店全体／担当者／卓）・理由（お客さまには出さない）。
 * 既存の予約は取り消さず、連絡は次の画面で選ぶ。
 */
export function ClosureDialog({ open, date, targets, seatNoun, busy, error, affectedNote, onClose, onSave }: {
  open: boolean
  date: string
  targets: { staff: { id: string; name: string }[]; seats: { id: string; name: string }[] }
  seatNoun: '卓' | '担当者' | '講師'
  busy: boolean
  error?: string
  affectedNote?: string | null
  onClose: () => void
  onSave: (input: StyleClosureInput) => void
}) {
  const [day, setDay] = useState(date)
  const [allDay, setAllDay] = useState<'all' | 'time'>('time')
  const [from, setFrom] = useState('19:00')
  const [to, setTo] = useState('22:00')
  const [target, setTarget] = useState<StyleClosureInput['target']>(seatNoun === '卓' ? 'seat' : 'staff')
  const [ids, setIds] = useState<string[]>([])
  const [reason, setReason] = useState('貸切')
  useEffect(() => { if (open) setDay(date) }, [open, date])
  const choices = target === 'seat' ? targets.seats : target === 'staff' ? targets.staff : []
  useEffect(() => { if (open) setIds(choices[0] ? [choices[0].id] : []) }, [open, target]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} title="休みを入れる" designWidth={480} titleHelp={<HelpTip label="休みを入れるの説明">臨時休業・貸切・急な休みを入れます。入れた時間は予約を受け付けません。</HelpTip>} busy={busy} error={error} confirmLabel="休みを入れる" confirmIcon={<CalendarX2 size={16} aria-hidden="true" />} busyLabel="入れています" onCancel={onClose} footerAlign="center"
      confirmDisabled={target !== 'store' && ids.length === 0} confirmDisabledReason="対象を選んでください" dirty={false}
      onConfirm={() => onSave({ date: day, allDay: allDay === 'all', from: allDay === 'time' ? from : undefined, to: allDay === 'time' ? to : undefined, target, ids: target === 'store' ? [] : ids, reason })}>
      <div className={styles.dialogBody}>
        <Field label="日付"><DateField value={day} onChange={setDay} displayFormat="full" /></Field>
        <Field label="時間帯">
          <div className={styles.dialogInline}>
            <SegmentedControl aria-label="時間帯" appearance="choices" value={allDay} onChange={setAllDay} options={[{ value: 'all', label: '終日' }, { value: 'time', label: '時間を決める' }]} />
            {allDay === 'time' ? <><TimeFieldV8 aria-label="始まり" value={from} onChange={setFrom} minuteStep={30} /><span aria-hidden="true">〜</span><TimeFieldV8 aria-label="終わり" value={to} onChange={setTo} minuteStep={30} allowEndOfDay /></> : null}
          </div>
        </Field>
        <Field label="対象">
          <SegmentedControl aria-label="対象" appearance="choices" value={target} onChange={setTarget} options={[{ value: 'store', label: '店全体' }, { value: 'staff', label: '担当者' }, ...(seatNoun === '卓' ? [{ value: 'seat' as const, label: '卓' }] : [])]} />
          {choices.length ? (
            <div className={styles.chipRow}>
              {choices.map((c) => <FilterChip key={c.id} selected={ids.includes(c.id)} onChange={(on: boolean) => setIds((now) => (on ? [...now, c.id] : now.filter((x) => x !== c.id)))}>{c.name}</FilterChip>)}
            </div>
          ) : null}
        </Field>
        <Field label="理由（お客さまには出ません）">
          <Select size="full" aria-label="理由" value={reason} onChange={(v: string) => setReason(v)} options={['貸切', '臨時休業', '急な休み', '研修', 'そのほか'].map((v) => ({ value: v, label: v }))} />
        </Field>
        {affectedNote ? <p className={styles.dialogNote}><Info size={16} aria-hidden="true" />{affectedNote}</p> : null}
      </div>
    </Dialog>
  )
}
