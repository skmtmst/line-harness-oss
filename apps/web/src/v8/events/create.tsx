'use client'

/*
 * ★V8 イベント予約「イベントを作る」（Pencil `d4adD4`）。
 *
 * 型（CreatePage）に、中身・公開対象・最初の予約枠・申し込みのきまり・聞くこと・
 * 申し込んだ人にすること のカードと、右の列（お客さまの申込ページ・保存すると起きること）、
 * 下の帯（キャンセル・下書きを保存・公開する）をはめる。
 * 今の作り（3段階のウィザード）と同じ口を使う：イベントを作る → 最初の枠を作る。
 * 公開は作るときに is_published=1 で送る。絵と今の作りの違いは BEHAVIOR.md。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Globe, User, Users, X } from 'lucide-react'
import { ApiError, eventsApi, type EventDetail, type EventQuestion } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import DateField from '@/components/shared/date-field'
import { TimeField } from '@/components/shared/date-time-field'
import ApplicationPreview from './application-preview'
import { EVENT_DEFAULT_DRAFT, ENTRY_CUTOFF_OPTIONS, NONE, jstToUtcIso, todayJst } from './shared'
import styles from './create.module.css'

const PER_FRIEND_OPTIONS = [
  { value: NONE, label: '制限なし' },
  { value: '1', label: '1 回まで' },
  { value: '2', label: '2 回まで' },
  { value: '3', label: '3 回まで' },
]
/* 承認：しない／する（期限つき）。期限は今の作りと同じ 2・24・72 時間。 */
const APPROVAL_OPTIONS = [
  { value: 'off', label: '承認しないで確定' },
  { value: '2', label: '承認してから確定（期限 2 時間）' },
  { value: '24', label: '承認してから確定（期限 24 時間）' },
  { value: '72', label: '承認してから確定（期限 72 時間）' },
]
const WAITLIST_OPTIONS = [
  { value: '0', label: '締め切る（キャンセル待ちを受けない）' },
  { value: '1', label: 'キャンセル待ちを受ける（空いたら順番に案内）' },
]

type QuestionDraft = { label: string; required: boolean }

/* useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。 */
export default function EventsCreateV8() {
  return (
    <Suspense fallback={null}>
      <EventsCreateV8Inner />
    </Suspense>
  )
}

function EventsCreateV8Inner() {
  usePageTitle('イベントを作る')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  const canEdit = role === null || role === 'owner' || role === 'admin'

  /*
   * 今の作りは ①を保存すると /events/new?id=…&step=2 で続きを開く。
   * V8 は1枚で作り終えるので、作り済みのイベントは編集の画面で続ける。
   */
  const continuingId = searchParams.get('id')
  useEffect(() => {
    if (continuingId) router.replace(`/events/edit?id=${encodeURIComponent(continuingId)}`)
  }, [continuingId, router])

  const [draft, setDraft] = useState<EventDetail>(EVENT_DEFAULT_DRAFT)
  const [date, setDate] = useState(todayJst)
  const [startTime, setStartTime] = useState('14:00')
  const [endTime, setEndTime] = useState('15:30')
  const [capacity, setCapacity] = useState('')
  const [questions, setQuestions] = useState<QuestionDraft[]>([])
  const [adding, setAdding] = useState<QuestionDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const focusTarget = useRef<string | null>(null)
  useEffect(() => {
    const id = focusTarget.current
    if (!id) return
    focusTarget.current = null
    const field = document.getElementById(id)
    field?.focus()
    field?.scrollIntoView({ block: 'center' })
  }, [fieldErrors])
  const clearFieldError = (id: string) => setFieldErrors((current) => {
    if (!current[id]) return current
    const next = { ...current }
    delete next[id]
    return next
  })
  const createdIdRef = useRef<string | null>(null)

  const update = <K extends keyof EventDetail>(key: K, value: EventDetail[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const snapshot = JSON.stringify({ draft, date, startTime, endTime, capacity, questions })
  const initialRef = useRef(snapshot)
  const dirty = snapshot !== initialRef.current
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  async function save(publish: boolean) {
    if (saving || !canEdit) return
    if (!selectedAccountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    const errors: Record<string, string> = {}
    if (!draft.name.trim()) errors['ev-new-name'] = 'イベント名を入れてください'
    if (draft.venue_url) {
      try {
        const url = new URL(draft.venue_url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
      } catch {
        errors['ev-new-url'] = 'http または https で始まる URL を入れてください'
      }
    }
    if (!date) errors['ev-new-date'] = '日付を選んでください'
    if (!startTime) errors['ev-new-start'] = '開始の時刻を入れてください'
    if (!endTime) errors['ev-new-end'] = '終わりの時刻を入れてください'
    else if (startTime && endTime <= startTime) errors['ev-new-end'] = '終了は開始より後にしてください'
    const cap = Number(capacity)
    if (!Number.isInteger(cap) || cap < 1) errors['ev-new-cap'] = '定員は1以上の数で入れてください'
    setError(null)
    focusTarget.current = Object.keys(errors)[0] ?? null
    setFieldErrors(errors)
    if (focusTarget.current) return
    setSaving(true)
    setError(null)
    let eventId = createdIdRef.current
    try {
      const qs: EventQuestion[] = questions.map((question, index) => ({
        id: `q${index + 1}`, label: question.label, type: 'text', required: question.required, options: null,
      }))
      const payload: Partial<EventDetail> = {
        ...draft,
        name: draft.name.trim(),
        is_published: publish ? 1 : 0,
        questions: qs,
        account_ids: (draft.target_type ?? 'single') === 'multi-account-dedup' ? [selectedAccountId] : null,
      }
      delete payload.id
      delete payload.version
      if (!eventId) {
        const created = await eventsApi.createEvent(selectedAccountId, payload)
        eventId = created.id
        createdIdRef.current = eventId
      }
      const startsAt = jstToUtcIso(date, startTime)
      const endsAt = jstToUtcIso(date, endTime)
      // 再送しても枠を二重に作らない（今の作りと同じ固定キー）。
      await eventsApi.createSlots(selectedAccountId, eventId, [
        { starts_at: startsAt, ends_at: endsAt, capacity: Number(capacity), client_key: `first-slot:${eventId}` },
      ])
      initialRef.current = snapshot
      router.push(`/events?highlight=${encodeURIComponent(eventId)}`)
    } catch (cause) {
      const reason = cause instanceof ApiError && cause.status === 403
        ? 'イベントを作れるのは統括と管理者だけです。'
        : cause instanceof Error ? cause.message : '保存できませんでした。もう一度お試しください。'
      setError(eventId
        ? `イベントは下書きで作りましたが、最初の予約枠を作れませんでした。もう一度押すと続きから作ります。（${reason}）`
        : reason)
      setSaving(false)
    }
  }

  const capNumber = Number(capacity)
  const previewWhen = `${formatDay(date)} ${startTime}〜${draft.venue_name ? `・${draft.venue_name}` : ''}`

  const side = (
    <div className={styles.side}>
      <section className={styles.sideCard} aria-labelledby="ev-new-preview">
        <h2 className={styles.sideTitle} id="ev-new-preview">お客さまの申込ページ</h2>
        <div className={styles.phone} aria-label="申込ページの見え方">
          <p className={styles.phoneName}>{draft.name.trim() || 'イベント名'}</p>
          <p className={styles.phoneWhen}>{previewWhen}</p>
          <p className={styles.phoneLeft}>{Number.isInteger(capNumber) && capNumber > 0 ? `残り ${capNumber} 席` : '残り — 席'}</p>
          <span className={styles.phoneButton} aria-hidden="true">申し込む</span>
        </div>
        {selectedAccountId ? (
          <ApplicationPreview
            accountId={selectedAccountId}
            draft={{ ...draft, questions: questions.map((question, index) => ({ id: `q${index + 1}`, label: question.label, type: 'text', required: question.required, options: null })) }}
            date={date}
            startTime={startTime}
            endTime={endTime}
            capacity={capacity}
          />
        ) : null}
      </section>
      <section className={styles.sideCard} aria-labelledby="ev-new-after">
        <h2 className={styles.sideTitle} id="ev-new-after">保存すると起きること</h2>
        <p className={styles.careText}>
          ・下書きとして保存され、お客さまには見えません<br />
          ・「公開する」と申込ページの URL が使えるようになります<br />
          ・定員に達すると自動で満席になります
        </p>
      </section>
    </div>
  )

  if (!canEdit) {
    return (
      <CreatePage
        boardId="d4adD4"
        title="イベントを作る"
        description="中身・回と定員・申し込みのきまりを決めます。下書きのあいだは、お客さまには見えません。"
        footerActions={<Button href="/events">一覧へ戻る</Button>}
      >
        <Notice tone="info">イベントを作れるのは統括と管理者だけです。必要なときは統括に頼んでください。</Notice>
      </CreatePage>
    )
  }

  return (
    <CreatePage
      boardId="d4adD4"
      title="イベントを作る"
      description="中身・回と定員・申し込みのきまりを決めます。下書きのあいだは、お客さまには見えません。"
      preview={side}
      status={saving ? '保存しています…' : undefined}
      footerActions={(
        <>
          <Button href="/events">キャンセル</Button>
          <Button disabled={saving} busy={saving} onClick={() => void save(false)}>下書きを保存</Button>
          <Button variant="primary" disabled={saving} busy={saving} onClick={() => void save(true)}><Globe size={15} aria-hidden="true" />公開する</Button>
        </>
      )}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section className={styles.card} aria-labelledby="ev-new-body">
        <h2 className={styles.cardTitle} id="ev-new-body">イベントの中身</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ev-new-name">イベント名</label>
          <TextField
            id="ev-new-name"
            value={draft.name}
            maxLength={255}
            placeholder="秋のしつけ教室（第1回）"
            aria-invalid={Boolean(fieldErrors['ev-new-name']) || undefined}
            aria-describedby={fieldErrors['ev-new-name'] ? 'ev-new-name-error' : undefined}
            required
            onChange={(event) => {
              update('name', event.target.value)
              clearFieldError('ev-new-name')
            }}
          />
          {fieldErrors['ev-new-name'] ? <p id="ev-new-name-error" className={styles.fieldError} role="alert">{fieldErrors['ev-new-name']}</p> : null}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ev-new-desc">説明</label>
          <TextField
            id="ev-new-desc"
            value={draft.description ?? ''}
            maxLength={20000}
            placeholder="開催趣旨・注意事項・持ち物など"
            onChange={(event) => update('description', event.target.value || null)}
          />
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ev-new-venue">場所</label>
            <TextField
              id="ev-new-venue"
              value={draft.venue_name ?? ''}
              placeholder="渋谷ベース 3F"
              onChange={(event) => update('venue_name', event.target.value || null)}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.labelRow}>
              <label className={styles.label} htmlFor="ev-new-url">オンラインの URL</label>
              <span className={styles.optional}>任意</span>
            </span>
            <TextField
              id="ev-new-url"
              type="url"
              value={draft.venue_url ?? ''}
              placeholder="https://…（確定した人だけに見せます）"
              aria-invalid={Boolean(fieldErrors['ev-new-url']) || undefined}
              aria-describedby={fieldErrors['ev-new-url'] ? 'ev-new-url-error' : undefined}
              onChange={(event) => { update('venue_url', event.target.value || null); clearFieldError('ev-new-url') }}
            />
            {fieldErrors['ev-new-url'] ? <p id="ev-new-url-error" className={styles.fieldError} role="alert">{fieldErrors['ev-new-url']}</p> : null}
          </div>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="ev-new-target">
        <h2 className={styles.cardTitle} id="ev-new-target">公開対象</h2>
        <RadioCardGroup legend="公開対象" className={styles.cardRow}>
          <RadioCard
            name="ev-new-target"
            value="single"
            checked={(draft.target_type ?? 'single') === 'single'}
            onChange={() => update('target_type', 'single')}
            icon={<User size={16} aria-hidden="true" />}
            title="1つの LINE アカウント"
            note="このアカウントの友だちに出します"
          />
          <RadioCard
            name="ev-new-target"
            value="multi-account-dedup"
            checked={draft.target_type === 'multi-account-dedup'}
            onChange={() => update('target_type', 'multi-account-dedup')}
            icon={<Users size={16} aria-hidden="true" />}
            title="複数アカウント横断"
            note="同じ人に重ねて出しません"
          />
        </RadioCardGroup>
      </section>

      <section className={styles.card} aria-labelledby="ev-new-slot">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="ev-new-slot">最初の予約枠</h2>
          <p className={styles.cardNote}>あとから回を足せます（中身を見る → 回を足す）</p>
        </div>
        <div className={`${styles.pair} ${styles.datePair}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ev-new-date">日付</label>
            <DateField id="ev-new-date" value={date} invalid={Boolean(fieldErrors['ev-new-date'])} aria-describedby={fieldErrors['ev-new-date'] ? 'ev-new-date-error' : undefined} onChange={(value) => { setDate(value); clearFieldError('ev-new-date') }} />
            {fieldErrors['ev-new-date'] ? <p id="ev-new-date-error" className={styles.fieldError} role="alert">{fieldErrors['ev-new-date']}</p> : null}
          </div>
          <div className={styles.field}>
            <span className={styles.label} id="ev-new-time-label">開始</span>
            <div className={styles.timeRow} role="group" aria-labelledby="ev-new-time-label">
              <TimeField id="ev-new-start" aria-label="開始の時刻" invalid={Boolean(fieldErrors['ev-new-start'])} aria-describedby={fieldErrors['ev-new-start'] ? 'ev-new-time-error' : undefined} value={startTime} onChange={(value) => { setStartTime(value); clearFieldError('ev-new-start'); clearFieldError('ev-new-end') }} />
              <span className={styles.timeSep} aria-hidden="true">〜</span>
              <TimeField id="ev-new-end" aria-label="終わりの時刻" invalid={Boolean(fieldErrors['ev-new-end'])} aria-describedby={fieldErrors['ev-new-end'] ? 'ev-new-time-error' : undefined} value={endTime} onChange={(value) => { setEndTime(value); clearFieldError('ev-new-end') }} />
            </div>
            {fieldErrors['ev-new-start'] || fieldErrors['ev-new-end'] ? <p id="ev-new-time-error" className={styles.fieldError} role="alert">{fieldErrors['ev-new-start'] || fieldErrors['ev-new-end']}</p> : null}
          </div>
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ev-new-cap">定員</label>
            <TextField
              id="ev-new-cap"
              inputMode="numeric"
              value={capacity}
              placeholder="20 人"
              aria-invalid={Boolean(fieldErrors['ev-new-cap']) || undefined}
              aria-describedby={fieldErrors['ev-new-cap'] ? 'ev-new-cap-error' : undefined}
              onChange={(event) => { setCapacity(event.target.value.replace(/[^0-9]/g, '')); clearFieldError('ev-new-cap') }}
            />
            {fieldErrors['ev-new-cap'] ? <p id="ev-new-cap-error" className={styles.fieldError} role="alert">{fieldErrors['ev-new-cap']}</p> : null}
          </div>
          <div className={styles.field}>
            <span className={styles.pickLabel}>1人あたりの予約回数</span>
            <Select
              aria-label="1人あたりの予約回数"
              size="full"
              value={draft.max_bookings_per_friend == null ? NONE : String(draft.max_bookings_per_friend)}
              onChange={(value) => update('max_bookings_per_friend', value === NONE ? null : Number(value))}
              options={PER_FRIEND_OPTIONS}
            />
          </div>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="ev-new-rules">
        <h2 className={styles.cardTitle} id="ev-new-rules">申し込みのきまり</h2>
        <div className={styles.pair}>
          <div className={styles.field}>
            <span className={styles.pickLabel}>申し込みの上限</span>
            <Select
              aria-label="申し込みの上限"
              size="full"
              value={draft.entry_cutoff_hours_before == null ? NONE : String(draft.entry_cutoff_hours_before)}
              onChange={(value) => update('entry_cutoff_hours_before', value === NONE ? null : Number(value))}
              options={ENTRY_CUTOFF_OPTIONS}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.pickLabel}>承認</span>
            <Select
              aria-label="承認"
              size="full"
              value={draft.requires_approval ? String(draft.approval_deadline_hours) : 'off'}
              onChange={(value) => {
                if (value === 'off') {
                  update('requires_approval', 0)
                } else {
                  setDraft((current) => ({ ...current, requires_approval: 1, approval_deadline_hours: Number(value) }))
                }
              }}
              options={APPROVAL_OPTIONS}
            />
          </div>
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <span className={styles.pickLabel}>満席になったとき</span>
            <Select
              aria-label="満席になったとき"
              size="full"
              value={String(draft.waitlist_enabled ?? 0)}
              onChange={(value) => update('waitlist_enabled', Number(value))}
              options={WAITLIST_OPTIONS}
            />
          </div>
          <span className={styles.field} aria-hidden="true" />
        </div>
      </section>

      <section className={styles.card} aria-labelledby="ev-new-questions">
        <h2 className={styles.cardTitle} id="ev-new-questions">申し込みのときに聞くこと</h2>
        {questions.length > 0 ? (
          <ul className={styles.questionList}>
            {questions.map((question, index) => (
              <li key={`${question.label}-${index}`} className={styles.questionRow}>
                <span className={styles.questionLabel}>{question.label}</span>
                {question.required ? <span className={styles.required}>必須</span> : <span className={styles.optional}>任意</span>}
                <Button
                  variant="text"
                  aria-label={`質問「${question.label}」を外す`}
                  onClick={() => setQuestions((current) => current.filter((_, at) => at !== index))}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.questionEmpty}>まだ聞くことはありません。ペットの名前など、申し込みのたびに聞きたいことを足せます。</p>
        )}
        {adding ? (
          <div className={styles.addRow}>
            <TextField
              aria-label="聞くこと"
              placeholder="例：ペットの名前と年齢"
              value={adding.label}
              maxLength={200}
              onChange={(event) => setAdding({ ...adding, label: event.target.value })}
            />
            <Checkbox checked={adding.required} onCheckedChange={(checked) => setAdding({ ...adding, required: checked })}>必須</Checkbox>
            <Button
              disabled={!adding.label.trim()}
              onClick={() => {
                setQuestions((current) => [...current, { label: adding.label.trim(), required: adding.required }])
                setAdding(null)
              }}
            >足す</Button>
            <Button variant="text" onClick={() => setAdding(null)}>やめる</Button>
          </div>
        ) : (
          <div className={styles.linkRow}>
            <button type="button" className={styles.linkButton} onClick={() => setAdding({ label: '', required: true })}>＋ 質問を足す</button>
          </div>
        )}
      </section>

      <section className={styles.card} aria-labelledby="ev-new-after-apply">
        <h2 className={styles.cardTitle} id="ev-new-after-apply">申し込んだ人にすること</h2>
        <div className={styles.checks}>
          <div className={styles.checkItem}>
            <Checkbox checked disabled onCheckedChange={() => {}} title="申込の受付は、いつも LINE でお知らせします">
              申込を受けたら LINE で知らせる
            </Checkbox>
            <p className={styles.checkSub}>日時・場所が届きます</p>
          </div>
          <Checkbox
            checked={draft.reminder_day_before_enabled === 1}
            onCheckedChange={(checked) => update('reminder_day_before_enabled', checked ? 1 : 0)}
          >
            前日に思い出してもらう
          </Checkbox>
        </div>
      </section>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力したイベント" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}

function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return '日付未定'
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const week = ['日', '月', '火', '水', '木', '金', '土'][day.getUTCDay()]
  return `${Number(match[2])}/${Number(match[3])}（${week}）`
}
