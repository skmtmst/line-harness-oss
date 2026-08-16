'use client'

import { useEffect, useState } from 'react'
import type { TagGroup } from '@line-crm/shared'
import { api } from '@/lib/api'
import CreatePage, { Field, inputClass } from '@/components/shared/create-page'

const PRESET_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#6B7280',
]

export default function NewTagPage() {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [groupId, setGroupId] = useState('')
  const [groups, setGroups] = useState<TagGroup[]>([])

  useEffect(() => {
    void api.tagGroups.list().then((res) => {
      if (res.success) setGroups(res.data)
    })
  }, [])

  return (
    <CreatePage
      title="タグを作る"
      description="友だちを分けるための目印です。"
      parent={['友だち属性', '/tags']}
      validate={() => (name.trim() ? null : 'タグ名を入力してください')}
      onReset={() => setName('')}
      onSave={async () => {
        const res = await api.tags.create({
          name: name.trim(),
          color,
          groupId: groupId || null,
        })
        if (!res.success) throw new Error(res.error)
        return res.data.id
      }}
    >
      <Field label="タグ名" htmlFor="tag-name" required>
        <input
          id="tag-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 見込み客"
          className={inputClass}
        />
      </Field>

      <Field label="色" note="一覧やトーク画面での見分けに使います。">
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`色 ${c}`}
              className={`h-7 w-7 rounded-full transition-transform ${
                color === c ? 'ring-hairline scale-110 ring-2 ring-offset-2' : 'hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>

      <Field
        label="分類"
        htmlFor="tag-group"
        note="「お悩み」「ペット」のように、タグをまとめる入れ物です。あとから変えられます。"
      >
        <select
          id="tag-group"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className={inputClass}
        >
          <option value="">未分類</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>
    </CreatePage>
  )
}
