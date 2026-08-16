'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

export default function NewAffiliatePage() {
  const [name, setName] = useState('')
  const [commissionRate, setCommissionRate] = useState('')
  const [email, setEmail] = useState('')
  const [payoutCycle, setPayoutCycle] = useState('')

  return (
    <CreatePage
      title="アフィリエイターを追加する"
      description="紹介してくれる人を登録します。"
      parent={['成果', '/conversions?tab=affiliates']}
      validate={() => (name.trim() ? null : '名前を入力してください')}
      onReset={() => {
        setName('')
        setEmail('')
      }}
      onSave={async () => {
        const res = await api.affiliates.create({
          name: name.trim(),
          commissionRate: commissionRate.trim() === '' ? undefined : Number(commissionRate),
        })
        if (!res.success) throw new Error(res.error)
        // 連絡先と支払いサイクルは作成のAPIが受けないので、続けて更新する。
        // 1つの操作として見えるように、ここでまとめておく。
        if (email.trim() || payoutCycle.trim()) {
          await api.affiliates.update(res.data.id, {
            email: email.trim() || null,
            payoutCycle: payoutCycle.trim() || null,
          })
        }
        return res.data.id
      }}
    >
      <Field label="名前" htmlFor="af-name" required>
        <input
          id="af-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label="報酬率"
        htmlFor="af-rate"
        note="案件ごとに単価を決める場合は空欄で構いません。"
      >
        <div className="flex items-center gap-1.5">
          <input
            id="af-rate"
            type="number"
            min={0}
            step="0.1"
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
            placeholder="10"
            className={`${inputClass} w-28 tabular-nums`}
          />
          <span className="text-ink-faint text-sm">%</span>
        </div>
      </Field>

      <Field label="連絡先" htmlFor="af-email" note="報酬の連絡に使います。">
        <input
          id="af-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="partner@example.com"
          className={inputClass}
        />
      </Field>

      <Field
        label="支払いサイクル"
        htmlFor="af-cycle"
        note="取り決めの記録です。報酬の計算には使いません。"
      >
        <input
          id="af-cycle"
          type="text"
          value={payoutCycle}
          onChange={(e) => setPayoutCycle(e.target.value)}
          placeholder="例: 月末締め翌月末払い"
          maxLength={100}
          className={inputClass}
        />
      </Field>

      <p className="text-ink-faint text-xs leading-relaxed">
        紹介用のコードは、推測されないよう自動で作られます。手で決めることはできません。
      </p>
    </CreatePage>
  )
}
