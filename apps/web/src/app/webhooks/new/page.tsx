'use client'

import { Suspense, useEffect, useState } from 'react'
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
import { MIN_SECRET_LENGTH, generateSecret } from '../secret'

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
  const { gate, prompt: stepUpPrompt } = useStepUpGate()
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

  const toggleEvent = (value: string) => {
    setSelectedEvents((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

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
      validate={() => {
        if (!selectedAccountId) return 'LINEアカウントを選択してください'
        if (!name.trim()) return '名前を入力してください'
        if (!/^https:\/\//.test(url.trim())) return 'URLは https:// で始めてください'
        if (secret.length < MIN_SECRET_LENGTH) {
          return `シークレットは${MIN_SECRET_LENGTH}文字以上にしてください`
        }
        if (!sendAllEvents && selectedEvents.length === 0 && !incomingSources.trim()) {
          return '送るイベントを選ぶか、「すべてのイベントを送る」を選んでください'
        }
        return null
      }}
      onSave={async () => {
        if (!selectedAccountId) throw new Error('LINEアカウントを選択してください')
        const payload = {
          lineAccountId: selectedAccountId,
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
          res = await create(token)
        }
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <p className="text-ink text-sm font-semibold">基本の設定</p>

      <Field label="名前" htmlFor="wh-name" required>
        <input
          id="wh-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例: 外部CRM連携"
          className={inputClass}
        />
      </Field>

      <Field label="送り先のURL" htmlFor="wh-url" required note="https:// のみです。">
        <input
          id="wh-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/webhook"
          className={inputClass}
        />
      </Field>

      {/* #975 U067: イベントコードのCSV手入力をやめ、チェックで選ぶ。 */}
      <fieldset className="space-y-3">
        <legend className="text-ink-secondary text-xs font-bold">
          送るイベント<RequiredBadge />
        </legend>
        <div className="flex flex-wrap gap-2">
          <RadioCard
            name="wh-event-mode"
            value="all"
            checked={sendAllEvents}
            onChange={() => setSendAllEvents(true)}
            title="すべてのイベントを送る"
          />
          <RadioCard
            name="wh-event-mode"
            value="selected"
            checked={!sendAllEvents}
            onChange={() => setSendAllEvents(false)}
            title="送るイベントを選ぶ"
          />
        </div>
        {presetLabel ? (
          <p className="text-ink-secondary mt-2 text-xs">
            見本「{presetLabel}」の条件を選んだ状態で開いています。すべてのイベントへ変えるときは上の選択を押してください。
          </p>
        ) : null}
        {!sendAllEvents && (
          <div className="space-y-3">
            {WEBHOOK_EVENT_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="text-ink-faint text-xs font-bold">{group.label}</p>
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
        note="送信時に X-Webhook-Signature ヘッダで署名します。受け取る側で同じ値を使って確かめてください。"
      >
        <div className="flex gap-2">
          <input
            id="wh-secret"
            type="text"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            className={`${inputClass} font-mono`}
          />
          <button
            type="button"
            onClick={() => setSecret(generateSecret())}
            className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-3 py-2 text-sm whitespace-nowrap"
          >
            作り直す
          </button>
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
    </CreatePage>
  )
}

export default function NewWebhookPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <NewWebhookForm />
    </Suspense>
  )
}
