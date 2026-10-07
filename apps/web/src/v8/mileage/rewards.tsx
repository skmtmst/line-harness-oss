'use client'

/*
 * ★V8 マイル「使い道」（板 `S35pO`、状態は見本帳 `zaqP9`）。
 *
 * app/mileage/v8-rewards-tab.tsx から動きを写し、見た目を一覧の型で組み直した。
 * 表は「使い道・必要なマイル・交換すると渡るもの・今月交換された・状態・
 * 操作（中身を見る・…）」。止める／出すは行の「…」。頭の CSV は見えている
 * 表の中身を出す。要対応の交換（届かなかった分のやり直し）は表の下に残す。
 *
 * フォルダの列に割り当てる API は無いので、渡すものの種類で分けた
 * 見え方の切り替えとして持つ（保存はしない）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeftRight, CircleDot, Download, FilePen, Gift, MoreHorizontal, Plus, Star } from 'lucide-react'
import type { ApiResponse } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import {
  ApiError,
  api,
  fetchApi,
  type MileageRewardKind,
  type MileageRewardStatus,
  type MileageRewardSummary,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { csvCell } from '@/lib/presentation'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import EmptyList from '@/components/shared/empty-list'
import FilterChip from '@/components/shared/filter-chip'
import FolderPanel from '@/components/shared/folder-panel'
import HelpTip from '@/components/shared/help-tip'
import IconButton from '@/components/shared/icon-button'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ListPagePagination } from '@/components/templates'
import { formatMileageDate, formatMileageNumber } from './display'
import { CreateButton, MileageFrame, useMileageShell } from './frame'
import { MileageToolbar, PerPageSelect, RetryButton, SavedSelect, StateCard, ToolbarNotices } from './parts'
import styles from './mileage.module.css'

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

function statusPill(status: MileageRewardStatus): { text: string; tone: 'active' | 'neutral' } {
  if (status === 'published') return { text: '出している', tone: 'active' }
  if (status === 'draft') return { text: '下書き', tone: 'neutral' }
  if (status === 'stopped') return { text: '止めています', tone: 'neutral' }
  return { text: '片づけました', tone: 'neutral' }
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
    parts.push('残り 制限なし')
  }
  if (version.endsAt) {
    /* 絵は「10/31 まで」。年月日の頭だけ取り、時刻・時差に振られない。 */
    const day = version.endsAt.slice(0, 10).split('-')
    if (day.length === 3) parts.push(`${Number(day[1])}/${Number(day[2])} まで`)
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
  { value: 'default', label: 'よく使う絞り込み' },
  { value: 'published-exchanged', label: '出している・交換が多い順' },
  { value: 'draft', label: '下書きのみ' },
  { value: 'miles-asc', label: '必要なマイルが少ない順' },
]

export default function RewardsTab() {
  const { readonly, narrow, setCount } = useMileageShell()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const accountId = selectedAccountId
  const router = useRouter()
  const [rewards, setRewards] = useState<MileageRewardSummary[]>([])
  const [reachMetrics, setReachMetrics] = useState<Array<{ rewardId: string; reachableFriendCount: number }>>([])
  const [redeemedMiles, setRedeemedMiles] = useState<number | null>(null)
  const [exchangedCount, setExchangedCount] = useState<number | null>(null)
  const [popularName, setPopularName] = useState<string | null>(null)
  const [popularCount, setPopularCount] = useState<number | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null)
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
  const [menuId, setMenuId] = useState<string | null>(null)
  const [testBusyId, setTestBusyId] = useState<string | null>(null)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const [menuNotice, setMenuNotice] = useState('')
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
      /* 1回も交換されていないのに名指ししない（回数が0ならまだ誰も使っていない）。 */
      const redeemedCount = overviewSummary?.mostRedeemedRewardCount ?? null
      setPopularName(redeemedCount ? (overviewSummary?.mostRedeemedRewardName ?? null) : null)
      setPopularCount(redeemedCount)
      setReachMetrics(Array.isArray(response.data.reachMetrics) ? response.data.reachMetrics : [])
      setLoadedAccountId(accountId)
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
      const forbidden = reason instanceof ApiError && (reason.status === 403 || reason.code === 'forbidden')
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

  /* 行の「…」の「自分で交換をテスト」。残高・在庫は動かさない。 */
  const runTest = async (reward: MileageRewardSummary) => {
    if (!accountId || testBusyId) return
    setTestBusyId(reward.id)
    setMenuNotice('')
    setActionError('')
    try {
      const response = await api.mileage.testReward(reward.id, accountId)
      if (!response.success) throw new Error(response.error)
      const warning = typeof response.data?.warning === 'string' ? response.data.warning.trim() : ''
      setMenuNotice(response.data?.canDeliver
        ? 'この内容で交換できます。残高・在庫は動いていません。'
        : (warning || 'この内容では交換できません。内容を確認してください。'))
    } catch {
      setActionError('交換のテストができませんでした。もう一度お試しください。')
    } finally {
      setTestBusyId(null)
    }
  }

  /* 行の「…」の「複製」。今の内容で下書きを1つ作る（公開はしない）。 */
  const duplicateReward = async (reward: MileageRewardSummary) => {
    if (readonly || !accountId || duplicateId) return
    const version = reward.currentVersion
    if (!version) {
      setActionError('複製する内容が取れませんでした。開き直してもう一度お試しください。')
      return
    }
    setDuplicateId(reward.id)
    setMenuNotice('')
    setActionError('')
    try {
      const response = await api.mileage.createReward(accountId, {
        name: `${reward.name} のコピー`,
        description: reward.description,
        imageUrl: reward.imageUrl,
        rewardKind: reward.rewardKind,
        requiredMiles: version.requiredMiles,
        stockLimit: version.stockLimit,
        perFriendLimit: version.perFriendLimit,
        startsAt: version.startsAt,
        endsAt: version.endsAt,
        benefitExpiresDays: version.benefitExpiresDays,
        commonActionVersionId: version.commonActionVersionId,
        targetConditions: version.targetConditions,
        failurePolicy: version.failurePolicy,
        customerMessage: version.customerMessage,
      })
      if (!response.success) throw new Error(response.error)
      setMenuNotice(`「${reward.name} のコピー」を下書きで作りました。`)
      await load()
    } catch {
      setActionError('複製できませんでした。もう一度お試しください。')
    } finally {
      setDuplicateId(null)
    }
  }

  /* タブの名の横の件数。読み直し中・失敗時は消す。 */
  useEffect(() => {
    if (status === 'loading') return
    setCount('rewards', status !== 'ready' ? null : formatMileageNumber(rewards.length))
  }, [setCount, rewards.length, status])

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
      return [...filtered].filter((r) => r.status === 'published').sort((a, b) => b.exchangedThisMonth - a.exchangedThisMonth)
    }
    if (preset === 'draft') return filtered.filter((r) => r.status === 'draft')
    if (preset === 'miles-asc') {
      return [...filtered].sort((a, b) => (a.currentVersion?.requiredMiles ?? 0) - (b.currentVersion?.requiredMiles ?? 0))
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

  /* 頭の「CSV で書き出す」。使い道の書き出し口は無いので、今見えている表の中身をそのまま出す。 */
  const canExport = !accountLoading && !!accountId && loadedAccountId === accountId && status === 'ready' && shown.length > 0
  const exportCsv = useCallback(() => {
    if (!canExport) return
    setActionError('')
    try {
      const rows = shown.map((reward) => [
        reward.name,
        String(reward.currentVersion?.requiredMiles ?? ''),
        reward.benefitName ? `${KIND_LABEL[reward.rewardKind]}「${reward.benefitName}」` : KIND_LABEL[reward.rewardKind],
        benefitSub(reward) ?? '',
        `${reward.exchangedThisMonth}件`,
        statusPill(reward.status).text,
      ])
      const csv = [['使い道', '必要なマイル', '交換すると渡るもの', '残り・期限', '今月交換された', '状態'], ...rows]
        .map((row) => row.map((value) => csvCell(value)).join(','))
        .join('\n')
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mileage-rewards-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setActionError('CSVを書き出せませんでした。もう一度お試しください。')
    }
  }, [canExport, shown])

  const ready = status === 'ready'
  const failedReason = failed[0] ? (failed[0].failureMessage || failed[0].rewardName) : null

  const stats = (
    <KpiBand>
      <KpiCard
        presentation="band"
        title="使い道"
        icon={<Gift size={14} aria-hidden="true" />}
        value={ready ? rewards.length : null}
        unit="件"
        detail={ready ? `出している ${formatMileageNumber(publishedCount)}・下書き ${formatMileageNumber(draftCount)}` : '—'}
      />
      <KpiCard
        presentation="band"
        title="今月 交換"
        icon={<ArrowLeftRight size={14} aria-hidden="true" />}
        value={ready ? exchangedCount ?? 0 : null}
        unit="件"
        detail={ready ? `${formatMileageNumber(redeemedMiles ?? 0)} マイル` : '—'}
      />
      <KpiCard
        presentation="band"
        title="いちばん人気"
        icon={<Star size={14} aria-hidden="true" />}
        value={ready && popularName ? 0 : null}
        valueText={ready && popularName ? popularName : undefined}
        unit=""
        detail={ready ? (popularName ? `今月 ${formatMileageNumber(popularCount ?? 0)}件` : 'まだ交換されていません') : '—'}
      />
      <KpiCard
        presentation="band"
        title="渡せなかった"
        icon={<AlertCircle size={14} aria-hidden="true" />}
        value={redemptionsLoad === 'ready' ? redemptionsTotal : null}
        unit="件"
        detail={<span className={styles.oneLine} title={failedReason ?? undefined}>{failedReason ?? '要対応の交換はありません'}</span>}
      />
    </KpiBand>
  )

  const folderPanel = (
    <FolderPanel
      heading="フォルダ"
      rows={FOLDERS.map((key) => ({ id: key, label: key, count: folderCounts.get(key) ?? 0 }))}
      activeId={folder}
      onSelect={(id) => { setPage(1); setFolder(id as Folder) }}
      addFolderNote="フォルダを消しても、中の経路は未分類に残ります"
    />
  )

  const createButton = (full: boolean) => (
    <CreateButton href="/mileage/rewards/edit" readonly={readonly} full={full}>
      <Plus size={15} aria-hidden="true" /> 使い道を作る
    </CreateButton>
  )

  const chips = (
    <div role="group" aria-label="状態で絞り込む" className={styles.chipGroup}>
      <FilterChip
        selected={publishedOnly}
        icon={<CircleDot size={13} aria-hidden="true" />}
        onChange={(selected) => {
          setPage(1)
          setPublishedOnly(selected)
          if (selected) setDraftOnly(false)
        }}
      >
        {`出している ${formatMileageNumber(publishedCount)}`}
      </FilterChip>
      <FilterChip
        selected={draftOnly}
        icon={<FilePen size={13} aria-hidden="true" />}
        onChange={(selected) => {
          setPage(1)
          setDraftOnly(selected)
          if (selected) setPublishedOnly(false)
        }}
      >
        {`下書き ${formatMileageNumber(draftCount)}`}
      </FilterChip>
    </div>
  )

  const toolbar = (
    <MileageToolbar
      narrow={narrow}
      notices={<ToolbarNotices
        info="交換は、お客さまの LINE（マイルの画面）から。渡せなかったときは、決めておいた方法（マイルを戻す など）で処理します"
        error={actionError}
        success={menuNotice}
      />}
      search={{
        placeholder: '使い道の名前で探す',
        value: searchInput,
        onChange: (value) => {
          setSearchInput(value)
          if (!value) { setSearch(''); setPage(1) }
        },
      }}
      chips={chips}
      narrowLead={<>
        {createButton(false)}
        <div className={styles.narrowFolder}>
          <Select
            aria-label="フォルダ"
            value={folder}
            options={FOLDERS.map((key) => ({ value: key, label: `フォルダ：${key}` }))}
            onChange={(value) => { setPage(1); setFolder(value as Folder) }}
          />
        </div>
      </>}
      trailing={<>
        <SavedSelect
          value={preset}
          options={PRESETS}
          onChange={(value) => {
            setPage(1)
            setPreset(value)
            if (value === 'draft') {
              setDraftOnly(true)
              setPublishedOnly(false)
            } else if (value === 'published-exchanged') {
              setPublishedOnly(true)
              setDraftOnly(false)
            } else {
              setPublishedOnly(false)
              setDraftOnly(false)
            }
          }}
        />
        <PerPageSelect value={pageSize} onChange={(next) => { setPage(1); setPageSize(next) }} />
      </>}
    />
  )

  const rowMenu = (reward: MileageRewardSummary) => {
    const operable = !readonly && (reward.status === 'published' || reward.status === 'draft' || reward.status === 'stopped')
    return (
      <div className={styles.menuBox}>
        <IconButton
          aria-label={`${reward.name}の操作`}
          title={`${reward.name}の操作`}
          aria-expanded={menuId === reward.id}
          onClick={() => setMenuId((current) => (current === reward.id ? null : reward.id))}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </IconButton>
        <ActionMenu
          open={menuId === reward.id}
          ariaLabel={`${reward.name}の操作`}
          onClose={() => setMenuId(null)}
          items={[
            {
              id: 'open',
              label: readonly ? '中身を見る' : '編集',
              external: true,
              onSelect: () => router.push(`/mileage/rewards/edit?id=${encodeURIComponent(reward.id)}`),
            },
            /* 閲覧のみの人には、変える操作を出さない（押せない形で残さない）。 */
            ...(readonly ? [] : [
              {
                id: 'test',
                label: '自分で交換をテスト',
                disabled: testBusyId === reward.id,
                disabledReason: 'テストを実行しています',
                onSelect: () => void runTest(reward),
              },
              ...(operable ? [{
                id: 'toggle',
                label: reward.status === 'published' ? '出すのを止める' : reward.status === 'stopped' ? 'また出す' : '出す',
                disabled: busyId === reward.id,
                disabledReason: '反映しています',
                onSelect: () => void changeState(reward),
              }] : []),
              {
                id: 'duplicate',
                label: '複製',
                disabled: duplicateId === reward.id || !reward.currentVersion,
                disabledReason: duplicateId === reward.id ? '複製しています' : '複製する内容が取れていません',
                onSelect: () => void duplicateReward(reward),
              },
            ]),
          ]}
        />
      </div>
    )
  }

  const table = (
    <div className={styles.tableWrap}>
      <DataTable className={styles.table}>
        <thead>
          <TableHeadRow className={styles.headRow} data-table-layout="columns">
            <Th className={styles.colName}>使い道</Th>
            <Th className={`${styles.colNeed} ${styles.num}`}>必要なマイル</Th>
            <Th className={styles.colGives}>交換すると渡るもの</Th>
            <Th className={`${styles.colMonth} ${styles.num}`}>今月 交換された</Th>
            <Th className={styles.colStateWide}>状態</Th>
            <Th className={styles.colOpsWide}>操作</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {visible.map((reward) => {
            const pill = statusPill(reward.status)
            const reach = reachMetrics.find((metric) => metric.rewardId === reward.id)
            const sub = benefitSub(reward)
            return (
              <Tr key={reward.id} className={styles.row} data-table-layout="columns">
                <Td className={styles.colName}>
                  <span className={styles.rowName} title={reward.name}>{reward.name}</span>
                  <span className={styles.rowSub}>
                    {reach ? `今すぐ交換できる人 ${formatMileageNumber(reach.reachableFriendCount)}` : '今すぐ交換できる人 —'}
                  </span>
                </Td>
                <Td className={`${styles.colNeed} ${styles.num}`}>
                  <span className={styles.cellMain}>{formatMileageNumber(reward.currentVersion?.requiredMiles)}</span>
                </Td>
                <Td className={styles.colGives}>
                  <span className={styles.cellMain}>
                    {reward.benefitName ? `${KIND_LABEL[reward.rewardKind]}「${reward.benefitName}」` : KIND_LABEL[reward.rewardKind]}
                  </span>
                  {sub ? <span className={styles.cellSub}>{sub}</span> : null}
                </Td>
                <Td className={`${styles.colMonth} ${styles.num}`}>
                  <span className={styles.cellMain}>{`${formatMileageNumber(reward.exchangedThisMonth)}件`}</span>
                </Td>
                <Td className={styles.colStateWide}>
                  <span className={styles.pill} data-tone={pill.tone}>
                    <span className={styles.pillDot} aria-hidden="true" />
                    {pill.text}
                  </span>
                </Td>
                <Td className={styles.colOpsWide}>
                  <span className={styles.rowActions}>
                    <Button href={`/mileage/rewards/edit?id=${encodeURIComponent(reward.id)}`}>中身を見る</Button>
                    {rowMenu(reward)}
                  </span>
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </div>
  )

  const failedSection = redemptionsVisible && (failed.length > 0 || redemptionsLoad === 'error' || redemptionsLoad === 'forbidden') ? (
    <section aria-label="要対応の交換" className={styles.subSection}>
      <p className={styles.subTitle}>要対応の交換</p>
      <p className={styles.subDesc}>マイルは減ったまま、特典が届いていないか、届いたか分からない交換です。やり直してもマイルはもう減りません。</p>
      {retryNotice ? <Notice tone="success" message={retryNotice} /> : null}
      {retryError ? <Notice tone="danger" message={retryError} /> : null}
      {redemptionsLoad === 'error' || redemptionsLoad === 'forbidden' ? (
        <ListState
          kind={redemptionsLoad}
          description={redemptionsLoad === 'forbidden'
            ? '要対応の交換を見る権限がありません。オーナーか管理者に確認してください。'
            : '要対応の交換を読み込めませんでした。'}
          onRetry={redemptionsLoad === 'error' ? () => void loadFailed(redemptionsPage) : undefined}
        />
      ) : (
        <DataTable className={styles.table}>
          <thead>
            <TableHeadRow className={styles.headRow} data-table-layout="columns">
              <Th className={styles.colName}>使い道</Th>
              <Th className={styles.colStateWide}>状態</Th>
              <Th className={styles.colGives}>届かなかった理由</Th>
              <Th className={`${styles.colMonth} ${styles.num}`}>試した回数</Th>
              <Th className={styles.colGives}>最後の更新</Th>
              <Th className={styles.colOpsWide}>操作</Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {failed.map((item) => (
              <Tr key={item.id} className={styles.row} data-table-layout="columns">
                <Td className={styles.colName}><span className={styles.cellMain} title={item.rewardName}>{item.rewardName}</span></Td>
                <Td className={styles.colStateWide}>
                  {item.status === 'delivering' ? (
                    <span className={styles.cellMain}>
                      確認中
                      <HelpTip label="確認中の説明">
                        送った結果が分からず、確定を確認しています。二重に送らないよう自動では動かしていません。
                      </HelpTip>
                    </span>
                  ) : (
                    <span className={styles.cellMain}>届いていない</span>
                  )}
                </Td>
                <Td className={styles.colGives}><span className={styles.cellMain}>{item.failureMessage || item.failureCode || '理由を確認できませんでした'}</span></Td>
                <Td className={`${styles.colMonth} ${styles.num}`}><span className={styles.cellMain}>{`${formatNumber(item.attemptCount)}回`}</span></Td>
                <Td className={styles.colGives}><span className={styles.cellMain}>{formatMileageDate(item.updatedAt)}</span></Td>
                <Td className={styles.colOpsWide}>
                  {!readonly ? (
                    <Button

                      disabled={retryingId !== null}
                      onClick={() => void retryRedemption(item)}
                      busy={retryingId === item.id}
                      busyLabel="やり直しています"
                    >
                      もう一度届ける
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {Math.ceil(redemptionsTotal / REDEMPTIONS_PAGE_SIZE) > 1 ? (
        <div className={styles.subPager}>
          <span className={styles.pagerCount}>{`要対応の交換 ${formatNumber(redemptionsTotal)}件`}</span>
          <Pagination
            page={redemptionsPage}
            pageCount={Math.ceil(redemptionsTotal / REDEMPTIONS_PAGE_SIZE)}
            onPageChange={(next) => setRedemptionsPage(next)}
            ariaLabel="要対応の交換のページ送り"
          />
        </div>
      ) : null}
    </section>
  ) : null

  const body = status === 'loading' ? (
    <ListState kind="loading" title="使い道を読み込んでいます" />
  ) : status === 'forbidden' ? (
    <StateCard title="使い道を見る権限がありません" description="オーナーか管理者に確認してください。" />
  ) : status === 'error' ? (
    <StateCard tone="error" title="使い道を読み込めませんでした" description="数の帯は「—」にしています。道具はそのまま使えます。" action={<RetryButton onRetry={() => void load()} />} />
  ) : visible.length === 0 ? (
    /* 修正案 D-2：空の一覧。 */
    <EmptyList
      icon={<Gift aria-hidden="true" />}
      title="まだ使い道がありません"
      description="たまったマイルと交換できる特典を出します。"
      create={{ label: '最初の使い道を作る', href: '/mileage/rewards/edit' }}
      canCreate={!readonly}
      filtered={rewards.length > 0}
      onClearFilters={resetAll}
      filteredDescription="名前の検索や絞り込みを外すと、すべて出ます"
    />
  ) : (
    <>
      {table}
      <p className={styles.footNote}>行の「…」から 編集・自分で交換をテスト・出すのを止める・複製。</p>
    </>
  )

  const pager = ready && visible.length > 0 && pageCount > 1 ? (
    <ListPagePagination>
      <span className={styles.pagerCount}>{`${shown.length}件中 ${(page - 1) * pageSize + 1}〜${Math.min(page * pageSize, shown.length)}件`}</span>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </ListPagePagination>
  ) : undefined

  return (
    <MileageFrame
      actions={
        <Button variant="secondary" onClick={exportCsv} disabled={!canExport}>
          <Download size={15} aria-hidden="true" /> CSV で書き出す
        </Button>
      }
      stats={stats}
      folders={<>{createButton(true)}{folderPanel}</>}
      toolbar={toolbar}
      pagination={pager}
    >
      {body}
      {failedSection}
    </MileageFrame>
  )
}
