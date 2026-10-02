'use client'

/*
 * ★V8-B 成果とアフィリエイト「案件」タブ（板 `h7dmB`）。
 * 左に案件グループ（フォルダ）の列、右に一覧。1152 ではフォルダを畳み、
 * 道具の1段目に選び器へ入れる（板 `KdFRI` の並び）。
 *
 * フォルダの割り当ては「成果が出たときの動き」（タグ・シナリオ・マイル）を
 * 見方として使う。案件そのものをフォルダに入れる口は API に無いので、
 * ここは読み取り専用の絞り込みとして作る（DEVIN-QUESTIONS に記録）。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, FileText, FolderOpen, Package } from 'lucide-react'
import { api, type AffiliateOffer, type ConversionApprovalItem } from '@/lib/api'
import type { LineAccount, Scenario, Tag } from '@line-crm/shared'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import Select from '@/components/shared/select'
import SearchField from '@/components/shared/search-field'
import FilterChip from '@/components/shared/filter-chip'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import { MoreAction } from '@/components/shared/row-actions'
import Pagination from '@/components/shared/pagination'
import {
  OFFER_PAGE_SIZES,
  OFFER_SORTS,
  offersCsv,
  pageCountOf,
  pageOf,
  selectOffers,
  type OfferFilter,
  type OfferSort,
} from './offer-list-view'
import { OfferFormModal, listAllConversionApprovals } from './tabs'
import OfferTermsDialog from './offer-terms'
import { confirmedThisMonth, confirmedTotals, confirmedValue, confirmedUnit, confirmedDetail, type ConfirmedState } from './offer-kpi'
import { KpiStrip, KpiCell, NoticeBar, EmptyState, ZeroResultState, LoadingRows, LoadError } from './v8-shared'
import styles from './list-v8.module.css'

function formatYen(n: number): string {
  return `¥${formatNumber(Math.round(n))}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** フォルダ列の見方。案件の「成果が出たときの動き」で分ける。 */
type FolderKey = 'all' | 'untagged' | 'tag' | 'scenario' | 'miles'

const FOLDERS: Array<{ key: FolderKey; label: string; match: (o: AffiliateOffer) => boolean }> = [
  { key: 'all', label: 'すべての案件', match: () => true },
  { key: 'tag', label: 'タグを付ける', match: (o) => Boolean(o.tagId) },
  { key: 'scenario', label: 'シナリオを始める', match: (o) => !o.tagId && Boolean(o.scenarioId) },
  { key: 'miles', label: 'マイルを付ける', match: (o) => !o.tagId && !o.scenarioId && o.rewardMiles > 0 },
  { key: 'untagged', label: '動きが未設定', match: (o) => !o.tagId && !o.scenarioId && o.rewardMiles === 0 },
]

export default function OffersTabV8({
  canEdit,
  registerHeaderActions,
}: {
  canEdit: boolean
  registerHeaderActions: (node: ReactNode) => void
}) {
  const [offers, setOffers] = useState<AffiliateOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<(Scenario & { stepCount?: number })[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AffiliateOffer | null>(null)
  const [termsTarget, setTermsTarget] = useState<AffiliateOffer | null>(null)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<OfferFilter[]>([])
  const [sort, setSort] = useState<OfferSort>('newest')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [folder, setFolder] = useState<FolderKey>('all')

  const [approvalItems, setApprovalItems] = useState<ConversionApprovalItem[]>([])
  const [confirmedState, setConfirmedState] = useState<ConfirmedState>('loading')
  const [confirmedTruncated, setConfirmedTruncated] = useState(false)

  const loadOffers = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await api.affiliateOffers.list()
      if (res.success && Array.isArray(res.data)) {
        setOffers(res.data)
      } else {
        setOffers([])
        setError(true)
      }
    } catch {
      setOffers([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const [accountsRes, tagsRes, scenariosRes] = await Promise.all([
        api.lineAccounts.list(),
        api.tags.list(),
        api.scenarios.list(),
      ])
      if (accountsRes.success && Array.isArray(accountsRes.data)) setAccounts(accountsRes.data as unknown as LineAccount[])
      if (tagsRes.success && Array.isArray(tagsRes.data)) setTags(tagsRes.data as unknown as Tag[])
      if (scenariosRes.success && Array.isArray(scenariosRes.data)) setScenarios(scenariosRes.data as unknown as (Scenario & { stepCount?: number })[])
    } catch { /* 名前が引けなくても一覧は出せる */ }
  }, [])

  useEffect(() => {
    void loadOffers()
    void loadOptions()
  }, [loadOffers, loadOptions])

  useEffect(() => {
    let cancelled = false
    setConfirmedState('loading')
    void Promise.all((['pending', 'approved', 'rejected'] as const).map((status) =>
      listAllConversionApprovals(status),
    )).then((results) => {
      if (cancelled) return
      setApprovalItems(results.flatMap((result) => result.items))
      setConfirmedTruncated(results.some((result) => result.truncated))
      setConfirmedState('ready')
    }).catch(() => {
      if (!cancelled) setConfirmedState('error')
    })
    return () => { cancelled = true }
  }, [])

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags])
  const scenarioMap = useMemo(() => new Map(scenarios.map((sc) => [sc.id, sc.name])), [scenarios])

  const foldered = useMemo(
    () => offers.filter(FOLDERS.find((f) => f.key === folder)?.match ?? (() => true)),
    [offers, folder],
  )
  const shown = useMemo(
    () => selectOffers(foldered, { filters, query, sort }),
    [foldered, filters, query, sort],
  )

  const pageCount = pageCountOf(shown.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const paged = pageOf(shown, currentPage, pageSize)

  // KPI（板 `h7dmB`：案件・今月の成果・支払い予定・付与予定マイル）
  const approvedThisMonth = confirmedThisMonth(approvalItems)
  const approvedTotals = confirmedTotals(approvedThisMonth)

  const offerStats = useMemo(() => {
    const result = new Map<string, { introducerIds: Set<string>; conversions: number; reward: number }>()
    for (const item of approvalItems) {
      if (!item.offerId || item.approvalStatus === 'rejected') continue
      const current = result.get(item.offerId) ?? { introducerIds: new Set<string>(), conversions: 0, reward: 0 }
      current.introducerIds.add(item.affiliateId)
      current.conversions += 1
      if (item.approvalStatus === 'approved') current.reward += item.value ?? 0
      result.set(item.offerId, current)
    }
    return new Map([...result].map(([id, value]) => [id, {
      introducers: value.introducerIds.size,
      conversions: value.conversions,
      reward: value.reward,
    }]))
  }, [approvalItems])

  const exportCsv = useCallback(() => {
    const csv = offersCsv(shown, {
      account: (id) => accountMap.get(id),
      tag: (id) => tagMap.get(id),
      scenario: (id) => scenarioMap.get(id),
      date: formatDate,
    })
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `affiliate-offers-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [shown, accountMap, tagMap, scenarioMap])

  useEffect(() => {
    registerHeaderActions(
      <Button key="csv" type="button" onClick={exportCsv} disabled={shown.length === 0}>
        <Download size={15} aria-hidden="true" /> CSV で書き出す
      </Button>,
    )
    return () => registerHeaderActions(null)
  }, [registerHeaderActions, exportCsv, shown.length])

  const unsetActionCount = offers.filter((o) => !o.tagId && !o.scenarioId && o.rewardMiles === 0).length
  const listState = error ? 'error' : loading ? 'loading' : offers.length === 0 ? 'empty' : shown.length === 0 ? 'zero' : 'ready'

  const resetConditions = () => {
    setQuery('')
    setFilters([])
    setFolder('all')
    setPage(1)
  }

  const actionText = (offer: AffiliateOffer) => {
    if (offer.tagId) return `タグ「${tagMap.get(offer.tagId) ?? '名前を確認できません'}」を付ける`
    if (offer.scenarioId) return `シナリオ「${scenarioMap.get(offer.scenarioId) ?? '名前を確認できません'}」を始める`
    if (offer.rewardMiles > 0) return `${formatNumber(offer.rewardMiles)}マイルを付ける`
    return '何も設定されていません'
  }

  return (
    <>
      <KpiStrip>
        <KpiCell
          icon={<Package size={14} aria-hidden="true" />}
          label="案件"
          value={listState === 'error' || (loading && offers.length === 0) ? null : offers.length}
          unit="件"
          sub={listState === 'error' ? '読み込めませんでした' : `公開中 ${formatNumber(offers.filter((o) => o.isActive).length)}・停止・終了 ${formatNumber(offers.filter((o) => !o.isActive).length)}`}
          info="アフィリエイターに紹介してもらう内容です。公開中の案件だけが紹介リンクに出ます。"
        />
        <KpiCell
          label="今月の成果"
          value={confirmedValue(confirmedState, approvedTotals.count)}
          unit={confirmedUnit(confirmedState, '件')}
          sub={confirmedDetail(confirmedState, confirmedTruncated ? '今月に認めた成果（直近の分まで）' : '今月に認めた成果')}
          info="今月（日本時間）に起きて、認めるまで済んだ成果の数です。承認待ちは含みません。"
        />
        <KpiCell
          label="支払い予定"
          value={confirmedValue(confirmedState, approvedTotals.yen)}
          unit={confirmedUnit(confirmedState, '円')}
          sub={confirmedDetail(confirmedState, '認めた成果の金額の合計')}
          info="今月に認めた成果の金額を足したものです。承認待ちは金額が確定していないので入れていません。"
        />
        <KpiCell
          label="付与予定マイル"
          value={confirmedValue(confirmedState, approvedTotals.miles)}
          unit={confirmedUnit(confirmedState, 'マイル')}
          sub={confirmedDetail(confirmedState, '認めた成果に結ぶ分')}
          info="今月に認めた成果に結びついたマイルの合計です。案件に結びつかない成果にはマイルが付きません。"
        />
      </KpiStrip>

      {unsetActionCount > 0 && listState !== 'error' ? (
        <NoticeBar tone="warn">
          成果が出ても何も起きない案件が{formatNumber(unsetActionCount)}件あります。行の「…」→「決まり」で、成果が出たときの動きを決めてください。
        </NoticeBar>
      ) : null}

      {/* フォルダ列＋一覧。板 h7dmB：左にグループ、右に表。 */}
      <div className={styles.listBody}>
        <nav aria-label="案件のグループ" className={styles.folderCol}>
          {/* 板 `h7dmB`：作るボタンはフォルダ列のいちばん上 */}
          <Button
            type="button"
            variant="primary"
            onClick={() => { setEditTarget(null); setFormOpen(true) }}
            disabled={!canEdit}
            title={canEdit ? undefined : '閲覧のみのため変更できません'}
          >
            <FileText size={15} aria-hidden="true" /> 案件を作る
          </Button>
          <p className={styles.folderColTitle} style={{ marginTop: 12 }}>
            案件のグループ
          </p>
          {FOLDERS.map((f) => {
            const count = offers.filter(f.match).length
            const active = folder === f.key
            return (
              <button
                key={f.key}
                type="button"
                className={`${styles.folderItem} ${active ? styles.folderItemActive : ''}`}
                onClick={() => { setFolder(f.key); setPage(1) }}
                aria-current={active ? 'true' : undefined}
              >
                <FolderOpen size={14} aria-hidden="true" className={styles.folderItemIcon} />
                <span className={styles.folderItemLabel}>{f.label}</span>
                <span className={styles.folderItemCount}>{formatNumber(count)}</span>
              </button>
            )
          })}
          {/* 案件をフォルダへ入れる口は API に無いので、動きの有無で自動で分けて
              いることを書く（押せない「追加」は置かない）。 */}
          <p className={styles.footNote} style={{ padding: '8px 0 0' }}>
            成果が出たときの動き（タグ・シナリオ・マイル）で自動で分けています
          </p>
        </nav>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.tools} style={{ padding: '0 0 14px' }}>
            {/* 1152 ではフォルダ列を畳むので、作るボタンは道具の1段目の左へ（板 `KdFRI`） */}
            <span className={styles.toolsCreate}>
              <Button
                type="button"
                variant="primary"
                onClick={() => { setEditTarget(null); setFormOpen(true) }}
                disabled={!canEdit}
                title={canEdit ? undefined : '閲覧のみのため変更できません'}
              >
                <FileText size={15} aria-hidden="true" /> 案件を作る
              </Button>
            </span>
            <span className={styles.folderSelect}>
              <Select
                aria-label="案件のグループ"
                value={folder}
                options={FOLDERS.map((f) => ({ value: f.key, label: f.label }))}
                onChange={(value) => { setFolder(value as FolderKey); setPage(1) }}
              />
            </span>
            <SearchField
              placeholder="案件名・説明で探す"
              aria-label="案件名・説明で探す"
              value={query}
              onChange={(value) => { setQuery(value); setPage(1) }}
              onClear={() => { setQuery(''); setPage(1) }}
              className={styles.toolsSearch}
            />
            <FilterChip
              selected={filters.includes('open')}
              onChange={(on) => {
                setFilters((cur) => (on ? [...cur, 'open'] : cur.filter((v) => v !== 'open')))
                setPage(1)
              }}
              count={listState === 'error' ? undefined : formatNumber(offers.filter((o) => o.isActive).length)}
            >
              公開中
            </FilterChip>
            <FilterChip
              selected={filters.includes('hasMiles')}
              onChange={(on) => {
                setFilters((cur) => (on ? [...cur, 'hasMiles'] : cur.filter((v) => v !== 'hasMiles')))
                setPage(1)
              }}
              count={listState === 'error' ? undefined : formatNumber(offers.filter((o) => o.rewardMiles > 0).length)}
            >
              マイルあり
            </FilterChip>
            <span className={styles.toolsSpacer} />
            <Select
              aria-label="並び順"
              value={sort}
              options={OFFER_SORTS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(value) => { setSort(value as OfferSort); setPage(1) }}
            />
            <Select
              aria-label="表示件数"
              value={String(pageSize)}
              options={OFFER_PAGE_SIZES.map((n) => ({ value: String(n), label: `${n}件表示` }))}
              onChange={(value) => { setPageSize(Number(value)); setPage(1) }}
              size="page-size"
            />
          </div>

          {listState === 'error' ? (
            <div style={{ marginLeft: -24, marginRight: -24 }}>
              <LoadError name="案件" onRetry={() => { void loadOffers() }} />
            </div>
          ) : listState === 'loading' ? (
            <div style={{ marginLeft: -24, marginRight: -24 }}>
              <LoadingRows />
            </div>
          ) : listState === 'empty' ? (
            <div style={{ marginLeft: -24, marginRight: -24 }}>
              <EmptyState
                icon={<Package size={20} aria-hidden="true" />}
                title="まだ案件はありません"
                description="何をしたら成果になり、いくら払うかを決めると、アフィリエイターが紹介できるようになります。"
                action={(
                  <Button type="button" variant="primary" onClick={() => { setEditTarget(null); setFormOpen(true) }} disabled={!canEdit}>
                    <FileText size={15} aria-hidden="true" /> 案件を作る
                  </Button>
                )}
              />
            </div>
          ) : listState === 'zero' ? (
            <div style={{ marginLeft: -24, marginRight: -24 }}>
              <ZeroResultState onReset={resetConditions} />
            </div>
          ) : (
            <div className={styles.tableWrap} style={{ margin: 0 }}>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>案件</th>
                      <th className={styles.numRight}>報酬</th>
                      <th>成果が出たときの動き</th>
                      <th className={styles.numRight}>紹介している人</th>
                      <th className={styles.numRight}>成果</th>
                      <th className={styles.numRight}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((offer) => (
                      <tr key={offer.id}>
                        <td>
                          <span className={styles.cellMain} style={{ fontWeight: 600, color: 'var(--color-accent-deep)', maxWidth: 220 }} title={offer.name}>
                            {offer.name}
                          </span>
                          <span className={styles.cellSub} style={{ maxWidth: 220 }} title={offer.description ?? undefined}>
                            {offer.description ?? '説明はありません'}
                          </span>
                          <span className={`${styles.statusBadge} ${offer.isActive ? styles.statusOk : styles.statusNeutral}`}>
                            <span className={styles.statusDot} aria-hidden="true" />
                            {offer.isActive ? '公開中' : '停止・終了'}
                          </span>
                        </td>
                        <td className={styles.numRight}>
                          <strong>{offer.rewardAmount != null ? formatYen(offer.rewardAmount) : '—'}</strong>
                          {offer.rewardMiles > 0 ? (
                            <span className={styles.cellSub}>＋{formatNumber(offer.rewardMiles)}マイル</span>
                          ) : null}
                        </td>
                        <td>
                          <span className={styles.cellMain} style={{ color: offer.tagId || offer.scenarioId || offer.rewardMiles > 0 ? 'var(--color-ink-secondary)' : 'var(--color-warning)' }}>
                            {actionText(offer)}
                          </span>
                        </td>
                        <td className={styles.numRight}>{formatNumber(offerStats.get(offer.id)?.introducers ?? 0)}人</td>
                        <td className={styles.numRight}>
                          <strong>{formatNumber(offerStats.get(offer.id)?.conversions ?? 0)}件</strong>
                          <span className={styles.cellSub}>確定 {formatYen(offerStats.get(offer.id)?.reward ?? 0)}</span>
                        </td>
                        <td>
                          <div className={styles.rowActions}>
                            <span style={{ position: 'relative', display: 'inline-flex' }}>
                              <MoreAction
                                label={`${offer.name}のその他操作`}
                                aria-expanded={rowMenuId === offer.id}
                                onClick={() => setRowMenuId((cur) => (cur === offer.id ? null : offer.id))}
                              />
                              <ActionMenu
                                open={rowMenuId === offer.id}
                                ariaLabel={`${offer.name}の操作`}
                                onClose={() => setRowMenuId(null)}
                                items={([
                                  {
                                    id: 'edit',
                                    label: '編集',
                                    onSelect: () => { setEditTarget(offer); setFormOpen(true) },
                                    disabled: !canEdit,
                                    disabledReason: !canEdit ? '閲覧のみのため変更できません' : undefined,
                                  },
                                  {
                                    id: 'terms',
                                    label: '決まり',
                                    onSelect: () => setTermsTarget(offer),
                                  },
                                ] satisfies ActionMenuItem[])}
                              />
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {listState === 'ready' ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 12 }}>
              <p className={styles.footNote} style={{ padding: 0 }}>
                {shown.length === offers.length ? `全 ${formatNumber(offers.length)}件` : `${formatNumber(shown.length)}件 / 全 ${formatNumber(offers.length)}件`}
              </p>
              {pageCount > 1 ? <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} /> : null}
            </div>
          ) : null}
        </div>
      </div>

      <p className={styles.footNote}>
        行の「…」から 編集・決まり。案件は「何をしたら成果になり、いくら払うか」の組み合わせです。成果が出たときのタグ付け・シナリオ開始・マイル付与は、案件ごとに決めます。
      </p>

      {formOpen ? (
        <OfferFormModal
          initial={editTarget}
          accounts={accounts}
          tags={tags}
          scenarios={scenarios}
          onClose={() => setFormOpen(false)}
          onSaved={() => { void loadOffers() }}
        />
      ) : null}

      {termsTarget ? (
        <OfferTermsDialog offer={termsTarget} onClose={() => setTermsTarget(null)} />
      ) : null}
    </>
  )
}
