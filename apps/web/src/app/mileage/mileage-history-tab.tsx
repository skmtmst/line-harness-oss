'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SummaryCard from '@/components/shared/summary-card'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { api, type MileageAdminHistory, type MileageAdminHistoryItem, type MileageHistoryItem } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
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

type HistoryRow = Partial<{
  friendId: string
  friendName: string
  balanceAfter: number
  createdAt: string
  entryType: string
  status: string
  primaryFriendId: string
  displayName: string
  occurredAt: string
  lineAccountName: string
}>

function historyView(item: MileageAdminHistoryItem) {
  const raw = item as unknown as HistoryRow
  return {
    ...item,
    primaryFriendId: item.primaryFriendId || raw.friendId || '',
    displayName: item.displayName || raw.friendName || '名前未取得',
    entryType: (raw.entryType === 'earn' ? 'grant' : raw.entryType ?? item.entryType) as MileageHistoryItem['entryType'],
    status: (raw.status === 'confirmed' ? 'available' : raw.status ?? item.status) as MileageHistoryItem['status'],
    balanceAfter: typeof raw.balanceAfter === 'number' ? raw.balanceAfter : null,
    occurredAt: item.occurredAt || raw.createdAt || '',
  }
}

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
  const periodSummary = result?.summary
  const countByType = (entryType: MileageHistoryItem['entryType']) =>
    periodSummary?.byType.find((item) => item.entryType === entryType)?.count ?? 0
  const grantedCount = countByType('grant')
  const spentCount = countByType('spend')
  const reversalCount = countByType('reversal')

  const exportHistoryCsv = () => {
    if (items.length === 0) return
    const rows = items.map(historyView).map((item) => [
      item.occurredAt,
      item.displayName,
      item.amount,
      item.reason,
      item.balanceAfter ?? '',
      item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : '自動',
    ])
    const csv = [['日時', '友だち', '増減', '理由', '残高', 'だれが'], ...rows]
      .map((row) => row.map((value) => csvCell(value)).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mileage-history-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="マイルの履歴" data-design-node="MvZm5" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard variant="v6" title="この期間の記録" value={total} unit="件" detail={periodSummary ? `付いた ${grantedCount.toLocaleString('ja-JP')}・使った ${spentCount.toLocaleString('ja-JP')}` : '内訳を取得できませんでした'} />
        <SummaryCard variant="v6" title="手で動かした分" value={periodSummary?.manualCount ?? null} unit="件" detail="担当者が直接増減したもの" />
        <SummaryCard variant="v6" title="取り消し" value={periodSummary ? reversalCount : null} unit="件" detail="予約取消などに伴うもの" />
        <SummaryCard variant="v6" title="反映を待っている" value={periodSummary?.pendingCount ?? null} unit="件" detail="確定条件を待っている記録" />
      </div>

      <NoteBar>マイルが増えた・減った記録です。手で増やしたものは理由と担当者が残り、あとから辿れます。</NoteBar>

      <div className="flex justify-end">
        <Button onClick={exportHistoryCsv} disabled={items.length === 0}>この頁の履歴をCSVで書き出す</Button>
      </div>

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
            <thead><tr><Th>いつ・だれに</Th><Th align="right">増減</Th><Th>なぜ</Th><Th align="right">残高</Th><Th>だれが</Th><Th align="right">操作</Th></tr></thead>
            <tbody>
              {items.map((rawItem) => {
                const item = historyView(rawItem)
                return <Tr key={item.id}>
                  <NameCell
                    name={<><time dateTime={item.occurredAt}>{formatMileageDate(item.occurredAt)}</time><span className="mx-1">／</span><Link href={`/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`} className="font-semibold text-accent hover:underline">{item.displayName}</Link></>}
                    sub={item.lineAccountName || 'LINEアカウント名を確認できません'}
                  />
                  <Td align="right"><span className={item.amount < 0 ? 'font-bold text-danger' : 'font-bold text-accent'}>{formatMileageChange(item.amount)}</span></Td>
                  <Td>
                    <p
                      className="max-w-52 truncate font-medium text-ink"
                      title={`${item.reason} / ${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)} / ${mileageSourceLabel(item.source)} / ${mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.hasSourceEvent })}`}
                    >
                      {item.reason}
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-faint">{mileageEntryTypeLabel(item.entryType)}・{mileageStatusLabel(item.status)}</p>
                  </Td>
                  <Td align="right" className="tabular-nums">{item.balanceAfter === null ? <span className="text-ink-faint">— 未取得</span> : item.balanceAfter.toLocaleString('ja-JP')}</Td>
                  <Td>{item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : item.entryType === 'spend' ? '本人' : '自動'}</Td>
                  <Td align="right"><Button href={`/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`}>友だちを見る</Button></Td>
                </Tr>
              })}
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
