'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'
import MileageRewardsTab from './mileage-rewards-tab'
import ActionMenu from '@/components/shared/action-menu'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import KpiCard from '@/components/shared/kpi-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { useAccount } from '@/contexts/account-context'
import {
  api,
  type MileageAdminHistory,
  type MileageEarningRuleV6,
  type MileageEarningRulesV6Overview,
  type MileageFriendsV6Overview,
} from '@/lib/api'
import { adminSessionHeaders } from '@/lib/admin-session'
import { csvCell } from '@/lib/presentation'
import { formatMileageDate, formatMileageNumber } from './mileage-display'
import { mileagePaginationTotal } from './mileage-response-state'
import { ruleEventLabel } from './earning-rule-view'
import MileageHistoryTab from './mileage-history-tab'
import ActionScoreTab from './action-score-tab'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'

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


function dateOnlyDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function grantedMiles30d(rule: MileageEarningRuleV6) {
  return rule.metrics30d.granted * rule.draft.amount
}

type EarningRuleSummary = {
  grantedMiles: number
  grantedCount: number
  averageBalance: number | null
  /*
   * 平均を割った人数。説明文はここから出す——別の口で取った人数
   * （全員の数など）を書くと、実際に割った数と説明がずれる
   * （MILEAGE-05）。残高0の人は分母に入れない。
   */
  averageDenominator: number | null
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

const RULE_PAGE_SIZE = 8


function MileagePageInner() {
  const tab = useMergedTab(TABS, 'tab', 'balances')
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const latestAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    latestAccountRef.current = selectedAccountId
  }, [selectedAccountId])
  /*
   * N-243: loadRules の世代番号。アカウント切替や保存後の読み直しで
   * 新しい読み込みが始まるたびに進む。遅れて届いた古い世代の応答
   * (旧アカウントの2ページ目など)は、この番号がずれているかで捨てる。
   */
  const rulesGenerationRef = useRef(0)
  const [overview, setOverview] = useState<MileageFriendsV6Overview | null>(null)
  const [ruleOverview, setRuleOverview] = useState<MileageEarningRulesV6Overview | null>(null)
  const [ruleSummary, setRuleSummary] = useState<EarningRuleSummary | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null)
  const [ruleMenuId, setRuleMenuId] = useState<string | null>(null)
  const [ruleActionError, setRuleActionError] = useState('')
  const [publishTarget, setPublishTarget] = useState<MileageEarningRuleV6 | null>(null)
  const [publishError, setPublishError] = useState('')
  const [savingRuleOrder, setSavingRuleOrder] = useState(false)
  const [ruleOrder, setRuleOrder] = useState<string[]>([])
  const [ruleOrderDirty, setRuleOrderDirty] = useState(false)
  const [ruleFilters, setRuleFilters] = useState<RuleFilter[]>([])
  const [ruleSort, setRuleSort] = useState<RuleSort>('order')
  const [rulePage, setRulePage] = useState(1)
  const [tabCounts, setTabCounts] = useState<{ balances: number | null; rules: number | null; rewards: number | null }>({ balances: null, rules: null, rewards: null })
  const [canAdjustMileage, setCanAdjustMileage] = useState(false)
  /*
   * 並び順の未保存変更がある間、画面を離れる操作を止める共通の番兵（DETAIL-04系）。
   * 左メニュー・画面内リンク・戻る操作・再読込を同じ確認対話へ寄せる。
   * タブ切替は同じ画面内の移動で下書きは残るので、番兵は画面外への離脱だけを見る。
   */
  const { leaveTarget, confirmLeave, cancelLeave } = useUnsavedGuard({ dirty: ruleOrderDirty, busy: savingRuleOrder })
  const overviewTotal = mileagePaginationTotal(overview)
  const rules = ruleOverview?.items ?? []

  const loadRules = useCallback(async () => {
    const accountAtRequest = selectedAccountId
    const generation = ++rulesGenerationRef.current
    const isStale = () =>
      generation !== rulesGenerationRef.current || accountAtRequest !== latestAccountRef.current
    if (!accountAtRequest) {
      setRuleOverview(null)
      setRuleSummary(null)
      return
    }
    try {
      const [res, historyRes, friendsRes] = await Promise.all([
        api.mileage.earningRulesV6({ accountId: accountAtRequest, limit: 100, offset: 0 }),
        api.mileage.history({
          accountId: accountAtRequest,
          from: dateOnlyDaysAgo(29),
          to: dateOnlyDaysAgo(0),
          limit: 1,
          offset: 0,
        }),
        api.mileage.friendsV6({ accountId: accountAtRequest, limit: 1, offset: 0 }),
      ])
      if (isStale()) return
      if (!res.success || !isMileageEarningRulesV6Overview(res.data)) throw new Error('invalid_mileage_rules')
      if (!historyRes.success || !friendsRes.success || !isMileageFriendsV6Overview(friendsRes.data)) {
        throw new Error('invalid_mileage_rule_summary')
      }
      /*
       * 決めごとに件数の上限は無い。並び順の一括口はアカウントの全IDを
       * 要求するため、100件ずつ全頁を読み切る(N-243)。各頁の到着ごとに
       * 世代を見て、古い読み込みの続きはここで捨てる。
       */
      const items = [...res.data.items]
      const total = res.data.pagination.total
      while (items.length < total) {
        const next = await api.mileage.earningRulesV6({
          accountId: accountAtRequest, limit: 100, offset: items.length,
        })
        if (isStale()) return
        if (!next.success || !isMileageEarningRulesV6Overview(next.data)) throw new Error('invalid_mileage_rules')
        if (next.data.items.length === 0) break
        items.push(...next.data.items)
      }
      const grant = (historyRes.data as MileageAdminHistory).summary.byType
        .find((item) => item.entryType === 'grant')
      setRuleOverview({ ...res.data, items })
      setRuleSummary({
        grantedMiles: grant?.amount ?? 0,
        grantedCount: grant?.count ?? 0,
        averageBalance: friendsRes.data.summary.withBalanceCount > 0
          ? Math.round(friendsRes.data.summary.available / friendsRes.data.summary.withBalanceCount)
          : null,
        averageDenominator: friendsRes.data.summary.withBalanceCount,
      })
      setRuleOrder(items.map((rule) => rule.id))
      setRuleOrderDirty(false)
      setRulePage(1)
    } catch (error) {
      /*
       * 古い世代の失敗(旧アカウントの遅い2頁目のreject等)は新しい画面へ
       * 出さない。ここで飲まないと reloadAll の catch が新しいアカウントの
       * エラー表示を書き、finally が新しい読み込み中の loading を下ろす。
       */
      if (isStale()) return
      throw error
    }
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

  /*
   * N-243: reloadAll の世代番号。古い実行(旧アカウントの読み込みなど)が
   * あとから終わっても、catch のエラー表示と finally の loading 解除は
   * 最新の実行だけに許す。
   */
  const reloadGenerationRef = useRef(0)
  const reloadAll = useCallback(async () => {
    const generation = ++reloadGenerationRef.current
    const isCurrent = () => generation === reloadGenerationRef.current
    setLoading(true)
    setLoadError('')
    try {
      if (tab === 'balances') await loadOverview()
      if (tab === 'earning-rules') await loadRules()
    } catch {
      if (isCurrent()) setLoadError('マイルデータを読み込めませんでした。')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [loadOverview, loadRules, tab])

  useEffect(() => {
    if (accountLoading) return
    setOffset(0)
    setOverview(null)
    setRuleOverview(null)
    setRuleSummary(null)
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
    setRuleActionError('')
    try {
      const res = await api.mileage.updateRule(rule.id, { isActive: rule.published.status !== 'published' })
      if (!res.success) throw new Error(res.error)
      await loadRules()
    } catch {
      setRuleActionError('たまる決めごとを更新できませんでした。もう一度お試しください。')
    } finally {
      setSavingRuleId(null)
    }
  }

  // N-231 案1: 下書きを公開版として固定し、実行へ反映する。確認は共通の確認窓で行う。
  const publishRule = async (rule: MileageEarningRuleV6) => {
    if (!selectedAccountId || savingRuleId !== null) return
    setSavingRuleId(rule.id)
    setPublishError('')
    try {
      const res = await api.mileage.publishEarningRule(rule.id, {
        accountId: selectedAccountId,
        expectedVersion: rule.draftVersion,
        idempotencyKey: crypto.randomUUID(),
      })
      if (!res.success) throw new Error(res.error)
      setPublishTarget(null)
      await loadRules()
    } catch {
      // 口の返事をそのまま出さない。運用者にできることは同じ——読み直して確かめる。
      setPublishError('公開できませんでした。下書きを読み直して内容を確かめてから、もう一度お試しください。')
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
      if (ruleSort === 'granted') return grantedMiles30d(b) - grantedMiles30d(a)
      if (ruleSort === 'name') return a.draft.name.localeCompare(b.draft.name, 'ja')
      if (ruleSort === 'amount') return b.draft.amount - a.draft.amount
      return (order.get(a.id) ?? a.draft.sortOrder) - (order.get(b.id) ?? b.draft.sortOrder)
    })
  }, [ruleFilters, ruleOrder, ruleSort, rules])
  const rulePageCount = Math.max(1, Math.ceil(shownRules.length / RULE_PAGE_SIZE))
  const visibleRules = shownRules.slice((rulePage - 1) * RULE_PAGE_SIZE, rulePage * RULE_PAGE_SIZE)

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
    setSavingRuleOrder(true)
    setLoadError('')
    try {
      // N-243: 全順序を一括口へ1回で送る。1件ずつPATCHすると途中失敗で部分適用になる。
      const response = await api.mileage.saveEarningRulesOrder({
        accountId: selectedAccountId,
        ids: ruleOrder,
      })
      if (!response.success) throw new Error(response.error)
      await loadRules()
    } catch {
      setLoadError('並び順を保存できませんでした。最新の状態を読み直してから、もう一度お試しください。')
      await loadRules().catch(() => {})
    } finally {
      setSavingRuleOrder(false)
    }
  }

  const [exportingRules, setExportingRules] = useState(false)
  const exportRulesCsv = async () => {
    // N-237: CSVはサーバー側で作る。許可scope内の決めごとだけが出て、監査へ残る。
    // ブラウザだけで権限判定を完結させない。api.tsの共通呼び出し層は変えない。
    if (!selectedAccountId || exportingRules) return
    setExportingRules(true)
    setRuleActionError('')
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/mileage/rules/export?accountId=${encodeURIComponent(selectedAccountId)}`,
        { credentials: 'include', headers: adminSessionHeaders() },
      )
      if (!res.ok) throw new Error('export_failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mileage-earning-rules-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setRuleActionError('CSVを書き出せませんでした。権限を確認して、もう一度お試しください。')
    } finally {
      setExportingRules(false)
    }
  }

  const summary = overview?.summary
  const members = overview?.items ?? []
  const activeRules = rules.filter((rule) => rule.published.status === 'published')
  const topRule = [...rules].sort((a, b) => grantedMiles30d(b) - grantedMiles30d(a))[0] ?? null
  const displayTabs = useMemo(() => TABS.map((item) => {
    const count = item.key === 'balances' ? tabCounts.balances
      : item.key === 'earning-rules' ? tabCounts.rules
        : item.key === 'rewards' ? tabCounts.rewards
          : null
    return { ...item, label: count === null ? item.label : `${item.label} ${formatMileageNumber(count)}` }
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
      .map((row) => row.map((value) => csvCell(value)).join(','))
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
      {/*
        #972 U040: 決めごとの表は列が多い。狭い幅では見出しが潰れて列と
        値の対応が読めなくなるので、枠の内側で横に動かせるようにする。
        主タブは横スクロール＋共通の狭幅対応に任せる（折り返しの上書きを
        付けるとスクロールと衝突して語の途中で割れる）。
      */}
      <style>{`
        [data-mileage-table] { overflow-x: auto; }
        [data-mileage-table] > table { min-width: 920px; }
      `}</style>

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
        <KpiCard variant="v6" title="マイルを持っている友だち" value={summary?.withBalanceCount ?? null} unit="人" detail={summary ? `選択中 ${summary.totalMembers.toLocaleString('ja-JP')}人のうち` : '選択中のLINEアカウント'} />
        <KpiCard variant="v6" title="たまっているマイル" value={summary?.available ?? null} unit=" マイル" detail={`確定待ち ${summary?.pending.toLocaleString('ja-JP') ?? '—'} マイル`} />
        <KpiCard variant="v6" title="今月の増減" value={summary?.monthChange ?? null} unit=" マイル" detail="" help="選択中の友だち全体の増減です" />
        <KpiCard
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
        <SearchField
          aria-label="友だちの名前で検索"
          value={searchInput}
          onChange={setSearchInput}
          onClear={() => { setSearchInput(''); setSearch(''); setOffset(0) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setOffset(0)
              setSearch(searchInput.trim())
            }
          }}
          placeholder="友だちの名前で検索"
          className="min-w-64 max-w-96 flex-1"
        />
        <Button onClick={() => { setOffset(0); setSearch(searchInput.trim()) }}>検索</Button>
        <Button onClick={() => void reloadAll()}>残高を再読み込み</Button>
        <Button onClick={exportBalancesCsv} disabled={members.length === 0} className="ml-auto">この頁の残高をCSVで書き出す</Button>
      </div>
      {/*
        #668: ここは人数の内訳で、絞り込みの口ではない。ピルの形
        （rounded-full + 枠）だと押せるチップに見えるので、押せない
        事実は字だけの行として出す。「残高が多い順」も選べないので
        「並び順：」の前置きで固定値だと分かる形にする。
      */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs" aria-label="ランク別の人数">
        <span className="text-ink font-semibold tabular-nums">
          すべて {overviewTotal === null ? '—' : `${formatMileageNumber(overviewTotal)}名`}
        </span>
        {(summary?.rankCounts ?? []).map((rank) => (
          <span key={rank.rewardId} className="text-ink-secondary tabular-nums">
            {rank.rankName} {formatMileageNumber(rank.friendCount)}名
          </span>
        ))}
        {summary && summary.rankCounts.length === 0 ? <span className="text-ink-faint">公開中のランクなし</span> : null}
        <span className="text-status-warn-deep tabular-nums">
          30日以内に消える {summary?.expiringMiles30d == null ? '0' : formatMileageNumber(summary.expiringMiles30d)} マイル
        </span>
        <span className="text-ink-faint ml-auto">
          並び順：残高が多い順
        </span>
      </div>
      </>}

      {tab === 'earning-rules' && <div className="mb-6">
        {/* 設計 N46cQ に本文見出しは無い。画面名はタブが持っているので、
            ここで見出しをもう一度書かない。 */}
        {!loading && !loadError ? <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard variant="v6" title="動いている決めごと" value={activeRules.length} unit="つ" detail={`止めているもの ${rules.length - activeRules.length}つ`} />
          <KpiCard variant="v6" title="この30日で付いたマイル" value={ruleSummary?.grantedMiles ?? null} unit="マイル" detail={`のべ ${formatMileageNumber(ruleSummary?.grantedCount ?? 0)}回`} />
          <KpiCard variant="v6" title="いちばん付いている" value={topRule ? grantedMiles30d(topRule) : null} unit="マイル" detail={topRule ? `${topRule.draft.name}・${formatMileageNumber(topRule.metrics30d.granted)}回` : 'まだ付与記録はありません'} />
          {/* MILEAGE-05: 分母の人数は計算と同じ口の値を見せる。数字そのものなので「？」へ移さない。 */}
          <KpiCard variant="v6" title="1人あたりの平均" value={ruleSummary?.averageBalance ?? null} unit="マイル" detail={ruleSummary?.averageDenominator ? `残高0の人は除き、持っている人 ${formatMileageNumber(ruleSummary.averageDenominator)}人で割った数` : '残高がある人がいないため計算していません'} />
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
        <div
          className="bg-canvas rounded-card border-hairline mb-3 flex flex-wrap items-center gap-2 border p-3"
        >
          <Button href="/mileage/earning-rules/new" variant="primary">決めごとをつくる</Button>
          <span className="text-ink-faint text-xs whitespace-nowrap">並び順</span>
          <Select
            aria-label="並び順"
            value={ruleSort}
            options={RULE_SORTS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(value) => {
              setRulePage(1)
              setRuleSort(value as RuleSort)
            }}
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

        {ruleActionError ? (
          <p role="alert" className="border-status-danger bg-status-danger-soft text-danger mb-3 rounded-control border px-3 py-2 text-sm">
            {ruleActionError}
          </p>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {RULE_FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              selected={ruleFilters.includes(f.key)}
              onChange={(selected) => {
                setRulePage(1)
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
        <div className="bg-canvas rounded-card border-hairline overflow-hidden border" data-mileage-table="earning-rules">
          <table className="w-full table-fixed">
            <thead>
              <TableHeadRow>
                <Th className="w-[21%]">何をしてくれたら</Th>
                <Th className="w-[11%]">対象の行動</Th>
                <Th className="w-[11%]" align="right">たまるマイル</Th>
                <Th className="w-[14%]">有効期間・失効</Th>
                <Th className="w-[12%]" align="right">この30日</Th>
                <Th className="w-[13%]" align="center">状態</Th>
                <Th className="w-[18%]" align="center">操作</Th>
              </TableHeadRow>
            </thead>
            <tbody className="divide-hairline divide-y">
              {visibleRules.map((rule, index) => (
                <tr key={rule.id} className="hover:bg-canvas-sunken">
                  <td className="text-ink px-4 py-3 text-sm font-medium">
                    <p className="truncate" title={rule.draft.name}>{rule.draft.name}</p>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs font-normal">
                      <span
                        className="min-w-0 truncate text-ink-faint"
                        title={rule.draft.targetConditions
                          ? `利用対象：条件 ${rule.draft.targetConditions.rules.length + (rule.draft.targetConditions.groups?.reduce((sum, group) => sum + group.rules.length, 0) ?? 0)}件・下書き v${rule.draftVersion}`
                          : `利用対象：すべての友だち・下書き v${rule.draftVersion}`}
                      >
                        {rule.draft.targetConditions
                          ? `利用対象：条件 ${rule.draft.targetConditions.rules.length + (rule.draft.targetConditions.groups?.reduce((sum, group) => sum + group.rules.length, 0) ?? 0)}件・下書き v${rule.draftVersion}`
                          : `利用対象：すべての友だち・下書き v${rule.draftVersion}`}
                      </span>
                      <details className="relative shrink-0 text-ink-secondary">
                        <summary className="cursor-pointer font-semibold text-action">公開版の中身を見る</summary>
                        <p className="absolute left-0 top-full z-10 mt-1 w-72 rounded-control border border-hairline bg-canvas p-2 shadow-card" title={`${rule.published.name} / ${ruleEventLabel(rule.published.eventType, EVENT_LABELS)} / ${formatMileageNumber(rule.published.amount)}マイル`}>
                          {rule.published.name}・{ruleEventLabel(rule.published.eventType, EVENT_LABELS)}・{formatMileageNumber(rule.published.amount)}マイル
                        </p>
                      </details>
                    </div>
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    {ruleEventLabel(rule.draft.eventType, EVENT_LABELS)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMileageNumber(rule.draft.amount)} <span className="text-xs font-normal text-ink-faint">マイル</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-secondary">
                    <p>{rule.draft.validFrom || rule.draft.validUntil ? `${rule.draft.validFrom ? formatMileageDate(rule.draft.validFrom) : '開始指定なし'} 〜 ${rule.draft.validUntil ? formatMileageDate(rule.draft.validUntil) : '終了指定なし'}` : '期間の指定なし'}</p>
                    <p className="mt-1 text-ink-faint">{rule.draft.expiresAfterDays == null ? '失効なし' : `付いてから${rule.draft.expiresAfterDays}日`}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">
                    <p className="font-semibold text-ink">{formatMileageNumber(grantedMiles30d(rule))}</p>
                    <p className="mt-1 text-xs text-ink-faint">対象外 {formatMileageNumber(rule.metrics30d.excluded)}回</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {rule.published.status === 'published' ? <Chip tone="ok">動いています</Chip> : <Chip>止めています</Chip>}
                    <p className="mt-1 text-xs text-ink-faint">
                      {rule.publishedVersion == null ? '未公開' : `公開版 v${rule.publishedVersion}`}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {/*
                      4つの操作を1行へ横並びにすると、12%程度の列へ収まらず
                      状態列と「この30日」へ重なっていた（実機の2×2潰れと同根）。
                      並び順だけを列へ残し、停止・公開は共通のその他メニューへ畳む。
                    */}
                    <div className="relative flex items-center justify-center gap-1">
                      <div className="flex gap-1" aria-label={`${rule.draft.name}の並び順`}>
                        <Button disabled={ruleSort !== 'order' || ruleFilters.length > 0 || (rulePage - 1) * RULE_PAGE_SIZE + index === 0} onClick={() => moveRule(rule.id, -1)}>上へ</Button>
                        <Button disabled={ruleSort !== 'order' || ruleFilters.length > 0 || (rulePage - 1) * RULE_PAGE_SIZE + index === shownRules.length - 1} onClick={() => moveRule(rule.id, 1)}>下へ</Button>
                      </div>
                      <IconButton
                        aria-label={`${rule.draft.name}のその他操作`}
                        title={`${rule.draft.name}のその他操作`}
                        onClick={() => setRuleMenuId((current) => (current === rule.id ? null : rule.id))}
                      >
                        <MoreHorizontal />
                      </IconButton>
                      <ActionMenu
                        open={ruleMenuId === rule.id}
                        ariaLabel={`${rule.draft.name}の操作`}
                        onClose={() => setRuleMenuId(null)}
                        items={[
                          {
                            id: 'toggle',
                            label: rule.published.status === 'published' ? '決めごとを停止' : '決めごとを再開',
                            disabled: savingRuleId === rule.id,
                            disabledReason: '反映しています',
                            onSelect: () => void toggleRule(rule),
                          },
                          {
                            id: 'publish',
                            label: '公開して反映',
                            disabled: savingRuleId !== null,
                            disabledReason: '別の決めごとを反映しています',
                            onSelect: () => { setPublishError(''); setPublishTarget(rule) },
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold tabular-nums text-ink-faint">
            {shownRules.length === rules.length
              ? `決めごと ${rules.length}件のうち ${Math.min((rulePage - 1) * RULE_PAGE_SIZE + 1, shownRules.length)}〜${Math.min(rulePage * RULE_PAGE_SIZE, shownRules.length)}件を表示`
              : `${shownRules.length}件 / 全 ${rules.length}件`}
          </p>
          {rulePageCount > 1 ? (
            <Pagination page={rulePage} pageCount={rulePageCount} onPageChange={setRulePage} />
          ) : null}
        </div>
        </>
        )}
      </div>}

      <ConfirmDialog
        open={publishTarget !== null}
        title={publishTarget ? `「${publishTarget.draft.name}」の下書きを公開して反映しますか？` : '下書きを公開して反映しますか？'}
        description="公開後に受け付けたイベントから新しい内容になります。公開前に受け付けた分と、すでについたマイルは変わりません。取り消せません。"
        confirmLabel="公開して反映"
        destructive
        busy={publishTarget !== null && savingRuleId === publishTarget.id}
        error={publishError || undefined}
        onCancel={() => { if (savingRuleId === null) setPublishTarget(null) }}
        onConfirm={() => { if (publishTarget) void publishRule(publishTarget) }}
      />

      <ConfirmDialog
        open={leaveTarget !== null}
        title="保存していない変更があります"
        description="このまま移動すると、たまる決めごとの並び順への変更は失われます。保存せずに移動しますか？"
        confirmLabel="保存せずに移動"
        cancelLabel="編集を続ける"
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
      />

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
            {/*
              #972 U040: 390pxでは7列の表が潰れ、見出しと数値が別の行と
              結び付いて読めた。狭い幅では表をやめ、友だち・残高・変動を
              1枚の札にまとめる。表は lg 以上で出す。
            */}
            <div className="divide-y divide-hairline lg:hidden">
              {members.map((member) => {
                const displayRank = rankLabel(member.rank)
                return (
                  <div key={member.friendId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink" title={member.displayName}>{member.displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-faint" title={member.lineAccount.name}>{member.lineAccount.name}</p>
                      </div>
                      <p className="shrink-0 text-right">
                        <span className="block font-bold tabular-nums text-ink">{formatMileageNumber(member.available)}<span className="text-xs font-normal text-ink-faint"> マイル</span></span>
                        {member.pending > 0 && <span className="block text-micro text-status-warn-deep">保留 {formatMileageNumber(member.pending)}</span>}
                      </p>
                    </div>
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
                      <div><dt className="inline text-ink-faint">ランク：</dt><dd className="inline" title={member.rankReason}>{displayRank ?? '未設定'}</dd></div>
                      <div><dt className="inline text-ink-faint">今月の増減：</dt><dd className={`inline font-semibold tabular-nums ${member.monthChange < 0 ? 'text-danger' : 'text-ink'}`}>{member.monthChange > 0 ? '+' : ''}{formatMileageNumber(member.monthChange)}</dd></div>
                      <div><dt className="inline text-ink-faint">消える予定：</dt><dd className="inline">{member.expiringMiles30d == null ? 'なし' : `${formatMileageNumber(member.expiringMiles30d)} マイル`}</dd></div>
                      <div><dt className="inline text-ink-faint">最終変動：</dt><dd className="inline">{formatMileageDate(member.lastChangedAt)}</dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}`}>明細を見る</Button>
                      {canAdjustMileage ? <Button href={`/mileage/friends/detail?id=${encodeURIComponent(member.friendId)}&adjust=1`}>増やす・減らす</Button> : null}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="hidden lg:block">
            <table className="w-full table-fixed">
              <thead>
                <TableHeadRow>
                  <Th className="w-1/4">友だち</Th>
                  <Th className="w-1/12">ランク</Th>
                  <Th className="w-1/12" align="right">いまの残高</Th>
                  <Th className="w-1/12" align="right">今月の増減</Th>
                  <Th className="w-1/6">消える予定（マイル）</Th>
                  <Th className="w-1/6">最終行動</Th>
                  <Th className="w-1/6" align="right">操作</Th>
                </TableHeadRow>
              </thead>
              <tbody className="divide-hairline divide-y">
                {members.map((member) => {
                  const displayRank = rankLabel(member.rank)
                  return (
                    <tr key={member.friendId} className="hover:bg-canvas-sunken">
                      <td className="px-4 py-3">
                        <p className="truncate text-sm font-semibold text-ink" title={member.displayName}>{member.displayName}</p>
                        <p className="mt-1 truncate text-xs text-ink-faint" title={member.lineAccount.name}>{member.lineAccount.name}</p>
                      </td>
                      <td className="px-4 py-4"><p className="truncate text-sm text-ink-secondary" title={member.rankReason}>{displayRank ?? <><span>—</span><span className="ml-1 text-xs text-ink-faint">未設定</span></>}</p></td>
                      <td className="px-4 py-4 text-right">
                        <p className="font-bold text-ink">{formatMileageNumber(member.available)}</p>
                        {member.pending > 0 && <p className="text-micro text-status-warn-deep">保留 {formatMileageNumber(member.pending)}</p>}
                      </td>
                      <td className={`px-4 py-4 text-right text-sm font-semibold tabular-nums ${member.monthChange < 0 ? 'text-danger' : 'text-ink'}`}>{member.monthChange > 0 ? '+' : ''}{formatMileageNumber(member.monthChange)}</td>
                      <td className="px-4 py-4"><p className="truncate text-sm text-ink-secondary" title={member.expiringMiles30d == null ? 'なし' : `${formatMileageNumber(member.expiringMiles30d)} マイル`}>{member.expiringMiles30d == null ? 'なし' : formatMileageNumber(member.expiringMiles30d)}</p></td>
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
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
            <span className="text-xs text-ink-faint">
              {overviewTotal === null
                ? '表示件数は未取得'
                : `${formatMileageNumber(overviewTotal)}人中 ${formatMileageNumber(offset + 1)}〜${formatMileageNumber(Math.min(offset + members.length, overviewTotal))}人を表示`}
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
