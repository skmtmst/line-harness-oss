'use client'

import { useEffect, useState } from 'react'
import { FolderPlus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import { TextField } from '@/components/shared/text-field'

/** 設計 `byqIW` の左からの順番。フォルダ種別を問わず同じ8色を使う。 */
export const TAG_FOLDER_COLORS = [
  '#06C755',
  '#F5C56B',
  '#6854D9',
  '#2463D4',
  '#08BE69',
  '#7957D5',
  '#68737D',
  '#E5484D',
] as const

type Props = {
  open: boolean
  editId?: string | null
  onClose: () => void
  onSaved?: () => void
}

/**
 * タグ用フォルダの追加・編集。V6 `byqIW`。
 *
 * `folders(kind=tag)` と別のフォルダを同じフォームで作らない。
 * 種別選択を置くと、友だち情報欄の設計と保存先が混ざるため。
 */
export default function TagFolderDialog({ open, editId = null, onClose, onSaved }: Props) {
  const editing = Boolean(editId)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_FOLDER_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setConfirmDelete(false)
    if (!editId) {
      setName('')
      setColor(TAG_FOLDER_COLORS[0])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void api.tagGroups.list().then((result) => {
      if (cancelled) return
      if (!result.success) {
        setError(result.error || 'フォルダを読み込めませんでした')
        return
      }
      const group = result.data.find((item) => item.id === editId)
      if (!group) {
        setError('指定したフォルダが見つかりませんでした')
        return
      }
      setName(group.name)
      setColor(group.color ?? TAG_FOLDER_COLORS[0])
    }).catch(() => {
      if (!cancelled) setError('フォルダを読み込めませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [editId, open])

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || loading || saving || deleting) return
    setSaving(true)
    setError('')
    try {
      const result = editId
        ? await api.tagGroups.update(editId, { name: trimmed, color })
        : await api.tagGroups.create({ name: trimmed, color })
      if (!result.success) throw new Error(result.error)
      onSaved?.()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'フォルダを保存できませんでした')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!editId || saving || deleting) return
    setDeleting(true)
    setError('')
    try {
      const result = await api.tagGroups.delete(editId)
      if (!result.success) throw new Error(result.error)
      setConfirmDelete(false)
      onSaved?.()
      onClose()
    } catch (reason) {
      setConfirmDelete(false)
      setError(reason instanceof Error ? reason.message : 'フォルダを削除できませんでした')
    } finally {
      setDeleting(false)
    }
  }

  const busy = loading || saving || deleting
  return (
    <>
      <Dialog
        open={open}
        title={editing ? 'フォルダを編集' : 'フォルダを追加'}
        description={editing ? '名前と色を変えられます。削除しても中の項目は未分類に残ります。' : 'タグをまとめるフォルダの名前と色を決めます。'}
        size="compact"
        showCloseButton
        busy={busy}
        error={error}
        onCancel={onClose}
        footer={(
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
            <div>
              {editing ? (
                <Button
                  variant="dangerOutline"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  フォルダを削除
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button disabled={busy} onClick={onClose}>キャンセル</Button>
              <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
                <FolderPlus aria-hidden="true" size={16} />
                {saving ? '保存中…' : editing ? 'フォルダを保存' : 'フォルダを追加'}
              </Button>
            </div>
          </div>
        )}
      >
        <div data-design-node="byqIW" className="grid gap-5 pt-1">
          <label className="grid gap-2">
            <span className="text-label font-bold text-ink">フォルダ名</span>
            <TextField
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
              disabled={busy}
              placeholder="例：お問い合わせフォロー"
              aria-label="フォルダ名"
            />
          </label>

          <fieldset disabled={busy} className="grid gap-2">
            <legend className="text-label font-bold text-ink">フォルダの色</legend>
            <div className="flex flex-wrap gap-2">
              {TAG_FOLDER_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-label={`フォルダの色 ${item}`}
                  aria-pressed={color.toUpperCase() === item}
                  onClick={() => setColor(item)}
                  className={`flex h-10 w-10 items-center justify-center rounded-control border bg-canvas ${color.toUpperCase() === item ? 'border-accent ring-2 ring-accent/25' : 'border-hairline'}`}
                >
                  <span className="h-5 w-5 rounded-full" style={{ backgroundColor: item }} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          <section className="rounded-control border border-hairline bg-canvas-sunken px-4 py-3" aria-label="一覧での表示">
            <p className="text-caption font-semibold text-ink-faint">一覧での表示</p>
            <div className="mt-2 flex items-center gap-2 text-label font-bold text-ink">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
              <span className="truncate" title={name.trim() || 'フォルダ名'}>{name.trim() || 'フォルダ名'}</span>
            </div>
          </section>

          <p className="text-caption leading-5 text-ink-faint">この画面は追加と編集で共通です。フォルダを削除しても、中のタグは削除されず未分類に残ります。</p>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        title={`「${name || 'このフォルダ'}」を削除しますか？`}
        description="中のタグは削除されず、未分類へ移ります。この操作は元に戻せません。"
        confirmLabel="フォルダを削除"
        destructive
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
