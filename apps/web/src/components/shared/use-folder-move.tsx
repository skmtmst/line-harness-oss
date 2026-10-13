'use client'

import { useEffect, useRef, useState } from 'react'
import type { Folder } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import BulkBar from './bulk-bar'
import Button from './button'
import Checkbox from './checkbox'
import { EntityPickerDialog } from './entity-picker'
import { notifyToast } from './toast'

type Item = { id: string; name: string }
const UNFILED = '__unfiled__'

/** 行とまとめ操作は同じ選ぶ窓。失敗した行だけ残し、成功した行は再送しない。 */
export function useFolderMove<T extends Item>({ accountId, canEdit, items, folders, move, onChanged }: {
  accountId: string | null; canEdit: boolean; items: T[]; folders: Folder[]
  move: (item: T, folderId: string | null) => Promise<void>
  onChanged: () => void | Promise<void>
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targets, setTargets] = useState<T[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const account = useRef(accountId)
  account.current = accountId
  useEffect(() => { setSelected(new Set()); setTargets([]); setError('') }, [accountId, canEdit])
  useEffect(() => {
    setSelected((old) => {
      const next = new Set([...old].filter((id) => items.some((item) => item.id === id)))
      return next.size === old.size ? old : next
    })
  }, [items])
  const open = (rows: T[]) => {
    if (!canEdit || lock.current || !rows.length) return
    setTargets(rows); setError('')
  }
  const perform = async (id: string) => {
    if (!accountId || !canEdit || lock.current) return
    const startedAccount = accountId
    lock.current = true; setBusy(true); setError('')
    const failed: T[] = []
    let done = 0
    let cause: unknown
    try {
      for (const target of targets) {
        if (account.current !== startedAccount) return
        try { await move(target, id === UNFILED ? null : id); done += 1 }
        catch (caught) { failed.push(target); cause = caught }
      }
      if (account.current !== startedAccount) return
      setTargets(failed)
      setSelected(new Set(failed.map((item) => item.id)))
      if (failed.length) setError(`${failed.length}件を移せませんでした。${cause instanceof ApiError && cause.status === 409 ? '別の人が先に変更しました。一覧を読み直してください。' : '一覧とフォルダを読み直してお試しください。'}`)
      if (done) notifyToast(`${done}件をフォルダへ移しました`)
      await onChanged()
    } catch {
      if (account.current === startedAccount) setError('移動後の一覧を読み直せませんでした。再読み込みしてください。')
    } finally { lock.current = false; setBusy(false) }
  }
  return {
    open: (item: T) => open([item]),
    checkbox: (item: T) => canEdit ? <Checkbox aria-label={`${item.name}を選ぶ`} checked={selected.has(item.id)} onClick={(event) => event.stopPropagation()} onCheckedChange={(next) => setSelected((old) => { const value = new Set(old); if (next) value.add(item.id); else value.delete(item.id); return value })} /> : null,
    pageCheckbox: canEdit ? <Checkbox aria-label="このページを全部選ぶ" checked={items.length > 0 && items.every((item) => selected.has(item.id))} indeterminate={selected.size > 0 && selected.size < items.length} onCheckedChange={(next) => setSelected(next ? new Set(items.map((item) => item.id)) : new Set())} /> : null,
    overlays: <>
      {canEdit ? <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button variant="secondary" disabled={busy} onClick={() => open(items.filter((item) => selected.has(item.id)))}>フォルダへ移す</Button>
      </BulkBar> : null}
      {canEdit && targets.length ? <EntityPickerDialog title="移すフォルダを選ぶ" confirmLabel="フォルダへ移す" items={[{ id: UNFILED, name: '未分類' }, ...folders.map((folder) => ({ id: folder.id, name: folder.name }))]} error={error} busy={busy} onConfirm={(id) => void perform(id)} onCancel={() => { if (!lock.current) setTargets([]) }} /> : null}
    </>,
  }
}
