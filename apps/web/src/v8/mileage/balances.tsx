'use client'

/*
 * ★V8 マイル「友だちの残高」（板 `CJlf4`、状態は見本帳 `zaqP9`）。
 *
 * app/mileage/v8-balances-tab.tsx から動きを写し、見た目を一覧の型で組み直した。
 * フォルダの列は無い（絵どおり）。表は「友だち・ランク・いまの残高・今月の増減・
 * 消える予定・最終行動・操作（明細を見る・増減）」。承認待ちの板は今と同じ条件で出す。
 *
 * 口に残高あり・確定待ちの絞り込みは無い。札を押したときは全件を読み切ってから
 * 絞る（読んだ頁の中だけで絞ると 21 件目以降が検索に出ない）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleDot, Clock3, Download, RefreshCw, TrendingDown, TrendingUp, Undo2, Users, Wallet } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type MileageAdjustmentApprovalRequest,
  type MileageAdminHistory,
  type MileageFriendV6,
  type MileageFriendsV6Overview,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { csvCell } from '@/lib/presentation'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import {
  formatMileageMonthDay,
  formatMileageNumber,
  formatMileageShortDateTime,
  isMileageFriendsV6Overview,
  mileagePaginationTotal,
} from './display'
import { MileageFrame, useMileageShell } from './frame'
import { MileageToolbar, PerPageSelect, RetryButton, SavedSelect, StateCard, ToolbarNotices } from './parts'
import styles from './mileage.module.css'

function dateOnlyDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function expiringText(member: MileageFriendV6): string {
  if (member.expiringMiles30d == null) return 'なし'
  if (member.expiringMiles30d === 0 && member.nextExpiringAt) return '30日以内はなし'
  return formatMileageNumber(member.expiringMiles30d)
}

function rankLabel(rank: string | null) {
  if (rank === 'gold') return 'ゴールド'
  if (rank === 'silver') return 'シルバー'
  if (rank === 'bronze') return 'ブロンズ'
  return null
}

function signed(value: number): string {
  if (value > 0) return `+${formatMileageNumber(value)}`
  if (value < 0) return `−${formatMileageNumber(Math.abs(value))}`
  return '0'
}

export default function BalancesTab() {
  const { readonly, narrow, setCount } = useMileageShell()
  const router = useRouter()
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
    /* 札の絞り込み中は全件を読み切る（100件ずつ）。 */
    if (chipActive) {
      const items: MileageFriendV6[] = []
      let nextOffset = 0
      const limit = 100
      for (;;) {
        const res = await api.mileage.friendsV6({ accountId: accountAtRequest, search: search || undefined, limit, offset: nextOffset })
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
    const res = await api.mileage.friendsV6({ accountId: accountAtRequest, search: search || undefined, limit: pageSize, offset })
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
          setDecreasedMiles(byType
            .filter((item) => item.entryType !== 'grant')
            .reduce((sum, item) => sum + Math.abs(item.amount ?? 0), 0))
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
    return (allMembers ?? []).filter((member) => {
      if (withBalanceOnly && member.available <= 0) return false
      if (pendingOnly && member.pending <= 0) return false
      return true
    })
  }, [allMembers, chipActive, overview, pendingOnly, withBalanceOnly])
  /* 札の絞り込み中は手元で頁を切る。そうでなければ口が返した頁そのまま。 */
  const members = useMemo(
    () => (chipActive ? pageMembers.slice(offset, offset + pageSize) : pageMembers),
    [chipActive, offset, pageMembers, pageSize],
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
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
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

  /* タブの名の横の件数。読み直し中・失敗時は消す。 */
  useEffect(() => {
    if (loading) return
    setCount('balances', loadError || overview === null ? null : formatMileageNumber(overview.summary.totalMembers))
  }, [loadError, loading, overview, setCount])

  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setOffset(0)
    setWithBalanceOnly(false)
    setPendingOnly(false)
  }

  const ready = !loading && !loadError && summary !== null

  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="友だち"
        icon={<Users size={14} aria-hidden="true" />}
        value={ready ? summary.totalMembers : null}
        unit="人"
        detail={ready ? `マイルを持っている ${formatMileageNumber(summary.withBalanceCount)}人` : '—'}
      />
      <KpiCard
        presentation="band"
        title="残高の合計"
        icon={<Wallet size={14} aria-hidden="true" />}
        value={ready ? summary.available : null}
        unit=""
        detail={ready
          ? `1人あたり ${formatMileageNumber(summary.totalMembers > 0 ? Math.round(summary.available / summary.totalMembers) : 0)}`
          : '—'}
      />
      <KpiCard
        presentation="band"
        title="今月 増えた"
        icon={<TrendingUp size={14} aria-hidden="true" />}
        value={!loading && !loadError ? grantedMiles ?? 0 : null}
        unit=""
        detail="この30日に付いた分"
      />
      <KpiCard
        presentation="band"
        title="今月 減った"
        icon={<TrendingDown size={14} aria-hidden="true" />}
        value={!loading && !loadError ? decreasedMiles ?? 0 : null}
        unit=""
        detail="交換・取り消し"
      />
    </KpiBand>
  )

  /* 承認待ちの板（黄の地）。案内の帯のすぐ下・道具の段の上。 */
  const approval = approvalRequests && approvalRequests.length > 0 ? (
    <section className={styles.approval} aria-label="承認待ちのマイル変更">
      <p className={styles.approvalTitle}>{`承認待ちのマイル変更 ${approvalRequests.length}件`}</p>
      {approvalError ? <Notice tone="danger" message={approvalError} /> : null}
      {approvalRequests.map((request) => (
        <div key={request.id} className={styles.approvalRow}>
          <div className={styles.approvalText}>
            <span className={styles.approvalName}>
              {`${request.friend_display_name ?? request.friend_id} に ${request.direction === 'increase' ? '+' : '−'}${formatNumber(request.amount)} マイル`}
            </span>
            <span className={styles.approvalSub} title={request.reason}>
              {`${request.reason}・申請 ${request.requested_by_staff_name}（${formatMileageShortDateTime(request.created_at)}）`}
            </span>
          </div>
          {isOwner && !readonly ? (
            <>
              <Button
                variant="secondary"
                disabled={approvalBusyId !== null}
                onClick={() => { setRejectTarget(request); setRejectReason(''); setApprovalError('') }}
              >
                <Undo2 size={15} aria-hidden="true" /> 差し戻す
              </Button>
              <Button
                variant="primary"
                disabled={approvalBusyId !== null}
                onClick={() => void decideApproval(request.id, 'approve')}
              >
                <Check size={15} aria-hidden="true" /> 承認する
              </Button>
            </>
          ) : (
            <span className={styles.approvalSub}>オーナーが対応します</span>
          )}
        </div>
      ))}
      <p className={styles.approvalNote}>5,000 マイル以上の変更は、申請した人とは別のオーナーが承認するまで付きません。</p>
    </section>
  ) : approvalFailed ? (
    <section className={styles.approval} aria-label="承認待ちのマイル変更">
      <p className={styles.approvalTitle}>承認待ちのマイル変更</p>
      <p className={styles.approvalNote}>承認待ちを読み込めませんでした。依頼があるか分からない状態です。</p>
      <div>
        <Button onClick={() => void loadApprovals()}>もう一度読み込む</Button>
      </div>
    </section>
  ) : null

  const chips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip
        selected={withBalanceOnly}
        icon={<CircleDot size={13} aria-hidden="true" />}
        onChange={(selected) => { setOffset(0); setWithBalanceOnly(selected) }}
      >
        {`残高あり ${summary === null ? '—' : formatMileageNumber(summary.withBalanceCount)}`}
      </FilterChip>
      <FilterChip
        selected={pendingOnly}
        icon={<Clock3 size={13} aria-hidden="true" />}
        onChange={(selected) => { setOffset(0); setPendingOnly(selected) }}
      >
        {/* 件数は全件を読み切ったときだけ確か（読んだ頁の中だけの数と混ぜない）。 */}
        {chipActive ? `確定待ちあり ${formatMileageNumber(pendingCount)}` : '確定待ちあり'}
      </FilterChip>
    </div>
  )

  const toolbar = (
    <>
      <div className={styles.fullRow}>
        <Notice tone="info">残高は数分ごとに計算し直します。「残高を再読み込み」で今すぐ計算し直せます。</Notice>
      </div>
      {approval ? <div className={styles.fullRowFlush}>{approval}</div> : null}
      <MileageToolbar
        narrow={narrow}
        notices={<ToolbarNotices error={exportError} />}
        search={{
          placeholder: '友だちの名前で探す',
          value: searchInput,
          onChange: (value) => {
            setSearchInput(value)
            if (!value) { setSearch(''); setOffset(0) }
          },
        }}
        chips={chips}
        trailing={<>
          <SavedSelect
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
          <PerPageSelect value={pageSize} onChange={(next) => { setOffset(0); setPageSize(next) }} />
        </>}
      />
    </>
  )

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={styles.table}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>友だち</Th>
            <Th className={styles.colRank}>ランク</Th>
            <Th className={`${styles.colBalance} ${styles.num}`}>いまの残高</Th>
            <Th className={`${styles.colChange} ${styles.num}`}>今月の増減</Th>
            <Th className={`${styles.colBalance} ${styles.num}`}>消える予定</Th>
            <Th className={styles.colLast}>最終行動</Th>
            <Th className={styles.colOpsBalance}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {members.map((member) => {
            const href = `/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}`
            return (
              <Tr
                key={member.friendId}
                className={styles.row}
                data-table-layout="columns"
                interactive
                onClick={(event) => {
                  /* 行の中のボタン・リンクを押したときは、そちらに任せる。 */
                  if ((event.target as HTMLElement).closest('a, button')) return
                  router.push(href)
                }}
              >
                <Td className={styles.colName}>
                  <span className={styles.rowNameInk} title={member.displayName}>{member.displayName}</span>
                  <span className={styles.rowSub} title={member.lineAccount.name}>{member.lineAccount.name}</span>
                </Td>
                <Td className={styles.colRank}><span className={styles.cellMain} title={member.rankReason}>{rankLabel(member.rank) ?? '—'}</span></Td>
                <Td className={`${styles.colBalance} ${styles.num}`}>
                  <span className={styles.cellMain}>{formatMileageNumber(member.available)}</span>
                  {member.pending > 0 ? <span className={styles.cellSub}>{`保留 ${formatMileageNumber(member.pending)}`}</span> : null}
                </Td>
                <Td className={`${styles.colChange} ${styles.num}`}><span className={styles.cellMain}>{signed(member.monthChange)}</span></Td>
                <Td className={`${styles.colBalance} ${styles.num}`}><span className={styles.cellMain}>{expiringText(member)}</span></Td>
                <Td className={styles.colLast}><span className={styles.cellMain}>{formatMileageMonthDay(member.lastChangedAt)}</span></Td>
                <Td className={styles.colOpsBalance}>
                  <span className={styles.rowActions}>
                    <Button href={href}>明細を見る</Button>
                    {/* 閲覧のみの人には増減を出さない。 */}
                    {!readonly ? <Button href={`${href}&adjust=1`}>増減</Button> : null}
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
    <ListState kind="loading" title="マイルの残高を読み込んでいます" />
  ) : loadError ? (
    <StateCard
      tone="error"
      title="マイルの残高を読み込めませんでした"
      description="数の帯は「—」、道具はそのまま使える。残高の再読み込みもここから"
      action={<RetryButton onRetry={() => void reloadAll()} />}
    />
  ) : members.length === 0 ? (
    search.trim() || chipActive ? (
      <StateCard title="条件に合う友だちはいません" description="名前の検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={resetAll}>条件を外す</Button>} />
    ) : (
      <StateCard title="まだ残高がありません" description="たまる決めごとを作ると、友だちにマイルがたまりはじめます" />
    )
  ) : (
    table
  )

  const pager = !loading && !loadError && members.length > 0 && pageCount > 1 ? (
    <div className={styles.pagerRow}>
      <span className={styles.pagerCount}>
        {`${formatMileageNumber(filteredTotal)}人中 ${formatMileageNumber(offset + 1)}〜${formatMileageNumber(Math.min(offset + members.length, filteredTotal))}人`}
      </span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={(nextPage) => setOffset((nextPage - 1) * pageSize)} disabled={loading} />
    </div>
  ) : null
  /* 絵 CJlf4：表 → ページ送り → 下の案内の順。 */
  const footer = !loading && !loadError && members.length > 0 ? (
    <>
      {pager}
      <p className={styles.footNoteFlush}>行を押すと、その人のマイルの詳細（明細・増やす／減らす）を開きます。CSV はこのページの残高を書き出します。</p>
    </>
  ) : undefined

  return (
    <MileageFrame
      actions={<div className={styles.headActions}>
        <Button onClick={() => void reloadAll()} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" /> 残高を再読み込み
        </Button>
        <Button onClick={exportCsv} disabled={members.length === 0}>
          <Download size={15} aria-hidden="true" /> この頁の残高を CSV
        </Button>
      </div>}
      stats={stats}
      toolbar={toolbar}
      pagination={footer}
      overlays={
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
          <label className={styles.fieldLabel}>
            差し戻す理由
            <textarea
              className={styles.textarea}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="例：調整の根拠となる資料を確認できませんでした"
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
