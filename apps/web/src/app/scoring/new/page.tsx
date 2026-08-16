'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const EVENT_TYPES = [
  { value: 'message_received', label: 'メッセージを受け取った' },
  { value: 'link_clicked', label: 'リンクを踏んだ' },
  { value: 'form_submitted', label: 'フォームに答えた' },
  { value: 'tag_added', label: 'タグが付いた' },
  { value: 'booking_created', label: '予約が入った' },
  { value: 'purchase', label: '購入した' },
]

export default function NewScoringRulePage() {
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState(EVENT_TYPES[0].value)
  const [scoreValue, setScoreValue] = useState('1')

  return (
    <CreatePage
      title="付与ルールを作る"
      description="友だちの行動に点数を付けます。"
      parent={['マイル', '/scoring']}
      validate={() => {
        if (!name.trim()) return 'ルール名を入力してください'
        if (!Number.isInteger(Number(scoreValue))) return '点数は整数で入力してください'
        return null
      }}
      onReset={() => setName('')}
      onSave={async () => {
        const res = await api.scoring.createRule({
          name: name.trim(),
          eventType,
          scoreValue: Number(scoreValue),
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="ルール名" htmlFor="sc-name" required>
        <input
          id="sc-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: リンクを踏んだら1点"
          className={inputClass}
        />
      </Field>

      <Field label="きっかけ" htmlFor="sc-event" required>
        <select
          id="sc-event"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className={inputClass}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="点数"
        htmlFor="sc-score"
        required
        note="マイナスも指定できます（ブロックされたら減点する、など）。"
      >
        <input
          id="sc-score"
          type="number"
          value={scoreValue}
          onChange={(e) => setScoreValue(e.target.value)}
          className={`${inputClass} w-32 tabular-nums`}
        />
      </Field>
    </CreatePage>
  )
}
