'use client'

/*
 * ★V8-B 外部連携の送り先を作る（板 `hsD8e`）。
 *
 * v7 の作る画面（`page.tsx` の NewWebhookForm）とは別の部品として持つ。
 * データの口（作成・本人確認・未保存の番兵）は同じ。違いは置き場と
 * 見せ方——どちら向きの選択、右に届く中身の見本＋試しに送る＋気をつけること、
 * 下の帯の主ボタン「つくって動かす」。
 * v7 を直す必要が出たら page.tsx 側も同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - こちらで受け取る：この画面では作れない（一覧の受け取るタブから作る）
 *   ので、選ぶと案内と行き先を出す。
 * - 問い合わせが来た：送れる出来事の正本に無いので選ぶ欄に出さない。
 * - それでも送れないとき：保存する口が無いので出さない。
 * - 秘密の鍵：作るときは発行直後の全文表示が正しいので、隠さず出して
 *   作り直せる形にする（`ralAc` の注意書きどおり）。
 * - 試しに送る：送り先ができてから送れるので、保存するまでは押せない形。
 * - 下書きを保存：作る口に止めた状態の指定が無いので、作ってから止める
 *   2段階で行う。止めるところで失敗したら一覧から止める案内を出す。
 * - 競合（`NGh7b`）：作る口に競合の応答が無いので、板だけある状態。
 *   応答が来たら「比べてから保存」を出す（残課題として報告する）。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ecEventLabel } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import StickyBar from '@/components/shared/sticky-bar'
import { RequiredBadge } from '@/components/shared/form-controls'
import { isStepUpRequired, useStepUpGate } from '@/components/step-up-prompt'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { MIN_SECRET_LENGTH, generateSecret } from '../secret'
import styles from './new-v8.module.css'

/* 見本にある出来事のうち、実際に購読できるものだけ出す。 */
const V8_EVENT_GROUPS: ReadonlyArray<{
  id: string
  label: string
  events: ReadonlyArray<{ value: string; label: string }>
}> = [
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
    events: [{ value: 'booking_created', label: '予約が入った' }],
  },
  {
    id: 'ec',
    label: 'EC',
    events: [
      { value: 'ec.order.confirmed', label: ecEventLabel('ec.order.confirmed') },
      { value: 'ec.order.shipped', label: ecEventLabel('ec.order.shipped') },
    ],
  },
]

const ALL_V8_EVENTS = V8_EVENT_GROUPS.flatMap((group) => group.events.map((event) => event.value))

const RETRY_OPTIONS = [
  { value: '0', label: '送り直さない' },
  { value: '1', label: '1回まで' },
  { value: '3', label: '3回まで（1分・5分・30分あと）' },
  { value: '7', label: '7回まで' },
]

/* 届く中身の見本。実際に送られる形の例。中身は見本と分かる値にする。 */
const SAMPLES: Record<string, { when: string; body: string }> = {
  friend_add: {
    when: '友だちになったとき',
    body: `{
  "できごと": "友だちになった",
  "友だちID": "U4af…",
  "名前": "Kenta Kawano",
  "タグ": ["Instagram"],
  "日時": "2026-09-30T10:12"
}`,
  },
  booking_created: {
    when: '予約が入ったとき',
    body: `{
  "できごと": "予約が入った",
  "予約ID": "bk_8f2…",
  "メニュー": "カウンセリング 30分",
  "友だち": "Masato S."
}`,
  },
  'ec.order.confirmed': {
    when: '注文が確定したとき',
    body: `{
  "できごと": "注文が確定した",
  "注文番号": "ord_123…",
  "金額": 4980,
  "友だち": "菅野 亮"
}`,
  },
}

export default function NewOutgoingV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewOutgoingV8Inner />
    </Suspense>
  )
}

function NewOutgoingV8Inner() {
  usePageTitle('送り先を作る')
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const searchParams = useSearchParams()
  const presetEvent = searchParams.get('event')
  const presetValid = Boolean(presetEvent && ALL_V8_EVENTS.includes(presetEvent!))

  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState(generateSecret)
  const [sendAllEvents, setSendAllEvents] = useState(!presetValid)
  const [selectedEvents, setSelectedEvents] = useState<string[]>(presetValid ? [presetEvent!] : [])
  const [incomingSources, setIncomingSources] = useState('')
  const [maxRetries, setMaxRetries] = useState('3')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const { gate, prompt: stepUpPrompt, cancel: cancelStepUp } = useStepUpGate()
  const [staffRole, setStaffRole] = useState<string | null>(null)

  useEffect(() => {
    cancelStepUp()
  }, [selectedAccountId, cancelStepUp])

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (cancelled || !response.success) return
        setStaffRole(response.data.role)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const initialSecretRef = useRef(secret)
  const dirty = Boolean(
    name || url || incomingSources || maxRetries !== '3' ||
    secret !== initialSecretRef.current ||
    sendAllEvents !== !presetValid ||
    selectedEvents.join(',') !== (presetValid ? presetEvent! : ''),
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty, busy: saving })

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = '名前を入力してください'
    if (!/^https:\/\//.test(url.trim())) errors.url = 'URLは https:// で始めてください'
    if (secret.length < MIN_SECRET_LENGTH) errors.secret = `シークレットは${MIN_SECRET_LENGTH}文字以上にしてください`
    if (!sendAllEvents && selectedEvents.length === 0 && !incomingSources.trim()) {
      errors.events = '送るものを選ぶか、「すべて送る」を選んでください'
    }
    return errors
  }

  const toggleEvent = (value: string) => {
    setSelectedEvents((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

  async function save(next: 'draft' | 'active') {
    if (staffRole !== null && staffRole !== 'owner') {
      setError('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
      return
    }
    const requestAccountId = selectedAccountId
    if (!requestAccountId) {
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
    try {
      const payload = {
        lineAccountId: requestAccountId,
        name: name.trim(),
        url: url.trim(),
        eventTypes: sendAllEvents
          ? ['*']
          : [
              ...selectedEvents,
              ...incomingSources.split(',').map((value) => value.trim()).filter(Boolean)
                .map((value) => `incoming_webhook.${value}`),
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
          if (caught instanceof ApiError && caught.status === 403) {
            throw new Error('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
          }
          throw caught
        }
        const token = await gate('webhook.secret', 'Webhookを登録する')
        if (!token) throw caught
        if (selectedAccountIdRef.current !== requestAccountId) {
          throw new Error('LINEアカウントが切り替わりました。登録せずに止めました。もう一度やり直してください。')
        }
        res = await create(token)
      }
      if (!res.success) throw new Error(res.error)
      if (next === 'draft') {
        // 作る口に止めた状態の指定が無いので、作ってから止める。
        const stop = await api.webhooks.outgoing.update(res.data.id, requestAccountId, { isActive: false })
        if (!stop.success) {
          router.push('/webhooks')
          throw new Error('送り先は作れましたが、止めるところで失敗しました。一覧の「設定 → 止める」で止めてください。')
        }
      }
      router.push('/webhooks')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存できませんでした。もう一度お試しください。')
      setSaving(false)
    }
  }

  const sampleKey = selectedEvents.find((value) => SAMPLES[value]) ?? 'friend_add'
  const sample = SAMPLES[sampleKey]

  if (staffRole !== null && staffRole !== 'owner') {
    return (
      <div className={styles.board} data-design-node="hsD8e">
        <Notice tone="info">
          送り先の作成は統括だけができます。必要なときは統括に頼んでください。
        </Notice>
        <div>
          <Button variant="secondary" href="/webhooks">外部連携の一覧へ戻る</Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.board} data-design-node="hsD8e">
      <nav className={styles.crumb} aria-label="パンくず">
        <Link href="/webhooks" className={styles.crumbLink}>← 外部連携へ</Link>
      </nav>
      <h1 className={styles.headTitle}>送り先を作る</h1>
      <p className={styles.headDescription}>友だちの動きを、決めたタイミングでほかのシステムへ送ります。試しに送ってから動かすと安心です。</p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className={styles.body}>
        <div className={styles.form}>
          <section className={styles.card} aria-labelledby="webhook-v8-direction">
            <h2 className={styles.cardTitle} id="webhook-v8-direction">どちら向きの連携か</h2>
            <RadioCardGroup legend="どちら向きの連携か" className={styles.radioRow}>
              <RadioCard
                name="webhook-v8-direction"
                value="outgoing"
                checked={direction === 'outgoing'}
                onChange={() => setDirection('outgoing')}
                title="こちらから送る"
                note="友だちの動きをほかへ知らせる"
              />
              <RadioCard
                name="webhook-v8-direction"
                value="incoming"
                checked={direction === 'incoming'}
                onChange={() => setDirection('incoming')}
                title="こちらで受け取る"
                note="ほかからの知らせを受け取る"
              />
            </RadioCardGroup>
            {direction === 'incoming' ? (
              <p className={styles.cardNote}>
                受け取り口はこの画面では作れません。{' '}
                <Link href="/webhooks?tab=incoming" className={styles.crumbLink}>こちらで受け取るの一覧から作ってください</Link>。
              </p>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="webhook-v8-dest">
            <h2 className={styles.cardTitle} id="webhook-v8-dest">どこへ送りますか</h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="webhook-v8-name">名前 <RequiredBadge /></label>
              <input
                id="webhook-v8-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="顧客台帳（CRM）"
                className={styles.input}
                aria-invalid={fieldErrors.name ? true : undefined}
              />
              {fieldErrors.name ? <p className={styles.fieldError} role="alert">{fieldErrors.name}</p> : null}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="webhook-v8-url">送り先のURL <RequiredBadge /></label>
              <input
                id="webhook-v8-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://crm.example.com/line/hook"
                className={styles.input}
                aria-invalid={fieldErrors.url ? true : undefined}
              />
              {fieldErrors.url ? <p className={styles.fieldError} role="alert">{fieldErrors.url}</p> : null}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="webhook-v8-secret">秘密の鍵 <RequiredBadge /></label>
              <div className={styles.secretRow}>
                <input
                  id="webhook-v8-secret"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  className={styles.input}
                  aria-invalid={fieldErrors.secret ? true : undefined}
                />
                <Button type="button" onClick={() => setSecret(generateSecret())}>作り直す</Button>
              </div>
              {fieldErrors.secret ? <p className={styles.fieldError} role="alert">{fieldErrors.secret}</p> : null}
            </div>
          </section>

          <section className={styles.card} aria-labelledby="webhook-v8-when">
            <h2 className={styles.cardTitle} id="webhook-v8-when">いつ送りますか</h2>
            <p className={styles.cardNote}>選んだできごとが起きるたびに送ります</p>
            <RadioCardGroup legend="送る範囲" className={styles.radioRow}>
              <RadioCard
                name="webhook-v8-mode"
                value="all"
                checked={sendAllEvents}
                onChange={() => setSendAllEvents(true)}
                title="すべて送る"
              />
              <RadioCard
                name="webhook-v8-mode"
                value="selected"
                checked={!sendAllEvents}
                onChange={() => setSendAllEvents(false)}
                title="選んだものだけ送る"
              />
            </RadioCardGroup>
            {fieldErrors.events ? <p className={styles.fieldError} role="alert">{fieldErrors.events}</p> : null}
            {!sendAllEvents ? (
              <>
                {V8_EVENT_GROUPS.map((group) => (
                  <div key={group.id} className={styles.eventGroup}>
                    <p className={styles.eventGroupTitle}>{group.label}</p>
                    <div className={styles.eventChecks}>
                      {group.events.map((event) => (
                        <Checkbox
                          key={event.value}
                          checked={selectedEvents.includes(event.value)}
                          onCheckedChange={() => toggleEvent(event.value)}
                          description={event.value}
                        >
                          {event.label}
                        </Checkbox>
                      ))}
                    </div>
                  </div>
                ))}
                <details className={styles.detailsBox}>
                  <summary className={styles.detailsSummary}>詳細条件</summary>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="webhook-v8-incoming">受信Webhookの種類ID</label>
                    <input
                      id="webhook-v8-incoming"
                      value={incomingSources}
                      onChange={(event) => setIncomingSources(event.target.value)}
                      placeholder="例: form-source, another-source"
                      className={styles.input}
                    />
                  </div>
                </details>
              </>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="webhook-v8-retry">
            <h2 className={styles.cardTitle} id="webhook-v8-retry">送れなかったとき</h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="webhook-v8-retries">やり直し</label>
              <Select
                id="webhook-v8-retries"
                aria-label="やり直し"
                value={maxRetries}
                onChange={(value) => setMaxRetries(value)}
                options={RETRY_OPTIONS}
              />
            </div>
          </section>
        </div>

        <aside className={styles.side} aria-label="見本と注意">
          <div className={styles.sideCard}>
            <h2 className={styles.sideTitle}>届く中身の見本</h2>
            <p className={styles.sideNote}>{sample.when}</p>
            <pre className={styles.sampleBox}>{sample.body}</pre>
          </div>
          <div className={styles.sideCard}>
            <h2 className={styles.sideTitle}>試しに送る</h2>
            <p className={styles.sideNote}>見本の中身を1回だけ送ります</p>
            <div className={styles.testRow}>
              <Button disabled title="送り先を作ってから送れます">試しに送る</Button>
            </div>
          </div>
          <div className={styles.sideCard}>
            <h2 className={styles.sideTitle}>気をつけること</h2>
            <ul className={styles.sideList}>
              <li>・秘密の鍵は保存すると二度と全部は見えません</li>
              <li>・作り直すと、前の鍵では届かなくなります</li>
              <li>・個人情報は必要なものだけ送ります</li>
            </ul>
          </div>
        </aside>
      </div>

      <StickyBar
        status="下書き（まだ動いていません）"
        actions={(
          <>
            <Button href="/webhooks">キャンセル</Button>
            <Button disabled={saving} onClick={() => void save('draft')} busy={saving}>下書きを保存</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save('active')} busy={saving}>つくって動かす</Button>
          </>
        )}
      />
      {stepUpPrompt}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した送り先" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}
