'use client'

/*
 * フォルダを1つ足す窓。Pencil V5 の `CsGTC`（共通 フォルダ 追加・編集・削除）。
 *
 * シナリオ・タグ・一斉配信・リマインダ…と、分類を持つ画面すべてで同じものを
 * 出す。画面ごとに書き写していたので、色の並びや「やめる／追加する」の
 * 文言が少しずつ違っていた。1か所にまとめる。
 *
 * 違うのは `kind` だけ。フォルダは `folders.kind` で画面ごとに分かれている。
 */

import { useState } from 'react'
import { api } from '@/lib/api'
import type { Folder } from '@line-crm/shared'

/** フォルダの色。全画面で同じ8色を使う。 */
export const FOLDER_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#6B7280',
]

export interface FolderAddDialogProps {
  /** `folders.kind`。'broadcast' / 'scenario' など。 */
  kind: string
  /**
   * 直すフォルダ。渡すと**追加ではなく名前と色を直す窓**になる。
   *
   * 設計 `CzndJ` の「名前を変更」「色を変える」。窓を2つ作らないのは、
   * 入れる項目が同じで、離すと文言や色の並びがまたずれるため。
   */
  folder?: Folder
  /** 窓の下に出す一言。「消しても中身は未分類に残る」など。 */
  note?: string
  /** 例に出す名前。 */
  placeholder?: string
  onClose: () => void
  /** 追加できたら呼ぶ。一覧を読み直す。 */
  onAdded: () => void
}

export default function FolderAddDialog({
  kind,
  folder,
  note,
  placeholder = '例: 01_キャンペーン',
  onClose,
  onAdded,
}: FolderAddDialogProps) {
  const [name, setName] = useState(folder?.name ?? '')
  const [color, setColor] = useState(folder?.color ?? FOLDER_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const add = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      const res = folder
        ? await api.folders.update(folder.id, { name: trimmed })
        : await api.folders.create({ kind, name: trimmed, color })
      if (!res.success) {
        setError(res.error)
        return
      }
      onAdded()
      onClose()
    } catch {
      setError(folder ? 'フォルダを直せませんでした' : 'フォルダを追加できませんでした')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-canvas rounded-panel w-full max-w-md p-5 shadow-xl">
        <h2 className="text-ink text-base font-bold">{folder ? 'フォルダを直す' : 'フォルダを追加'}</h2>
        {note && <p className="text-ink-faint mt-1 text-xs leading-relaxed">{note}</p>}

        <label className="mt-4 block">
          <span className="text-ink-secondary mb-1 block text-xs font-medium">
            フォルダ名 <span className="text-danger">*</span>
          </span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void add()
            }}
            placeholder={placeholder}
            className="border-hairline rounded-control bg-canvas text-ink w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info"
          />
        </label>

        <div className="mt-3">
          <span className="text-ink-secondary mb-1 block text-xs font-medium">色</span>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`色 ${c}`}
                aria-pressed={color === c}
                style={{ backgroundColor: c }}
                className={`rounded-pill h-7 w-7 ${color === c ? 'ring-accent ring-2 ring-offset-2' : ''}`}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-danger mt-3 text-xs">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-ink-secondary hover:bg-canvas-sunken rounded-control px-4 py-2 text-sm"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={saving || !name.trim()}
            className="bg-accent-deep hover:brightness-92 text-on-accent rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            {saving ? '追加中…' : '追加する'}
          </button>
        </div>
      </div>
    </div>
  )
}
