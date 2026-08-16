'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const EVENT_TYPES = [
  { value: 'purchase', label: '購入' },
  { value: 'signup', label: '登録' },
  { value: 'reserve', label: '予約' },
  { value: 'form_submit', label: 'フォーム送信' },
  { value: 'other', label: 'その他' },
]

export default function NewConversionPointPage() {
  const [name, setName] = useState('')
  const [eventType, setEventType] = useState('purchase')
  const [value, setValue] = useState('')
  const [measureMethod, setMeasureMethod] = useState<'manual' | 'url_reach' | 'webhook'>('manual')
  const [targetUrl, setTargetUrl] = useState('')
  const [countRepeat, setCountRepeat] = useState(true)
  const [attributionDays, setAttributionDays] = useState('')

  return (
    <CreatePage
      title="成果地点を作る"
      description="何をもって成果とするかを決めます。"
      parent={['成果', '/conversions']}
      validate={() => {
        if (!name.trim()) return '名前を入力してください'
        if (measureMethod === 'url_reach' && !targetUrl.trim()) {
          return 'URL到達で数えるときは、対象のURLが要ります'
        }
        return null
      }}
      onReset={() => {
        setName('')
        setValue('')
        setTargetUrl('')
      }}
      onSave={async () => {
        const res = await api.conversions.createPoint({
          name: name.trim(),
          eventType,
          value: value ? Number(value) : null,
          measureMethod,
          targetUrl: measureMethod === 'url_reach' ? targetUrl.trim() : null,
          countRepeat,
          attributionDays: attributionDays ? Number(attributionDays) : null,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="名前" htmlFor="cv-name" required>
        <input
          id="cv-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 購入完了"
          className={inputClass}
        />
      </Field>

      <Field label="種別" htmlFor="cv-type" required>
        <select
          id="cv-type"
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

      <Field label="1件あたりの金額" htmlFor="cv-value" note="空欄なら金額を集計しません。">
        <input
          id="cv-value"
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
          className={`${inputClass} tabular-nums`}
        />
      </Field>

      <Field
        label="数え方"
        htmlFor="cv-method"
        note="ここを決めないと、作っただけで1件も増えません。"
      >
        <select
          id="cv-method"
          value={measureMethod}
          onChange={(e) => setMeasureMethod(e.target.value as typeof measureMethod)}
          className={inputClass}
        >
          <option value="manual">手動で記録する</option>
          <option value="url_reach">URLに到達したら数える</option>
          <option value="webhook">外部から通知を受けて数える</option>
        </select>
      </Field>

      {measureMethod === 'url_reach' && (
        <Field
          label="対象URL"
          htmlFor="cv-url"
          required
          note={
            <>
              前方一致で見ます。<code>?utm_source=...</code>{' '}
              のような文字が後ろに付いても数えます。計測リンク（/t/…）を踏んだ人だけが対象です。
            </>
          }
        >
          <input
            id="cv-url"
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com/thanks"
            className={inputClass}
          />
        </Field>
      )}

      <Field
        label="紹介を紐づける期間"
        htmlFor="cv-days"
        note="空欄なら既定の90日。報酬の計算に効きます。"
      >
        <div className="flex items-center gap-1.5">
          <input
            id="cv-days"
            type="number"
            min={1}
            max={365}
            value={attributionDays}
            onChange={(e) => setAttributionDays(e.target.value)}
            placeholder="90"
            className={`${inputClass} w-24 tabular-nums`}
          />
          <span className="text-ink-faint text-xs">日</span>
        </div>
      </Field>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={!countRepeat}
          onChange={(e) => setCountRepeat(!e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span className="text-ink-secondary text-sm">
          同じ人は一回だけ数える
          <span className="text-ink-faint block text-xs">
            外すと、同じ人が何度でも数えられます（購入のように毎回数えたいとき）。
          </span>
        </span>
      </label>
    </CreatePage>
  )
}
