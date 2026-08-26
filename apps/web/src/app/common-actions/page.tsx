'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { api, type CommonActionSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import SearchField from '@/components/shared/search-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

type Filter = 'all' | 'published' | 'draft' | 'old_version' | 'unused'

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'published', label: '公開中' },
  { value: 'draft', label: '下書き' },
  { value: 'old_version', label: '古い版あり' },
  { value: 'unused', label: '呼ばれていない' },
]

const STATUS_LABEL: Record<CommonActionSummary['status'], string> = {
  published: '公開中',
  draft: '下書き',
  archived: '保管',
}

export default function CommonActionsPage() {
  const router = useRouter()
  const canManage = useCanManageCommonActions()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [items, setItems] = useState<CommonActionSummary[]>([])
  const [summaryItems, setSummaryItems] = useState<CommonActionSummary[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [duplicating, setDuplicating] = useState('')

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setItems([])
      setSummaryItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [summaryResponse, response] = await Promise.all([
        api.commonActions.list({ accountId: selectedAccountId }),
        api.commonActions.list({ accountId: selectedAccountId, status: filter, query: deferredQuery }),
      ])
      if (summaryResponse.success) setSummaryItems(summaryResponse.data)
      if (response.success) setItems(response.data)
      else setError(response.error)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '共通アクションを読み込めませんでした')
    } finally {
      setLoading(false)
    }
  }, [deferredQuery, filter, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const duplicate = async (id: string) => {
    if (!selectedAccountId || duplicating) return
    setDuplicating(id)
    setError('')
    try {
      const response = await api.commonActions.duplicate(id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      router.push(`/common-actions/edit?id=${encodeURIComponent(response.data.id)}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '共通アクションを複製できませんでした')
    } finally {
      setDuplicating('')
    }
  }

  const totals = useMemo(() => ({
    actions: summaryItems.reduce((sum, item) => sum + item.actionCount, 0),
    bindings: summaryItems.reduce((sum, item) => sum + item.bindingCount, 0),
    outdated: summaryItems.reduce((sum, item) => sum + item.oldVersionBindingCount, 0),
  }), [summaryItems])

  return (
    <div data-design-node="xOpDs">
      <PageHeader
        breadcrumb={[
          { label: 'オートメーション', href: '/automations' },
          { label: '共通アクション' },
        ]}
        title="共通アクション"
        description="何度も使う処理をまとめ、利用先ごとに使う版を固定できます。"
        actions={(
          <>
            {canManage ? <Button href="/common-actions/new" variant="primary">共通アクションをつくる</Button> : null}
            <Button href="/support">マニュアル</Button>
          </>
        )}
      />

      <Tabs items={[
        { label: 'オートメーション', href: '/automations' },
        { label: '共通アクション', count: summaryItems.length, current: true },
      ]} className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard variant="v6" title="共通アクション" value={loading ? null : summaryItems.length} unit="" detail="公開中と下書き" loading={loading} />
        <SummaryCard variant="v6" title="中の処理" value={loading ? null : totals.actions} unit="" detail="表示中の合計" loading={loading} />
        <SummaryCard variant="v6" title="呼び出し場所" value={loading ? null : totals.bindings} unit="" detail="固定している利用先" loading={loading} />
        <SummaryCard variant="v6" title="古い版のまま" value={loading ? null : totals.outdated} unit="" detail="新しい版へ更新できます" loading={loading} badge={totals.outdated > 0 ? '要確認' : undefined} />
      </div>

      <NoteBar>
        公開しても利用先の内容は自動で変わりません。利用先ごとに、確認してから新しい版へ更新します。
      </NoteBar>

      <div className="my-3 flex flex-wrap items-center gap-2">
        {canManage ? <Button href="/common-actions/new" variant="primary">共通アクションをつくる</Button> : null}
        <SearchField
          value={query}
          onChange={setQuery}
          onClear={() => setQuery('')}
          placeholder="名前や説明で検索"
          aria-label="共通アクションを検索"
          loading={loading && query !== deferredQuery}
          className="min-w-72 flex-1"
        />
        <Button
          onClick={() => void load()}
        >
          <RefreshCw size={16} aria-hidden />
          一覧を更新
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2" aria-label="状態で絞り込む">
        {FILTERS.map((option) => (
          <label
            key={option.value}
            className={filter === option.value
              ? 'bg-success-bg text-success rounded-pill border border-success px-3 py-1.5 text-xs font-semibold'
              : 'border-hairline text-ink-secondary rounded-pill border bg-canvas px-3 py-1.5 text-xs'}
          >
            <input className="sr-only" type="radio" name="common-action-filter" value={option.value} checked={filter === option.value} onChange={() => setFilter(option.value)} />
            {option.label}
          </label>
        ))}
      </div>

      {error ? (
        <div className="border-danger bg-danger-bg text-danger rounded-card border p-5" role="alert">
          <p className="font-semibold">共通アクションを読み込めませんでした</p>
          <p className="mt-1 text-sm">{error}</p>
          <button type="button" className="mt-3 underline" onClick={() => void load()}>もう一度読み込む</button>
        </div>
      ) : loading ? (
        <div className="border-hairline rounded-card border bg-canvas p-8 text-center text-sm text-ink-faint" aria-busy="true">
          共通アクションを読み込んでいます
        </div>
      ) : items.length === 0 ? (
        <div className="border-hairline rounded-card border bg-canvas p-10 text-center">
          <Copy className="text-ink-faint mx-auto" aria-hidden />
          <h2 className="text-ink mt-3 text-base font-semibold">
            {query || filter !== 'all' ? '条件に合う共通アクションはありません' : '共通アクションはまだありません'}
          </h2>
          <p className="text-ink-faint mt-2 text-sm">
            {query || filter !== 'all' ? '検索語や絞り込みを変えてください。' : 'よく使う処理をまとめると、設定の重複を減らせます。'}
          </p>
          {canManage && !query && filter === 'all' ? (
            <Button href="/common-actions/new" variant="primary" className="mt-4">共通アクションをつくる</Button>
          ) : null}
        </div>
      ) : (
        <DataTable>
            <thead className="bg-canvas-sunken text-ink-faint text-xs">
              <TableHeadRow>
                <Th style={{ width: '28%' }}>アクション名</Th>
                <Th style={{ width: '12%' }}>状態</Th>
                <Th style={{ width: '18%' }}>中の処理</Th>
                <Th style={{ width: '16%' }}>呼び出し元</Th>
                <Th style={{ width: '8%' }}>版</Th>
                <Th style={{ width: '18%' }}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <NameCell name={<span className="truncate" title={item.name}>{item.name}</span>} sub={<span className="truncate" title={item.description ?? undefined}>{item.description || '説明はありません'}</span>} />
                  <Td>
                    <StatusBadge tone={item.status === 'published' ? 'success' : 'neutral'} size="compact">
                      {STATUS_LABEL[item.status]}
                    </StatusBadge>
                  </Td>
                  <Td>{item.actionCount}個の処理</Td>
                  <Td>
                    <span className="text-ink-secondary">{item.bindingCount}か所</span>
                    {item.oldVersionBindingCount > 0 ? (
                      <span className="text-warning ml-2 text-xs">古い版 {item.oldVersionBindingCount}</span>
                    ) : null}
                  </Td>
                  <Td>
                    {item.publishedVersion ? `v${item.publishedVersion}` : '—'}
                  </Td>
                  <ActionCell>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                      href={`/common-actions/versions?id=${encodeURIComponent(item.id)}`}
                      className="text-action inline-flex items-center gap-1 whitespace-nowrap font-medium hover:underline"
                    >
                      中身を見る <ExternalLink size={14} aria-hidden />
                    </a>
                    {canManage ? (
                      <button type="button" disabled={Boolean(duplicating)} onClick={() => void duplicate(item.id)} className="text-action whitespace-nowrap text-xs font-medium hover:underline disabled:opacity-40">
                        {duplicating === item.id ? '複製中' : '複製して下書きを作る'}
                      </button>
                    ) : null}
                    </div>
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
        </DataTable>
      )}
    </div>
  )
}
