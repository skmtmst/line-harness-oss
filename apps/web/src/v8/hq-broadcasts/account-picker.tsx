'use client'

import { useMemo } from 'react'
import type { Folder, LineAccount } from '@line-crm/shared'
import StatusBadge from '@/components/shared/status-badge'
import { PICKER_ALL, PICKER_UNFILED } from '@/components/shared/entity-picker'
import { HqAccountPickerDialog, type HqAccountFolders } from '@/components/shared/hq-account-picker'
import { formatNumber } from '@/lib/format'
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

/** 送るアカウントを選ぶ窓（共通の配るアカウントの窓・dJZ7Q）。確定するまでは配信の宛先を変えない。 */
export default function BroadcastAccountPicker({ accounts, folders, foldersFailed, initialIds, initialFolder, onConfirm, onCancel }: {
  accounts: BroadcastAccount[]; folders: Folder[]; foldersFailed: boolean
  initialIds: string[]; initialFolder?: string
  onConfirm: (ids: string[]) => void; onCancel: () => void
}) {
  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const data = useMemo<HqAccountFolders>(() => ({ folders, failed: foldersFailed, membership: foldersFailed ? null : new Map(accounts.map((account) => [account.id, {
    folderId: account.folderId ?? null,
    folder: folders.find((folder) => folder.id === account.folderId) ?? account.folder ?? null,
  }])) }), [accounts, folders, foldersFailed])
  const startFolder = !initialFolder || initialFolder === 'all' ? PICKER_ALL : initialFolder === 'none' ? PICKER_UNFILED : initialFolder
  return <HqAccountPickerDialog title="送るアカウントを選ぶ" accounts={accounts} data={data} initialIds={initialIds} initialFolder={startFolder}
    meta={(account) => `友だち ${byId.get(account.id)?.friendCount == null ? '—（未取得）' : formatNumber(byId.get(account.id)!.friendCount!)} 人`}
    rowExtra={(item) => <AccountConnection account={byId.get(item.id)!} />}
    onConfirm={onConfirm} onCancel={onCancel} />
}
