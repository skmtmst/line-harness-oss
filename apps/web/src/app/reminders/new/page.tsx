'use client'

import { useEffect, useState } from 'react'
import type { ReminderTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const TRIGGERS: Array<{ key: ReminderTriggerType; label: string }> = [
  { key: 'manual', label: '手動で対象を登録' },
  { key: 'booking', label: '予約が入ったとき' },
  { key: 'event', label: 'イベントに申し込まれたとき' },
]

export default function NewReminderPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerType, setTriggerType] = useState<ReminderTriggerType>('manual')
  const [sendAtTime, setSendAtTime] = useState('')
  const [targetTagId, setTargetTagId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
  }, [])

  return (
    <CreatePage
      title="リマインダを作る"
      description="決めた時間に、まとめて送ります。"
      parent={['リマインダ', '/reminders']}
      validate={() => (name.trim() ? null : '名前を入力してください')}
      onReset={() => {
        setName('')
        setDescription('')
      }}
      onSave={async () => {
        const res = await api.reminders.create({
          name: name.trim(),
          description: description.trim() || null,
          triggerType,
          sendAtTime: triggerType === 'manual' ? null : sendAtTime || null,
          targetTagId: targetTagId || null,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="名前" htmlFor="rm-name" required>
        <input
          id="rm-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 予約前日のご案内"
          className={inputClass}
        />
      </Field>

      <Field label="説明" htmlFor="rm-desc">
        <textarea
          id="rm-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <Field label="いつ対象に加えるか" htmlFor="rm-trigger" required>
        <select
          id="rm-trigger"
          value={triggerType}
          onChange={(e) => setTriggerType(e.target.value as ReminderTriggerType)}
          className={inputClass}
        >
          {TRIGGERS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      {triggerType !== 'manual' && (
        <Field
          label="送る時刻を固定する"
          htmlFor="rm-time"
          note="空にすると、予約時刻を起点にステップの時間差だけずらして届きます。10時の予約は前日10時、20時の予約は前日20時、という具合です。時刻を入れると、予約が何時でもその時刻に届きます。"
        >
          <input
            id="rm-time"
            type="time"
            value={sendAtTime}
            onChange={(e) => setSendAtTime(e.target.value)}
            className={`${inputClass} w-40`}
          />
        </Field>
      )}

      <Field label="対象を絞るタグ" htmlFor="rm-tag" note="空欄なら対象者全員に届きます。">
        <select
          id="rm-tag"
          value={targetTagId}
          onChange={(e) => setTargetTagId(e.target.value)}
          className={inputClass}
        >
          <option value="">— 絞らない —</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <p className="text-ink-faint text-xs leading-relaxed">
        作成したあと、一覧から「何分前に何を送るか」のステップを足してください。
        ステップが1つも無いと、対象に加わっても何も届きません。
      </p>
    </CreatePage>
  )
}
