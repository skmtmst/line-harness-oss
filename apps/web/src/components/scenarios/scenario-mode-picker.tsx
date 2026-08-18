'use client'

import { useEffect, useState } from 'react'
import type { DeliveryMode, ScenarioTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'

/**
 * ① シナリオ情報。設計の3段のうち最初の1つ。
 *
 * **配信方式はここでは決めない。** 作ったあとの「配信方式の選択」
 * （`/scenarios/mode`）で選ぶ。以前はこのモーダルの中で方式も決めていたが、
 * どちらを選ぶと何が変わるのかを並べて見せる場所が無く、読まずに押していた。
 *
 * 作るときは暫定で「時刻で指定」にしておく。設計でおすすめになっている方で、
 * 次の画面で選び直せる（通がまだ0なので変えられる）。
 */
interface Props {
  open: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => Promise<void>
}

const triggerOptions: Array<{
  value: ScenarioTriggerType
  label: string
  description: string
}> = [
  {
    value: 'friend_add',
    label: '友だち追加時',
    description: '新規友だち追加のタイミングで自動開始',
  },
  {
    value: 'tag_added',
    label: 'タグ付与時',
    description: '指定タグが付いたタイミングで自動開始（カスケード運用向け）',
  },
  {
    value: 'manual',
    label: '手動',
    description: '管理画面 / API から明示的に開始するときだけ流れる',
  },
]

export default function ScenarioModePicker({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<ScenarioTriggerType>('friend_add')
  const [triggerTagId, setTriggerTagId] = useState('')
  const [tags, setTags] = useState<Tag[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    void api.tags
      .list()
      .then(res => {
        if (res.success) setTags(res.data)
      })
      .catch(() => undefined)
  }, [open])

  if (!open) return null

  const reset = () => {
    setName('')
    setTriggerType('friend_add')
    setTriggerTagId('')
    setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('シナリオ名を入力してください')
      return
    }
    if (triggerType === 'tag_added' && !triggerTagId) {
      setError('トリガータグを選択してください')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onCreate({
        name,
        triggerType,
        triggerTagId: triggerType === 'tag_added' ? triggerTagId : null,
        deliveryMode: 'absolute_time',
      })
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-canvas rounded-card w-full max-w-lg p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-ink text-lg font-bold">シナリオ情報</h2>
        <p className="text-ink-secondary mt-1 text-xs leading-relaxed">
          名前と、いつ開始するかを決めます。配信方式はこのあとの画面で選びます。
        </p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">
              シナリオ名 <span className="text-danger">*</span>
            </span>
            <input
              type="text"
              autoFocus
              className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              placeholder="例: 友だち追加ウェルカム"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && triggerType !== 'tag_added' && !submitting) {
                  void handleCreate()
                }
              }}
            />
          </label>

          <div>
            <span className="text-ink-secondary mb-1 block text-xs font-medium">いつ開始する？</span>
            <div className="space-y-2">
              {triggerOptions.map(opt => (
                <label
                  key={opt.value}
                  className={`rounded-control flex cursor-pointer items-start gap-2 border p-2 transition-colors ${
                    triggerType === opt.value
                      ? 'border-accent bg-accent-soft'
                      : 'border-hairline hover:bg-canvas-sunken'
                  }`}
                >
                  <input
                    type="radio"
                    name="triggerType"
                    value={opt.value}
                    checked={triggerType === opt.value}
                    onChange={() => setTriggerType(opt.value)}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="text-ink block text-sm font-medium">{opt.label}</span>
                    <span className="text-ink-faint block text-xs">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {triggerType === 'tag_added' && (
            <label className="block">
              <span className="text-ink-secondary mb-1 block text-xs font-medium">
                トリガータグ <span className="text-danger">*</span>
              </span>
              <select
                className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                value={triggerTagId}
                onChange={e => setTriggerTagId(e.target.value)}
              >
                <option value="">-- 選択してください --</option>
                {tags.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="text-ink-faint mt-0.5 block text-xs">
                このタグが友だちに付与されたら、自動でこのシナリオを開始します
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-danger mt-3 text-xs">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-4 py-2 text-sm disabled:opacity-50"
          >
            やめる
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={submitting}
            className="bg-accent hover:bg-accent-hover text-on-accent rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            {submitting ? '作成中…' : '次へ（配信方式の選択）'}
          </button>
        </div>
      </div>
    </div>
  )
}
