'use client'

/*
 * ★V8 動画と公開期間（`VWNaA`）・開催回（`LPOe7`）。
 * v7 の見た目は 1画素も変えない。編集画面で data-theme="v8" のときだけ、
 * 動画の段をこの部品で描く（V7 の VideoDesignStep は触らない）。
 *
 * 配信枠（毎日・毎週・単発）は Webinar.schedule の読み書き。
 * 行ごとの定員・残りは開催回ごとの口にしか無いので出さない。
 * 「まとめて作る」は単発の枠を日付の範囲でまとめて足す。
 */
import { useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import Notice from '@/components/shared/notice'
import WebinarForm from '@/components/webinars/webinar-form'
import Disclosure from '@/components/shared/disclosure'
import {
  webinarApi,
  describeSaveFailure,
  type Webinar,
  type WebinarEditor,
  type WebinarScheduleRule,
} from '@/lib/api'

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

function formatMinutes(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}分${seconds}秒`
}

function formatDateTime(value: string | null): string {
  if (!value) return 'なし（いつでも）'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const week = WEEKDAY[date.getDay()]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}（${week}） ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** datetime-local の字面（`2026-10-01T10:00`）を JST の ISO にする。 */
function toJstIso(local: string): string {
  return `${local}:00+09:00`
}

function ruleSummary(rule: WebinarScheduleRule): { kind: string; detail: string } {
  if (rule.type === 'daily') return { kind: '毎日', detail: rule.time ? `${rule.time}～` : '時刻未定' }
  if (rule.type === 'weekly') {
    const days = (rule.days ?? []).map((d) => WEEKDAY[d] ?? '').join('・')
    return { kind: '毎週', detail: `${days}${days ? ' ' : ''}${rule.time ?? ''}`.trim() || '曜日未定' }
  }
  return { kind: '単発', detail: rule.at ? formatDateTime(rule.at) : '日時未定' }
}

export default function VideoV8({
  webinar,
  editor,
  publicUrl,
  canOpenPublicPage,
  publicPageReason,
  completionLabel,
  onWebinarSaved,
  onDirtyChange,
  registerSave,
  onEditVideo,
}: {
  webinar: Webinar
  editor: WebinarEditor
  publicUrl: string | null
  canOpenPublicPage: boolean
  publicPageReason: string
  completionLabel: string | null
  onWebinarSaved: (next: Webinar) => void
  onDirtyChange?: (dirty: boolean) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
  onEditVideo: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [newKind, setNewKind] = useState<'daily' | 'weekly' | 'once'>('daily')
  const [newTime, setNewTime] = useState('10:00')
  const [newDays, setNewDays] = useState<number[]>([6])
  const [newDate, setNewDate] = useState('')
  const [bulkFrom, setBulkFrom] = useState('')
  const [bulkTo, setBulkTo] = useState('')
  const [bulkTime, setBulkTime] = useState('10:00')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [noEnd, setNoEnd] = useState(!webinar.publicationEndsAt)
  const [periodBusy, setPeriodBusy] = useState(false)
  const [periodError, setPeriodError] = useState('')
  const [policy, setPolicy] = useState(editor.actionPolicy.missingResultPolicy)
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyError, setPolicyError] = useState('')

  const saveSchedule = async (schedule: WebinarScheduleRule[]): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      const fresh = await webinarApi.editor(webinar.id)
      const res = await webinarApi.update(webinar.id, {
        schedule,
        expectedVersion: fresh.data.version,
      })
      onWebinarSaved(res.data)
      return true
    } catch (cause) {
      setError(describeSaveFailure(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  const removeRule = async (index: number) => {
    setMenuOpen(null)
    await saveSchedule(webinar.schedule.filter((_, i) => i !== index))
  }

  const duplicateRule = async (index: number) => {
    setMenuOpen(null)
    const rules = [...webinar.schedule]
    rules.splice(index + 1, 0, { ...webinar.schedule[index] })
    await saveSchedule(rules)
  }

  const addRule = async () => {
    const rule: WebinarScheduleRule | null =
      newKind === 'daily'
        ? { type: 'daily', time: newTime }
        : newKind === 'weekly'
          ? { type: 'weekly', days: [...newDays].sort(), time: newTime }
          : newDate
            ? { type: 'once', at: toJstIso(`${newDate}T${newTime}`) }
            : null
    if (!rule) {
      setError('単発の枠は日付を入れてください。')
      return
    }
    if (await saveSchedule([...webinar.schedule, rule])) setAdding(false)
  }

  /** まとめて作る：日付の範囲に単発の枠を1日1つずつ足す。 */
  const addBulk = async () => {
    if (!bulkFrom || !bulkTo || bulkFrom > bulkTo) {
      setError('まとめて作るには、始まりと終わりの日付を正しく入れてください。')
      return
    }
    const rules: WebinarScheduleRule[] = []
    const cursor = new Date(`${bulkFrom}T00:00:00+09:00`)
    const end = new Date(`${bulkTo}T00:00:00+09:00`)
    while (cursor <= end && rules.length < 31) {
      const pad = (n: number) => String(n).padStart(2, '0')
      const day = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`
      rules.push({ type: 'once', at: toJstIso(`${day}T${bulkTime}`) })
      cursor.setDate(cursor.getDate() + 1)
    }
    if (await saveSchedule([...webinar.schedule, ...rules])) setBulk(false)
  }

  const savePeriod = async () => {
    setPeriodBusy(true)
    setPeriodError('')
    try {
      const fresh = await webinarApi.editor(webinar.id)
      const res = await webinarApi.update(webinar.id, {
        publicationStartsAt: startsAt ? toJstIso(startsAt) : null,
        publicationEndsAt: noEnd || !endsAt ? null : toJstIso(endsAt),
        expectedVersion: fresh.data.version,
      })
      onWebinarSaved(res.data)
    } catch (cause) {
      setPeriodError(describeSaveFailure(cause))
    } finally {
      setPeriodBusy(false)
    }
  }

  const savePolicy = async (next: 'escalate' | 'retry_next_day') => {
    setPolicy(next)
    setPolicyBusy(true)
    setPolicyError('')
    try {
      await webinarApi.saveEditor(webinar.id, {
        expectedVersion: editor.version,
        missingResultPolicy: next,
      })
    } catch {
      setPolicyError('保存できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setPolicyBusy(false)
    }
  }

  const toggleDay = (day: number) => {
    setNewDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()))
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-design-node="VWNaA">
      <div className="min-w-0 flex-1 space-y-3">
        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="動画">
          <h2 className="text-ink text-base font-bold">動画</h2>
          <div className="bg-canvas-sunken mt-3 flex items-center gap-3 rounded-control p-3">
            <span className="bg-ink flex h-12 w-20 shrink-0 items-center justify-center rounded-control" aria-hidden="true">
              <span className="text-canvas text-lg">▶</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-ink block truncate text-sm font-semibold">
                {webinar.videoPrefix ? webinar.videoPrefix.split('/').pop() : webinar.title}
              </span>
              <span className="text-ink-secondary mt-0.5 block text-xs">
                {formatMinutes(webinar.durationSeconds)}
                {webinar.videoPrefix ? '' : '・動画が選ばれていません'}
              </span>
            </span>
            <Button variant="secondary" onClick={onEditVideo}>
              差し替える
            </Button>
          </div>
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="公開期間">
          <h2 className="text-ink text-base font-bold">公開期間</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">公開の開始</span>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                placeholder={webinar.publicationStartsAt ? formatDateTime(webinar.publicationStartsAt) : '2026/10/01 10:00'}
                className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
              />
            </label>
            <div>
              <span className="text-ink-secondary mb-1 block text-xs font-medium">
                公開の終了 <span className="text-ink-faint">任意</span>
              </span>
              <input
                type="datetime-local"
                value={endsAt}
                disabled={noEnd}
                onChange={(e) => setEndsAt(e.target.value)}
                placeholder={webinar.publicationEndsAt ? formatDateTime(webinar.publicationEndsAt) : 'なし（いつでも）'}
                className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm disabled:opacity-50"
              />
              <Checkbox checked={noEnd} onCheckedChange={setNoEnd} className="mt-2 text-xs">
                終わりを決めない（いつでも見られる）
              </Checkbox>
            </div>
          </div>
          {periodError ? <Notice tone="error" title="公開期間を保存できませんでした">{periodError}</Notice> : null}
          <div className="mt-3">
            <Button variant="secondary" busy={periodBusy} busyLabel="保存しています…" onClick={savePeriod}>
              公開期間を保存する
            </Button>
          </div>
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="配信枠">
          <h2 className="text-ink text-base font-bold">配信枠 {webinar.schedule.length}件</h2>
          <p className="text-ink-faint mt-1 text-xs">視聴できる時間の枠です。枠が0だと公開できません。</p>
          {error ? <Notice tone="error" title="配信枠を保存できませんでした">{error}</Notice> : null}
          <ul className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
            {webinar.schedule.map((rule, index) => {
              const summary = ruleSummary(rule)
              return (
                <li key={index} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="bg-accent-soft text-accent-deep inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold"
                    aria-hidden="true"
                  >
                    <span aria-hidden="true">●</span>
                    {summary.kind}
                  </span>
                  <span className="text-ink min-w-0 flex-1 truncate text-sm">{summary.detail}</span>
                  <span className="relative shrink-0">
                    <Button
                      variant="secondary"
                      size="compact"
                      aria-label={`枠${index + 1}の操作`}
                      aria-expanded={menuOpen === index}
                      onClick={() => setMenuOpen(menuOpen === index ? null : index)}
                    >
                      …
                    </Button>
                    {menuOpen === index ? (
                      <span className="border-hairline bg-canvas absolute right-0 z-10 mt-1 flex w-28 flex-col rounded-control border py-1 shadow-card">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => duplicateRule(index)}
                          className="text-ink px-3 py-2 text-left text-xs hover:bg-canvas-sunken"
                        >
                          複製する
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removeRule(index)}
                          className="text-danger px-3 py-2 text-left text-xs hover:bg-canvas-sunken"
                        >
                          消す
                        </button>
                      </span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
          {webinar.schedule.length === 0 ? (
            <p className="text-ink-faint mt-3 text-xs">まだ枠がありません。下の「枠を足す」から足してください。</p>
          ) : null}
          {!adding && !bulk ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setAdding(true)}>
                ＋ 枠を足す（毎日・毎週・単発）
              </Button>
              <Button variant="secondary" onClick={() => setBulk(true)}>
                まとめて作る
              </Button>
            </div>
          ) : null}
          {adding ? (
            <div className="border-hairline mt-3 space-y-3 rounded-control border p-3">
              <Select
                label="枠の種類"
                aria-label="枠の種類"
                value={newKind}
                onChange={(value) => setNewKind(value as 'daily' | 'weekly' | 'once')}
                options={[
                  { value: 'daily', label: '毎日' },
                  { value: 'weekly', label: '毎週' },
                  { value: 'once', label: '単発' },
                ]}
              />
              {newKind === 'weekly' ? (
                <div>
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">曜日</span>
                  <span className="flex flex-wrap gap-1">
                    {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={newDays.includes(day)}
                        onClick={() => toggleDay(day)}
                        className={
                          newDays.includes(day)
                            ? 'border-accent text-accent-deep h-9 w-9 rounded-control border-2 text-xs font-semibold'
                            : 'border-ink-faint text-ink-secondary h-9 w-9 rounded-control border text-xs'
                        }
                      >
                        {WEEKDAY[day]}
                      </button>
                    ))}
                  </span>
                </div>
              ) : null}
              {newKind === 'once' ? (
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">日付</span>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="text-ink-secondary mb-1 block text-xs font-medium">時刻</span>
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button busy={busy} busyLabel="足しています…" onClick={addRule}>
                  枠を足す
                </Button>
                <Button variant="secondary" onClick={() => setAdding(false)}>
                  やめる
                </Button>
              </div>
            </div>
          ) : null}
          {bulk ? (
            <div className="border-hairline mt-3 space-y-3 rounded-control border p-3">
              <p className="text-ink-secondary text-xs">日付の範囲に、単発の枠を1日1つずつ足します（31日まで）。</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">始まり</span>
                  <input
                    type="date"
                    value={bulkFrom}
                    onChange={(e) => setBulkFrom(e.target.value)}
                    className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">終わり</span>
                  <input
                    type="date"
                    value={bulkTo}
                    onChange={(e) => setBulkTo(e.target.value)}
                    className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-ink-secondary mb-1 block text-xs font-medium">時刻</span>
                  <input
                    type="time"
                    value={bulkTime}
                    onChange={(e) => setBulkTime(e.target.value)}
                    className="border-hairline bg-canvas text-ink w-full rounded-control border px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button busy={busy} busyLabel="足しています…" onClick={addBulk}>
                  まとめて足す
                </Button>
                <Button variant="secondary" onClick={() => setBulk(false)}>
                  やめる
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="border-hairline bg-canvas rounded-card border p-4 shadow-card" aria-label="視聴の数え方">
          <h2 className="text-ink text-base font-bold">視聴の数え方</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-ink-secondary mb-1 block text-xs font-medium">視聴完了とみなす</span>
              <p className="text-ink text-sm">{completionLabel ?? '—'}</p>
            </div>
            <div>
              <Select
                label="結果が取れないとき"
                aria-label="結果が取れないとき"
                value={policy}
                disabled={policyBusy}
                onChange={(value) => savePolicy(value as 'escalate' | 'retry_next_day')}
                options={[
                  { value: 'retry_next_day', label: '翌日に取り直す' },
                  { value: 'escalate', label: '担当へ上げる' },
                ]}
              />
              {policyError ? <p className="text-danger mt-1 text-xs" role="alert">{policyError}</p> : null}
            </div>
          </div>
        </section>

        <Disclosure title="動画・公開の詳細を編集する">
          <WebinarForm
            key={`${webinar.id}-${webinar.updatedAt}`}
            initial={webinar}
            hideBar
            onSaved={onWebinarSaved}
            onDirtyChange={onDirtyChange}
            registerSave={registerSave}
          />
        </Disclosure>
      </div>

      <aside className="w-full shrink-0 xl:w-95" aria-label="公開ページでの見え方">
        <div className="border-hairline bg-canvas rounded-card border p-4 shadow-card xl:sticky xl:top-4">
          <h2 className="text-ink text-base font-bold">公開ページでの見え方</h2>
          <p className="text-ink mt-2 truncate text-sm font-semibold">{webinar.title}</p>
          <span className="bg-ink mt-2 flex aspect-video w-full items-center justify-center rounded-control" aria-hidden="true">
            <span className="text-canvas text-2xl">▶</span>
          </span>
          <p className="text-ink-faint mt-2 text-xs">
            {webinar.publicationEndsAt ? '期間内だけ見られます' : 'いつでも見られます'}・{formatMinutes(webinar.durationSeconds)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {publicUrl && canOpenPublicPage ? (
              <>
                <Button variant="secondary" href={publicUrl} title={publicPageReason}>
                  PCで見る
                </Button>
                <Button variant="secondary" href={publicUrl} title={publicPageReason}>
                  スマホで見る
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" disabled title={publicPageReason}>
                  PCで見る
                </Button>
                <Button variant="secondary" disabled title={publicPageReason}>
                  スマホで見る
                </Button>
              </>
            )}
          </div>
          {!canOpenPublicPage && publicPageReason ? (
            <p className="text-ink-faint mt-2 text-xs">{publicPageReason}</p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
