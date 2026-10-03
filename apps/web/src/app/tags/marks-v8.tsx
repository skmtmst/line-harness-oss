'use client'

/*
 * ★V8 友だち属性「対応マーク」タブの一覧（Pencil `vKDj5`、状態 `U0aKD`）。
 *
 * フォルダを持たないタブなので、作る口は見出しの右（page 側の headAction）。
 * 数え方・並べ替え・保管の確認窓は v7（`mark-list.tsx`）と同じ関数を使う。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CircleDot, History, LockKeyhole, MoreHorizontal, Tag as TagIcon, UserCheck } from 'lucide-react'
import { api, ApiError, type SupportMarkArchiveImpact, type SupportMarkListItem } from '@/lib/api'
import type { ListStats } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import { TableHeadRow, Th } from '@/components/shared/table'
import ReorderGrip from '@/components/friend-fields/reorder-grip'
import { mergeVisibleOrder, movableIds } from '@/components/friend-fields/reorder-utils'
import { ArchiveMarkDialog, autoRuleLabel, isUsed, usageLabel } from '@/components/friend-fields/mark-list'
import { STATE_TEXT } from '@/components/shared/not-connected'
import { DelayedSkeleton } from '@/components/shared/skeleton'
import { TagRowsSkeleton } from './tag-rows-skeleton'
import styles from './list-v8.module.css'

type MarkRow = SupportMarkListItem
type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

export default function MarksTabV8({ accountId, canEdit }: { accountId: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<MarkRow[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState('')
  // 並び替え・保管の失敗は読み込み失敗と別に持つ（#1014 ATTR-02）。
  const [actionError, setActionError] = useState('')
  const [retryOrder, setRetryOrder] = useState<MarkRow[] | null>(null)
  const [stats, setStats] = useState<ListStats | null>(null)
  const [statsStatus, setStatsStatus] = useState<LoadStatus>('loading')
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<'all' | 'used' | 'unused'>('all')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [dragId, setDragId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MarkRow | null>(null)
  const [archiveImpact, setArchiveImpact] = useState<SupportMarkArchiveImpact | null>(null)
  const [replacementMarkId, setReplacementMarkId] = useState('')
  const [impactLoading, setImpactLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  /* アカウント切替のあとに届いた古い応答で一覧を上書きしない（ATTR-01）。 */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(accountId)
  accountRef.current = accountId

  /* 切替時は別アカウントの保管確認・掴み中の行を残さない。 */
  useEffect(() => {
    gateRef.current.invalidate()
    setPendingDelete(null)
    setArchiveImpact(null)
    setDragId(null)
    setPage(1)
    setError('')
    setActionError('')
    setRetryOrder(null)
    setDeleteError('')
    setOpenMenuId(null)
  }, [accountId])

  const load = useCallback(async () => {
    const account = accountId
    const token = gateRef.current.begin()
    if (!account) {
      setItems([])
      setStatus('error')
      setError('LINE公式アカウントを選んでください')
      return
    }
    setStatus('loading')
    setError('')
    try {
      const res = await api.supportMarks.list(account)
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setItems(res.data)
      setStatus('ready')
    } catch (reason) {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    }
  }, [accountId])
  useEffect(() => { void load() }, [load])

  /* 帯の人数は受信箱の集計（/api/list-stats）から。一覧とは別の要求。 */
  useEffect(() => {
    if (!accountId) {
      setStatsStatus('error')
      return
    }
    let cancelled = false
    setStats(null)
    setStatsStatus('loading')
    void api.listStats.get(accountId).then((res) => {
      if (cancelled) return
      if (res.success) { setStats(res.data); setStatsStatus('ready') }
      else { setStats(null); setStatsStatus('error') }
    }, (reason) => {
      if (cancelled) return
      setStats(null)
      setStatsStatus(reason instanceof ApiError && reason.status === 403 ? 'forbidden' : 'error')
    })
    return () => { cancelled = true }
  }, [accountId])

  const visible = useMemo(() => items.filter((mark) => {
    if (query && !mark.name.toLocaleLowerCase('ja').includes(query.toLocaleLowerCase('ja'))) return false
    if (usage === 'used' && !isUsed(mark)) return false
    if (usage === 'unused' && isUsed(mark)) return false
    return true
  }), [items, query, usage])

  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pages)
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [query, usage, pageSize])

  /*
   * 並び替え（v7 と同じ）。/api/support-marks/reorder へ「動かせる行だけの
   * 新しい順」を1回で渡す。共有マークは送らず位置を保つ。
   */
  const applyOrder = async (next: MarkRow[]) => {
    if (!accountId) return
    const previous = items
    setItems(next)
    setActionError('')
    setRetryOrder(null)
    try {
      const res = await api.supportMarks.reorder(accountId, movableIds(next, (mark) => !mark.isInherited))
      if (!res.success) throw new Error(res.error)
      await load()
    } catch (reason) {
      setItems(previous)
      setActionError(reason instanceof ApiError ? `並び順を保存できませんでした（${reason.message}）` : '並び順を保存できませんでした')
      setRetryOrder(next)
    }
  }

  const move = async (targetId: string) => {
    if (!accountId || !dragId || dragId === targetId) return setDragId(null)
    const dragged = items.find((mark) => mark.id === dragId)
    const target = items.find((mark) => mark.id === targetId)
    if (dragged?.isInherited || target?.isInherited) {
      setDragId(null)
      setActionError('共有マークは、編集してこのアカウント専用にしてから並び替えてください')
      return
    }
    const order = visible.map((mark) => mark.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0) return
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((id) => items.find((mark) => mark.id === id)).filter(Boolean) as MarkRow[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (mark) => mark.isInherited === true))
  }

  /** つまみにフォーカスして ↑/↓。共有マークに隣接する方向には動かさない（N-049）。 */
  const keyboardMove = async (id: string, direction: -1 | 1) => {
    const order = visible.map((mark) => mark.id)
    const from = order.indexOf(id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= order.length) return
    if (items.find((mark) => mark.id === order[to])?.isInherited) {
      setActionError('共有マークは、編集してこのアカウント専用にしてから並び替えてください')
      return
    }
    order.splice(to, 0, ...order.splice(from, 1))
    const visibleNext = order.map((i) => items.find((mark) => mark.id === i)).filter(Boolean) as MarkRow[]
    await applyOrder(mergeVisibleOrder(items, visibleNext, (mark) => mark.isInherited === true))
  }

  const openArchive = async (mark: MarkRow) => {
    const account = accountId
    if (!account) return
    const token = gateRef.current.begin()
    setPendingDelete(mark)
    setArchiveImpact(null)
    setReplacementMarkId('')
    setDeleteError('')
    setImpactLoading(true)
    try {
      const res = await api.supportMarks.archiveImpact(mark.id, account)
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setArchiveImpact(res.data)
      setReplacementMarkId(res.data.replacementOptions.find((option) => option.isDefault)?.id ?? res.data.replacementOptions[0]?.id ?? '')
    } catch {
      if (gateRef.current.current(token) && accountRef.current === account) {
        setDeleteError('保管の影響を確認できませんでした。画面を閉じて、もう一度お試しください。')
      }
    } finally {
      if (gateRef.current.current(token) && accountRef.current === account) setImpactLoading(false)
    }
  }

  const confirmRemove = async (mark: MarkRow) => {
    // R180: 0人のときは置換先なしで保管する。
    const replacement = (archiveImpact?.friendCount ?? 0) > 0 ? replacementMarkId : (replacementMarkId || null)
    if (!accountId || !archiveImpact || ((archiveImpact.friendCount ?? 0) > 0 && !replacementMarkId) || deleting) return
    setError('')
    setDeleteError('')
    setDeleting(true)
    try {
      const res = await api.supportMarks.archive(mark.id, accountId, {
        replacementMarkId: replacement,
        impactRevision: archiveImpact.impactRevision,
        expectedVersion: archiveImpact.expectedVersion,
      }, crypto.randomUUID())
      if (!res.success) throw new Error(res.error)
      setPendingDelete(null)
      setArchiveImpact(null)
      await load()
    } catch {
      setDeleteError('対応マークを保管できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  const rowMenuItems = (mark: MarkRow): ActionMenuItem[] => {
    const readonly = !canEdit
    const readonlyReason = '閲覧のみのため変更できません'
    return [
      { id: 'edit', label: '編集', external: true, disabled: readonly, disabledReason: readonly ? readonlyReason : undefined, onSelect: () => router.push(`/tags/marks/edit?id=${encodeURIComponent(mark.id)}`) },
      {
        id: 'archive',
        label: '保管する',
        tone: 'danger',
        dividerBefore: true,
        disabled: readonly || mark.isDefault || mark.isInherited,
        disabledReason: readonly
          ? readonlyReason
          : mark.isDefault
            ? '初期値のマークは保管できません。先に別のマークを初期値にしてください。'
            : mark.isInherited
              ? '共有マークは編集してこのアカウント専用にしてから保管できます'
              : undefined,
        onSelect: () => void openArchive(mark),
      },
    ]
  }

  /* 帯は v7 と同じ4つ。マークの種類は一覧そのものから数える。 */
  const listReady = status === 'ready'
  const inUseCount = items.filter(isUsed).length
  const statsReason = statsStatus === 'loading' ? STATE_TEXT.loading
    : statsStatus === 'forbidden' ? STATE_TEXT.forbiddenView
      : statsStatus === 'error' ? STATE_TEXT.error
        : null
  const inboxTotal = stats ? stats.marks.unanswered + stats.marks.inProgress + (stats.marks.onHold ?? 0) + stats.marks.resolved : 0
  const kpis = [
    { title: 'マークの種類', icon: TagIcon, value: listReady ? items.length : null, unit: '件', detail: listReady ? `使用中 ${inUseCount}件` : (status === 'forbidden' ? STATE_TEXT.forbiddenView : status === 'loading' ? STATE_TEXT.loading : STATE_TEXT.error) },
    {
      title: '未対応',
      icon: CircleDot,
      value: stats?.marks.unanswered ?? null,
      unit: '人',
      detail: statsReason ?? (inboxTotal > 0 ? `受信箱全体の ${Math.round((stats!.marks.unanswered / inboxTotal) * 1000) / 10}%` : '受信箱全体の —'),
    },
    { title: '対応中', icon: UserCheck, value: stats?.marks.inProgress ?? null, unit: '人', detail: statsReason ?? '担当者あり' },
    { title: '過去7日の変更', icon: History, value: stats?.marks.changedLast7 ?? null, unit: '回', detail: statsReason ?? '担当者別に記録' },
  ]

  const filterActive = Boolean(query || usage !== 'all')

  return (
    <>
      <div data-design="KPIs" className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.title} className={styles.kpi}>
            <span className={styles.kpiLabel}><kpi.icon size={13} aria-hidden="true" />{kpi.title}</span>
            <p className={styles.kpiValue}>{kpi.value ?? '—'}<span className={styles.kpiUnit}>{kpi.value === null ? '' : kpi.unit}</span></p>
            <p className={styles.kpiDetail}>{kpi.detail}</p>
          </div>
        ))}
      </div>

      <p className={styles.noteBand}>
        受信箱の対応状況（未対応・対応中・保留・対応済み）はトークごとの決まった状態です。ここの対応マークは友だちに付ける印で、受信箱・友だち一覧・友だち詳細で共通利用し、自動変更と初期値を同じ画面で設定します。
      </p>

      <div className={styles.listCol}>
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <SearchField
              aria-label="マーク名で検索"
              placeholder="マーク名で検索"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
            />
          </div>
          <Select
            aria-label="利用状態"
            value={usage}
            onChange={(value) => setUsage(value as typeof usage)}
            options={[
              { value: 'all', label: '利用状態：すべて' },
              { value: 'used', label: '使用中' },
              { value: 'unused', label: '未使用' },
            ]}
          />
        </div>

        {actionError ? (
          <p role="alert" className={styles.errorBand}>
            {actionError}
            {retryOrder ? (
              <button type="button" onClick={() => { const next = retryOrder; setRetryOrder(null); if (next) void applyOrder(next) }}>再試行</button>
            ) : (
              <button type="button" onClick={() => void load()}>読み直す</button>
            )}
          </p>
        ) : null}

        {status === 'forbidden' ? (
          <div className={styles.stateCard}>
            <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
              <AlertCircle size={20} aria-hidden="true" />
            </span>
            <p className={styles.stateTitle}>対応マークを見る権限がありません</p>
            <p className={styles.stateDesc}>オーナーか管理者に確認してください。</p>
          </div>
        ) : status === 'error' ? (
          <div className={styles.stateCard}>
            <span className={`${styles.stateIcon} ${styles.stateIconError}`}>
              <AlertCircle size={20} aria-hidden="true" />
            </span>
            <p className={styles.stateTitle}>対応マークを読み込めませんでした</p>
            <p className={styles.stateDesc}>{error || '再読み込みしてください。'}</p>
            <Button type="button" onClick={() => void load()}>もう一度試す</Button>
          </div>
        ) : items.length === 0 ? (
          <div className={styles.stateCard}>
            <span className={styles.stateIcon}>
              <TagIcon size={20} aria-hidden="true" />
            </span>
            <p className={styles.stateTitle}>まだ対応マークがありません</p>
            <p className={styles.stateDesc}>「＋ マークを作る」から最初のマークを作ってください。</p>
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>条件に合う対応マークはありません</p>
            <p className={styles.stateDesc}>検索語か利用状態を変えてください。</p>
            {filterActive ? (
              <Button type="button" onClick={() => { setQuery(''); setUsage('all') }}>条件を外す</Button>
            ) : null}
          </div>
        ) : (
          <DelayedSkeleton loading={status === 'loading'} skeleton={<TagRowsSkeleton rows={4} narrow={[120]} />}>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <TableHeadRow>
                    <Th style={{ width: 44 }}><span className="sr-only">並び替え</span></Th>
                    <Th>マーク</Th>
                    <Th>使用中</Th>
                    <Th>初期値</Th>
                    <Th>自動変更</Th>
                    <Th>表示先</Th>
                    <Th className={styles.menuCell}><span className="sr-only">操作</span></Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {pageItems.map((mark) => {
                    const editHref = `/tags/marks/edit?id=${encodeURIComponent(mark.id)}`
                    return (
                      <tr
                        key={mark.id}
                        className={styles.rowClick}
                        tabIndex={0}
                        onClick={() => router.push(editHref)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            router.push(editHref)
                          }
                        }}
                      >
                        <td
                          draggable={canEdit && !mark.isInherited}
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={() => setDragId(mark.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={() => void move(mark.id)}
                          className={styles.gripCell}
                          data-fixed={mark.isInherited || !canEdit}
                          title={mark.isInherited ? '共有マークは編集後に並び替えできます' : undefined}
                        >
                          <ReorderGrip
                            label={mark.name}
                            disabled={mark.isInherited || !canEdit}
                            disabledReason={mark.isInherited ? '共有マークは編集後に並び替えできます' : '閲覧のみのため並び替えできません'}
                            onMove={(direction) => void keyboardMove(mark.id, direction)}
                          />
                        </td>
                        <td>
                          <Link
                            href={editHref}
                            className={styles.markPill}
                            style={{ backgroundColor: `${mark.color}1A`, color: mark.color }}
                            title={mark.name}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span>{mark.name}</span>
                          </Link>
                        </td>
                        <td className={styles.cellText} style={{ fontVariantNumeric: 'tabular-nums' }}>{mark.friendCount}人</td>
                        <td className={styles.cellText}>{mark.isDefault ? '新着時の初期値' : '—'}</td>
                        <td className={styles.cellMuted}><span className={styles.cellTruncate} title={autoRuleLabel(mark)}>{autoRuleLabel(mark)}</span></td>
                        <td className={styles.cellMuted}><span className={styles.cellTruncate} title={usageLabel(mark)}>{usageLabel(mark)}</span></td>
                        <td className={styles.menuCell} onClick={(event) => event.stopPropagation()}>
                          {mark.isDefault || mark.isInherited ? (
                            <span
                              title={mark.isDefault ? '初期値のマークは保管できません' : '共有マークは編集後に保管できます'}
                              className="inline-flex text-ink-faint"
                            >
                              <LockKeyhole size={18} aria-label={mark.isDefault ? '初期値のため保管できません' : '共有マークのため保管できません'} />
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={styles.menuButton}
                                aria-label={`対応マーク「${mark.name}」の操作`}
                                aria-haspopup="menu"
                                aria-expanded={openMenuId === mark.id}
                                title={`対応マーク「${mark.name}」の操作`}
                                onClick={() => setOpenMenuId((current) => (current === mark.id ? null : mark.id))}
                              >
                                <MoreHorizontal size={16} aria-hidden="true" />
                              </button>
                              <ActionMenu
                                open={openMenuId === mark.id}
                                onClose={() => setOpenMenuId(null)}
                                ariaLabel={`対応マーク「${mark.name}」の操作`}
                                items={rowMenuItems(mark)}
                              />
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.pagerRow}>
              <span className={styles.pagerCount}>
                {visible.length}件中 {visible.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}〜{Math.min(currentPage * pageSize, visible.length)}件
              </span>
              <div className={styles.pagerRight}>
                <Select
                  aria-label="表示件数"
                  size="page-size"
                  value={String(pageSize)}
                  onChange={(value) => setPageSize(Number(value) || 20)}
                  options={[
                    { value: '20', label: '20件表示' },
                    { value: '50', label: '50件表示' },
                    { value: '100', label: '100件表示' },
                  ]}
                />
                <Pagination
                  page={currentPage}
                  pageCount={pages}
                  onPageChange={setPage}
                  ariaLabel="対応マークのページ送り"
                />
              </div>
            </div>

            {/* 表の下の段（安全確認の説明・v7 と同じ言葉）。 */}
            <section className={styles.safetyNote}>
              <h2 className={styles.safetyNoteTitle}>受信時自動変更・保管・初期値の安全確認</h2>
              <p className={styles.safetyNoteBody}>「受信時に変更」の設定は追加・編集画面で確認できます。保管時は影響人数と置き換え先を表示し、初期値は保管できません。</p>
            </section>
          </DelayedSkeleton>
        )}
      </div>

      {pendingDelete ? (
        <ArchiveMarkDialog
          mark={pendingDelete}
          impact={archiveImpact}
          replacementMarkId={replacementMarkId}
          loading={impactLoading}
          saving={deleting}
          error={deleteError}
          onReplacement={setReplacementMarkId}
          onCancel={() => { if (!deleting) { setPendingDelete(null); setArchiveImpact(null) } }}
          onConfirm={() => void confirmRemove(pendingDelete)}
        />
      ) : null}
    </>
  )
}
