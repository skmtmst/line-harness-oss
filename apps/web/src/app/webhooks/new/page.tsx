'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { EC_EVENT_TYPES, ecEventLabel } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import RadioCard from '@/components/shared/radio-card'
import Notice from '@/components/shared/notice'
import CreatePage, { AsideCard, Field, inputClass } from '@/components/shared/create-page'
import { isStepUpRequired, useStepUpGate } from '@/components/step-up-prompt'
import { RequiredBadge } from '@/components/shared/form-controls'
import { useAccount } from '@/contexts/account-context'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { useFormErrors } from '@/lib/use-form-errors'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { MIN_SECRET_LENGTH, generateSecret } from '../secret'
import { useAdminTheme } from '@/lib/use-admin-theme'
import NewWebhookPageV8 from './new-v8'

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

/** 送信Webhookを作る唯一のフォーム。一覧の追加導線もこの画面へ集約する。 */
function NewWebhookForm() {
  const { selectedAccountId } = useAccount()
  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
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

  if (staffRole !== null && staffRole !== 'owner') {
    return (
      <div className="flex flex-col gap-4">
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
    <CreatePage
      title="Webhookを追加する"
      description="このツールのできごとを外部へ知らせます（送り出す向きのみ）。"
      showHeader={false}
      parent={['外部連携', '/webhooks']}
      variant="v6"
      aside={
        <AsideCard title="どちら向きの連携か">
          <ul className="text-ink-faint space-y-1.5 text-xs leading-relaxed">
            <li>・この画面で作れるのは「送り出す（Outgoing）」だけです。「受け取る（Incoming）」は外部連携の一覧から追加してください</li>
          </ul>
        </AsideCard>
      }
      fields={fields}
      // LINEアカウントは共通バー側の選択なので欄の検査には載せない。
      validate={() => (selectedAccountId ? null : 'LINEアカウントを選択してください')}
      onSave={async () => {
        // d23b R420: 保存を始めた時点のアカウントを固定する。本人確認の
        // 窓をまたぐあいだに切り替えられたら、別アカウントへ登録しない。
        const requestAccountId = selectedAccountId
        if (!requestAccountId) throw new Error('LINEアカウントを選択してください')
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
        return res.data.id
      }}
    >
      <p className="text-ink text-sm font-semibold">基本の設定</p>

      <Field label="名前" htmlFor="wh-name" required error={fields.error('name')}>
        <input
          {...fields.bind('name')}
          id="wh-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例: 外部CRM連携"
          className={inputClass}
          aria-invalid={fields.invalid('name') || undefined}
        />
      </Field>

      <Field label="送り先のURL" htmlFor="wh-url" required note="https:// のみです。" error={fields.error('url')}>
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
      </Field>

      {/* #975 U067: イベントコードのCSV手入力をやめ、チェックで選ぶ。 */}
      <fieldset className="space-y-3">
        <legend className="text-ink-secondary text-xs font-medium">
          送るイベント<RequiredBadge />
        </legend>
        <div className="flex flex-wrap gap-2">
          <RadioCard
            name="wh-event-mode"
            value="all"
            checked={sendAllEvents}
            onChange={() => { fields.touch('events'); setSendAllEvents(true) }}
            title="すべてのイベントを送る"
          />
          <RadioCard
            name="wh-event-mode"
            value="selected"
            checked={!sendAllEvents}
            onChange={() => { fields.touch('events'); setSendAllEvents(false) }}
            title="送るイベントを選ぶ"
          />
        </div>
        {fields.error('events') ? (
          <p className="text-danger mt-2 text-xs" role="alert">{fields.error('events')}</p>
        ) : null}
        {presetLabel ? (
          <p className="text-ink-secondary mt-2 text-xs">
            見本「{presetLabel}」の条件を選んだ状態で開いています。すべてのイベントへ変えるときは上の選択を押してください。
          </p>
        ) : null}
        {!sendAllEvents && (
          <div className="space-y-3">
            {WEBHOOK_EVENT_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="text-ink-faint text-xs font-medium">{group.label}</p>
                <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
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
            <details className="rounded-control border border-hairline px-3 py-2">
              <summary className="text-action cursor-pointer text-xs font-semibold">
                受信Webhookごとの出来事を種類IDで指定する（詳細設定）
              </summary>
              <div className="mt-3">
                <Field
                  label="受信Webhookの種類ID"
                  htmlFor="wh-incoming"
                  note="「incoming_webhook.<種類ID>」の形で送ります。カンマ区切りで複数入れられます。"
                >
                  <input
                    id="wh-incoming"
                    type="text"
                    value={incomingSources}
                    onChange={(event) => setIncomingSources(event.target.value)}
                    placeholder="例: form-source, another-source"
                    className={`${inputClass} font-mono`}
                  />
                </Field>
              </div>
            </details>
          </div>
        )}
      </fieldset>

      <Field
        label="シークレット"
        htmlFor="wh-secret"
        required
        error={fields.error('secret')}
        note="送信時に X-Harness-Signature ヘッダで署名します（値は v1=署名。入力は「タイムスタンプ.イベントID.本文」の HMAC-SHA256。X-Harness-Event-Id・X-Harness-Timestamp とあわせて送ります）。受け取る側で同じ値を使って確かめてください。"
      >
        <div className="flex gap-2">
          <input
            {...fields.bind('secret')}
            id="wh-secret"
            type="text"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            className={`${inputClass} font-mono`}
            aria-invalid={fields.invalid('secret') || undefined}
          />
          <Button variant="secondary" className="text-ink-secondary px-3 py-2 whitespace-nowrap h-auto" type="button" onClick={() => setSecret(generateSecret())}>
            作り直す
          </Button>
        </div>
      </Field>

      <Field
        label="失敗したときの送り直し"
        htmlFor="wh-retries"
        note="相手が 5xx を返したときや、つながらなかったときに送り直します。1分・5分・30分…と間隔を空け、上限は7回です。相手が 4xx を返した場合は送り直しません。"
      >
        <div className="flex items-center gap-1.5">
          <input
            id="wh-retries"
            type="number"
            min={0}
            max={7}
            value={maxRetries}
            onChange={(event) => setMaxRetries(event.target.value)}
            className={`${inputClass} w-24 tabular-nums`}
          />
          <span className="text-ink-faint text-xs">回まで</span>
        </div>
      </Field>
      {stepUpPrompt}
      <UnsavedLeaveDialog open={leaveTarget !== null} subject="入力した送り先" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </CreatePage>
  )
}

/*
 * ★V8-B の切り替え。v8 の器は別器（new-v8.tsx）に置き、
 * v7 の器・動きはこの下の V7 のまま残す。
 */
export default function NewWebhookPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') {
    return <NewWebhookPageV8 />
  }
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NewWebhookForm />
    </Suspense>
  )
}
