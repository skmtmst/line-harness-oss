'use client'

/*
 * ★V8-B マイル「友だちの残高」（板 `CJlf4`、状態 `zaqP9`、
 * 1152 `ZJIyl`、閲覧のみ `E2Any`）。
 *
 * データの口は v7（page.tsx の balances 節）と同じ口へ取りに行く。
 * 表は「友だち・ランク・いまの残高・今月の増減・消える予定・最終行動・
 * 操作（明細を見る・増減）」。承認待ちの黄の板は v7 と同じ条件で出す。
 *
 * 口に残高あり・確定待ちの絞り込みは無い。札を押したときは全件を
 * 読み切ってから Djb で絞る（読んだ頁の中だけで絞ると 21 件目以降が
 * 検索に出ない。v7 の N-243 と同じ考え）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Download, RefreshCw, TrendingDown, TrendingUp, Undo2, Users } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import {
  api,
  type MileageAdjustmentApprovalRequest,
  type MileageAdminHistory,
  type MileageFriendV6,
  type MileageFriendsV6Overview,
} from '@/lib/api'
import { isMileageFriendsV6Overview } from './friends-overview-guard'
import { formatMileageDate, formatMileageNumber } from './mileage-display'
import { mileagePaginationTotal } from './mileage-response-state'
import { csvCell } from '@/lib/presentation'
import styles from './mileage-v8.module.css'

function dateOnlyDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function expiringText(member: MileageFriendV6): string {
  if (member.expiringMiles30d == null) return 'なし'
  if (member.expiringMiles30d === 0 && member.nextExpiringAt) {
    return `30日以内はなし`
  }
  return `${formatMileageNumber(member.expiringMiles30d)}`
}

function rankLabel(rank: string | null) {
  if (rank === 'gold') return 'ゴールド'
  if (rank === 'silver') return 'シルバー'
  if (rank === 'bronze') return 'ブロンズ'
  return null
}

export default function V8BalancesTab({
  readonly,
  registerHeaderActions,
}: {
  readonly: boolean
  registerHeaderActions: (node: ReactNode) => void
}) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    latestAccountRef.current = selectedAccountId
  }, [selectedAccountId])
  const [overview, setOverview] = useState<MileageFriendsV6Overview | null>(null)
  const [allMembers, setAllMembers] = useState<MileageFriendV6[] | null>(null)
  const [grantedMiles, setGrantedMiles] = useState<number | null>(null)
  const [decreasedMiles, setDecreasedMiles] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [withBalanceOnly, setWithBalanceOnly] = useState(false)
  const [pendingOnly, setPendingOnly] = useState(false)
  const [approvalRequests, setApprovalRequests] = useState<MileageAdjustmentApprovalRequest[] | null>(null)
  const [approvalFailed, setApprovalFailed] = useState(false)
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState('')
  const [rejectTarget, setRejectTarget] = useState<MileageAdjustmentApprovalRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [isOwner, setIsOwner] = useState(false)
  const [exportError, setExportError] = useState('')

  const chipActive = withBalanceOnly || pendingOnly

  const loadOverview = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setOverview(null)
      return
    }
    /*
     * 札の絞り込み中は全件を読み切る（100件ずつ）。読んだ頁の中だけで
     * 絞ると 2 頁目以降が結果に出ない。
     */
    if (chipActive) {
      const items: MileageFriendV6[] = []
      let nextOffset = 0
      const limit = 100
      for (;;) {
        const res = await api.mileage.friendsV6({
          accountId: accountAtRequest,
          search: search || undefined,
          limit,
          offset: nextOffset,
        })
        if (accountAtRequest !== latestAccountRef.current) return
        if (!res.success) throw new Error(res.error)
        if (!isMileageFriendsV6Overview(res.data)) throw new Error('invalid_mileage_overview')
        if (items.length === 0) setOverview(res.data)
        items.push(...res.data.items)
        const total = res.data.pagination.total
        if (items.length >= total || res.data.items.length === 0) break
        nextOffset += limit
      }
      setAllMembers(items)
      return
    }
    const res = await api.mileage.friendsV6({
      accountId: accountAtRequest,
      search: search || undefined,
      limit: pageSize,
      offset,
    })
    if (accountAtRequest !== latestAccountRef.current) return
    if (!res.success) throw new Error(res.error)
    if (!isMileageFriendsV6Overview(res.data)) throw new Error('invalid_mileage_overview')
    setOverview(res.data)
    setAllMembers(null)
  }, [chipActive, offset, pageSize, search, selectedAccountId])

  const reloadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      await loadOverview()
      if (selectedAccountId && latestAccountRef.current === selectedAccountId) {
        const historyRes = await api.mileage.history({
          accountId: selectedAccountId,
          from: dateOnlyDaysAgo(29),
          to: dateOnlyDaysAgo(0),
          limit: 1,
          offset: 0,
        })
        if (latestAccountRef.current !== selectedAccountId) return
        if (historyRes.success) {
          const byType = (historyRes.data as MileageAdminHistory).summary.byType
          setGrantedMiles(byType.find((item) => item.entryType === 'grant')?.amount ?? 0)
          const decrease = byType
            .filter((item) => item.entryType !== 'grant')
            .reduce((sum, item) => sum + Math.abs(item.amount ?? 0), 0)
          setDecreasedMiles(decrease)
        }
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [loadOverview, selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    setOverview(null)
    setAllMembers(null)
    void reloadAll()
  }, [accountLoading, reloadAll])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let current = true
    void api.staff.me().then((response) => {
      if (!current || !response.success) return
      setIsOwner(response.data.role === 'owner')
    }).catch(() => {})
    return () => { current = false }
  }, [])

  const loadApprovals = useCallback(async () => {
    if (!selectedAccountId) {
      setApprovalRequests(null)
      setApprovalFailed(false)
      return
    }
    try {
      const response = await api.mileage.adjustmentApprovals(selectedAccountId, 'pending')
      setApprovalRequests(response.success ? response.data : null)
      setApprovalFailed(!response.success)
    } catch {
      setApprovalRequests(null)
      setApprovalFailed(true)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadApprovals()
  }, [loadApprovals])

  const decideApproval = async (requestId: string, action: 'approve' | 'reject', reason?: string) => {
    if (readonly || !selectedAccountId || approvalBusyId) return
    setApprovalBusyId(requestId)
    setApprovalError('')
    try {
      const response = action === 'approve'
        ? await api.mileage.approveAdjustment(requestId, selectedAccountId)
        : await api.mileage.rejectAdjustment(requestId, selectedAccountId, reason)
      if (!response.success) throw new Error(response.error)
      setRejectTarget(null)
      setRejectReason('')
      await loadApprovals()
      await loadOverview().catch(() => {})
    } catch (caught) {
      setApprovalError(caught instanceof Error ? caught.message : '処理できませんでした。もう一度お試しください。')
    } finally {
      setApprovalBusyId(null)
    }
  }

  const summary = overview?.summary ?? null
  const overviewTotal = mileagePaginationTotal(overview)
  const pageMembers = useMemo(() => {
    if (!chipActive) return overview?.items ?? []
    const items = allMembers ?? []
    return items.filter((member) => {
      if (withBalanceOnly && member.available <= 0) return false
      if (pendingOnly && member.pending <= 0) return false
      return true
    })
  }, [allMembers, chipActive, overview, pendingOnly, withBalanceOnly])
  const members = useMemo(
    () => pageMembers.slice(offset, offset + pageSize),
    [offset, pageMembers, pageSize],
  )
  const exportCsv = useCallback(() => {
    if (members.length === 0) return
    setExportError('')
    try {
      const rows = members.map((member) => [
        member.displayName,
        member.lineAccount.name,
        member.available,
        member.pending,
        member.expiringMiles30d ?? '',
        member.lastChangedAt ?? '',
      ])
      const csv = [['友だち', 'LINEアカウント', 'いまの残高', '確定待ち', '30日以内に失効', '最終変動'], ...rows]
        .map((row) => row.map((value) => csvCell(value)).join(','))
        .join('\n')
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mileage-balances-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('CSVを書き出せませんでした。もう一度お試しください。')
    }
  }, [members])
  const filteredTotal = chipActive ? pageMembers.length : (overviewTotal ?? 0)
  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize))
  const currentPage = Math.floor(offset / pageSize) + 1
  const pendingCount = useMemo(
    () => (allMembers ?? overview?.items ?? []).filter((member) => member.pending > 0).length,
    [allMembers, overview],
  )

  useEffect(() => {
    registerHeaderActions(
      <>
        <Button onClick={() => void reloadAll()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" /> 残高を再読み込み
        </Button>
        <Button onClick={exportCsv} disabled={members.length === 0}>
          <Download size={14} aria-hidden="true" /> この頁の残高をCSV
        </Button>
      </>,
    )
    return () => registerHeaderActions(null)
  }, [exportCsv, loading, members.length, registerHeaderActions, reloadAll])

  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setOffset(0)
    setWithBalanceOnly(false)
    setPendingOnly(false)
  }

  return (
    <>
      <div className={styles.kpis} role="group" aria-label="今の数">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Users size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>友だち</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || loadError || summary === null ? '—' : formatMileageNumber(summary.totalMembers)}
            <span className={styles.kpiUnit}> 人</span>
          </p>
          <p className={styles.kpiSub}>
            {loading || loadError || summary === null
              ? '—'
              : `マイルを持っている ${formatMileageNumber(summary.withBalanceCount)}人`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Users size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>残高の合計</span>
          </div>
          <p className={styles.kpiValue}>{loading || loadError || summary === null ? '—' : formatMileageNumber(summary.available)}</p>
          <p className={styles.kpiSub}>
            {loading || loadError || summary === null
              ? '—'
              : `1人あたり ${formatMileageNumber(summary.totalMembers > 0 ? Math.round(summary.available / summary.totalMembers) : 0)}`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><TrendingUp size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>今月増えた</span>
          </div>
          <p className={styles.kpiValue}>{loading || loadError ? '—' : formatMileageNumber(grantedMiles ?? 0)}</p>
          <p className={styles.kpiSub}>この30日に付いた分</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><TrendingDown size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>今月減った</span>
          </div>
          <p className={styles.kpiValue}>{loading || loadError ? '—' : formatMileageNumber(decreasedMiles ?? 0)}</p>
          <p className={styles.kpiSub}>交換・取り消し</p>
        </div>
      </div>

      {exportError ? <Notice tone="danger" message={exportError} /> : null}

      <p className={styles.band} role="note">
        残高は数分ごとに計算し直します。「残高を再読み込み」で今すぐ計算し直せます。
      </p>

      {approvalRequests && approvalRequests.length > 0 ? (
        <section className={styles.approval} aria-label="承認待ちのマイル変更">
          <p className={styles.approvalTitle}>承認待ちのマイル変更 {approvalRequests.length}件</p>
          {approvalError ? <Notice tone="danger" message={approvalError} /> : null}
          {approvalRequests.map((request) => (
            <div key={request.id} className={styles.approvalRow}>
              <div className={styles.approvalText}>
                <p className={styles.cellSubDark}>
                  <strong>{request.friend_display_name ?? request.friend_id} に
                  {request.direction === 'increase' ? ' +' : ' −'}
                  {formatNumber(request.amount)} マイル</strong>
                </p>
                <p className={styles.cellSub} title={request.reason}>{request.reason}</p>
              </div>
              {isOwner && !readonly ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={approvalBusyId !== null}
                    onClick={() => { setRejectTarget(request); setRejectReason(''); setApprovalError('') }}
                  >
                    <Undo2 size={14} aria-hidden="true" /> 差し戻す
                  </Button>
                  <Button
                    variant="primary"
                    disabled={approvalBusyId !== null}
                    onClick={() => void decideApproval(request.id, 'approve')}
                  >
                    <Check size={14} aria-hidden="true" /> 承認する
                  </Button>
                </>
              ) : (
                <span className={styles.cellSub}>オーナーが対応します</span>
              )}
            </div>
          ))}
          <p className={styles.approvalNote}>5,000 マイル以上の変更は、申し込んだ人とは別のオーナーが承認するまで付きません。</p>
        </section>
      ) : approvalFailed ? (
        <section className={styles.approval} aria-label="承認待ちのマイル変更">
          <p className={styles.approvalTitle}>承認待ちのマイル変更</p>
          <p className={styles.approvalNote}>承認待ちを読み込めませんでした。依頼があるか分からない状態です。</p>
          <div className={styles.stateActions}>
            <Button onClick={() => void loadApprovals()}>もう一度読み込む</Button>
          </div>
        </section>
      ) : null}

      <div className={styles.toolbar}>
        <SearchField
          aria-label="友だちの名前で探す"
          value={searchInput}
          onChange={setSearchInput}
          onClear={() => { setSearchInput(''); setSearch(''); setOffset(0) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setOffset(0)
              setSearch(searchInput.trim())
            }
          }}
          placeholder="友だちの名前で探す"
        />
        <FilterChip
          selected={withBalanceOnly}
          onChange={(selected) => { setOffset(0); setWithBalanceOnly(selected) }}
        >
          残高あり {summary === null ? '—' : formatMileageNumber(summary.withBalanceCount)}
        </FilterChip>
        <FilterChip
          selected={pendingOnly}
          onChange={(selected) => { setOffset(0); setPendingOnly(selected) }}
        >
          {/* 件数は全件を読み切ったときだけ確か（読んだ頁の中だけの数と混ぜない）。 */}
          確定待ちあり {chipActive ? formatMileageNumber(pendingCount) : null}
        </FilterChip>
        <span className={styles.toolbarRight}>
          <Select
            aria-label="よく使う絞り込み"
            value={withBalanceOnly ? 'with-balance' : pendingOnly ? 'pending' : 'default'}
            options={[
              { value: 'default', label: 'よく使う絞り込み' },
              { value: 'with-balance', label: '残高ありのみ' },
              { value: 'pending', label: '確定待ちありのみ' },
            ]}
            onChange={(value) => {
              setOffset(0)
              setWithBalanceOnly(value === 'with-balance')
              setPendingOnly(value === 'pending')
            }}
          />
          <PageSizeSelect value={pageSize} onChange={(next) => { setOffset(0); setPageSize(next) }} options={[10, 20, 50]} />
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
      ) : loadError ? (
        <div className={styles.stateWrap}>
          <div className={styles.errorBand} role="alert">
            マイルの残高を読み込めませんでした
            <span className={styles.errorRetry}>
              <Button type="button" onClick={() => void reloadAll()}>もう一度試す</Button>
            </span>
          </div>
          <p className={styles.errorNote}>数の帯は「—」にしています。残高の再読み込みもここからできます。</p>
        </div>
      ) : members.length === 0 ? (
        <div className={styles.stateWrap}>
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>
              {search.trim() || chipActive ? '条件に合う友だちはいません' : 'まだ残高がありません'}
            </p>
            <p className={styles.stateDesc}>
              {search.trim() || chipActive
                ? '名前の検索や絞り込みを外すと、すべて出ます'
                : 'たまる決めごとを作ると、友だちにマイルがたまりはじめます'}
            </p>
            {search.trim() || chipActive ? (
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
                <th scope="col">友だち</th>
                <th scope="col">ランク</th>
                <th scope="col">いまの残高</th>
                <th scope="col">今月の増減</th>
                <th scope="col">消える予定</th>
                <th scope="col">最終行動</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.friendId}>
                  <td>
                    <p className={styles.cellMain} title={member.displayName}>{member.displayName}</p>
                    <p className={styles.cellSub} title={member.lineAccount.name}>{member.lineAccount.name}</p>
                  </td>
                  <td><span className={styles.cellSubDark} title={member.rankReason}>{rankLabel(member.rank) ?? '—'}</span></td>
                  <td>
                    <span className={styles.num}>{formatMileageNumber(member.available)}</span>
                    {member.pending > 0 ? <p className={styles.cellSub}>保留 {formatMileageNumber(member.pending)}</p> : null}
                  </td>
                  <td>
                    <span className={styles.num}>
                      {member.monthChange > 0 ? '+' : ''}{formatMileageNumber(member.monthChange)}
                    </span>
                  </td>
                  <td><span className={styles.cellSubDark}>{expiringText(member)}</span></td>
                  <td><span className={styles.cellSubDark}>{formatMileageDate(member.lastChangedAt)}</span></td>
                  <td>
                    <span className={styles.rowActions}>
                      <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}`}>
                        明細を見る
                      </Button>
                      {!readonly ? (
                        <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}&adjust=1`}>
                          増減
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !loadError && members.length > 0 ? (
        <div className={styles.footer}>
          <span className={styles.footerCount}>
            {formatMileageNumber(filteredTotal)}人中 {formatMileageNumber(offset + 1)}〜{formatMileageNumber(Math.min(offset + members.length, filteredTotal))}人
          </span>
          {pageCount > 1 ? (
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPageChange={(nextPage) => setOffset((nextPage - 1) * pageSize)}
              disabled={loading}
            />
          ) : null}
        </div>
      ) : null}

      {!loading && !loadError ? (
        <p className={styles.footnote}>行を押すと、その人のマイルの詳細（明細・増やす／減らす）を開きます。CSVはこのページの残高を書き出します。</p>
      ) : null}

      <Dialog
        open={rejectTarget !== null}
        title="この変更依頼を差し戻しますか？"
        description={rejectTarget ? `${rejectTarget.friend_display_name ?? rejectTarget.friend_id} への変更は行われず、台帳は変わりません。` : undefined}
        tone="destructive"
        confirmLabel="差し戻す"
        cancelLabel="キャンセル"
        busy={approvalBusyId !== null}
        error={approvalError || undefined}
        onCancel={() => { if (approvalBusyId === null) setRejectTarget(null) }}
        onConfirm={() => { if (rejectTarget) void decideApproval(rejectTarget.id, 'reject', rejectReason.trim() || undefined) }}
      >
        <label className={styles.cellSubDark} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          差し戻す理由
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="例：調整の根拠となる資料を確認できませんでした"
            rows={3}
            style={{ border: '1px solid var(--color-hairline)', borderRadius: 'var(--radius-mini)', padding: '8px 12px', fontSize: 13 }}
          />
        </label>
      </Dialog>
    </>
  )
}
