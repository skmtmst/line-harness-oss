'use client'

/*
 * フォルダの列の「…」の中身（名前を変える・色を変える・並べ替える・消す）と、その窓。
 * 絵：V8.pen 共通部品4 の H（nH0fZ）。（2026-10-08）：フォルダを作ったあと消す入口が無い画面があった。
 *
 * どの画面も同じ共通のフォルダ（/api/folders・kind ごと）を使うので、口と窓はここに1つ。
 * 画面は `rowActions(folder, index)` を FolderPanel の行へ広げ、`dialogs` を置くだけ。
 * 消すと中身は消えず「未分類」へ（サーバーがそうする）。消す前に確認の窓で件数を読ませる。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import { lockReason } from './permission-lock'
import ConfirmDialog from './confirm-dialog'
import FolderAddDialog from './folder-add-dialog'
import { describeFolderFailure } from './folder-failure'
import { notifyToast } from './toast'
import type { FolderPanelRow } from './folder-panel'
import { formatNumber } from '@/lib/format'

export interface FolderRowActionsOptions {
  /** `folders.kind`（'rich_menu'・'scenario' など）。 */
  kind: string
  folders: Folder[]
  accountId?: string | null
  /** 変えてよい人だけtrue。falseでも操作を残し、実行は拒否する。 */
  enabled: boolean
  /** nullは権限未確定などで理由をまだ表示しない。拒否そのものは維持する。 */
  lockedReason?: string | null
  /** 任意の同期判定。保持した操作も最新の判定を読み、拒否へ変わっても窓を残す。 */
  canWriteNow?: () => boolean
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
  const inside = typeof count === 'number' ? `中の${itemLabel} ${formatNumber(count)} 件` : `中の${itemLabel}`
  return `${inside}は消えずに「未分類」へ移ります。消したフォルダは元に戻せません。`
}

export function useFolderRowActions({
  kind, folders, accountId, enabled, lockedReason, canWriteNow, itemLabel, countOf, onChanged, onDeleted, placeholder,
}: FolderRowActionsOptions): {
  rowActions: (folder: Folder, index: number) => Pick<FolderPanelRow, 'onEdit' | 'onMoveUp' | 'onMoveDown' | 'onDelete' | 'lockedReason' | 'actionsDisabled'>
  dialogs: ReactNode
} {
  const [editing, setEditing] = useState<Folder | null>(null)
  /* 件数は押したときに読む（画面の後ろで決まる値を、描くときに読まない）。 */
  const [deleting, setDeleting] = useState<Folder | null>(null)
  const [deletingCount, setDeletingCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const scope = useRef({ kind, accountId })
  if (scope.current.kind !== kind || scope.current.accountId !== accountId) scope.current = { kind, accountId }
  const renderedScope = scope.current
  const dialogScope = useRef(renderedScope)
  const dialogEpoch = useRef({})
  const renderedDialog = dialogEpoch.current
  const latest = useRef({ enabled, canWriteNow, busy, deleting, editing })
  latest.current = { enabled, canWriteNow, busy, deleting, editing }
  const livePermission = canWriteNow !== undefined
  useEffect(() => {
    if (livePermission) { dialogEpoch.current = {}; setEditing(null); setDeleting(null); setBusy(false); setError('') }
  }, [kind, accountId, livePermission])
  const usesLivePermission = () => livePermission || latest.current.canWriteNow !== undefined
  const sameScope = () => renderedScope === scope.current
  const sameDialog = () => sameScope() && dialogScope.current === renderedScope && renderedDialog === dialogEpoch.current
  const canActNow = () => usesLivePermission()
    ? sameScope() && latest.current.enabled && !lockReason(latest.current.enabled)
      && latest.current.canWriteNow !== undefined && latest.current.canWriteNow()
    : enabled && !lockReason(enabled)
  const permissionReason = lockedReason === undefined ? lockReason(enabled) : lockedReason ?? undefined
  const actionEnabled = canActNow()
  const interrupted = '権限が変わったため、フォルダの操作を中止しました。'
  const changeBusy = (value: boolean) => {
    if (usesLivePermission()) latest.current.busy = value
    setBusy(value)
  }

  const move = async (index: number, direction: -1 | 1) => {
    const target = folders[index]
    const neighbor = folders[index + direction]
    if (!canActNow()) {
      if (usesLivePermission() && sameScope()) notifyToast(interrupted, { tone: 'error' })
      return
    }
    if (!target || !neighbor || (usesLivePermission() ? latest.current.busy : busy)) return
    changeBusy(true)
    try {
      await api.folders.swapOrder(target.id, neighbor.id, accountId ?? undefined)
    } catch {
      // 並びが変わらなかったときも、読み直した今の並びを見せる
    } finally {
      if (!usesLivePermission() || sameScope()) {
        changeBusy(false)
        await onChanged()
      }
    }
  }

  const remove = async () => {
    if (usesLivePermission() && (!sameDialog() || deleting !== latest.current.deleting)) return
    if (!canActNow()) { if (usesLivePermission()) setError(interrupted); return }
    if (!deleting || (usesLivePermission() ? latest.current.busy : busy)) return
    changeBusy(true)
    setError('')
    try {
      const res = await api.folders.delete(deleting.id, accountId ?? undefined)
      if (usesLivePermission() && (!sameDialog() || deleting !== latest.current.deleting)) return
      if (!res.success) throw new Error(res.error)
      onDeleted?.(deleting.id)
      setDeleting(null)
      await onChanged()
    } catch (caught) {
      if (usesLivePermission() && (!sameDialog() || deleting !== latest.current.deleting)) return
      // 理由ごとに言い分ける（共通の describeFolderFailure）。消されていたら読み直して窓を閉じる。
      const failure = describeFolderFailure(caught, 'delete')
      if (failure.kind === 'missing') {
        notifyToast(failure.message, { tone: 'error' })
        onDeleted?.(deleting.id)
        setDeleting(null)
        await onChanged()
        return
      }
      if (failure.kind === 'conflict') await onChanged()
      setError(failure.message)
    } finally {
      if (!usesLivePermission() || sameScope()) changeBusy(false)
    }
  }

  const rowActions = (folder: Folder, index: number) => ({
    lockedReason: permissionReason,
    actionsDisabled: !actionEnabled,
    onEdit: () => {
      if (!canActNow()) return
      if (usesLivePermission()) { dialogScope.current = scope.current; dialogEpoch.current = {}; setDeleting(null) }
      setEditing(folder)
    },
    onMoveUp: index > 0 ? () => void move(index, -1) : undefined,
    onMoveDown: index < folders.length - 1 ? () => void move(index, 1) : undefined,
    onDelete: () => {
      if (!canActNow()) return
      if (usesLivePermission()) { dialogScope.current = scope.current; dialogEpoch.current = {}; setEditing(null) }
      setError(''); setDeletingCount(countOf?.(folder.id) ?? null); setDeleting(folder)
    },
  })

  const dialogs = (livePermission ? dialogScope.current === renderedScope : enabled && !lockReason(enabled)) ? (
    <>
      {editing ? (
        <FolderAddDialog
          kind={kind}
          folder={editing}
          accountId={accountId}
          note={`${itemLabel}を分けてしまう箱です。消しても、中の${itemLabel}は未分類に残ります。`}
          placeholder={placeholder}
          onClose={() => {
            if (usesLivePermission() && !sameDialog()) return
            if (usesLivePermission()) dialogEpoch.current = {}
            setEditing(null)
          }}
          onAdded={() => {
            if (usesLivePermission() && !sameDialog()) return
            if (usesLivePermission()) dialogEpoch.current = {}
            setEditing(null); void onChanged()
          }}
          onReload={onChanged}
          canSaveNow={livePermission ? () => sameDialog() && canActNow() : undefined}
          confirmLockedReason={livePermission ? permissionReason : undefined}
          confirmDisabled={livePermission ? !actionEnabled && !permissionReason : undefined}
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
        onCancel={() => {
          if (usesLivePermission() && !sameDialog()) return
          if (!busy) {
            if (usesLivePermission()) dialogEpoch.current = {}
            setDeleting(null); setError('')
          }
        }}
        onConfirm={() => void remove()}
        confirmLockedReason={livePermission ? permissionReason : undefined}
        confirmDisabled={livePermission ? !actionEnabled && !permissionReason : undefined}
      />
    </>
  ) : null

  return { rowActions, dialogs }
}
