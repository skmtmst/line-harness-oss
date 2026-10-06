'use client'

/*
 * ★V8 成果とアフィリエイト「案件」（板 `h7dmB`）。
 *
 * app/affiliates/v8-offers-tab.tsx から動きを写し、見た目を一覧の型（ListPage）で
 * 組み直した。データの口は今と同じ（案件・アカウント・タグ・シナリオの名前・承認の全件）。
 * 行の「…」は 編集・決まり・公開を止める（公開する）・複製。複製は下書きで作る。
 *
 * フォルダの列：案件をフォルダへ入れる口は無いので、成果が出たときの動き
 * （タグ・シナリオ・マイル）で分けた見え方の切り替えとして持つ（保存しない）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CircleDot, Coins, Download, FilePen, Plus, Trophy, Briefcase } from 'lucide-react'
import type { LineAccount, Scenario, Tag } from '@line-crm/shared'
import { api, type AffiliateOffer, type ConversionApprovalItem } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel from '@/components/shared/folder-panel'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { ListPagePagination } from '@/components/templates'
import {
  currentSettlementPeriod,
  deltaText,
  downloadCsv,
  formatDate,
  formatYen,
  jstMonthKey,
  listAllConversionApprovals,
  pageCountOf,
  pageOf,
  previousSettlementPeriod,
} from './display'
import { AffiliateFrame, CreateButton, useAffiliateShell } from './frame'
import OfferFormModal from './offer-form'
import OfferTermsDialog from './offer-terms'
import {
  AffiliateToolbar,
  PerPageSelect,
  RetryButton,
  RowMenu,
  SavedSelect,
  StateCard,
  StatusPill,
  ToolbarNotices,
} from './parts'
import styles from './affiliates.module.css'

type FilterKey = 'open' | 'draft'
type FolderKey = 'all' | 'tag' | 'scenario' | 'miles' | 'none'
type LoadState = 'loading' | 'ready' | 'error'

const FOLDERS: Array<{ key: FolderKey; label: string; match: (o: AffiliateOffer) => boolean }> = [
  { key: 'all', label: 'すべて', match: () => true },
  { key: 'tag', label: 'タグを付ける', match: (o) => Boolean(o.tagId) },
  { key: 'scenario', label: 'シナリオを始める', match: (o) => !o.tagId && Boolean(o.scenarioId) },
  { key: 'miles', label: 'マイルを渡す', match: (o) => !o.tagId && !o.scenarioId && o.rewardMiles > 0 },
  { key: 'none', label: '動きが未設定', match: (o) => !o.tagId && !o.scenarioId && o.rewardMiles === 0 },
]

const SAVED_VIEWS: Array<{ value: string; label: string; filters: FilterKey[]; sort: 'newest' | 'name' | 'reward'; folder?: FolderKey }> = [
  { value: '', label: 'よく使う絞り込み', filters: [], sort: 'newest' },
  { value: 'open-reward', label: '公開中・報酬が高い順', filters: ['open'], sort: 'reward' },
  { value: 'draft', label: '下書きだけ', filters: ['draft'], sort: 'newest' },
  { value: 'miles', label: 'マイルを渡す案件', filters: [], sort: 'newest', folder: 'miles' },
  { value: 'name', label: '案件名の順', filters: [], sort: 'name' },
]

export default function OffersTab() {
  const { readonly, narrow, setCount } = useAffiliateShell()
  const settlementPeriod = useMemo(() => currentSettlementPeriod(), [])

  const [offers, setOffers] = useState<AffiliateOffer[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<(Scenario & { stepCount?: number })[]>([])
  const [approvals, setApprovals] = useState<ConversionApprovalItem[]>([])
  const [approvalState, setApprovalState] = useState<LoadState>('loading')
  const [monthly, setMonthly] = useState<{ count: number; delta: number | null } | null>(null)
  const [monthlyState, setMonthlyState] = useState<LoadState>('loading')

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<FilterKey[]>([])
  const [folder, setFolder] = useState<FolderKey>('all')
  const [sort, setSort] = useState<'newest' | 'name' | 'reward'>('newest')
  const [saved, setSaved] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AffiliateOffer | null>(null)
  const [termsTarget, setTermsTarget] = useState<AffiliateOffer | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadOffers = useCallback(async () => {
    setLoadState('loading')
    try {
      const res = await api.affiliateOffers.list()
      if (!mounted.current) return
      if (res.success && Array.isArray(res.data)) {
        setOffers(res.data)
        setLoadState('ready')
      } else {
        setOffers([])
        setLoadState('error')
      }
    } catch {
      if (!mounted.current) return
      setOffers([])
      setLoadState('error')
    }
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const [accountsRes, tagsRes, scenariosRes] = await Promise.all([api.lineAccounts.list(), api.tags.list(), api.scenarios.list()])
      if (!mounted.current) return
      if (accountsRes.success && Array.isArray(accountsRes.data)) setAccounts(accountsRes.data as unknown as LineAccount[])
      if (tagsRes.success && Array.isArray(tagsRes.data)) setTags(tagsRes.data as unknown as Tag[])
      if (scenariosRes.success && Array.isArray(scenariosRes.data)) setScenarios(scenariosRes.data as unknown as (Scenario & { stepCount?: number })[])
    } catch { /* 名前が引けなくても一覧は出せる */ }
  }, [])

  const loadApprovals = useCallback(async () => {
    setApprovalState('loading')
    try {
      const results = await Promise.all((['pending', 'approved'] as const).map((status) => listAllConversionApprovals(status)))
      if (!mounted.current) return
      setApprovals(results.flatMap((result) => result.items))
      setApprovalState('ready')
    } catch {
      if (mounted.current) setApprovalState('error')
    }
  }, [])

  const loadMonthly = useCallback(async () => {
    setMonthlyState('loading')
    try {
      const prev = previousSettlementPeriod(settlementPeriod.periodFrom)
      const [res, prevRes] = await Promise.all([
        api.affiliates.allReport({ startDate: settlementPeriod.periodFrom, endDate: settlementPeriod.periodTo }),
        api.affiliates.allReport({ startDate: prev.periodFrom, endDate: prev.periodTo }),
      ])
      if (!res.success) throw new Error('monthly report failed')
      const total = (arr: unknown) => (arr as Array<{ totalConversions: number }>).reduce((sum, row) => sum + row.totalConversions, 0)
      const current = total(res.data)
      if (!mounted.current) return
      setMonthly({ count: current, delta: prevRes.success ? current - total(prevRes.data) : null })
      setMonthlyState('ready')
    } catch {
      if (mounted.current) setMonthlyState('error')
    }
  }, [settlementPeriod])

  useEffect(() => {
    void loadOffers()
    void loadOptions()
    void loadApprovals()
    void loadMonthly()
  }, [loadOffers, loadOptions, loadApprovals, loadMonthly])

  useEffect(() => {
    if (loadState === 'ready') setCount('offers', formatNumber(offers.length))
  }, [loadState, offers.length, setCount])

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags])
  const scenarioMap = useMemo(() => new Map(scenarios.map((sc) => [sc.id, sc.name])), [scenarios])
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])

  /* 案件ごとの 紹介している人・成果・確定した報酬（認めた成果の金額）。 */
  const offerStats = useMemo(() => {
    const result = new Map<string, { people: Set<string>; conversions: number; reward: number }>()
    for (const item of approvals) {
      if (!item.offerId) continue
      const current = result.get(item.offerId) ?? { people: new Set<string>(), conversions: 0, reward: 0 }
      current.people.add(item.affiliateId)
      current.conversions += 1
      if (item.approvalStatus === 'approved') current.reward += item.value ?? 0
      result.set(item.offerId, current)
    }
    return result
  }, [approvals])

  const approvedThisMonth = useMemo(() => {
    const month = jstMonthKey()
    return approvals.filter((item) => item.approvalStatus === 'approved' && jstMonthKey(item.createdAt) === month)
  }, [approvals])
  const averageReward = approvedThisMonth.length > 0
    ? Math.round(approvedThisMonth.reduce((sum, item) => sum + (item.value ?? 0), 0) / approvedThisMonth.length)
    : null

  const foldered = useMemo(() => offers.filter(FOLDERS.find((f) => f.key === folder)?.match ?? (() => true)), [offers, folder])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return foldered
      .filter((offer) => {
        if (filters.includes('open') && !offer.isActive) return false
        if (filters.includes('draft') && offer.isActive) return false
        if (needle && !`${offer.name} ${offer.description ?? ''}`.toLowerCase().includes(needle)) return false
        return true
      })
      .toSorted((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'ja')
        if (sort === 'reward') return (b.rewardAmount ?? 0) - (a.rewardAmount ?? 0)
        return b.createdAt.localeCompare(a.createdAt)
      })
  }, [filters, foldered, query, sort])

  const pageCount = pageCountOf(shown.length, pageSize)
  const currentPage = Math.min(page, pageCount)
  const paged = pageOf(shown, currentPage, pageSize)
  const ready = loadState === 'ready'
  const openCount = offers.filter((o) => o.isActive).length
  const draftCount = offers.length - openCount
  const milesCount = offers.filter((o) => o.rewardMiles > 0).length

  const resetPage = (change: () => void) => { change(); setPage(1) }
  const resetConditions = () => {
    setQuery('')
    setFilters([])
    setFolder('all')
    setSaved('')
    setPage(1)
  }
  const toggleFilter = (key: FilterKey, on: boolean) => resetPage(() => {
    setSaved('')
    setFilters((cur) => (on ? [...cur, key] : cur.filter((value) => value !== key)))
  })

  const rewardText = (offer: AffiliateOffer) => (offer.rewardAmount && offer.rewardAmount > 0 ? `1件ごと ${formatYen(offer.rewardAmount)}` : '報酬なし')
  const actionText = (offer: AffiliateOffer) => {
    if (offer.tagId) return `タグ「${tagMap.get(offer.tagId) ?? '名前を確認できません'}」を付ける`
    if (offer.scenarioId) return `シナリオ「${scenarioMap.get(offer.scenarioId) ?? '名前を確認できません'}」を始める`
    if (offer.rewardMiles > 0) return `マイル ${formatNumber(offer.rewardMiles)} を渡す`
    return '—'
  }

  const togglePublish = async (offer: AffiliateOffer) => {
    setBusyId(offer.id)
    try {
      const res = await api.affiliateOffers.update(offer.id, { isActive: !offer.isActive })
      if (!res.success) throw new Error('update failed')
      notifyToast(offer.isActive ? `「${offer.name}」の公開を止めました。紹介リンクに出なくなります。` : `「${offer.name}」を公開しました。`)
      void loadOffers()
    } catch {
      notifyToast('変えられませんでした。もう一度お試しください。')
    } finally {
      setBusyId(null)
    }
  }

  const duplicate = async (offer: AffiliateOffer) => {
    setBusyId(offer.id)
    try {
      const res = await api.affiliateOffers.create({
        name: `${offer.name}（コピー）`,
        description: offer.description,
        rewardAmount: offer.rewardAmount ?? 0,
        rewardMiles: offer.rewardMiles,
        lineAccountId: offer.lineAccountId,
        tagId: offer.tagId,
        scenarioId: offer.scenarioId,
        isActive: false,
        operationId: crypto.randomUUID(),
      })
      if (!res.success) throw new Error('create failed')
      notifyToast(`「${offer.name}」を下書きで複製しました。`)
      void loadOffers()
    } catch {
      notifyToast('複製できませんでした。もう一度お試しください。')
    } finally {
      setBusyId(null)
    }
  }

  const exportCsv = () => {
    downloadCsv(`affiliate-offers-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['案件名', '説明', '報酬（円）', 'マイル', '対象アカウント', '成果時のタグ', '開始するシナリオ', '状態', '作成日'],
      ...shown.map((offer) => [
        offer.name,
        offer.description ?? '',
        offer.rewardAmount ?? '',
        offer.rewardMiles,
        offer.lineAccountId ? accountMap.get(offer.lineAccountId) ?? '—（名前を確認できません）' : '',
        offer.tagId ? tagMap.get(offer.tagId) ?? '—（名前を確認できません）' : '',
        offer.scenarioId ? scenarioMap.get(offer.scenarioId) ?? '—（名前を確認できません）' : '',
        offer.isActive ? '公開中' : '下書き',
        formatDate(offer.createdAt),
      ]),
    ])
  }

  const openCreate = () => { setEditTarget(null); setFormOpen(true) }

  const loadingWord = '読み込んでいます'
  const errorWord = '読み込めませんでした'
  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="案件"
        icon={<Briefcase size={14} aria-hidden="true" />}
        value={ready ? offers.length : null}
        unit="件"
        detail={ready ? `公開中 ${formatNumber(openCount)}・下書き ${formatNumber(draftCount)}` : loadState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="今月の成果"
        icon={<Trophy size={14} aria-hidden="true" />}
        value={monthlyState === 'ready' && monthly ? monthly.count : null}
        unit="件"
        detail={monthlyState === 'ready' && monthly ? deltaText(monthly.delta) : monthlyState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="平均報酬"
        icon={<Banknote size={14} aria-hidden="true" />}
        value={null}
        valueText={approvalState === 'ready' && averageReward != null ? formatYen(averageReward) : '—'}
        unit=""
        detail={approvalState === 'ready' ? (averageReward == null ? '今月はまだ認めた成果がありません' : '1件あたり') : approvalState === 'loading' ? loadingWord : errorWord}
      />
      <KpiCard
        presentation="band"
        title="マイルあり"
        icon={<Coins size={14} aria-hidden="true" />}
        value={ready ? milesCount : null}
        unit="件"
        detail={ready ? '成果でマイルも付く' : loadState === 'loading' ? loadingWord : errorWord}
      />
    </KpiBand>
  )

  const createButton = (full: boolean) => (
    <CreateButton onClick={openCreate} readonly={readonly} full={full}>
      <Plus size={15} aria-hidden="true" /> 案件を作る
    </CreateButton>
  )

  const folderPanel = (
    <FolderPanel
      heading="フォルダ"
      rows={FOLDERS.map((item) => ({ id: item.key, label: item.label, count: ready ? offers.filter(item.match).length : null }))}
      activeId={folder}
      onSelect={(id) => resetPage(() => { setSaved(''); setFolder(id as FolderKey) })}
      addFolderNote={<p className={styles.stateDesc}>成果が出たときの動きで分けた見え方です</p>}
    />
  )

  const folderSelect = (
    <div className={styles.narrowFolder}>
      <Select
        aria-label="フォルダ"
        value={folder}
        options={FOLDERS.map((item) => ({ value: item.key, label: `フォルダ：${item.label}` }))}
        onChange={(value) => resetPage(() => setFolder(value as FolderKey))}
      />
    </div>
  )

  const chips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip selected={filters.includes('open')} icon={<CircleDot size={13} aria-hidden="true" />} onChange={(on) => toggleFilter('open', on)}>
        {ready ? `公開中 ${formatNumber(openCount)}` : '公開中'}
      </FilterChip>
      <FilterChip selected={filters.includes('draft')} icon={<FilePen size={13} aria-hidden="true" />} onChange={(on) => toggleFilter('draft', on)}>
        {ready ? `下書き ${formatNumber(draftCount)}` : '下書き'}
      </FilterChip>
    </div>
  )

  const trailing = (
    <>
      <SavedSelect
        value={saved}
        options={SAVED_VIEWS.map((view) => ({ value: view.value, label: view.label }))}
        onChange={(value) => {
          const view = SAVED_VIEWS.find((v) => v.value === value)
          if (!view) return
          resetPage(() => {
            setSaved(value)
            setFilters([...view.filters])
            setSort(view.sort)
            setFolder(view.folder ?? 'all')
          })
        }}
      />
      <PerPageSelect value={pageSize} onChange={(value) => resetPage(() => setPageSize(value))} />
    </>
  )

  const toolbar = (
    <AffiliateToolbar
      narrow={narrow}
      notices={<ToolbarNotices info="アフィリエイターは「紹介する人」、案件は「何を紹介すると、いくら払うか」の決まりです。1人のアフィリエイターが、いくつもの案件を紹介できます。" />}
      search={{ placeholder: '案件名・説明で探す', value: query, onChange: (value) => resetPage(() => setQuery(value)) }}
      chips={chips}
      trailing={trailing}
      narrowLead={<>{createButton(false)}{folderSelect}</>}
    />
  )

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={`${styles.table} ${styles.tableOffers}`}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>案件</Th>
            <Th className={styles.colOfferReward}>報酬</Th>
            <Th className={styles.colOfferAction}>成果が出たときの動き</Th>
            <Th className={`${styles.colOfferPeople} ${styles.num}`}>紹介している人</Th>
            <Th className={`${styles.colOfferConv} ${styles.num}`}>成果</Th>
            <Th className={styles.colOfferOps}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {paged.map((offer) => {
            const stat = offerStats.get(offer.id)
            return (
              <Tr key={offer.id} className={styles.row} data-table-layout="columns">
                <Td className={styles.colName}>
                  <span className={styles.stack}>
                    {readonly ? (
                      <span className={styles.rowNameText} title={offer.name}>{offer.name}</span>
                    ) : (
                      <button type="button" className={styles.rowName} title={offer.name} onClick={() => { setEditTarget(offer); setFormOpen(true) }}>{offer.name}</button>
                    )}
                    <span className={styles.rowPlan} title={offer.description ?? undefined}>{offer.description ?? '説明はありません'}</span>
                  </span>
                </Td>
                <Td className={styles.colOfferReward}>
                  <span className={styles.stack}>
                    <span className={styles.cellNum}>{rewardText(offer)}</span>
                    {offer.rewardMiles > 0 ? <span className={styles.rowPlan}>{`＋${formatNumber(offer.rewardMiles)}マイル`}</span> : null}
                  </span>
                </Td>
                <Td className={styles.colOfferAction}>
                  <span className={styles.cellNum} title={actionText(offer)}>{actionText(offer)}</span>
                </Td>
                <Td className={`${styles.colOfferPeople} ${styles.num}`}>
                  <span className={styles.cellNum}>{approvalState === 'ready' ? `${formatNumber(stat?.people.size ?? 0)}人` : '—'}</span>
                </Td>
                <Td className={`${styles.colOfferConv} ${styles.num}`}>
                  <span className={styles.stackEnd}>
                    <span className={styles.cellNum}>{approvalState === 'ready' ? (stat ? `${formatNumber(stat.conversions)}件` : '—') : '—'}</span>
                    {stat ? <span className={styles.rowPlan}>{`確定 ${formatYen(stat.reward)}`}</span> : null}
                  </span>
                </Td>
                <Td className={styles.colOfferOps}>
                  <span className={styles.rowActions}>
                    {readonly ? null : (
                      <Button type="button" onClick={() => { setEditTarget(offer); setFormOpen(true) }}>編集</Button>
                    )}
                    <StatusPill tone={offer.isActive ? 'active' : 'neutral'}>{offer.isActive ? '公開中' : '下書き'}</StatusPill>
                    <RowMenu
                      label={`${offer.name}の操作`}
                      items={[
                        ...(readonly ? [] : [{ id: 'edit', label: '編集', onSelect: () => { setEditTarget(offer); setFormOpen(true) } }]),
                        { id: 'terms', label: '決まり（受付期間・上限・数える期間）', onSelect: () => setTermsTarget(offer) },
                        ...(readonly ? [] : [
                          { id: 'publish', label: offer.isActive ? '公開を止める' : '公開する', disabled: busyId !== null, disabledReason: 'ほかの操作を反映しています', onSelect: () => { void togglePublish(offer) } },
                          { id: 'duplicate', label: '複製（下書きで作る）', disabled: busyId !== null, disabledReason: 'ほかの操作を反映しています', onSelect: () => { void duplicate(offer) } },
                        ]),
                      ]}
                    />
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const body = loadState === 'loading' ? (
    <ListState kind="loading" title="案件を読み込んでいます" />
  ) : loadState === 'error' ? (
    <StateCard tone="error" title="案件を読み込めませんでした" description="数の帯は「—」にしています。道具はそのまま使えます。" action={<RetryButton onRetry={() => { void loadOffers() }} />} />
  ) : offers.length === 0 ? (
    <StateCard
      icon={<Briefcase size={16} aria-hidden="true" />}
      title="まだ案件はありません"
      description="何をしたら成果になり、いくら払うかを決めると、アフィリエイターが紹介できるようになります"
      action={readonly ? undefined : <Button variant="primary" onClick={openCreate}><Plus size={14} aria-hidden="true" /> 案件を作る</Button>}
    />
  ) : shown.length === 0 ? (
    <StateCard title="条件に合うものはありません" description="検索や絞り込みを外すと、すべて出ます" action={<Button type="button" onClick={resetConditions}>条件を外す</Button>} />
  ) : (
    <>
      {table}
      <p className={styles.footNote}>
        {readonly ? '行の「…」から 決まり（受付期間・上限・数える期間）を見る。' : '行の「…」から 編集・決まり・公開を止める・複製。'}
      </p>
    </>
  )

  const pager = ready && shown.length > 0 && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>{`${formatNumber(shown.length)}件中 ${(currentPage - 1) * pageSize + 1}〜${Math.min(currentPage * pageSize, shown.length)}件`}</span>
      <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
    </ListPagePagination>
  ) : undefined

  return (
    <AffiliateFrame
      actions={<Button onClick={exportCsv} disabled={shown.length === 0}><Download size={15} aria-hidden="true" /> CSV で書き出す</Button>}
      stats={stats}
      folders={narrow ? undefined : <>{createButton(true)}{folderPanel}</>}
      toolbar={toolbar}
      pagination={pager}
      overlays={<>
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
        {termsTarget ? <OfferTermsDialog offer={termsTarget} onClose={() => setTermsTarget(null)} /> : null}
      </>}
    >
      {body}
    </AffiliateFrame>
  )
}
