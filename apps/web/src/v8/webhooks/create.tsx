'use client'

/*
 * ★V8 外部連携「送り先を作る」（Pencil `hsD8e`、競合 `NGh7b`）。
 *
 * 型（CreatePage）に、どちら向き・どこへ・いつ・送れなかったときのカードと、
 * 右の列（届く中身の見本・試しに送る・気をつけること）、下の帯
 * （キャンセル・下書きを保存・つくって動かす）をはめる。
 * データの口は v7 と同じ（作成・本人確認・未保存の番兵）。`?event=` で見本の出来事を選んでおく。
 * 絵と今の作りが合わない所は BEHAVIOR.md に書いた（競合の口が無い・それでも送れないときの口が無い など）。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronUp, Inbox, RefreshCw, Send } from 'lucide-react'
import { EC_EVENT_TYPES, ecEventLabel } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
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
import { isStepUpRequired, useStepUpGate } from '@/components/step-up-prompt'
import { MIN_SECRET_LENGTH, generateSecret } from './secret'
import styles from './create.module.css'

/*
 * 送る出来事。正本は packages/db/src/webhooks.ts の KNOWN_OUTGOING_EVENT_TYPES。
 * 絵（hsD8e）の箱（友だち・運用・EC）に出すのはよく使うものだけ。ほかの出来事も消さずに、
 * 「詳細条件」を開くと選べる（選んであれば最初から開いておく）。
 */
export const EVENT_GROUPS: ReadonlyArray<{ id: string; label: string; events: ReadonlyArray<{ value: string; label: string }> }> = [
  {
    id: 'friends',
    label: '友だち',
    events: [
      { value: 'friend_add', label: '友だちになった' },
      { value: 'friend_unfollow', label: '友だちを解除された' },
      { value: 'tag_change', label: 'タグが付いた' },
    ],
  },
  {
    id: 'operation',
    label: '運用',
    events: [
      { value: 'message_received', label: '問い合わせが来た' },
      { value: 'booking_created', label: '予約が入った' },
    ],
  },
  {
    id: 'ec',
    label: 'EC',
    events: [
      { value: 'ec.order.confirmed', label: '注文が確定した' },
      { value: 'ec.order.shipped', label: '発送した' },
    ],
  },
]
const PRIMARY_EVENTS = new Set(EVENT_GROUPS.flatMap((group) => group.events.map((event) => event.value)))
export const OTHER_EVENTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'form_submitted', label: 'フォームが送られた' },
  { value: 'postback_received', label: 'ボタンが押された' },
  { value: 'staff_assigned', label: '担当が決まった' },
  { value: 'manual_reply_sent', label: '個別に返信した' },
  { value: 'cv_fire', label: '成果地点が起きた' },
  ...EC_EVENT_TYPES.filter((value) => !PRIMARY_EVENTS.has(value)).map((value) => ({ value, label: ecEventLabel(value) })),
]
const ALL_EVENTS = [...PRIMARY_EVENTS, ...OTHER_EVENTS.map((event) => event.value)]

const RETRY_OPTIONS = [
  { value: '0', label: '送り直さない' },
  { value: '1', label: '1 回まで' },
  { value: '3', label: '3 回まで（1分・5分・30分あと）' },
  { value: '7', label: '7 回まで' },
]

/* 届く中身の見本（実際に送る形の例。値は見本と分かるもの）。1行ずつ持つ。 */
const SAMPLES: Record<string, { when: string; lines: string[] }> = {
  friend_add: {
    when: '友だちになったとき',
    lines: ['{', '  "できごと": "友だちになった",', '  "友だちID": "U4af…",', '  "名前": "Kenta Kawano",', '  "タグ": ["Instagram"],', '  "日時": "2026-09-30T10:12"', '}'],
  },
  booking_created: {
    when: '予約が入ったとき',
    lines: ['{', '  "できごと": "予約が入った",', '  "予約ID": "bk_8f2…",', '  "メニュー": "カウンセリング 30分",', '  "友だち": "Masato S."', '}'],
  },
  'ec.order.confirmed': {
    when: '注文が確定したとき',
    lines: ['{', '  "できごと": "注文が確定した",', '  "注文番号": "ord_123…",', '  "金額": 4980,', '  "友だち": "菅野 亮"', '}'],
  },
}

/* 1欄ずつの確かめ。文は「何をすれば直るか」を1文で書く。 */
function validateName(value: string): string | null {
  return value.trim() ? null : '名前を入力してください'
}
function validateUrl(value: string): string | null {
  return /^https:\/\//.test(value.trim()) ? null : 'URLは https:// で始めてください'
}
function validateSecret(value: string): string | null {
  return value.length >= MIN_SECRET_LENGTH ? null : `秘密の鍵は${MIN_SECRET_LENGTH}文字以上にしてください`
}

/* useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。入口が包まなくても動くよう、ここで包む。 */
export default function WebhooksCreateV8() {
  return (
    <Suspense fallback={null}>
      <WebhooksCreateV8Inner />
    </Suspense>
  )
}

function WebhooksCreateV8Inner() {
  usePageTitle('送り先を作る')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const accountRef = useRef(selectedAccountId)
  /* WEB232：作れたが止められなかった送り先（下書きのつもりで、いまは動いている）。 */
  const createdActiveRef = useRef<{ id: string; accountId: string } | null>(null)
  accountRef.current = selectedAccountId
  const searchParams = useSearchParams()
  const presetEvent = searchParams.get('event')
  const presetValid = Boolean(presetEvent && ALL_EVENTS.includes(presetEvent))
  const staffRole = useStaffRole()

  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState(generateSecret)
  /* 既定は「選んだものだけ送る」（絵 hsD8e）。すべて送ると要らない個人情報まで出るので、選んでもらう。 */
  const [sendAll, setSendAll] = useState(false)
  const [selectedEvents, setSelectedEvents] = useState<string[]>(presetValid && presetEvent ? [presetEvent] : [])
  const [incomingSources, setIncomingSources] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(Boolean(presetValid && presetEvent && !PRIMARY_EVENTS.has(presetEvent)))
  const [maxRetries, setMaxRetries] = useState('3')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const { gate, prompt: stepUpPrompt, cancel: cancelStepUp } = useStepUpGate()

  useEffect(() => { cancelStepUp() }, [selectedAccountId, cancelStepUp])

  const initialSecretRef = useRef(secret)
  const dirty = Boolean(
    name || url || incomingSources || maxRetries !== '3'
    || secret !== initialSecretRef.current
    || sendAll
    || selectedEvents.join(',') !== (presetValid && presetEvent ? presetEvent : ''),
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    const nameError = validateName(name)
    if (nameError) errors.name = nameError
    const urlError = validateUrl(url)
    if (urlError) errors.url = urlError
    const secretError = validateSecret(secret)
    if (secretError) errors.secret = secretError
    if (!sendAll && selectedEvents.length === 0 && !incomingSources.trim()) {
      errors.events = '送るものを選ぶか、「すべて送る」を選んでください'
    }
    return errors
  }

  /* 欄から離れたときの確かめ。触った欄だけその場で教え、直したらその場で消す。 */
  const blurField = (key: 'name' | 'url' | 'secret', value?: string) => {
    const current = value ?? (key === 'name' ? name : key === 'url' ? url : secret)
    const message = key === 'name' ? validateName(current) : key === 'url' ? validateUrl(current) : validateSecret(current)
    setFieldErrors((prev) => {
      if (!message) {
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return prev[key] === message ? prev : { ...prev, [key]: message }
    })
  }

  const toggleEvent = (value: string) => {
    setSelectedEvents((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
  }

  async function save(next: 'draft' | 'active') {
    if (staffRole !== null && staffRole !== 'owner') {
      setError('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
      return
    }
    const accountId = selectedAccountId
    if (!accountId) {
      setError('上のバーでLINE公式アカウントを選んでください')
      return
    }
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setError('直す所があります。赤い理由を確かめてください。')
      return
    }
    setSaving(true)
    setError(null)
    /*
     * WEB232：前の「下書きを保存」で作れたのに止められなかった送り先がある。もう一度作らず、
     * 止めるところだけやり直す（作る口に「止めた状態で作る」は無い。Codex に依頼）。
     */
    const pendingStop = createdActiveRef.current
    if (next === 'active' && pendingStop && pendingStop.accountId === accountId) {
      // もう作れていて動いている。同じ送り先をもう1つ作らない。
      createdActiveRef.current = null
      router.push('/webhooks')
      return
    }
    if (next === 'draft' && pendingStop && pendingStop.accountId === accountId) {
      try {
        const stop = await api.webhooks.outgoing.update(pendingStop.id, accountId, { isActive: false })
        if (!stop.success) throw new Error(stop.error)
        createdActiveRef.current = null
        router.push('/webhooks')
      } catch {
        setError('送り先は作れましたが、まだ止められていません（いまは動いています）。もう一度「下書きを保存」を押すと、止めるところだけやり直します。')
        setSaving(false)
      }
      return
    }
    try {
      const payload = {
        lineAccountId: accountId,
        name: name.trim(),
        url: url.trim(),
        eventTypes: sendAll
          ? ['*']
          : [
              ...selectedEvents,
              ...incomingSources.split(',').map((value) => value.trim()).filter(Boolean).map((value) => `incoming_webhook.${value}`),
            ],
        secret,
        maxRetries: Number(maxRetries) || 0,
      }
      const create = (stepUpToken?: string) => api.webhooks.outgoing.create(payload, stepUpToken)
      let res
      try {
        res = await create()
      } catch (caught) {
        if (!isStepUpRequired(caught)) {
          if (caught instanceof ApiError && caught.status === 403) throw new Error('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
          throw caught
        }
        const token = await gate('webhook.secret', 'Webhookを登録する')
        if (!token) throw caught
        if (accountRef.current !== accountId) throw new Error('LINEアカウントが切り替わりました。登録せずに止めました。もう一度やり直してください。')
        res = await create(token)
      }
      if (!res.success) throw new Error(res.error)
      if (next === 'draft') {
        // 作る口に止めた状態の指定が無いので、作ってから止める。
        // WEB232：止められなかったら一覧へ移らず、この画面で知らせて、止めるところだけやり直せるようにする。
        createdActiveRef.current = { id: res.data.id, accountId }
        let stopped = false
        try {
          const stop = await api.webhooks.outgoing.update(res.data.id, accountId, { isActive: false })
          stopped = stop.success
        } catch {
          stopped = false
        }
        if (!stopped) {
          throw new Error('送り先は作れましたが、まだ止められていません（いまは動いています）。もう一度「下書きを保存」を押すと、止めるところだけやり直します。')
        }
        createdActiveRef.current = null
      }
      router.push('/webhooks')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存できませんでした。もう一度お試しください。')
      setSaving(false)
    }
  }

  const sampleKey = selectedEvents.find((value) => SAMPLES[value]) ?? 'friend_add'
  const sample = SAMPLES[sampleKey]
  const back = <Link href="/webhooks" className={styles.backLink}><ChevronLeft size={14} aria-hidden="true" />外部連携へ</Link>

  /* 作るのは統括だけ（R32）。見るだけの人には押せない物を置かず、一覧へ戻る道だけ出す。 */
  if (staffRole !== null && staffRole !== 'owner') {
    return (
      <CreatePage
        boardId="hsD8e"
        title="送り先を作る"
        description="友だちの動きを、決めたタイミングでほかのシステムへ送ります。試しに送ってから動かすと安心です。"
        identity={back}
        footerActions={<Button href="/webhooks">一覧へ戻る</Button>}
      >
        <Notice tone="info">送り先の作成は統括だけができます。必要なときは統括に頼んでください。</Notice>
      </CreatePage>
    )
  }

  const preview = (
    <div className={styles.side}>
      <section className={styles.sideCard} aria-labelledby="wh-new-sample">
        <h2 className={styles.sideTitle} id="wh-new-sample">届く中身の見本</h2>
        <p className={styles.sideNote}>{sample.when}</p>
        <div className={styles.sampleBox} aria-label="届く中身の見本">
          {sample.lines.map((line, index) => <div key={index} className={styles.sampleLine}>{line}</div>)}
        </div>
      </section>
      <section className={styles.sideCard} aria-labelledby="wh-new-test">
        <h2 className={styles.sideTitle} id="wh-new-test">試しに送る</h2>
        <p className={styles.sideNote}>見本の中身を1回だけ送ります</p>
        <div>
          <Button disabled title="送り先を作ってから送れます（一覧の「設定 → 試しに送る」）"><Send size={15} aria-hidden="true" />試しに送る</Button>
        </div>
      </section>
      <section className={styles.sideCard} aria-labelledby="wh-new-care">
        <h2 className={styles.sideTitle} id="wh-new-care">気をつけること</h2>
        <p className={styles.careText}>
          ・秘密の鍵は保存すると二度と全部は見えません<br />
          ・作り直すと、前の鍵では届かなくなります<br />
          ・個人情報は必要なものだけ送ります
        </p>
      </section>
    </div>
  )

  return (
    <CreatePage
      boardId="hsD8e"
      title="送り先を作る"
      description="友だちの動きを、決めたタイミングでほかのシステムへ送ります。試しに送ってから動かすと安心です。"
      identity={back}
      preview={preview}
      status="下書き（まだ動いていません）"
      footerActions={(
        <>
          <Button href="/webhooks">キャンセル</Button>
          <Button disabled={saving} onClick={() => void save('draft')} busy={saving}>下書きを保存</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save('active')} busy={saving}>つくって動かす</Button>
        </>
      )}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <section className={styles.card} aria-labelledby="wh-new-direction">
        <h2 className={styles.cardTitle} id="wh-new-direction">どちら向きの連携か</h2>
        <RadioCardGroup legend="どちら向きの連携か" className={styles.cardRow}>
          <RadioCard
            name="wh-new-direction"
            value="outgoing"
            checked={direction === 'outgoing'}
            onChange={() => setDirection('outgoing')}
            icon={<Send size={16} aria-hidden="true" />}
            title="こちらから送る"
            note="友だちの動きをほかへ知らせる"
            className={styles.dirCard}
          />
          <RadioCard
            name="wh-new-direction"
            value="incoming"
            checked={direction === 'incoming'}
            onChange={() => setDirection('incoming')}
            icon={<Inbox size={16} aria-hidden="true" />}
            title="こちらで受け取る"
            note="ほかからの知らせを受け取る"
            className={styles.dirCard}
          />
        </RadioCardGroup>
        {direction === 'incoming' ? (
          <p className={styles.cardNote}>
            受け取り口はこの画面では作れません。<Link href="/webhooks?tab=incoming" className={styles.inlineLink}>「こちらで受け取る」から作ってください</Link>。
          </p>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="wh-new-dest">
        <h2 className={styles.cardTitle} id="wh-new-dest">どこへ送りますか</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="wh-new-name">名前</label>
          <input
            id="wh-new-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              if (fieldErrors.name && validateName(event.target.value) === null) blurField('name', event.target.value)
            }}
            onBlur={() => blurField('name')}
            placeholder="顧客台帳（CRM）"
            className={styles.input}
            aria-invalid={fieldErrors.name ? true : undefined}
            required
          />
          {fieldErrors.name ? <p className={styles.fieldError} role="alert">{fieldErrors.name}</p> : null}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="wh-new-url">送り先の URL</label>
          <input
            id="wh-new-url"
            type="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              if (fieldErrors.url && validateUrl(event.target.value) === null) blurField('url', event.target.value)
            }}
            onBlur={() => blurField('url')}
            placeholder="https://crm.example.com/line/hook"
            className={styles.input}
            aria-invalid={fieldErrors.url ? true : undefined}
            required
          />
          {fieldErrors.url ? <p className={styles.fieldError} role="alert">{fieldErrors.url}</p> : null}
        </div>
        <div className={styles.secretRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="wh-new-secret">秘密の鍵</label>
            <input
              id="wh-new-secret"
              value={secret}
              onChange={(event) => {
                setSecret(event.target.value)
                if (fieldErrors.secret && validateSecret(event.target.value) === null) blurField('secret', event.target.value)
              }}
              onBlur={() => blurField('secret')}
              className={`${styles.input} ${styles.mono}`}
              aria-invalid={fieldErrors.secret ? true : undefined}
              required
            />
          </div>
          <Button type="button" onClick={() => setSecret(generateSecret())}><RefreshCw size={15} aria-hidden="true" />作り直す</Button>
        </div>
        {fieldErrors.secret ? <p className={styles.fieldError} role="alert">{fieldErrors.secret}</p> : null}
      </section>

      <section className={styles.card} aria-labelledby="wh-new-when">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle} id="wh-new-when">いつ送りますか</h2>
          <p className={styles.cardNote}>選んだできごとが起きるたびに送ります</p>
        </div>
        <RadioCardGroup legend="送る範囲" className={styles.radioRow}>
          <RadioCard variant="row" name="wh-new-mode" value="all" checked={sendAll} onChange={() => setSendAll(true)} title="すべて送る" />
          <RadioCard variant="row" name="wh-new-mode" value="selected" checked={!sendAll} onChange={() => setSendAll(false)} title="選んだものだけ送る" />
        </RadioCardGroup>
        {fieldErrors.events ? <p className={styles.fieldError} role="alert">{fieldErrors.events}</p> : null}
        {!sendAll ? (
          <>
            {EVENT_GROUPS.map((group) => (
              <div key={group.id} className={styles.eventGroup}>
                <p className={styles.eventGroupTitle}>{group.label}</p>
                <div className={styles.eventChecks}>
                  {group.events.map((event) => (
                    <Checkbox key={event.value} checked={selectedEvents.includes(event.value)} onCheckedChange={() => toggleEvent(event.value)}>
                      {event.label}
                    </Checkbox>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <Button variant="text" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
                {detailsOpen ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}詳細条件
              </Button>
            </div>
            {detailsOpen ? (
              <div className={styles.eventGroup}>
                <p className={styles.eventGroupTitle}>ほかの出来事</p>
                <div className={styles.eventChecks}>
                  {OTHER_EVENTS.map((event) => (
                    <Checkbox key={event.value} checked={selectedEvents.includes(event.value)} onCheckedChange={() => toggleEvent(event.value)}>
                      {event.label}
                    </Checkbox>
                  ))}
                </div>
              </div>
            ) : null}
            {detailsOpen ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="wh-new-incoming">受け取った知らせも送る（受け取り口の種類。カンマで区切る）</label>
                <input
                  id="wh-new-incoming"
                  value={incomingSources}
                  onChange={(event) => setIncomingSources(event.target.value)}
                  placeholder="例: form, booking"
                  className={styles.input}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="wh-new-retry">
        <h2 className={styles.cardTitle} id="wh-new-retry">送れなかったとき</h2>
        <div className={styles.pickRow}>
          <div className={styles.field}>
            <span className={styles.pickLabel} id="wh-new-retries-label">やり直し</span>
            <Select aria-label="やり直し" size="full" value={maxRetries} onChange={(value) => setMaxRetries(value)} options={RETRY_OPTIONS} />
          </div>
          <span className={styles.field} aria-hidden="true" />
        </div>
      </section>

      {stepUpPrompt}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した送り先" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}
