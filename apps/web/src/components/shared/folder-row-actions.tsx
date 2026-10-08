'use client'

/*
 * フォルダの列の「…」の中身（名前を変える・色を変える・並べ替える・消す）と、その窓。
 * 絵：V8.pen 共通部品4 の H（nH0fZ）。B-35（2026-10-08）：フォルダを作ったあと消す入口が無い画面があった。
 *
 * どの画面も同じ共通のフォルダ（/api/folders・kind ごと）を使うので、口と窓はここに1つ。
 * 画面は `rowActions(folder, index)` を FolderPanel の行へ広げ、`dialogs` を置くだけ。
 * 消すと中身は消えず「未分類」へ（サーバーがそうする）。消す前に確認の窓で件数を読ませる。
 */
import { useState, type ReactNode } from 'react'
import type { Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import ConfirmDialog from './confirm-dialog'
import FolderAddDialog from './folder-add-dialog'
import type { FolderPanelRow } from './folder-panel'

export interface FolderRowActionsOptions {
  /** `folders.kind`（'rich_menu'・'scenario' など）。 */
  kind: string
  folders: Folder[]
  accountId?: string | null
  /** 変えてよい人だけ true。false のときは「…」を出さない（閲覧のみには押せない口を置かない）。 */
  enabled: boolean
  /** 確認の窓の言葉に使う中身の呼び名（例：リッチメニュー）。 */
  itemLabel: string
  /** フォルダの中の件数。数えていないときは null（言葉から件数を外す）。 */
  countOf?: (folderId: string) => number | null | undefined
  /** 足した・変えた・消したあとに読み直す。 */
  onChanged: () => void | Promise<void>
  /** 消したフォルダを選んでいたときに「すべて」へ戻すなど。 */
  onDeleted?: (folderId: string) => void
  placeholder?: string
}

export function deleteFolderDescription(itemLabel: string, count: number | null | undefined) {
  const inside = typeof count === 'number' ? `中の${itemLabel} ${count} 件` : `中の${itemLabel}`
  return `${inside}は消えずに「未分類」へ移ります。消したフォルダは元に戻せません。`
}

export function useFolderRowActions({
  kind, folders, accountId, enabled, itemLabel, countOf, onChanged, onDeleted, placeholder,
}: FolderRowActionsOptions): {
  rowActions: (folder: Folder, index: number) => Pick<FolderPanelRow, 'onEdit' | 'onMoveUp' | 'onMoveDown' | 'onDelete'>
  dialogs: ReactNode
} {
  const [editing, setEditing] = useState<Folder | null>(null)
  /* 件数は押したときに読む（画面の後ろで決まる値を、描くときに読まない）。 */
  const [deleting, setDeleting] = useState<Folder | null>(null)
  const [deletingCount, setDeletingCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const move = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!target || !neighbor || busy) return
    setBusy(true)
    try {
      await api.folders.swapOrder(target.id, neighbor.id, accountId ?? undefined)
    } catch {
      // 並びが変わらなかったときも、読み直した今の並びを見せる
    } finally {
      setBusy(false)
      await onChanged()
    }
  }

  const remove = async () => {
    if (!deleting || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await api.folders.delete(deleting.id, accountId ?? undefined)
      if (!res.success) throw new Error(res.error)
      onDeleted?.(deleting.id)
      setDeleting(null)
      await onChanged()
    } catch {
      setError('フォルダを消せませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const rowActions = (folder: Folder, index: number) => (enabled ? {
    onEdit: () => setEditing(folder),
    onMoveUp: index > 0 ? () => void move(index, -1) : undefined,
    onMoveDown: index < folders.length - 1 ? () => void move(index, 1) : undefined,
    onDelete: () => { setError(''); setDeletingCount(countOf?.(folder.id) ?? null); setDeleting(folder) },
  } : {})

  const dialogs = (
    <>
      {editing ? (
        <FolderAddDialog
          kind={kind}
          folder={editing}
          accountId={accountId}
          note={`${itemLabel}を分けてしまう箱です。消しても、中の${itemLabel}は未分類に残ります。`}
          placeholder={placeholder}
          onClose={() => setEditing(null)}
          onAdded={() => { setEditing(null); void onChanged() }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={`フォルダ「${deleting?.name ?? ''}」を消しますか？`}
        description={deleteFolderDescription(itemLabel, deletingCount)}
        confirmLabel="フォルダを消す"
        cancelLabel="キャンセル"
        destructive
        busy={busy}
        error={error || undefined}
        onCancel={() => { if (!busy) { setDeleting(null); setError('') } }}
        onConfirm={() => void remove()}
      />
    </>
  )

  return { rowActions, dialogs }
}
