'use client'

/*
 * ★V8-B マイル「行動スコア」（板 `IRPw8`、点数を手で直す `Nv7An`、
 * 点数の変化の明細 `R8NNi`、状態 `zaqP9`、閲覧のみ `E2Any`）。
 *
 * データの口は v7（action-score-tab.tsx・score-rules/page.tsx・
 * action-score-*-dialog.tsx）と同じ口へ取りに行く。上の段は友だちの
 * 点数（探す・帯の札・送る・点数の変化・直す）、下の段はできごとの
 * 決めごと（探す・足す点／引く点・分け方の試算・止める・足す）。
 * 決めごとの編集の器（原則・試す・保存・公開の手順）は
 * /mileage/score-rules の画面にあり、タブからは遷移する。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  Download,
  Info,
  MoreHorizontal,
  Plus,
  Send,
  Settings2,
  Star,
  TrendingDown,
} from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FilterChip from '@/components/shared/filter-chip'
import IconButton from '@/components/shared/icon-button'
import ListState from '@/components/shared/list-state'
import { TableHeadRow, Th } from '@/components/shared/table'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import ActionMenu from '@/components/shared/action-menu'
import {
  ApiError,
  api,
  type ActionScoreBand,
  type ActionScoreBandPreview,
  type ActionScoreFilter,
  type ActionScoreOverview,
  type ActionScoreRule,
  type ActionScoreRuleConfiguration,
  type ActionScoreSort,
  type FriendScoreDetail,
} from '@/lib/api'
import { actionScoreReasonLabel, formatMileageChange, formatMileageDate, formatMileageMonthDay, formatMileageNumber } from './mileage-display'
import { actionScoreAdjustmentErrorMessage } from './action-score-adjustment-dialog'
import styles from './mileage-v8.module.css'

const BAND_LABELS: Record<ActionScoreBand, string> = {
  high: '点が高い',
  normal: '中くらい',
  low: '低い',
}

/* 友だちの表の帯の札（絵は「高い・ふつう・低い」）。 */
const FRIEND_BAND_LABELS: Record<ActionScoreBand, string> = {
  high: '高い',
  normal: 'ふつう',
  low: '低い',
}

function bandPill(band: ActionScoreBand) {
  if (band === 'high') return `${styles.pill} ${styles.pillActive}`
  if (band === 'normal') return `${styles.pill} ${styles.pillWarn}`
  return `${styles.pill} ${styles.pillStopped}`
}

function bandName(band: ActionScoreBand, highMin: number, normalMin: number) {
  if (band === 'high') return `点が高い（${formatMileageNumber(highMin)}点〜）`
  if (band === 'normal') return `中くらい（${formatMileageNumber(normalMin)}〜${formatMileageNumber(highMin - 1)}点）`
  return `低い（〜${formatMileageNumber(normalMin - 1)}点）`
}

function bandOf(score: number, highMin: number, normalMin: number): ActionScoreBand {
  if (score >= highMin) return 'high'
  if (score >= normalMin) return 'normal'
  return 'low'
}

/* できごとの数え方の1行（板：1日1回まで・14日で消える）。 */
function frequencyText(rule: ActionScoreRule): string {
  const limit = rule.frequency.limit
  switch (rule.frequency.kind) {
    case 'unlimited': return '何回でも'
    case 'per_day': return `1日${limit}回まで`
    case 'per_subject': return '同じ対象は1回'
    case 'per_subject_per_day': return '同じ対象は1日1回'
    case 'once_per_period': return '期間中1回'
    default: return '数え方を確認できません'
  }
}

function ruleValueText(rule: ActionScoreRule): string {
  if (rule.operation === 'set') return `${formatMileageNumber(rule.value)}点にする`
  return `${rule.value > 0 ? '+' : ''}${formatMileageNumber(rule.value)}`
}

/* 公開版と下書きの差（IDごとに中身比べ）。 */
function ruleChanged(rule: ActionScoreRule, published: ActionScoreRule | undefined): boolean {
  if (!published) return true
  return rule.name !== published.name
    || rule.eventType !== published.eventType
    || rule.operation !== published.operation
    || rule.value !== published.value
    || rule.enabled !== published.enabled
    || rule.frequency.kind !== published.frequency.kind
    || rule.frequency.limit !== published.frequency.limit
}

type FriendsItem = ActionScoreOverview['items'][number]

export default function V8ScoreTab({
  readonly,
  registerHeaderActions,
}: {
  readonly: boolean
  registerHeaderActions: (node: ReactNode) => void
}) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const accountId = selectedAccountId ?? ''
  const latestAccountRef = useRef(accountId)
  useEffect(() => {
    latestAccountRef.current = accountId
  }, [accountId])
  const [overview, setOverview] = useState<ActionScoreOverview | null>(null)
  const [filter, setFilter] = useState<ActionScoreFilter>('all')
  const [sort, setSort] = useState<ActionScoreSort>('score_desc')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [adjustTarget, setAdjustTarget] = useState<FriendsItem | null>(null)
  const [historyTarget, setHistoryTarget] = useState<FriendsItem | null>(null)
  /* できごとの決めごと。 */
  const [config, setConfig] = useState<ActionScoreRuleConfiguration | null>(null)
  const [rulesLoading, setRulesLoading] = useState(true)
  const [rulesError, setRulesError] = useState(false)
  const [ruleSearchInput, setRuleSearchInput] = useState('')
  const [ruleSearch, setRuleSearch] = useState('')
  const [gainOnly, setGainOnly] = useState(false)
  const [loseOnly, setLoseOnly] = useState(false)
  const [ruleMenuId, setRuleMenuId] = useState<string | null>(null)
  const [rulesActionError, setRulesActionError] = useState('')
  const [rulesBusy, setRulesBusy] = useState(false)
  const [stopConfirm, setStopConfirm] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ActionScoreRule | null>(null)
  const [publishConfirm, setPublishConfirm] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState<ActionScoreBandPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const loadFriends = useCallback(async () => {
    const accountAtRequest = accountId
    if (!accountAtRequest) {
      setOverview(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(false)
    try {
      const response = await api.actionScores.friends({
        accountId: accountAtRequest,
        search: search || undefined,
        filter,
        sort,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setOverview(response.data)
    } catch {
      if (accountAtRequest !== latestAccountRef.current) return
      setOverview(null)
      setLoadError(true)
    } finally {
      if (accountAtRequest === latestAccountRef.current) setLoading(false)
    }
  }, [accountId, filter, page, pageSize, search, sort])

  // v7 と同じ6列（友だち・いまの点数・帯・30日間の変化・最後に点数が変わった理由・最終変動）。
  const exportCurrentPage = () => {
    if (!overview?.items.length) return
    const rows = overview.items.map((item) => [
      item.displayName,
      item.currentScore ?? '',
      BAND_LABELS[item.band],
      item.change30d ?? '',
      actionScoreReasonLabel(item.lastReason),
      formatMileageDate(item.lastChangedAt),
    ])
    const csv = [['友だち', 'いまの点数', '帯', '30日間の変化', '最後に点数が変わった理由', '最終変動'], ...rows]
      .map((row) => row.map((value) => csvCell(value)).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `action-scores-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const loadRules = useCallback(async () => {
    const accountAtRequest = accountId
    if (!accountAtRequest) {
      setConfig(null)
      setRulesLoading(false)
      return
    }
    setRulesLoading(true)
    setRulesError(false)
    try {
      const response = await api.actionScores.rules(accountAtRequest)
      if (accountAtRequest !== latestAccountRef.current) return
      if (!response.success) throw new Error(response.error)
      setConfig(response.data)
    } catch {
      if (accountAtRequest !== latestAccountRef.current) return
      setConfig(null)
      setRulesError(true)
    } finally {
      if (accountAtRequest === latestAccountRef.current) setRulesLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (accountLoading) return
    void loadFriends()
    void loadRules()
  }, [accountLoading, loadFriends, loadRules])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const timer = window.setTimeout(() => setRuleSearch(ruleSearchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [ruleSearchInput])

  const summary = overview?.summary
  const highMin = summary?.highMin ?? 30
  const normalMin = summary?.normalMin ?? 10
  const total = overview?.pagination.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const rangeQuery = useMemo(() => {
    if (filter !== 'high' && filter !== 'normal' && filter !== 'low') return null
    const query = new URLSearchParams()
    if (filter === 'high') query.set('scoreMin', String(highMin))
    if (filter === 'normal') {
      query.set('scoreMin', String(normalMin))
      query.set('scoreMax', String(highMin - 1))
    }
    if (filter === 'low') query.set('scoreMax', String(normalMin - 1))
    query.set('scoredOnly', '1')
    return query.toString()
  }, [filter, highMin, normalMin])
  const broadcastHref = rangeQuery ? `/broadcasts/new?${rangeQuery}` : '/broadcasts/new'

  const editable = config?.editableVersion ?? null
  const publishedRules = useMemo(() => {
    const map = new Map<string, ActionScoreRule>()
    for (const rule of config?.publishedVersion?.rules ?? []) map.set(rule.id, rule)
    return map
  }, [config])
  const rules = useMemo(() => {
    const keyword = ruleSearch.trim()
    return (editable?.rules ?? []).filter((rule) => {
      if (gainOnly && rule.value <= 0) return false
      if (loseOnly && rule.value >= 0) return false
      if (keyword && !rule.name.includes(keyword) && !rule.eventType.includes(keyword)) return false
      return true
    })
  }, [editable, gainOnly, loseOnly, ruleSearch])
  const publishedVersionNo = config?.publishedVersion?.versionNumber ?? null
  const hasDraftChanges = useMemo(() => {
    if (!editable) return false
    const published = [...publishedRules.values()]
    if (editable.rules.length !== published.length) return true
    return editable.rules.some((rule) => ruleChanged(rule, publishedRules.get(rule.id)))
  }, [editable, publishedRules])
  const draftVersionId = config?.currentDraftVersionId ?? null

  useEffect(() => {
    registerHeaderActions(
      <>
        <Button href="/mileage/score-rules" title="決めごとの編集画面で1人分を試します">1人で試す</Button>
        <Button href="/mileage/score-rules" title="決めごとの編集画面で保存します">下書きを保存</Button>
        {!readonly && draftVersionId ? (
          <Button variant="primary" onClick={() => setPublishConfirm(true)}>
            スコアのルールを公開
          </Button>
        ) : (
          <Button variant="primary" href="/mileage/score-rules" title="決めごとの編集画面で公開します">
            スコアのルールを公開
          </Button>
        )}
      </>,
    )
    return () => registerHeaderActions(null)
  }, [draftVersionId, readonly, registerHeaderActions])

  const publishDraft = async () => {
    if (readonly || !accountId || !draftVersionId) return
    setRulesBusy(true)
    setRulesActionError('')
    try {
      const response = await api.actionScores.publishRules({ accountId, draftVersionId })
      if (!response.success) throw new Error(response.error)
      setPublishConfirm(false)
      setConfig(response.data)
    } catch (caught) {
      setRulesActionError(caught instanceof ApiError && caught.status === 409
        ? 'ほかの人が先に公開しています。読み直してからやり直してください。'
        : '公開できませんでした。もう一度お試しください。')
    } finally {
      setRulesBusy(false)
    }
  }

  const stopPublished = async () => {
    if (readonly || !accountId) return
    setRulesBusy(true)
    setRulesActionError('')
    try {
      const response = await api.actionScores.stopRules(accountId)
      if (!response.success) throw new Error(response.error)
      setStopConfirm(false)
      setConfig(response.data)
    } catch {
      setRulesActionError('公開中のルールを止められませんでした。もう一度お試しください。')
    } finally {
      setRulesBusy(false)
    }
  }

  const removeRule = async (rule: ActionScoreRule) => {
    if (readonly || !accountId || !editable || !draftVersionId) return
    setRulesBusy(true)
    setRulesActionError('')
    try {
      const response = await api.actionScores.saveDraft({
        accountId,
        expectedDraftVersionId: draftVersionId,
        configuration: {
          rules: editable.rules.map((item) => (item.id === rule.id ? { ...item, enabled: false } : item)),
          bands: editable.bands,
        },
      }, { idempotencyKey: crypto.randomUUID() })
      if (!response.success) throw new Error(response.error)
      setRemoveTarget(null)
      setConfig(response.data)
    } catch (caught) {
      setRulesActionError(caught instanceof ApiError && caught.status === 409
        ? 'ほかの人が先に変えています。読み直してからやり直してください。'
        : '外せませんでした。もう一度お試しください。')
    } finally {
      setRulesBusy(false)
    }
  }

  const openPreview = async () => {
    if (!accountId || !editable || previewBusy) return
    setPreviewOpen(true)
    setPreview(null)
    setPreviewError('')
    setPreviewBusy(true)
    try {
      const response = await api.actionScores.previewBands({ accountId, bands: editable.bands })
      if (!response.success) throw new Error(response.error)
      setPreview(response.data)
    } catch {
      setPreviewError('試算できませんでした。もう一度お試しください。')
    } finally {
      setPreviewBusy(false)
    }
  }

  const resetFriendFilters = () => {
    setSearchInput('')
    setSearch('')
    setFilter('all')
    setSort('score_desc')
    setPage(1)
  }
  const resetRuleFilters = () => {
    setRuleSearchInput('')
    setRuleSearch('')
    setGainOnly(false)
    setLoseOnly(false)
  }

  const friendFilters: Array<{ key: ActionScoreFilter; label: string; count: number | undefined }> = [
    { key: 'all', label: 'すべて', count: summary?.scoredFriends },
    { key: 'high', label: '点が高い', count: summary?.high },
    { key: 'normal', label: '中くらい', count: summary?.normal },
    { key: 'low', label: '低い', count: summary?.low },
    { key: 'decreased', label: '下がっている', count: summary?.decreased30d },
  ]

  return (
    <>
      <div className={styles.kpis} role="group" aria-label="今の数">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Star size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>点が高い（{formatMileageNumber(highMin)}点〜）</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || loadError ? '—' : formatMileageNumber(summary?.high ?? 0)}
            <span className={styles.kpiUnit}> 人</span>
          </p>
          <p className={styles.kpiSub}>よく動く</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Activity size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>中くらい（{formatMileageNumber(normalMin)}〜{formatMileageNumber(highMin - 1)}点）</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || loadError ? '—' : formatMileageNumber(summary?.normal ?? 0)}
            <span className={styles.kpiUnit}> 人</span>
          </p>
          <p className={styles.kpiSub}>ふつう</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><TrendingDown size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>低い（〜{formatMileageNumber(normalMin - 1)}点）</span>
          </div>
          <p className={styles.kpiValue}>
            {loading || loadError ? '—' : formatMileageNumber(summary?.low ?? 0)}
            <span className={styles.kpiUnit}> 人</span>
          </p>
          <p className={styles.kpiSub}>しばらく動いていない</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Settings2 size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>公開中のルール</span>
          </div>
          <p className={styles.kpiValue}>
            {rulesLoading ? '—' : publishedVersionNo === null ? 'なし' : `版 ${formatMileageNumber(publishedVersionNo)}`}
          </p>
          <p className={styles.kpiSub}>
            {rulesLoading ? '—' : hasDraftChanges ? '下書きに変更あり' : '下書きとの差はありません'}
          </p>
        </div>
      </div>

      <p className={styles.band} role="note">
        <Info size={16} aria-hidden="true" />
        点数は、オートメーション（点が下がったら動かす）・シナリオ／一斉配信の宛先（帯で選ぶ）・分析（帯ごとの成果）で使えます。下書きの変更は、公開するまで使われません。
      </p>

      {rulesActionError ? <Notice tone="danger" message={rulesActionError} /> : null}

      <div className={styles.toolbar}>
        <SearchField
          aria-label="友だちの名前で探す"
          value={searchInput}
          onChange={setSearchInput}
          onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setPage(1)
              setSearch(searchInput.trim())
            }
          }}
          placeholder="友だちの名前で探す"
        />
        {friendFilters.map((item) => (
          <FilterChip
            key={item.key}
            selected={filter === item.key}
            onChange={() => { setPage(1); setFilter(item.key) }}
            count={item.count === undefined ? '—' : formatMileageNumber(item.count)}
          >
            {item.label}
          </FilterChip>
        ))}
        <span className={styles.toolbarRight}>
          <Button onClick={exportCurrentPage} disabled={!overview?.items.length}>
            <Download size={14} aria-hidden="true" /> この頁の行動スコアをCSVで書き出す
          </Button>
          <Button href={broadcastHref}>
            <Send size={14} aria-hidden="true" /> この帯の人に送る
          </Button>
          <Select
            aria-label="よく使う絞り込み"
            value={`${filter}:${sort}`}
            options={[
              { value: 'all:score_desc', label: 'よく使う絞り込み' },
              { value: 'all:score_desc', label: '点数が高い順' },
              { value: 'all:score_asc', label: '点数が低い順' },
              { value: 'decreased:change_asc', label: '下がっている・下がり幅が大きい順' },
              { value: 'high:score_desc', label: '点が高い帯のみ' },
              { value: 'low:score_desc', label: '低い帯のみ' },
            ]}
            onChange={(value) => {
              const [nextFilter, nextSort] = value.split(':')
              setPage(1)
              setFilter(nextFilter as ActionScoreFilter)
              setSort(nextSort as ActionScoreSort)
            }}
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
      ) : loadError ? (
        <div className={styles.stateWrap}>
          <div className={styles.errorBand} role="alert">
            行動スコアを読み込めませんでした
            <span className={styles.errorRetry}>
              <Button type="button" onClick={() => void loadFriends()}>もう一度試す</Button>
            </span>
          </div>
          <p className={styles.errorNote}>数の帯は「—」にしています。道具はそのまま使えます。</p>
        </div>
      ) : !overview?.items.length ? (
        <div className={styles.stateWrap}>
          <div className={styles.stateCard}>
            <p className={styles.stateTitle}>条件に合う友だちがいません</p>
            <p className={styles.stateDesc}>帯または検索条件を変えてください。</p>
            <div className={styles.stateActions}>
              <Button type="button" onClick={resetFriendFilters}>条件を外す</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">友だち</th>
                <th scope="col">いまの点数</th>
                <th scope="col">帯</th>
                <th scope="col">30日間の変化</th>
                <th scope="col">最後の反応</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {overview.items.map((item) => (
                <tr key={item.friendId}>
                  <td>
                    <p className={styles.cellMain} title={item.displayName}>{item.displayName}</p>
                  </td>
                  <td><span className={styles.num}>{formatMileageNumber(item.currentScore)}</span></td>
                  <td><span className={bandPill(item.band)}>{FRIEND_BAND_LABELS[item.band]}</span></td>
                  <td>
                    <span className={styles.num}>
                      {typeof item.change30d === 'number' && Number.isFinite(item.change30d)
                        ? formatMileageChange(item.change30d)
                        : '—'}
                    </span>
                  </td>
                  <td>
                    <p className={styles.cellSubDark} title={actionScoreReasonLabel(item.lastReason)}>
                      {formatMileageMonthDay(item.lastChangedAt) === '—'
                        ? actionScoreReasonLabel(item.lastReason)
                        : `${formatMileageMonthDay(item.lastChangedAt)} ${actionScoreReasonLabel(item.lastReason)}`}
                    </p>
                  </td>
                  <td>
                    <span className={styles.rowActions}>
                      <Button onClick={() => setHistoryTarget(item)}>点数の変化</Button>
                      {!readonly ? (
                        <>
                          <IconButton
                            aria-label={`${item.displayName}のその他操作`}
                            title="その他の操作"
                            onClick={() => setMenuId((current) => (current === item.friendId ? null : item.friendId))}
                          >
                            <MoreHorizontal size={14} aria-hidden="true" />
                          </IconButton>
                          <ActionMenu
                            open={menuId === item.friendId}
                            ariaLabel={`${item.displayName}の操作`}
                            onClose={() => setMenuId(null)}
                            items={[
                              {
                                id: 'adjust',
                                label: '点数を直す',
                                onSelect: () => setAdjustTarget(item),
                              },
                              {
                                id: 'friend',
                                label: 'この人を見る',
                                external: true,
                                onSelect: () => { window.location.href = `/friends/detail?id=${encodeURIComponent(item.friendId)}` },
                              },
                            ]}
                          />
                        </>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !loadError && total > 0 ? (
        <div className={styles.footer}>
          <span className={styles.footerCount}>
            {formatMileageNumber(total)}件中 {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, total)}件
          </span>
          {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
        </div>
      ) : null}

      <section aria-label="できごとの決めごと">
        <div className={styles.toolbar}>
          <p className={styles.cellSubDark}><strong>できごと（数え方）</strong></p>
          {!readonly && publishedVersionNo !== null ? (
            <span className={styles.toolbarRight}>
              <IconButton
                aria-label="公開中のルールの操作"
                title="公開中のルールの操作"
                onClick={() => setRuleMenuId((current) => (current === '__head' ? null : '__head'))}
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </IconButton>
              <ActionMenu
                open={ruleMenuId === '__head'}
                ariaLabel="公開中のルールの操作"
                onClose={() => setRuleMenuId(null)}
                items={[
                  {
                    id: 'stop',
                    label: '公開中のルールを止める',
                    tone: 'danger',
                    disabled: rulesBusy,
                    disabledReason: '反映しています',
                    onSelect: () => setStopConfirm(true),
                  },
                  {
                    id: 'edit',
                    label: '決めごとの編集画面を開く',
                    external: true,
                    onSelect: () => { window.location.href = '/mileage/score-rules' },
                  },
                ]}
              />
            </span>
          ) : null}
        </div>

        <div className={styles.toolbar}>
          <SearchField
            aria-label="できごとで探す"
            value={ruleSearchInput}
            onChange={setRuleSearchInput}
            onClear={() => { setRuleSearchInput(''); setRuleSearch('') }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setRuleSearch(ruleSearchInput.trim())
            }}
            placeholder="できごとで探す"
          />
          <FilterChip
            selected={gainOnly}
            onChange={(selected) => { setGainOnly(selected); if (selected) setLoseOnly(false) }}
          >
            足す点
          </FilterChip>
          <FilterChip
            selected={loseOnly}
            onChange={(selected) => { setLoseOnly(selected); if (selected) setGainOnly(false) }}
          >
            引く点
          </FilterChip>
          <Button onClick={() => void openPreview()}>
            この分けかただと何人入るか
          </Button>
          <span className={styles.toolbarRight}>
            <Button href={broadcastHref}>
              <Send size={14} aria-hidden="true" /> この帯の人に送る
            </Button>
            <Button href="/mileage/score-rules">
              <Settings2 size={14} aria-hidden="true" /> スコアのルールを作る
            </Button>
          </span>
        </div>

        {rulesLoading ? (
          <div className={styles.stateWrap} role="status" aria-label="読み込み中">
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skelRow} aria-hidden="true">
                <span className={styles.skelDot} />
                <span className={styles.skelBar} style={{ width: '30%' }} />
                <span className={styles.skelBar} style={{ width: '12%', marginLeft: 'auto' }} />
              </div>
            ))}
          </div>
        ) : rulesError || !editable ? (
          <div className={styles.stateWrap}>
            <div className={styles.errorBand} role="alert">
              できごとの決めごとを読み込めませんでした
              <span className={styles.errorRetry}>
                <Button type="button" onClick={() => void loadRules()}>もう一度試す</Button>
              </span>
            </div>
          </div>
        ) : rules.length === 0 ? (
          <div className={styles.stateWrap}>
            <div className={styles.stateCard}>
              <p className={styles.stateTitle}>条件に合うできごとはありません</p>
              <p className={styles.stateDesc}>検索や絞り込みを外すと、すべて出ます</p>
              <div className={styles.stateActions}>
                <Button type="button" onClick={resetRuleFilters}>条件を外す</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">できごと（数え方）</th>
                  <th scope="col">点・今月当てはまった人</th>
                  <th scope="col">状態</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const published = publishedRules.get(rule.id)
                  const changed = ruleChanged(rule, published)
                  const stopped = !rule.enabled
                  return (
                    <tr key={rule.id}>
                      <td>
                        <p className={styles.cellMain} title={rule.name}>{rule.name}</p>
                        <p className={styles.cellSub}>{frequencyText(rule)}</p>
                      </td>
                      <td>
                        <span className={styles.num}>{ruleValueText(rule)}</span>
                      </td>
                      <td>
                        {stopped ? (
                          <span className={`${styles.pill} ${styles.pillStopped}`}>止めている</span>
                        ) : changed ? (
                          <span className={`${styles.pill} ${styles.pillWarn}`}>下書きで変更</span>
                        ) : (
                          <span className={`${styles.pill} ${styles.pillActive}`}>公開中</span>
                        )}
                      </td>
                      <td>
                        {!readonly ? (
                          <span className={styles.rowActions}>
                            <IconButton
                              aria-label={`${rule.name}の操作`}
                              title="操作"
                              onClick={() => setRuleMenuId((current) => (current === rule.id ? null : rule.id))}
                            >
                              <MoreHorizontal size={14} aria-hidden="true" />
                            </IconButton>
                            <ActionMenu
                              open={ruleMenuId === rule.id}
                              ariaLabel={`${rule.name}の操作`}
                              onClose={() => setRuleMenuId(null)}
                              items={[
                                {
                                  id: 'edit',
                                  label: '編集',
                                  external: true,
                                  onSelect: () => { window.location.href = '/mileage/score-rules' },
                                },
                                {
                                  id: 'remove',
                                  label: '外す',
                                  tone: 'danger',
                                  disabled: rulesBusy || stopped,
                                  disabledReason: stopped ? 'すでに外しています' : '反映しています',
                                  onSelect: () => setRemoveTarget(rule),
                                },
                              ]}
                            />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!readonly ? (
          <div className={styles.toolbar}>
            <Button href="/mileage/score-rules">
              <Plus size={14} aria-hidden="true" /> できごとを足す
            </Button>
          </div>
        ) : null}
        <p className={styles.footnote}>行の「…」から 編集・外す。表の下の「＋ できごとを足す」で増やせます（30日間反応がない、も選べる）。公開中のルールを止めるときは、題の横の「…」から。</p>
      </section>

      {adjustTarget && !readonly ? (
        <V8ScoreAdjustDialog
          accountId={accountId}
          friendId={adjustTarget.friendId}
          friendName={adjustTarget.displayName}
          currentScore={adjustTarget.currentScore}
          highMin={highMin}
          normalMin={normalMin}
          band={adjustTarget.band}
          onCancel={() => setAdjustTarget(null)}
          onCompleted={async () => { await loadFriends() }}
        />
      ) : null}

      {historyTarget ? (
        <V8ScoreHistoryDialog
          friendId={historyTarget.friendId}
          friendName={historyTarget.displayName}
          currentScore={historyTarget.currentScore}
          band={historyTarget.band}
          highMin={highMin}
          normalMin={normalMin}
          onCancel={() => setHistoryTarget(null)}
        />
      ) : null}

      <ConfirmDialog
        open={publishConfirm}
        title="下書きの決めごとを公開しますか？"
        description="公開すると、いまの点数の分けかたと決めごとが友だちの点数に使われます。取り消せません。"
        confirmLabel="公開する"
        destructive
        busy={rulesBusy}
        error={rulesActionError || undefined}
        onCancel={() => { if (!rulesBusy) setPublishConfirm(false) }}
        onConfirm={() => void publishDraft()}
      />

      <ConfirmDialog
        open={stopConfirm}
        title="公開中のルールを止めますか？"
        description="止めている間は、できごとがあっても点数は動きません。下書きは残ります。"
        confirmLabel="止める"
        destructive
        busy={rulesBusy}
        error={rulesActionError || undefined}
        onCancel={() => { if (!rulesBusy) setStopConfirm(false) }}
        onConfirm={() => void stopPublished()}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title={removeTarget ? `「${removeTarget.name}」を外しますか？` : 'できごとを外しますか？'}
        description="決めごとの一覧から外します（無効にします）。記録そのものは残ります。"
        confirmLabel="外す"
        destructive
        busy={rulesBusy}
        error={rulesActionError || undefined}
        onCancel={() => { if (!rulesBusy) setRemoveTarget(null) }}
        onConfirm={() => { if (removeTarget) void removeRule(removeTarget) }}
      />

      <Dialog
        open={previewOpen}
        title="この分けかただと何人入るか"
        description="いまの下書きの分けかたで、点数がついている友だちがどの帯に入るかを数えます。公開も点数の変更もしません。"
        confirmLabel="閉じる"
        onConfirm={() => setPreviewOpen(false)}
        onCancel={() => setPreviewOpen(false)}
        busy={previewBusy}
      >
        {previewError ? (
          <Notice tone="danger" message={previewError} />
        ) : preview ? (
          <dl className={styles.kpis} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>点が高い</p>
              <p className={styles.kpiValue}>{formatMileageNumber(preview.counts.high)}<span className={styles.kpiUnit}> 人</span></p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>中くらい</p>
              <p className={styles.kpiValue}>{formatMileageNumber(preview.counts.normal)}<span className={styles.kpiUnit}> 人</span></p>
            </div>
            <div className={styles.kpi}>
              <p className={styles.kpiLabel}>低い</p>
              <p className={styles.kpiValue}>{formatMileageNumber(preview.counts.low)}<span className={styles.kpiUnit}> 人</span></p>
            </div>
          </dl>
        ) : (
          <ListState kind="loading" title="数えています" description="点数の変更は行いません。" />
        )}
      </Dialog>
    </>
  )
}

/*
 * 点数を手で直す（板 `Nv7An`）。
 * 口と約束（理由必須・追記だけ・再送しても二重反映しない）は
 * v7（action-score-adjustment-dialog.tsx）と同じ。見せ方だけ V8。
 */
function V8ScoreAdjustDialog({
  accountId,
  friendId,
  friendName,
  currentScore,
  highMin,
  normalMin,
  band,
  onCancel,
  onCompleted,
}: {
  accountId: string
  friendId: string
  friendName: string
  currentScore: number
  highMin: number
  normalMin: number
  band: ActionScoreBand
  onCancel: () => void
  onCompleted: () => Promise<void>
}) {
  const [direction, setDirection] = useState<'increase' | 'decrease'>('decrease')
  const [amountText, setAmountText] = useState('10')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const idempotencyKey = useRef(crypto.randomUUID())
  const amount = Number(amountText)
  const validAmount = Number.isInteger(amount) && amount > 0 && amount <= 1_000_000
  const delta = direction === 'decrease' ? -amount : amount
  const scoreAfter = validAmount ? currentScore + delta : currentScore
  const bandAfter = bandOf(scoreAfter, highMin, normalMin)
  const bandChanges = validAmount && bandAfter !== band

  const submit = async () => {
    if (!validAmount) {
      setError('1以上1000000以下の整数で点数を入力してください')
      return
    }
    if (!reason.trim()) {
      setError('理由を入力してください。')
      return
    }
    if (reason.trim().length > 500) {
      setError('理由は500文字以内で入力してください')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await api.actionScores.adjust(
        { accountId, friendId, direction, amount, reason: reason.trim() },
        idempotencyKey.current,
      )
      if (!response.success) throw new Error(response.error)
      await onCompleted()
      onCancel()
    } catch (caught) {
      setError(actionScoreAdjustmentErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const confirmLabel = validAmount
    ? direction === 'decrease'
      ? `${formatMileageNumber(amount)}点減らす`
      : `${formatMileageNumber(amount)}点増やす`
    : '点数を変更する'

  return (
    <Dialog
      open
      title="点数を手で直す"
      description="記録に残ります。お客様には見えない運用メモとして、あとから理由をたどれるようにしてください。"
      confirmLabel={confirmLabel}
      cancelLabel="キャンセル"
      busy={busy}
      error={error || undefined}
      onConfirm={() => void submit()}
      onCancel={() => { if (!busy) onCancel() }}
    >
      <p className={styles.dlgLabel}>だれの点数を動かしますか</p>
      <div className={styles.dlgPerson}>
        <span className={styles.dlgAvatar} aria-hidden="true">{friendName.slice(0, 1)}</span>
        <div>
          <p className={styles.dlgPersonName}>{friendName}</p>
          <p className={styles.dlgPersonSub}>
            いま {formatMileageNumber(currentScore)}点・{bandName(band, highMin, normalMin)}
          </p>
        </div>
      </div>

      <p className={styles.dlgLabel}>増やすか減らすか</p>
      <div className={styles.seg} role="group" aria-label="増やすか減らすか">
        {(['increase', 'decrease'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={styles.segButton}
            aria-pressed={direction === value}
            onClick={() => setDirection(value)}
          >
            {value === 'increase' ? '増やす' : '減らす'}
          </button>
        ))}
      </div>

      <p className={styles.dlgLabel}>点数</p>
      <input
        className={styles.dlgInput}
        inputMode="numeric"
        value={amountText}
        onChange={(event) => setAmountText(event.target.value.replace(/[^0-9]/g, ''))}
        aria-label="点数"
      />

      <p className={styles.dlgLabel}>理由</p>
      <textarea
        className={styles.dlgTextarea}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-label="理由"
      />

      <p className={styles.dlgLabel}>この変更で起きること</p>
      <div className={styles.delta3}>
        <div className={styles.deltaCell}>
          <p className={styles.deltaLabel}>変更前</p>
          <p className={styles.deltaValue}>{formatMileageNumber(currentScore)} 点</p>
        </div>
        <div className={styles.deltaCell}>
          <p className={styles.deltaLabel}>変更量</p>
          <p className={styles.deltaValue}>{validAmount ? `${delta > 0 ? '+' : ''}${formatMileageNumber(delta)} 点` : '—'}</p>
        </div>
        <div className={styles.deltaCell}>
          <p className={styles.deltaLabel}>変更後</p>
          <p className={styles.deltaValue}>{validAmount ? `${formatMileageNumber(scoreAfter)} 点` : '—'}</p>
        </div>
      </div>

      {bandChanges ? (
        <p className={`${styles.band} ${styles.bandWarn}`} role="note">
          帯が「{BAND_LABELS[band]}」から「{BAND_LABELS[bandAfter]}」に変わります。帯で選んでいる配信・オートメーションの宛先から外れることがあります。
        </p>
      ) : null}
    </Dialog>
  )
}

/*
 * 点数の変化の明細（板 `R8NNi`）。
 * いつ・できごと・点・合計（新しい順。合計は上から足し引きが合う）。
 */
function V8ScoreHistoryDialog({
  friendId,
  friendName,
  currentScore,
  band,
  highMin,
  normalMin,
  onCancel,
}: {
  friendId: string
  friendName: string
  currentScore: number | null
  band: ActionScoreBand
  highMin: number
  normalMin: number
  onCancel: () => void
}) {
  const [detail, setDetail] = useState<FriendScoreDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let current = true
    setDetail(null)
    setError(false)
    setLoading(true)
    void api.scoring.friendScore(friendId)
      .then((response) => {
        if (!current) return
        if (!response.success) throw new Error(response.error)
        setDetail(response.data)
      })
      .catch(() => {
        if (!current) return
        setDetail(null)
        setError(true)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => { current = false }
  }, [friendId, retry])

  const items = useMemo(
    () => [...(detail?.history ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [detail],
  )

  return (
    <Dialog
      open
      designNode="R8NNi"
      title="点数の変化の明細"
      description="いつ・何で点数が変わったかを新しい順に並べています。スコアは配信や対応の順番を決める目安で、お客様には見えず、マイル残高は増えも減りもしません。"
      footer={<div className="flex justify-end"><Button variant="secondary" onClick={onCancel}>閉じる</Button></div>}
      onCancel={onCancel}
      busy={loading}
    >
      <div className={styles.dlgPerson}>
        <span className={styles.dlgAvatar} aria-hidden="true">{friendName.slice(0, 1)}</span>
        <div>
          <p className={styles.dlgPersonName}>{friendName}</p>
          <p className={styles.dlgPersonSub}>
            いま {detail?.currentScore != null || currentScore != null ? formatMileageNumber(detail?.currentScore ?? currentScore!) : '—'}点・{bandName(band, highMin, normalMin)}
          </p>
        </div>
      </div>

      {loading ? (
        <ListState kind="loading" title="点数の変化を読み込んでいます" />
      ) : error ? (
        <ListState kind="error" title="点数の明細を表示できませんでした" description="登録した点数は変わっていません。" onRetry={() => setRetry((value) => value + 1)} />
      ) : items.length === 0 ? (
        <ListState
          kind="empty"
          title="点数が変わった記録はありません"
          description="メッセージへの返信やリンクのクリックなど、決めたきっかけがあると記録されます。"
        />
      ) : (
        <table className={`${styles.miniTable} ${styles.scoreHistoryTable}`}>
          <thead>
            <TableHeadRow><Th>いつ</Th><Th>できごと</Th><Th align="right">点</Th><Th align="right">合計</Th></TableHeadRow>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <time dateTime={item.occurredAt}>{formatMileageDate(item.occurredAt)}</time>
                </td>
                <td>{actionScoreReasonLabel(item.reason?.trim() ? item.reason : null)}</td>
                <td>
                  <span className={styles.num} data-score-delta={item.scoreChange > 0 ? 'positive' : item.scoreChange < 0 ? 'negative' : 'zero'}>
                    {item.scoreChange > 0 ? `+${formatMileageNumber(item.scoreChange)}` : `${formatMileageNumber(item.scoreChange)}`}
                  </span>
                </td>
                <td><span className={styles.num}>{item.scoreAfter === null ? '—' : formatMileageNumber(item.scoreAfter)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  )
}
