'use client'

import { useMemo } from 'react'
import type { Folder, LineAccount } from '@line-crm/shared'
import { PICKER_ALL, PICKER_UNFILED } from '@/components/shared/entity-picker'
import { HqAccountPickerDialog, type HqAccountFolders } from '@/components/shared/hq-account-picker'
import { formatNumber } from '@/lib/format'
import styles from './account-picker.module.css'

export type BroadcastAccount = LineAccount & { friendCount: number | null }

/** 行の2段目の状態（絵 ：「1,284 人・つながっています」）。送れない・要確認は色で分ける。 */
function AccountConnection({ account }: { account: BroadcastAccount }) {
  const text = account.isActive === false ? '今は送れません（アカウントを停止中）'
    : account.channelAccessTokenConfigured === false ? '今は送れません（LINE のトークンが未設定）'
    : account.connection?.status === 'ok' ? 'つながっています'
    : account.connection?.status === 'warn' ? '接続を確かめてください' : '接続は未確認'
  const tone = account.isActive === false || account.channelAccessTokenConfigured === false ? 'danger' : account.connection?.status === 'warn' ? 'warning' : undefined
  return <span className={styles.connection} data-connection-tone={tone} title={tone === 'warning' ? '送れるかは最終確認で確かめます。' : undefined}>{`・${text}`}</span>
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
    meta={(account) => `${byId.get(account.id)?.friendCount == null ? '—（未取得）' : formatNumber(byId.get(account.id)!.friendCount!)} 人`}
    rowExtra={(item) => <AccountConnection account={byId.get(item.id)!} />}
    note="除く人は次の手順で決めます" stacked
    onConfirm={onConfirm} onCancel={onCancel} />
}
