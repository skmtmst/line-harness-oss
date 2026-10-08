'use client'

/*
 * ★V8 マイル「履歴」（板 `oRbJi`、状態は見本帳 `zaqP9`）。
 *
 * app/mileage/v8-history-tab.tsx から動きを写し、見た目を一覧の型で組み直した。
 * フォルダの列は無い（絵どおり）。表は「いつ・だれに・増減・なぜ・残高・だれが・操作」。
 * 行末は操作ボタン1つ（確定待ちは「確定する」、付けた分は「取り消す」、
 * ほかは「友だちを見る」）＋「…」。行を押すとその友だちのマイルの詳細。
 * 種類・方法・期間の絞り込みは「よく使う絞り込み」の見方として残す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, CircleDot, Download, History, Plus, TrendingDown, TrendingUp, Undo2 } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  type MileageAdminHistory,
  type MileageAdminHistoryItem,
  type MileageHistoryItem,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { csvCell } from '@/lib/presentation'
import { RowMenu } from '@/components/shared/row-actions'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  formatMileageChange,
  formatMileageShortDateTime,
  mileageEntryTypeLabel,
  mileagePaginationTotal,
  mileageSourceLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
} from './display'
import { MileageFrame, useMileageShell } from './frame'
import { MileageToolbar, PerPageSelect, RetryButton, SavedSelect, StateCard, ToolbarNotices } from './parts'
import styles from './mileage.module.css'

function viewName(item: MileageAdminHistoryItem) {
  return item.displayName || '名前未取得'
}

/* 「付けた」に入る種類。ほかは「使った・取り消し」へ。 */
function isGranted(item: MileageAdminHistoryItem) {
  return item.entryType === 'grant'
}

const PRESETS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'よく使う絞り込み' },
  { value: 'granted', label: '付けたのみ' },
  { value: 'spent', label: '使った・取り消しのみ' },
  { value: 'manual', label: '手で動かした分のみ' },
  { value: 'month', label: '今月のみ' },
  { value: 'week', label: '過去7日のみ' },
]

function monthStart(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export default function HistoryTab() {
  const { readonly, narrow } = useMileageShell()
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const requestRef = useRef(0)
  const [result, setResult] = useState<MileageAdminHistory | null>(null)
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const [pendingAction, setPendingAction] = useState<{ kind: 'confirm' | 'void'; item: MileageAdminHistoryItem } | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [grantedOnly, setGrantedOnly] = useState(false)
  const [spentOnly, setSpentOnly] = useState(false)
  const [preset, setPreset] = useState('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const applyPreset = (value: string) => {
    setPreset(value)
    setPage(1)
    setGrantedOnly(value === 'granted')
    setSpentOnly(value === 'spent')
  }
  const presetValue = preset === 'all' && !grantedOnly && !spentOnly ? 'all'
    : preset !== 'all' ? preset
      : grantedOnly ? 'granted' : 'spent'

  const from = preset === 'month' ? monthStart() : preset === 'week' ? daysAgo(6) : undefined
  const modeFilter: 'automatic' | 'manual' | undefined = preset === 'manual' ? 'manual' : undefined
  const entryTypeFilter: MileageHistoryItem['entryType'] | undefined = grantedOnly ? 'grant' : undefined

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError(false)
    setExportError('')
    try {
      const response = await api.mileage.history({
        accountId: selectedAccountId ?? '',
        search: search || undefined,
        entryType: entryTypeFilter,
        mode: modeFilter,
        from,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (request !== requestRef.current) return
      if (!response.success) throw new Error(response.error)
      /* 「使った・取り消しのみ」は口に種類の絞り込みが無いので、付けた分を手元で除く。 */
      if (spentOnly) {
        response.data.items = response.data.items.filter((item) => !isGranted(item))
      }
      setResult(response.data)
      setLoadedAccountId(selectedAccountId)
    } catch (caught) {
      if (request !== requestRef.current) return
      setResult(null)
      if (!(caught instanceof ApiError && caught.status === 400)) setError(true)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [entryTypeFilter, from, modeFilter, page, pageSize, search, selectedAccountId, spentOnly])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const items = useMemo(() => result?.items ?? [], [result])
  const total = mileagePaginationTotal(result)
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))
  const byType = result?.summary.byType ?? []
  const countOf = (entryType: MileageHistoryItem['entryType']) =>
    byType.find((item) => item.entryType === entryType)?.count ?? 0
  const amountOf = (entryType: MileageHistoryItem['entryType']) =>
    byType.find((item) => item.entryType === entryType)?.amount ?? 0
  const grantedCount = countOf('grant')
  const reversalCount = countOf('reversal')

  const canExport = !accountLoading && !loading && !error && !!selectedAccountId
    && loadedAccountId === selectedAccountId && items.length > 0
  const exportCsv = useCallback(() => {
    if (!canExport) return
    setExportError('')
    try {
      const rows = items.map((item) => [
        item.occurredAt,
        viewName(item),
        item.amount,
        item.reason,
        item.balanceAfter ?? '',
        item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : '自動',
      ])
      const csv = [['日時', '友だち', '増減', '理由', '残高', 'だれが'], ...rows]
        .map((row) => row.map((value) => csvCell(value)).join(','))
        .join('\n')
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mileage-history-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('CSVを書き出せませんでした。もう一度お試しください。')
    }
  }, [canExport, items])

  const runPendingAction = async () => {
    if (!pendingAction || pendingBusy || !selectedAccountId) return
    const reason = pendingReason.trim()
    if (!reason) {
      setPendingError('理由を入力してください。')
      return
    }
    setPendingBusy(true)
    setPendingError('')
    try {
      const response = pendingAction.kind === 'confirm'
        ? await api.mileage.confirmMileageEntry(pendingAction.item.id, { accountId: selectedAccountId, reason })
        : await api.mileage.voidMileageEntry(pendingAction.item.id, { accountId: selectedAccountId, reason })
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

  const openPending = (kind: 'confirm' | 'void', item: MileageAdminHistoryItem) => {
    setPendingAction({ kind, item })
    setPendingReason('')
    setPendingError('')
  }

  const filtered = search.trim() || grantedOnly || spentOnly || preset !== 'all'
  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setGrantedOnly(false)
    setSpentOnly(false)
    setPreset('all')
    setPage(1)
  }

  const ready = !loading && !error

  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="今月の動き"
        icon={<History size={14} aria-hidden="true" />}
        value={ready ? total : null}
        unit="件"
        detail={ready ? `付けた ${formatNumber(grantedCount)}・使った ${formatNumber(countOf('spend'))}・取り消し ${formatNumber(reversalCount)}` : '—'}
      />
      <KpiCard
        presentation="band"
        title="付けた"
        icon={<TrendingUp size={14} aria-hidden="true" />}
        value={ready ? amountOf('grant') : null}
        unit=""
        detail=""
      />
      <KpiCard
        presentation="band"
        title="使った"
        icon={<TrendingDown size={14} aria-hidden="true" />}
        value={ready ? Math.abs(amountOf('spend')) : null}
        unit=""
        detail={`交換 ${formatNumber(countOf('spend'))}件`}
      />
      <KpiCard
        presentation="band"
        title="取り消し"
        icon={<CalendarRange size={14} aria-hidden="true" />}
        value={ready ? reversalCount : null}
        unit="件"
        detail="注文の取り消しで引いた"
      />
    </KpiBand>
  )

  const chips = (
    <div role="group" aria-label="種類で絞り込む" className={styles.chipGroup}>
      <FilterChip
        selected={grantedOnly}
        icon={<CircleDot size={13} aria-hidden="true" />}
        onChange={(selected) => {
          setPreset('all')
          setPage(1)
          setGrantedOnly(selected)
          if (selected) setSpentOnly(false)
        }}
      >
        付けた
      </FilterChip>
      <FilterChip
        selected={spentOnly}
        icon={<Undo2 size={13} aria-hidden="true" />}
        onChange={(selected) => {
          setPreset('all')
          setPage(1)
          setSpentOnly(selected)
          if (selected) setGrantedOnly(false)
        }}
      >
        使った・取り消し
      </FilterChip>
    </div>
  )

  const toolbar = (
    <MileageToolbar
      narrow={narrow}
      notices={<ToolbarNotices info="明細はあとから消せません。間違えて付けたときは「減らす」で取り消しの明細を足します。" error={exportError} />}
      search={{
        placeholder: '友だち・できごとで探す',
        value: searchInput,
        onChange: (value) => {
          setSearchInput(value)
          if (!value) { setSearch(''); setPage(1) }
        },
      }}
      chips={chips}
      trailing={<>
        <SavedSelect value={presetValue} options={PRESETS} onChange={applyPreset} />
        <PerPageSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} />
      </>}
    />
  )

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={styles.table}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>いつ・だれに</Th>
            <Th className={`${styles.colDelta} ${styles.num}`}>増減</Th>
            <Th className={styles.colWhy}>なぜ</Th>
            <Th className={`${styles.colAfter} ${styles.num}`}>残高</Th>
            <Th className={styles.colWho}>だれが</Th>
            <Th className={styles.colOpsHistory}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {items.map((item) => {
            const pending = !readonly && item.status === 'pending'
            const reversible = !readonly && item.entryType === 'grant' && item.status === 'available'
            const friendHref = `/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`
            return (
              <Tr
                key={item.id}
                className={styles.row}
                data-table-layout="columns"
                interactive
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('a, button, [role="menu"]')) return
                  router.push(friendHref)
                }}
              >
                <Td className={styles.colName}>
                  <span className={styles.rowNameInk} title={viewName(item)}>{viewName(item)}</span>
                  <span className={styles.rowSub}>
                    {`${formatMileageShortDateTime(item.occurredAt)}${item.lineAccountName ? `・${item.lineAccountName}` : ''}`}
                  </span>
                </Td>
                <Td className={`${styles.colDelta} ${styles.num}`}><span className={styles.cellMain}>{formatMileageChange(item.amount)}</span></Td>
                <Td className={styles.colWhy}>
                  <span
                    className={styles.cellMain}
                    title={`${item.reason} / ${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)} / ${mileageSourceLabel(item.source)} / ${mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.hasSourceEvent })}`}
                  >
                    {item.reason}
                  </span>
                  <span className={styles.cellSub}>{`${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)}`}</span>
                </Td>
                <Td className={`${styles.colAfter} ${styles.num}`}>
                  <span className={styles.cellMain}>{item.balanceAfter === null ? '—' : formatNumber(item.balanceAfter)}</span>
                </Td>
                <Td className={styles.colWho}>
                  <span className={styles.cellMain}>
                    {item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : item.entryType === 'spend' ? '本人' : '自動'}
                  </span>
                </Td>
                <Td className={styles.colOpsHistory}>
                  <span className={styles.rowActions}>
                    {pending ? (
                      <Button onClick={() => openPending('confirm', item)}>確定する</Button>
                    ) : reversible ? (
                      <Button onClick={() => openPending('void', item)}>取り消す</Button>
                    ) : (
                      <Button href={friendHref}>友だちを見る</Button>
                    )}
                    <div className={styles.menuBox}>
                      <RowMenu
                        label={`${viewName(item)}の明細の操作`}
                        open={menuId === item.id}
                        onOpenChange={(next) => setMenuId(next ? item.id : null)}
                        items={[
                          ...(pending ? [{ id: 'void', label: '取り消す', onSelect: () => openPending('void', item) }] : []),
                          { id: 'friend', label: '友だちを見る', external: true, onSelect: () => router.push(friendHref) },
                        ]}
                      />
                    </div>
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const body = loading ? (
    <ListState kind="loading" title="マイルの履歴を読み込んでいます" />
  ) : error ? (
    <StateCard tone="error" title="マイルの履歴を読み込めませんでした" description="数の帯は「—」にしています。道具はそのまま使えます。" action={<RetryButton onRetry={() => void load()} />} />
  ) : items.length === 0 ? (
    /*
     * WEB074：「使った・取り消しのみ」は口に種類の絞り込みが無く、1ページずつ手元で絞っている。
     * このページに無くても、ほかのページにあることがある。「ありません」と言い切らず、ページ送りを残す。
     * （口に種類の絞り込みが入ったら、ここは要らなくなる。Codex へ依頼済み）
     */
    spentOnly && pageCount > 1 ? (
      <StateCard title="このページには、使った・取り消しの履歴がありません" description="この絞り込みは1ページずつ見ています。ほかのページにある場合があります。下のページ送りで確かめてください。" />
    ) : filtered ? (
      <StateCard title="条件に合う履歴はありません" description="検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={resetAll}>条件を外す</Button>} />
    ) : (
      <StateCard title="まだ履歴がありません" description="マイルを付けたり使ったりすると、ここに記録が残ります" />
    )
  ) : table

  /* 絵 oRbJi：表 → ページ送り（件数つき）→ 下の案内。 */
  const footer = ready && (items.length > 0 || (spentOnly && pageCount > 1)) ? (
    <>
      <div className={styles.pagerRow}>
        <span className={styles.pagerCount}>
          {spentOnly
            ? `${formatNumber(total ?? 0)}件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, total ?? 0)}件のうち、使った・取り消し ${formatNumber(items.length)}件`
            : `${formatNumber(total ?? 0)}件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, total ?? 0)}件`}
        </span>
        {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} /> : null}
      </div>
      <p className={styles.footNoteFlush}>行を押すと、その友だちのマイルの詳細を開きます。「増やす・減らす」は理由を書いて明細を足します（オーナー・管理者だけ）。</p>
    </>
  ) : undefined

  return (
    <MileageFrame
      actions={<div className={styles.headActions}>
        <Button onClick={exportCsv} disabled={!canExport}>
          <Download size={15} aria-hidden="true" /> CSV で書き出す
        </Button>
        {/* 閲覧のみの人には出さない。 */}
        {!readonly ? (
          <Button href="/mileage?tab=balances" title="友だちを選んで増減します">
            <Plus size={15} aria-hidden="true" /> 増やす・減らす
          </Button>
        ) : null}
      </div>}
      stats={stats}
      toolbar={toolbar}
      pagination={footer}
      overlays={
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
          <label className={styles.fieldLabel}>
            理由（必須）
            <textarea
              className={styles.textarea}
              value={pendingReason}
              onChange={(event) => setPendingReason(event.target.value)}
              placeholder={pendingAction?.kind === 'confirm' ? '例：入金を確認しました' : '例：予約がキャンセルされました'}
              rows={3}
            />
          </label>
        </Dialog>
      }
    >
      {body}
    </MileageFrame>
  )
}
