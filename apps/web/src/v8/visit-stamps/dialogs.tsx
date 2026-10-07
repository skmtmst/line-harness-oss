'use client'

/*
 * 来店スタンプ（V8 w4SBbv）の小窓。絵に窓は無いので、共通の Dialog に欄を並べるだけにする。
 * 特典・倍率・初回ボーナス・ランク倍率は「下書き」を変えるだけ（保存は下の帯の［保存する］）。
 * 理由・暗証番号・写真は、その場で口を呼ぶ（呼び出しは画面側）。
 */
import { useEffect, useState } from 'react'
import type { VisitStampMultiplier, VisitStampReward, VisitStampSettings } from '@line-crm/shared'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { WEEKDAYS, minuteLabel } from './display'
import styles from './visit-stamps.module.css'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span className={styles.label}>{label}</span>{children}</label>
}

const toInt = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(/[,，]/g, '')))

export function RewardDialog({ open, reward, onClose, onSave }: {
  open: boolean; reward: VisitStampReward | null; onClose: () => void; onSave: (reward: VisitStampReward) => void
}) {
  const [name, setName] = useState('')
  const [stamps, setStamps] = useState('')
  useEffect(() => { if (open) { setName(reward?.name ?? ''); setStamps(reward ? String(reward.stamps) : '') } }, [open, reward])
  const n = toInt(stamps)
  const error = !name.trim() ? '特典の名前を入れてください。' : !Number.isInteger(n) || n < 1 ? '何個で使えるかを 1 以上の数で入れてください。' : ''
  return (
    <Dialog open={open} title={reward ? '特典を変える' : '特典を足す'} confirmLabel={reward ? '変える' : '足す'} onCancel={onClose}
      onConfirm={() => { if (!error) onSave({ id: reward?.id ?? `reward-${Date.now().toString(36)}`, name: name.trim(), stamps: n }) }}
      error={error && (name || stamps) ? error : undefined}>
      <div className={styles.dialogBody}>
        <Field label="特典の名前"><TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="例：ドリンク 1杯" maxLength={100} /></Field>
        <Field label="何個で使えるか"><TextField value={stamps} onChange={(e) => setStamps(e.target.value)} inputMode="numeric" placeholder="例：5" /></Field>
      </div>
    </Dialog>
  )
}

const MINUTES = Array.from({ length: 48 }, (_, i) => i * 30)
/** 日付欄の値（YYYY-MM-DD）と保存の形（日本時間のその日の 0:00）。to は次の日の 0:00 を持つ。 */
const toIso = (date: string, nextDay = false) => {
  if (!date) return undefined
  const t = Date.parse(`${date}T00:00:00+09:00`) + (nextDay ? 86_400_000 : 0)
  return new Date(t).toISOString()
}
const toDate = (iso: string | undefined, prevDay = false) => {
  if (!iso) return ''
  const d = new Date(Date.parse(iso) + 9 * 3_600_000 - (prevDay ? 86_400_000 : 0))
  return d.toISOString().slice(0, 10)
}

export function MultiplierDialog({ open, multiplier, onClose, onSave }: {
  open: boolean; multiplier: VisitStampMultiplier | null; onClose: () => void; onSave: (m: VisitStampMultiplier) => void
}) {
  const [label, setLabel] = useState('')
  const [rate, setRate] = useState('2')
  const [days, setDays] = useState<number[]>([])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  useEffect(() => {
    if (!open) return
    setLabel(multiplier?.name ?? '')
    setRate(String(multiplier?.multiplier ?? 2)); setDays(multiplier?.weekdays ?? [])
    setStart(multiplier?.startMinute !== undefined ? String(multiplier.startMinute) : '')
    setEnd(multiplier?.endMinute !== undefined ? String(multiplier.endMinute) : '')
    setFrom(toDate(multiplier?.from)); setTo(toDate(multiplier?.to, true))
  }, [open, multiplier])
  const r = Number(rate)
  const error = !Number.isFinite(r) || r < 1 || r > 100 ? '倍率は 1〜100 で入れてください。'
    : (start === '') !== (end === '') ? '時間は始まりと終わりの両方を選んでください。'
      : start !== '' && Number(start) >= Number(end) ? '終わりの時間を始まりより後にしてください。'
        : from && to && from > to ? '期間の終わりを始まりより後にしてください。' : ''
  const timeOptions = [{ value: '', label: '指定なし' }, ...MINUTES.map((m) => ({ value: String(m), label: minuteLabel(m) }))]
  const endOptions = [{ value: '', label: '指定なし' }, ...MINUTES.slice(1).map((m) => ({ value: String(m), label: minuteLabel(m) })), { value: '1440', label: '24:00' }]
  return (
    <Dialog open={open} title={multiplier ? '倍率を変える' : '倍率を足す'} confirmLabel={multiplier ? '変える' : '足す'} onCancel={onClose} error={error || undefined}
      onConfirm={() => {
        if (error) return
        onSave({
          ...(label.trim() ? { name: label.trim() } : {}),
          /* 止めている倍率は、変えても止めたまま。 */
          ...(multiplier?.active === false ? { active: false } : {}),
          multiplier: r,
          ...(days.length ? { weekdays: [...days].sort() } : {}),
          ...(start !== '' ? { startMinute: Number(start), endMinute: Number(end) } : {}),
          ...(from ? { from: toIso(from) } : {}),
          ...(to ? { to: toIso(to, true) } : {}),
        })
      }}>
      <div className={styles.dialogBody}>
        <Field label="名前（任意）"><TextField value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="例：火曜の夕方 2倍デー" /></Field>
        <Field label="倍率"><TextField value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" /></Field>
        <div className={styles.field}>
          <span className={styles.label}>曜日（選ばなければ毎日）</span>
          <div className={styles.weekdays}>
            {WEEKDAYS.map((d, i) => (
              <Checkbox key={d} checked={days.includes(i)} onCheckedChange={(on) => setDays(on ? [...days, i] : days.filter((x) => x !== i))}>{d}</Checkbox>
            ))}
          </div>
        </div>
        <div className={styles.row2}>
          <Field label="時間の始まり"><Select aria-label="時間の始まり" size="full" value={start} onChange={setStart} options={timeOptions} /></Field>
          <Field label="時間の終わり"><Select aria-label="時間の終わり" size="full" value={end} onChange={setEnd} options={endOptions} /></Field>
        </div>
        <div className={styles.row2}>
          <Field label="期間の始まり（任意）"><TextField type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="期間の終わり（任意）"><TextField type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  )
}

export function BonusDialog({ open, value, onClose, onSave }: { open: boolean; value: number; onClose: () => void; onSave: (n: number) => void }) {
  const [count, setCount] = useState('1')
  useEffect(() => { if (open) setCount(String(value || 1)) }, [open, value])
  const n = toInt(count)
  const error = !Number.isInteger(n) || n < 1 ? '1 以上の数で入れてください。' : ''
  return (
    <Dialog open={open} title="初回来店ボーナス" confirmLabel="変える" onCancel={onClose} error={error || undefined} onConfirm={() => { if (!error) onSave(n) }}>
      <Field label="はじめての来店で足す個数"><TextField value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" /></Field>
    </Dialog>
  )
}

type RankRow = { tagName: string; multiplier: string }
export function RankDialog({ open, settings, onClose, onSave }: {
  open: boolean; settings: VisitStampSettings; onClose: () => void; onSave: (rows: VisitStampSettings['rankMultipliers']) => void
}) {
  const [rows, setRows] = useState<RankRow[]>([])
  useEffect(() => {
    if (open) setRows(settings.rankMultipliers.length ? settings.rankMultipliers.map((r) => ({ tagName: r.tagName, multiplier: String(r.multiplier) })) : [{ tagName: '', multiplier: '1.5' }])
  }, [open, settings.rankMultipliers])
  const used = rows.filter((r) => r.tagName.trim())
  const error = used.some((r) => !(Number(r.multiplier) >= 1 && Number(r.multiplier) <= 100)) ? '倍率は 1〜100 で入れてください。' : ''
  return (
    <Dialog open={open} title="会員ランクの倍率" description="友だちに付いたタグの名前ごとに倍率を決めます。いくつも当たるときは、いちばん高い倍率だけを使います。" confirmLabel="変える" onCancel={onClose} error={error || undefined}
      onConfirm={() => {
        if (error) return
        /* 前からあるランクの名前・止めているかは残す（タグの名前で突き合わせる）。 */
        onSave(used.map((r) => {
          const before = settings.rankMultipliers.find((x) => x.tagName === r.tagName.trim())
          return { ...(before?.name ? { name: before.name } : {}), ...(before?.active === false ? { active: false } : {}), tagName: r.tagName.trim(), multiplier: Number(r.multiplier) }
        }))
      }}>
      <div className={styles.dialogBody}>
        {rows.map((row, i) => (
          <div key={i} className={styles.row2}>
            <Field label={`タグの名前 ${i + 1}`}><TextField value={row.tagName} onChange={(e) => setRows(rows.map((r, k) => (k === i ? { ...r, tagName: e.target.value } : r)))} placeholder="例：ゴールド" /></Field>
            <Field label="倍率"><TextField value={row.multiplier} onChange={(e) => setRows(rows.map((r, k) => (k === i ? { ...r, multiplier: e.target.value } : r)))} inputMode="decimal" /></Field>
          </div>
        ))}
        {rows.length < 20 ? <button type="button" className={styles.link} onClick={() => setRows([...rows, { tagName: '', multiplier: '1.2' }])}>＋ ランクを足す</button> : null}
      </div>
    </Dialog>
  )
}

/** 理由を書いて実行する窓（却下・取り消し）。理由は台帳に残るので必須。 */
export function ReasonDialog({ open, title, description, confirmLabel, busy, error, onClose, onConfirm }: {
  open: boolean; title: string; description: string; confirmLabel: string; busy: boolean; error?: string; onClose: () => void; onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Dialog open={open} title={title} description={description} confirmLabel={confirmLabel} tone="destructive" busy={busy} error={error} onCancel={onClose}
      onConfirm={() => { if (reason.trim()) onConfirm(reason.trim()) }}>
      <Field label="理由"><TextField value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="例：写真の数と合わない" /></Field>
    </Dialog>
  )
}

/** 店員の暗証番号（4桁）。お客さまの LIFF で特典を使用済みにするときに店員が打つ。番号は保存後に見えない。 */
export function PinDialog({ open, staff, busy, error, onClose, onSave }: {
  open: boolean; staff: Array<{ id: string; name: string }>; busy: boolean; error?: string; onClose: () => void; onSave: (staffId: string, pin: string) => void
}) {
  const [staffId, setStaffId] = useState('')
  const [pin, setPin] = useState('')
  useEffect(() => { if (open) { setStaffId(staff[0]?.id ?? ''); setPin('') } }, [open, staff])
  const valid = /^\d{4}$/.test(pin) && !!staffId
  return (
    <Dialog open={open} title="店員の暗証番号" description="特典を使用済みにするとき、店員がお客さまのスマホで打つ4桁の番号です。保存したあとは番号を表示しません。" confirmLabel="保存する" busy={busy} error={error}
      onCancel={onClose} onConfirm={() => { if (valid) onSave(staffId, pin) }}>
      <div className={styles.dialogBody}>
        <Field label="店員"><Select aria-label="店員" size="full" value={staffId} onChange={setStaffId} options={staff.map((s) => ({ value: s.id, label: s.name }))} /></Field>
        <Field label="暗証番号（4桁）"><TextField className={styles.pin} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="off" type="password" /></Field>
      </div>
    </Dialog>
  )
}

/** 押せる店（このカードを使う LINE アカウント）。保存は下の帯の［保存する］。 */
export function StoresDialog({ open, accounts, value, onClose, onSave }: {
  open: boolean; accounts: Array<{ id: string; name: string }>; value: string[]; onClose: () => void; onSave: (ids: string[]) => void
}) {
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => { if (open) setIds(value) }, [open, value])
  return (
    <Dialog open={open} title="押せる店" description="このカードのスタンプを押せる店です。同じカードの店どうしでスタンプを合わせて数えます。" confirmLabel="決める" onCancel={onClose}
      error={ids.length ? undefined : '店を1つ以上選んでください。'} onConfirm={() => { if (ids.length) onSave(ids) }}>
      <div className={styles.dialogBody}>
        {accounts.map((a) => (
          <Checkbox key={a.id} checked={ids.includes(a.id)} onCheckedChange={(on) => setIds(on ? [...ids, a.id] : ids.filter((x) => x !== a.id))}>{a.name}</Checkbox>
        ))}
      </div>
    </Dialog>
  )
}

export function PhotoDialog({ url, name, onClose }: { url: string | null; name: string; onClose: () => void }) {
  return (
    <Dialog open={!!url} title={`${name}さんの紙のカード`} onCancel={onClose} cancelLabel="閉じる" size="large">
      {/* 写真は担当店舗の権限で読んだもの（本人だけが預けた非公開の写真）。大きさは窓に合わせる。 */}
      {url ? <img src={url} alt={`${name}さんが送った紙のスタンプカードの写真`} className={styles.photo} /> : null}
    </Dialog>
  )
}
