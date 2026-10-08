'use client'

import { useEffect, useState } from 'react'
import type { Folder } from '@line-crm/shared'
import { api } from '@/lib/api'
import Checkbox from '@/components/shared/checkbox'
import FolderPanel, { type FolderPanelRow } from '@/components/shared/folder-panel'
import { FolderDot } from '@/components/shared/folder-dot'
import Notice from '@/components/shared/notice'

export const ALL_ACCOUNTS = 'all'
const UNFILED = 'none'
type AccountMembership = { folderId: string | null; folder: Folder | null }

/** 統括のアカウント一覧と同じ口。配れるアカウントの集合は呼ぶ側の権限付きAPIを使う。 */
export function useDistributionFolders(enabled: boolean) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [membership, setMembership] = useState<Map<string, AccountMembership> | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let current = true
    setFailed(false)
    void Promise.all([api.lineAccounts.list(), api.lineAccountFolders.list()]).then(([accounts, response]) => {
      if (!accounts.success || !response.success) throw new Error('アカウントのフォルダを読み込めませんでした。')
      if (!current) return
      const rows = [...response.data.folders].sort((a, b) => a.displayOrder - b.displayOrder)
      const byId = new Map(rows.map((folder) => [folder.id, folder]))
      setFolders(rows)
      setMembership(new Map(accounts.data.map((account) => [account.id, {
        folderId: account.folderId ?? null,
        folder: account.folderId ? byId.get(account.folderId) ?? account.folder ?? null : null,
      }])))
    }).catch(() => { if (current) { setFailed(true); setMembership(null) } })
    return () => { current = false }
  }, [enabled])
  return { folders, membership, failed }
}

export function accountsInFolder<T extends { id: string }>(accounts: T[], filter: string, membership: Map<string, AccountMembership> | null): T[] {
  if (filter === ALL_ACCOUNTS) return accounts
  // 未取得を未分類として扱わない。
  return accounts.filter((account) => membership?.has(account.id) && (filter === UNFILED
    ? membership.get(account.id)?.folderId === null : membership.get(account.id)?.folderId === filter))
}

export function distributionFolderRows({ accounts, folders, membership, selected, onChange, disabled }: {
  accounts: Array<{ id: string }>
  folders: Folder[]
  membership: Map<string, AccountMembership> | null
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}): FolderPanelRow[] {
  const row = (id: string, label: string, folder?: Folder | null): FolderPanelRow => {
    const ids = accountsInFolder(accounts, id, membership).map((account) => account.id)
    const count = ids.filter((accountId) => selected.includes(accountId)).length
    return {
      id, label, count: ids.length,
      icon: id === ALL_ACCOUNTS ? undefined : <FolderDot folder={folder} />,
      trailing: <Checkbox aria-label={`${label}をまとめて選ぶ`} checked={ids.length > 0 && count === ids.length}
        indeterminate={count > 0 && count < ids.length} disabled={disabled || ids.length === 0}
        onCheckedChange={(checked) => onChange(checked ? [...new Set([...selected, ...ids])] : selected.filter((accountId) => !ids.includes(accountId)))} />,
    }
  }
  return [row(ALL_ACCOUNTS, 'すべて'), ...(membership ? [
    ...folders.map((folder) => row(folder.id, folder.name, folder)), row(UNFILED, '未分類', null),
  ] : [])]
}

export function DistributionFolderPanel({ rows, activeId, onSelect, failed, compact }: {
  rows: FolderPanelRow[]; activeId: string; onSelect: (id: string) => void; failed: boolean; compact?: boolean
}) {
  return <>
    <FolderPanel heading={compact ? 'フォルダ' : 'アカウントのフォルダ'} headingHelp="フォルダごとに選べます。" rows={rows} activeId={activeId} onSelect={onSelect} />
    {failed ? <Notice tone="warn" message="フォルダを読み込めませんでした。ページを再読み込みしてください。" /> : null}
  </>
}
