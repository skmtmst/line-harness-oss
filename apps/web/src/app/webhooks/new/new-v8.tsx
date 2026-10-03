'use client'

/*
 * ★V8-B 外部連携の送り先を作る（板 `hsD8e`）。
 *
 * v7 の器（`new/page.tsx`）とは別の器。欄・検査・離脱確認・本人確認・
 * 保存の口は v7 と同じ。API の形を変えないので、見本の絵にある
 * 「下書きを保存」「試しに送る」「Iframe の向きの同時作成」は載せない。
 * v7 を直す必要が出たら `new/page.tsx` 側も同じ判断を入れる。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { EC_EVENT_TYPES, ecEventLabel } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard from '@/components/shared/radio-card'
import Notice from '@/components/shared/notice'
import { RequiredBadge, inputClass } from '@/components/shared/form-controls'
import { isStepUpRequired, useStepUpGate } from '@/components/step-up-prompt'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useFormErrors } from '@/lib/use-form-errors'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { MIN_SECRET_LENGTH, generateSecret } from '../secret'
import styles from './new-v8.module.css'

/**
 * #975 U067: 送るイベントの正本は `packages/db/src/webhooks.ts` の
 * KNOWN_OUTGOING_EVENT_TYPES。CSV手入力は打ち間違いをそのまま保存するため、
 * チェックで選ぶ形にする。ECの表示名は `ecEventLabel` の正本を使う。
 */
const WEBHOOK_EVENT_GROUPS: ReadonlyArray<{
  id: string
  label: string
  events: ReadonlyArray<{ value: string; label: string }>
}> = [
  {
    id: 'friends',
    label: '友だち・メッセージ',
    events: [
      { value: 'friend_add', label: '友だちになった' },
      { value: 'friend_unfollow', label: '友だちを解除された' },
      { value: 'message_received', label: 'メッセージを受け取った' },
      { value: 'postback_received', label: 'ボタン操作を受け取った' },
    ],
  },
  {
    id: 'operation',
    label: '運用の動き',
    events: [
      { value: 'tag_change', label: 'タグが付いた・外れた' },
      { value: 'staff_assigned', label: '担当が割り当てられた' },
      { value: 'manual_reply_sent', label: '個別返信を送った' },
      { value: 'cv_fire', label: '成果地点が起きた' },
      // R150: 見本から選べるように、実際に発火する出来事をそろえる。
      { value: 'form_submitted', label: 'フォームが送られた' },
      { value: 'booking_created', label: '予約が入った' },
    ],
  },
  {
    id: 'ec',
    label: 'ECの出来事',
    events: EC_EVENT_TYPES.map((value) => ({ value, label: ecEventLabel(value) })),
  },
]

/* 見本の絵に出す届く中身の見本（保存しない・送らない。読むだけ）。 */
const SAMPLE_JSON = `{
  "できごと": "友だちになった",
  "友だちID": "U4af...",
  "名前": "Kenta Kawano",
  "タグ": ["Instagram"],
  "日時": "2026-09-30T10:12"
}`

function NewWebhookFormV8() {
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const router = useRouter()
  const searchParams = useSearchParams()
  /*
   * R150: 見本の「送り先を作る」は /webhooks/new?event=<種類> で開く。
   * 実在する購読対象だけを初期選択にし、来た値がカタログに無ければ
   * 従来どおり「すべてのイベントを送る」を選んだ状態にする。
   */
  const presetEvent = searchParams.get('event')
  const presetValid = Boolean(
    presetEvent
      && WEBHOOK_EVENT_GROUPS.some((group) => group.events.some((event) => event.value === presetEvent)),
  )
  const presetLabel = presetValid
    ? WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events).find((event) => event.value === presetEvent)?.label
    : null
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  /* #975 U067: CSV手入力ではなく「すべて」かチェック選択で決める。 */
  const [sendAllEvents, setSendAllEvents] = useState(!presetValid)
  const [selectedEvents, setSelectedEvents] = useState<string[]>(presetValid ? [presetEvent!] : [])
  /* 受信Webhookごとの発火 `incoming_webhook.<種類>` は種類IDで指定する詳細設定。 */
  const [incomingSources, setIncomingSources] = useState('')
  const [secret, setSecret] = useState(generateSecret)
  const [maxRetries, setMaxRetries] = useState('0')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const { gate, prompt: stepUpPrompt, cancel: cancelStepUp } = useStepUpGate()
  /*
   * d23b R420: 本人確認の窓を開いたままアカウントを切り替えられたら、
   * 開いた時点のアカウントの操作としての意味はもう無い。窓を閉じて
   * 待っている保存を止める。
   */
  useEffect(() => {
    cancelStepUp()
  }, [selectedAccountId, cancelStepUp])
  /*
   * 送り先の作成は統括だけ（R32）。口側が `requireRole('owner')` で守っている。
   * 直接URLで開いた管理者には作らず、統括への依頼を案内する。
   */
  const [staffRole, setStaffRole] = useState<string | null>(null)
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

  /*
   * 欄の検査（★V7 sTJsh §6）。欄から離れた時点で1回だけ理由を出し、
   * 直すとその場で消える。保存時にも全部を見て、まとめを上に出す。
   * 定義の順がまとめの並びになる。
   */
  const fields = useFormErrors()
  fields.define('name', '名前', () => (name.trim() ? null : '名前を入力してください'))
  fields.define('url', '送り先のURL', () =>
    /^https:\/\//.test(url.trim()) ? null : 'URLは https:// で始めてください')
  fields.define('secret', 'シークレット', () =>
    secret.length >= MIN_SECRET_LENGTH ? null : `シークレットは${MIN_SECRET_LENGTH}文字以上にしてください`)
  fields.define('events', '送るイベント', () =>
    sendAllEvents || selectedEvents.length > 0 || incomingSources.trim()
      ? null
      : '送るイベントを選ぶか、「すべてのイベントを送る」を選んでください')

  const toggleEvent = (value: string) => {
    // 欄群は blur が取れないので、触れた時点をここで記録する。
    fields.touch('events')
    setSelectedEvents((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }
  /* 自動で振った署名は初期値。入れ直し・作り直しだけを未保存と数える。 */
  const initialSecretRef = useRef(secret)

  /*
   * 追加途中の離脱確認。名前・URL・送る出来事・署名・送り直しのどれかに
   * 手を付けていたら、キャンセルや左メニューで確認窓を出す。
   * 追加が終わると一覧へ router.push するので、成功後に警告は出ない。
   */
  const dirty = Boolean(
    name || url || incomingSources || maxRetries !== '0' ||
    secret !== initialSecretRef.current ||
    sendAllEvents !== !presetValid ||
    selectedEvents.join(',') !== (presetValid ? presetEvent! : '')
  )
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty })

  const runSave = async () => {
    if (saving) return
    const problems = fields.submit()
    if (!selectedAccountId) {
      setSaveError('LINEアカウントを選択してください')
      return
    }
    if (problems.length > 0) {
      setSaveError('')
      return
    }
    // d23b R420: 保存を始めた時点のアカウントを固定する。本人確認の
    // 窓をまたぐあいだに切り替えられたら、別アカウントへ登録しない。
    const requestAccountId = selectedAccountId
    const payload = {
      lineAccountId: requestAccountId,
      name: name.trim(),
      url: url.trim(),
      eventTypes: sendAllEvents
        ? ['*']
        : [
            ...selectedEvents,
            ...incomingSources
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
              .map((value) => `incoming_webhook.${value}`),
          ],
      secret,
      maxRetries: Number(maxRetries) || 0,
    }
    const create = (stepUpToken?: string) => api.webhooks.outgoing.create(payload, stepUpToken)
    setSaving(true)
    setSaveError('')
    try {
      let res
      try {
        res = await create()
      } catch (caught) {
        // 秘密の値の登録は大事な操作。本人確認を求められたらその場で窓を立て、
        // 確認が済んだgrantを付けて同じ保存をやり直す（V-1）。
        // 作成は統括だけ。権限不足は生の `API error: 403` ではなく依頼の案内にする（R32）。
        if (!isStepUpRequired(caught)) {
          if (caught instanceof ApiError && caught.status === 403) {
            throw new Error('送り先の作成は統括だけができます。必要なときは統括に頼んでください。')
          }
          throw caught
        }
        const token = await gate('webhook.secret', 'Webhookを登録する')
        if (!token) throw caught
        // d23b R420: 本人確認のあいだに切り替えられたら、切り替え先の
        // アカウントへ誤った送り先を登録しない。
        if (selectedAccountIdRef.current !== requestAccountId) {
          throw new Error('LINEアカウントが切り替わりました。登録せずに止めました。もう一度やり直してください。')
        }
        res = await create(token)
      }
      if (!res.success) throw new Error(res.error)
      // 作った行を一覧で目立たせる。どこに増えたのか探させない。
      router.push(`/webhooks?tab=outgoing&highlight=${res.data.id}`)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '送り先を作れませんでした。確かめてから、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  if (staffRole !== null && staffRole !== 'owner') {
    return (
      <div className={styles.stack}>
        <Notice tone="info">
          送り先の作成は統括だけができます。必要なときは統括に頼んでください。
        </Notice>
        <div>
          <Button variant="secondary" href="/webhooks">外部連携の一覧へ戻る</Button>
        </div>
      </div>
    )
  }

  const problems = fields.listProblems()

  return (
    <div data-design-node="hsD8e" className={styles.page}>
      <div className={styles.head}>
        <Button variant="secondary" href="/webhooks" className={styles.backLink}>← 外部連携へ</Button>
        <h1 className={styles.title}>送り先を作る</h1>
        <p className={styles.lead}>友だちの動きを、決めたタイミングでほかのシステムへ送ります。試しに送ってから動かすと安心です。</p>
      </div>

      {saveError ? <p className={styles.saveError} role="alert">{saveError}</p> : null}
      {problems.length > 0 ? (
        <div className={styles.problems} role="alert">
          <p className={styles.problemsTitle}>直してほしいところが{problems.length}件あります</p>
          <ul className={styles.problemsList}>
            {problems.map((problem) => (
              <li key={problem.key}>{problem.label}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.columns}>
        <div className={styles.main}>
          <section className={styles.card} aria-label="どちら向きの連携か">
            <h2 className={styles.cardTitle}>どちら向きの連携か</h2>
            <div className={styles.directionRow}>
              <div className={`${styles.directionCard} ${styles.directionActive}`} aria-current="true">
                <span className={styles.directionName}>こちらから送る</span>
                <span className={styles.directionHint}>友だちの動きをほかへ知らせる</span>
              </div>
              <Button variant="secondary" href="/webhooks?tab=incoming" className={styles.directionCardButton}>
                <span className={styles.directionName}>こちらで受け取る</span>
                <span className={styles.directionHint}>ほかからの知らせを受け取る</span>
              </Button>
            </div>
          </section>

          <section className={styles.card} aria-label="どこへ送りますか">
            <h2 className={styles.cardTitle}>どこへ送りますか</h2>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wh-name">名前<RequiredBadge /></label>
              <input
                {...fields.bind('name')}
                id="wh-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例：顧客台帳（CRM）"
                className={inputClass}
                aria-invalid={fields.invalid('name') || undefined}
              />
              {fields.error('name') ? <p className={styles.fieldError} role="alert">{fields.error('name')}</p> : null}
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wh-url">送り先のURL<RequiredBadge /></label>
              <input
                {...fields.bind('url')}
                id="wh-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/webhook"
                className={inputClass}
                aria-invalid={fields.invalid('url') || undefined}
              />
              {fields.error('url') ? <p className={styles.fieldError} role="alert">{fields.error('url')}</p> : null}
              <p className={styles.fieldHint}>https:// のみです。</p>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wh-secret">秘密の鍵<RequiredBadge /></label>
              <div className={styles.secretRow}>
                <input
                  {...fields.bind('secret')}
                  id="wh-secret"
                  type="text"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  className={`${inputClass} ${styles.mono}`}
                  aria-invalid={fields.invalid('secret') || undefined}
                />
                <Button variant="secondary" type="button" onClick={() => setSecret(generateSecret())}>
                  作り直す
                </Button>
              </div>
              {fields.error('secret') ? <p className={styles.fieldError} role="alert">{fields.error('secret')}</p> : null}
            </div>
          </section>

          <section className={styles.card} aria-label="いつ送りますか">
            <h2 className={styles.cardTitle}>いつ送りますか</h2>
            <p className={styles.cardLead}>選んだできごとが起きるたびに送ります</p>
            <div className={styles.modeRow}>
              <RadioCard
                name="wh-event-mode"
                value="all"
                checked={sendAllEvents}
                onChange={() => { fields.touch('events'); setSendAllEvents(true) }}
                title="すべて送る"
              />
              <RadioCard
                name="wh-event-mode"
                value="selected"
                checked={!sendAllEvents}
                onChange={() => { fields.touch('events'); setSendAllEvents(false) }}
                title="選んだものだけ送る"
              />
            </div>
            {fields.error('events') ? (
              <p className={styles.fieldError} role="alert">{fields.error('events')}</p>
            ) : null}
            {presetLabel ? (
              <p className={styles.fieldHint}>
                見本「{presetLabel}」の条件を選んだ状態で開いています。すべてのイベントへ変えるときは上の選択を押してください。
              </p>
            ) : null}
            {!sendAllEvents && (
              <div className={styles.eventGroups}>
                {WEBHOOK_EVENT_GROUPS.map((group) => (
                  <div key={group.id} className={styles.eventGroup}>
                    <p className={styles.eventGroupLabel}>{group.label}</p>
                    <ul className={styles.eventList}>
                      {group.events.map((event) => (
                        <li key={event.value}>
                          <Checkbox
                            checked={selectedEvents.includes(event.value)}
                            onCheckedChange={() => toggleEvent(event.value)}
                            description={event.value}
                          >{event.label}</Checkbox>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <details className={styles.advanced}>
                  <summary className={styles.advancedSummary}>
                    受信Webhookごとの出来事を種類IDで指定する（詳細設定）
                  </summary>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="wh-incoming">受信Webhookの種類ID</label>
                    <input
                      id="wh-incoming"
                      type="text"
                      value={incomingSources}
                      onChange={(event) => setIncomingSources(event.target.value)}
                      placeholder="例: form-source, another-source"
                      className={`${inputClass} ${styles.mono}`}
                    />
                    <p className={styles.fieldHint}>「incoming_webhook.&lt;種類ID&gt;」の形で送ります。カンマ区切りで複数入れられます。</p>
                  </div>
                </details>
              </div>
            )}
          </section>

          <section className={styles.card} aria-label="送れなかったとき">
            <h2 className={styles.cardTitle}>送れなかったとき</h2>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wh-retries">失敗したときの送り直し</label>
              <div className={styles.retryRow}>
                <input
                  id="wh-retries"
                  type="number"
                  min={0}
                  max={7}
                  value={maxRetries}
                  onChange={(event) => setMaxRetries(event.target.value)}
                  className={`${inputClass} ${styles.retryInput}`}
                />
                <span className={styles.fieldHint}>回まで</span>
              </div>
              <p className={styles.fieldHint}>相手が 5xx を返したときや、つながらなかったときに送り直します。1分・5分・30分…と間隔を空け、上限は7回です。相手が 4xx を返した場合は送り直しません。</p>
            </div>
          </section>
        </div>

        <aside className={styles.aside} aria-label="作るときの案内">
          <section className={styles.card} aria-label="届く中身の見本">
            <h2 className={styles.cardTitle}>届く中身の見本</h2>
            <p className={styles.cardLead}>友だちになったとき</p>
            <pre className={styles.samplePre}>{SAMPLE_JSON}</pre>
          </section>
          <section className={styles.card} aria-label="気をつけること">
            <h2 className={styles.cardTitle}>気をつけること</h2>
            <ul className={styles.cautionList}>
              <li>秘密の鍵は保存すると二度と全部は見せません</li>
              <li>作り直すと、前の鍵では届かなくなります</li>
              <li>個人情報は必要なものだけ送ります</li>
            </ul>
          </section>
        </aside>
      </div>

      <div className={styles.bottomBar}>
        <Button variant="secondary" href="/webhooks">キャンセル</Button>
        <Button variant="primary" onClick={() => void runSave()} disabled={saving} busy={saving} busyLabel="作っています…">送り先を作る</Button>
      </div>
      {stepUpPrompt}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した送り先" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </div>
  )
}

export default function NewWebhookPageV8() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={null}>
      <NewWebhookFormV8 />
    </Suspense>
  )
}
