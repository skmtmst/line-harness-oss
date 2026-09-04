'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, eventsApi, type EventDetail, type EventSlot } from '@/lib/api'
import ImageUploader from '@/components/shared/image-uploader'
import { AsideCard, ChoiceCard, Field, FormSection, inputClass } from '@/components/shared/create-page'
import { generateBulkSlots } from './bulk-slot-generator'
import { formatSlotJp, jstHHMMToUtcIso, splitBand, todayJst } from './jst'
import ConfirmDialog from '@/components/shared/confirm-dialog'

/**
 * イベントを作る（設計 V2 8-3-2 / 8-3-3 / 8-3-4）。
 *
 * 設計は「概要 → 予約枠 → 公開設定」の3段階で、段階ごとに保存して進む。
 * 編集画面（8-3-1）のタブとは目的が違う。編集はどこからでも直せる必要が
 * あるが、作成は上から順に埋めれば終わる、と分かることのほうが大事なので、
 * 戻る・進むのボタンを段階ごとに書き分けている。
 *
 * 枠は「イベントを作ってからでないと足せない」。①を保存した時点で
 * イベントは下書きとして実在し、②③はその更新になる。途中でやめても
 * 下書きが残るので、設計は①に「下書きとして保存」を置いている。
 */

const STEPS: Array<{ no: 1 | 2 | 3; label: string; todo: string; done: string }> = [
  { no: 1, label: '概要', todo: 'イベント名・場所・詳細を入力', done: 'イベント名・場所・詳細' },
  { no: 2, label: '予約枠', todo: '友だちが選べる日時を追加', done: '友だちが選べる日時' },
  { no: 3, label: '公開設定', todo: '承認制・リマインダ・公開', done: '承認制・リマインダ' },
]

const DEFAULT_DRAFT: EventDetail = {
  id: '',
  name: '',
  venue_name: null,
  venue_url: null,
  image_url: null,
  description: null,
  description_centered: 0,
  max_bookings_per_friend: null,
  requires_approval: 0,
  cancel_deadline_hours_before: null,
  reminder_day_before_enabled: 1,
  reminder_hours_before: null,
  is_published: 0,
  sort_order: 0,
  confirmation_message_extra: null,
  reminder_message_extra: null,
  og_title: null,
  og_description: null,
  og_image_url: null,
  visible_tag_id: null,
  waitlist_enabled: 0,
  entry_cutoff_hours_before: null,
}

export interface EventWizardProps {
  accountId: string
  /** 作成済みイベントのID。①を保存した時点で入る */
  eventId: string | null
  step: 1 | 2 | 3
}

export default function EventWizard({ accountId, eventId, step }: EventWizardProps) {
  const router = useRouter()
  const [draft, setDraft] = useState<EventDetail>(DEFAULT_DRAFT)
  const [slots, setSlots] = useState<EventSlot[]>([])
  const [tags, setTags] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(Boolean(eventId))

  // ②③は①を保存したあとにしか入れない。URL を直接叩かれても①へ戻す。
  useEffect(() => {
    if (step > 1 && !eventId) router.replace('/events/new')
  }, [step, eventId, router])

  useEffect(() => {
    let cancelled = false
    void api.tags
      .list()
      .then((res) => {
        if (!cancelled && res.success) setTags(res.data.map((t) => ({ id: t.id, name: t.name })))
      })
      .catch(() => {
        // タグが取れなくても作成は進められる。「誰に見せるか」が全員だけになる。
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    void (async () => {
      try {
        const [ev, slotsRes] = await Promise.all([
          eventsApi.getEvent(accountId, eventId),
          eventsApi.listSlots(accountId, eventId),
        ])
        if (cancelled) return
        setDraft(ev)
        setSlots(slotsRes.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId, eventId])

  function update<K extends keyof EventDetail>(key: K, value: EventDetail[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function payloadOf(d: EventDetail): Partial<EventDetail> {
    return {
      name: d.name,
      venue_name: d.venue_name,
      venue_url: d.venue_url,
      image_url: d.image_url,
      description: d.description,
      description_centered: d.description_centered,
      max_bookings_per_friend: d.max_bookings_per_friend,
      requires_approval: d.requires_approval,
      cancel_deadline_hours_before: d.cancel_deadline_hours_before,
      reminder_day_before_enabled: d.reminder_day_before_enabled,
      reminder_hours_before: d.reminder_hours_before,
      is_published: d.is_published,
      sort_order: d.sort_order,
      confirmation_message_extra: d.confirmation_message_extra,
      reminder_message_extra: d.reminder_message_extra,
      visible_tag_id: d.visible_tag_id ?? null,
      waitlist_enabled: d.waitlist_enabled ?? 0,
      entry_cutoff_hours_before: d.entry_cutoff_hours_before ?? null,
      target_type: d.target_type ?? 'single',
    }
  }

  /** 段階をまたぐ保存。goto に進み先の段階、null なら一覧へ戻る。 */
  async function persist(goto: 1 | 2 | 3 | null) {
    if (saving) return
    if (!draft.name.trim()) {
      setError('イベント名は必須です')
      return
    }
    if (draft.name.length > 255) {
      setError('イベント名は255字以内で入力してください')
      return
    }
    if (draft.description && draft.description.length > 20000) {
      setError('イベント詳細は20,000字以内で入力してください')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let id = eventId
      if (id) {
        const updated = await eventsApi.updateEvent(accountId, id, payloadOf(draft))
        setDraft(updated)
      } else {
        const created = await eventsApi.createEvent(accountId, payloadOf(draft))
        id = created.id
      }
      if (goto === null) {
        router.push(`/events?highlight=${id}`)
        return
      }
      router.replace(`/events/new?step=${goto}&id=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function refreshSlots() {
    if (!eventId) return
    const res = await eventsApi.listSlots(accountId, eventId)
    setSlots(res.items)
  }

  if (loading) {
    return (
      <div className="bg-canvas rounded-card border-hairline border p-12 text-center text-sm text-ink-faint">
        読み込み中…
      </div>
    )
  }

  return (
    <div>
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/events" className="hover:underline">
          イベント予約
        </Link>
        <span className="mx-1.5">/</span>
        <span>イベントを作る</span>
      </nav>

      <StepNav current={step} />

      {error && (
        <div className="bg-danger-bg text-danger rounded-card mb-3 px-4 py-3 text-sm">{error}</div>
      )}

      {step === 1 && (
        <OverviewStep
          draft={draft}
          update={update}
          saving={saving}
          onDraftSave={() => persist(null)}
          onNext={() => persist(2)}
        />
      )}

      {step === 2 && eventId && (
        <SlotsStep
          accountId={accountId}
          eventId={eventId}
          draft={draft}
          update={update}
          slots={slots}
          refreshSlots={refreshSlots}
          saving={saving}
          onBack={() => router.replace(`/events/new?step=1&id=${eventId}`)}
          onNext={() => persist(3)}
        />
      )}

      {step === 3 && eventId && (
        <PublishStep
          draft={draft}
          update={update}
          tags={tags}
          slots={slots}
          saving={saving}
          onBack={() => router.replace(`/events/new?step=2&id=${eventId}`)}
          onPublish={() => persist(null)}
        />
      )}
    </div>
  )
}

/** 上の3段階。済んだ段階は ✓ と、入れた内容の要約に変わる。 */
function StepNav({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div
      data-design="Steps"
      className="bg-canvas rounded-card border-hairline mb-4 flex flex-col gap-2 border p-4 sm:flex-row"
    >
      {STEPS.map((s) => {
        const done = s.no < current
        const active = s.no === current
        return (
          <div key={s.no} className="flex flex-1 items-start gap-2">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? 'bg-accent-deep text-on-accent'
                  : done
                    ? 'bg-success-bg text-success'
                    : 'bg-canvas-sunken text-ink-faint'
              }`}
            >
              {done ? '✓' : s.no}
            </span>
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${active ? 'text-ink' : 'text-ink-faint'}`}>
                {s.label}
              </div>
              <div className="text-ink-faint text-xs">{done ? s.done : s.todo}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 段階ごとの下のボタン。左が戻る系、右が進む系。 */
function StepFooter({
  back,
  next,
  saving,
}: {
  back: { label: string; onClick: () => void }
  next: { label: string; onClick: () => void }
  saving: boolean
}) {
  return (
    <div className="border-hairline mt-5 flex flex-wrap justify-between gap-2 border-t pt-4">
      <button
        onClick={back.onClick}
        disabled={saving}
        className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        {back.label}
      </button>
      <button
        onClick={next.onClick}
        disabled={saving}
        className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
      >
        {saving ? '保存中...' : next.label}
      </button>
    </div>
  )
}

// ----------------------------------------------------------------
// ① 概要
// ----------------------------------------------------------------

function OverviewStep({
  draft,
  update,
  saving,
  onDraftSave,
  onNext,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
  saving: boolean
  onDraftSave: () => void
  onNext: () => void
}) {
  const descLen = (draft.description ?? '').length
  return (
    <div data-design="Body">
      <div data-design="Left" className="bg-canvas rounded-card border-hairline space-y-5 border p-6">
      <FormSection step={1} label="イベントの中身" note="友だちの予約ページにそのまま出ます">
        <Field label="イベント名" htmlFor="ev-name" required>
          <input
            id="ev-name"
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            maxLength={255}
            placeholder="例：第1回 定期便のはじめ方 説明会"
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="開催場所" htmlFor="ev-venue">
            <input
              id="ev-venue"
              value={draft.venue_name ?? ''}
              onChange={(e) => update('venue_name', e.target.value || null)}
              placeholder="例：渋谷ベース 3F"
              className={inputClass}
            />
          </Field>
          <Field label="会場URL" htmlFor="ev-venue-url" note="オンライン開催の場合に入力します。">
            <input
              id="ev-venue-url"
              type="url"
              value={draft.venue_url ?? ''}
              onChange={(e) => update('venue_url', e.target.value || null)}
              placeholder="例：https://…"
              className={inputClass}
            />
          </Field>
        </div>

        <ImageUploader
          mode="url"
          value={draft.image_url ? { mode: 'url', url: draft.image_url } : null}
          onChange={(v) => update('image_url', v?.mode === 'url' ? v.url : null)}
          label="イベント画像"
        />

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="ev-desc" className="text-ink-secondary text-sm font-medium">
              イベント詳細
            </label>
            <span className={`text-xs ${descLen > 20000 ? 'text-danger' : 'text-ink-faint'}`}>
              {descLen.toLocaleString()} / 20,000
            </span>
          </div>
          <textarea
            id="ev-desc"
            value={draft.description ?? ''}
            onChange={(e) => update('description', e.target.value || null)}
            rows={8}
            placeholder="例：開催趣旨、注意事項、持ち物などを記載…"
            className={inputClass}
          />
          <label className="text-ink-secondary mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.description_centered === 1}
              onChange={(e) => update('description_centered', e.target.checked ? 1 : 0)}
            />
            詳細を中央揃えで表示する
          </label>
        </div>
      </FormSection>

      <FormSection step={2} label="申し込みの上限">
        <Field
          label="1人あたりの予約回数"
          htmlFor="ev-max"
          note="同じ友だちが何回まで申し込めるかを決めます。"
        >
          <select
            id="ev-max"
            value={draft.max_bookings_per_friend ?? 'unlimited'}
            onChange={(e) =>
              update(
                'max_bookings_per_friend',
                e.target.value === 'unlimited' ? null : Number(e.target.value),
              )
            }
            className={inputClass}
          >
            <option value="unlimited">制限なし</option>
            <option value="1">1回まで</option>
            <option value="2">2回まで</option>
            <option value="3">3回まで</option>
            <option value="5">5回まで</option>
          </select>
        </Field>
      </FormSection>

      <FormSection step={3} label="公開対象">
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard
            selected={(draft.target_type ?? 'single') === 'single'}
            title="単一アカウント"
            note="1つのLINEアカウントで運用します"
            onClick={() => update('target_type', 'single')}
          />
          <ChoiceCard
            selected={draft.target_type === 'multi-account-dedup'}
            title="複数アカウント横断"
            note="重複なし配信に対応します"
            onClick={() => update('target_type', 'multi-account-dedup')}
          />
        </div>
        {draft.target_type === 'multi-account-dedup' && (
          <p className="text-ink-faint text-xs">
            対象アカウントの選択は編集画面で行います。ここで作ると、いま選んでいる
            アカウントが対象に入ります。
          </p>
        )}
      </FormSection>

      <div className="border-hairline mt-5 flex flex-wrap justify-between gap-2 border-t pt-4">
        <button
          onClick={onDraftSave}
          disabled={saving}
          className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          下書きとして保存
        </button>
        <button
          onClick={onNext}
          disabled={saving}
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
        >
          {saving ? '保存中...' : '概要を保存して次へ'}
        </button>
      </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// ② 予約枠
// ----------------------------------------------------------------

function SlotsStep({
  accountId,
  eventId,
  draft,
  update,
  slots,
  refreshSlots,
  saving,
  onBack,
  onNext,
}: {
  accountId: string
  eventId: string
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
  slots: EventSlot[]
  refreshSlots: () => Promise<void>
  saving: boolean
  onBack: () => void
  onNext: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 1枠ずつ
  const [date, setDate] = useState(todayJst())
  const [startTime, setStartTime] = useState('14:00')
  const [endTime, setEndTime] = useState('15:30')
  const [capacity, setCapacity] = useState('')

  // まとめて
  const [bulkStart, setBulkStart] = useState(todayJst())
  const [bulkEnd, setBulkEnd] = useState(todayJst())
  const [weekdays, setWeekdays] = useState<number[]>([6, 0])
  const [bandStart, setBandStart] = useState('14:00')
  const [bandEnd, setBandEnd] = useState('17:00')
  const [slotMinutes, setSlotMinutes] = useState(90)
  const [bulkCapacity, setBulkCapacity] = useState('')
  /*
    確認は設計の窓で出す。**ブラウザの `confirm()` を使わない。**
    何件できるのか・どの枠が消えるのかを本文で読ませられず、
    画像比較にも写らない。
  */
  const [bulkPreview, setBulkPreview] = useState<
    Array<{ starts_at: string; ends_at: string; capacity: number | null }> | null
  >(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [removeTarget, setRemoveTarget] = useState<EventSlot | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  async function addOne() {
    setBusy(true)
    setErr(null)
    try {
      const s = jstHHMMToUtcIso(date, startTime)
      const e = jstHHMMToUtcIso(date, endTime)
      if (s >= e) throw new Error('終了は開始より後にしてください')
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) {
        throw new Error('定員は1以上の数で入れてください')
      }
      await eventsApi.createSlots(accountId, eventId, [{ starts_at: s, ends_at: e, capacity: cap }])
      await refreshSlots()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addBulk() {
    setBusy(true)
    setErr(null)
    try {
      if (weekdays.length === 0) throw new Error('曜日を1つ以上選んでください')
      const patterns = splitBand(bandStart, bandEnd, slotMinutes)
      if (patterns.length === 0) {
        throw new Error('時間帯と1枠の長さが合いません。長さを短くするか時間帯を広げてください')
      }
      const cap = bulkCapacity === '' ? null : Number(bulkCapacity)
      const generated = generateBulkSlots({
        start_date: bulkStart,
        end_date: bulkEnd,
        weekdays,
        time_patterns: patterns,
        capacity: cap,
      })
      if (generated.length === 0) {
        throw new Error('条件に合う枠が0件でした。期間と曜日を確かめてください')
      }
      // 作る前に下見を出す。ここではまだ1件も作っていない。
      setBulkError('')
      setBulkPreview(generated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function createBulk() {
    if (!bulkPreview || bulkBusy) return
    setBulkBusy(true)
    setBulkError('')
    try {
      await eventsApi.createSlots(accountId, eventId, bulkPreview)
      setBulkPreview(null)
      await refreshSlots()
    } catch {
      // 400件ずつ送るので、途中で切れると一部だけ作られたまま残る。
      // どこまで作られたかを見せるため、失敗しても一覧を取り直す。
      setBulkError('枠を作りきれませんでした。途中まで作られていることがあります。一覧を読み直して、足りない分だけ追加してください。')
      await refreshSlots()
    } finally {
      setBulkBusy(false)
    }
  }

  /*
    申込が入っている枠はボタンを押せないようにしてある
    （`disabled={busy || taken > 0}`）。ここまで来るのは申込0件の枠だけ。
  */
  async function removeSlot() {
    if (!removeTarget || removing) return
    setRemoving(true)
    setRemoveError('')
    setErr(null)
    try {
      await eventsApi.deleteSlot(accountId, eventId, removeTarget.id)
      setRemoveTarget(null)
      await refreshSlots()
    } catch {
      setRemoveError('枠を削除できませんでした。あとから申込が入った可能性があります。読み直してから、もう一度お試しください。')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
      <div data-design="Left" className="bg-canvas rounded-card border-hairline min-w-0 flex-1 space-y-5 border p-6">
        <div>
          <h2 className="text-ink text-base font-semibold">予約枠を追加する</h2>
          <p className="text-ink-faint mt-0.5 text-xs">
            友だちが選べる日時を用意します。1つのイベントに複数の枠を作れます。
          </p>
        </div>

        {err && <p className="text-danger text-sm">{err}</p>}

        <FormSection step={1} label="枠を1つ追加する">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="日付" htmlFor="slot-date">
              <input
                id="slot-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="開始" htmlFor="slot-start">
              <input
                id="slot-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="終了" htmlFor="slot-end">
              <input
                id="slot-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="定員" htmlFor="slot-cap">
              <input
                id="slot-cap"
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="例：20"
                className={inputClass}
              />
            </Field>
          </div>
          <button
            onClick={addOne}
            disabled={busy}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            この枠を追加
          </button>
        </FormSection>

        <FormSection
          step={2}
          label="同じ条件の枠を一度に作る"
          note="期間と曜日を指定すると、その条件に合う枠をまとめて作れます。"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="開始日" htmlFor="bulk-start">
              <input
                id="bulk-start"
                type="date"
                value={bulkStart}
                onChange={(e) => setBulkStart(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="終了日" htmlFor="bulk-end">
              <input
                id="bulk-end"
                type="date"
                value={bulkEnd}
                onChange={(e) => setBulkEnd(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="曜日">
            <div className="flex flex-wrap gap-1.5">
              {['日', '月', '火', '水', '木', '金', '土'].map((w, i) => {
                const on = weekdays.includes(i)
                return (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setWeekdays((cur) =>
                        cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i],
                      )
                    }
                    className={`rounded-control border px-3 py-1.5 text-sm ${
                      on ? 'border-accent bg-accent-soft text-ink' : 'border-hairline text-ink-faint'
                    }`}
                  >
                    {w}
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="時間帯" htmlFor="band-start">
              <input
                id="band-start"
                type="time"
                value={bandStart}
                onChange={(e) => setBandStart(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="　" htmlFor="band-end">
              <input
                id="band-end"
                type="time"
                value={bandEnd}
                onChange={(e) => setBandEnd(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="1枠の長さ" htmlFor="slot-min">
              <select
                id="slot-min"
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(Number(e.target.value))}
                className={inputClass}
              >
                {[30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m}分
                  </option>
                ))}
              </select>
            </Field>
            <Field label="各枠の定員" htmlFor="bulk-cap">
              <input
                id="bulk-cap"
                inputMode="numeric"
                value={bulkCapacity}
                onChange={(e) => setBulkCapacity(e.target.value)}
                placeholder="例：20"
                className={inputClass}
              />
            </Field>
          </div>
          <button
            onClick={addBulk}
            disabled={busy}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            まとめて追加
          </button>
        </FormSection>

        <FormSection
          step={3}
          label="いま登録されている枠"
          note="申込が入っている枠は削除できません。"
        >
          {slots.length === 0 ? (
            <p className="text-ink-faint border-hairline rounded-card border border-dashed p-6 text-center text-sm">
              まだ枠がありません。枠を1つも作らないと公開できません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-hairline text-ink-faint border-b text-xs">
                    <th className="px-2 py-2 text-left font-semibold">日時</th>
                    <th className="px-2 py-2 text-right font-semibold">定員</th>
                    <th className="px-2 py-2 text-right font-semibold">申込</th>
                    <th className="px-2 py-2 text-right font-semibold">残り</th>
                    <th className="px-2 py-2 text-right font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => {
                    const taken = s.active_count ?? 0
                    return (
                      <tr key={s.id} className="border-hairline border-b last:border-b-0">
                        <td className="text-ink px-2 py-2">
                          {formatSlotJp(s.starts_at, s.ends_at)}
                        </td>
                        <td className="text-ink-secondary px-2 py-2 text-right tabular-nums">
                          {s.capacity == null ? '無制限' : `${s.capacity}名`}
                        </td>
                        <td className="text-ink-secondary px-2 py-2 text-right tabular-nums">
                          {taken}名
                        </td>
                        <td className="text-ink-secondary px-2 py-2 text-right tabular-nums">
                          {s.capacity == null ? '—' : `${Math.max(0, s.capacity - taken)}名`}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={() => { setRemoveError(''); setRemoveTarget(s) }}
                            disabled={busy || taken > 0}
                            title={taken > 0 ? '申込が入っているため削除できません' : undefined}
                            className="text-danger text-xs hover:underline disabled:no-underline disabled:opacity-30"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>

        <FormSection
          step={4}
          label="キャンセルとリマインダ"
          note="予約した友だちのLINEに自動で届きます。"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="キャンセルできる期限" htmlFor="cancel-deadline">
              <select
                id="cancel-deadline"
                value={draft.cancel_deadline_hours_before ?? ''}
                onChange={(e) =>
                  update(
                    'cancel_deadline_hours_before',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                className={inputClass}
              >
                <option value="">いつでもキャンセルできる</option>
                <option value="2">開始の2時間前まで</option>
                <option value="24">開始の24時間前まで</option>
                <option value="48">開始の48時間前まで</option>
              </select>
            </Field>
            <Field label="開始前のお知らせ" htmlFor="reminder-hours">
              <select
                id="reminder-hours"
                value={draft.reminder_hours_before ?? ''}
                onChange={(e) =>
                  update(
                    'reminder_hours_before',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                className={inputClass}
              >
                <option value="">送らない</option>
                <option value="1">開始の1時間前に送る</option>
                <option value="2">開始の2時間前に送る</option>
                <option value="3">開始の3時間前に送る</option>
              </select>
            </Field>
          </div>
          <label className="text-ink-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.reminder_day_before_enabled === 1}
              onChange={(e) => update('reminder_day_before_enabled', e.target.checked ? 1 : 0)}
            />
            前日にもお知らせを送る
          </label>
        </FormSection>

        <StepFooter
          back={{ label: '概要に戻る', onClick: onBack }}
          next={{ label: '保存して公開設定へ', onClick: onNext }}
          saving={saving}
        />
      </div>

      <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-80">
        <AsideCard title="友だちの画面での見え方" note="プレビュー">
          <div className="bg-canvas-sunken rounded-card p-3">
            <p className="text-ink-faint mb-2 text-xs">日時を選んでください</p>
            {slots.length === 0 ? (
              <p className="text-ink-faint text-xs">枠を追加すると、ここに並びます。</p>
            ) : (
              <ul className="space-y-1.5">
                {slots.slice(0, 5).map((s) => (
                  <li
                    key={s.id}
                    className="text-ink border-hairline rounded-control border bg-white px-3 py-2 text-xs"
                  >
                    {formatSlotJp(s.starts_at, s.ends_at)}
                    {s.capacity != null && ` 残り${Math.max(0, s.capacity - (s.active_count ?? 0))}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </AsideCard>

        <AsideCard title="気をつけること">
          <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
            <li>・枠を1つも作らないと公開できません</li>
            <li>・申込が入った枠は、定員を減らせません</li>
            <li>・まとめて追加した枠も、1件ずつ編集・削除できます</li>
          </ul>
        </AsideCard>
      </div>

      <ConfirmDialog
        open={bulkPreview !== null}
        title={`${bulkPreview?.length ?? 0}件の予約枠を追加しますか？`}
        description={`${bulkPreview && bulkPreview.length > 0 ? formatSlotJp(bulkPreview[0].starts_at, bulkPreview[0].ends_at) : ''}から${bulkPreview && bulkPreview.length > 0 ? formatSlotJp(bulkPreview[bulkPreview.length - 1].starts_at, bulkPreview[bulkPreview.length - 1].ends_at) : ''}までをまとめて追加します。いまある枠は消えません。追加した枠は1件ずつ削除できます（申込が入ったあとは削除できません）。`}
        confirmLabel="まとめて追加する"
        busy={bulkBusy}
        error={bulkError}
        onConfirm={() => void createBulk()}
        onCancel={() => {
          if (bulkBusy) return
          setBulkError('')
          setBulkPreview(null)
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="この予約枠を削除しますか？"
        description={`${removeTarget ? formatSlotJp(removeTarget.starts_at, removeTarget.ends_at) : ''}の枠を削除します。この枠はもう選べなくなります。いま申込は入っていません。ほかの枠とイベント本体は残ります。この操作は元に戻せません。`}
        confirmLabel="削除する"
        destructive
        busy={removing}
        error={removeError}
        onConfirm={() => void removeSlot()}
        onCancel={() => {
          if (removing) return
          setRemoveError('')
          setRemoveTarget(null)
        }}
      />
    </div>
  )
}

// ----------------------------------------------------------------
// ③ 公開設定
// ----------------------------------------------------------------

function PublishStep({
  draft,
  update,
  tags,
  slots,
  saving,
  onBack,
  onPublish,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
  tags: Array<{ id: string; name: string }>
  slots: EventSlot[]
  saving: boolean
  onBack: () => void
  onPublish: () => void
}) {
  const preview = useMemo(() => {
    const first = slots[0]
    const lines = [
      draft.confirmation_message_extra?.trim() || 'ご予約ありがとうございます。',
      `イベント：${draft.name || '（イベント名）'}`,
      first ? `日時：${formatSlotJp(first.starts_at, first.ends_at)}` : '日時：（枠を追加すると出ます）',
    ]
    if (draft.venue_name) lines.push(`場所：${draft.venue_name}`)
    if (draft.cancel_deadline_hours_before) {
      lines.push(
        `キャンセルは開始の${draft.cancel_deadline_hours_before}時間前までにこのトークからご連絡ください。`,
      )
    }
    return lines.join('\n')
  }, [draft, slots])

  const noSlots = slots.length === 0

  return (
    <div data-design="Body" className="flex flex-col gap-4 xl:flex-row">
      <div data-design="Left" className="bg-canvas rounded-card border-hairline min-w-0 flex-1 space-y-5 border p-6">
        <div>
          <h2 className="text-ink text-base font-semibold">公開設定を決める</h2>
          <p className="text-ink-faint mt-0.5 text-xs">
            申込の受け方と、友だちに送るお知らせを設定します。
          </p>
        </div>

        <FormSection step={1} label="どう受け付けるか">
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              selected={draft.requires_approval !== 1}
              title="先着順で自動確定"
              note="定員に達するまで、申込がそのまま確定します"
              onClick={() => update('requires_approval', 0)}
            />
            <ChoiceCard
              selected={draft.requires_approval === 1}
              title="承認制"
              note="こちらで確認してから確定します"
              onClick={() => update('requires_approval', 1)}
            />
          </div>
          <label className="text-ink-secondary flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.waitlist_enabled === 1}
              onChange={(e) => update('waitlist_enabled', e.target.checked ? 1 : 0)}
            />
            <span>
              定員に達したらキャンセル待ちを受け付ける
              <span className="text-ink-faint block text-xs">
                空きが出たら、待っている方に自動でお知らせします。
              </span>
            </span>
          </label>
        </FormSection>

        <FormSection step={2} label="誰に見せるか">
          <div className="grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              selected={!draft.visible_tag_id}
              title="友だち全員"
              note="予約ページのURLを知っている人は誰でも申し込めます"
              onClick={() => update('visible_tag_id', null)}
            />
            <ChoiceCard
              selected={Boolean(draft.visible_tag_id)}
              title="タグで絞り込む"
              note="指定したタグを持つ人だけが申し込めます"
              onClick={() => update('visible_tag_id', draft.visible_tag_id ?? (tags[0]?.id ?? null))}
            />
          </div>
          {draft.visible_tag_id && (
            <Field label="対象のタグ" htmlFor="visible-tag">
              <select
                id="visible-tag"
                value={draft.visible_tag_id ?? ''}
                onChange={(e) => update('visible_tag_id', e.target.value || null)}
                className={inputClass}
              >
                {tags.length === 0 && <option value="">（タグがありません）</option>}
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </FormSection>

        <FormSection step={3} label="いつまで受け付けるか">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="公開する日時"
              note="日時を指定しての予約公開は、まだ保存する場所がありません。"
            >
              <select disabled className={`${inputClass} opacity-50`} title="準備中です">
                <option>すぐに公開する</option>
              </select>
            </Field>
            <Field label="申込の締め切り" htmlFor="entry-cutoff">
              <select
                id="entry-cutoff"
                value={draft.entry_cutoff_hours_before ?? ''}
                onChange={(e) =>
                  update(
                    'entry_cutoff_hours_before',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                className={inputClass}
              >
                <option value="">開始まで受け付ける</option>
                <option value="2">開始の2時間前まで</option>
                <option value="24">開始の24時間前まで</option>
                <option value="48">開始の48時間前まで</option>
              </select>
            </Field>
          </div>
        </FormSection>

        <FormSection
          step={4}
          label="自動で送るメッセージ"
          note="必ず入る予約内容に、前後の文章を足せます。"
        >
          <Field label="予約が確定したときに添える文章" htmlFor="msg-confirm">
            <textarea
              id="msg-confirm"
              rows={3}
              value={draft.confirmation_message_extra ?? ''}
              onChange={(e) => update('confirmation_message_extra', e.target.value || null)}
              placeholder="例：ご予約ありがとうございます。当日は10分前にお越しください。"
              className={inputClass}
            />
          </Field>
          <Field label="開始前のお知らせに添える文章" htmlFor="msg-reminder">
            <textarea
              id="msg-reminder"
              rows={3}
              value={draft.reminder_message_extra ?? ''}
              onChange={(e) => update('reminder_message_extra', e.target.value || null)}
              placeholder="例：お足元にお気をつけてお越しください。"
              className={inputClass}
            />
          </Field>
          <label className="text-ink-faint flex items-start gap-2 text-sm" title="準備中です">
            <input type="checkbox" disabled className="mt-0.5" />
            <span>
              主催者にもメールで知らせる
              <span className="block text-xs">
                申込が入るたびに、登録メールアドレスへ届きます。保存する場所がまだありません。
              </span>
            </span>
          </label>
        </FormSection>

        <FormSection step={5} label="公開">
          <label className="text-ink-secondary flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={draft.is_published === 1}
              disabled={noSlots}
              onChange={(e) => update('is_published', e.target.checked ? 1 : 0)}
            />
            <span>
              保存したらすぐ公開する
              <span className="text-ink-faint block text-xs">
                オフにすると下書きとして保存され、URLを開いても表示されません。
              </span>
            </span>
          </label>
          {/* 枠が0件のイベントは、公開しても friend 側に日時が1つも出ない。
              公開できてしまうと「公開したのに申し込めない」になる。 */}
          {noSlots && (
            <p className="text-warning text-xs">
              予約枠がまだ1件もありません。枠を追加するまで公開できません。
            </p>
          )}
        </FormSection>

        <StepFooter
          back={{ label: '予約枠に戻る', onClick: onBack }}
          next={{ label: '保存して公開', onClick: onPublish }}
          saving={saving}
        />
      </div>

      <div data-design="Right" className="w-full shrink-0 space-y-4 xl:w-80">
        <AsideCard title="確定したときに届くメッセージ" note="プレビュー">
          <div className="bg-canvas-sunken rounded-card p-3">
            <p className="text-ink-faint mb-1 text-xs">然-NEN-</p>
            <p className="text-ink rounded-2xl bg-white px-4 py-3 text-sm leading-6 whitespace-pre-wrap">
              {preview}
            </p>
          </div>
        </AsideCard>

        <AsideCard title="気をつけること">
          <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
            <li>・公開後に日時を変えると、申込済みの方へ変更のお知らせが届きます</li>
            <li>・承認制にすると、申込直後は「受付中」の表示になります</li>
            <li>・タグで絞ると、対象外の方にはページが表示されません</li>
          </ul>
        </AsideCard>
      </div>
    </div>
  )
}
