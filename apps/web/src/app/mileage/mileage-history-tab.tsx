'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import DateField from '@/components/shared/date-field'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import KpiCard from '@/components/shared/kpi-card'
import { DataTable, NameCell, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api, type MileageAdminHistory, type MileageAdminHistoryItem, type MileageHistoryItem } from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import {
  formatMileageChange,
  formatMileageDate,
  mileageEntryTypeLabel,
  mileageSourceLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
} from './mileage-display'
import { validateHistoryPeriod } from './mileage-history-period'
import { mileagePaginationTotal } from './mileage-response-state'
import { formatNumber } from '@/lib/format'

const PAGE_SIZE = 50

type EntryTypeFilter = '' | MileageHistoryItem['entryType']
type StatusFilter = '' | MileageHistoryItem['status']
type ModeFilter = '' | 'automatic' | 'manual'

function historyView(item: MileageAdminHistoryItem) {
  return {
    ...item,
    displayName: item.displayName || '名前未取得',
  }
}

export default function MileageHistoryTab({ accountId, canOperate = false }: { accountId: string; canOperate?: boolean }) {
  const requestRef = useRef(0)
  const [result, setResult] = useState<MileageAdminHistory | null>(null)
  /*
   * R: 確定待ちの行に「確定」「取消」を出す。取消は逆向きの記録を足すだけで
   * 元の行は消えない。どちらも理由が必須。
   */
  const [pendingAction, setPendingAction] = useState<{ kind: 'confirm' | 'void'; item: MileageAdminHistoryItem } | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState('')
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
  /*
   * R304: 口が入力ミスを 400 で返してきたときの理由。通信障害の文とは分け、
   * 日付の欄のそばへ出す。利用者が直す場所が分かるようにする。
   */
  const [inputRejected, setInputRejected] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  /*
   * R304: 開始日が終了日より後のときは取りに行かず、日付エラーの表示に任せる。
   * 取得失敗の文で再読み込みを促すと、直しようのない再読み込みを繰り返す。
   */
  const periodError = validateHistoryPeriod(from, to)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError(false)
    setInputRejected(null)
    if (validateHistoryPeriod(from, to)) {
      if (request === requestRef.current) {
        setResult(null)
        setLoading(false)
      }
      return
    }
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
    } catch (caught) {
      if (request !== requestRef.current) return
      setResult(null)
      // R304: 口の入力エラー（400）は通信障害と分け、日付の欄のそばへ出す。
      if (caught instanceof ApiError && caught.status === 400) {
        setInputRejected('入力した条件を確認してください。開始日は終了日より前の日付を入力してください。')
      } else {
        setError(true)
      }
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

  const runPendingAction = async () => {
    if (!pendingAction || pendingBusy) return
    const reason = pendingReason.trim()
    if (!reason) {
      setPendingError('理由を入力してください。')
      return
    }
    setPendingBusy(true)
    setPendingError('')
    try {
      const response = pendingAction.kind === 'confirm'
        ? await api.mileage.confirmMileageEntry(pendingAction.item.id, { accountId, reason })
        : await api.mileage.voidMileageEntry(pendingAction.item.id, { accountId, reason })
      if (!response.success) throw new Error(response.error)
      setPendingAction(null)
      setPendingReason('')
      await load()
    } catch (caught) {
      setPendingError(caught instanceof Error ? caught.message : '処理できませんでした。もう一度お試しください。')
    } finally {
      setPendingBusy(false)
    }
  }

  return (
    <section aria-label="マイルの履歴" data-design-node="MvZm5" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard variant="v6" title="この期間の記録" value={total} unit="件" detail={periodSummary ? `付いた ${formatNumber(grantedCount)}・使った ${formatNumber(spentCount)}` : (periodError ?? inputRejected) ? '' : '内訳を取得できませんでした'} />
        <KpiCard variant="v6" title="手で動かした分" value={periodSummary?.manualCount ?? null} unit="件" detail="" help="担当者が直接増減したものです" />
        <KpiCard variant="v6" title="取り消し" value={periodSummary ? reversalCount : null} unit="件" detail="" help="予約取消などに伴うものです" />
        <KpiCard variant="v6" title="反映を待っている" value={periodSummary?.pendingCount ?? null} unit="件" detail="確定条件を待っている記録" />
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
          <Select
            label="種類"
            aria-label="種類"
            value={entryType}
            onChange={(value) => resetFilter(() => setEntryType(value as EntryTypeFilter))}
            options={[
              { value: '', label: 'すべての種類' },
              { value: 'grant', label: '付与' },
              { value: 'reversal', label: '取消' },
              { value: 'spend', label: '使用' },
              { value: 'expiration', label: '失効' },
              { value: 'adjustment', label: '手動調整' },
            ]}
          />
          <Select
            label="状態"
            aria-label="状態"
            value={status}
            onChange={(value) => resetFilter(() => setStatus(value as StatusFilter))}
            options={[
              { value: '', label: 'すべての状態' },
              { value: 'available', label: '利用可能' },
              { value: 'pending', label: '確定待ち' },
              { value: 'void', label: '取消済み' },
            ]}
          />
          <Select
            label="動かした方法"
            aria-label="動かした方法"
            value={mode}
            onChange={(value) => resetFilter(() => setMode(value as ModeFilter))}
            options={[
              { value: '', label: '自動・手動' },
              { value: 'automatic', label: '自動' },
              { value: 'manual', label: '手動' },
            ]}
          />
          <span className="grid w-48 gap-1 text-xs font-semibold text-ink-secondary">
            開始日
            <DateField aria-label="開始日" value={from} invalid={Boolean(periodError ?? inputRejected)} onChange={(v) => resetFilter(() => setFrom(v))} />
          </span>
          <span className="grid w-48 gap-1 text-xs font-semibold text-ink-secondary">
            終了日
            <DateField aria-label="終了日" value={to} invalid={Boolean(periodError ?? inputRejected)} onChange={(v) => resetFilter(() => setTo(v))} />
          </span>
        </div>
        {(periodError ?? inputRejected) ? (
          <p role="alert" className="mt-3 text-xs text-danger">{periodError ?? inputRejected}</p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-card border border-hairline bg-canvas">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-base font-bold text-ink">マイルの履歴</h2>
          <span className="text-xs text-ink-faint">{loading || error || total === null ? '—' : `${formatNumber(total)}件`}</span>
        </div>

        {loading ? (
          <ListState kind="loading" />
        ) : (periodError ?? inputRejected) ? (
          <ListState
            kind="empty"
            title="日付の条件を確認してください"
            description="開始日は終了日より前の日付を入力してください。直すと履歴を表示できます。"
          />
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
                    name={<><time dateTime={item.occurredAt}>{formatMileageDate(item.occurredAt)}</time><span className="mx-1">／</span><Link href={`/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`} className="font-semibold text-action hover:underline">{item.displayName}</Link></>}
                    sub={item.lineAccountName || 'LINEアカウント名を確認できません'}
                  />
                  <Td align="right"><span className={item.amount < 0 ? 'font-bold text-danger' : 'font-bold text-accent-deep'}>{formatMileageChange(item.amount)}</span></Td>
                  <Td>
                    <p
                      className="max-w-52 truncate font-medium text-ink"
                      title={`${item.reason} / ${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)} / ${mileageSourceLabel(item.source)} / ${mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.hasSourceEvent })}`}
                    >
                      {item.reason}
                    </p>
                    <p className="mt-1 truncate text-xs text-ink-faint">{mileageEntryTypeLabel(item.entryType)}・{mileageStatusLabel(item.status)}</p>
                  </Td>
                  <Td align="right" className="tabular-nums">{item.balanceAfter === null ? <span className="text-ink-faint">— 未取得</span> : formatNumber(item.balanceAfter)}</Td>
                  <Td>{item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : item.entryType === 'spend' ? '本人' : '自動'}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-2">
                      {canOperate && item.status === 'pending' ? (
                        <>
                          <Button onClick={() => { setPendingAction({ kind: 'confirm', item }); setPendingReason(''); setPendingError('') }}>確定する</Button>
                          <Button onClick={() => { setPendingAction({ kind: 'void', item }); setPendingReason(''); setPendingError('') }}>取り消す</Button>
                        </>
                      ) : null}
                      <Button href={`/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`}>友だちを見る</Button>
                    </div>
                  </Td>
                </Tr>
              })}
            </tbody>
          </DataTable>
        )}

        {!loading && !error && total !== null && total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
            <span className="text-xs text-ink-faint">{(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, total)} / {formatNumber(total)}件</span>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} />
          </div>
        ) : null}
      </div>

      <Dialog
        open={pendingAction !== null}
        title={pendingAction?.kind === 'confirm' ? 'このマイルを確定しますか？' : 'このマイルを取り消しますか？'}
        description={pendingAction?.kind === 'confirm'
          ? '確定待ちから利用可能に変わります。'
          : '取り消すと逆向きの記録が残ります。もとの記録そのものは消えません。'}
        tone={pendingAction?.kind === 'void' ? 'destructive' : 'default'}
        confirmLabel={pendingAction?.kind === 'confirm' ? '確定する' : '取り消す'}
        busy={pendingBusy}
        error={pendingError || undefined}
        onCancel={() => { if (!pendingBusy) setPendingAction(null) }}
        onConfirm={() => void runPendingAction()}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-ink">理由（必須）</span>
          <textarea
            className="min-h-20 rounded-mini border border-hairline px-3 py-2 text-sm"
            value={pendingReason}
            onChange={(event) => setPendingReason(event.target.value)}
            placeholder={pendingAction?.kind === 'confirm' ? '例：入金を確認しました' : '例：予約がキャンセルされました'}
          />
        </label>
      </Dialog>
    </section>
  )
}
