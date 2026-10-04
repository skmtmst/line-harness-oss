'use client'

/*
 * ★V8-B マイル「履歴」（板 `oRbJi`、状態 `zaqP9`、閲覧のみ `E2Any`）。
 *
 * データの口は v7（mileage-history-tab.tsx）と同じ口へ取りに行く。
 * 表は「いつ・だれに・増減・なぜ・残高・だれが・操作」。
 * 行末の操作はボタン1つ＋「…」（確定待ちは「確定する」＋…、
 * 付けた分は「取り消す」＋…、ほかは「友だちを見る」）。
 *
 * v7 の種類・状態・方法・期間の絞り込みは「よく使う絞り込み」の
 * 見方として残す（操作を落とさない）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { CalendarRange, Download, History, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import IconButton from '@/components/shared/icon-button'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import ActionMenu from '@/components/shared/action-menu'
import { MoreHorizontal } from 'lucide-react'
import {
  ApiError,
  api,
  type MileageAdminHistory,
  type MileageAdminHistoryItem,
  type MileageHistoryItem,
} from '@/lib/api'
import { csvCell } from '@/lib/presentation'
import {
  formatMileageChange,
  formatMileageShortDateTime,
  mileageEntryTypeLabel,
  mileageSourceLabel,
  mileageSourceNoteText,
  mileageStatusLabel,
} from './mileage-display'
import { mileagePaginationTotal } from './mileage-response-state'
import { formatNumber } from '@/lib/format'
import styles from './mileage-v8.module.css'

function viewName(item: MileageAdminHistoryItem) {
  return item.displayName || '名前未取得'
}

/* 「付けた」に入る種類。ほかは「使った・取り消し」へ。 */
function isGranted(item: MileageAdminHistoryItem) {
  return item.entryType === 'grant'
}

const PRESETS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'すべて' },
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

export default function V8HistoryTab({
  readonly,
  registerHeaderActions,
}: {
  readonly: boolean
  registerHeaderActions: (node: ReactNode) => void
}) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const requestRef = useRef(0)
  const [result, setResult] = useState<MileageAdminHistory | null>(null)
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
      /*
       * 「使った・取り消しのみ」は口に種類の絞り込みが無いので、
       * 付けた分を Djb で除く（R304 の 400 扱いは v7 と同じ）。
       */
      if (spentOnly) {
        response.data.items = response.data.items.filter((item) => !isGranted(item))
      }
      setResult(response.data)
    } catch (caught) {
      if (request !== requestRef.current) return
      setResult(null)
      if (!(caught instanceof ApiError && caught.status === 400)) {
        setError(true)
      }
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

  const items = result?.items ?? []
  const total = mileagePaginationTotal(result)
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize))
  const byType = result?.summary.byType ?? []
  const countOf = (entryType: MileageHistoryItem['entryType']) =>
    byType.find((item) => item.entryType === entryType)?.count ?? 0
  const amountOf = (entryType: MileageHistoryItem['entryType']) =>
    byType.find((item) => item.entryType === entryType)?.amount ?? 0
  const grantedCount = countOf('grant')
  const reversalCount = countOf('reversal')

  const exportCsv = () => {
    if (items.length === 0) return
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
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mileage-history-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    registerHeaderActions(
      <>
        <Button onClick={exportCsv} disabled={items.length === 0}>
          <Download size={14} aria-hidden="true" /> CSV で書き出す
        </Button>
        {!readonly ? (
          <Button href="/mileage?tab=balances" title="友だちを選んで増減します">
            <Plus size={14} aria-hidden="true" /> 増やす・減らす
          </Button>
        ) : null}
      </>,
    )
    return () => registerHeaderActions(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, readonly, registerHeaderActions])

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

  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setGrantedOnly(false)
    setSpentOnly(false)
    setPreset('all')
    setPage(1)
  }

  return (
    <>
      <div className={styles.kpis} role="group" aria-label="今の数">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><History size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>今月の動き</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || error || total === null ? '—' : formatNumber(total)}
            <span className={styles.kpiUnit}> 件</span>
          </p>
          <p className={styles.kpiSub}>
            {loading || error ? '—' : `付けた ${formatNumber(grantedCount)}・使った ${formatNumber(countOf('spend'))}・取り消し ${formatNumber(reversalCount)}`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><TrendingUp size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>付けた</span>
          </div>
          <p className={styles.kpiValue}>{loading || error ? '—' : formatNumber(amountOf('grant'))}</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><TrendingDown size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>使った</span>
          </div>
          <p className={styles.kpiValue}>{loading || error ? '—' : formatNumber(Math.abs(amountOf('spend')))}</p>
          <p className={styles.kpiSub}>交換 {formatNumber(countOf('spend'))}件</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><CalendarRange size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>取り消し</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || error ? '—' : formatNumber(reversalCount)}
            <span className={styles.kpiUnit}> 件</span>
          </p>
          <p className={styles.kpiSub}>注文の取り消しで引いた</p>
        </div>
      </div>

      <p className={styles.band} role="note">
        明細はあとから消せません。間違えて付けたときは「減らす」で取り消しの明細を足します。
      </p>

      <div className={styles.toolbar}>
        <SearchField
          aria-label="友だち・できごとで探す"
          value={searchInput}
          onChange={setSearchInput}
          onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setPage(1)
              setSearch(searchInput.trim())
            }
          }}
          placeholder="友だち・できごとで探す"
        />
        <FilterChip
          selected={grantedOnly}
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
          onChange={(selected) => {
            setPreset('all')
            setPage(1)
            setSpentOnly(selected)
            if (selected) setGrantedOnly(false)
          }}
        >
          使った・取り消し
        </FilterChip>
        <span className={styles.toolbarRight}>
          <Select
            aria-label="よく使う絞り込み"
            value={presetValue}
            options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            onChange={(value) => applyPreset(value)}
          />
          <PageSizeSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} options={[10, 20, 50]} />
        </span>
      </div>

      {loading ? (
        <div className={styles.stateWrap} role="status" aria-label="読み込み中">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skelRow} aria-hidden="true">
              <span className={styles.skelDot} />
              <span className={styles.skelBar} style={{ width: '22%' }} />
              <span className={styles.skelBar} style={{ width: '14%' }} />
              <span className={styles.skelBar} style={{ width: '18%' }} />
              <span className={styles.skelBar} style={{ width: '10%', marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className={styles.stateWrap}>
          <div className={styles.errorBand} role="alert">
            マイルの履歴を読み込めませんでした
            <span className={styles.errorRetry}>
              <Button type="button" onClick={() => void load()}>もう一度試す</Button>
            </span>
          </div>
          <p className={styles.errorNote}>数の帯は「—」にしています。道具はそのまま使えます。</p>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.stateWrap}>
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>
              {search.trim() || grantedOnly || spentOnly || preset !== 'all' ? '条件に合う履歴はありません' : 'まだ履歴がありません'}
            </p>
            <p className={styles.stateDesc}>
              {search.trim() || grantedOnly || spentOnly || preset !== 'all'
                ? '検索や絞り込みを外すと、すべて出ます'
                : 'マイルを付けたり使ったりすると、ここに記録が残ります'}
            </p>
            {search.trim() || grantedOnly || spentOnly || preset !== 'all' ? (
              <div className={styles.stateActions}>
                <Button type="button" onClick={resetAll}>条件を外す</Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">いつ・だれに</th>
                <th scope="col">増減</th>
                <th scope="col">なぜ</th>
                <th scope="col">残高</th>
                <th scope="col">だれが</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const pending = !readonly && item.status === 'pending'
                const reversible = !readonly && item.entryType === 'grant' && item.status === 'available'
                const friendHref = `/mileage/friends/detail?id=${encodeURIComponent(item.primaryFriendId)}`
                return (
                  <tr key={item.id}>
                    <td>
                      <p className={styles.cellMain} title={viewName(item)}>
                        <Link href={friendHref} style={{ color: 'inherit', textDecoration: 'none' }}>{viewName(item)}</Link>
                      </p>
                      <p className={styles.cellSub}>
                        <time dateTime={item.occurredAt}>{formatMileageShortDateTime(item.occurredAt)}</time>
                        {item.lineAccountName ? `・${item.lineAccountName}` : ''}
                      </p>
                    </td>
                    <td><span className={styles.num}>{formatMileageChange(item.amount)}</span></td>
                    <td>
                      <p
                        className={styles.cellMain}
                        style={{ color: 'var(--color-ink)', fontWeight: 400 }}
                        title={`${item.reason} / ${mileageEntryTypeLabel(item.entryType)}・${mileageStatusLabel(item.status)} / ${mileageSourceLabel(item.source)} / ${mileageSourceNoteText({ sourceReferenceId: item.sourceReferenceId, hasSourceEvent: item.hasSourceEvent })}`}
                      >
                        {item.reason}
                      </p>
                      <p className={styles.cellSub}>{mileageEntryTypeLabel(item.entryType)}・{mileageStatusLabel(item.status)}</p>
                    </td>
                    <td>
                      <span className={styles.num}>
                        {item.balanceAfter === null ? '—' : formatNumber(item.balanceAfter)}
                      </span>
                    </td>
                    <td>
                      <span className={styles.cellSubDark}>
                        {item.mode === 'manual' ? item.executedByStaffName ?? '担当者未取得' : item.entryType === 'spend' ? '本人' : '自動'}
                      </span>
                    </td>
                    <td>
                      <span className={styles.rowActions}>
                        {pending ? (
                          <Button onClick={() => { setPendingAction({ kind: 'confirm', item }); setPendingReason(''); setPendingError('') }}>
                            確定する
                          </Button>
                        ) : reversible ? (
                          <Button onClick={() => { setPendingAction({ kind: 'void', item }); setPendingReason(''); setPendingError('') }}>
                            取り消す
                          </Button>
                        ) : (
                          <Button href={friendHref}>友だちを見る</Button>
                        )}
                        {(pending || reversible) && (
                          <>
                            <IconButton
                              aria-label="その他の操作"
                              title="その他の操作"
                              onClick={() => setMenuId((current) => (current === item.id ? null : item.id))}
                            >
                              <MoreHorizontal size={14} aria-hidden="true" />
                            </IconButton>
                            <ActionMenu
                              open={menuId === item.id}
                              ariaLabel="履歴の操作"
                              onClose={() => setMenuId(null)}
                              items={[
                                ...(pending ? [{
                                  id: 'void',
                                  label: '取り消す',
                                  onSelect: () => { setPendingAction({ kind: 'void', item }); setPendingReason(''); setPendingError('') },
                                }] : []),
                                {
                                  id: 'friend',
                                  label: '友だちを見る',
                                  external: true,
                                  onSelect: () => { window.location.href = friendHref },
                                },
                              ]}
                            />
                          </>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && items.length > 0 ? (
        <div className={styles.footer}>
          <span className={styles.footerCount}>
            {formatNumber(total ?? 0)}件中 {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, total ?? 0)}件
          </span>
          {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} disabled={loading} /> : null}
        </div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <p className={styles.footnote}>行を押すと、その友だちのマイルの詳細を開きます。「増やす・減らす」は理由を書いて明細を足します（オーナー・管理者だけ）。</p>
      ) : null}

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
        <label className={styles.cellSubDark} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          理由（必須）
          <textarea
            className={styles.dlgTextarea}
            value={pendingReason}
            onChange={(event) => setPendingReason(event.target.value)}
            placeholder={pendingAction?.kind === 'confirm' ? '例：入金を確認しました' : '例：予約がキャンセルされました'}
            rows={3}
          />
        </label>
      </Dialog>
    </>
  )
}
