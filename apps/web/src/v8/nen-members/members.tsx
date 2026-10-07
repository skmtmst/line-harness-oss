'use client'

/*
 * ★V8-B 会員（Pencil「★V8-B 画面の地図」専用機能の組：
 * 会員一覧 `AOWoJ`、ランク設定 `fb9NJ`、ランクを消す（確認）`dEv6G`、
 * ランク設定の競合 `e5yBLx`、ライフタイム `zQ5vY`）。
 *
 * 外枠（見出し・CSV・タブ・数の帯）は全部のタブで同じ。型は ListPage。
 * データの口（settings・members・saveRanks・saveMilestones・deleteRank・resync）は今の画面と同じ。
 * 動きの一覧は BEHAVIOR.md。
 */
import { useState, type ReactNode } from 'react'
import { Download, Eye, History, CircleHelp, Undo2 } from 'lucide-react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import { RowMenu } from '@/components/shared/row-actions'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import { Tabs } from '@/components/shared/tabs'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { usePageCrumbs } from '@/components/shell/page-chrome'
import { useStaffRole, canManageRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { nenRanksApi, type NenMemberRow, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import MembersListV8 from './list'
import RankSettingsV8 from './ranks'
import LifetimeV8 from './lifetime'
import { csvLine, yen, type LoadStatus, type MemberTab, type SavedHandler } from './parts'
import styles from './members.module.css'

export type { LoadStatus, MemberTab } from './parts'

/** 板ごとの data-design-node（タブで切り替える外枠の印）。 */
const BOARD_NODE: Record<MemberTab, string> = {
  members: 'AOWoJ',
  ranks: 'fb9NJ',
  lifetime: 'zQ5vY',
}

export default function MembersV8({
  accountId,
  tab,
  status,
  settings,
  onRetry,
  onSaved,
  onChangeTab,
}: {
  accountId: string | null
  tab: MemberTab
  status: LoadStatus
  settings: NenRankSettingsData | null
  onRetry: () => void
  onSaved: SavedHandler
  onChangeTab: (next: MemberTab) => void
}) {
  const role = useStaffRole()
  const readonly = role !== null && !canManageRole(role)
  /* ★V8 の上の帯は「ホーム › 会員」。画面名は枠が付ける。 */
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

  const kpis = settings?.kpis ?? null
  const ranks = settings?.ranks ?? []
  /** ランク設定の競合の帯（e5yBLx）。タブの下・数の帯の上に出す。 */
  const [topBand, setTopBand] = useState<ReactNode>(null)

  const tabs = <>
    <Tabs
      className={styles.tabs}
      label="会員の切り替え"
      items={[
        { label: '会員一覧', count: kpis?.members, current: tab === 'members', onClick: () => onChangeTab('members') },
        { label: 'ランク設定', current: tab === 'ranks', onClick: () => onChangeTab('ranks') },
        { label: 'ライフタイム', current: tab === 'lifetime', onClick: () => onChangeTab('lifetime') },
        { label: 'ECとの照合', href: '/ec-commerce/identity-candidates' },
      ]}
    />
    {readonly ? (
      <div className={styles.viewerBand} role="status">
        <Eye size={16} aria-hidden="true" />
        <span>閲覧のみで見ています。ランクや節目を変える操作は管理者に頼んでください。</span>
      </div>
    ) : null}
    {tab === 'ranks' ? topBand : null}
  </>

  let body: ReactNode
  if (!accountId) {
    body = <ListState kind="empty" title="LINEアカウントを選んでください" description="上のバーから、会員を見るLINEアカウントを選びます。" />
  } else if (tab === 'ranks') {
    body = <RankSettingsV8 key={accountId} accountId={accountId} status={status} settings={settings} onSaved={onSaved} onRetry={onRetry} readonly={readonly} onTopBand={setTopBand} />
  } else if (tab === 'lifetime') {
    body = <LifetimeV8 key={accountId} accountId={accountId} status={status} settings={settings} onSaved={onSaved} onRetry={onRetry} readonly={readonly} />
  } else {
    body = <MembersListV8 key={accountId} accountId={accountId} settings={settings} />
  }

  return (
    <ListPage
      boardId={BOARD_NODE[tab]}
      title="会員"
      description="ネットショップの会員と LINE の友だちを結びつけて、ランクやペットの情報を見ます。"
      actions={accountId ? <CsvExportButton accountId={accountId} /> : null}
      tabs={tabs}
      stats={accountId ? <MembersKpiBand kpis={kpis} ranks={ranks} loading={status === 'loading' && !settings} accountId={accountId} /> : undefined}
    >
      {body}
    </ListPage>
  )
}

/**
 * 数の帯。白い板の左右いっぱいに4つ（★V8 の共通部品 KpiBand）。
 * 「○○以上」は上から2ランク（描いた板は ゴールド以上＝プラチナとゴールド）。
 */
function MembersKpiBand({
  kpis,
  ranks,
  loading,
  accountId,
}: {
  kpis: NenRankSettingsData['kpis'] | null
  ranks: NenRankSettingsData['ranks']
  loading: boolean
  accountId: string
}) {
  const sorted = [...ranks].sort((a, b) => b.annualThresholdYen - a.annualThresholdYen)
  const topTwo = sorted.slice(0, 2)
  const topTwoCount = kpis ? topTwo.reduce((sum, rank) => sum + (kpis.byRank[rank.key] ?? 0), 0) : null
  const topTwoLabel = topTwo[1] ? `${topTwo[1].name}以上` : '上位ランク'
  const petPercent = kpis && kpis.members > 0 ? Math.round(((kpis.petMembers ?? 0) / kpis.members) * 100) : null
  const pending = loading || !kpis
  const menu = (title: string) => <KpiMenu title={title} accountId={accountId} />
  return (
    <KpiBand className={styles.band} aria-label="会員の数の帯">
      <KpiCard presentation="band" title="会員" icon={<History size={13} aria-hidden="true" />} menu={menu('会員')} value={pending ? null : kpis.members} unit="人" loading={loading} detail={pending ? '—' : `LINE 連携済み ${formatNumber(kpis.linkedMembers ?? 0)}`} />
      <KpiCard presentation="band" title={topTwoLabel} icon={<CircleHelp size={13} aria-hidden="true" />} menu={menu(topTwoLabel)} value={pending || topTwo.length === 0 ? null : topTwoCount} unit="人" loading={loading} detail={topTwo[1] ? `今年の購入 ${yen(topTwo[1].annualThresholdYen)} 以上` : '—'} />
      <KpiCard presentation="band" title="ペット登録あり" icon={<CircleHelp size={13} aria-hidden="true" />} menu={menu('ペット登録あり')} value={pending ? null : kpis.petMembers ?? 0} unit="人" loading={loading} detail={pending || petPercent === null ? '—' : `会員の ${petPercent}%`} />
      <KpiCard presentation="band" title="今月の購入" icon={<Undo2 size={13} aria-hidden="true" />} menu={menu('今月の購入')} value={null} valueText={pending ? '—' : yen(kpis.monthPurchaseYen ?? 0)} unit="" loading={loading} detail={pending ? '—' : `会員 ${formatNumber(kpis.monthBuyers ?? 0)} 人`} />
    </KpiBand>
  )
}

/** 数の帯の「…」。この画面で使える操作だけ（いまは会員の CSV の書き出し）。 */
function KpiMenu({ title, accountId }: { title: string; accountId: string }) {
  const [open, setOpen] = useState(false)
  const { exportCsv, busy } = useMembersCsv(accountId)
  return <span className={styles.kpiMenu}>
    <RowMenu className={styles.kpiMenuButton} label={`${title}の操作`} open={open} onOpenChange={setOpen} items={[{ id: 'csv', label: 'CSV で書き出す', disabled: busy, onSelect: () => { setOpen(false); void exportCsv() } }]} />
  </span>
}

/** 会員を全部取って CSV にする（いまの絞り込みは付けない。今の画面と同じ）。 */
function useMembersCsv(accountId: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const exportCsv = async () => {
    setBusy(true)
    setError('')
    try {
      const rows: NenMemberRow[] = []
      let page = 1
      // 1回あたり100件まで。全部取る（NEN の会員数は数百規模を想定）。
      for (;;) {
        const res = await nenRanksApi.members(accountId, { page, pageSize: 100, sort: 'annual_desc' })
        if (!res.success) throw new Error(res.error)
        rows.push(...res.data.items)
        if (rows.length >= res.data.total || res.data.items.length === 0) break
        page += 1
      }
      const lines = [
        csvLine(['会員名', 'EC会員ID', 'LINE連携', 'ランク', '通年（円）', 'ライフタイム（円）', 'マイル残高', 'ペット', '最終購入', 'マイル還元（%）']),
        ...rows.map((member) => csvLine([
          member.name,
          member.customerId ?? '',
          member.customerId ? '連携済み' : '未連携',
          member.rankName,
          String(member.annualMilesYen),
          String(member.lifetimeMilesYen),
          String(member.mileBalance),
          member.petNames ?? '',
          member.lastPurchasedAt ?? '',
          member.mileRatePercent == null ? '' : String(member.mileRatePercent),
        ])),
      ]
      const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `nen-members-${new Date().toISOString().slice(0, 10)}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(describeApiFailure(caught, 'CSVの書き出し', {
        forbidden: 'CSVを書き出す権限がありません。権限を確認してください。',
      }))
    } finally {
      setBusy(false)
    }
  }
  return { exportCsv, busy, error }
}

/** 板の頭の「CSV で書き出す」。閲覧のみでも使える（書き出しは読むだけ）。 */
function CsvExportButton({ accountId }: { accountId: string }) {
  const { exportCsv, busy, error } = useMembersCsv(accountId)
  return (
    <span className={styles.csvWrap}>
      <Button variant="secondary" onClick={() => void exportCsv()} disabled={busy}>
        <Download size={15} aria-hidden="true" />
        {busy ? '書き出しています…' : 'CSV で書き出す'}
      </Button>
      {error ? <span className={styles.csvError} role="alert">{error}</span> : null}
    </span>
  )
}
