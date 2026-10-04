'use client'

/*
 * ★V8-B マイル「使い道」（板 `S35pO`、状態 `zaqP9`、閲覧のみ `E2Any`）。
 *
 * データの口は v7（mileage-rewards-tab.tsx）と同じ口へ取りに行く。
 * 表は「使い道・必要なマイル・交換すると渡るもの・今月交換された・
 * 状態・操作（中身を見る・止める／出す）」。要対応の交換（届かなかった
 * 分のやり直し）は表の下に残す。
 *
 * フォルダの列に割り当てる API は無いので、渡すものの種類で分けた
 * 見え方の切り替えとして Djb で持つ（保存はしない）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeftRight, Gift, Info, Plus, Star } from 'lucide-react'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FilterChip from '@/components/shared/filter-chip'
import HelpTip from '@/components/shared/help-tip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'
import PageSizeSelect from '@/components/ui/page-size-select'
import {
  ApiError,
  api,
  fetchApi,
  type MileageRewardKind,
  type MileageRewardStatus,
  type MileageRewardSummary,
} from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'
import { formatMileageDate, formatMileageNumber } from './mileage-display'
import { formatNumber } from '@/lib/format'
import { V8CreateButton } from './mileage-v8'
import styles from './mileage-v8.module.css'

const KIND_LABEL: Record<MileageRewardKind, string> = {
  coupon: 'クーポン',
  tag: 'タグ',
  scenario: 'シナリオ',
  template: 'メッセージ',
  early_access: '先にお知らせ',
  rank: 'ランク',
}

const KIND_FOLDER: Record<MileageRewardKind, 'クーポン' | 'タグ・メッセージ' | 'シナリオ' | '先行・ランク'> = {
  coupon: 'クーポン',
  tag: 'タグ・メッセージ',
  template: 'タグ・メッセージ',
  scenario: 'シナリオ',
  early_access: '先行・ランク',
  rank: '先行・ランク',
}

const FOLDERS = ['すべて', 'クーポン', 'タグ・メッセージ', 'シナリオ', '先行・ランク', '未分類'] as const
type Folder = (typeof FOLDERS)[number]

function folderOf(reward: MileageRewardSummary): Exclude<Folder, 'すべて'> {
  return KIND_FOLDER[reward.rewardKind] ?? '未分類'
}

function statusPill(status: MileageRewardStatus) {
  if (status === 'published') return { text: '出している', className: `${styles.pill} ${styles.pillActive}` }
  if (status === 'draft') return { text: '下書き', className: `${styles.pill} ${styles.pillStopped}` }
  if (status === 'stopped') return { text: '止めています', className: `${styles.pill} ${styles.pillStopped}` }
  return { text: '片づけました', className: `${styles.pill} ${styles.pillStopped}` }
}

/* 交換すると渡るものの2行目（残り・期限）。 */
function benefitSub(reward: MileageRewardSummary): string | null {
  const version = reward.currentVersion
  if (!version) return null
  const parts: string[] = []
  if (reward.availableCodeCount !== null) {
    parts.push(`残り ${formatNumber(reward.availableCodeCount)}`)
  } else if (version.stockLimit !== null) {
    parts.push('残り数は取れていません')
  } else {
    parts.push('残り制限なし')
  }
  if (version.endsAt) {
    const short = formatMileageDate(version.endsAt).replace(/^\d+\//, '')
    parts.push(`${short}まで`)
  }
  return parts.join('・')
}

interface FailedRedemption {
  id: string
  rewardName: string
  status: string
  attemptCount: number
  failureCode: string | null
  failureMessage: string | null
  updatedAt: string
}

interface RedemptionHistory {
  items: FailedRedemption[]
  pagination: { total: number; limit: number; offset: number }
}

const REDEMPTIONS_PAGE_SIZE = 20

type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

const PRESETS: Array<{ value: string; label: string }> = [
  { value: 'default', label: '既定の見方' },
  { value: 'published-exchanged', label: '出している・交換が多い順' },
  { value: 'draft', label: '下書きのみ' },
  { value: 'miles-asc', label: '必要なマイルが少ない順' },
]

export default function V8RewardsTab({
  readonly,
  registerHeaderActions,
}: {
  readonly: boolean
  registerHeaderActions: (node: ReactNode) => void
}) {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const accountId = selectedAccountId
  const [rewards, setRewards] = useState<MileageRewardSummary[]>([])
  const [reachMetrics, setReachMetrics] = useState<Array<{ rewardId: string; reachableFriendCount: number }>>([])
  const [redeemedMiles, setRedeemedMiles] = useState<number | null>(null)
  const [exchangedCount, setExchangedCount] = useState<number | null>(null)
  const [popularName, setPopularName] = useState<string | null>(null)
  const [popularCount, setPopularCount] = useState<number | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [failed, setFailed] = useState<FailedRedemption[]>([])
  const [redemptionsVisible, setRedemptionsVisible] = useState(false)
  const [redemptionsLoad, setRedemptionsLoad] = useState<LoadStatus>('loading')
  const [redemptionsPage, setRedemptionsPage] = useState(1)
  const [redemptionsTotal, setRedemptionsTotal] = useState(0)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState('')
  const [retryNotice, setRetryNotice] = useState('')
  /*
   * 出す・止める・届け直しは押した直後に動かさない。確認の窓で
   * 中身を読み合わせてから動かす（間違えない・怖くない）。
   */
  const [stateTarget, setStateTarget] = useState<MileageRewardSummary | null>(null)
  const [retryTarget, setRetryTarget] = useState<FailedRedemption | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState<Folder>('すべて')
  const [publishedOnly, setPublishedOnly] = useState(false)
  const [draftOnly, setDraftOnly] = useState(false)
  const [preset, setPreset] = useState('default')
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    if (!accountId) {
      if (request !== requestRef.current) return
      setRewards([])
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const response = await api.mileage.rewards(accountId)
      if (request !== requestRef.current) return
      if (!response.success) throw new Error(response.error)
      if (!Array.isArray(response.data?.rewards)) throw new Error('malformed')
      const list = response.data.rewards
      setRewards(list)
      const overviewSummary = response.data.summary
      setRedeemedMiles(overviewSummary?.redeemedMilesThisMonth ?? null)
      setExchangedCount(list.reduce((sum, r) => sum + r.exchangedThisMonth, 0))
      /*
       * 1回も交換されていないのに名指ししない（v7 と同じ）。
       * 回数が0ならまだ誰も使っていない。
       */
      const redeemedCount = overviewSummary?.mostRedeemedRewardCount ?? null
      setPopularName(redeemedCount ? (overviewSummary?.mostRedeemedRewardName ?? null) : null)
      setPopularCount(redeemedCount)
      setReachMetrics(Array.isArray(response.data.reachMetrics) ? response.data.reachMetrics : [])
      setStatus('ready')
    } catch (reason) {
      if (request !== requestRef.current) return
      setRewards([])
      setStatus(reason instanceof Error && reason.message === 'forbidden' ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  const loadFailed = useCallback(async (pageNumber: number) => {
    if (!accountId) {
      setFailed([])
      setRedemptionsVisible(false)
      setRedemptionsLoad('loading')
      setRedemptionsTotal(0)
      return
    }
    setRedemptionsLoad('loading')
    try {
      const offset = (Math.max(1, pageNumber) - 1) * REDEMPTIONS_PAGE_SIZE
      const response = await fetchApi<ApiResponse<RedemptionHistory>>(
        `/api/mileage/redemptions?accountId=${encodeURIComponent(accountId)}`
        + `&limit=${REDEMPTIONS_PAGE_SIZE}&offset=${offset}`,
      )
      if (!response.success) throw new Error(response.error)
      if (!Array.isArray(response.data?.items)) throw new Error('malformed')
      setFailed(response.data.items.filter(
        (item) => item.status === 'delivery_failed' || item.status === 'delivering',
      ))
      const total = response.data.pagination?.total ?? 0
      setRedemptionsTotal(total)
      if (response.data.items.length === 0 && total > 0 && Math.max(1, pageNumber) > 1) {
        setRedemptionsPage(1)
      }
      setRedemptionsVisible(true)
      setRedemptionsLoad('ready')
    } catch (reason) {
      setFailed([])
      setRedemptionsVisible(true)
      setRedemptionsTotal(0)
      const forbidden = reason instanceof ApiError
        && (reason.status === 403 || reason.code === 'forbidden')
      setRedemptionsLoad(forbidden ? 'forbidden' : 'error')
    }
  }, [accountId])

  useEffect(() => {
    void loadFailed(redemptionsPage)
  }, [loadFailed, redemptionsPage])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const retryRedemption = async (item: FailedRedemption) => {
    if (!accountId || retryingId) return
    setRetryingId(item.id)
    setRetryError('')
    setRetryNotice('')
    setRetryTarget(null)
    try {
      const response = await fetchApi<{ success: boolean; data?: { message?: string | null; redemption?: { status?: string } }; error?: string }>(
        `/api/mileage/redemptions/${encodeURIComponent(item.id)}/retry-fulfillment`,
        { method: 'POST', body: JSON.stringify({ accountId }) },
      )
      const redemptionStatus = response.data?.redemption?.status
      const serverMessage = typeof response.data?.message === 'string' && response.data.message.trim()
        ? response.data.message
        : null
      if (!response.success && redemptionStatus === 'refunded') {
        setRetryNotice(serverMessage ?? '交換したマイルを戻しました。')
      } else if (!response.success && redemptionStatus === 'delivering') {
        setRetryNotice(serverMessage ?? '特典の送信結果を確認しています。確定するまでお待ちください。')
      } else if (!response.success) {
        throw new Error(response.error)
      }
      await loadFailed(redemptionsPage)
      await load()
    } catch {
      setRetryError('やり直せませんでした。時間をおいてもう一度お試しください。')
      await loadFailed(redemptionsPage)
    } finally {
      setRetryingId(null)
    }
  }

  const changeState = async (reward: MileageRewardSummary) => {
    if (readonly || !accountId
      || (reward.status !== 'published' && reward.status !== 'draft' && reward.status !== 'stopped')) return
    setBusyId(reward.id)
    setActionError('')
    setStateTarget(null)
    try {
      const response = reward.status === 'published'
        ? await api.mileage.stopReward(reward.id, accountId)
        : reward.status === 'stopped'
          ? await api.mileage.resumeReward(reward.id, accountId)
          : await api.mileage.publishReward(
          reward.id,
          accountId,
          reward.currentDraftVersionId ?? reward.currentVersion?.id ?? undefined,
          reward.currentVersion?.revision,
        )
      if (!response.success) throw new Error(response.error)
      await load()
    } catch {
      setActionError(reward.status === 'published'
        ? '使い道を止められませんでした。もう一度お試しください。'
        : reward.status === 'stopped'
          ? '使い道をまた出せませんでした。もう一度お試しください。'
          : '使い道を公開できませんでした。内容を確認してもう一度お試しください。')
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    registerHeaderActions(null)
    return () => registerHeaderActions(null)
  }, [registerHeaderActions])

  const publishedCount = rewards.filter((r) => r.status === 'published').length
  const draftCount = rewards.filter((r) => r.status === 'draft').length
  const folderCounts = useMemo(() => {
    const counts = new Map<Folder, number>()
    counts.set('すべて', rewards.length)
    counts.set('未分類', 0)
    for (const reward of rewards) {
      const key = folderOf(reward)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [rewards])

  const shown = useMemo(() => {
    const keyword = search.trim()
    const filtered = rewards.filter((reward) => {
      if (folder !== 'すべて' && folderOf(reward) !== folder) return false
      if (publishedOnly && reward.status !== 'published') return false
      if (draftOnly && reward.status !== 'draft') return false
      if (keyword && !reward.name.includes(keyword)) return false
      return true
    })
    if (preset === 'published-exchanged') {
      return [...filtered]
        .filter((r) => r.status === 'published')
        .sort((a, b) => b.exchangedThisMonth - a.exchangedThisMonth)
    }
    if (preset === 'draft') return filtered.filter((r) => r.status === 'draft')
    if (preset === 'miles-asc') {
      return [...filtered].sort(
        (a, b) => (a.currentVersion?.requiredMiles ?? 0) - (b.currentVersion?.requiredMiles ?? 0),
      )
    }
    return [...filtered].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [draftOnly, folder, preset, publishedOnly, rewards, search])

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const visible = shown.slice((page - 1) * pageSize, page * pageSize)
  const resetAll = () => {
    setSearchInput('')
    setSearch('')
    setFolder('すべて')
    setPublishedOnly(false)
    setDraftOnly(false)
    setPreset('default')
    setPage(1)
  }
  const failedTotal = redemptionsTotal

  return (
    <>
      <div className={styles.kpis} role="group" aria-label="今の数">
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Gift size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>使い道</span>
          </div>
          <p className={styles.kpiValue}>
            {status !== 'ready' ? '—' : formatMileageNumber(rewards.length)}
            <span className={styles.kpiUnit}> 件</span>
          </p>
          <p className={styles.kpiSub}>
            {status !== 'ready'
              ? '—'
              : `出している ${formatMileageNumber(publishedCount)}・下書き ${formatMileageNumber(draftCount)}`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><ArrowLeftRight size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>今月交換</span>
          </div>
          <p className={styles.kpiValue}>
            {status !== 'ready' ? '—' : formatMileageNumber(exchangedCount ?? 0)}
            <span className={styles.kpiUnit}> 件</span>
          </p>
          <p className={styles.kpiSub}>
            {status !== 'ready' ? '—' : `${formatMileageNumber(redeemedMiles ?? 0)} マイル`}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><Star size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>いちばん人気</span>
          </div>
          <p className={styles.kpiValue} style={{ fontSize: 20 }} title={popularName ?? undefined}>
            {status !== 'ready' ? '—' : (popularName ?? '—')}
          </p>
          <p className={styles.kpiSub}>
            {status !== 'ready' ? '—' : popularName ? `今月 ${formatMileageNumber(popularCount ?? 0)}件` : 'まだ交換されていません'}
          </p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiIcon}><AlertCircle size={14} aria-hidden="true" /></span>
            <span className={styles.kpiLabel}>渡せなかった</span>
          </div>
          <p className={styles.kpiValue}>
            {redemptionsLoad === 'loading' ? '—' : formatMileageNumber(failedTotal)}
            <span className={styles.kpiUnit}> 件</span>
          </p>
          <p className={styles.kpiSub}>
            {failed.length > 0 ? failed[0].rewardName : '要対応の交換はありません'}
          </p>
        </div>
      </div>

      {actionError ? <Notice tone="danger" message={actionError} /> : null}

      <div className={styles.columns}>
        <div className={styles.rail}>
          <V8CreateButton href="/mileage/rewards/edit" readonly={readonly}>
            <Plus size={14} aria-hidden="true" /> 使い道を作る
          </V8CreateButton>
          <FolderPanel
            heading="フォルダ"
            rows={FOLDERS.map((key) => ({
              id: key,
              label: key,
              count: folderCounts.get(key) ?? 0,
            }))}
            activeId={folder}
            onSelect={(id) => { setPage(1); setFolder(id as Folder) }}
          />
        </div>

        <div className={styles.main}>
          <p className={styles.band} role="note">
            <Info size={16} aria-hidden="true" />
            交換は、お客さまのLINE（マイルの画面）から。渡せなかったときは、決めておいた方法（マイルを戻すなど）で処理します。
          </p>

          <div className={styles.railCollapsedBar}>
            <V8CreateButton href="/mileage/rewards/edit" readonly={readonly}>
              <Plus size={14} aria-hidden="true" /> 使い道を作る
            </V8CreateButton>
            <Select
              aria-label="フォルダ"
              value={folder}
              options={FOLDERS.map((key) => ({
                value: key,
                label: `フォルダ：${key}`,
              }))}
              onChange={(value) => { setPage(1); setFolder(value as Folder) }}
            />
          </div>

          <div className={styles.toolbar}>
            <SearchField
              aria-label="使い道の名前で探す"
              value={searchInput}
              onChange={setSearchInput}
              onClear={() => { setSearchInput(''); setSearch(''); setPage(1) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1)
                  setSearch(searchInput.trim())
                }
              }}
              placeholder="使い道の名前で探す"
            />
            <FilterChip
              selected={publishedOnly}
              onChange={(selected) => {
                setPage(1)
                setPublishedOnly(selected)
                if (selected) setDraftOnly(false)
              }}
            >
              出している {formatMileageNumber(publishedCount)}
            </FilterChip>
            <FilterChip
              selected={draftOnly}
              onChange={(selected) => {
                setPage(1)
                setDraftOnly(selected)
                if (selected) setPublishedOnly(false)
              }}
            >
              下書き {formatMileageNumber(draftCount)}
            </FilterChip>
            <span className={styles.toolbarRight}>
              <Select
                aria-label="よく使う絞り込み"
                value={preset}
                options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
                onChange={(value) => {
                  setPage(1)
                  setPreset(value)
                  if (value === 'draft') {
                    setDraftOnly(true)
                    setPublishedOnly(false)
                  } else if (value === 'published-exchanged') {
                    setPublishedOnly(true)
                    setDraftOnly(false)
                  } else if (value === 'default' || value === 'miles-asc') {
                    setPublishedOnly(false)
                    setDraftOnly(false)
                  }
                }}
              />
              <PageSizeSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} options={[10, 20, 50]} />
            </span>
          </div>

          {status === 'loading' ? (
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
          ) : status === 'forbidden' ? (
            <div className={styles.stateWrap}>
              <div className={styles.stateCard}>
                <p className={styles.stateTitle}>使い道を見る権限がありません</p>
                <p className={styles.stateDesc}>オーナーか管理者に確認してください。</p>
              </div>
            </div>
          ) : status === 'error' ? (
            <div className={styles.stateWrap}>
              <div className={styles.errorBand} role="alert">
                使い道を読み込めませんでした
                <span className={styles.errorRetry}>
                  <Button type="button" onClick={() => void load()}>もう一度試す</Button>
                </span>
              </div>
              <p className={styles.errorNote}>数の帯は「—」にしています。道具はそのまま使えます。</p>
            </div>
          ) : rewards.length === 0 ? (
            <div className={styles.stateWrap}>
              <div className={styles.stateCard}>
                <p className={styles.stateTitle}>まだ使い道がありません</p>
                <p className={styles.stateDesc}>交換できる特典を1つ出すと、マイルが動きにつながります</p>
                {!readonly ? (
                  <div className={styles.stateActions}>
                    <Button variant="primary" href="/mileage/rewards/edit">
                      <Plus size={14} aria-hidden="true" /> 使い道を作る
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className={styles.stateWrap}>
              <div className={styles.stateCard}>
                <p className={styles.stateTitle}>条件に合う使い道はありません</p>
                <p className={styles.stateDesc}>名前の検索や絞り込みを外すと、すべて出ます</p>
                <div className={styles.stateActions}>
                  <Button type="button" onClick={resetAll}>条件を外す</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">使い道</th>
                    <th scope="col">必要なマイル</th>
                    <th scope="col">交換すると渡るもの</th>
                    <th scope="col">今月交換された</th>
                    <th scope="col">状態</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((reward) => {
                    const pill = statusPill(reward.status)
                    const operable = !readonly
                      && (reward.status === 'published' || reward.status === 'draft' || reward.status === 'stopped')
                    const reach = reachMetrics.find((metric) => metric.rewardId === reward.id)
                    return (
                      <tr key={reward.id}>
                        <td>
                          <p className={styles.cellMain} title={reward.name}>{reward.name}</p>
                          <p className={styles.cellSub}>
                            {reach ? `今すぐ交換できる人 ${formatMileageNumber(reach.reachableFriendCount)}` : '今すぐ交換できる人 —'}
                          </p>
                        </td>
                        <td><span className={styles.num}>{formatMileageNumber(reward.currentVersion?.requiredMiles)}</span></td>
                        <td>
                          <p className={styles.cellSubDark}>
                            {reward.benefitName
                              ? `${KIND_LABEL[reward.rewardKind]}「${reward.benefitName}」`
                              : KIND_LABEL[reward.rewardKind]}
                          </p>
                          {benefitSub(reward) ? <p className={styles.cellSub}>{benefitSub(reward)}</p> : null}
                        </td>
                        <td><span className={styles.num}>{formatMileageNumber(reward.exchangedThisMonth)}件</span></td>
                        <td><span className={pill.className}>{pill.text}</span></td>
                        <td>
                          <span className={styles.rowActions}>
                            <Button href={`/mileage/rewards/edit?id=${encodeURIComponent(reward.id)}`}>
                              中身を見る
                            </Button>
                            {operable ? (
                              <Button
                                disabled={busyId === reward.id}
                                onClick={() => setStateTarget(reward)}
                                busy={busyId === reward.id}
                                busyLabel="反映しています"
                              >
                                {reward.status === 'published' ? '止める' : reward.status === 'stopped' ? 'また出す' : '出す'}
                              </Button>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {status === 'ready' && visible.length > 0 ? (
            <div className={styles.footer}>
              <span className={styles.footerCount}>
                {shown.length}件中 {(page - 1) * pageSize + 1}〜{Math.min(page * pageSize, shown.length)}件
              </span>
              {pageCount > 1 ? <Pagination page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
            </div>
          ) : null}

          {status === 'ready' && rewards.length > 0 ? (
            <p className={styles.footnote}>行の「中身を見る」から編集・自分で交換をテスト・出すのを止める・複製。</p>
          ) : null}

          {retryNotice ? <Notice tone="success" message={retryNotice} /> : null}
          {redemptionsVisible && (failed.length > 0 || redemptionsLoad === 'error' || redemptionsLoad === 'forbidden') ? (
            <section aria-label="要対応の交換">
              <p className={styles.cellSubDark}><strong>要対応の交換</strong></p>
              <p className={styles.cellSub}>マイルは減ったまま、特典が届いていないか、届いたか分からない交換です。やり直してもマイルはもう減りません。</p>
              {retryError ? <Notice tone="danger" message={retryError} /> : null}
              {redemptionsLoad === 'error' || redemptionsLoad === 'forbidden' ? (
                <div className={styles.stateWrap}>
                  <ListState
                    kind={redemptionsLoad}
                    description={redemptionsLoad === 'forbidden'
                      ? '要対応の交換を見る権限がありません。オーナーか管理者に確認してください。'
                      : '要対応の交換を読み込めませんでした。'}
                    onRetry={redemptionsLoad === 'error' ? () => void loadFailed(redemptionsPage) : undefined}
                  />
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">使い道</th>
                        <th scope="col">状態</th>
                        <th scope="col">届かなかった理由</th>
                        <th scope="col">試した回数</th>
                        <th scope="col">最後の更新</th>
                        <th scope="col">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failed.map((item) => (
                        <tr key={item.id}>
                          <td><p className={styles.cellMain} title={item.rewardName}>{item.rewardName}</p></td>
                          <td>
                            {item.status === 'delivering' ? (
                              <span className={styles.cellSubDark}>
                                確認中
                                <HelpTip label="確認中の説明">
                                  送った結果が分からず、確定を確認しています。二重に送らないよう自動では動かしていません。
                                </HelpTip>
                              </span>
                            ) : (
                              <span className={styles.cellSubDark}>届いていない</span>
                            )}
                          </td>
                          <td><span className={styles.cellSubDark}>{item.failureMessage || item.failureCode || '理由を確認できませんでした'}</span></td>
                          <td><span className={styles.num}>{formatNumber(item.attemptCount)}回</span></td>
                          <td><span className={styles.cellSubDark}>{formatMileageDate(item.updatedAt)}</span></td>
                          <td>
                            {!readonly ? (
                              <Button
                                disabled={retryingId !== null}
                                onClick={() => setRetryTarget(item)}
                                busy={retryingId === item.id}
                                busyLabel="やり直しています"
                              >
                                もう一度届ける
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {Math.ceil(redemptionsTotal / REDEMPTIONS_PAGE_SIZE) > 1 ? (
                <div className={styles.footer}>
                  <span className={styles.footerCount}>
                    要対応の交換 {formatNumber(redemptionsTotal)}件
                  </span>
                  <Pagination
                    page={redemptionsPage}
                    pageCount={Math.ceil(redemptionsTotal / REDEMPTIONS_PAGE_SIZE)}
                    onPageChange={(next) => setRedemptionsPage(next)}
                    ariaLabel="要対応の交換のページ送り"
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      {stateTarget ? (
        <ConfirmDialog
          open
          title={`「${stateTarget.name}」を${stateTarget.status === 'published' ? '止めますか' : stateTarget.status === 'stopped' ? 'また出しますか' : '出しますか'}？`}
          description={
            stateTarget.status === 'published'
              ? '止めると友だちはこの使い道と交換できなくなります。交換した分はそのまま残ります。'
              : '出すと友だちがこの使い道と交換できるようになります。'
          }
          confirmLabel={stateTarget.status === 'published' ? '止める' : stateTarget.status === 'stopped' ? 'また出す' : '出す'}
          destructive={stateTarget.status === 'published'}
          busy={busyId === stateTarget.id}
          onConfirm={() => void changeState(stateTarget)}
          onCancel={() => setStateTarget(null)}
        />
      ) : null}
      {retryTarget ? (
        <ConfirmDialog
          open
          title={`「${retryTarget.rewardName}」をもう一度届けますか？`}
          description="届かなかった交換をもう一度送ります。相手には新しく届きます。"
          confirmLabel="届ける"
          busy={retryingId === retryTarget.id}
          onConfirm={() => void retryRedemption(retryTarget)}
          onCancel={() => setRetryTarget(null)}
        />
      ) : null}
    </>
  )
}
