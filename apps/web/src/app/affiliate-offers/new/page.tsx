'use client'

import { useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

export default function NewAffiliateOfferPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardMiles, setRewardMiles] = useState('')
  const [tagId, setTagId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    void api.tags.list().then((res) => {
      if (res.success) setTags(res.data)
    })
  }, [])

  return (
    <CreatePage
      title="案件を作る"
      description="紹介してもらう対象と、そのときの報酬を決めます。"
      parent={['案件', '/affiliate-offers']}
      validate={() => {
        if (!name.trim()) return '案件名を入力してください'
        if (!rewardAmount && !rewardMiles) return '報酬（金額かマイル）のどちらかを入れてください'
        return null
      }}
      onReset={() => {
        setName('')
        setDescription('')
      }}
      onSave={async () => {
        const res = await api.affiliateOffers.create({
          name: name.trim(),
          description: description.trim() || null,
          rewardAmount: rewardAmount ? Number(rewardAmount) : undefined,
          rewardMiles: rewardMiles ? Number(rewardMiles) : undefined,
          tagId: tagId || null,
        })
        if (!res.success) throw new Error('案件を作成できませんでした')
        return res.data.id
      }}
    >
      <Field label="案件名" htmlFor="of-name" required>
        <input
          id="of-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 初回体験のご紹介"
          className={inputClass}
        />
      </Field>

      <Field label="説明" htmlFor="of-desc" note="紹介する人に見せる説明です。">
        <textarea
          id="of-desc"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="1件あたりの報酬" htmlFor="of-amount">
          <div className="flex items-center gap-1.5">
            <input
              id="of-amount"
              type="number"
              min={0}
              value={rewardAmount}
              onChange={(e) => setRewardAmount(e.target.value)}
              className={`${inputClass} tabular-nums`}
            />
            <span className="text-ink-faint text-sm">円</span>
          </div>
        </Field>
        <Field label="1件あたりのマイル" htmlFor="of-miles">
          <input
            id="of-miles"
            type="number"
            min={0}
            value={rewardMiles}
            onChange={(e) => setRewardMiles(e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </Field>
      </div>

      <Field
        label="成果とみなすタグ"
        htmlFor="of-tag"
        note="紹介された人にこのタグが付いたときを成果とします。"
      >
        <select
          id="of-tag"
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          className={inputClass}
        >
          <option value="">— 指定しない —</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
    </CreatePage>
  )
}
