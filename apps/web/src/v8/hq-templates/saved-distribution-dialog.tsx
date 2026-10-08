'use client'

import { Search, Send } from 'lucide-react'
import type { HqTemplateReceivedVersion } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import HelpTip from '@/components/shared/help-tip'
import StatusBadge from '@/components/shared/status-badge'
import { FolderDotName } from '@/components/shared/folder-dot'
import { ListPageBody } from '@/components/templates/list-page'
import Select from '@/components/shared/select'
import { accountsInFolder, distributionFolderRows, DistributionFolderPanel, type useDistributionFolders } from './distribution-accounts'
import styles from './saved-distribution-dialog.module.css'

export default function SavedDistributionDialog({ accounts, folders, selected, onChange, filter, onFilter, search, onSearch, received, receivedFailed, busy, error, onLater, onDistribute }: {
  accounts: Array<{ id: string; name: string }>
  folders: ReturnType<typeof useDistributionFolders>
  selected: string[]; onChange: (ids: string[]) => void
  filter: string; onFilter: (id: string) => void
  search: string; onSearch: (value: string) => void
  received: HqTemplateReceivedVersion[] | null
  receivedFailed: boolean
  busy: boolean; error?: string
  onLater: () => void; onDistribute: () => void
}) {
  const visible = accountsInFolder(accounts, filter, folders.membership).filter((account) => account.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const rows = distributionFolderRows({ accounts, ...folders, selected, onChange, disabled: busy })
  const picked = visible.filter((account) => selected.includes(account.id)).length
  return <Dialog open title="保存しました。アカウントに配りますか？" designNode="d8CL4g" designWidth={860}
    designHeaderPadding="20px 24px 8px" designContentPadding="0" busy={busy} error={error} onCancel={onLater}
    titleHelp={<HelpTip label="アカウントに配るの説明">配ると、選んだアカウントのテンプレートに新しい版として届きます。あとで一覧の「…」からも配れます。</HelpTip>}
    footer={<div className={styles.footer}>
      <Button disabled={busy} onClick={onLater}>あとで</Button>
      <Button variant="primary" disabled={busy || selected.length === 0} busy={busy} onClick={onDistribute}><Send size={15} aria-hidden="true" />{`${selected.length} アカウントへ配る`}</Button>
    </div>}
  >
    <ListPageBody folderWidth={190} contentInset fillWidth
      folders={<DistributionFolderPanel compact rows={rows} activeId={filter} onSelect={onFilter} failed={folders.failed} />}
      collapsedFolders={<>
        <Select aria-label="アカウントのフォルダ" value={filter} onChange={onFilter} options={rows.map((row) => ({ value: row.id, label: row.label }))} />
        {rows.find((row) => row.id === filter)?.trailing}
      </>}
      toolbar={<div className={styles.tools}>
        <label className={styles.search}><Search size={14} aria-hidden="true" /><input aria-label="アカウントを探す" placeholder="アカウントを探す" value={search} disabled={busy} onChange={(event) => onSearch(event.target.value)} /></label>
        <Checkbox checked={visible.length > 0 && picked === visible.length} indeterminate={picked > 0 && picked < visible.length} disabled={busy || visible.length === 0}
          onCheckedChange={(checked) => onChange(checked ? [...new Set([...selected, ...visible.map((account) => account.id)])] : selected.filter((id) => !visible.some((account) => account.id === id)))}>すべて選ぶ</Checkbox>
      </div>}
    >
      <div className={styles.list}>
        {visible.map((account) => {
          const version = received?.find((row) => row.accountId === account.id)?.targetVersion.version
          const checked = selected.includes(account.id)
          return <div className={styles.row} data-selected={checked || undefined} key={account.id}>
            <Checkbox id={`hq-saved-${account.id}`} aria-label={account.name} checked={checked} disabled={busy} onCheckedChange={(on) => onChange(on ? [...new Set([...selected, account.id])] : selected.filter((id) => id !== account.id))} />
            <label className={styles.name} htmlFor={`hq-saved-${account.id}`} title={account.name}><FolderDotName folder={folders.membership?.get(account.id)?.folder}>{account.name}</FolderDotName></label>
            <span className={styles.state}>
              {version != null ? <span className={styles.overwrite}>配ると上書き</span> : null}
              {received === null ? <span className={styles.pending}>{receivedFailed ? '配布状況を確認できません' : '配布状況を確認中…'}</span> : <StatusBadge size="compact" tone={version != null ? 'info' : 'neutral'}>{version != null ? `版 ${version} を配布済み` : '未配布'}</StatusBadge>}
            </span>
          </div>
        })}
        {visible.length === 0 ? <p className={styles.empty}>該当するアカウントがありません。</p> : null}
      </div>
      <p className={styles.count} aria-live="polite">{`選んだ ${selected.length} アカウント`}</p>
    </ListPageBody>
  </Dialog>
}
