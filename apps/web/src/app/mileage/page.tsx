'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import MileageRewardsTab from './mileage-rewards-tab'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type MileageEarningRuleV6,
  type MileageEarningRulesV6Overview,
  type MileageFriendsV6Overview,
} from '@/lib/api'
import { formatMileageDate } from './mileage-display'
import { mileagePaginationTotal } from './mileage-response-state'
import { ruleEventLabel } from './earning-rule-view'
import MileageHistoryTab from './mileage-history-tab'
import ActionScoreTab from './action-score-tab'

const PAGE_SIZE = 20
const TABS = [
  { key: 'balances', label: '友だちの残高' },
  { key: 'earning-rules', label: 'たまる決めごと' },
  /*
    **「使い道」を足した。** 設計 `qlVLJ`（17-1-B）はこのタブを持つのに、
    ここに無かったので `?tab=rewards` は既定タブへ落ち、
    **画面からは「無い」ことすら分からなかった**（#739 で未実装と判定した）。
    口は #772 で入ったので、一覧をつなぐ。
  */
  { key: 'rewards', label: '使い道' },
  { key: 'history', label: '履歴' },
  { key: 'score', label: '行動スコア' },
] as const

const EVENT_LABELS: Record<string, string> = {
  friend_added: '友だち登録',
  message_received: 'メッセージ',
  link_clicked: 'リンククリック',
  broadcast_link_clicked: '配信リンククリック',
  form_submitted: 'フォーム',
  booking_created: '予約',
  affiliate_conversion_approved: '紹介成果',
  webinar_watch_5m: 'ウェビナー',
  webinar_watch_15m: 'ウェビナー',
  webinar_completed: 'ウェビナー完了',
  webinar_cta_clicked: 'ウェビナーCTA',
  instagram_dm_received: 'Instagram DM',
  instagram_comment_created: 'Instagramコメント',
  instagram_story_mentioned: 'ストーリーズ',
  instagram_line_returned: 'LINE帰還',
  inflow_return: 'LINE帰還',
  friend_registered: '友だち登録',
  friend_following_7d: '継続7日',
  friend_following_30d: '継続30日',
  friend_following_90d: '継続90日',
  friend_following_180d: '継続180日',
  friend_following_365d: '継続1年',
  purchase_completed: '購入完了',
}


function formatNumber(value: number) {
  return new Intl.NumberFormat('ja-JP').format(value)
}

function rankLabel(rank: string | null) {
  if (rank === 'gold') return 'ゴールド'
  if (rank === 'silver') return 'シルバー'
  if (rank === 'bronze') return 'ブロンズ'
  return null
}

function isMileageFriendsV6Overview(value: unknown): value is MileageFriendsV6Overview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageFriendsV6Overview>
  return Array.isArray(candidate.items)
    && !!candidate.summary
    && typeof candidate.summary.totalMembers === 'number'
    && typeof candidate.summary.withBalanceCount === 'number'
    && typeof candidate.summary.available === 'number'
    && typeof candidate.summary.pending === 'number'
    && !!candidate.pagination
    && typeof candidate.pagination.total === 'number'
    && typeof candidate.pagination.limit === 'number'
    && typeof candidate.pagination.offset === 'number'
}

function isMileageEarningRulesV6Overview(value: unknown): value is MileageEarningRulesV6Overview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageEarningRulesV6Overview>
  return Array.isArray(candidate.items)
    && !!candidate.pagination
    && typeof candidate.pagination.total === 'number'
    && typeof candidate.unassignedLegacyCount === 'number'
}

type RuleFilter = 'published' | 'stopped'
type RuleSort = 'order' | 'name' | 'amount' | 'granted'

const RULE_FILTERS: Array<{ key: RuleFilter; label: string }> = [
  { key: 'published', label: '動いている' },
  { key: 'stopped', label: '止めている' },
]

const RULE_SORTS: Array<{ value: RuleSort; label: string }> = [
  { value: 'order', label: '決めた並び順' },
  { value: 'granted', label: '付いた回数が多い順' },
  { value: 'name', label: '名前順' },
  { value: 'amount', label: 'マイルが多い順' },
]


function MileagePageInner() {
  const tab = useMergedTab(TABS, 'tab', 'balances')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [overview, setOverview] = useState<MileageFriendsV6Overview | null>(null)
  const [ruleOverview, setRuleOverview] = useState<MileageEarningRulesV6Overview | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null)
  const [savingRuleOrder, setSavingRuleOrder] = useState(false)
  const [ruleOrder, setRuleOrder] = useState<string[]>([])
  const [ruleOrderDirty, setRuleOrderDirty] = useState(false)
  const [ruleFilters, setRuleFilters] = useState<RuleFilter[]>([])
  const [ruleSort, setRuleSort] = useState<RuleSort>('order')
  const [tabCounts, setTabCounts] = useState<{ balances: number | null; rules: number | null; rewards: number | null }>({ balances: null, rules: null, rewards: null })
  const [canAdjustMileage, setCanAdjustMileage] = useState(false)
  const overviewTotal = mileagePaginationTotal(overview)
  const rules = ruleOverview?.items ?? []

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadRules = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setRuleOverview(null)
      return
    }
    const res = await api.mileage.earningRulesV6({ accountId: accountAtRequest, limit: 100, offset: 0 })
    if (accountAtRequest !== latestAccountRef.current) return
    if (!res.success || !isMileageEarningRulesV6Overview(res.data)) throw new Error('invalid_mileage_rules')
    setRuleOverview(res.data)
    setRuleOrder(res.data.items.map((rule) => rule.id))
    setRuleOrderDirty(false)
  }, [selectedAccountId])

  const loadOverview = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setOverview(null)
      return
    }
    const res = await api.mileage.friendsV6({
      accountId: accountAtRequest,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    })
    if (accountAtRequest !== latestAccountRef.current) return
    if (!res.success) throw new Error(res.error)
    if (!isMileageFriendsV6Overview(res.data)) throw new Error('invalid_mileage_overview')
    setOverview(res.data)
  }, [offset, search, selectedAccountId])

  const reloadAll = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      if (tab === 'balances') await loadOverview()
      if (tab === 'earning-rules') await loadRules()
    } catch {
      setLoadError('マイルデータを読み込めませんでした。')
    } finally {
      setLoading(false)
    }
  }, [loadOverview, loadRules, tab])

  useEffect(() => {
    if (accountLoading) return
    setOffset(0)
    setOverview(null)
    setRuleOverview(null)
    void reloadAll()
  }, [accountLoading, reloadAll])

  useEffect(() => {
    let current = true
    if (!selectedAccountId) {
      setTabCounts({ balances: null, rules: null, rewards: null })
      return () => { current = false }
    }
    void Promise.allSettled([
      api.mileage.friendsV6({ accountId: selectedAccountId, limit: 1, offset: 0 }),
      api.mileage.earningRulesV6({ accountId: selectedAccountId, limit: 1, offset: 0 }),
      api.mileage.rewards(selectedAccountId),
    ]).then(([balances, earningRules, rewards]) => {
      if (!current) return
      const balanceResponse = balances.status === 'fulfilled' ? balances.value : null
      const ruleResponse = earningRules.status === 'fulfilled' ? earningRules.value : null
      const rewardResponse = rewards.status === 'fulfilled' ? rewards.value : null
      setTabCounts({
        balances: balanceResponse?.success && isMileageFriendsV6Overview(balanceResponse.data) ? balanceResponse.data.summary.totalMembers : null,
        rules: ruleResponse?.success && isMileageEarningRulesV6Overview(ruleResponse.data) ? ruleResponse.data.pagination.total : null,
        rewards: rewardResponse?.success && Array.isArray(rewardResponse.data?.rewards) ? rewardResponse.data.rewards.length : null,
      })
    })
    return () => { current = false }
  }, [selectedAccountId])

  useEffect(() => {
    let current = true
    void api.staff.me().then((response) => {
      if (!current || !response.success) return
      setCanAdjustMileage(response.data.role === 'owner' || response.data.role === 'admin')
    }).catch(() => {
      if (current) setCanAdjustMileage(false)
    })
    return () => { current = false }
  }, [])

  const toggleRule = async (rule: MileageEarningRuleV6) => {
    setSavingRuleId(rule.id)
    try {
      const res = await api.mileage.updateRule(rule.id, { isActive: rule.published.status !== 'published' })
      if (!res.success) throw new Error(res.error)
      await loadRules()
    } catch {
      setLoadError('たまる決めごとを更新できませんでした。もう一度お試しください。')
    } finally {
      setSavingRuleId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil((overview?.pagination?.total ?? 0) / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const shownRules = useMemo(() => {
    const filtered = rules.filter((rule) => ruleFilters.length === 0
      || ruleFilters.includes(rule.published.status))
    const order = new Map(ruleOrder.map((id, index) => [id, index]))
    return [...filtered].sort((a, b) => {
      if (ruleSort === 'granted') return b.metrics30d.granted - a.metrics30d.granted
      if (ruleSort === 'name') return a.draft.name.localeCompare(b.draft.name, 'ja')
      if (ruleSort === 'amount') return b.draft.amount - a.draft.amount
      return (order.get(a.id) ?? a.draft.sortOrder) - (order.get(b.id) ?? b.draft.sortOrder)
    })
  }, [ruleFilters, ruleOrder, ruleSort, rules])

  const moveRule = (id: string, direction: -1 | 1) => {
    if (ruleFilters.length > 0 || ruleSort !== 'order') return
    setRuleOrder((current) => {
      const index = current.indexOf(id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    setRuleOrderDirty(true)
  }

  const saveRuleOrder = async () => {
    if (!selectedAccountId || savingRuleOrder || !ruleOrderDirty) return
    const byId = new Map(rules.map((rule) => [rule.id, rule]))
    const changed = ruleOrder.flatMap((id, index) => {
      const rule = byId.get(id)
      return rule && rule.draft.sortOrder !== index ? [{ rule, sortOrder: index }] : []
    })
    setSavingRuleOrder(true)
    setLoadError('')
    try {
      await Promise.all(changed.map(async ({ rule, sortOrder }) => {
        const response = await api.mileage.saveEarningRuleDraft(rule.id, {
          accountId: selectedAccountId,
          expectedVersion: rule.draftVersion,
          draft: { ...rule.draft, sortOrder },
        })
        if (!response.success) throw new Error(response.error)
      }))
      await loadRules()
    } catch {
      setLoadError('並び順を保存できませんでした。最新の状態を読み直してから、もう一度お試しください。')
    } finally {
      setSavingRuleOrder(false)
    }
  }

  const exportRulesCsv = () => {
    const rows = shownRules.map((rule) => [
      rule.draft.name,
      ruleEventLabel(rule.draft.eventType, EVENT_LABELS),
      rule.draft.amount,
      rule.metrics30d.granted,
      rule.draft.expiresAfterDays ?? '失効なし',
      rule.published.status === 'published' ? '動いています' : '止めています',
    ])
    const csv = [['決めごと', '対象の行動', 'たまるマイル', 'この30日の付与回数', '失効', '状態'], ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `mileage-earning-rules-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const summary = overview?.summary
  const members = overview?.items ?? []
  const activeRules = rules.filter((rule) => rule.published.status === 'published')
  const granted30d = rules.reduce((sum, rule) => sum + rule.metrics30d.granted, 0)
  const excluded30d = rules.reduce((sum, rule) => sum + rule.metrics30d.excluded, 0)
  const topRule = [...rules].sort((a, b) => b.metrics30d.granted - a.metrics30d.granted)[0] ?? null
  const displayTabs = useMemo(() => TABS.map((item) => {
    const count = item.key === 'balances' ? tabCounts.balances
      : item.key === 'earning-rules' ? tabCounts.rules
        : item.key === 'rewards' ? tabCounts.rewards
          : null
    return { ...item, label: count === null ? item.label : `${item.label} ${formatNumber(count)}` }
  }), [tabCounts])

  const exportBalancesCsv = () => {
    if (members.length === 0) return
    const rows = members.map((member) => [
      member.displayName,
      member.lineAccount.name,
      member.available,
      member.pending,
      member.expiringMiles30d ?? '',
      member.lastChangedAt ?? '',
    ])
    const csv = [['友だち', 'LINEアカウント', 'いまの残高', '確定待ち', '30日以内に失効', '最終変動'], ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mileage-balances-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-mileage-design="v6" data-design-node={tab === 'balances' ? 's98Vfw' : tab === 'earning-rules' ? 'N46cQ' : tab === 'rewards' ? 'qlVLJ' : tab === 'history' ? 'MvZm5' : 'z3PB2'}>
      <Breadcrumb items={[{ label: '成果と分析' }, { label: 'マイル' }, ...(tab === 'balances' ? [] : [{ label: TABS.find((item) => item.key === tab)?.label ?? 'マイル' }])]} className="mb-3" />
      <div data-design="Tabs">
        <MergedTabs
          basePath="/mileage"
          tabs={displayTabs}
          active={tab}
          defaultKey="balances"
          actions={tab === 'score'
            ? <Button href="/mileage/score-rules" variant="primary">スコアのルールを作る</Button>
            : tab !== 'rewards'
              ? <Button href="/mileage?tab=rewards">使い道を先に決める</Button>
              : undefined}
        />
      </div>

      {!selectedAccountId && !accountLoading ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選択してください"
          description="友だちの残高は、共通トップバーで選んだLINEアカウントごとに表示します。"
        />
      ) : <>

      {tab === 'balances' && loading ? (
        <ListState
          kind="loading"
          title="友だちのマイルを読み込んでいます"
          description="残高と履歴を集計しています。このまま少しお待ちください。"
        />
      ) : null}

      {tab === 'balances' && loadError ? (
        <ListState
          kind="error"
          title="友だちのマイルを表示できませんでした"
          description="再読み込みしても直らない場合はエラー報告へ。"
          onRetry={() => void reloadAll()}
        />
      ) : null}

      {tab === 'balances' && !loading && !loadError && <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard variant="v6" title="マイルを持っている友だち" value={summary?.withBalanceCount ?? null} unit="人" detail={summary ? `選択中 ${summary.totalMembers.toLocaleString('ja-JP')}人のうち` : '選択中のLINEアカウント'} />
        <SummaryCard variant="v6" title="たまっているマイル" value={summary?.available ?? null} unit=" マイル" detail={`確定待ち ${summary?.pending.toLocaleString('ja-JP') ?? '—'} マイル`} />
        <SummaryCard variant="v6" title="今月の増減" value={null} unit=" マイル" detail="一覧の各友だちでは確認できます" badge="全体未取得" badgeTone="neutral" />
        <SummaryCard
          variant="v6"
          title="もうすぐ消えるマイル"
          value={summary?.expiringMiles30d ?? null}
          unit=" マイル"
          detail={summary?.expiringMiles30d == null ? '期限付きの付与記録はありません' : '30日以内に期限を迎える分'}
        />
      </div>
      <NoteBar className="mb-4">
        友だちごとにたまっているマイルです。どうやってたまるかは「たまる決めごと」、何と交換できるかは「使い道」で決めます。
      </NoteBar>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="友だちの名前で検索"
          className="h-10 min-w-64 rounded-control border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-accent"
        />
        <Button onClick={() => void reloadAll()}>残高を再読み込み</Button>
        <Button onClick={exportBalancesCsv} disabled={members.length === 0} className="ml-auto">残高をCSVで書き出す</Button>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="残高の絞り込み状況">
        <span className="rounded-full border border-accent bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-hover">
          すべて {overviewTotal === null ? '—' : formatNumber(overviewTotal)}
        </span>
        {['ゴールド', 'シルバー', 'ブロンズ'].map((label) => (
          <span key={label} className="rounded-full border border-hairline bg-canvas px-3 py-2 text-xs font-semibold text-ink-faint">
            {label} — 未取得
          </span>
        ))}
        <span className="rounded-full border border-status-warn bg-status-warn-soft px-3 py-2 text-xs font-semibold text-status-warn-deep">
          30日以内に消える {summary?.expiringMiles30d == null ? '0' : formatNumber(summary.expiringMiles30d)} マイル
        </span>
        <span className="ml-auto rounded-control border border-hairline bg-canvas px-3 py-2 text-xs font-semibold text-ink-secondary">
          残高が多い順
        </span>
      </div>
      </>}

      {tab === 'earning-rules' && <div className="mb-6">
        {/* 設計 N46cQ に本文見出しは無い。画面名はタブが持っているので、
            ここで見出しをもう一度書かない。 */}
        {!loading && !loadError ? <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard variant="v6" title="動いている決めごと" value={activeRules.length} unit="つ" detail={`止めているもの ${rules.length - activeRules.length}つ`} />
          <SummaryCard variant="v6" title="この30日の付与回数" value={granted30d} unit="回" detail="実際に付与記録になった回数" />
          <SummaryCard variant="v6" title="いちばん動いた決めごと" value={topRule?.metrics30d.granted ?? null} unit="回" detail={topRule?.draft.name ?? 'まだ付与記録はありません'} />
          <SummaryCard variant="v6" title="対象外になった行動" value={excluded30d} unit="回" detail="対象候補のうち付与しなかった回数" />
        </div> : null}
        <NoteBar>
          どんなことをしたら何マイル付けるかを決めます。付与数を変えると、変更後に起きた行動から新しい値を使います。
        </NoteBar>

        {loading ? (
          <ListState
            kind="loading"
            title="たまる決めごとを読み込んでいます"
            description="このまま少しお待ちください。"
          />
        ) : loadError ? (
          <ListState
            kind="error"
            title="たまる決めごとを読み込めませんでした"
            description="再読み込みしても直らない場合はエラー報告へ。"
            onRetry={() => void reloadAll()}
          />
        ) : rules.length === 0 ? (
          <ListState
            kind="empty"
            title="まだ決めごとがありません"
            description="どんなことをしたら何マイル付けるかを決めます。"
            action={<Button href="/mileage/earning-rules/new" variant="primary">決めごとを作る</Button>}
          />
        ) : (
        <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button href="/mileage/earning-rules/new" variant="primary">決めごとをつくる</Button>
        </div>
        <div
          className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
        >
          <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
          <Select
            aria-label="並び順"
            value={ruleSort}
            options={RULE_SORTS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(value) => setRuleSort(value as RuleSort)}
          />
          <Button
            onClick={() => void saveRuleOrder()}
            disabled={savingRuleOrder || !ruleOrderDirty || ruleFilters.length > 0 || ruleSort !== 'order'}
          >
            {savingRuleOrder ? '保存しています' : '並び順を保存'}
          </Button>
          <Button onClick={exportRulesCsv} disabled={shownRules.length === 0} className="ml-auto">
            CSVで書き出す
          </Button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {RULE_FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              selected={ruleFilters.includes(f.key)}
              onChange={(selected) => {
                setRuleFilters((current) =>
                  selected ? [...current, f.key] : current.filter((k) => k !== f.key),
                )
              }}
            >
              {f.label}
            </FilterChip>
          ))}
        </div>

        {shownRules.length === 0 ? (
          <ListState
            kind="empty"
            title="絞り込みに合う決めごとがありません"
            description="絞り込みの札を外すと表示されます。"
          />
        ) : (
        <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th className="w-[28%]">何をしてくれたら</Th>
                <Th className="w-[15%]">対象の行動</Th>
                <Th className="w-[12%]" align="right">たまるマイル</Th>
                <Th className="w-[16%]">有効期間・失効</Th>
                <Th className="w-[12%]" align="right">この30日</Th>
                <Th className="w-[10%]" align="center">状態</Th>
                <Th className="w-[12%]" align="center">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {shownRules.map((rule, index) => (
                <tr key={rule.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">
                    <p className="truncate" title={rule.draft.name}>{rule.draft.name}</p>
                    <p className="mt-1 text-xs font-normal text-ink-faint">下書き v{rule.draftVersion}</p>
                    <details className="mt-2 text-xs font-normal text-ink-secondary">
                      <summary className="cursor-pointer font-semibold text-accent">公開版の中身を見る</summary>
                      <dl className="mt-2 space-y-1 rounded-control bg-canvas-sunken p-2">
                        <div><dt className="inline text-ink-faint">名前：</dt><dd className="inline">{rule.published.name}</dd></div>
                        <div><dt className="inline text-ink-faint">対象：</dt><dd className="inline">{ruleEventLabel(rule.published.eventType, EVENT_LABELS)}</dd></div>
                        <div><dt className="inline text-ink-faint">付与：</dt><dd className="inline">{formatNumber(rule.published.amount)}マイル</dd></div>
                      </dl>
                    </details>
                    <p className="mt-2 text-xs font-normal text-ink-faint">
                      {rule.draft.targetConditions
                        ? `利用対象：${rule.draft.targetConditions.operator === 'AND' ? 'すべて満たす' : 'いずれかを満たす'}条件 ${rule.draft.targetConditions.rules.length + (rule.draft.targetConditions.groups?.reduce((sum, group) => sum + group.rules.length, 0) ?? 0)}件`
                        : '利用対象：すべての友だち'}
                    </p>
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    {ruleEventLabel(rule.draft.eventType, EVENT_LABELS)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatNumber(rule.draft.amount)} <span className="text-xs font-normal text-ink-faint">マイル</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-secondary">
                    <p>{rule.draft.validFrom || rule.draft.validUntil ? `${rule.draft.validFrom ? formatMileageDate(rule.draft.validFrom) : '開始指定なし'} 〜 ${rule.draft.validUntil ? formatMileageDate(rule.draft.validUntil) : '終了指定なし'}` : '期間の指定なし'}</p>
                    <p className="mt-1 text-ink-faint">{rule.draft.expiresAfterDays == null ? '失効なし' : `付いてから${rule.draft.expiresAfterDays}日`}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">
                    <p className="font-semibold text-ink">{formatNumber(rule.metrics30d.granted)}回</p>
                    <p className="mt-1 text-xs text-ink-faint">対象外 {formatNumber(rule.metrics30d.excluded)}回</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {rule.published.status === 'published' ? <Chip tone="ok">動いています</Chip> : <Chip>止めています</Chip>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex gap-1" aria-label={`${rule.draft.name}の並び順`}>
                        <Button disabled={ruleSort !== 'order' || ruleFilters.length > 0 || index === 0} onClick={() => moveRule(rule.id, -1)}>上へ</Button>
                        <Button disabled={ruleSort !== 'order' || ruleFilters.length > 0 || index === shownRules.length - 1} onClick={() => moveRule(rule.id, 1)}>下へ</Button>
                      </div>
                      <Button
                        disabled={savingRuleId === rule.id}
                        onClick={() => void toggleRule(rule)}
                        aria-label={`${rule.draft.name}を${rule.published.status === 'published' ? '停止' : '再開'}する`}
                      >
                        {savingRuleId === rule.id
                          ? '反映しています'
                          : rule.published.status === 'published' ? '決めごとを停止' : '決めごとを再開'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        <p className="text-ink-faint mt-3 text-xs font-semibold tabular-nums">
          {shownRules.length === rules.length
            ? `全 ${rules.length}件`
            : `${shownRules.length}件 / 全 ${rules.length}件`}
        </p>
        </>
        )}
      </div>}

      {tab === 'history' && selectedAccountId ? <MileageHistoryTab key={selectedAccountId} accountId={selectedAccountId} /> : null}

      {tab === 'rewards' ? <MileageRewardsTab key={selectedAccountId ?? 'none'} accountId={selectedAccountId} /> : null}
      {tab === 'score' && selectedAccountId ? <ActionScoreTab key={selectedAccountId} accountId={selectedAccountId} /> : null}

      {tab === 'balances' && !loading && !loadError && <section className="overflow-hidden rounded-card border border-hairline bg-canvas">
        {members.length === 0 ? (
          <ListState
            kind="empty"
            title="該当する友だちがいません"
            description="検索条件を変えると、ほかの友だちを確認できます。"
          />
        ) : (
          <div>
            <table className="w-full table-fixed">
              <thead>
                <TableHeadRow>
                  <Th className="w-1/4">友だち</Th>
                  <Th className="w-1/12">ランク</Th>
                  <Th className="w-1/12" align="right">いまの残高</Th>
                  <Th className="w-1/12" align="right">今月の増減</Th>
                  <Th className="w-1/12">消える予定</Th>
                  <Th className="w-1/6">最終行動</Th>
                  <Th className="w-1/6" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((member) => {
                  const displayRank = rankLabel(member.rank)
                  return (
                    <tr key={member.friendId} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <p className="truncate text-sm font-semibold text-ink" title={member.displayName}>{member.displayName}</p>
                        <p className="mt-1 truncate text-xs text-ink-faint" title={member.lineAccount.name}>{member.lineAccount.name}</p>
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-secondary" title={member.rankReason}>{displayRank ?? <><span>—</span><span className="ml-1 text-xs text-ink-faint">未設定</span></>}</td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-bold text-accent-hover">{formatNumber(member.available)}</p>
                        {member.pending > 0 && <p className="text-[10px] text-amber-600">保留 {formatNumber(member.pending)}</p>}
                      </td>
                      <td className={`px-4 py-4 text-right text-sm font-semibold tabular-nums ${member.monthChange < 0 ? 'text-danger' : 'text-accent-hover'}`}>{member.monthChange > 0 ? '+' : ''}{formatNumber(member.monthChange)}</td>
                      <td className="px-4 py-4 text-sm text-ink-secondary">{member.expiringMiles30d == null ? 'なし' : `${formatNumber(member.expiringMiles30d)} マイル`}</td>
                      <td className="px-4 py-4 text-xs text-ink-secondary">{formatMileageDate(member.lastChangedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}`}>明細を見る</Button>
                          {canAdjustMileage ? <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}&adjust=1`}>増やす・減らす</Button> : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-500">
              {overviewTotal === null
                ? '表示件数は未取得'
                : `${formatNumber(overviewTotal)}人中 ${formatNumber(offset + 1)}〜${formatNumber(Math.min(offset + members.length, overviewTotal))}人を表示`}
            </span>
            <Pagination
              page={currentPage}
              pageCount={totalPages}
              onPageChange={(nextPage) => setOffset((nextPage - 1) * PAGE_SIZE)}
              disabled={loading}
            />
          </div>
        )}
      </section>}
      </>}
    </div>
  )
}

export default function MileagePage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">マイルを読み込んでいます</div>}>
      <MileagePageInner />
    </Suspense>
  )
}
