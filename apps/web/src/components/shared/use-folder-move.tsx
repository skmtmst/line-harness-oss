'use client'

import { useEffect, useRef, useState } from 'react'
import type { Folder } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import BulkBar from './bulk-bar'
import Button from './button'
import Checkbox from './checkbox'
import { EntityPickerDialog } from './entity-picker'
import { notifyToast } from './toast'
import { formatNumber } from '@/lib/format'

type Item = { id: string; name: string }
const UNFILED = '__unfiled__'

/** 本人・権限の変化による中断だけを、一般の通信失敗と分けて伝える。 */
export class FolderMovePermissionError extends Error {
  constructor() { super('権限が変わったため、フォルダへの移動を中止しました。'); this.name = 'FolderMovePermissionError' }
}

type PermissionControls = {
  lockedReason?: string
  /** 理由の有無ではなく、実行直前の現在の許可を判定する。 */
  canWriteNow: () => boolean
}

/** 行とまとめ操作は同じ選ぶ窓。失敗した行だけ残し、成功した行は再送しない。 */
export function useFolderMove<T extends Item>({ accountId, canEdit, items, folders, move, onChanged, permission }: {
  accountId: string | null; canEdit: boolean; items: T[]; folders: Folder[]
  move: (item: T, folderId: string | null) => Promise<void>
  onChanged: () => void | Promise<void>
  /** 指定時だけ、権限が無くても同じ選択欄と開いた候補を残す。未指定は従来どおり。 */
  permission?: PermissionControls
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targets, setTargets] = useState<T[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const account = useRef(accountId)
  account.current = accountId
  const currentPermission = useRef(permission)
  const currentCanEdit = useRef(canEdit)
  currentPermission.current = permission
  currentCanEdit.current = canEdit
  const canWriteNow = () => currentCanEdit.current && (currentPermission.current?.canWriteNow() ?? true)
  const showControls = canEdit || Boolean(permission)
  const resetOnPermission = permission ? undefined : canEdit
  useEffect(() => { setSelected(new Set()); setTargets([]); setError('') }, [accountId, resetOnPermission])
  useEffect(() => {
    setSelected((old) => {
      const next = new Set([...old].filter((id) => items.some((item) => item.id === id)))
      return next.size === old.size ? old : next
    })
  }, [items])
  const open = (rows: T[]) => {
    if (lock.current || !rows.length) return
    if (permission ? !canWriteNow() : !canEdit) {
      if (permission) notifyToast(new FolderMovePermissionError().message, { tone: 'error' })
      return
    }
    setTargets(rows); setError('')
  }
  const perform = async (id: string) => {
    if (!accountId || lock.current) return
    if (permission ? !canWriteNow() : !canEdit) {
      if (permission) setError(new FolderMovePermissionError().message)
      return
    }
    const startedAccount = accountId
    lock.current = true; setBusy(true); setError('')
    const failed: T[] = []
    let done = 0
    let cause: unknown
    try {
      for (const [index, target] of targets.entries()) {
        if (account.current !== startedAccount) return
        if (permission && !canWriteNow()) { failed.push(...targets.slice(index)); cause = new FolderMovePermissionError(); break }
        try { await move(target, id === UNFILED ? null : id); done += 1 }
        catch (caught) {
          failed.push(target); cause = caught
          if (permission && caught instanceof FolderMovePermissionError) { failed.push(...targets.slice(index + 1)); break }
        }
      }
      if (account.current !== startedAccount) return
      setTargets(failed)
      setSelected(new Set(failed.map((item) => item.id)))
      if (failed.length) setError(`${formatNumber(failed.length)}件を移せませんでした。${cause instanceof FolderMovePermissionError ? cause.message : cause instanceof ApiError && cause.status === 409 ? '別の人が先に変更しました。一覧を読み直してください。' : '一覧とフォルダを読み直してお試しください。'}`)
      if (done) notifyToast(`${done}件をフォルダへ移しました`)
      await onChanged()
    } catch {
      if (account.current === startedAccount) setError('移動後の一覧を読み直せませんでした。再読み込みしてください。')
    } finally { lock.current = false; setBusy(false) }
  }
  return {
    isSelected: (id: string) => showControls && selected.has(id),
    open: (item: T) => open([item]),
    checkbox: (item: T) => showControls ? <Checkbox aria-label={`${item.name}を選ぶ`} checked={selected.has(item.id)} lockedReason={permission?.lockedReason} disabled={busy || Boolean(permission && !canWriteNow())} onClick={(event) => event.stopPropagation()} onCheckedChange={(next) => { if (!busy && (!permission || canWriteNow())) setSelected((old) => { const value = new Set(old); if (next) value.add(item.id); else value.delete(item.id); return value }) }} /> : null,
    pageCheckbox: showControls ? <Checkbox aria-label="このページを全部選ぶ" lockedReason={permission?.lockedReason} disabled={busy || items.length === 0 || Boolean(permission && !canWriteNow())} checked={items.length > 0 && items.every((item) => selected.has(item.id))} indeterminate={selected.size > 0 && selected.size < items.length} onCheckedChange={(next) => { if (!busy && (!permission || canWriteNow())) setSelected(next ? new Set(items.map((item) => item.id)) : new Set()) }} /> : null,
    overlays: <>
      {showControls ? <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button variant="secondary" lockedReason={permission?.lockedReason} disabled={busy || Boolean(permission && !canWriteNow())} onClick={() => open(items.filter((item) => selected.has(item.id)))}>フォルダへ移す</Button>
      </BulkBar> : null}
      {showControls && targets.length ? <EntityPickerDialog title="移すフォルダを選ぶ" confirmLabel="フォルダへ移す" items={[{ id: UNFILED, name: '未分類' }, ...folders.map((folder) => ({ id: folder.id, name: folder.name }))]} error={error} busy={busy} confirmLockedReason={permission?.lockedReason} confirmDisabled={Boolean(permission && !canWriteNow())} onConfirm={(id) => void perform(id)} onCancel={() => { if (!lock.current) setTargets([]) }} /> : null}
    </>,
  }
}
