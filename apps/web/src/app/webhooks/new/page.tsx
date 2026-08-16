'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const MIN_SECRET_LENGTH = 32

/** 推測されない文字列を作る。手で決めさせると必ず短いものが混ざる。 */
function generateSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function NewWebhookPage() {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [eventTypes, setEventTypes] = useState('')
  const [secret, setSecret] = useState(generateSecret)
  const [maxRetries, setMaxRetries] = useState('0')

  return (
    <CreatePage
      title="Webhookを追加する"
      description="こちらで起きたことを、外のシステムへ知らせます。"
      parent={['外部連携', '/webhooks']}
      validate={() => {
        if (!name.trim()) return '名前を入力してください'
        if (!/^https:\/\//.test(url.trim())) return 'URLは https:// で始めてください'
        if (secret.length < MIN_SECRET_LENGTH) {
          return `シークレットは${MIN_SECRET_LENGTH}文字以上にしてください`
        }
        return null
      }}
      onSave={async () => {
        const res = await api.webhooks.outgoing.create({
          name: name.trim(),
          url: url.trim(),
          eventTypes: eventTypes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          secret,
          maxRetries: Number(maxRetries) || 0,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="名前" htmlFor="wh-name" required>
        <input
          id="wh-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 外部CRM連携"
          className={inputClass}
        />
      </Field>

      <Field label="送り先のURL" htmlFor="wh-url" required note="https:// のみです。">
        <input
          id="wh-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          className={inputClass}
        />
      </Field>

      <Field
        label="送るイベント"
        htmlFor="wh-events"
        note="カンマ区切り。* を入れると全部のイベントを送ります。"
      >
        <input
          id="wh-events"
          type="text"
          value={eventTypes}
          onChange={(e) => setEventTypes(e.target.value)}
          placeholder="friend.added, message.received"
          className={inputClass}
        />
      </Field>

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
            onChange={(e) => setSecret(e.target.value)}
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
        note="相手が 5xx を返したときや、つながらなかったときに送り直します。0.5秒・1秒・2秒…と間隔を空け、上限は5回です。相手が 4xx を返した場合は送り直しません。"
      >
        <div className="flex items-center gap-1.5">
          <input
            id="wh-retries"
            type="number"
            min={0}
            max={5}
            value={maxRetries}
            onChange={(e) => setMaxRetries(e.target.value)}
            className={`${inputClass} w-24 tabular-nums`}
          />
          <span className="text-ink-faint text-xs">回まで</span>
        </div>
      </Field>
    </CreatePage>
  )
}
