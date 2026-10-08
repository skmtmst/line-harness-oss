'use client'

/*
 * 配るアカウントを選ぶ（絵 gQabc の上・一括配信の J5DH6o と同じ形）。フォルダの札で絞り、アカウントのカード
 * （名前の前にフォルダの色の丸・友だちの数）にチェック。見た目は統括の一括配信の「送るアカウント」と同じ CSS を読む。
 * 選べるのは統括のひな形の口が返す配り先（allowedIds）だけ。
 */
import { useEffect, useState } from 'react'
import type { Folder } from '@line-crm/shared'
import CheckCard from '@/components/shared/check-card'
import FilterChip from '@/components/shared/filter-chip'
import { FolderDot, FolderDotName } from '@/components/shared/folder-dot'
import ListState from '@/components/shared/list-state'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import styles from '../hq-broadcasts/create.module.css'

type Account = { id: string; name: string; friendCount: number | null; folderId: string | null; folder: Folder | null }
const ALL = '__all__'
const UNFILED = '__none__'

export default function HqAccountPicker({ title, allowed, selected, onChange, note, disabled }: {
  title: string
  /** 配れるアカウント（統括のひな形の口の配り先）。 */
  allowed: Array<{ id: string; name: string }>
  selected: string[]
  onChange: (ids: string[]) => void
  /** 選んだ数のあとに続ける説明。 */
  note: string
  disabled?: boolean
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [failed, setFailed] = useState<unknown>(null)
  const [filter, setFilter] = useState(ALL)
  const allowedKey = allowed.map((account) => account.id).join(',')
  useEffect(() => {
    let current = true
    void Promise.all([api.lineAccounts.list().catch(() => null), api.lineAccountFolders.list().catch(() => null)])
      .then(([list, folderList]) => {
        if (!current) return
        const byId = new Map((list && list.success ? list.data : []).map((account) => [account.id, account]))
        setAccounts(allowed.map((account) => {
          const found = byId.get(account.id)
          return { id: account.id, name: found?.name ?? account.name, friendCount: found?.stats?.friendCount ?? null, folderId: found?.folderId ?? null, folder: found?.folder ?? null }
        }))
        if (folderList?.success) setFolders(folderList.data.folders)
      })
      .catch((caught) => { if (current) setFailed(caught) })
    return () => { current = false }
    // 配れるアカウントが変わったときだけ読み直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedKey])

  const list = accounts ?? []
  const visible = list.filter((account) => filter === ALL || (filter === UNFILED ? !account.folderId : account.folderId === filter))
  const unfiled = list.filter((account) => !account.folderId).length
  return (
    <div className={styles.accounts} data-design-node="gQabc-accounts">
      <h3>{title}</h3>
      {failed && !accounts ? <ListState kind="error" error={failed} onRetry={() => window.location.reload()} /> : !accounts ? <ListState kind="loading" /> : (
        <>
          <div className={styles.folderChips} role="group" aria-label="フォルダで絞る">
            <FilterChip selected={filter === ALL} onChange={() => setFilter(ALL)} count={list.length}>すべて</FilterChip>
            {folders.filter((folder) => list.some((account) => account.folderId === folder.id)).map((folder) => (
              <FilterChip key={folder.id} selected={filter === folder.id} onChange={() => setFilter(filter === folder.id ? ALL : folder.id)} icon={<FolderDot folder={folder} />} count={list.filter((account) => account.folderId === folder.id).length}>{folder.name}</FilterChip>
            ))}
            {unfiled > 0 && folders.length > 0 ? (
              <FilterChip selected={filter === UNFILED} onChange={() => setFilter(filter === UNFILED ? ALL : UNFILED)} icon={<FolderDot folder={null} />} count={unfiled}>未分類</FilterChip>
            ) : null}
          </div>
          <div className={styles.accountCards}>
            {visible.map((account) => (
              <CheckCard
                key={account.id}
                size="compact"
                checked={selected.includes(account.id)}
                disabled={disabled}
                onChange={(on) => onChange(on ? [...selected, account.id] : selected.filter((id) => id !== account.id))}
                title={<span title={account.name}><FolderDotName folder={account.folder}>{account.name}</FolderDotName></span>}
                note={account.friendCount == null ? '友だち —' : `友だち ${formatNumber(account.friendCount)} 人`}
              />
            ))}
            {visible.length === 0 ? <p className="text-xs text-ink-faint">このフォルダにアカウントはありません。</p> : null}
          </div>
          <p className={styles.accountsNote} aria-live="polite">
            {selected.length === 0 ? `アカウントを選んでください。${note}` : `${formatNumber(selected.length)} アカウントを選んでいます。${note}`}
          </p>
        </>
      )}
    </div>
  )
}
