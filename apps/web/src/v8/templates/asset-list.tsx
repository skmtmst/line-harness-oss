'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { FileText, Plus } from 'lucide-react'
import BroadcastAssetManager, { type BroadcastAssetListLayout } from '@/components/broadcasts/broadcast-asset-manager'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import EmptyList from '@/components/shared/empty-list'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel, { FOLDER_RAIL_WIDTH, type FolderPanelRow } from '@/components/shared/folder-panel'
import ListState from '@/components/shared/list-state'
import ListToolbar from '@/components/shared/list-toolbar'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { RowMenu } from '@/components/shared/row-actions'
import StatusBadge from '@/components/shared/status-badge'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { Field } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import TruncatedText from '@/components/shared/truncated-text'
import { ListPage } from '@/components/templates'
import { api, type BroadcastAssetKind, type BroadcastMessageAsset } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { KIND_CARDS } from './list-model'

type Props = {
  kind: BroadcastAssetKind
  accountId: string
  tabs: ReactNode
  canMutate: boolean
  lockedReason?: string
  onChanged: () => void
}
type AssetFolder = { id: string; name: string }

export default function AssetTemplatesList(props: Props) {
  return <BroadcastAssetManager kind={props.kind} onChanged={props.onChanged}
    renderLayout={state => <AssetListLayout {...props} {...state} />} />
}

function AssetListLayout({ kind, accountId, tabs, canMutate, lockedReason, items, loadState,
  reload, onEdit, onDelete, editor, deleteDialog }: Props & BroadcastAssetListLayout) {
  const [folders, setFolders] = useState<AssetFolder[]>([])
  const [folderError, setFolderError] = useState('')
  const [folderRetry, setFolderRetry] = useState(0)
  const [folderId, setFolderId] = useState('all')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const meta = KIND_CARDS.find(card => card.key === kind)!
  useEffect(() => {
    let current = true
    setFolders([])
    setFolderError('')
    void api.broadcastMessageAssets.folders.list(accountId).then(result => {
      if (!current) return
      if (!result.success) throw new Error('folders unavailable')
      setFolders(result.data)
    }).catch(() => { if (current) setFolderError('フォルダを読み込めませんでした。') })
    return () => { current = false }
  }, [accountId, folderRetry])
  const ready = loadState === 'ready'
  const count = (id: string) => !ready ? null : items.filter(item => id === 'all'
    || (id === 'unfiled' ? !item.folderId : item.folderId === id)).length
  const rows: FolderPanelRow[] = [
    { id: 'all', kind: 'all', label: 'すべて', count: count('all') },
    ...folders.map(folder => ({ ...folder, label: folder.name, count: count(folder.id), kind: 'folder' as const })),
    { id: 'unfiled', kind: 'unfiled', label: '未分類', count: count('unfiled') },
  ]
  const filtered = items.filter(item => (folderId === 'all'
    || (folderId === 'unfiled' ? !item.folderId : item.folderId === folderId))
    && (status === 'all' || item.status === status)
    && `${item.name} ${assetDescription(item)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const create = <Button variant="primary" {...(canMutate ? { href: meta.href } : { disabled: true })}
    lockedReason={lockedReason}><Plus size={16} aria-hidden="true" />{meta.title}を作る</Button>
  const selectFolder = (id: string) => { setFolderId(id); setPage(1) }
  const addFolder = async () => {
    if (!canMutate || folderBusy || !folderName.trim()) return
    setFolderBusy(true)
    setCreateError('')
    try {
      const result = await api.broadcastMessageAssets.folders.create(accountId, folderName.trim())
      if (!result.success || !result.data) throw new Error('folder creation failed')
      setFolders(current => [...current, result.data!])
      setFolderOpen(false)
      setFolderName('')
    } catch { setCreateError('フォルダを追加できませんでした。もう一度お試しください。') }
    finally { setFolderBusy(false) }
  }
  const clear = () => { setQuery(''); setStatus('all'); setFolderId('all'); setPage(1) }
  return <ListPage title="テンプレート" heightMode="content" skeleton tableInset folderWidth={FOLDER_RAIL_WIDTH}
    help="配信などで使う、メッセージのひな形です。" tabs={tabs}
    folderNav={{ rows, activeId: folderId, onSelect: selectFolder, createAction: create }}
    folders={<FolderPanel rows={rows} activeId={folderId} onSelect={selectFolder} createAction={create}
      onAddFolder={() => { if (canMutate) setFolderOpen(true) }}
      addFolderDisabled={!canMutate} addFolderLockedReason={lockedReason}>
      {folderError ? <Notice tone="danger">{folderError}
        <Button onClick={() => setFolderRetry(value => value + 1)}>再読み込み</Button></Notice> : null}
    </FolderPanel>}
    toolbar={<ListToolbar search={{ value: query, onChange: value => { setQuery(value); setPage(1) },
      placeholder: `${meta.title}を探す` }} filters={
      <div role="group" aria-label="公開の状態">
        {([{ id: 'all', label: 'すべて' }, { id: 'published', label: '公開中' }, { id: 'draft', label: '下書き' }])
          .map(option => <FilterChip key={option.id} selected={status === option.id}
            onChange={() => { setStatus(option.id); setPage(1) }}>{option.label}</FilterChip>)}
      </div>
    } />}
    pagination={ready ? <Pagination page={page} pageCount={Math.ceil(filtered.length / 20)} correctOutOfRange
      range={{ total: filtered.length, first: (page - 1) * 20 + 1, last: Math.min(page * 20, filtered.length) }}
      onPageChange={setPage} /> : undefined}
    overlays={<>{deleteDialog}<Dialog open={folderOpen} title="フォルダを追加する"
      onCancel={() => { if (!folderBusy) setFolderOpen(false) }} onConfirm={() => void addFolder()}
      confirmLabel="追加する" confirmDisabled={!folderName.trim() || !canMutate}
      busy={folderBusy} error={createError}>
      <Field label="フォルダ名"><TextField value={folderName}
        onChange={event => setFolderName(event.target.value)} /></Field>
    </Dialog></>}>
    {editor}
    {loadState !== 'ready' ? <ListState kind={loadState === 'error' ? 'error' : 'loading'}
      title={loadState === 'error' ? `${meta.title}を読み込めませんでした` : undefined}
      action={loadState === 'error' ? <Button onClick={() => void reload()}>再読み込み</Button> : undefined} />
      : filtered.length === 0 ? <EmptyList icon={<FileText />} title={`まだ${meta.title}がありません`}
        description="配信などで使う内容を登録できます。" filtered={items.length > 0 || Boolean(query) || status !== 'all'}
        onClearFilters={clear} canCreate={canMutate} lockedReason={lockedReason ?? null}
        create={{ label: `最初の${meta.title}を作る`, href: meta.href }} />
        : <AssetTable items={filtered.slice((page - 1) * 20, page * 20)} label={meta.title}
          canMutate={canMutate} lockedReason={lockedReason} onEdit={onEdit} onDelete={onDelete} />}
  </ListPage>
}

function assetDescription(item: BroadcastMessageAsset): string {
  return typeof item.payload.description === 'string' ? item.payload.description
    : typeof item.payload.altText === 'string' ? item.payload.altText : '—'
}

function AssetTable({ items, label, canMutate, lockedReason, onEdit, onDelete }: {
  items: BroadcastMessageAsset[]; label: string; canMutate: boolean; lockedReason?: string
  onEdit: BroadcastAssetListLayout['onEdit']; onDelete: BroadcastAssetListLayout['onDelete']
}) {
  return <DataTable aria-label={`${label}一覧`} columnWeights={[4, 4, 2, 3, 1]}>
    <thead><TableHeadRow><Th>{label}</Th><Th>内容</Th><Th>公開</Th><Th>更新</Th>
      <Th columnKind="menu" aria-label="操作" /></TableHeadRow></thead>
    <tbody>{items.map(item => <Tr key={item.id}>
      <Td><TruncatedText value={item.name} /></Td>
      <Td><TruncatedText value={assetDescription(item)} /></Td>
      <Td>{item.status ? <StatusBadge tone={item.status === 'published' ? 'success' : 'neutral'}>
        {item.status === 'published' ? (item.hasDraft ? '未公開の変更' : '公開中') : '下書き'}
      </StatusBadge> : '—'}</Td>
      <Td><TruncatedText value={formatDateTime(item.updatedAt)} /></Td>
      <Td columnKind="menu"><RowMenu label={`${item.name}の操作`} items={[
        { id: 'use', label: '一斉配信で使う', href: `/broadcasts/new?contentTemplateId=${encodeURIComponent(item.id)}`,
          disabled: !canMutate, lockedReason },
        { id: 'edit', label: '編集', disabled: !canMutate, lockedReason,
          onSelect: () => { if (canMutate) onEdit(item) } },
        { id: 'delete', label: '削除する', tone: 'danger', disabled: !canMutate, lockedReason,
          onSelect: () => { if (canMutate) onDelete(item) } },
      ]} /></Td>
    </Tr>)}</tbody>
  </DataTable>
}
