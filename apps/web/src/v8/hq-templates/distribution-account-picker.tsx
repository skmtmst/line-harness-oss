'use client'

/*
 * 配る窓の中の「アカウントを選ぶ」部分。共通のまとめて選ぶ中身（EntityMultiSelect・dJZ7Q）に
 * 統括のアカウントのフォルダと、配布状況（版・上書き）を載せる。
 */
import type { ReactNode } from 'react'
import type { HqTemplateReceivedVersion } from '@line-crm/shared'
import StatusBadge from '@/components/shared/status-badge'
import SearchField from '@/components/shared/search-field'
import { EntityMultiSelect, PICKER_ALL, PICKER_UNFILED } from '@/components/shared/entity-picker'
import { toHqAccountItems, toPickerFolders } from '@/components/shared/hq-account-picker'
import { ALL_ACCOUNTS, type useDistributionFolders } from './distribution-accounts'
import styles from './saved-distribution-dialog.module.css'

const UNFILED = 'none'
const toPicker = (filter: string) => filter === ALL_ACCOUNTS ? PICKER_ALL : filter === UNFILED ? PICKER_UNFILED : filter
const fromPicker = (folder: string) => folder === PICKER_ALL ? ALL_ACCOUNTS : folder === PICKER_UNFILED ? UNFILED : folder

export default function DistributionAccountPicker({ accounts, folders, selected, onChange, filter, onFilter, search = '', onSearch, received = null, receivedFailed = false, busy, compact = false, accountState, notice, accountMeta, headerSearch = false, showCount = true }: {
  accountMeta?: (accountId: string) => ReactNode
  headerSearch?: boolean; showCount?: boolean; dialogLayout?: boolean
  accountState?: (accountId: string) => ReactNode; notice?: ReactNode
  accounts: Array<{ id: string; name: string }>
  folders: ReturnType<typeof useDistributionFolders>
  selected: string[]; onChange: (ids: string[]) => void
  filter: string; onFilter: (id: string) => void
  search?: string; onSearch?: (value: string) => void
  received?: HqTemplateReceivedVersion[] | null; receivedFailed?: boolean
  busy: boolean; compact?: boolean
}) {
  const items = toHqAccountItems(accounts, folders, () => undefined)
  const state = (accountId: string) => {
    if (accountState) return accountState(accountId)
    if (compact) return null
    const version = received?.find((row) => row.accountId === accountId)?.targetVersion.version
    return <>
      {version != null ? <span className={styles.overwrite}>配ると上書き</span> : null}
      {received === null ? <span className={styles.pending}>{receivedFailed ? '配布状況を確認できません' : '配布状況を確認中…'}</span>
        : <StatusBadge size="compact" tone={version != null ? 'info' : 'neutral'}>{version != null ? `版 ${version} を配布済み` : '未配布'}</StatusBadge>}
    </>
  }
  return <div className={styles.picker}>
    <EntityMultiSelect items={items} folders={toPickerFolders(folders.folders)} foldersFailed={folders.failed} selected={selected} onChange={onChange}
      query={search} busy={busy} folder={toPicker(filter)} onFolder={(value) => onFilter(fromPicker(value))} folderHeading="フォルダ" listLabel="配るアカウント"
      searchSlot={!headerSearch && onSearch ? <SearchField aria-label="アカウントを探す" placeholder="名前で探す" value={search} disabled={busy} onChange={onSearch} onClear={() => onSearch('')} /> : null}
      rowExtra={(item) => <span className={styles.state}>{accountMeta ? <span className={styles.meta}>{accountMeta(item.id)}</span> : null}{state(item.id)}</span>} />
    {notice}
    {!compact && showCount ? <p className={styles.count} aria-live="polite">{`選んだ ${selected.length} アカウント`}</p> : null}
  </div>
}
