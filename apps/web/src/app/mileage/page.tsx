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
import { api, type MileageAdminOverview, type MileageRule } from '@/lib/api'
import { formatMileageDate } from './mileage-display'
import { mileagePaginationTotal } from './mileage-response-state'
import {
  RULE_FILTERS,
  RULE_SORTS,
  earningRulesCsv,
  ruleEventLabel,
  ruleLimitLabel,
  selectRules,
  type RuleFilter,
  type RuleSort,
} from './earning-rule-view'
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
  message_received: 'メッセージ',
  link_clicked: 'リンククリック',
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

function isMileageAdminOverview(value: unknown): value is MileageAdminOverview {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MileageAdminOverview>
  return Array.isArray(candidate.members)
    && !!candidate.summary
    && typeof candidate.summary.totalMembers === 'number'
    && typeof candidate.summary.totalAvailable === 'number'
    && typeof candidate.summary.activeMembers30d === 'number'
    && typeof candidate.summary.totalActions === 'number'
    && typeof candidate.summary.queuedEvents === 'number'
    && !!candidate.pagination
    && typeof candidate.pagination.total === 'number'
    && typeof candidate.pagination.limit === 'number'
    && typeof candidate.pagination.offset === 'number'
}


function MileagePageInner() {
  const tab = useMergedTab(TABS, 'tab', 'balances')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  latestAccountRef.current = selectedAccountId
  const [overview, setOverview] = useState<MileageAdminOverview | null>(null)
  const [rules, setRules] = useState<MileageRule[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null)
  const [ruleFilters, setRuleFilters] = useState<RuleFilter[]>([])
  const [ruleSort, setRuleSort] = useState<RuleSort>('newest')
  const [tabCounts, setTabCounts] = useState<{ balances: number | null; rules: number | null; rewards: number | null }>({ balances: null, rules: null, rewards: null })
  const [canAdjustMileage, setCanAdjustMileage] = useState(false)
  const overviewTotal = mileagePaginationTotal(overview)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadRules = useCallback(async () => {
    const res = await api.mileage.rules()
    if (!res.success || !Array.isArray(res.data)) throw new Error('invalid_mileage_rules')
    setRules(res.data)
    setAmounts(Object.fromEntries(res.data.map((rule) => [rule.id, String(rule.amount)])))
  }, [])

  const loadOverview = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    if (!accountAtRequest) {
      setOverview(null)
      return
    }
    const res = await api.mileage.overview({
      accountId: accountAtRequest,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    })
    if (accountAtRequest !== latestAccountRef.current) return
    if (!res.success) throw new Error(res.error)
    if (!isMileageAdminOverview(res.data)) throw new Error('invalid_mileage_overview')
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
    void reloadAll()
  }, [accountLoading, reloadAll])

  useEffect(() => {
    let current = true
    if (!selectedAccountId) {
      setTabCounts({ balances: null, rules: null, rewards: null })
      return () => { current = false }
    }
    void Promise.allSettled([
      api.mileage.overview({ accountId: selectedAccountId, limit: 1, offset: 0 }),
      api.mileage.rules(),
      api.mileage.rewards(selectedAccountId),
    ]).then(([balances, earningRules, rewards]) => {
      if (!current) return
      const balanceResponse = balances.status === 'fulfilled' ? balances.value : null
      const ruleResponse = earningRules.status === 'fulfilled' ? earningRules.value : null
      const rewardResponse = rewards.status === 'fulfilled' ? rewards.value : null
      setTabCounts({
        balances: balanceResponse?.success && isMileageAdminOverview(balanceResponse.data) ? balanceResponse.data.summary.totalMembers : null,
        rules: ruleResponse?.success && Array.isArray(ruleResponse.data) ? ruleResponse.data.length : null,
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

  const updateRule = async (rule: MileageRule, updates: Partial<MileageRule>) => {
    setSavingRuleId(rule.id)
    setActionError('')
    try {
      const res = await api.mileage.updateRule(rule.id, updates)
      if (!res.success) throw new Error(res.error)
      await Promise.all([loadRules(), loadOverview()])
    } catch {
      setActionError('たまる決めごとを更新できませんでした。もう一度お試しください。')
    } finally {
      setSavingRuleId(null)
    }
  }

  const saveAmount = async (rule: MileageRule) => {
    const amount = Number(amounts[rule.id])
    if (!Number.isInteger(amount) || amount <= 0) {
      setActionError('付与マイルは1以上の整数で入力してください。')
      return
    }
    if (amount === rule.amount) return
    await updateRule(rule, { amount })
  }

  const totalPages = Math.max(1, Math.ceil((overview?.pagination?.total ?? 0) / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const shownRules = useMemo(
    () => selectRules(rules, { filters: ruleFilters, sort: ruleSort }),
    [rules, ruleFilters, ruleSort],
  )

  const exportRulesCsv = () => {
    const csv = earningRulesCsv(shownRules, {
      event: (eventType) => ruleEventLabel(eventType, EVENT_LABELS),
      date: formatMileageDate,
    })
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
  const members = overview?.members ?? []
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
      member.accountNames.join(' / '),
      member.available,
      member.pending,
      member.lastActivityAt ?? '',
    ])
    const csv = [['友だち', 'LINEアカウント', 'いまの残高', '確定待ち', '最終行動'], ...rows]
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

      {actionError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>}

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
        <SummaryCard variant="v6" title="マイルを持っている友だち" value={summary?.totalMembers ?? null} unit="人" detail="持っていない人の数は未取得" />
        <SummaryCard variant="v6" title="たまっているマイル" value={summary?.totalAvailable ?? null} unit=" マイル" detail="会社としての「あとで返すぶん」です" />
        <SummaryCard variant="v6" title="今月 たまった" value={null} unit=" マイル" detail="月別集計が接続されると表示" badge="未取得" badgeTone="neutral" />
        <SummaryCard
          variant="v6"
          title="もうすぐ消えるマイル"
          value={null}
          unit=" マイル"
          detail="失効ロットが接続されると表示"
          badge="未取得"
          badgeTone="neutral"
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
          消える予定 — 未取得
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
          <SummaryCard variant="v6" title="動いている決めごと" value={rules.filter((rule) => rule.isActive).length} unit="つ" detail={`止めているもの ${rules.filter((rule) => !rule.isActive).length}つ`} />
          <SummaryCard variant="v6" title="この30日で付いたマイル" value={null} unit=" マイル" detail="期間集計が接続されると表示" badge="未取得" badgeTone="neutral" />
          <SummaryCard variant="v6" title="いちばん付いている" value={null} unit="" detail="決めごとの利用集計は未接続" badge="未取得" badgeTone="neutral" />
          <SummaryCard variant="v6" title="1人あたりの平均" value={null} unit=" マイル" detail="保有者別集計が接続されると表示" badge="未取得" badgeTone="neutral" />
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
          {/* 「並び順を保存」は設計にあるが、保存する口が無いので置かない。 */}
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
                <Th className="w-[16%]">対象の行動</Th>
                <Th className="w-[14%]" align="right">たまるマイル</Th>
                <Th className="w-[15%]">何回まで</Th>
                <Th className="w-[12%]" align="center">状態</Th>
                <Th className="w-[15%]" align="center">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {shownRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">{rule.name}</td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    {ruleEventLabel(rule.eventType, EVENT_LABELS)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <input
                        type="number"
                        min={1}
                        aria-label={`${rule.name}の付与マイル`}
                        value={amounts[rule.id] ?? rule.amount}
                        onChange={(event) => setAmounts((current) => ({ ...current, [rule.id]: event.target.value }))}
                        onBlur={() => void saveAmount(rule)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void saveAmount(rule) }}
                        className="border-hairline rounded-control text-ink focus:ring-accent w-24 border px-3 py-2 text-right text-sm font-semibold tabular-nums focus:ring-2 focus:outline-none"
                      />
                      <span className="text-ink-faint text-xs">mile</span>
                    </div>
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">{ruleLimitLabel(rule)}</td>
                  <td className="px-4 py-3 text-center">
                    {rule.isActive ? <Chip tone="ok">動いています</Chip> : <Chip>止めています</Chip>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button
                      disabled={savingRuleId === rule.id}
                      onClick={() => void updateRule(rule, { isActive: !rule.isActive })}
                      aria-label={`${rule.name}を${rule.isActive ? '停止' : '再開'}する`}
                    >
                      {savingRuleId === rule.id
                        ? '反映しています'
                        : rule.isActive ? '決めごとを停止' : '決めごとを再開'}
                    </Button>
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
                  return (
                    <tr key={member.identityKey} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <p className="truncate text-sm font-semibold text-ink" title={member.displayName}>{member.displayName}</p>
                        <p className="mt-1 truncate text-xs text-ink-faint" title={member.accountNames.join('・')}>{member.accountNames.join('・') || 'LINEアカウント未取得'}</p>
                      </td>
                      <td className="px-4 py-4 text-sm text-ink-faint">—<span className="ml-1 text-xs">未取得</span></td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-bold text-accent-hover">{formatNumber(member.available)}</p>
                        {member.pending > 0 && <p className="text-[10px] text-amber-600">保留 {formatNumber(member.pending)}</p>}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-ink-faint">—<span className="ml-1 text-xs">未取得</span></td>
                      <td className="px-4 py-4 text-sm text-ink-faint">—<span className="ml-1 text-xs">未取得</span></td>
                      <td className="px-4 py-4 text-xs text-ink-secondary">{formatMileageDate(member.lastActivityAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.primaryFriendId)}`}>明細を見る</Button>
                          {canAdjustMileage ? <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.primaryFriendId)}&adjust=1`}>増やす・減らす</Button> : null}
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
