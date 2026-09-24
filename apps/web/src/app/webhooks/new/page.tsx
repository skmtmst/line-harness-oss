'use client'

import { useState } from 'react'
import { EC_EVENT_TYPES, ecEventLabel } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { AsideCard, Field, inputClass } from '@/components/shared/create-page'
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
    ],
  },
  {
    id: 'ec',
    label: 'ECの出来事',
    events: EC_EVENT_TYPES.map((value) => ({ value, label: ecEventLabel(value) })),
  },
]

/** 送信Webhookを作る唯一のフォーム。一覧の追加導線もこの画面へ集約する。 */
export default function NewWebhookPage() {
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  /* #975 U067: CSV手入力ではなく「すべて」かチェック選択で決める。 */
  const [sendAllEvents, setSendAllEvents] = useState(true)
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  /* 受信Webhookごとの発火 `incoming_webhook.<種類>` は種類IDで指定する詳細設定。 */
  const [incomingSources, setIncomingSources] = useState('')
  const [secret, setSecret] = useState(generateSecret)
  const [maxRetries, setMaxRetries] = useState('0')

  const toggleEvent = (value: string) => {
    setSelectedEvents((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

  return (
    <CreatePage
      title="Webhookを追加する"
      description="このツールのできごとを外部へ知らせます（送り出す向きのみ）。"
      showHeader={false}
      parent={['外部連携', '/webhooks']}
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
        const res = await api.webhooks.outgoing.create({
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
        })
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
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="送るイベントの決め方">
          <label className="border-hairline flex min-h-9 cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-sm font-semibold text-ink">
            <input
              type="radio"
              name="wh-event-mode"
              checked={sendAllEvents}
              onChange={() => setSendAllEvents(true)}
            />
            すべてのイベントを送る
          </label>
          <label className="border-hairline flex min-h-9 cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-sm font-semibold text-ink">
            <input
              type="radio"
              name="wh-event-mode"
              checked={!sendAllEvents}
              onChange={() => setSendAllEvents(false)}
            />
            送るイベントを選ぶ
          </label>
        </div>
        {!sendAllEvents && (
          <div className="space-y-3">
            {WEBHOOK_EVENT_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="text-ink-faint text-xs font-bold">{group.label}</p>
                <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {group.events.map((event) => (
                    <li key={event.value}>
                      <label className="border-hairline hover:bg-canvas-sunken flex cursor-pointer items-start gap-2 rounded-control border px-3 py-2">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={selectedEvents.includes(event.value)}
                          onChange={() => toggleEvent(event.value)}
                        />
                        <span className="min-w-0">
                          <span className="text-ink block text-sm font-semibold">{event.label}</span>
                          <span className="text-ink-faint block font-mono text-micro">{event.value}</span>
                        </span>
                      </label>
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
    </CreatePage>
  )
}
