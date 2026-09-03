'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { api, type MileageAdminHistory, type MileageHistoryItem } from '@/lib/api'
import {
  formatMileageChange,
  formatMileageDate,
  mileageEntryTypeLabel,
  mileageSourceLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
} from './mileage-display'
import { mileagePaginationTotal } from './mileage-response-state'

const PAGE_SIZE = 50

type EntryTypeFilter = '' | MileageHistoryItem['entryType']
type StatusFilter = '' | MileageHistoryItem['status']
type ModeFilter = '' | 'automatic' | 'manual'

export default function MileageHistoryTab({ accountId }: { accountId: string }) {
  const requestRef = useRef(0)
  const [result, setResult] = useState<MileageAdminHistory | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [entryType, setEntryType] = useState<EntryTypeFilter>('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [mode, setMode] = useState<ModeFilter>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError(false)
    try {
      const response = await api.mileage.history({
        accountId,
        search: search || undefined,
        entryType: entryType || undefined,
        status: status || undefined,
        mode: mode || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      if (request !== requestRef.current) return
      if (!response.success) throw new Error(response.error)
      setResult(response.data)
    } catch {
      if (request !== requestRef.current) return
      setResult(null)
      setError(true)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [accountId, entryType, from, mode, page, search, status, to])

  useEffect(() => {
    void load()
  }, [load])

  const resetFilter = (change: () => void) => {
    setPage(1)
    change()
  }
  const items = result?.items ?? []
  const total = mileagePaginationTotal(result)
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE))

  return (
    <section aria-label="マイルの履歴" data-design-node="MvZm5" className="space-y-4">
      <div className="rounded-card border border-hairline bg-canvas p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid w-52 gap-1 text-xs font-semibold text-ink-secondary">
            友だち
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="名前で検索"
              className="h-10 rounded-control border border-hairline bg-canvas px-3 text-sm font-normal text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="grid w-36 gap-1 text-xs font-semibold text-ink-secondary">
            種類
            <select value={entryType} onChange={(event) => resetFilter(() => setEntryType(event.target.value as EntryTypeFilter))} className="v6-select h-10 rounded-control border border-hairline bg-canvas text-sm font-normal text-ink">
              <option value="">すべての種類</option>
              <option value="grant">付与</option>
              <option value="reversal">取消</option>
              <option value="spend">使用</option>
              <option value="expiration">失効</option>
              <option value="adjustment">手動調整</option>
            </select>
          </label>
          <label className="grid w-36 gap-1 text-xs font-semibold text-ink-secondary">
            状態
            <select value={status} onChange={(event) => resetFilter(() => setStatus(event.target.value as StatusFilter))} className="v6-select h-10 rounded-control border border-hairline bg-canvas text-sm font-normal text-ink">
              <option value="">すべての状態</option>
              <option value="available">利用可能</option>
              <option value="pending">確定待ち</option>
              <option value="void">取消済み</option>
            </select>
          </label>
          <label className="grid w-36 gap-1 text-xs font-semibold text-ink-secondary">
            動かした方法
            <select value={mode} onChange={(event) => resetFilter(() => setMode(event.target.value as ModeFilter))} className="v6-select h-10 rounded-control border border-hairline bg-canvas text-sm font-normal text-ink">
              <option value="">自動・手動</option>
              <option value="automatic">自動</option>
              <option value="manual">手動</option>
            </select>
          </label>
          <label className="grid w-36 gap-1 text-xs font-semibold text-ink-secondary">
            開始日
            <input type="date" value={from} onChange={(event) => resetFilter(() => setFrom(event.target.value))} className="h-10 rounded-control border border-hairline bg-canvas px-3 text-sm font-normal text-ink" />
          </label>
          <label className="grid w-36 gap-1 text-xs font-semibold text-ink-secondary">
            終了日
            <input type="date" value={to} onChange={(event) => resetFilter(() => setTo(event.target.value))} className="h-10 rounded-control border border-hairline bg-canvas px-3 text-sm font-normal text-ink" />
          </label>
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-base font-bold text-ink">マイルの履歴</h2>
          <span className="text-xs text-ink-faint">{loading || error || total === null ? '—' : `${total.toLocaleString('ja-JP')}件`}</span>
        </div>

        {loading ? (
          <ListState kind="loading" />
        ) : error ? (
          <ListState
            kind="error"
            description="マイルの履歴を確認できませんでした。再読み込みしてください。"
            action={<Button onClick={() => void load()}>履歴を再読み込み</Button>}
          />
        ) : items.length === 0 ? (
          <ListState
            kind="empty"
            title="条件に合う履歴はありません"
            description="条件を変えると、ほかの履歴を確認できます。"
          />
        ) : (
          <DataTable>
            <thead><tr><Th>友だち</Th><Th>種類・状態</Th><Th align="right">増減</Th><Th>理由</Th><Th>発生元</Th><Th>発生日時</Th></tr></thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id}>
                  <NameCell
                    name={<Link href={`/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`} className="font-semibold text-accent hover:underline">{item.displayName}</Link>}
                    sub="マイル明細を見る"
                  />
                  <Td>
                    <p className="font-semibold text-ink">{mileageEntryTypeLabel(item.entryType)}</p>
                    <p className="mt-1 text-xs text-ink-faint">{mileageStatusLabel(item.status)}・{item.mode === 'manual' ? '手動' : '自動'}</p>
                  </Td>
                  <Td align="right"><span className={item.amount < 0 ? 'font-bold text-danger' : 'font-bold text-accent'}>{formatMileageChange(item.amount)} mile</span></Td>
                  <Td><p className="max-w-52 truncate font-medium text-ink" title={item.reason}>{item.reason}</p><p className="mt-1 text-xs text-ink-faint">{item.mode === 'manual' ? item.executedByStaffName ?? '実行者は未取得' : item.ruleName ?? 'ルール情報なし'}</p></Td>
                  <Td>
                    <p>{mileageSourceLabel(item.source)}</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.hasSourceEvent })}
                    </p>
                  </Td>
                  <Td><time dateTime={item.occurredAt}>{formatMileageDate(item.occurredAt)}</time></Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {!loading && !error && total !== null && total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
            <span className="text-xs text-ink-faint">{(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)} / {total.toLocaleString('ja-JP')}件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
