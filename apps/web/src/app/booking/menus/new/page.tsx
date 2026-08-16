'use client'

import { useState } from 'react'
import { bookingApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

export default function NewBookingMenuPage() {
  const { selectedAccountId } = useAccount()
  const [name, setName] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState('0')
  const [basePrice, setBasePrice] = useState('0')
  const [concurrentCapacity, setConcurrentCapacity] = useState('1')
  const [cutoffHours, setCutoffHours] = useState('')
  const [intakeQuestion, setIntakeQuestion] = useState('')

  return (
    <CreatePage
      title="メニューを追加する"
      description="お客様が選ぶ施術やコースです。"
      parent={['予約設定', '/booking/menus']}
      validate={() => {
        if (!selectedAccountId) return '先に上部でLINEアカウントを選んでください'
        if (!name.trim()) return 'メニュー名を入力してください'
        if (Number(durationMinutes) < 1) return '所要時間は1分以上にしてください'
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
      }}
      onSave={async () => {
        const res = await bookingApi.createMenu(selectedAccountId!, {
          name: name.trim(),
          category_label: categoryLabel.trim() || null,
          description: description.trim() || null,
          duration_minutes: Number(durationMinutes),
          buffer_after_minutes: Number(bufferAfterMinutes) || 0,
          base_price: Number(basePrice) || 0,
          concurrent_capacity: Number(concurrentCapacity) || 1,
          cutoff_hours_before: cutoffHours ? Number(cutoffHours) : null,
          intake_question: intakeQuestion.trim() || null,
        })
        return res.id
      }}
    >
      <Field label="メニュー名" htmlFor="bm-name" required>
        <input
          id="bm-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: カット＋シャンプー"
          className={inputClass}
        />
      </Field>

      <Field label="分類" htmlFor="bm-category" note="お客様の画面で見出しになります。">
        <input
          id="bm-category"
          type="text"
          value={categoryLabel}
          onChange={(e) => setCategoryLabel(e.target.value)}
          placeholder="例: ヘアケア"
          className={inputClass}
        />
      </Field>

      <Field label="説明" htmlFor="bm-desc">
        <textarea
          id="bm-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="所要時間（分）" htmlFor="bm-duration" required>
          <input
            id="bm-duration"
            type="number"
            min={1}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field label="後の空き時間（分）" htmlFor="bm-buffer" note="片づけや移動の時間です。">
          <input
            id="bm-buffer"
            type="number"
            min={0}
            value={bufferAfterMinutes}
            onChange={(e) => setBufferAfterMinutes(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field label="料金（円）" htmlFor="bm-price">
          <input
            id="bm-price"
            type="number"
            min={0}
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
        <Field
          label="同時に受ける件数"
          htmlFor="bm-capacity"
          note="2以上にすると、このメニュー同士だけが同じ枠に入ります。"
        >
          <input
            id="bm-capacity"
            type="number"
            min={1}
            value={concurrentCapacity}
            onChange={(e) => setConcurrentCapacity(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
      </div>

      <Field
        label="受付の締め切り"
        htmlFor="bm-cutoff"
        note="開始の何時間前まで受けるか。空欄なら直前まで受けます。"
      >
        <div className="flex items-center gap-1.5">
          <input
            id="bm-cutoff"
            type="number"
            min={1}
            value={cutoffHours}
            onChange={(e) => setCutoffHours(e.target.value)}
            placeholder="なし"
            className={`${inputClass} w-28 tabular-nums`}
          />
          <span className="text-ink-faint text-xs">時間前</span>
        </div>
      </Field>

      <Field
        label="予約時にお客様へ聞くこと"
        htmlFor="bm-intake"
        note="空欄なら質問しません。回答は予約のメモとして残ります。"
      >
        <input
          id="bm-intake"
          type="text"
          value={intakeQuestion}
          onChange={(e) => setIntakeQuestion(e.target.value)}
          placeholder="例: 気になっている箇所はありますか？"
          maxLength={200}
          className={inputClass}
        />
      </Field>
    </CreatePage>
  )
}
