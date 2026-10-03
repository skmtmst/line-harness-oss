'use client'

/*
 * ★V8-B ウェビナー②動画（板 `VWNaA`・`LPOe7`）。
 *
 * 配信の形で中身が変わる。オンデマンドは配信枠（`VWNaA`）、日時指定は
 * 開催回（`LPOe7`）。動画・公開期間・視聴の数え方・右の見え方は共通。
 * 動画の準備の段（検査→準備完了）は、日時指定の版だけ出す（見本どおり）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 動画の「16:9・自動再生なし」：結ぶ口が無いので出さない。再生時間だけ出す。
 * - 配信枠の「〜22:00・30分ごとに」：枠の決まりに終わり・間隔が無いので、
 *   始まりの時刻だけ出す。定員は単発の枠だけ開催回の口から出す。
 * - 開催回の追加・複製：枠を作る口が無いので、開催回の追加は日時と定員を
 *   直接入れる形にする。複製は出さない。
 */
import { useCallback, useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import { RowActions } from '@/components/shared/row-actions'
import StatusBadge from '@/components/shared/status-badge'
import { api, webinarApi, type Webinar, type WebinarEditor, type WebinarScheduleRule, type WebinarVideoAsset } from '@/lib/api'
import VideoStages from './video-stages'
import styles from './video-v8.module.css'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function fmtSec(total: number): string {
  if (!Number.isFinite(total) || total < 0) return '—'
  const minutes = Math.floor(total / 60)
  const seconds = Math.round(total % 60)
  if (minutes < 60) return `${minutes}分${seconds}秒`
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`
}

function basenameOf(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, '')
  const base = trimmed.split('/').pop() || trimmed
  return base.includes('.') ? base : `${base}.mp4`
}

function ruleLabel(rule: WebinarScheduleRule): { when: string; note: string } {
  if (rule.type === 'daily') return { when: '毎日', note: rule.time ? `${rule.time}〜` : '' }
  if (rule.type === 'weekly') {
    const days = (rule.days ?? []).map((day) => WEEKDAYS[day] ?? '').filter(Boolean).join('・')
    return { when: '毎週', note: `${days}${days ? ' ' : ''}${rule.time ?? ''}`.trim() }
  }
  return { when: '単発', note: rule.at ?? '' }
}

export default function VideoStepV8({ webinar: initial, editor, onWebinarChange, onEditorChange, onDirtyChange, registerSave }: {
  webinar: Webinar
  editor: WebinarEditor
  onWebinarChange: (next: Webinar) => void
  onEditorChange: (next: WebinarEditor) => void
  onDirtyChange: (dirty: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
}) {
  const [webinar, setWebinar] = useState(initial)
  useEffect(() => setWebinar(initial), [initial])
  const [startsAt, setStartsAt] = useState(webinar.publicationStartsAt ?? '')
  const [endsAt, setEndsAt] = useState(webinar.publicationEndsAt ?? '')
  const [missingPolicy, setMissingPolicy] = useState(editor.actionPolicy.missingResultPolicy)
  const [rules, setRules] = useState<WebinarScheduleRule[]>(webinar.schedule)
  const [baseline, setBaseline] = useState(() => JSON.stringify({ startsAt: webinar.publicationStartsAt ?? '', endsAt: webinar.publicationEndsAt ?? '', missingPolicy: editor.actionPolicy.missingResultPolicy, rules: webinar.schedule }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [videoName, setVideoName] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)

  const dirty = JSON.stringify({ startsAt, endsAt, missingPolicy, rules }) !== baseline
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true)
    setSaveError('')
    try {
      const updated = await webinarApi.update(webinar.id, {
        publicationStartsAt: startsAt || null,
        publicationEndsAt: endsAt || null,
        schedule: rules,
      })
      const nextEditor = await webinarApi.saveEditor(webinar.id, { expectedVersion: editor.version, missingResultPolicy: missingPolicy })
      setWebinar(updated.data)
      onWebinarChange(updated.data)
      onEditorChange(nextEditor.data)
      setBaseline(JSON.stringify({ startsAt, endsAt, missingPolicy, rules }))
      return true
    } catch {
      setSaveError('保存できませんでした。入力を見直してください。')
      return false
    } finally {
      setSaving(false)
    }
  }, [webinar.id, startsAt, endsAt, rules, editor.version, missingPolicy, onWebinarChange, onEditorChange])

  useEffect(() => {
    registerSave(dirty ? save : null)
    return () => registerSave(null)
  }, [dirty, registerSave, save])

  useEffect(() => {
    let cancelled = false
    if (webinar.videoMediaId && webinar.accountId) {
      api.media.detail(webinar.videoMediaId, webinar.accountId)
        .then((res) => { if (!cancelled && res.success) setVideoName(res.data.item.filename) })
        .catch(() => {})
    } else {
      setVideoName(null)
    }
    return () => { cancelled = true }
  }, [webinar.videoMediaId, webinar.accountId])

  const scheduled = editor.deliveryKind === 'scheduled'
  const displayName = videoName ?? (webinar.videoPrefix ? basenameOf(webinar.videoPrefix) : '—（未設定）')

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        <section className={styles.card} aria-label="動画">
          <h2 className={styles.cardTitle}>動画</h2>
          <div className={styles.videoRow}>
            <span className={styles.videoThumb} aria-hidden="true">▶</span>
            <div>
              <p className={styles.videoName}>{displayName}</p>
              <p className={styles.videoMeta}>{fmtSec(webinar.durationSeconds)}</p>
            </div>
            <span className={styles.videoReplace}>
              <Button onClick={() => setReplaceOpen(true)}>差し替える</Button>
            </span>
          </div>
          <ReplaceVideoDialog
            open={replaceOpen}
            webinar={webinar}
            onClose={() => setReplaceOpen(false)}
            onReplaced={(next) => { setWebinar(next); onWebinarChange(next) }}
          />
        </section>
        {scheduled ? (
          <section className={styles.card} aria-label="動画の準備">
            <h2 className={styles.cardTitle}>動画の準備</h2>
            <VideoStages webinarId={webinar.id} hasVideo={Boolean(webinar.videoPrefix || webinar.videoMediaId)} />
            <p className={styles.prepNote}>準備が済むまで公開できません（いま「配信の形」を作っています）</p>
          </section>
        ) : null}
        <section className={styles.card} aria-label="公開期間">
          <h2 className={styles.cardTitle}>公開期間</h2>
          <div className={styles.periodGrid}>
            <label className={styles.field}>公開の開始
              <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={styles.textInput} aria-label="公開の開始" />
            </label>
            <label className={styles.field}>公開の終了 <span className={styles.fieldNote}>任意</span>
              <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} placeholder="なし（いつでも）" className={styles.textInput} aria-label="公開の終了" />
            </label>
          </div>
        </section>
        {scheduled ? (
          <SessionsCard webinarId={webinar.id} />
        ) : (
          <FramesCard rules={rules} webinarId={webinar.id} onChange={setRules} />
        )}
        <section className={styles.card} aria-label="視聴の数え方">
          <h2 className={styles.cardTitle}>視聴の数え方</h2>
          <div className={styles.periodGrid}>
            <label className={styles.field}>視聴完了とみなす
              <Select aria-label="視聴完了とみなす" value="fixed" onChange={() => {}} disabled options={[{ value: 'fixed', label: `${editor.viewingCondition.label}（変えられません）` }]} />
            </label>
            <label className={styles.field}>結果が取れないとき
              <Select
                aria-label="結果が取れないとき"
                value={missingPolicy}
                onChange={(value) => setMissingPolicy(value as 'escalate' | 'retry_next_day')}
                options={[
                  { value: 'retry_next_day', label: '翌日に取り直す' },
                  { value: 'escalate', label: '要対応へ追加' },
                ]}
              />
            </label>
          </div>
        </section>
        {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      </div>
      <div>
        <h2 className={styles.previewTitle}>公開ページでの見え方</h2>
        <div className={styles.previewCard}>
          <p className={styles.previewHeading}>{webinar.title || '無題のウェビナー'}</p>
          <div className={styles.previewScreen} aria-hidden="true">▶</div>
          <p className={styles.previewCaption}>{scheduled ? '開催回ごとに決めた日時から' : 'いつでも見られます'}・{fmtSec(webinar.durationSeconds)}</p>
        </div>
        <div className={styles.previewButtons}>
          <Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=preview`}>PCで見る</Button>
          <Button href={`/webinars/edit?id=${encodeURIComponent(webinar.id)}&pane=preview`}>スマホで見る</Button>
        </div>
      </div>
    </div>
  )
}

function ReplaceVideoDialog({ open, webinar, onClose, onReplaced }: {
  open: boolean
  webinar: Webinar
  onClose: () => void
  onReplaced: (next: Webinar) => void
}) {
  const [choice, setChoice] = useState('')
  const [external, setExternal] = useState('')
  const [items, setItems] = useState<Array<{ id: string; filename: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || !webinar.accountId) return
    api.media.list(webinar.accountId, { kind: 'video', limit: 100 })
      .then((res) => { if (res.success) setItems(res.data.items.map((item) => ({ id: item.id, filename: item.filename }))) })
      .catch(() => setError('動画の一覧を読み込めませんでした。'))
  }, [open, webinar.accountId])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const next = choice === '__external__'
        ? await webinarApi.update(webinar.id, { videoPrefix: external.trim() || null })
        : await webinarApi.update(webinar.id, { videoMediaId: choice || null })
      onReplaced(next.data)
      onClose()
    } catch {
      setError('差し替えできませんでした。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onCancel={onClose} title="動画を差し替える" footer={<><Button onClick={onClose}>やめる</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>差し替える</Button></>}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item) => (
          <label key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="radio" name="webinar-video-choice" checked={choice === item.id} onChange={() => setChoice(item.id)} />
            {item.filename}
          </label>
        ))}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="radio" name="webinar-video-choice" checked={choice === '__external__'} onChange={() => setChoice('__external__')} />
          外部のURLを使う
        </label>
        {choice === '__external__' ? <TextField value={external} onChange={(event) => setExternal(event.target.value)} placeholder="https://..." aria-label="外部の動画URL" /> : null}
      </div>
    </Dialog>
  )
}

function FramesCard({ rules, webinarId, onChange }: { rules: WebinarScheduleRule[]; webinarId: string; onChange: (next: WebinarScheduleRule[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)
  const [sessions, setSessions] = useState<Record<string, { capacity: number | null; reserved: number }>>({})
  useEffect(() => {
    let cancelled = false
    const onceRules = rules.filter((rule) => rule.type === 'once' && rule.at)
    Promise.all(onceRules.map(async (rule) => {
      try {
        const startAt = Math.floor(new Date(rule.at as string).getTime() / 1000)
        const res = await webinarApi.webinarSession(webinarId, startAt)
        return [rule.at, { capacity: res.data.session?.capacity ?? null, reserved: res.data.session?.reservedCount ?? 0 }] as const
      } catch {
        return [rule.at, { capacity: null, reserved: 0 }] as const
      }
    })).then((entries) => { if (!cancelled) setSessions(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [rules, webinarId])
  return (
    <section className={styles.card} aria-label="配信枠">
      <h2 className={styles.cardTitle}>配信枠 {rules.length}件</h2>
      <p className={styles.cardDesc}>視聴できる時間の枠です。枠が0件だと公開できません。</p>
      <ul className={styles.frameList}>
        {rules.map((rule, index) => {
          const label = ruleLabel(rule)
          const session = rule.at ? sessions[rule.at] : undefined
          return (
            <li key={index} className={styles.frameRow}>
              <span className={styles.frameWhen}>{label.when}</span>
              <span className={styles.frameNote}>{label.note}</span>
              <span className={styles.frameSide}>
                {session && session.capacity !== null ? `残り${Math.max(0, session.capacity - session.reserved)}人` : '定員なし'}
                <RowActions
                  subjectName={`${label.when}の枠`}
                  menuItems={[
                    { id: 'delete', label: '削除', onSelect: () => onChange(rules.filter((_, i) => i !== index)) },
                  ]}
                />
              </span>
            </li>
          )
        })}
      </ul>
      {adding ? (
        <AddRuleForm
          onAdd={(rule) => {
            onChange([...rules, rule])
            if (!keepOpen) setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div className={styles.frameAddRow}>
          <Button onClick={() => { setKeepOpen(false); setAdding(true) }}>＋ 枠を足す（毎日・毎週・単発）</Button>
          <Button onClick={() => { setKeepOpen(true); setAdding(true) }}>まとめて作る</Button>
        </div>
      )}
    </section>
  )
}

function AddRuleForm({ onAdd, onCancel }: { onAdd: (rule: WebinarScheduleRule) => void; onCancel: () => void }) {
  const [type, setType] = useState<'daily' | 'weekly' | 'once'>('daily')
  const [time, setTime] = useState('10:00')
  const [days, setDays] = useState<number[]>([6])
  const [at, setAt] = useState('')
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      <Select aria-label="枠の種類" value={type} onChange={(value) => setType(value as 'daily' | 'weekly' | 'once')} options={[
        { value: 'daily', label: '毎日' },
        { value: 'weekly', label: '毎週' },
        { value: 'once', label: '単発' },
      ]} />
      {type === 'once' ? (
        <input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} className={styles.textInput} style={{ maxWidth: 220 }} aria-label="単発の日時" />
      ) : (
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={styles.textInput} style={{ maxWidth: 140 }} aria-label="始まりの時刻" />
      )}
      {type === 'weekly' ? (
        <div style={{ display: 'flex', gap: 4 }}>
          {WEEKDAYS.map((name, day) => (
            <label key={day} style={{ display: 'flex', gap: 2, alignItems: 'center', fontSize: 12 }}>
              <input type="checkbox" checked={days.includes(day)} onChange={() => setDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])} />
              {name}
            </label>
          ))}
        </div>
      ) : null}
      <Button variant="primary" onClick={() => {
        if (type === 'once') {
          if (!at) return
          onAdd({ type, at })
        } else {
          onAdd({ type, time, ...(type === 'weekly' ? { days: [...days].sort() } : {}) })
        }
      }}>足す</Button>
      <Button onClick={onCancel}>やめる</Button>
    </div>
  )
}

function SessionsCard({ webinarId }: { webinarId: string }) {
  const [starts, setStarts] = useState<number[] | null>(null)
  const [details, setDetails] = useState<Record<number, { capacity: number | null; reserved: number; state: string; remaining: number | null }>>({})
  const [adding, setAdding] = useState(false)
  const [newAt, setNewAt] = useState('')
  const [newCapacity, setNewCapacity] = useState('')
  const [capTarget, setCapTarget] = useState<number | null>(null)
  const [capValue, setCapValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadStarts = useCallback(async () => {
    try {
      const res = await webinarApi.analytics(webinarId)
      const upcoming = res.data.sessions.map((s) => s.sessionStartAt).filter((at) => at * 1000 >= Date.now() - 24 * 3600 * 1000).sort((a, b) => a - b)
      setStarts(upcoming)
    } catch {
      setStarts([])
    }
  }, [webinarId])

  useEffect(() => { void loadStarts() }, [loadStarts])

  useEffect(() => {
    if (!starts) return
    let cancelled = false
    Promise.all(starts.map(async (startAt) => {
      try {
        const res = await webinarApi.webinarSession(webinarId, startAt)
        const s = res.data.session
        return [startAt, { capacity: s?.capacity ?? null, reserved: s?.reservedCount ?? 0, state: s?.state ?? 'open', remaining: s?.remaining ?? null }] as const
      } catch {
        return [startAt, { capacity: null, reserved: 0, state: 'open', remaining: null }] as const
      }
    })).then((entries) => { if (!cancelled) setDetails(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [starts, webinarId])

  const addSession = async () => {
    const at = Math.floor(new Date(newAt).getTime() / 1000)
    if (!Number.isFinite(at)) return
    setBusy(true)
    setError('')
    try {
      await webinarApi.setSessionCapacity(webinarId, at, newCapacity === '' ? null : Number(newCapacity))
      setNewAt('')
      setNewCapacity('')
      setAdding(false)
      await loadStarts()
    } catch {
      setError('枠を足せませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const saveCapacity = async () => {
    if (capTarget === null) return
    setBusy(true)
    setError('')
    try {
      await webinarApi.setSessionCapacity(webinarId, capTarget, capValue === '' ? null : Number(capValue))
      setCapTarget(null)
      await loadStarts()
    } catch {
      setError('定員を変えられませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const dateLabel = (startAt: number) => {
    const date = new Date(startAt * 1000)
    return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}） ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  return (
    <section className={styles.card} aria-label="開催回">
      <h2 className={styles.cardTitle}>開催回</h2>
      <p className={styles.cardDesc}>回ごとに日時と定員を決めます。定員を空にすると無制限</p>
      {starts === null ? <div style={{ marginTop: 12 }}><ListState kind="loading" /></div> : (
        <DataTable>
          <TableHeadRow>
            <Th>日時</Th>
            <Th align="right">定員</Th>
            <Th align="right">申込</Th>
            <Th>状態</Th>
            <Th align="right">操作</Th>
          </TableHeadRow>
          {starts.map((startAt) => {
            const detail = details[startAt]
            return (
              <Tr key={startAt}>
                <Td>{dateLabel(startAt)}</Td>
                <Td align="right">{detail ? (detail.capacity === null ? '無制限' : `${detail.capacity}人`) : '—'}</Td>
                <Td align="right">{detail ? `${detail.reserved}人` : '—'}</Td>
                <Td>
                  {detail ? (
                    <StatusBadge tone={detail.state === 'open' && (detail.remaining ?? 1) > 0 ? 'info' : detail.state === 'full' ? 'danger' : 'neutral'}>
                      {detail.state === 'full' ? '満席' : detail.state === 'closed' ? '受付前' : detail.remaining !== null ? `残り${detail.remaining}人` : '受付中'}
                    </StatusBadge>
                  ) : '—'}
                </Td>
                <Td align="right">
                  <RowActions
                    subjectName={`${dateLabel(startAt)}の回`}
                    detail={{ label: '参加者を見る', href: `/webinars/edit?id=${encodeURIComponent(webinarId)}&pane=participants` }}
                    menuItems={[
                      { id: 'capacity', label: '定員を変える', onSelect: () => { setCapTarget(startAt); setCapValue(detail && detail.capacity !== null ? String(detail.capacity) : '') } },
                    ]}
                  />
                </Td>
              </Tr>
            )
          })}
        </DataTable>
      )}
      {adding ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <input type="datetime-local" value={newAt} onChange={(event) => setNewAt(event.target.value)} className={styles.textInput} style={{ maxWidth: 220 }} aria-label="足す枠の日時" />
          <input type="number" min={0} value={newCapacity} onChange={(event) => setNewCapacity(event.target.value)} placeholder="定員（空は無制限）" className={styles.textInput} style={{ maxWidth: 180 }} aria-label="足す枠の定員" />
          <Button variant="primary" disabled={busy} onClick={() => void addSession()}>足す</Button>
          <Button onClick={() => setAdding(false)}>やめる</Button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <button type="button" className={styles.frameAddLink} onClick={() => setAdding(true)}>＋ 枠を足す（毎日・毎週・単発）</button>
        </div>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Dialog open={capTarget !== null} onCancel={() => setCapTarget(null)} title="定員を変える" footer={<><Button onClick={() => setCapTarget(null)}>やめる</Button><Button variant="primary" disabled={busy} onClick={() => void saveCapacity()}>変える</Button></>}>
        <input type="number" min={0} value={capValue} onChange={(event) => setCapValue(event.target.value)} placeholder="空は無制限" className={styles.textInput} aria-label="定員" />
      </Dialog>
    </section>
  )
}
