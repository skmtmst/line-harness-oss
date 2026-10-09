'use client'

import { useMemo, useRef, useState } from 'react'
import type { Folder, LineAccount } from '@line-crm/shared'
import Button from '@/components/shared/button'
import SearchField from '@/components/shared/search-field'
import SelectionDialog from '@/components/shared/selection-dialog'
import StatusBadge from '@/components/shared/status-badge'
import DistributionAccountPicker from '@/v8/hq-templates/distribution-account-picker'
import { ALL_ACCOUNTS } from '@/v8/hq-templates/distribution-accounts'
import { formatNumber } from '@/lib/format'
import shell from '@/components/shared/source-picker-dialog.module.css'
import styles from './account-picker.module.css'

export type BroadcastAccount = LineAccount & { friendCount: number | null }

function AccountConnection({ account }: { account: BroadcastAccount }) {
  const blocked = account.isActive === false || account.channelAccessTokenConfigured === false
  const reason = account.isActive === false ? 'アカウントを停止しているため、今は送れません。'
    : account.channelAccessTokenConfigured === false ? 'LINE のトークンが未設定のため、今は送れません。'
    : account.connection?.status === 'warn' ? 'LINE の接続設定を確認してください。送れるかは最終確認で確かめます。' : ''
  const status = blocked ? '送れません' : account.connection?.status === 'ok' ? '正常' : account.connection?.status === 'warn' ? '要確認' : '未確認'
  return <span className={styles.connection}>
    <StatusBadge size="compact" tone={blocked ? 'danger' : status === '正常' ? 'success' : status === '要確認' ? 'warning' : 'neutral'}>{status}</StatusBadge>
    {reason ? <small className={styles.reason} title={reason}>{reason}</small> : null}
  </span>
}

/** 配る窓の選択部分を使い、確定するまでは配信の宛先を変更しない。 */
export default function BroadcastAccountPicker({ accounts, folders, foldersFailed, initialIds, initialFolder, onConfirm, onCancel }: {
  accounts: BroadcastAccount[]; folders: Folder[]; foldersFailed: boolean
  initialIds: string[]; initialFolder?: string
  onConfirm: (ids: string[]) => void; onCancel: () => void
}) {
  const [selected, setSelected] = useState(initialIds)
  const [filter, setFilter] = useState(initialFolder ?? ALL_ACCOUNTS)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const folderData = useMemo(() => ({ folders, failed: foldersFailed, membership: foldersFailed ? null : new Map(accounts.map((account) => [account.id, {
    folderId: account.folderId ?? null,
    folder: folders.find((folder) => folder.id === account.folderId) ?? account.folder ?? null,
  }])) }), [accounts, folders, foldersFailed])
  return <SelectionDialog title="アカウントを選ぶ" description="送るアカウントを選びます。フォルダごとにまとめて選べます。" onCancel={onCancel} initialFocusRef={searchRef}
    search={<SearchField ref={searchRef} aria-label="アカウントを探す" placeholder="アカウントを探す" value={search} onChange={setSearch} onClear={() => setSearch('')} />}
    footer={<>
      <span className={shell.selection} aria-live="polite">{`選んだ ${selected.length} アカウント`}</span>
      <Button onClick={onCancel}>キャンセル</Button>
      <Button variant="primary" onClick={() => onConfirm(selected)}>{`${selected.length} アカウントにする`}</Button>
    </>}
  >
    <div className={styles.body}>
      <DistributionAccountPicker accounts={accounts} folders={folderData} selected={selected} onChange={setSelected} filter={filter} onFilter={setFilter} search={search} busy={false} headerSearch showCount={false} dialogLayout
        accountMeta={(id) => `友だち ${byId.get(id)?.friendCount == null ? '—（未取得）' : formatNumber(byId.get(id)!.friendCount!)} 人`}
        accountState={(id) => <AccountConnection account={byId.get(id)!} />} />
    </div>
  </SelectionDialog>
}
