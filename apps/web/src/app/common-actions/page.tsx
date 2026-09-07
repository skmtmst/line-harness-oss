'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { api, type CommonActionSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import NoteBar from '@/components/shared/note-bar'
import PageHeader from '@/components/shared/page-header'
import SearchField from '@/components/shared/search-field'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'

type Filter = 'all' | 'published' | 'draft' | 'old_version' | 'unused'
const PAGE_SIZE = 6

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
  const canManage = useCanManageCommonActions()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [items, setItems] = useState<CommonActionSummary[]>([])
  const [summaryItems, setSummaryItems] = useState<CommonActionSummary[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [automationCounts, setAutomationCounts] = useState<{ active: number; stopped: number } | null>(null)
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setItems([])
      setSummaryItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [summaryResponse, response, automationsResponse, templatesResponse] = await Promise.all([
        api.commonActions.list({ accountId: selectedAccountId }),
        api.commonActions.list({
          accountId: selectedAccountId,
          status: filter,
          query: deferredQuery,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
        api.automations.list({ accountId: selectedAccountId }).catch(() => null),
        api.automations.templates(selectedAccountId).catch(() => null),
      ])
      if (summaryResponse.success) setSummaryItems(summaryResponse.data)
      if (response.success) {
        setItems(response.data)
        setTotal(response.pagination?.total ?? response.data.length)
      }
      else setError(response.error)
      setAutomationCounts(automationsResponse?.success ? {
        active: automationsResponse.data.filter((item) => item.isActive).length,
        stopped: automationsResponse.data.filter((item) => !item.isActive).length,
      } : null)
      setTemplateCount(templatesResponse?.success ? templatesResponse.data.length : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '共通アクションを読み込めませんでした')
    } finally {
      setLoading(false)
    }
  }, [deferredQuery, filter, page, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const totals = useMemo(() => ({
    actions: summaryItems.reduce((sum, item) => sum + item.actionCount, 0),
    bindings: summaryItems.reduce((sum, item) => sum + item.bindingCount, 0),
    outdated: summaryItems.reduce((sum, item) => sum + item.oldVersionBindingCount, 0),
    outdatedItems: summaryItems.filter((item) => item.oldVersionBindingCount > 0).length,
    published: summaryItems.filter((item) => item.status === 'published').length,
    executions: summaryItems.reduce((sum, item) => sum + item.executionCountThisMonth, 0),
    failures: summaryItems.reduce((sum, item) => sum + item.failureCountThisMonth, 0),
  }), [summaryItems])

  const filterCount = (value: Filter): number => {
    if (value === 'all') return summaryItems.length
    if (value === 'old_version') return totals.outdatedItems
    if (value === 'unused') return summaryItems.filter((item) => item.status === 'published' && item.bindingCount === 0).length
    return summaryItems.filter((item) => item.status === value).length
  }

  const duplicate = async (item: CommonActionSummary) => {
    if (!selectedAccountId || duplicatingId) return
    setDuplicatingId(item.id)
    setError('')
    try {
      const response = await api.commonActions.duplicate(item.id, selectedAccountId)
      if (!response.success) throw new Error(response.error)
      window.location.href = `/common-actions/edit?id=${encodeURIComponent(response.data.id)}`
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '共通アクションを複製できませんでした')
      setDuplicatingId(null)
    }
  }

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
        { label: '動いているもの', count: automationCounts?.active, href: '/automations' },
        { label: '止めているもの', count: automationCounts?.stopped, href: '/automations?tab=stopped' },
        { label: '動いた記録', href: '/automations/runs' },
        { label: '見本', count: templateCount ?? undefined, href: '/automations?tab=templates' },
        { label: '共通アクション', count: summaryItems.length, current: true },
      ]} className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard variant="v6" title="共通アクション" value={loading ? null : summaryItems.length} unit="" detail={loading ? '' : `うち公開中 ${totals.published}`} loading={loading} />
        <SummaryCard variant="v6" title="呼び出し元" value={loading ? null : totals.bindings} unit="" detail="5機能から" loading={loading} />
        <SummaryCard variant="v6" title="今月 動いた回数" value={loading ? null : totals.executions} unit="" detail={loading ? '' : `失敗 ${totals.failures}`} loading={loading} />
        <SummaryCard variant="v6" title="古い版のまま" value={loading ? null : totals.outdatedItems} unit="" detail={loading ? '' : `呼び出し元 ${totals.outdated}か所`} loading={loading} badge={totals.outdatedItems > 0 ? '要確認' : undefined} />
      </div>

      <NoteBar>
        ここを直すと、呼び出している機能すべてに効きます。動いている途中のものは、始まったときの版のまま最後まで進みます。
      </NoteBar>

      <div className="my-3 flex flex-wrap items-center gap-2">
        {canManage ? <Button href="/common-actions/new" variant="primary">共通アクションをつくる</Button> : null}
        {selectedAccountId ? <Button href={api.commonActions.csvUrl(selectedAccountId)}>CSVで書き出す</Button> : null}
        <SearchField
          value={query}
          onChange={(value) => { setQuery(value); setPage(1) }}
          onClear={() => { setQuery(''); setPage(1) }}
          placeholder="アクション名・中の処理で探す"
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
            <input className="sr-only" type="radio" name="common-action-filter" value={option.value} checked={filter === option.value} onChange={() => { setFilter(option.value); setPage(1) }} />
            {option.label} {filterCount(option.value)}
          </label>
        ))}
      </div>

      {error ? (
        <ListState kind="error" title="共通アクションを読み込めませんでした" description={error} onRetry={() => void load()} />
      ) : loading ? (
        <ListState kind="loading" title="共通アクションを読み込んでいます" />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title={query || filter !== 'all' ? '条件に合う共通アクションはありません' : '共通アクションはまだありません'}
          description={query || filter !== 'all' ? '検索語や絞り込みを変えてください。' : 'よく使う処理をまとめると、設定の重複を減らせます。'}
          action={canManage && !query && filter === 'all' ? <Button href="/common-actions/new" variant="primary">共通アクションをつくる</Button> : undefined}
        />
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
                    <Link
                      href={`/common-actions/versions?id=${encodeURIComponent(item.id)}`}
                      className="text-action inline-flex items-center gap-1 whitespace-nowrap font-medium hover:underline"
                    >
                      中身を見る <ExternalLink size={14} aria-hidden />
                    </Link>
                    {canManage ? (
                      <>
                        <Link
                          href={item.status === 'draft'
                            ? `/common-actions/edit?id=${encodeURIComponent(item.id)}`
                            : `/common-actions/versions?id=${encodeURIComponent(item.id)}`}
                          className="text-action whitespace-nowrap text-xs font-medium hover:underline"
                        >
                          {item.status === 'draft' ? '公開する' : '使われている場所'}
                        </Link>
                        <button
                          type="button"
                          className="text-action whitespace-nowrap text-xs font-medium hover:underline disabled:text-ink-faint"
                          disabled={duplicatingId !== null}
                          onClick={() => void duplicate(item)}
                        >
                          {duplicatingId === item.id ? '複製中' : '複製して下書きを作る'}
                        </button>
                      </>
                    ) : null}
                    </div>
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
        </DataTable>
      )}
      {!loading && !error && items.length > 0 ? (
        <div className="border-hairline flex items-center justify-between border-x border-b bg-canvas px-4 py-3 text-xs text-ink-faint">
          <span>{total}件中 {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)}件</span>
          <div className="flex items-center gap-3" aria-label="ページ送り">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="text-action disabled:text-ink-faint">前へ</button>
            {Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, index) => index + 1).map((pageNumber) => (
              <button key={pageNumber} type="button" aria-current={pageNumber === page ? 'page' : undefined} onClick={() => setPage(pageNumber)} className={pageNumber === page ? 'text-action font-bold' : 'text-ink-faint'}>{pageNumber}</button>
            ))}
            <button type="button" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)} className="text-action disabled:text-ink-faint">次へ</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
