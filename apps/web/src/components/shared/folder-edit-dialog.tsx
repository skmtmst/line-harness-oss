'use client'

import { useState } from 'react'
import type { Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import Button from './button'
import ConfirmDialog from './confirm-dialog'
import Dialog from './dialog'
import { FOLDER_COLORS } from './folder-add-dialog'

export interface FolderEditDialogProps {
  folder: Pick<Folder, 'id' | 'name' | 'color'>
  lineAccountId?: string
  onClose: () => void
  onSaved: (action: 'updated' | 'deleted') => void
}

/** 名前・色・削除を同じ決まりで扱う、汎用フォルダ編集の窓。 */
export default function FolderEditDialog({
  folder,
  lineAccountId,
  onClose,
  onSaved,
}: FolderEditDialogProps) {
  const [name, setName] = useState(folder.name)
  const [color, setColor] = useState(folder.color ?? FOLDER_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api.folders.update(
        folder.id,
        { name: trimmed, color },
        lineAccountId,
      )
      if (!result.success) {
        setError(result.error)
        return
      }
      onSaved('updated')
      onClose()
    } catch {
      setError('フォルダを更新できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const result = await api.folders.delete(folder.id, lineAccountId)
      if (!result.success) {
        setError(result.error)
        setDeleteOpen(false)
        return
      }
      onSaved('deleted')
      onClose()
    } catch {
      setError('フォルダを削除できませんでした')
      setDeleteOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div data-design-node="CzndJ">
        <Dialog
          open
          title="フォルダを編集"
          description="名前と色は、中のテンプレートを残したまま変更できます。"
          busy={saving}
          error={error || undefined}
          onCancel={() => {
            if (!saving) onClose()
          }}
          footer={(
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="text-danger hover:bg-danger-bg rounded-control px-3 py-2 text-sm"
              >
                フォルダを削除
              </button>
              <div className="flex gap-2">
                <Button onClick={onClose} disabled={saving}>やめる</Button>
                <Button
                  onClick={() => void save()}
                  disabled={saving || !name.trim()}
                  variant="primary"
                >
                  {saving ? '保存中…' : 'フォルダを保存'}
                </Button>
              </div>
            </div>
          )}
        >
          <label className="mt-4 block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">
              フォルダ名 <span className="text-danger">*</span>
            </span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) void save()
              }}
              className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </label>

          <div className="mt-3">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">色</span>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setColor(item)}
                  aria-label={`色 ${item}`}
                  aria-pressed={color === item}
                  style={{ backgroundColor: item }}
                  className={`rounded-pill h-7 w-7 ${color === item ? 'ring-accent ring-2 ring-offset-2' : ''}`}
                />
              ))}
            </div>
          </div>
        </Dialog>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={`「${folder.name}」を削除しますか？`}
        description="中のテンプレートは削除されず、「未分類」に残ります。"
        confirmLabel="フォルダを削除"
        destructive
        busy={saving}
        error={error}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  )
}
