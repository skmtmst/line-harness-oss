'use client'

import type { ReactNode } from 'react'
import { Send } from 'lucide-react'
import type { HqTemplateReceivedVersion } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import { type useDistributionFolders } from './distribution-accounts'
import DistributionAccountPicker from './distribution-account-picker'
import styles from './saved-distribution-dialog.module.css'

export default function SavedDistributionDialog({ accounts, folders, selected, onChange, filter, onFilter, search, onSearch, received, receivedFailed, busy, error, onLater, onDistribute, title, help, accountState, notice, canDistribute = true }: {
  title?: string; help?: ReactNode
  accountState?: (accountId: string) => ReactNode
  notice?: ReactNode; canDistribute?: boolean
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
  return <Dialog open title={title ?? "保存しました。アカウントに配りますか？"} designNode="d8CL4g" designWidth={860}
    designHeaderPadding="20px 24px 8px" designContentPadding="0" busy={busy} error={error} onCancel={onLater}
    titleHelp={<HelpTip label="アカウントに配るの説明">{help ?? <>配ると、選んだアカウントのテンプレートに新しい版として届きます。あとで一覧の「…」からも配れます。</>}</HelpTip>}
    footer={<div className={styles.footer}>
      <Button disabled={busy} onClick={onLater}>あとで</Button>
      <Button variant="primary" disabled={busy || !canDistribute || selected.length === 0} busy={busy} onClick={onDistribute}><Send size={15} aria-hidden="true" />{`${selected.length} アカウントへ配る`}</Button>
    </div>}
  >
    <DistributionAccountPicker {...{ accounts, folders, selected, onChange, filter, onFilter, search, onSearch, received, receivedFailed, busy, accountState, notice }} />
  </Dialog>
}
