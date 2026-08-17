'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Template } from '@line-crm/shared'
import { api } from '@/lib/api'

/**
 * テンプレートを選ぶ（設計 V2 2-1-1）。
 *
 * 受信箱の入力欄から開く。選ぶと本文が入力欄に入り、送る前に直せる。
 * 設計の「コピーして編集」はテンプレート管理側の操作なので、ここには置かない。
 *
 * 文字だけのテンプレートを選ばせる。画像やカルーセルは、そのまま入力欄に
 * 入れても文字として送られてしまうので、選べないようにしてある。
 */

export default function TemplatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (content: string) => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void api.templates.list().then((res) => {
      if (!cancelled && res.success) {
        setTemplates((res.data as unknown as Template[]).filter((t) => t.messageType === 'text'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const categories = useMemo(
    () => [...new Set(templates.map((t) => t.category).filter(Boolean))],
    [templates],
  )

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((t) => {
      if (category && t.category !== category) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) || t.messageContent.toLowerCase().includes(q)
      )
    })
  }, [templates, search, category])

  if (!open) return null

  const selected = templates.find((t) => t.id === selectedId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="テンプレートを選ぶ"
      onClick={onClose}
    >
      <div
        className="bg-canvas rounded-card flex max-h-[85vh] w-full max-w-lg flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ink text-base font-bold">テンプレートを選ぶ</h2>
            <p className="text-ink-faint mt-1 text-xs leading-relaxed">
              選ぶと、メッセージ入力欄に本文が入ります。送信前に編集できます。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="text-ink-faint hover:text-ink shrink-0 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="テンプレート名・本文で検索"
          aria-label="テンプレート名・本文で検索"
          className="border-hairline rounded-control mb-2 w-full border px-3 py-2 text-sm"
        />

        {categories.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            <button
              onClick={() => setCategory('')}
              className={`rounded-pill px-3 py-1 text-xs font-medium ${
                category === '' ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary'
              }`}
            >
              すべて
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-pill px-3 py-1 text-xs font-medium ${
                  category === c ? 'bg-accent text-on-accent' : 'bg-canvas-sunken text-ink-secondary'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <p className="text-ink-faint py-8 text-center text-sm">
              {templates.length === 0
                ? '文字のテンプレートがまだありません。'
                : '見つかりませんでした。'}
            </p>
          ) : (
            <ul className="divide-hairline divide-y">
              {shown.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    aria-pressed={selectedId === t.id}
                    className={`w-full px-3 py-2.5 text-left ${
                      selectedId === t.id ? 'bg-accent-bg' : 'hover:bg-canvas-sunken'
                    }`}
                  >
                    <p className="text-ink text-sm font-medium">{t.name}</p>
                    <p className="text-ink-faint mt-0.5 line-clamp-2 text-xs leading-relaxed">
                      {t.messageContent}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-hairline mt-3 flex justify-end gap-2 border-t pt-3">
          <button
            onClick={onClose}
            className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control border px-4 py-2 text-sm font-medium"
          >
            閉じる
          </button>
          <button
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              onPick(selected.messageContent)
              onClose()
            }}
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
          >
            この内容を入れる
          </button>
        </div>
      </div>
    </div>
  )
}
